// Contrat front <-> back (spécification § 5, complétée par le § 8.8 de la version 1.1, le § 9.5 de la version 1.2,
// le § 10.7 de la version 1.3, le § 11.6 de la version 1.4, le § 13.4 de la version 1.5, le § 15.3 de la version 1.6
// et le § 16 de la version 1.7).
// Ne rien renommer ni retirer.

export type Kind = 'a' | 'b';                    // 'a' = employé, 'b' = machine
/** Rôles des trois états fournis (version 1.0 à 1.2). Depuis la 1.3, voir RoleStatut et StatutDossier. */
export type Statut = 'cours' | 'piece' | 'clos';
/**
 * Rôle d'un état de dossier (§ 10.1) : 'cours' En cours, 'piece' Pièce manquante (clôture interdite),
 * 'clos' Clôturé (lecture seule), 'perso' état ajouté par l'utilisateur (dossier ouvert, modifiable).
 */
export type RoleStatut = 'cours' | 'piece' | 'clos' | 'perso';
/** Palette fermée des couleurs d'état (§ 10.1) ; toute autre valeur est refusée par le back ('saisie_invalide'). */
export type Couleur = 'gris' | 'bleu' | 'turquoise' | 'vert' | 'ambre' | 'orange' | 'rouge' | 'rose' | 'violet';
/**
 * État de dossier. Les trois états fournis (role ≠ 'perso') ne se renomment pas, ne changent pas de couleur et ne se
 * suppriment pas. nbDossiers : nombre de dossiers qui portent cet état.
 */
export interface StatutDossier { id: number; nom: string; couleur: Couleur; role: RoleStatut; nbDossiers: number }
export type TypeBloc =
  | 'titre' | 'texte' | 'champ' | 'zone' | 'date' | 'case' | 'choix' | 'tableau'
  | 'magasin' | 'variable' | 'employe' | 'machine' | 'signature';
export interface ApiError { code: string; message: string }

export interface Classement { id: number; nom: string; actif: boolean }          // thème, mot-clé du Magasin
/**
 * § 16 (1.7) : thème (appelé « catégorie » à l'écran) tel que le renvoie themesLister, avec le nombre de dossiers et de
 * modèles de document (actifs et archivés) qui lui appartiennent ; themeSupprimer n'est possible qu'à 0 et 0.
 */
export interface ThemeClassement extends Classement { nbDossiers: number; nbModeles: number }
/**
 * § 17 (1.8) : mot-clé du Magasin tel que le renvoie magasinLister, avec le nombre de documents (dossiers ouverts et
 * clôturés) dont un bloc « Choix du Magasin » a pour valeur exactement ce nom.
 */
export interface MotCleMagasin extends Classement { nbDocuments: number }
export interface Categorie extends Classement {                                  // 'a' : structure ; 'b' : type de machine
  kind: Kind;
  nbFiches: number;                   // fiches actives et archivées qui appartiennent à la catégorie (§ 9.1)
}
export interface Entite {
  id: number; kind: Kind; nom: string; code: string | null;   // identifiant : généré (employé) ou saisi (machine)
  libelle: string;                                             // employé : « NOM Prénom » ; machine : nom
  categorieId: number; categorie: string; actif: boolean; creeLe: string; majLe: string;
  prenom: string; dateNaissance: string | null; poste: string;  // employé ; vides pour une machine
  marque: string; cpu: string; ram: string; stockage: string;   // machine ; vides pour un employé
}
/** Fiche d'employé. dateNaissance au format AAAA-MM-JJ, ou null. L'identifiant est calculé par le back. */
export type SaisieEmploye = { kind: 'a'; nom: string; prenom: string; dateNaissance: string | null; poste: string; categorieId: number };
/** Fiche de machine. code : identifiant libre de 1 à 40 caractères, ou null. */
export type SaisieMachine = { kind: 'b'; nom: string; code: string | null; marque: string; cpu: string; ram: string; stockage: string; categorieId: number };
/** Ce qui sert à calculer l'identifiant d'un employé (aperçu en direct dans le formulaire). */
export interface SaisieIdentifiantEmploye { nom: string; prenom: string; dateNaissance: string | null; poste: string }
export interface DossierResume {
  id: number; nom: string; annee: number; themeId: number; theme: string;
  statut: StatutDossier;                                 // § 10.1 : l'état complet (nom, couleur, rôle)
  // § 11.1 : plus d'employé ni de machine rattachés (aId, aNom, bId, bNom retirés).
  nbFichiers: number; nbSousDossiers: number;            // nbSousDossiers = sous-dossiers de premier niveau
  nbOptions: number; nbOptionsCochees: number;
  creeLe: string; majLe: string; closLe: string | null;
}
export interface SousDossier { id: number; dossierId: number; parentId: number | null; nom: string }
/**
 * obligatoire (§ 10.6) : conservé seulement sur les blocs de saisie (voir BLOCS_DE_SAISIE dans index.ts) et seulement
 * s'il vaut true ; ignoré sur 'titre', 'texte' et 'variable'. Informatif : n'empêche ni l'enregistrement ni la clôture.
 */
