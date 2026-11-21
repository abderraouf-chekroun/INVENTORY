// Recherche globale et raccourcis ; feuille d'impression ; tour de tous les écrans
// (captures en clair et en sombre à 1280 × 800, mise en page à 1280 × 800 et 1024 × 640).

import { attendreTitre, bouton, champChoix, menu, modale, ouvrirDossier, ouvrirFiche, titre } from '../outils/ui.mjs';
import { attendre, controleImpression, controleMiseEnPage, controleVocabulaire, egal, verifier } from '../outils/verifs.mjs';
import { NOM_DOSSIER } from './dossiers.mjs';
import { EMPLOYE, FORME_ID, MACHINE, MACHINE_SANS_ID, recap } from './fiches.mjs';

const liste = (page) => page.locator('#dd');

/** Attend que la liste affiche les résultats de `q` (et non ceux d'une frappe intermédiaire : aria-busy). */
async function attendreResultats(page, q) {
  await attendre(async () => (await liste(page).isVisible()) && (await liste(page).getAttribute('aria-busy')) === 'false'
    && (await liste(page).locator('.info').innerText()).startsWith(`Résultats pour « ${q} »`),
    `La liste doit afficher les résultats pour « ${q} »`);
}

export const recherche = {
  id: 'recherche-raccourcis',
  titre: 'Recherche globale, Ctrl+K, ↑ ↓ Entrée, Échap, Alt+←',
  async executer(ctx) {
    const { page } = ctx;
    await menu(page, 'Tableau de bord');

    egal(await page.locator('#q').getAttribute('placeholder'), 'Rechercher un nom ou un identifiant…', 'Texte d’aide de la recherche');

    ctx.etape('Ctrl+K, un identifiant de machine tapé puis Entrée aussitôt (avant l’arrivée des résultats)');
    await page.keyboard.press('Control+k');
    await attendre(() => page.evaluate(() => document.activeElement?.id === 'q'), 'Ctrl+K doit placer le curseur dans la recherche');
    await page.keyboard.type('PC-0106');
    await page.keyboard.press('Enter');
    await attendreTitre(page, 'PC secrétariat');
    await page.keyboard.press('Alt+ArrowLeft');
    await attendreTitre(page, 'Tableau de bord');

    ctx.etape('identifiant d’employé exact (en minuscules) : fiche présélectionnée, Entrée ouvre la bonne homonyme');
    const codeBenali = ctx.memo.codes['BENALI Sofia'];
    await page.keyboard.press('Control+k');
    await page.keyboard.type(codeBenali.toLowerCase());
    await attendreResultats(page, codeBenali.toLowerCase());
    egal(await liste(page).locator('.grp h4').allTextContents(), ['Employés · 1'], 'Seule la fiche de cet identifiant est trouvée');
    const active = liste(page).locator('.res.on');
    egal([(await active.locator('b').innerText()).trim(), (await active.locator('.mono').innerText()).trim()],
      ['BENALI Sofia', codeBenali], 'Fiche présélectionnée par l’identifiant exact');
    verifier((await liste(page).locator('.info').innerText()).includes('identifiant exact'), 'Le bandeau doit signaler l’identifiant exact');
    await ctx.capture('recherche/identifiant-exact');
    await page.keyboard.press('Enter');
    await attendreTitre(page, 'BENALI Sofia');
    egal((await recap(page)).Identifiant, codeBenali, 'C’est la fiche de l’identifiant exact qui s’ouvre');
    verifier(!(await liste(page).isVisible()), 'La liste se ferme après l’ouverture');

    ctx.etape('Alt+← revient à la page précédente');
    await page.keyboard.press('Alt+ArrowLeft');
    await attendreTitre(page, 'Tableau de bord');

    ctx.etape('par nom, prénom, identifiant d’employé, identifiant et marque de machine (casse et accents ignorés)');
    const chercher = async (q) => {
      await page.keyboard.press('Control+k');
      await page.keyboard.press('Control+a');
      await page.keyboard.type(q);
      await attendreResultats(page, q);
      return liste(page).locator('.grp').evaluateAll((gs) => gs.map((g) => [g.getAttribute('aria-label').split(' : ')[0],
        [...g.querySelectorAll('.res b')].map((b) => b.textContent.trim())]));
    };
    egal(await chercher('zenith'), [['Employés', [EMPLOYE.libelle]]], 'Recherche par nom');
    egal(await chercher('AMEL'), [['Employés', [EMPLOYE.libelle]]], 'Recherche par prénom');
    egal(await chercher('leila'), [['Employés', ['MANSOURI Leïla']]], 'Recherche sans accent');
    egal(await chercher(ctx.memo.codes.kaci.slice(0, 9).toLowerCase()), [['Employés', ['KACI Rania']]], 'Recherche par identifiant d’employé (début, en minuscules)');
    egal(await chercher('lt-0105'), [['Machines', ['Portable direction']]], 'Recherche par identifiant de machine');
    const dell = await chercher('Dell');
    egal([dell.length, dell[0][0], dell[0][1].slice().sort()], [1, 'Machines', ['PC accueil', MACHINE, 'PC secrétariat'].sort()], 'Recherche par marque');
    const e2e = await chercher('e2e');
    egal(e2e.map((g) => g[0]), ['Machines', 'Dossiers'], 'Groupes pour « e2e »');
    egal(e2e[0][1].slice().sort(), [MACHINE, MACHINE_SANS_ID].sort(), 'Machines pour « e2e »');
    verifier(e2e[1][1].includes(NOM_DOSSIER), 'Le dossier e2e est trouvé');
    await page.keyboard.press('Escape');

    ctx.etape('recherche par nom : tous les dossiers trouvés (plus de limite à 4), titre du groupe avec le nombre, ↑ ↓');
    const nbDossiers = (await ctx.app.appeler('dossiers_lister')).filter((d) => /dossier/i.test(d.nom)).length;
    verifier(nbDossiers > 4 && nbDossiers <= 50, `Il faut entre 5 et 50 dossiers nommés « Dossier… » (${nbDossiers})`);
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Dossier');
    await attendreResultats(page, 'Dossier');
    const groupes = await liste(page).locator('.grp h4').allTextContents();
    egal(groupes, [`Dossiers · ${nbDossiers}`], 'Groupes pour « Dossier » (tous les dossiers)');
    egal(await liste(page).locator('.res').count(), nbDossiers, 'Un résultat par dossier');
    egal(await liste(page).locator('.res.on').count(), 1, 'Un résultat actif');
    const premier = (await liste(page).locator('.res.on b').innerText()).trim();
    await page.keyboard.press('ArrowDown');
    const second = (await liste(page).locator('.res.on b').innerText()).trim();
    verifier(second !== premier, '↓ doit passer au résultat suivant');
    await page.keyboard.press('ArrowUp');
    egal((await liste(page).locator('.res.on b').innerText()).trim(), premier, '↑ revient au premier résultat');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await attendreTitre(page, second);

    ctx.etape('Échap ferme la liste');
    await page.keyboard.press('Control+k');
    await page.keyboard.type('e2e');
    await attendreResultats(page, 'e2e');
    const noms = await liste(page).locator('.res b').allInnerTexts();
    verifier(noms.includes(MACHINE) && noms.includes(MACHINE_SANS_ID) && noms.includes(NOM_DOSSIER),
      `Résultats pour « e2e » : ${noms.join(', ')}`);
    await page.keyboard.press('Escape');
    await attendre(async () => !(await liste(page).isVisible()), 'Échap doit fermer la liste');
    verifier(await page.evaluate(() => document.activeElement?.id !== 'q'), 'Échap rend le focus à la page');
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Control+a');
    await page.keyboard.type('zzz');
    await attendre(async () => (await liste(page).innerText()).includes('Aucun résultat pour « zzz »'), 'Message « Aucun résultat »');
    await page.keyboard.press('Escape');

    ctx.etape('fenêtre modale : Échap la ferme, Ctrl+K et Alt+← sont neutralisés');
    await ouvrirDossier(page, NOM_DOSSIER);
    await page.locator('.folder.add').click();
    await attendre(() => modale(page).isVisible(), 'La fenêtre « Ajouter » ne s’ouvre pas');
    await page.keyboard.press('Control+k');
    verifier(await page.evaluate(() => document.activeElement?.id !== 'q'), 'Ctrl+K ne doit pas agir sous une fenêtre modale');
    await page.keyboard.press('Alt+ArrowLeft');
    egal(await titre(page), NOM_DOSSIER, 'Alt+← ne doit pas changer de page sous une fenêtre modale');
    await page.keyboard.press('Escape');
    await attendre(async () => !(await modale(page).count()), 'Échap doit fermer la fenêtre modale');
    await page.keyboard.press('Alt+ArrowLeft');
    await attendre(async () => (await titre(page)) !== NOM_DOSSIER, 'Alt+← doit revenir en arrière une fois la fenêtre fermée');
  },
};

