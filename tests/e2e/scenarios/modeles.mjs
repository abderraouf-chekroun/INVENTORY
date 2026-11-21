// Les quatre modèles standards (§ 8.6) : présents sous leur nom dans le Studio ; un document créé depuis chacun,
// rempli dans chaque type de champ, blocs Employé / Machine vides puis choisis (§ 11.1) ; rendu à l'écran et
// feuille d'impression capturés ; fermeture, relance, et chaque valeur relue à l'écran et dans le back.

import {
  attendreTitre, bouton, carteChoisie, casePapier, champChoix, champPapier, choixPapier, detailsCarte, menu, ouvrirDocument, ouvrirDossier, taperDansChoix,
} from '../outils/ui.mjs';
import { attendre, controleImpression, controleZonesManuscrites, egal, verifier } from '../outils/verifs.mjs';
import { aujourdhui } from './affectations.mjs';
import { BESOINS, DETAILS_MACHINE, detailsEmploye, FORMATAGE, IDENTIFICATION, INTERVENTION, NOM_DOSSIER, ajouterDepuisModele, documentDuBack } from './dossiers.mjs';
import { EMPLOYE, MACHINE } from './fiches.mjs';

const an = new Date().getFullYear();

/**
 * Plan de remplissage de chaque modèle standard, dans l'ordre du papier.
 * champ / zone / date : valeur saisie ; case : cochée ; choix : options retenues ; tableau : lignes ;
 * employe / machine : fiche choisie dans le bloc (l'employé et la machine e2e), informations affichées.
 */