export interface BlocModele {
  t: TypeBloc; v: string; cols?: string[]; options?: string[]; multiple?: boolean; heure?: boolean; niveau?: 1 | 2;
  obligatoire?: boolean;
}
/**
 * Bloc 'signature' (§ 9.2) : ok = signé ou non (toujours présent dans un document renvoyé par le back) ;
 * val = horodatage « AAAA-MM-JJ HH:MM:SS » de la signature, posé par le back quand ok passe à vrai, conservé tant
 * que la case reste cochée, absent sinon. Le val envoyé par le front pour une signature est toujours ignoré.
 */
export interface BlocDocument extends BlocModele {
  val?: string; ok?: boolean; rows?: string[][]; choisis?: string[]; entiteId?: number | null;
  /**
   * § 13.2 (1.5) : bloc 'employe' / 'machine' dont la fiche a été supprimée. Présent seulement quand entiteId vaut null.
   * Le bloc ne mène plus nulle part : afficher en texte non cliquable `libelle` (et `code` s'il existe, « Sans
   * identifiant » sinon), suivi de la mention « fiche supprimée ». Les variables du document continuent de lire ces
   * valeurs (voir fichesDesVariables dans index.ts).
   * Si le dossier n'est pas clôturé, l'utilisateur peut choisir une autre fiche dans le bloc : envoyer alors
   * entiteId = id de la nouvelle fiche ; le back retire ficheSupprimee. Avec entiteId null, le back conserve la copie
   * qu'il a enregistrée, quelle que soit la valeur de ficheSupprimee envoyée par le front (inutile de la modifier).
   */
  ficheSupprimee?: FicheSupprimee;
}
/**
 * § 13.2 (1.5) : copie, prise au moment de la suppression, de la fiche qu'un bloc 'employe' / 'machine' désignait.
 * Mêmes champs et mêmes valeurs que l'Entite d'alors, sans son id (la fiche n'existe plus ; un nouvel id peut être
 * réattribué à une autre fiche). supprimeeLe : AAAA-MM-JJ HH:MM:SS.
 */