export const impression = {
  id: 'impression',
  titre: 'Impression : bouton, feuille d’impression limitée au papier',
  async executer(ctx) {
    const { page } = ctx;
    for (const doc of ['Document_01', 'Document_02', ...(ctx.memo.imports ?? []).slice(0, 1)]) {
      ctx.etape(`document ${doc}`);
      await ouvrirDossier(page, NOM_DOSSIER, doc);
      // window.print() ouvrirait la boîte native et bloquerait la suite : on la remplace par un compteur.
      await page.evaluate(() => {
        window.__impressions = 0;
        window.print = () => { window.__impressions += 1; };
      });
      await page.locator('.preview .pv-h').getByRole('button', { name: 'Imprimer', exact: true }).click();
      egal(await page.evaluate(() => window.__impressions), 1, '« Imprimer » appelle window.print() une fois');
      await page.emulateMedia({ media: 'print' });
      try {
        const problemes = await page.evaluate(controleImpression);
        await ctx.capture(`impression/${doc}`);
        verifier(problemes.length === 0, `Feuille d’impression de ${doc} : ${problemes.join(' ; ')}`);
      } finally {
        await page.emulateMedia({ media: null });
      }
    }
  },
};

/**
 * Les écrans de l'application, chacun avec le chemin pour l'atteindre depuis la barre latérale.
 * `fin` remet l'interface dans son état ordinaire après la capture.
 */