export const PLANS = [
  {
    modele: BESOINS, slug: 'etat-des-besoins',
    titres: ['ÉTAT DES BESOINS'], intertitres: [],
    signatures: [['Visa du demandeur', 'Visa du responsable hiérarchique', 'Visa du directeur général']],
    signer: ['Visa du demandeur', 'Visa du responsable hiérarchique'],
    saisie: [
      { t: 'champ', v: 'Division', val: 'Division informatique' },
      { t: 'choix', v: 'Départ ou arrivée', choisis: ['Arrivée'], effacerPuis: ['Départ'] },
      { t: 'tableau', cols: ['N°', 'Désignation', 'Qté', 'Observations'], rows: [['1', 'Barrette mémoire 16 Go', '2', 'Pour PC e2e'], ['2', 'Câble HDMI 2 m', '1', '']] },
      { t: 'zone', v: 'Motif de l’acquisition', val: 'Extension de la mémoire.\nRemplacement du câble défectueux.' },
      { t: 'choix', v: 'Nature de la demande', choisis: ['Achat', 'Magasin'], multiple: true },
    ],
  },
  {
    modele: INTERVENTION, slug: 'fiche-intervention',
    titres: ['FICHE D’INTERVENTION INFORMATIQUE'], intertitres: ['SIGNATURES'],
    signatures: [['Chef du département maintenance', 'Intervenant', 'Utilisateur']],
    signer: ['Intervenant'],
    saisie: [
      { t: 'case', v: 'Intervention urgente' },
      { t: 'champ', v: 'Signalée par', val: 'Service du courrier' },
      { t: 'choix', v: 'Type de matériel', choisis: ['Unité centrale', 'Imprimante'], multiple: true },
      { t: 'employe', v: 'Utilisateur' },
      { t: 'champ', v: 'N° de poste', val: '3310' },
      { t: 'machine', v: 'Matériel' },
      { t: 'champ', v: 'N° de série', val: 'SN-E2E-0001' },
      { t: 'zone', v: 'Défauts signalés', val: 'Le PC s’éteint seul.' },
      { t: 'zone', v: 'Défauts constatés', val: 'Ventilateur encrassé.\nTempérature élevée.' },
      { t: 'zone', v: 'Tâches effectuées', val: 'Nettoyage, pâte thermique remplacée.' },
      { t: 'champ', v: 'Noms des intervenants', val: 'Équipe e2e' },
      { t: 'date', v: 'Début d’intervention', val: `${an}-02-03T08:30` },
      { t: 'date', v: 'Fin d’intervention', val: `${an}-02-03T11:45` },
      { t: 'case', v: 'Matériel testé en état de marche' },
      { t: 'champ', v: 'Ouverture de la session (domaine)', val: 'DOMAINE\\zenith' },
    ],
  },
  {
    modele: IDENTIFICATION, slug: 'fiche-identification',
    titres: ['FICHE D’IDENTIFICATION'], intertitres: ['ATTRIBUTION D’UNE BOÎTE DE MESSAGERIE PROFESSIONNELLE'],
    signatures: [['Signature', 'Cachet de la structure / division']],
    signer: ['Signature'],
    saisie: [
      { t: 'employe', v: 'Bénéficiaire' },
      { t: 'champ', v: 'Adresse mail', val: 'amel.zenith@exemple.org' },
      { t: 'date', v: 'Date d’ouverture', val: `${an}-02-10` },
    ],
  },
  {
    modele: FORMATAGE, slug: 'fiche-formatage',
    titres: ['FICHE POUR FORMATAGE PC'],
    // « Configuration matérielle » suit directement un intertitre : il s'affiche en sous-titre (sans capitales).
    intertitres: ['INFORMATIONS GÉNÉRALES', 'INFORMATIONS DU PC AVANT FORMATAGE', 'Configuration matérielle', 'AUTRE APPLICATION', 'SIGNATURE'],
    signatures: [['RSSI', 'Intervenant', 'Utilisateur']],
    signer: ['RSSI'],
    saisie: [
      { t: 'employe', v: 'Utilisateur' },
      { t: 'champ', v: 'N° de poste', val: '2201' },
      { t: 'choix', v: 'Demandeur', choisis: ['Utilisateur'] },
      { t: 'choix', v: 'Formatage nécessaire (cause, réservé à l’intervenant)', choisis: ['Mauvaise manipulation', 'Dysfonctionnement de l’OS'], multiple: true },
      { t: 'champ', v: 'Autre cause', val: 'Mise à jour interrompue' },
      { t: 'zone', v: 'Motifs', val: 'Démarrage impossible.\nÉcran bleu répété.' },
      { t: 'machine', v: 'PC' },
      { t: 'champ', v: 'N° de série', val: 'SN-E2E-0002' },
      { t: 'champ', v: 'Partition de l’OS', val: 'C: 256 Go' },
      { t: 'champ', v: 'OS installé', val: 'Windows 11 Professionnel' },
      { t: 'champ', v: 'Licence de l’OS', val: 'OEM' },
      { t: 'champ', v: 'Antivirus installé', val: 'Defender' },
      { t: 'choix', v: 'PC connecté au réseau', choisis: ['Oui'] },
      { t: 'choix', v: 'Mode de connexion', choisis: ['Local'] },
      { t: 'champ', v: 'Nom de l’application', val: 'LibreOffice' },
      { t: 'choix', v: 'Licence', choisis: ['Open source'] },
      { t: 'choix', v: 'Données sauvegardées', choisis: ['Documents utilisateur', 'Autres données spécifiques'], multiple: true },
      { t: 'zone', v: 'Autres données spécifiques (précisions)', val: 'Dossier « Mesures 2025 ».' },
      { t: 'champ', v: 'Nom de l’intervenant', val: 'Équipe e2e' },
      { t: 'date', v: 'Date d’entrée', val: `${an}-02-12` },
      { t: 'date', v: 'Date de sortie', val: `${an}-02-14` },
    ],
  },
];

const options = (page, s) => choixPapier(page, s.v).locator('input');

/** Case « {libellé} : Signé » d'une signature du papier (§ 9.2). */
export const caseSignature = (page, libelle) => page.locator('.paper').getByRole('checkbox', { name: `${libelle} : Signé`, exact: true });

