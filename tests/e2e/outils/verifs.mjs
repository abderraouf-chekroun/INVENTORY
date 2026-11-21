// Assertions, attentes et contrôles de mise en page / d'impression exécutés dans la page.

import { isDeepStrictEqual } from 'node:util';

/** Échec d'un contrôle : message lisible, sans pile. */
export class Echec extends Error {}

export function verifier(condition, message) {
  if (!condition) throw new Echec(message);
}

export function egal(obtenu, attendu, quoi) {
  if (!isDeepStrictEqual(obtenu, attendu)) {
    throw new Echec(`${quoi} : attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`);
  }
}

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Répète `fn` jusqu'à ce qu'elle renvoie une valeur vraie (ou ne lève plus), puis renvoie cette valeur.
 * Au-delà de `delai`, échoue avec `quoi` (et la dernière valeur obtenue).
 */
export async function attendre(fn, quoi, delai = 8000) {
  const limite = Date.now() + delai;
  let dernier;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
      dernier = v;
    } catch (e) {
      dernier = e instanceof Error ? e.message : e;
    }
    if (Date.now() > limite) {
      throw new Echec(`${quoi}${dernier !== undefined && dernier !== false ? ` (dernier état : ${JSON.stringify(dernier)})` : ''}`);
    }
    await pause(100);
  }
}

/**
 * Débordements horizontaux et contenus coupés dans la fenêtre courante (exécuté dans la page).
 * Renvoie une liste de problèmes, vide si la mise en page tient.
 */
export function controleMiseEnPage() {
  const problemes = [];
  // Les éléments fautifs sont marqués (data-e2e-probleme) pour pouvoir les montrer sur une capture.
  for (const el of document.querySelectorAll('[data-e2e-probleme]')) el.removeAttribute('data-e2e-probleme');
  const signaler = (el, texte) => {
    el.setAttribute('data-e2e-probleme', '');
    problemes.push(texte);
  };
  const decrire = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return `<${el.tagName.toLowerCase()}${cls}>${txt ? ` « ${txt} »` : ''}`;
  };
  const vw = document.documentElement.clientWidth;
  for (const sel of ['html', 'body', '.win', '.shell', '.main', '.content', '.page', '.topbar', '.titlebar', '.side']) {
    const el = document.querySelector(sel);
    if (el && el.scrollWidth > el.clientWidth + 1) {
      signaler(el, `${sel} déborde horizontalement (${el.scrollWidth} px pour ${el.clientWidth} px)`);
    }
  }
  // Un élément de 1 × 1 px au plus n'affiche rien : c'est le motif « texte pour lecteur d'écran seulement »
  // (.sr-only), masqué par construction, pas un contenu coupé.
  const visible = (el) => {
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 1 && r.height > 1;
  };
  const defilantX = (el) => {
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === 'auto' || o === 'scroll') return p;
    }
    return null;
  };
  for (const el of document.querySelectorAll('.win *, .scrim *')) {
    if (!visible(el)) continue;
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const conteneur = defilantX(el);
    if (r.right > vw + 1 && !(conteneur && conteneur.matches('.content'))) {
      signaler(el, `${decrire(el)} sort de la fenêtre à droite (${Math.round(r.right)} px > ${vw} px)`);
    }
    // Conteneur à défilement horizontal qui défile réellement : contenu trop large pour la fenêtre.
    if ((st.overflowX === 'auto' || st.overflowX === 'scroll') && !el.matches('.content, .side, html, body')
      && el.scrollWidth > el.clientWidth + 1) {
      signaler(el, `${decrire(el)} défile horizontalement (${el.scrollWidth} px pour ${el.clientWidth} px)`);
    }
    // Contenu coupé : boîte qui masque son débordement sans points de suspension. Un champ de saisie actif n'en est
    // pas un : son texte défile sous le curseur (un champ désactivé, lui, ne se fait pas défiler : il reste contrôlé).
    const saisieActive = (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && !el.disabled && !el.readOnly;
    if ((st.overflowX === 'hidden' || st.overflowX === 'clip') && st.textOverflow !== 'ellipsis'
      && el.scrollWidth > el.clientWidth + 1 && !saisieActive) {
      signaler(el, `${decrire(el)} : contenu coupé (${el.scrollWidth} px pour ${el.clientWidth} px)`);
    }
    // Champ dont le texte affiché dépasse.
    if ((el.tagName === 'BUTTON' || el.tagName === 'SELECT') && el.scrollWidth > el.clientWidth + 1 && st.textOverflow !== 'ellipsis') {
      signaler(el, `${decrire(el)} : libellé plus large que le contrôle (${el.scrollWidth} px pour ${el.clientWidth} px)`);
    }
  }
  return [...new Set(problemes)].slice(0, 15);
}