export interface FicheSupprimee {
  kind: Kind; nom: string; code: string | null; libelle: string; categorie: string;
  prenom: string; dateNaissance: string | null; poste: string;
  marque: string; cpu: string; ram: string; stockage: string;
  supprimeeLe: string;
}
export interface DocumentFichier {
  id: number; dossierId: number; sousDossierId: number | null; nom: string;
  origine: 'modele' | 'import'; source: string; dateDoc: string;
  /**
   * § 11.1 : un fichier importé a désormais toujours deux blocs, dans cet ordre : { t: 'employe', v: 'Employé concerné' }
   * et { t: 'machine', v: 'Machine concernée' } (voir BLOCS_FICHIER_IMPORTE), enregistrés par documentEnregistrerBlocs
   * comme ceux d'un document issu d'un modèle. Distinguer un import par `origine`, jamais par `blocs === null`.
   * null ne reste possible que dans DocumentLie (liste du profil).
   */
  blocs: BlocDocument[] | null;
  fichierNom: string | null;                                // nom d'origine, à afficher seulement (ne rien en déduire)
  fichierChemin: string | null;                             // chemin absolu de la copie, null si aucune copie valide
  apercu: Apercu;                                           // décidé par le back d'après le contenu réel de la copie
  ouvrable: boolean;                                        // vrai si documentOuvrirExterne accepterait d'ouvrir la copie
  pieceFinale: boolean; creeLe: string;
  /**
   * § 11.4 : modèle dont le document a été créé. null pour un fichier importé, et pour un document ancien dont le
   * modèle n'a pas pu être retrouvé sans ambiguïté à la migration 005.
   */
  modeleId: number | null;
}
/** Aperçu possible d'un document importé : 'image' → <img>, 'pdf' → <iframe>, 'aucun' → pas d'aperçu. */
export type Apercu = 'image' | 'pdf' | 'aucun';
export interface OptionDossier { id: number; dossierId: number; nom: string; ok: boolean }
export interface DossierDetail {
  dossier: DossierResume;
  // § 11.1 : a et b retirés.
  sousDossiers: SousDossier[];        // tous les niveaux, à plat
  documents: DocumentFichier[];       // tous les documents du dossier, à plat
  options: OptionDossier[];
  /**
   * § 11.1 : fiches nommées dans au moins un document du dossier (bloc employe / machine ou nom écrit dans une valeur,
   * table des nominations), archivées comprises ; employés puis machines, par libellé.
   */
  entitesCitees: Entite[];
}
export interface Modele {
  id: number; nom: string; themeId: number; theme: string; actif: boolean;
  blocs: BlocModele[]; creeLe: string; majLe: string;
  standard?: boolean;                 // ajout : vrai pour l'un des quatre modèles standards (§ 8.6), toujours envoyé par le back
  nbDocuments: number;                // § 11.4 : documents créés à partir de ce modèle ; modeleSupprimer n'est possible qu'à 0
}
export type TypeEvenement =
  | 'fiche_creee' | 'fiche_modifiee' | 'code_saisi' | 'fiche_archivee' | 'fiche_reactivee'
  | 'association' | 'dissociation'          // § 9.3 : début et fin d'une affectation (noms techniques inchangés)
  | 'dossier_ouvert' | 'dossier_rouvert' | 'piece_manquante' | 'piece_ajoutee' | 'dossier_clos'
  // ajouts 1.3 :
  | 'statut_modifie'          // changement d'état libre entre états ouverts (hors passage en « Pièce manquante », clôture, réouverture)
  | 'dossier_fiches'          // 1.3 seulement : rattachement d'un dossier modifié. Plus produit depuis la 1.4, mais conservé
                              // dans le journal des bases existantes (§ 11.5) : peut encore apparaître dans un historique.
  | 'identifiant_recalcule'   // migration 004 : « Ancien identifiant : … » (journal de la fiche)
  // ajout 1.4 (§ 11.2) ; 'document_cite' disparaît :
  | 'nomination'              // fiche nommée dans un document, lu dans la table des nominations (id négatif, jamais stocké au journal)
  // ajout 1.5 (§ 13.2) :
  | 'fiche_supprimee'         // « Employé « NOM Prénom » supprimé » / « Machine « Nom » supprimée » ; journal général seulement,
                              // jamais dans l'historique d'une fiche (aId, bId, dossierId null) ; aSupprime ou bSupprime vrai.
  // ajout 1.6 (§ 15) :
  | 'dossier_supprime';       // « Dossier « Nom » supprimé », détail « Il contenait N document(s) où cet employé était nommé. » /
                              // « … où cette machine était nommée. » ; dans l'historique de chaque fiche nommée dans un document du
                              // dossier, rattaché à elle seule (aId ou bId) : dossierId, documentId null, rien n'est cliquable.