/** Signatures du papier affiché : [[libellé, cochée, description (« Signé le … » / « Non signé »)]]. */
export async function etatSignatures(page) {
  return page.locator('.paper .p-sig').evaluateAll((sigs) => sigs.map((s) => {
    const c = s.querySelector('input[type=checkbox]');
    const desc = c ? (c.getAttribute('aria-describedby') ?? '').split(/\s+/).map((id) => document.getElementById(id)?.textContent.trim() ?? '').join(' ') : null;
    return [s.querySelector('.p-sig-lib')?.textContent.trim() ?? '', c ? c.checked : null, desc];
  }));
}

/** Signatures attendues : celles de `signees` cochées le `jour`, les autres non signées. */
const signaturesAttendues = (plan, signees, jour) => plan.signatures.flat().map((l) => (signees.includes(l) ? [l, true, `Signé le ${jour}`] : [l, false, 'Non signé']));

/** Date du jour au format des horodatages du back (AAAA-MM-JJ). */
const jourIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Signatures dans le back : [[libellé, ok, date (AAAA-MM-JJ) ou null]]. */
const signaturesBack = (doc) => doc.blocs.filter((b) => b.t === 'signature').map((b) => [b.v, b.ok === true, b.val ? String(b.val).slice(0, 10) : null]);
const signaturesBackAttendues = (plan, signees) => plan.signatures.flat().map((l) => (signees.includes(l) ? [l, true, jourIso()] : [l, false, null]));

/**
 * Aucune zone à remplir à la main (§ 9.2) dans le document affiché, à l'écran puis en média `print`
 * (feuille d'impression à la largeur d'une page A4). Renvoie les problèmes, préfixés par le média.
 */
async function zonesManuscrites(ctx) {
  const { page, app } = ctx;
  const problemes = (await page.evaluate(controleZonesManuscrites)).map((p) => `écran : ${p}`);
  try {
    await page.emulateMedia({ media: 'print' });
    await app.imposerTaille(673, 1000);
    problemes.push(...(await page.evaluate(controleZonesManuscrites)).map((p) => `impression : ${p}`));
  } finally {
    await page.emulateMedia({ media: null });
    await app.imposerTaille(0, 0);
  }
  return problemes;
}

/** Remplit le papier affiché selon le plan, comme un utilisateur. */
async function remplir(page, plan) {
  for (const s of plan.saisie) {
    switch (s.t) {
      case 'champ':
      case 'zone':
      case 'date':
        await champPapier(page, s.v).fill(s.val);
        break;
      case 'case':
        await casePapier(page.locator('.paper'), s.v).check();
        break;
      case 'choix': {
        const role = s.multiple ? 'checkbox' : 'radio';
        egal(await options(page, s).evaluateAll((xs) => [...new Set(xs.map((x) => x.type))]), [role], `Type des options de « ${s.v} »`);
        for (const o of s.choisis) await choixPapier(page, s.v).getByRole(role, { name: o, exact: true }).check();
        if (s.effacerPuis) {
          // Choix unique : « Effacer le choix » vide la réponse, puis une autre option est retenue.
          await page.getByRole('button', { name: `Effacer le choix : ${s.v}` }).click();
          egal(await options(page, s).evaluateAll((xs) => xs.filter((x) => x.checked).length), 0, `« Effacer le choix : ${s.v} »`);
          for (const o of s.effacerPuis) await choixPapier(page, s.v).getByRole(role, { name: o, exact: true }).check();
        }
        break;
      }
      case 'tableau':
        egal(await page.locator('.paper .p-table th:not(.no-print)').allTextContents(), s.cols, 'En-têtes du tableau');
        for (let i = 0; i < s.rows.length; i++) await bouton(page, 'Ajouter une ligne').click();
        for (const [ri, r] of s.rows.entries()) {
          for (const [ci, x] of r.entries()) if (x) await page.getByLabel(`${s.cols[ci]}, ligne ${ri + 1}`, { exact: true }).fill(x);
        }
        break;
      case 'employe':
      case 'machine': {
        // § 11.1 : plus de préremplissage par le dossier ; la fiche est choisie dans le bloc (vérifiée par relire()).
        egal(await champChoix(page, s.v).inputValue(), '', `Bloc « ${s.v} » vide dans un nouveau document`);
        const [texte, nomFiche] = s.t === 'employe' ? ['zeni', EMPLOYE.libelle] : ['pc-e2e', MACHINE];
        egal((await taperDansChoix(page, s.v, texte)).map((p) => p.nom), [nomFiche], `Proposition pour « ${texte} » (${s.v})`);
        await page.keyboard.press('Enter');
        await attendre(() => carteChoisie(page, s.v).isVisible(), `La fiche choisie dans « ${s.v} » ne s’affiche pas`);
        break;
      }
      default:
        throw new Error(`Type de saisie inconnu : ${s.t}`);
    }
  }
}