function ecrans(ctx) {
  const annee = new Date().getFullYear();
  return [
    { nom: '01-tableau-de-bord', aller: (p) => menu(p, 'Tableau de bord') },
    { nom: '02-employes', aller: (p) => menu(p, 'Employés') },
    { nom: '03-machines', aller: (p) => menu(p, 'Machines') },
    { nom: '04-fiche-employe', aller: (p) => ouvrirFiche(p, 'a', 'BENALI Sofia', ctx.memo.codes['BENALI Sofia']) },
    { nom: '05-fiche-employe-a-completer', aller: (p) => ouvrirFiche(p, 'a', 'DJEBBAR Samia') },
    { nom: '06-fiche-machine', aller: (p) => ouvrirFiche(p, 'b', 'PC accueil') },
    { nom: '06b-fiche-machine-sans-identifiant', aller: (p) => ouvrirFiche(p, 'b', 'PC atelier') },
    { nom: '07-fiche-archivee', aller: (p) => ouvrirFiche(p, 'a', 'LEFÈVRE Thomas') },
    {
      nom: '08-formulaire-employe', aller: async (p) => {
        await menu(p, 'Création');
        await p.locator('.hubcard', { hasText: 'Créer un employé' }).click();
        await attendreTitre(p, 'Créer un employé');
        await p.fill('#n-nom', 'Belkacem');
        await p.fill('#n-prenom', 'Lina');
        await p.fill('#n-naissance', '1988-12-03');
        await p.fill('#n-poste', 'Archiviste');
        await attendre(async () => FORME_ID.test((await p.locator('.id-apercu b').innerText()).trim()), 'L’aperçu de l’identifiant ne s’affiche pas');
      },
    },
    {
      nom: '08b-formulaire-machine', aller: async (p) => {
        await menu(p, 'Création');
        await p.locator('.hubcard', { hasText: 'Créer une machine' }).click();
        await attendreTitre(p, 'Créer une machine');
      },
    },
    {
      nom: '09-modifier-fiche', aller: async (p) => {
        await ouvrirFiche(p, 'a', EMPLOYE.libelle);
        await bouton(p, 'Modifier la fiche').click();
        await attendreTitre(p, 'Modifier la fiche');
        await attendre(() => p.locator('#n-nom').isVisible(), 'Le formulaire de modification ne s’affiche pas');
      },
    },
    { nom: '10-dossiers-groupes', aller: (p) => menu(p, 'Dossiers & Archives') },
    {
      nom: '11-dossiers-arborescence', aller: async (p) => {
        await menu(p, 'Dossiers & Archives');
        await p.locator('.seg button', { hasText: 'Arborescence' }).click();
        const deplier = p.getByRole('button', { name: `Déplier ${NOM_DOSSIER}` });
        if (await deplier.count()) await deplier.click();
        await p.waitForTimeout(300);
      },
      fin: async (p) => p.locator('.seg button', { hasText: 'Groupes' }).click(),
    },
    { nom: '12-dossier-document', aller: (p) => ouvrirDossier(p, NOM_DOSSIER, 'Document_01') },
    { nom: '13-dossier-tableau', aller: (p) => ouvrirDossier(p, NOM_DOSSIER, 'Document_02') },
    ...(ctx.memo.imports ?? []).map((d, i) => ({
      nom: `${14 + i}-dossier-${i ? 'pdf' : 'image'}`,
      aller: async (p) => {
        await ouvrirDossier(p, NOM_DOSSIER, d);
        await p.waitForTimeout(800);
      },
    })),
    { nom: '16-dossier-piece-manquante', aller: (p) => ouvrirDossier(p, `Dossier ${annee}-02`) },
    { nom: '17-dossier-cloture', aller: (p) => ouvrirDossier(p, `Dossier ${annee}-01`) },
    {
      nom: '18-sous-dossier', aller: async (p) => {
        await ouvrirDossier(p, `Dossier ${annee - 1}-01`);
        await p.locator('.folder.sub', { hasText: 'Demandes' }).click();
        await attendreTitre(p, 'Demandes');
      },
    },
    {
      nom: '19-ajouter', aller: async (p) => {
        await ouvrirDossier(p, NOM_DOSSIER);
        await p.locator('.folder.add').click();
        await p.waitForTimeout(200);
      },
      fin: (p) => p.keyboard.press('Escape'),
    },
    {
      nom: '20-ajouter-fichier', aller: async (p) => {
        await ouvrirDossier(p, NOM_DOSSIER);
        await p.locator('.folder.add').click();
        await modale(p).locator('.choice', { hasText: 'Un fichier' }).click();
        await p.waitForTimeout(200);
      },
      fin: (p) => p.keyboard.press('Escape'),
    },
    {
      nom: '21-formulaire-dossier', aller: async (p) => {
        await menu(p, 'Dossiers & Archives');
        await bouton(p, 'Créer un dossier').click();
        await attendreTitre(p, 'Créer un dossier');
        await p.waitForTimeout(300);
      },
    },
    {
      // § 11.1 : l'aide à la saisie d'une fiche se trouve dans les blocs Employé / Machine d'un document (rien n'est enregistré :
      // le changement est annulé par Échap).
      nom: '21b-aide-a-la-saisie', aller: async (p) => {
        await ouvrirDossier(p, NOM_DOSSIER, 'Document_01');
        await bouton(p, `Changer Utilisateur (${EMPLOYE.libelle})`).click();
        await champChoix(p, 'Utilisateur').pressSequentially('ben', { delay: 40 });
        await attendre(async () => (await p.getByRole('listbox', { name: 'Propositions : Utilisateur' }).getByRole('option').count()) === 2,
          'Les propositions ne s’affichent pas');
        await p.waitForTimeout(200);
      },
      fin: async (p) => {
        for (let i = 0; i < 3; i++) await p.keyboard.press('Escape');
      },
    },
    { nom: '22-creation', aller: (p) => menu(p, 'Création') },
    {
      nom: '23-studio', aller: async (p) => {
        await menu(p, 'Création');
        await p.locator('.hubcard', { hasText: 'Modèles de document' }).click();
        await attendreTitre(p, 'Modèles de document');
        await p.locator('.mitem', { hasText: 'Fiche pour formatage PC' }).click();
        await attendre(async () => (await p.inputValue('#m-nom')) === 'Fiche pour formatage PC', 'Le modèle ne s’ouvre pas');
      },
    },
    {
      nom: '23b-studio-modele-e2e', aller: async (p) => {
        await menu(p, 'Création');
        await p.locator('.hubcard', { hasText: 'Modèles de document' }).click();
        await attendreTitre(p, 'Modèles de document');
        await p.locator('.mitem', { has: p.locator('b', { hasText: /^Modèle e2e$/ }) }).click();
        await attendre(async () => (await p.inputValue('#m-nom')) === 'Modèle e2e', 'Le modèle ne s’ouvre pas');
      },
    },
    {
      nom: '24-magasin', aller: async (p) => {
        await menu(p, 'Création');
        await p.locator('.hubcard', { hasText: 'Magasin' }).click();
        await attendreTitre(p, 'Magasin');
      },
    },
    { nom: '25-parametres', aller: (p) => menu(p, 'Paramètres') },
    {
      nom: '26-recherche', aller: async (p) => {
        await menu(p, 'Tableau de bord');
        await p.keyboard.press('Control+k');
        await p.keyboard.type('Port');
        await attendre(() => p.locator('#dd').isVisible(), 'La recherche ne s’ouvre pas');
        await p.waitForTimeout(200);
      },
      fin: (p) => p.keyboard.press('Escape'),
    },
  ];
}