/**
 * Événement d'une frise.
 * § 11.2, type 'nomination' : titre « Nommé dans {modèle} : {document} » (modèle = « Fichier importé » pour un import), date = moment où la
 * nomination est apparue (AAAA-MM-JJ HH:MM:SS), champ = libellé du bloc (ou de la colonne du tableau) où la fiche est nommée,
 * detail = « Champ « {champ} » » (« Champ sans libellé » si le libellé est vide), documentId / documentNom / dossierId / dossierNom renseignés ; aId ou bId = la fiche.
 * Une fiche nommée dans deux champs d'un même document donne deux événements. id négatif, unique dans la liste.
 * Les événements d'un dossier (ouverture, changement d'état, clôture…) apparaissent aussi dans la frise des fiches nommées
 * dans ses documents ; leur aId / bId sont alors ceux enregistrés au journal (souvent null depuis la 1.4).
 */
export interface Evenement {
  id: number; type: TypeEvenement; classe: '' | 'assoc' | 'clos' | 'alerte';
  titre: string; detail: string; date: string;
  aId: number | null; bId: number | null; dossierId: number | null;
  // § 9.4 : libellés actuels des fiches et du dossier cités (fiche archivée comprise), null si l'id est null ou introuvable
  // (§ 13.2 : sauf fiche supprimée, voir aSupprime / bSupprime : id null et libellé conservé).
  aLibelle: string | null; bLibelle: string | null; dossierNom: string | null;
  // document nommant la fiche (événements 'nomination'), null sinon.
  documentId: number | null; documentNom: string | null;
  champ: string | null;               // § 11.2 : renseigné pour une nomination, null sinon
  /**
   * § 13.2 (1.5) : vrai quand l'employé (aSupprime) ou la machine (bSupprime) cité par l'événement a été supprimé.
   * Dans ce cas aId (resp. bId) vaut null et aLibelle (resp. bLibelle) porte le nom qu'avait la fiche, en texte :
   * à afficher sans lien. La mention est déjà dans le titre des affectations (« Affectation de PC Accueil 01
   * (supprimée) », « Fin de l’affectation de BENALI Sofia (supprimé) ») : ne pas la répéter. Le drapeau sert au style.
   * Toujours présents (false sinon).
   */
  aSupprime: boolean; bSupprime: boolean;
}
/**
 * § 13.2 (1.5) : ce que supprimera entiteSupprimer, avec les nombres réels (fenêtre de confirmation).
 * affectationEnCours : l'autre fiche d'une affectation en cours (la plus récente s'il y en a plusieurs), null sinon ;
 *   id = id de cette autre fiche, nom = son libellé.
 * affectationsEnCours (ajout) : toutes les affectations en cours, de la plus récente à la plus ancienne (une machine
 *   peut être affectée à plusieurs employés) ; affectationEnCours === affectationsEnCours[0] ?? null.
 * nbAffectationsPassees : affectations terminées, qui disparaîtront des affectations de la fiche et de l'autre côté.
 * nbDocuments : documents distincts où la fiche est nommée (bloc ou texte) ; nbDossiers : dossiers distincts de ces
 *   documents (clôturés compris).
 */
export interface SuppressionApercu {
  affectationEnCours: { id: number; nom: string } | null;
  affectationsEnCours: { id: number; nom: string }[];
  nbAffectationsPassees: number;
  nbDocuments: number;
  nbDossiers: number;
}
/**
 * § 15 (1.6) : ce que supprimera dossierSupprimer, avec les nombres réels (fenêtre de confirmation).
 * nbSousDossiers : sous-dossiers, tous niveaux. nbDocuments : documents, sous-dossiers compris.
 * nbFichiersImportes : documents importés dont la copie, présente dans le dossier des données, sera supprimée du disque.
 * nbFichesNommees : employés et machines distincts nommés dans ses documents (bloc ou texte).
 */