/** Valeurs finales attendues de chaque bloc saisi. */
const choisisFinaux = (s) => s.effacerPuis ?? s.choisis;

/** Informations attendues du bloc Employé (identifiant propre à la base de test), posées au début du scénario. */
const DETAILS_EMPLOYE = { courant: null };

/** Relit à l'écran chaque valeur du plan ; renvoie la liste des écarts. */
async function relire(page, plan) {
  const ecarts = [];
  const comparer = (obtenu, attendu, quoi) => {
    if (JSON.stringify(obtenu) !== JSON.stringify(attendu)) ecarts.push(`${quoi} : attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`);
  };
  for (const s of plan.saisie) {
    switch (s.t) {
      case 'champ':
      case 'zone':
      case 'date':
        comparer(await champPapier(page, s.v).inputValue(), s.val, `« ${s.v} »`);
        break;
      case 'case':
        comparer(await casePapier(page.locator('.paper'), s.v).isChecked(), true, `Case « ${s.v} »`);
        break;
      case 'choix':
        comparer(await options(page, s).evaluateAll((xs) => xs.filter((x) => x.checked).map((x) => x.labels[0]?.textContent.trim())),
          choisisFinaux(s), `Liste « ${s.v} »`);
        break;
      case 'tableau':
        comparer(await page.locator('.paper .p-table tbody tr').evaluateAll((trs) => trs.map((tr) =>
          [...tr.querySelectorAll('input')].map((i) => i.value))), s.rows, 'Lignes du tableau');
        break;
      case 'employe':
        comparer(await detailsCarte(page, s.v), DETAILS_EMPLOYE.courant, `Bloc Employé « ${s.v} »`);
        break;
      case 'machine':
        comparer(await detailsCarte(page, s.v), DETAILS_MACHINE, `Bloc Machine « ${s.v} »`);
        break;
    }
  }
  return ecarts;
}

/** Contrôle dans le back : chaque bloc saisi porte la valeur attendue. */
function ecartsBack(doc, plan, ids) {
  const ecarts = [];
  for (const s of plan.saisie) {
    const b = s.t === 'tableau' ? doc.blocs.find((x) => x.t === 'tableau') : doc.blocs.find((x) => x.t === s.t && x.v === s.v);
    if (!b) {
      ecarts.push(`bloc ${s.t} « ${s.v} » absent`);
      continue;
    }
    const obtenu = { champ: b.val, zone: b.val, date: b.val, case: b.ok, choix: b.choisis, tableau: b.rows, employe: b.entiteId, machine: b.entiteId }[s.t];
    const attendu = { champ: s.val, zone: s.val, date: s.val, case: true, choix: choisisFinaux(s), tableau: s.rows, employe: ids.a, machine: ids.b }[s.t];
    if (JSON.stringify(obtenu) !== JSON.stringify(attendu)) ecarts.push(`${s.t} « ${s.v ?? ''} » : attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`);
  }
  return ecarts;
}