/**
 * Vocabulaire de la version 1.1 (spécification § 8.1) : aucun ancien libellé à l'écran (texte affiché, noms accessibles,
 * infobulles, textes d'aide, valeurs des champs). Exécuté dans la page ; renvoie les occurrences trouvées.
 * `donnees` : textes saisis par l'utilisateur (noms de fiches, de dossiers…) d'une base reprise, retirés avant le
 * contrôle : une fiche que l'utilisateur a nommée « Entité A 01 » garde son nom, ce n'est pas un libellé de l'interface.
 */
export function controleVocabulaire(donnees = []) {
  // Version 1.2 (§ 9.3) : les « associations » sont devenues des affectations ; plus aucun « associer »,
  // « association », « associé(e)s », « dissocier », « dissociation » à l'écran.
  const interdits = [/Entités? [AB]\b/, /Éléments? [AB]\b/, /R[ée]pertoire [AB]\b/, /Code unique/i, /Code #/, /Groupe \d/, /sans code\b/i,
    /associ/i, /dissoci/i];
  const sansDonnees = (t) => [...donnees].sort((x, y) => y.length - x.length).reduce((s, d) => (d ? s.split(d).join('¤') : s), t);
  const textes = [['texte affiché', sansDonnees(document.body.innerText)]];
  for (const el of document.querySelectorAll('[aria-label], [title], [placeholder], [alt], input, textarea, option')) {
    for (const a of ['aria-label', 'title', 'placeholder', 'alt']) {
      const v = el.getAttribute(a);
      if (v) textes.push([`${a} de <${el.tagName.toLowerCase()}>`, sansDonnees(v)]);
    }
    if ('value' in el && typeof el.value === 'string' && el.value) textes.push([`valeur de <${el.tagName.toLowerCase()}>`, sansDonnees(el.value)]);
  }
  textes.push(['titre de la fenêtre', document.title]);
  const trouves = [];
  for (const [ou, t] of textes) {
    for (const re of interdits) {
      const m = re.exec(t);
      if (m) trouves.push(`« ${t.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, ' ')} » (${ou})`);
    }
  }
  return [...new Set(trouves)].slice(0, 10);
}

/**
 * Zones à remplir à la main (§ 9.2) dans le papier du document, pour le média courant (écran ou `print` émulé) :
 * l'application remplace le papier, rien ne doit inviter à écrire au stylo. Exécuté dans la page ; renvoie les problèmes.
 * - aucun trait pointillé ou tireté ;
 * - aucune ligne de tableau vide (ni texte ni valeur saisie) ;
 * - aucun cadre vide : élément sans texte ni contrôle qui dessine une bordure ou un fond (ligne, cadre de signature) ;
 * - à l'impression : aucun champ de saisie visible qui dessine un trait ou un cadre, aucune zone de texte vide encadrée.
 */