/** Choisit le thème dans Paramètres 6.1 (comme un utilisateur). */
export async function choisirAffichage(page, { theme, densite }) {
  await menu(page, 'Paramètres');
  if (theme) await page.getByRole('group', { name: 'Thème' }).getByRole('button', { name: theme, exact: true }).click();
  if (densite) await page.getByRole('group', { name: 'Densité des tableaux' }).getByRole('button', { name: densite, exact: true }).click();
  await page.waitForTimeout(300);
}

/** Taille de rendu imposée par CDP (indépendante de l'écran de la machine), facteur d'échelle 1. */
const taille = (ctx, largeur, hauteur) => ctx.app.imposerTaille(largeur, hauteur);

export const toursDesEcrans = {
  id: 'ecrans',
  titre: 'Chaque écran, en clair et en sombre : console propre, mise en page 1280 × 800 et 1024 × 640, vocabulaire 1.1 et 1.2, captures',
  async executer(ctx) {
    const { page } = ctx;
    const problemes = [];
    try {
      for (const [theme, libelle] of [['clair', 'Clair'], ['sombre', 'Sombre']]) {
        await taille(ctx, 1280, 800);
        await choisirAffichage(page, { theme: libelle });
        egal(await page.evaluate(() => document.documentElement.dataset.theme), theme === 'clair' ? 'light' : 'dark', 'Thème appliqué');
        for (const e of ecrans(ctx)) {
          ctx.etape(`${e.nom} (${theme})`);
          await taille(ctx, 1280, 800);
          // Recherche vidée : une saisie laissée par un scénario précédent n'a rien à faire sur les captures.
          if (await page.inputValue('#q')) {
            await page.fill('#q', '');
            await page.keyboard.press('Escape');
          }
          await e.aller(page);
          await page.evaluate(() => { document.getElementById('content').scrollTop = 0; });
          await page.waitForTimeout(150);
          await ctx.capture(`ecrans/${e.nom}-${theme}`);
          for (const p of await page.evaluate(controleMiseEnPage)) problemes.push(`${e.nom} (${theme}, 1280 × 800) : ${p}`);
          for (const p of await page.evaluate(controleVocabulaire)) problemes.push(`${e.nom} (${theme}) : ancien vocabulaire ${p}`);
          if (theme === 'clair') {
            await taille(ctx, 1024, 640);
            const p1024 = await page.evaluate(controleMiseEnPage);
            for (const p of p1024) problemes.push(`${e.nom} (1024 × 640) : ${p}`);
            await ctx.capture(`ecrans-1024x640/${e.nom}`);
            if (p1024.length) {
              // Capture du premier élément fautif, encadré en rouge.
              await page.evaluate(() => {
                const el = document.querySelector('[data-e2e-probleme]');
                el?.scrollIntoView({ block: 'center' });
                el?.style.setProperty('outline', '2px solid red');
              });
              await ctx.capture(`ecrans-1024x640/${e.nom}-probleme`);
              await page.evaluate(() => document.querySelector('[data-e2e-probleme]')?.style.removeProperty('outline'));
            }
          }
          await e.fin?.(page);
        }
      }
    } finally {
      await taille(ctx, 0, 0);
      await choisirAffichage(page, { theme: 'Clair' });
    }
    verifier(problemes.length === 0, `Mise en page :\n       - ${problemes.join('\n       - ')}`);
  },
};