export interface DossierSuppressionApercu {
  nbSousDossiers: number;
  nbDocuments: number;          // sous-dossiers compris
  nbFichiersImportes: number;   // documents importés dont la copie sera supprimée du disque
  nbFichesNommees: number;      // employés et machines distincts nommés dans ses documents
}
/**
 * Affectation d'une machine à un employé pendant une période (§ 9.3).
 * entite : la fiche de l'autre côté (la machine sur la fiche d'un employé, l'employé sur celle d'une machine).
 * debut / fin : horodatages AAAA-MM-JJ HH:MM:SS ; fin null = affectation en cours.
 */
export interface Affectation { id: number; entite: Entite; debut: string; fin: string | null }
/**
 * Façon dont une fiche est nommée dans un document (§ 11.1, 'dossier' retiré en 1.4) : 'bloc' un bloc employe / machine
 * la désigne ; 'texte' son nom (employé : nom + prénom) ou son identifiant (machine, mot entier) est écrit dans un champ,
 * une zone ou une cellule de tableau.
 */
export type FaconDeFigurer = 'bloc' | 'texte';
/**
 * Document où une fiche est nommée. modeleNom : nom du modèle d'origine (= source), « Fichier importé » pour un import.
 * facons : sans doublon, dans l'ordre 'bloc', 'texte'. blocs vaut toujours null ici (lire le dossier pour le contenu).
 * champs (§ 11.2) : libellés des blocs où la fiche est nommée (colonne pour une cellule de tableau), sans doublon, du
 * plus anciennement nommé au plus récent, puis par ordre alphabétique ; un libellé vide est renvoyé tel quel ('').
 * depuis : moment (AAAA-MM-JJ HH:MM:SS) de la plus ancienne nomination encore présente de la fiche dans ce document.
 */
export interface DocumentLie extends DocumentFichier {
  dossierNom: string; modeleNom: string; facons: FaconDeFigurer[]; champs: string[]; depuis: string;
}
export interface FicheEntite {
  entite: Entite;
  associees: Entite[];                // fiches des affectations en cours
  affectations: Affectation[];        // en cours d'abord, puis terminées de la plus récente à la plus ancienne
  dossiers: DossierResume[];          // § 11.2 : dossiers qui contiennent un document où elle est nommée
  documents: DocumentLie[];           // § 11.2 : documents où elle est nommée, du plus récent (dateDoc) au plus ancien
  evenements: Evenement[];            // du plus récent au plus ancien, nominations et événements des dossiers liés compris
}
export interface Parametres { theme: 'system' | 'light' | 'dark'; densite: 'eq' | 'compact'; donneesExemple: boolean }
export interface InfosSysteme { version: string; tauri: string; webview: string; dossierDonnees: string; cheminBase: string }
export interface TableauDeBord {
  aActives: number; aTotal: number; bActives: number; bTotal: number;
  dossiersTotal: number;
  dossiersOuverts: number;                                // § 10.1 : tous les dossiers non clôturés
  dossiersPiece: number;                                  // dossiers en « Pièce manquante »
  repartition: { statut: StatutDossier; nb: number }[];   // § 10.7 : un élément par état existant, dans l'ordre de statutsLister
  sansCodeA: Entite[]; sansCodeB: Entite[];
  dossiersEnCours: DossierResume[];                       // tous les dossiers non clôturés
  volume: { annee: number; mois: number[] };             // 12 valeurs, janvier → décembre
}
/** § 10.2 : 50 résultats au plus par groupe ; *Total = nombre réel de correspondances (> longueur du groupe s'il y en a davantage). */
export interface ResultatsRecherche { a: Entite[]; b: Entite[]; dossiers: DossierResume[]; aTotal: number; bTotal: number; dossiersTotal: number }

// Saisies (ajout : alias nommés des objets en ligne du contrat, structurellement identiques).
export type SaisieEntiteCreation = SaisieEmploye | SaisieMachine;
export type SaisieEntiteModification = SaisieEmploye | SaisieMachine;
/** § 11.6 : statutId null = « En cours » (pas « Clôturé ») ; plus d'employé ni de machine. */
export interface SaisieDossier { nom: string; annee: number; themeId: number; statutId: number | null }
export interface SaisieModele { nom: string; themeId: number; blocs: BlocModele[] }
export interface SaisieStatut { nom: string; couleur: Couleur }