export function controleZonesManuscrites() {
  const problemes = [];
  const papier = document.querySelector('.paper');
  if (!papier) return ['Aucun papier dans la page'];
  const impression = matchMedia('print').matches;
  const decrire = (el) => {
    const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).join('.')}` : '';
    const lib = el.closest('.p-bloc, .p-sig')?.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) ?? '';
    return `<${el.tagName.toLowerCase()}${cls}>${lib ? ` (bloc « ${lib} »)` : ''}`;
  };
  const visible = (el) => {
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return st.display !== 'none' && st.visibility !== 'hidden' && r.width > 1 && r.height > 1;
  };
  const cotes = ['Top', 'Right', 'Bottom', 'Left'];
  const bordure = (st) => cotes.some((c) => parseFloat(st[`border${c}Width`]) > 0 && st[`border${c}Style`] !== 'none' && st[`border${c}Style`] !== 'hidden');
  const fond = (st) => st.backgroundImage !== 'none' || !(st.backgroundColor === 'rgba(0, 0, 0, 0)' || st.backgroundColor === 'transparent');
  const saisie = (el) => el.matches('input:not([type=checkbox]):not([type=radio]), textarea, select');
  const valeur = (el) => [...el.querySelectorAll('input, textarea, select')].some((c) => (c.type === 'checkbox' || c.type === 'radio') || (c.value ?? '').trim());
  for (const el of papier.querySelectorAll('*')) {
    if (!visible(el)) continue;
    const st = getComputedStyle(el);
    if (cotes.some((c) => parseFloat(st[`border${c}Width`]) > 0 && /dotted|dashed/.test(st[`border${c}Style`]))) {
      problemes.push(`Trait pointillé ou tireté : ${decrire(el)}`);
    }
    if (el.tagName === 'TR' && el.closest('tbody')) {
      // « — » (tableau sans ligne, à l'écran) est un contenu ; masqué à l'impression, il n'est plus dans innerText.
      const texteLigne = (el.innerText || '').replace(/\s/g, '');
      if (!texteLigne && !valeur(el)) problemes.push(`Ligne de tableau vide : ${decrire(el)}`);
      continue;
    }
    if (saisie(el)) {
      if (impression && (bordure(st) || fond(st))) problemes.push(`Champ de saisie dessiné à l’impression : ${decrire(el)}`);
      continue;
    }
    if (el.tagName === 'INPUT' || el.closest('table')) continue; // cases à cocher ; cellules : contrôlées ligne par ligne
    const texte = (el.innerText || el.textContent || '').trim();
    const controle = el.querySelector('input, textarea, select, img, svg, canvas');
    if (!texte && !controle && (bordure(st) || fond(st)) && el.getBoundingClientRect().width > 24) {
      problemes.push(`Cadre ou ligne vide (à remplir à la main) : ${decrire(el)}`);
    }
  }
  return [...new Set(problemes)].slice(0, 15);
}

/**
 * Feuille d'impression (média `print` émulé) : seul le papier du document doit être visible.
 * Les ancêtres de `.paper` restent affichés mais aplatis ; tout le reste doit être masqué.
 */
export function controleImpression() {
  const problemes = [];
  const papiers = [...document.querySelectorAll('.paper')];
  if (papiers.length !== 1) return [`${papiers.length} élément(s) .paper dans la page (1 attendu)`];
  const papier = papiers[0];
  const rp = papier.getBoundingClientRect();
  if (rp.width === 0 || rp.height === 0) problemes.push('Le papier est invisible à l’impression.');
  for (const el of document.body.querySelectorAll('*')) {
    const st = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (st.display === 'none' || st.visibility === 'hidden' || r.width === 0 || r.height === 0) continue;
    if (papier.contains(el)) {
      if (el.closest('.no-print')) problemes.push(`Élément d’écran imprimé dans le papier : <${el.tagName.toLowerCase()}> « ${(el.textContent || '').trim().slice(0, 40)} »`);
      if (el.tagName === 'SELECT' && st.appearance !== 'none') problemes.push('La flèche d’une liste déroulante est imprimée');
      continue;
    }
    if (el.contains(papier)) {
      // Ancêtre : il ne doit rien dessiner (ni fond, ni bordure, ni ombre).
      if (st.backgroundImage !== 'none' || (st.backgroundColor !== 'rgba(0, 0, 0, 0)' && st.backgroundColor !== 'transparent')
        || parseFloat(st.borderTopWidth) > 0 || st.boxShadow !== 'none') {
        problemes.push(`Ancêtre du papier dessiné à l’impression : <${el.tagName.toLowerCase()} class="${el.className}">`);
      }
      continue;
    }
    problemes.push(`Visible à l’impression hors du papier : <${el.tagName.toLowerCase()} class="${typeof el.className === 'string' ? el.className : ''}"> « ${(el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 50)} »`);
  }
  return [...new Set(problemes)].slice(0, 15);
}
