// Appels au back Tauri. Chaque fonction appelle la commande du même nom en snake_case.
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type { Api, ApiError, BlocDocument, Entite, FicheSupprimee, Kind } from './types';

export type * from './types';

/**
 * Événement émis par le back vers la fenêtre à la première demande de fermeture : envoyer la saisie
 * en attente, puis appeler `destroy()` sur la fenêtre. Sans réponse, le back détruit la fenêtre
 * au bout de 3,5 s. Les demandes suivantes, pendant ce délai, sont ignorées (fenetre.rs, `GardeFermeture`) :
 * elles ne coupent pas l'envoi de la dernière saisie.
 */
export const EVENEMENT_FERMETURE = 'fermeture-demandee';

/** Noms des variables proposées dans le Studio (§ 8.5), dans l'ordre d'affichage. Le back accepte exactement ceux-ci. */
export const VARIABLES = [
  'Employé · Nom', 'Employé · Prénom', 'Employé · Poste', 'Employé · Structure', 'Employé · Identifiant',
  'Machine · Nom', 'Machine · Identifiant', 'Machine · Marque et modèle', 'Machine · Processeur',
  'Machine · RAM', 'Machine · Stockage', 'Date du jour',
] as const;

/** Anciens noms de variables (version 1.0), encore reconnus dans les modèles et documents existants. */
export const VARIABLES_ANCIENNES: Readonly<Record<string, (typeof VARIABLES)[number]>> = {
  'Entité A · Nom': 'Employé · Nom',
  'Entité A · Code': 'Employé · Identifiant',
  'Entité B · Nom': 'Machine · Nom',
  'Entité B · Code unique': 'Machine · Identifiant',
};

/**
 * Bornes appliquées par le back (§ 8.5 et audit) : au-delà, l'enregistrement est refusé avec le code 'saisie_invalide'.
 * Le front peut s'en servir pour limiter la saisie.
 */
export const BORNES_BLOCS = {
  optionsMin: 2, optionsMax: 12, optionLongueurMax: 200,
  colonnesMin: 1, colonnesMax: 8, colonnesParDefaut: 3,
  identifiantMachineMax: 40,
} as const;

/** § 10.1 : palette fermée des couleurs d'état, dans l'ordre d'affichage. Le back refuse toute autre valeur. */
export const COULEURS = ['gris', 'bleu', 'turquoise', 'vert', 'ambre', 'orange', 'rouge', 'rose', 'violet'] as const;

/**
 * § 10.6 : types de bloc qui peuvent porter `obligatoire: true`. Sur les autres ('titre', 'texte', 'variable'),
 * le back ignore la propriété et ne la renvoie pas.
 */
export const BLOCS_DE_SAISIE = [
  'champ', 'zone', 'date', 'case', 'choix', 'tableau', 'magasin', 'employe', 'machine', 'signature',
] as const;

/** § 11.1 : libellés des deux blocs que porte tout fichier importé (dans cet ordre, au-dessus de l'aperçu). */
export const BLOCS_FICHIER_IMPORTE = { employe: 'Employé concerné', machine: 'Machine concernée' } as const;

/**
 * § 11.1 : fiches dont un document tire ses variables « Employé · … » et « Machine · … ». Pour chaque répertoire, c'est
 * la fiche désignée par le premier bloc `employe` (resp. `machine`) du document qui désigne une fiche de ce répertoire
 * présente dans `fiches` ; un bloc vide, ou qui désigne une fiche inconnue, est sauté. null s'il n'y en a pas : les
 * variables correspondantes valent alors « — ». La migration 005 s'appuie sur cette règle exacte pour que les variables
 * des documents existants gardent leur valeur.
 * `fiches` : en général DossierDetail.entitesCitees (qui contient toutes les fiches désignées par les blocs des documents
 * enregistrés du dossier, archivées comprises), complétées si besoin par une fiche choisie et pas encore enregistrée.
 *
 * § 13.2 (1.5) : un bloc sans fiche (entiteId null) qui porte `ficheSupprimee` du bon répertoire compte comme désignant
 * cette fiche supprimée : les variables gardent les valeurs qu'elles affichaient. La fiche renvoyée est alors
 * construite par `entiteDeFicheSupprimee` : id 0 (jamais l'id d'une vraie fiche), actif false. Ne jamais en faire un lien.
 */