/** Capture du document affiché à l'écran (fenêtre agrandie à la hauteur du contenu) et de sa feuille d'impression. */
export async function capturerDocument(ctx, nom) {
  const { page, app } = ctx;
  try {
    const h = await page.evaluate(() => document.getElementById('content').scrollHeight);
    await app.imposerTaille(1280, Math.min(h + 120, 8000));
    await page.evaluate(() => { document.getElementById('content').scrollTop = 0; });
    await ctx.capture(`${nom}-ecran`);
    await page.emulateMedia({ media: 'print' });
    // Largeur utile d'une feuille A4 aux marges de la feuille d'impression (210 − 2 × 16 mm ≈ 673 px).
    await app.imposerTaille(673, 1000);
    const hp = await page.evaluate(() => document.documentElement.scrollHeight);
    await app.imposerTaille(673, Math.min(hp, 8000));
    await ctx.capture(`${nom}-impression`);
    const problemes = await page.evaluate(controleImpression);
    problemes.push(...(await page.evaluate(controleZonesManuscrites)).map((p) => `zone à remplir à la main : ${p}`));
    return problemes;
  } finally {
    await page.emulateMedia({ media: null });
    await app.imposerTaille(0, 0);
  }
}

export const modelesStandards = {
  id: 'modeles-standards',
  titre: 'Modèles standards : présents, un document par modèle rempli, écran et impression, relus après relance',
  async executer(ctx) {
    let { page, app } = ctx;
    verifier(ctx.memo.dossier, 'Ce scénario utilise le dossier créé par le scénario « dossiers ».');
    DETAILS_EMPLOYE.courant = detailsEmploye(ctx);
    const jour = aujourdhui();

    ctx.etape('Studio : les quatre modèles standards, sous leur nom, dans « Support informatique »');
    await menu(page, 'Création');
    await page.locator('.hubcard', { hasText: 'Modèles de document' }).click();
    await attendreTitre(page, 'Modèles de document');
    const liste = await page.$$eval('.mlist .mitem', (xs) => xs.map((x) => [x.querySelector('b').textContent.trim(), x.querySelector('small').textContent.trim()]));
    egal(liste.slice(0, 4), PLANS.map((p) => [p.modele, 'Support informatiqueStandard · Actif']), 'Modèles standards dans le Studio');
    const back = (await app.appeler('modeles_lister')).filter((m) => m.standard).map((m) => [m.nom, m.theme, m.actif]);
    egal(back, PLANS.map((p) => [p.modele, 'Support informatique', true]), 'Modèles standards dans le back');

    ctx.memo.documentsStandards = [];
    for (const [i, plan] of PLANS.entries()) {
      ctx.etape(`« ${plan.modele} » : document créé, rempli, contrôlé, capturé`);
      await ouvrirDossier(page, NOM_DOSSIER);
      const nom = await ajouterDepuisModele(page, plan.modele);
      egal(await page.locator('.paper .p-titre').allInnerTexts(), plan.titres, `Titre du papier (${plan.modele})`);
      egal(await page.locator('.paper .p-intertitre').allInnerTexts(), plan.intertitres, `Intertitres (${plan.modele})`);
      egal(await page.locator('.paper .p-sigs').evaluateAll((gs) => gs.map((g) => [...g.querySelectorAll('.p-sig .p-sig-lib')].map((s) => s.textContent.trim()))),
        plan.signatures, `Signatures côte à côte (${plan.modele})`);
      egal(await etatSignatures(page), signaturesAttendues(plan, [], jour), `Signatures d’un nouveau document : non signées (${plan.modele})`);
      const vierge = await zonesManuscrites(ctx);
      verifier(vierge.length === 0, `Zones à remplir à la main dans « ${plan.modele} » vierge : ${vierge.join(' ; ')}`);
      await remplir(page, plan);

      // Signatures (§ 9.2) : case « Signé » cochée, date posée par le back, affichée « Signé le JJ/MM/AAAA ».
      for (const l of plan.signer) await caseSignature(page, l).check();
      await attendre(async () => JSON.stringify(await etatSignatures(page)) === JSON.stringify(signaturesAttendues(plan, plan.signer, jour)),
        `Signatures cochées : « Signé le ${jour} » (${plan.modele})`);
      const ecrans = await relire(page, plan);
      verifier(ecrans.length === 0, `Saisie relue à l’écran (${plan.modele}) : ${ecrans.join(' ; ')}`);
      const doc = await attendre(async () => {
        const d = await documentDuBack(app, ctx.memo.dossier, nom);
        return ecartsBack(d, plan, ctx.memo).length === 0
          && JSON.stringify(signaturesBack(d)) === JSON.stringify(signaturesBackAttendues(plan, plan.signer)) ? d : false;
      }, `La saisie et les signatures de « ${plan.modele} » doivent être enregistrées dans le back`);
      verifier(doc.blocs.filter((b) => b.t === 'signature' && b.ok).every((b) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(b.val)),
        `Date de signature posée par le back (horodatage) : ${JSON.stringify(signaturesBack(doc))}`);
      ctx.memo.datesSignatures ??= {};
      ctx.memo.datesSignatures[nom] = doc.blocs.filter((b) => b.t === 'signature').map((b) => b.val ?? null);
      egal(doc.source, plan.modele, 'Source du document');
      ctx.memo.documentsStandards.push({ nom, plan: i });
      const problemes = await capturerDocument(ctx, `modeles/${i + 1}-${plan.slug}`);
      verifier(problemes.length === 0, `Feuille d’impression de « ${plan.modele} » : ${problemes.join(' ; ')}`);
    }

    ctx.etape('fermer l’application, la relancer');
    await page.locator('.titlebar .ctl').getByRole('button', { name: 'Fermer', exact: true }).click({ noWaitAfter: true });
    egal(await app.attendreFin(15_000), 0, 'Code de sortie à la fermeture');
    await app.deconnecter();
    app = await ctx.lancer();
    page = app.page;

    for (const { nom, plan: i } of ctx.memo.documentsStandards) {
      const plan = PLANS[i];
      ctx.etape(`après relance : « ${plan.modele} » (${nom}) relu`);
      await ouvrirDossier(page, NOM_DOSSIER, nom);
      await page.waitForTimeout(200);
      const ecarts = await relire(page, plan);
      verifier(ecarts.length === 0, `Après relance (${plan.modele}) : ${ecarts.join(' ; ')}`);
      const d = await documentDuBack(app, ctx.memo.dossier, nom);
      const eb = ecartsBack(d, plan, ctx.memo);
      verifier(eb.length === 0, `Après relance, dans le back (${plan.modele}) : ${eb.join(' ; ')}`);
      egal(await etatSignatures(page), signaturesAttendues(plan, plan.signer, jour), `Après relance, signatures cochées avec leur date (${plan.modele})`);
      egal(d.blocs.filter((b) => b.t === 'signature').map((b) => b.val ?? null), ctx.memo.datesSignatures[nom],
        `Après relance, date des signatures inchangée dans le back (${plan.modele})`);
    }

    ctx.etape('décocher une signature : « Non signé », date effacée ; capture signées / non signées');
    const { nom: nomBesoins, plan: iBesoins } = ctx.memo.documentsStandards[0];
    const besoins = PLANS[iBesoins];
    await ouvrirDocument(page, nomBesoins);
    await caseSignature(page, 'Visa du responsable hiérarchique').uncheck();
    const restantes = besoins.signer.filter((l) => l !== 'Visa du responsable hiérarchique');
    await attendre(async () => JSON.stringify(await etatSignatures(page)) === JSON.stringify(signaturesAttendues(besoins, restantes, jour)),
      'La signature décochée affiche « Non signé »');
    await attendre(async () => JSON.stringify(signaturesBack(await documentDuBack(app, ctx.memo.dossier, nomBesoins)))
      === JSON.stringify(signaturesBackAttendues(besoins, restantes)), 'Signature décochée dans le back : ok faux, sans date');
    const sansDate = (await documentDuBack(app, ctx.memo.dossier, nomBesoins)).blocs.find((b) => b.v === 'Visa du responsable hiérarchique');
    verifier(sansDate.ok === false && (sansDate.val === undefined || sansDate.val === null || sansDate.val === ''),
      `La date d’une signature décochée est effacée : ${JSON.stringify(sansDate)}`);
    await page.locator('.paper .p-sigs').first().scrollIntoViewIfNeeded();
    await ctx.capture('v12-reel/06-document-signatures');
    await ouvrirDocument(page, 'Document_01');
  },
};