export interface Api {
  // paramètres et système
  parametresLire(): Promise<Parametres>;
  parametreDefinir(cle: 'theme' | 'densite', valeur: string): Promise<void>;
  infosSysteme(): Promise<InfosSysteme>;
  dossierDonneesOuvrir(): Promise<void>;
  donneesReinitialiser(mode: 'vide' | 'exemple'): Promise<void>;
  // classement
  themesLister(): Promise<ThemeClassement[]>;                     // § 16 : avec nbDossiers et nbModeles
  themeCreer(nom: string): Promise<Classement>;
  themeBasculer(id: number): Promise<Classement>;                // archive ↔ réactive
  /**
   * § 16 : renomme une catégorie (thème), active ou archivée. Refus : nom vide ou de plus de 200 caractères
   * ('saisie_invalide'), nom déjà porté par une autre catégorie sans tenir compte de la casse ('doublon'),
   * catégorie inexistante ('introuvable'). Le nouveau nom s'applique aussitôt aux dossiers et aux modèles.
   */
  themeRenommer(id: number, nom: string): Promise<Classement>;
  /**
   * § 16 : supprime une catégorie (thème), active ou archivée, seulement si aucun dossier ni aucun modèle de document
   * (actif ou archivé) n'y appartient ; sinon 'categorie_utilisee' avec les nombres dans le message. Inexistante : 'introuvable'.
   */
  themeSupprimer(id: number): Promise<void>;
  categoriesLister(kind: Kind): Promise<Categorie[]>;
  categorieCreer(kind: Kind, nom: string): Promise<Categorie>;
  categorieBasculer(id: number): Promise<Categorie>;
  /** Renomme ; refusé ('doublon') si une autre catégorie du même kind porte déjà ce nom. */
  categorieRenommer(id: number, nom: string): Promise<Categorie>;
  /** Supprime ; refusé ('categorie_utilisee') tant qu'au moins une fiche, active ou archivée, y appartient. */
  categorieSupprimer(id: number): Promise<void>;
  magasinLister(): Promise<MotCleMagasin[]>;                     // § 17 : avec nbDocuments
  magasinCreer(nom: string): Promise<Classement>;
  magasinBasculer(id: number): Promise<Classement>;
  /**
   * § 17 : renomme un mot-clé, actif ou archivé. Refus : nom vide ou de plus de 200 caractères ('saisie_invalide'), nom
   * déjà porté par un autre mot-clé sans tenir compte de la casse ('doublon'), mot-clé inexistant ('introuvable').
   * Les blocs « Choix du Magasin » des documents dont la valeur est exactement l'ancien nom reçoivent le nouveau (dossiers
   * clôturés compris, sans changer leur date de modification).
   */
  magasinRenommer(id: number, nom: string): Promise<MotCleMagasin>;
  /**
   * § 17 : supprime un mot-clé, toujours possible ; les documents qui l'avaient choisi gardent la valeur écrite.
   * Inexistant : 'introuvable'.
   */
  magasinSupprimer(id: number): Promise<void>;
  // fiches
  entitesLister(kind: Kind): Promise<Entite[]>;
  entiteFiche(id: number): Promise<FicheEntite>;
  /**
   * § 10.6 : employé → nom, prénom, date de naissance, poste et structure obligatoires ; machine → nom et type.
   * Champ manquant : erreur 'saisie_invalide' dont le message nomme le premier champ manquant
   * (ordre : nom, prénom, date de naissance, poste, structure).
   */
  entiteCreer(saisie: SaisieEmploye | SaisieMachine): Promise<Entite>;
  /** saisie.kind doit être celui de la fiche (sinon erreur 'saisie_invalide'). Mêmes champs obligatoires qu'à la création. */
  entiteModifier(id: number, saisie: SaisieEmploye | SaisieMachine): Promise<Entite>;
  entiteDefinirCode(id: number, code: string): Promise<Entite>;                  // machines seulement
  /**
   * Identifiant qui serait attribué (null s'il manque une information). idExistant : la fiche modifiée, ou null en création.
   * § 10.5 : forme EMP-XXXXX-XXXXX, alphabet 0-9 A-Z sans I, L, O, U ; ne rien en déduire ni l'afficher avec une explication.
   */
  identifiantEmployeApercu(saisie: SaisieIdentifiantEmploye, idExistant: number | null): Promise<string | null>;
  /** Aide à la saisie : fiches actives, 8 au plus ; saisie vide → liste vide. */
  entitesSuggerer(kind: Kind, q: string): Promise<Entite[]>;
  entiteBasculer(id: number): Promise<Entite>;
  /** § 13.2 : aperçu de la suppression d'une fiche (active ou archivée) ; fiche inexistante : 'introuvable'. */
  entiteSuppressionApercu(id: number): Promise<SuppressionApercu>;
  /**
   * § 13.2 : supprime définitivement la fiche (active ou archivée, affectée ou nommée), en une seule transaction.
   * Ses affectations (en cours et passées) et ses nominations disparaissent ; les blocs qui la désignaient gardent une
   * copie (BlocDocument.ficheSupprimee), dossiers clôturés compris ; les événements partagés avec une autre fiche ou
   * un dossier restent (aSupprime / bSupprime) ; ses autres événements sont supprimés ; un événement
   * 'fiche_supprimee' est ajouté. Fiche inexistante (ou déjà supprimée) : 'introuvable', rien n'est modifié.
   * Ensuite entiteFiche(id) rejette 'introuvable' (« Fiche introuvable. ») : afficher « Cette fiche a été supprimée. ».
   */
  entiteSupprimer(id: number): Promise<void>;
  /** Démarre une affectation (aId : employé, bId : machine). Fiches actives seulement ; refusée si une affectation est déjà en cours. */
  associationCreer(aId: number, bId: number): Promise<void>;
  /** Termine l'affectation en cours ; jamais refusée pour cause de dossier. */
  associationRetirer(aId: number, bId: number): Promise<void>;
  // dossiers
  dossiersLister(): Promise<DossierResume[]>;
  dossierDetail(id: number): Promise<DossierDetail>;
  dossierNomSuggere(annee: number): Promise<string>;
  // états de dossier (§ 10.1)
  /** Tous les états : les trois fournis (cours, piece, clos) puis les états ajoutés par ordre de création. */
  statutsLister(): Promise<StatutDossier[]>;
  /** Refusé : nom vide ('saisie_invalide'), nom déjà pris sans tenir compte de la casse ('doublon'), couleur hors palette ('saisie_invalide'). */
  statutCreer(nom: string, couleur: Couleur): Promise<StatutDossier>;
  /** États ajoutés seulement ('statut_fourni' sinon). Mêmes refus que statutCreer. */
  statutModifier(id: number, saisie: { nom: string; couleur: Couleur }): Promise<StatutDossier>;
  /** États ajoutés seulement ('statut_fourni') ; refusé ('statut_utilise') tant qu'un dossier le porte, avec le nombre. */
  statutSupprimer(id: number): Promise<void>;
  // dossiers
  /** statutId null = « En cours » ; un statutId de rôle 'clos' est refusé ('saisie_invalide'). Aucune affectation démarrée. */
  dossierCreer(saisie: { nom: string; annee: number; themeId: number; statutId: number | null }): Promise<DossierResume>;
  dossierRenommer(id: number, nom: string): Promise<void>;
  /**
   * § 16 : change la catégorie (thème) d'un dossier. Refus : dossier clôturé ('dossier_clos'), catégorie archivée
   * ('theme_archive'), dossier ou catégorie inexistant ('introuvable'). Même catégorie : sans effet.
   */
  dossierDefinirTheme(id: number, themeId: number): Promise<DossierResume>;
  /**
   * § 10.1 : libre entre états ouverts ; vers 'clos' = clôturer (refusé 'transition_interdite' depuis 'piece') ;
   * depuis 'clos' seul « En cours » est accepté (= rouvrir), sinon 'dossier_clos'. Même état : sans effet.
   */
  dossierDefinirStatut(id: number, statutId: number): Promise<DossierResume>;
  /** § 15 : aperçu de la suppression d'un dossier, quel que soit son état ; dossier inexistant : 'introuvable'. */
  dossierSuppressionApercu(id: number): Promise<DossierSuppressionApercu>;
  /**
   * § 15 : supprime définitivement le dossier avec tout son contenu, quel que soit son état (clôturé compris), en une
   * seule transaction : sous-dossiers, documents, options, nominations, copies des fichiers importés, événements du
   * dossier ; un événement 'dossier_supprime' est ajouté à l'historique de chaque fiche nommée dans ses documents.
   * Refus : 'introuvable' (dossier inexistant ou déjà supprimé), 'fichier_ouvert' (copie verrouillée par une autre
   * application), 'donnees_incoherentes' (contenu partagé avec un autre dossier) ; rien n'est alors modifié.
   * Ensuite dossierDetail(id) rejette 'introuvable' : afficher « Ce dossier a été supprimé. ».
   */
  dossierSupprimer(id: number): Promise<void>;
  // § 11.6 : dossierDefinirFiches est retirée.
  sousDossierCreer(dossierId: number, parentId: number | null, nom: string): Promise<SousDossier>;
  sousDossierRenommer(id: number, nom: string): Promise<void>;
  sousDossierSupprimer(id: number): Promise<void>;
  optionCreer(dossierId: number, nom: string): Promise<OptionDossier>;
  optionCocher(id: number, ok: boolean): Promise<void>;
  optionSupprimer(id: number): Promise<void>;
  // documents
  documentCreerDepuisModele(dossierId: number, sousDossierId: number | null, modeleId: number, pieceFinale: boolean): Promise<DocumentFichier>;
  /** Ouvre le sélecteur de fichier côté back ; null si l'utilisateur annule. */
  documentImporter(dossierId: number, sousDossierId: number | null, pieceFinale: boolean): Promise<DocumentFichier | null>;
  documentRenommer(id: number, nom: string): Promise<void>;
  documentDefinirDate(id: number, date: string): Promise<void>;
  documentEnregistrerBlocs(id: number, blocs: BlocDocument[]): Promise<void>;
  documentSupprimer(id: number): Promise<void>;
  documentOuvrirExterne(id: number): Promise<void>;
  /** « Enregistrer une copie… » : sélecteur d'enregistrement côté back ; false si l'utilisateur annule. */
  documentExporter(id: number): Promise<boolean>;
  // modèles
  modelesLister(): Promise<Modele[]>;
  modeleCreer(): Promise<Modele>;                                 // « Modèle NN », premier thème actif, aucun bloc ('aucun_theme' sinon)
  modeleDupliquer(id: number): Promise<Modele>;                   // « {nom} (copie) », actif
  modeleEnregistrer(id: number, saisie: { nom: string; themeId: number; blocs: BlocModele[] }): Promise<Modele>;
  modeleBasculer(id: number): Promise<Modele>;
  /**
   * § 11.4 : supprime définitivement le modèle (actif ou archivé, standard compris). Refusé ('modele_utilise') tant qu'un
   * document vient de ce modèle, avec le nombre dans le message ; modèle introuvable : 'introuvable'. Ne touche à aucun document.
   */
  modeleSupprimer(id: number): Promise<void>;
  /** Recrée les modèles standards manquants (sans toucher aux existants) ; renvoie ceux qui ont été créés. */
  modelesStandardsRestaurer(): Promise<Modele[]>;
  // transverses
  recherche(q: string): Promise<ResultatsRecherche>;
  tableauDeBord(): Promise<TableauDeBord>;
}