export function fichesDesVariables(
  blocs: readonly BlocDocument[] | null,
  fiches: readonly Entite[],
): { a: Entite | null; b: Entite | null } {
  const trouver = (t: 'employe' | 'machine', kind: Kind): Entite | null => {
    for (const bloc of blocs ?? []) {
      if (bloc.t !== t) continue;
      if (typeof bloc.entiteId !== 'number') {
        const s = bloc.ficheSupprimee;
        if (s && typeof s === 'object' && s.kind === kind) return entiteDeFicheSupprimee(s);
        continue;
      }
      const fiche = fiches.find((e) => e.id === bloc.entiteId && e.kind === kind);
      if (fiche) return fiche;
    }
    return null;
  };
  return { a: trouver('employe', 'a'), b: trouver('machine', 'b') };
}

/**
 * § 13.2 (1.5) : Entite équivalente à la copie d'une fiche supprimée, pour les fonctions qui attendent une Entite
 * (valeurs des variables). id 0 et categorieId 0 (n'existent pas en base), actif false, creeLe = majLe = supprimeeLe.
 */
export function entiteDeFicheSupprimee(s: FicheSupprimee): Entite {
  return {
    id: 0, kind: s.kind, nom: s.nom, code: s.code, libelle: s.libelle, categorieId: 0, categorie: s.categorie,
    actif: false, creeLe: s.supprimeeLe, majLe: s.supprimeeLe, prenom: s.prenom, dateNaissance: s.dateNaissance,
    poste: s.poste, marque: s.marque, cpu: s.cpu, ram: s.ram, stockage: s.stockage,
  };
}

/** Vrai si la valeur a la forme { code, message } d'une erreur renvoyée par le back. */
export function estApiError(e: unknown): e is ApiError {
  return typeof e === 'object' && e !== null
    && typeof (e as { code?: unknown }).code === 'string'
    && typeof (e as { message?: unknown }).message === 'string';
}

/** Convertit n'importe quelle erreur rejetée par invoke en ApiError. */
export function versApiError(e: unknown): ApiError {
  if (estApiError(e)) return { code: e.code, message: e.message };
  if (typeof e === 'string') return { code: 'interne', message: e };
  if (e instanceof Error) return { code: 'interne', message: e.message };
  return { code: 'interne', message: 'Une erreur inattendue est survenue.' };
}

async function appeler<T>(commande: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(commande, args);
  } catch (e) {
    throw versApiError(e);
  }
}

export const api: Api = {
  // paramètres et système
  parametresLire: () => appeler('parametres_lire'),
  parametreDefinir: (cle, valeur) => appeler('parametre_definir', { cle, valeur }),
  infosSysteme: () => appeler('infos_systeme'),
  dossierDonneesOuvrir: () => appeler('dossier_donnees_ouvrir'),
  donneesReinitialiser: (mode) => appeler('donnees_reinitialiser', { mode }),
  // classement
  themesLister: () => appeler('themes_lister'),
  themeCreer: (nom) => appeler('theme_creer', { nom }),
  themeBasculer: (id) => appeler('theme_basculer', { id }),
  themeRenommer: (id, nom) => appeler('theme_renommer', { id, nom }),
  themeSupprimer: (id) => appeler('theme_supprimer', { id }),
  categoriesLister: (kind) => appeler('categories_lister', { kind }),
  categorieCreer: (kind, nom) => appeler('categorie_creer', { kind, nom }),
  categorieBasculer: (id) => appeler('categorie_basculer', { id }),
  categorieRenommer: (id, nom) => appeler('categorie_renommer', { id, nom }),
  categorieSupprimer: (id) => appeler('categorie_supprimer', { id }),
  magasinLister: () => appeler('magasin_lister'),
  magasinCreer: (nom) => appeler('magasin_creer', { nom }),
  magasinBasculer: (id) => appeler('magasin_basculer', { id }),
  magasinRenommer: (id, nom) => appeler('magasin_renommer', { id, nom }),
  magasinSupprimer: (id) => appeler('magasin_supprimer', { id }),
  // fiches
  entitesLister: (kind) => appeler('entites_lister', { kind }),
  entiteFiche: (id) => appeler('entite_fiche', { id }),
  entiteCreer: (saisie) => appeler('entite_creer', { saisie }),
  entiteModifier: (id, saisie) => appeler('entite_modifier', { id, saisie }),
  entiteDefinirCode: (id, code) => appeler('entite_definir_code', { id, code }),
  identifiantEmployeApercu: (saisie, idExistant) => appeler('identifiant_employe_apercu', { saisie, idExistant }),
  entitesSuggerer: (kind, q) => appeler('entites_suggerer', { kind, q }),
  entiteBasculer: (id) => appeler('entite_basculer', { id }),
  entiteSuppressionApercu: (id) => appeler('entite_suppression_apercu', { id }),
  entiteSupprimer: (id) => appeler('entite_supprimer', { id }),
  associationCreer: (aId, bId) => appeler('association_creer', { aId, bId }),
  associationRetirer: (aId, bId) => appeler('association_retirer', { aId, bId }),
  // dossiers
  dossiersLister: () => appeler('dossiers_lister'),
  dossierDetail: (id) => appeler('dossier_detail', { id }),
  dossierNomSuggere: (annee) => appeler('dossier_nom_suggere', { annee }),
  // états de dossier
  statutsLister: () => appeler('statuts_lister'),
  statutCreer: (nom, couleur) => appeler('statut_creer', { nom, couleur }),
  statutModifier: (id, saisie) => appeler('statut_modifier', { id, saisie }),
  statutSupprimer: (id) => appeler('statut_supprimer', { id }),
  dossierCreer: (saisie) => appeler('dossier_creer', { saisie }),
  dossierRenommer: (id, nom) => appeler('dossier_renommer', { id, nom }),
  dossierDefinirStatut: (id, statutId) => appeler('dossier_definir_statut', { id, statutId }),
  dossierDefinirTheme: (id, themeId) => appeler('dossier_definir_theme', { id, themeId }),
  dossierSuppressionApercu: (id) => appeler('dossier_suppression_apercu', { id }),
  dossierSupprimer: (id) => appeler('dossier_supprimer', { id }),
  sousDossierCreer: (dossierId, parentId, nom) => appeler('sous_dossier_creer', { dossierId, parentId, nom }),
  sousDossierRenommer: (id, nom) => appeler('sous_dossier_renommer', { id, nom }),
  sousDossierSupprimer: (id) => appeler('sous_dossier_supprimer', { id }),
  optionCreer: (dossierId, nom) => appeler('option_creer', { dossierId, nom }),
  optionCocher: (id, ok) => appeler('option_cocher', { id, ok }),
  optionSupprimer: (id) => appeler('option_supprimer', { id }),
  // documents
  documentCreerDepuisModele: (dossierId, sousDossierId, modeleId, pieceFinale) =>
    appeler('document_creer_depuis_modele', { dossierId, sousDossierId, modeleId, pieceFinale }),
  documentImporter: (dossierId, sousDossierId, pieceFinale) =>
    appeler('document_importer', { dossierId, sousDossierId, pieceFinale }),
  documentRenommer: (id, nom) => appeler('document_renommer', { id, nom }),
  documentDefinirDate: (id, date) => appeler('document_definir_date', { id, date }),
  documentEnregistrerBlocs: (id, blocs) => appeler('document_enregistrer_blocs', { id, blocs }),
  documentSupprimer: (id) => appeler('document_supprimer', { id }),
  documentOuvrirExterne: (id) => appeler('document_ouvrir_externe', { id }),
  documentExporter: (id) => appeler('document_exporter', { id }),
  // modèles
  modelesLister: () => appeler('modeles_lister'),
  modeleCreer: () => appeler('modele_creer'),
  modeleDupliquer: (id) => appeler('modele_dupliquer', { id }),
  modeleEnregistrer: (id, saisie) => appeler('modele_enregistrer', { id, saisie }),
  modeleBasculer: (id) => appeler('modele_basculer', { id }),
  modeleSupprimer: (id) => appeler('modele_supprimer', { id }),
  modelesStandardsRestaurer: () => appeler('modeles_standards_restaurer'),
  // transverses
  recherche: (q) => appeler('recherche', { q }),
  tableauDeBord: () => appeler('tableau_de_bord'),
};

/**
 * URL utilisable dans <img> et <iframe> pour un fichier importé
 * (protocole asset de Tauri, portée limitée au dossier fichiers/ des données).
 * `chemin` est le `fichierChemin` d'un DocumentFichier.
 */
export function fichierUrl(chemin: string): string {
  return convertFileSrc(chemin);
}
