# INVENTORY — spécification

> **Note (English):** this is the detailed functional specification of INVENTORY: data model, business rules, the front-end/back-end contract and the change history of each version (sections 8 to 18). It is written in French, like the application's user interface. For an English overview, see [`README.md`](../README.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

Application de bureau Windows 11, 100 % locale (aucun accès réseau à l'exécution), livrée sous forme d'installateur `.exe`.
La référence fonctionnelle et visuelle est le prototype HTML statique d'origine, [`design/prototype-entites-dossiers.html`](../design/prototype-entites-dossiers.html) : mêmes écrans, mêmes libellés français, mêmes classes CSS, mêmes numéros de section (1.1, 2.1…). Ce document précise ce que le prototype ne dit pas : la persistance, les règles métier, le contrat entre le front et le back, et les quelques écrans ajoutés pour que l'application soit utilisable avec de vraies données.

## 1. Pile technique

| Couche | Choix |
| --- | --- |
| Encapsulation | Tauri 2 (Rust), fenêtre sans décorations natives, barre de titre dessinée comme dans le prototype |
| Base de données | SQLite via `rusqlite` avec la fonctionnalité `bundled` (aucune DLL externe) |
| Front | React 19 + TypeScript strict, fichiers `.tsx`, Vite |
| État serveur | `@tanstack/react-query` (lecture + invalidation après chaque écriture) |
| État d'interface | `zustand` (navigation, filtres, dépliés) |
| Polices | `@fontsource/inter` (400, 500, 600) et `@fontsource/jetbrains-mono` (400, 500), embarquées — jamais de CDN |
| Greffons Tauri | `dialog` (choisir un fichier à importer), `opener` (ouvrir un fichier ou un dossier), `single-instance` |
| Installateur | NSIS, installation par utilisateur (sans droits administrateur), en français |

Contraintes non négociables :

- Aucune requête réseau à l'exécution : pas de CDN, pas de télémétrie, pas de mise à jour automatique.
- Toute l'interface est en français, avec les libellés exacts du prototype.
- Rien n'est supprimé pour les fiches, thèmes, catégories, mots-clés et modèles : on archive et on réactive.
- Les erreurs métier remontent au front sous la forme `{ code, message }` avec un `message` en français affichable tel quel.

## 2. Organisation du dépôt et périmètres

```
design/prototype-entites-dossiers.html   référence (lecture seule)
docs/specification.md                    ce document
src/api/                                 contrat TypeScript + appels invoke      → back
src-tauri/                               Rust, configuration Tauri, icônes        → back
src/ (hors src/api)                      React                                    → front
index.html, vite.config.ts, package.json                                         → front
```

Le dépôt est découpé en deux périmètres. Le back comprend `src-tauri/` et le contrat `src/api/` (types et appels des commandes) ; le front comprend le reste de `src/` et la configuration de Vite. Le front ne passe que par `src/api/` pour parler au back : une évolution du contrat se fait d'abord dans `src/api/` et dans les commandes Rust, puis dans les pages.

Arborescence front :

```
src/main.tsx, src/App.tsx
src/styles/        CSS du prototype, repris à l'identique et découpé (tokens, base, composants, impression)
src/ui/            composants de base : Icon, Badge, Section, PageHeader, Seg, Chip, Modal, Table, Empty, Timeline…
src/shell/         TitleBar, Sidebar, TopBar, Breadcrumbs, GlobalSearch
src/nav/           routes typées + magasin de navigation (go / root / back, pile d'historique)
src/lib/           formatage (dates, pluriels), client react-query, hooks communs
src/pages/         une page par fichier (voir § 6)
```

Arborescence back :

```
src-tauri/migrations/001_init.sql
src-tauri/src/lib.rs          construction de l'application, état partagé, enregistrement des commandes
src-tauri/src/error.rs        AppError { code, message } sérialisable
src-tauri/src/db/             ouverture, pragmas, migrations (PRAGMA user_version), données d'exemple
src-tauri/src/domaine/        un module par agrégat, fonctions pures prenant &Connection (testables en mémoire)
src-tauri/src/commandes/      enveloppes #[tauri::command] minces
```

## 3. Modèle de données (SQLite)

Dates stockées en texte ISO, heure locale : `AAAA-MM-JJ HH:MM:SS` (horodatages) ou `AAAA-MM-JJ` (date d'un document). `PRAGMA foreign_keys = ON`, `journal_mode = WAL`.

```sql
parametres(cle TEXT PRIMARY KEY, valeur TEXT NOT NULL)
  -- theme: system|light|dark · densite: eq|compact · donnees_exemple: 0|1
themes(id, nom UNIQUE, actif)
categories(id, kind CHECK(kind IN ('a','b')), nom, actif, UNIQUE(kind, nom))
  -- kind 'a' = « Groupe » des Entités A · kind 'b' = « Type » des Entités B
magasin(id, nom UNIQUE, actif)
entites(id, kind, nom, code TEXT NULL CHECK(code GLOB '[0-9][0-9][0-9][0-9]'), categorie_id → categories,
        actif, cree_le, maj_le)
  -- index unique partiel (kind, code) WHERE code IS NOT NULL
associations(a_id → entites, b_id → entites, cree_le, PRIMARY KEY(a_id, b_id))
modeles(id, nom, theme_id → themes, actif, blocs TEXT /* JSON */, cree_le, maj_le)
dossiers(id, nom, annee INTEGER, theme_id → themes, statut CHECK(statut IN ('cours','piece','clos')),
         a_id → entites, b_id → entites, cree_le, maj_le, clos_le NULL)
sous_dossiers(id, dossier_id → dossiers ON DELETE CASCADE, parent_id → sous_dossiers NULL ON DELETE CASCADE, nom, cree_le)
documents(id, dossier_id → dossiers ON DELETE CASCADE, sous_dossier_id → sous_dossiers NULL ON DELETE CASCADE,
          nom, origine CHECK(origine IN ('modele','import')), source TEXT, date_doc TEXT,
          blocs TEXT NULL /* JSON, instantané des blocs du modèle + valeurs saisies */,
          fichier_stocke TEXT NULL /* nom du fichier copié dans <données>/fichiers */, fichier_nom TEXT NULL,
          piece_finale INTEGER, cree_le)
options(id, dossier_id → dossiers ON DELETE CASCADE, nom, ok, position)      -- « Options à cocher »
evenements(id, type TEXT, titre TEXT, detail TEXT, a_id NULL, b_id NULL, dossier_id NULL, date TEXT)
```

Emplacement : la base `donnees.sqlite` et le dossier `fichiers/` (copies des fichiers importés, nommés par UUID + extension d'origine) vivent dans le répertoire de données de l'application (`app_data_dir`).

## 4. Règles métier

**Fiches (Entités A et B)**
- Le code unique fait exactement 4 chiffres, est facultatif à la création, et est unique parmi les fiches du même répertoire. En cas de doublon : « Ce code est déjà utilisé par {nom}. »
- Une fiche sans code apparaît dans « Inventaire à compléter » et porte le badge « Sans identifiant ».
- Archiver une fiche ne supprime rien ; elle reste consultable et réactivable. Les fiches archivées ne sont pas proposées dans les listes de choix (association, création de dossier).
- Une fiche peut être modifiée (nom, catégorie, code) depuis sa page.
- Les catégories proposées sont les catégories actives du bon `kind`, gérées dans Paramètres § 6.2.

**Associations A ↔ B**
- Créées explicitement depuis une fiche (« Associer une Entité B » / « Associer une Entité A »), ou automatiquement à la création d'un dossier qui relie une paire pas encore associée.
- « Dissocier » est refusé tant qu'un dossier relie la paire.

**Dossiers**
- Un dossier porte un nom, une année, un thème, une Entité A et une Entité B. À la création, deux options à cocher par défaut : « Dossier numérisé » et « Contenu vérifié ».
- Nom suggéré : `Dossier {année}-{NN}`, NN = rang suivant dans l'année, sur deux chiffres, augmenté de 1 tant que ce nom est déjà porté par un dossier, quelle que soit son année.
- États : `cours` (En cours) · `piece` (Pièce manquante) · `clos` (Clôturé). Transitions autorisées :
  - `cours → piece` : « Signaler une pièce manquante » ; ou case « En attente d'une pièce finale » à la création.
  - `piece → cours` : uniquement en ajoutant la pièce finale (un document créé ou importé avec `pieceFinale = true`).
  - `cours → clos` : « Clôturer le dossier » (bouton désactivé en état `piece`, avec l'infobulle du prototype).
  - `clos → cours` : « Rouvrir le dossier ».
- Un dossier clôturé est en lecture seule : ajout, renommage, suppression, saisie et cases sont refusés par le back et désactivés dans le front (« Rouvrez le dossier pour le modifier. »).
- Depuis la version 1.6 (§ 15), un dossier peut être supprimé avec tout son contenu, quel que soit son état. Un sous-dossier ou un document peut être renommé ou supprimé (confirmation ; supprimer un sous-dossier supprime son contenu ; supprimer un document importé supprime sa copie dans `fichiers/`).
- Les sous-dossiers s'imbriquent sans limite de profondeur.

**Documents**
- Nom par défaut (création depuis un modèle comme import) : `Document_NN`, sur deux chiffres au minimum, NN = nombre de documents du dossier + 1, augmenté de 1 tant que ce nom est déjà porté par un document du dossier (sous-dossiers compris). Il n'est donc jamais déjà utilisé dans le dossier, même après une suppression ou un renommage.
- Depuis un modèle : les blocs du modèle sont copiés dans le document (instantané). Modifier le modèle ensuite ne change pas les documents existants. `source` = nom du modèle.
- Importé : le fichier choisi est copié dans `fichiers/`. `source` = « Fichier importé ». Aperçu intégré pour les images et les PDF ; pour les autres types, un message et un bouton « Ouvrir avec l'application par défaut ».
- La date du document vaut la date du jour à la création et reste modifiable.
- La saisie est enregistrée automatiquement (temporisation d'environ 400 ms), sans bouton « Enregistrer ».
- Un document peut être imprimé (`window.print()`), la feuille d'impression n'affichant que le « papier ».

**Blocs** (modèles et documents)

| `t` | `v` dans le modèle | Dans le document |
| --- | --- | --- |
| `texte` | le texte | affiché tel quel |
| `champ` | le libellé | `val` : texte saisi |
| `variable` | l'une des 5 variables | valeur calculée à l'affichage, jamais stockée |
| `case` | le nom de l'option | `ok` : coché ou non |
| `magasin` | le libellé | `val` : mot-clé choisi parmi les mots-clés actifs (plus la valeur déjà choisie si elle a été archivée) |
| `tableau` | — ; `cols` : 3 en-têtes modifiables, par défaut « Colonne 1..3 » | `rows` : lignes saisies, ajout et retrait de ligne |

Variables : « Entité A · Nom », « Entité A · Code », « Entité B · Nom », « Entité B · Code unique », « Date du jour » (= date du document, au format JJ/MM/AAAA). Un code absent s'affiche « Sans identifiant ».

**Journal** — chaque écriture métier ajoute une ligne dans `evenements` :

| `type` | Classe d'affichage | Rattaché à |
| --- | --- | --- |
| `fiche_creee`, `fiche_modifiee`, `code_saisi`, `fiche_archivee`, `fiche_reactivee` | (neutre) | la fiche |
| `association`, `dissociation` | `assoc` | A et B |
| `dossier_ouvert`, `dossier_rouvert` | (neutre) | A, B, dossier |
| `piece_manquante` | `alerte` | A, B, dossier |
| `piece_ajoutee` | (neutre) | A, B, dossier |
| `dossier_clos` | `clos` | A, B, dossier |

Les onglets des fiches filtrent ce journal côté front : « Journal chronologique » (A) = associations + événements de dossier ; « Historique complet » (A) = tout ; « Historique des associations » (B) = `association` / `dissociation` ; « Journal des opérations » (B) = tout le reste. Les frises regroupent par année (`.tl-year`) et affichent la date au format JJ/MM/AAAA.

**Tableau de bord**
- Compteurs et répartition : comme le prototype, calculés sur les données réelles.
- « Volume traité par période » : nombre de documents ajoutés par mois pour l'année en cours (12 barres, le mois en cours avec la couleur « période en cours »), échelle verticale adaptée au maximum.
- Le compteur « Fiches sans identifiant » ouvre le Répertoire A avec le filtre « Sans identifiant » activé.

**Recherche globale** — même comportement que le prototype : nom contenant le texte, ou code quand la saisie est numérique (`0412`, `#0412`, `code 0412`) ; 4 résultats au plus par groupe ; un code exact de 4 chiffres présélectionne la fiche ; ↑ ↓ Entrée Échap ; Ctrl+K.

**Premier lancement** — depuis la version 1.5.1, la base est créée **vide** (§ 14) : seuls les quatre modèles standards et leur thème y sont créés, `donnees_exemple = 0`. Jusqu'à la version 1.5.0, elle était remplie avec les données d'exemple ; celles-ci se chargent désormais à la demande (Paramètres 6.4, « Recharger les données d'exemple »). Données d'exemple d'origine, celles du prototype (8 Entités A, 8 Entités B, associations, 3 thèmes, 2 mots-clés, 3 modèles, 7 dossiers avec sous-dossiers, documents et options), avec des dates réparties sur l'année en cours et la précédente pour que les graphiques et les frises aient du contenu. `donnees_exemple = 1` quand elles sont chargées, tant que l'utilisateur n'a pas vidé la base ; la barre de titre affiche alors « Données d'exemple ». Les documents d'exemple « Fichier importé » n'ont pas de fichier réel : l'aperçu montre le gabarit gris du prototype.

## 5. Contrat front ↔ back

Les commandes Tauri portent le nom en `snake_case` de la fonction TypeScript (`entiteCreer` → `entite_creer`). Les structures sont sérialisées en `camelCase`. `src/api/index.ts` exporte un objet `api` dont les fonctions ont exactement les signatures ci-dessous, et `src/api/types.ts` exporte les types. Une erreur est rejetée sous la forme `ApiError`.

```ts
export type Kind = 'a' | 'b';
export type Statut = 'cours' | 'piece' | 'clos';
export type TypeBloc = 'texte' | 'champ' | 'tableau' | 'variable' | 'case' | 'magasin';
export interface ApiError { code: string; message: string }

export interface Classement { id: number; nom: string; actif: boolean }          // thème, mot-clé du Magasin
export interface Categorie extends Classement { kind: Kind }
export interface Entite {
  id: number; kind: Kind; nom: string; code: string | null;
  categorieId: number; categorie: string; actif: boolean; creeLe: string; majLe: string;
}
export interface DossierResume {
  id: number; nom: string; annee: number; themeId: number; theme: string; statut: Statut;
  aId: number; aNom: string; bId: number; bNom: string;
  nbFichiers: number; nbSousDossiers: number;            // nbSousDossiers = sous-dossiers de premier niveau
  nbOptions: number; nbOptionsCochees: number;
  creeLe: string; majLe: string; closLe: string | null;
}
export interface SousDossier { id: number; dossierId: number; parentId: number | null; nom: string }
export interface BlocModele { t: TypeBloc; v: string; cols?: string[] }
export interface BlocDocument extends BlocModele { val?: string; ok?: boolean; rows?: string[][] }
export interface DocumentFichier {
  id: number; dossierId: number; sousDossierId: number | null; nom: string;
  origine: 'modele' | 'import'; source: string; dateDoc: string;
  blocs: BlocDocument[] | null;
  fichierNom: string | null; fichierChemin: string | null;   // chemin absolu de la copie, null si aucun fichier
  pieceFinale: boolean; creeLe: string;
}
export interface OptionDossier { id: number; dossierId: number; nom: string; ok: boolean }
export interface DossierDetail {
  dossier: DossierResume; a: Entite; b: Entite;
  sousDossiers: SousDossier[];        // tous les niveaux, à plat
  documents: DocumentFichier[];       // tous les documents du dossier, à plat
  options: OptionDossier[];
}
export interface Modele {
  id: number; nom: string; themeId: number; theme: string; actif: boolean;
  blocs: BlocModele[]; creeLe: string; majLe: string;
}
export type TypeEvenement =
  | 'fiche_creee' | 'fiche_modifiee' | 'code_saisi' | 'fiche_archivee' | 'fiche_reactivee'
  | 'association' | 'dissociation'
  | 'dossier_ouvert' | 'dossier_rouvert' | 'piece_manquante' | 'piece_ajoutee' | 'dossier_clos';
export interface Evenement {
  id: number; type: TypeEvenement; classe: '' | 'assoc' | 'clos' | 'alerte';
  titre: string; detail: string; date: string;
  aId: number | null; bId: number | null; dossierId: number | null;
}
export interface DocumentLie extends DocumentFichier { dossierNom: string }
export interface FicheEntite {
  entite: Entite;
  associees: Entite[];                // fiches de l'autre répertoire associées à celle-ci
  dossiers: DossierResume[];
  documents: DocumentLie[];           // documents des dossiers liés
  evenements: Evenement[];            // du plus récent au plus ancien
}
export interface Parametres { theme: 'system' | 'light' | 'dark'; densite: 'eq' | 'compact'; donneesExemple: boolean }
export interface InfosSysteme { version: string; tauri: string; webview: string; dossierDonnees: string; cheminBase: string }
export interface TableauDeBord {
  aActives: number; aTotal: number; bActives: number; bTotal: number;
  dossiersTotal: number; dossiersOuverts: number; dossiersPiece: number;
  repartition: { clos: number; cours: number; piece: number };
  sansCodeA: Entite[]; sansCodeB: Entite[];
  dossiersEnCours: DossierResume[];                       // états cours et piece
  volume: { annee: number; mois: number[] };             // 12 valeurs, janvier → décembre
}
export interface ResultatsRecherche { a: Entite[]; b: Entite[]; dossiers: DossierResume[] }

export interface Api {
  // paramètres et système
  parametresLire(): Promise<Parametres>;
  parametreDefinir(cle: 'theme' | 'densite', valeur: string): Promise<void>;
  infosSysteme(): Promise<InfosSysteme>;
  dossierDonneesOuvrir(): Promise<void>;
  donneesReinitialiser(mode: 'vide' | 'exemple'): Promise<void>;
  // classement
  themesLister(): Promise<Classement[]>;
  themeCreer(nom: string): Promise<Classement>;
  themeBasculer(id: number): Promise<Classement>;                // archive ↔ réactive
  categoriesLister(kind: Kind): Promise<Categorie[]>;
  categorieCreer(kind: Kind, nom: string): Promise<Categorie>;
  categorieBasculer(id: number): Promise<Categorie>;
  magasinLister(): Promise<Classement[]>;
  magasinCreer(nom: string): Promise<Classement>;
  magasinBasculer(id: number): Promise<Classement>;
  // fiches
  entitesLister(kind: Kind): Promise<Entite[]>;
  entiteFiche(id: number): Promise<FicheEntite>;
  entiteCreer(saisie: { kind: Kind; nom: string; categorieId: number; code: string | null }): Promise<Entite>;
  entiteModifier(id: number, saisie: { nom: string; categorieId: number; code: string | null }): Promise<Entite>;
  entiteDefinirCode(id: number, code: string): Promise<Entite>;
  entiteBasculer(id: number): Promise<Entite>;
  associationCreer(aId: number, bId: number): Promise<void>;
  associationRetirer(aId: number, bId: number): Promise<void>;
  // dossiers
  dossiersLister(): Promise<DossierResume[]>;
  dossierDetail(id: number): Promise<DossierDetail>;
  dossierNomSuggere(annee: number): Promise<string>;
  dossierCreer(saisie: { nom: string; annee: number; themeId: number; aId: number; bId: number; pieceManquante: boolean }): Promise<DossierResume>;
  dossierRenommer(id: number, nom: string): Promise<void>;
  dossierDefinirStatut(id: number, statut: Statut): Promise<DossierResume>;   // refuse piece → cours et piece → clos
  sousDossierCreer(dossierId: number, parentId: number | null, nom: string): Promise<SousDossier>;
  sousDossierRenommer(id: number, nom: string): Promise<void>;
  sousDossierSupprimer(id: number): Promise<void>;
  optionCreer(dossierId: number, nom: string): Promise<OptionDossier>;
  optionCocher(id: number, ok: boolean): Promise<void>;
  optionSupprimer(id: number): Promise<void>;
  // documents
  documentCreerDepuisModele(dossierId: number, sousDossierId: number | null, modeleId: number, pieceFinale: boolean): Promise<DocumentFichier>;
  documentImporter(dossierId: number, sousDossierId: number | null, cheminSource: string, pieceFinale: boolean): Promise<DocumentFichier>;
  documentRenommer(id: number, nom: string): Promise<void>;
  documentDefinirDate(id: number, date: string): Promise<void>;
  documentEnregistrerBlocs(id: number, blocs: BlocDocument[]): Promise<void>;
  documentSupprimer(id: number): Promise<void>;
  documentOuvrirExterne(id: number): Promise<void>;
  // modèles
  modelesLister(): Promise<Modele[]>;
  modeleCreer(): Promise<Modele>;                                 // « Modèle NN », premier thème actif, aucun bloc
  modeleDupliquer(id: number): Promise<Modele>;                   // « {nom} (copie) », actif
  modeleEnregistrer(id: number, saisie: { nom: string; themeId: number; blocs: BlocModele[] }): Promise<Modele>;
  modeleBasculer(id: number): Promise<Modele>;
  // transverses
  recherche(q: string): Promise<ResultatsRecherche>;
  tableauDeBord(): Promise<TableauDeBord>;
}
```

`src/api/index.ts` exporte aussi `fichierUrl(chemin: string): string`, qui renvoie une URL utilisable dans `<img>` et `<iframe>` pour un fichier importé (protocole `asset` de Tauri, portée limitée au dossier `fichiers/`).

## 6. Écrans

Navigation identique au prototype : six entrées dans la barre latérale, chaque fiche ou dossier s'ouvre en pleine page, bouton Retour et Alt+← dépilent l'historique, fil d'Ariane cliquable.

```ts
type Route =
  | { name: 'dashboard' }
  | { name: 'rep'; kind: Kind; sansCode?: boolean }
  | { name: 'fiche'; id: number; focusCode?: boolean }
  | { name: 'dossiers' }
  | { name: 'dossier'; id: number; sousDossierId?: number | null; documentId?: number }
  | { name: 'creation' }
  | { name: 'form-entite'; kind: Kind; id?: number }             // id présent = modification
  | { name: 'form-dossier'; aId?: number; bId?: number }
  | { name: 'studio'; modeleId?: number }
  | { name: 'magasin' }
  | { name: 'parametres' };
```

| Page | Fichier | Contenu |
| --- | --- | --- |
| Tableau de bord | `pages/Dashboard.tsx` | sections 1.1 à 1.4 du prototype |
| Répertoire A / B | `pages/Repertoire.tsx` | filtres, tri, tableau ; clic sur une ligne = fiche |
| Fiche A / B | `pages/Fiche.tsx` | récapitulatif, alertes, onglets ; **ajouts** : « Modifier la fiche », « Associer… », « Dissocier », « Créer un dossier » dans l'onglet des dossiers liés |
| Formulaire de fiche | `pages/FormEntite.tsx` | création (5.2 / 5.3) et modification |
| Dossiers & Archives | `pages/Dossiers.tsx` | filtres, regroupement, vues Groupes et Arborescence ; **ajout** : bouton « Créer un dossier » |
| Dossier ouvert | `pages/Dossier.tsx` | contenu, grand « + », options à cocher, document ; **ajouts** : « Signaler une pièce manquante », renommer / supprimer, imprimer, import réel |
| Formulaire de dossier | `pages/FormDossier.tsx` | **nouvel écran** « Module 5 · Formulaire », section 5.8 « Informations du dossier » |
| Création | `pages/Creation.tsx` | les 4 cartes du prototype + **« Créer un dossier »** |
| Studio de Modèles | `pages/Studio.tsx` | liste, éditeur par blocs, aperçu direct ; **ajouts** : réordonner les blocs (poignée + boutons monter / descendre), en-têtes de tableau modifiables |
| Magasin | `pages/Magasin.tsx` | section 5.7 |
| Paramètres | `pages/Parametres.tsx` | 6.1 affichage (persisté) · 6.2 thèmes, groupes (A) et types (B) · 6.3 informations système réelles · **6.4 Données** : emplacement, « Ouvrir le dossier des données », « Recharger les données d'exemple », « Effacer toutes les données » (avec confirmation) |

Les ajouts reprennent les composants et les classes CSS du prototype ; ils ne créent pas de nouveau langage visuel.

## 7. Fenêtre et installateur

- Nom du produit : **INVENTORY** (« Entités et Dossiers » jusqu'à la 1.4.0, voir §12) · identifiant `fr.entitesdossiers.app` · version 1.0.0 · binaire `inventory.exe` (`entites-dossiers.exe` jusqu'à la 1.4.0).
- Fenêtre : 1280 × 800 à l'ouverture, minimum 1024 × 640, centrée, `decorations: false`, ombre native, redimensionnable. La barre de titre du prototype devient la vraie : zone de déplacement (`data-tauri-drag-region`), boutons réduire / agrandir-restaurer / fermer fonctionnels, double clic = agrandir. Le « canevas » gris et le cadre arrondi du prototype disparaissent : `.win` occupe toute la fenêtre.
- `dragDropEnabled: false` sur la fenêtre, pour que le glisser-déposer HTML5 du Studio fonctionne.
- Une seule instance : relancer l'application ramène la fenêtre existante au premier plan.
- CSP stricte, limitée aux ressources locales (`self`, `asset:`, `ipc:`, `blob:`, `data:`), sans aucune origine distante.
- Installateur NSIS uniquement, `installMode: currentUser`, langue française, sans sélecteur de langue.

## 8. Version 1.1 — Employés, Machines et modèles standards

Cette section complète et, là où elle le contredit, remplace ce qui précède. L'application sert au suivi informatique d'un service : les **Entités A deviennent les Employés**, les **Entités B deviennent les Machines** (PC et ordinateurs portables). Quatre formulaires papier courants d'un service informatique deviennent des modèles de document à remplir dans l'application.

Tout ce que l'audit de sécurité a établi reste vrai (`docs/audit-securite.md`) : contrôle du schéma à l'ouverture, bornes de taille, aucun HTML injecté, aucune permission ajoutée à l'interface, aucun chemin venu de l'interface.

### 8.1 Vocabulaire de l'interface

| Avant | Maintenant |
| --- | --- |
| Entité A, Entités A | Employé, Employés |
| Entité B, Entités B | Machine, Machines |
| Répertoire A / Répertoire B | Employés / Machines |
| Groupe (catégorie des A) | Structure |
| Type (catégorie des B) | Type de machine |
| Code unique, « Code #0412 » | Identifiant, affiché tel quel |
| Sans identifiant (employé) | Fiche à compléter |

Plus aucun libellé « Entité A » ou « Entité B » ne doit rester à l'écran, dans les messages d'erreur du back, dans le journal ni dans les données d'exemple. Les noms techniques (`kind: 'a' | 'b'`, tables, routes) ne changent pas.

### 8.2 Employés (`kind = 'a'`)

Champs saisis à la main : **nom**, **prénom**, **date de naissance**, **poste** (grade ou fonction), **structure** (catégorie). Le nom affiché partout est `NOM Prénom` (champ `libelle`).

**Identifiant généré automatiquement**, jamais saisi :

- on met en majuscules, on retire les accents, on ne garde que les lettres A à Z ;
- `N3` = 3 premières lettres du nom, `P2` = 2 premières lettres du prénom, `F3` = 3 premières lettres du poste (complétées par `X` si le mot est plus court) ; `JJMMAA` vient de la date de naissance ;
- identifiant = `N3P2-JJMMAA-F3`. Exemple : Benali Sofia, née le 14/05/1990, Technicienne → `BENSO-140590-TEC` ;
- s'il manque le nom, le prénom, la date de naissance ou le poste, l'identifiant est absent et la fiche apparaît dans « Inventaire à compléter » avec le badge « Fiche à compléter » ;
- unicité parmi les employés : en cas de collision, suffixe `-2`, `-3`… ;
- l'identifiant est recalculé à chaque modification de la fiche ; si sa base (hors suffixe) ne change pas, l'identifiant actuel est conservé tel quel ;
- le formulaire affiche l'identifiant qui sera attribué, en direct, pendant la saisie.

### 8.3 Machines (`kind = 'b'`)

Champs saisis à la main : **nom**, **identifiant** (texte libre de 1 à 40 caractères, unique parmi les machines sans tenir compte de la casse, facultatif à la création), **marque et modèle**, **processeur**, **RAM**, **stockage**, **type de machine** (catégorie). L'identifiant d'une machine n'est jamais généré. Une machine sans identifiant apparaît dans « Inventaire à compléter ».

### 8.4 Recherche et aide à la saisie

- **Recherche globale** : employés par nom, prénom ou identifiant ; machines par nom, marque ou identifiant ; dossiers par nom. Sans tenir compte de la casse ni des accents. Un identifiant saisi exactement présélectionne la fiche.
- **Aide à la saisie** : partout où l'on choisit un employé ou une machine, on tape les premières lettres et une liste propose les fiches correspondantes (celles dont un mot commence par la saisie d'abord, puis celles qui la contiennent ; fiches actives seulement ; 8 propositions au plus ; ↑ ↓ Entrée Échap, clic). Chaque proposition montre de quoi distinguer deux homonymes : identifiant, poste et structure pour un employé ; identifiant, marque et caractéristiques pour une machine. Cela concerne le formulaire de dossier, la fenêtre d'association, et les blocs « Employé » et « Machine » d'un document.

### 8.5 Blocs de document

Les types de bloc deviennent :

| `t` | Rôle | Dans le modèle | Dans le document |
| --- | --- | --- | --- |
| `titre` | titre centré ou intertitre | `v` : le texte ; `niveau` : 1 (titre) ou 2 (intertitre) | affiché |
| `texte` | paragraphe | `v` | affiché |
| `champ` | champ d'une ligne | `v` : libellé | `val` |
| `zone` | champ de plusieurs lignes | `v` : libellé | `val` |
| `date` | date, avec l'heure si demandé | `v` : libellé ; `heure` : booléen | `val` : `AAAA-MM-JJ` ou `AAAA-MM-JJTHH:MM` |
| `case` | case à cocher | `v` : libellé | `ok` |
| `choix` | liste d'options à cocher | `v` : libellé ; `options` : 2 à 12 textes ; `multiple` : booléen | `choisis` : options retenues |
| `tableau` | tableau | `cols` : 1 à 8 en-têtes (3 par défaut) | `rows` |
| `magasin` | choix dans le Magasin | `v` : libellé | `val` |
| `variable` | valeur calculée | `v` : nom de la variable | calculée à l'affichage |
| `employe` | choix d'un employé avec aide à la saisie | `v` : libellé | `entiteId` |
| `machine` | choix d'une machine avec aide à la saisie | `v` : libellé | `entiteId` |
| `signature` | cadre vide à signer ou à viser après impression | `v` : libellé | rien |

- Un bloc `employe` ou `machine` est prérempli avec l'employé ou la machine du dossier à la création du document, et reste modifiable. Une fois la fiche choisie, le bloc affiche ses informations, lues en direct : nom, prénom, poste, structure et identifiant pour un employé ; nom, identifiant, marque et modèle, processeur, RAM et stockage pour une machine. On peut vider le choix.
- Plusieurs blocs `signature` qui se suivent s'affichent côte à côte.
- Variables : « Employé · Nom », « Employé · Prénom », « Employé · Poste », « Employé · Structure », « Employé · Identifiant », « Machine · Nom », « Machine · Identifiant », « Machine · Marque et modèle », « Machine · Processeur », « Machine · RAM », « Machine · Stockage », « Date du jour ». Les anciens noms (« Entité A · Nom », « Entité A · Code », « Entité B · Nom », « Entité B · Code unique ») restent reconnus dans les modèles et documents existants.
- Bornes : celles de l'audit, plus 12 options de 200 caractères au plus par bloc `choix`, 8 colonnes par tableau.
- Le Studio propose tous ces types dans sa palette : ce sont les « champs personnalisés » avec lesquels l'utilisateur compose ses propres modèles.

### 8.6 Modèles standards

Quatre modèles sont fournis, formulaires génériques d'un service informatique ; leurs en-têtes sont neutres (« Nom de l'organisme », « Adresse · Téléphone », « Nom de la division ou du service ») et s'adaptent dans le Studio (§ 18) :

| Nom du modèle | Particularités |
| --- | --- |
| État des besoins | tableau à 4 colonnes N° / Désignation / Qté / Observations ; choix multiple Achat / Magasin / Prestation / Travaux ; trois visas en `signature` ; annotation manuscrite reprise : choix unique « Départ / Arrivée » |
| Fiche d'intervention informatique | bloc `employe` « Utilisateur », bloc `machine` « Matériel » ; début et fin d'intervention en `date` avec l'heure ; annotation manuscrite reprise : champ « Ouverture de la session (Domaine) » |
| Fiche d'identification | attribution d'une boîte de messagerie professionnelle ; bloc `employe` « Bénéficiaire » ; consignes et remarque en `texte` |
| Fiche pour formatage PC | blocs `employe` et `machine` ; intertitres pour les sections ; choix uniques (Demandeur, PC connecté réseau, Mode de connexion, Licence) et multiples (Formatage nécessaire, Données sauvegardées) |

Chaque champ du formulaire a son bloc, dans l'ordre du formulaire. Quand le formulaire demande une information que la fiche de l'employé ou de la machine porte déjà (nom, prénom, structure, marque, processeur, RAM, disque), elle est fournie par le bloc `employe` ou `machine` et n'est pas redemandée. La mention « Fait le … » correspond à la date du document, déjà affichée en haut à droite.

Ces modèles sont rangés dans un thème « Support informatique ». Ils sont créés au premier lancement (ce sont alors les seules données de la base, § 14), à la migration d'une base existante, et après toute réinitialisation, y compris « Effacer toutes les données ». Le Studio a une action « Restaurer les modèles standards » qui recrée ceux qui manquent, sans toucher aux modèles existants, même modifiés. Un modèle standard « manque » quand aucun modèle actif ne porte son nom (casse et accents ignorés) : archivé, renommé ou effacé, il est recréé à neuf sous son nom ; l'ancien garde son nom, ses blocs et son état, et n'est plus marqué « Standard ».

### 8.7 Données existantes et données d'exemple

- **Migration 002** (`user_version = 2`) : nouvelles colonnes, contrainte de l'identifiant assouplie, modèles standards ajoutés. Une base de la version 1.0 est migrée sans perte : ses fiches A deviennent des employés dont le nom est l'ancien nom, sans prénom, date de naissance ni poste, donc « à compléter » ; ses fiches B deviennent des machines qui gardent leur ancien code comme identifiant. Le contrôle du schéma à l'ouverture accepte une base en version 1 (qu'il migre) comme en version 2.
- **Données d'exemple** (chargées à la demande par « Recharger les données d'exemple », jamais au premier lancement depuis la version 1.5.1, § 14) : employés et machines fictifs, avec des noms plausibles et des fiches complètes (sauf deux de chaque, laissées à compléter), des dossiers et des documents issus des quatre modèles standards. Aucune personne réelle.

### 8.8 Contrat

```ts
export interface Entite {
  id: number; kind: Kind; nom: string; code: string | null;   // identifiant : généré (employé) ou saisi (machine)
  libelle: string;                                             // employé : « NOM Prénom » ; machine : nom
  categorieId: number; categorie: string; actif: boolean; creeLe: string; majLe: string;
  prenom: string; dateNaissance: string | null; poste: string;  // employé ; vides pour une machine
  marque: string; cpu: string; ram: string; stockage: string;   // machine ; vides pour un employé
}
export type SaisieEmploye = { kind: 'a'; nom: string; prenom: string; dateNaissance: string | null; poste: string; categorieId: number };
export type SaisieMachine = { kind: 'b'; nom: string; code: string | null; marque: string; cpu: string; ram: string; stockage: string; categorieId: number };
export type TypeBloc = 'titre' | 'texte' | 'champ' | 'zone' | 'date' | 'case' | 'choix' | 'tableau' | 'magasin' | 'variable' | 'employe' | 'machine' | 'signature';
export interface BlocModele { t: TypeBloc; v: string; cols?: string[]; options?: string[]; multiple?: boolean; heure?: boolean; niveau?: 1 | 2 }
export interface BlocDocument extends BlocModele { val?: string; ok?: boolean; rows?: string[][]; choisis?: string[]; entiteId?: number | null }
export interface DossierDetail { /* … */ entitesCitees: Entite[] }   // fiches désignées par les blocs employe / machine des documents du dossier

// fonctions modifiées ou ajoutées dans Api
entiteCreer(saisie: SaisieEmploye | SaisieMachine): Promise<Entite>;
entiteModifier(id: number, saisie: SaisieEmploye | SaisieMachine): Promise<Entite>;
entiteDefinirCode(id: number, code: string): Promise<Entite>;                  // machines seulement
identifiantEmployeApercu(saisie: { nom: string; prenom: string; dateNaissance: string | null; poste: string }, idExistant: number | null): Promise<string | null>;
entitesSuggerer(kind: Kind, q: string): Promise<Entite[]>;                      // aide à la saisie, 8 au plus
modelesStandardsRestaurer(): Promise<Modele[]>;
```

`DossierResume.aNom` et `bNom` portent le `libelle`. `ResultatsRecherche`, `FicheEntite` et `TableauDeBord` gardent leur forme.

### 8.9 Version

L'application passe en **1.1.0** (`package.json`, `Cargo.toml`, `tauri.conf.json`). Le nom du produit et son identifiant ne changent pas : l'installation remplace la version précédente et retrouve ses données.

## 9. Version 1.2 — Structures et types modifiables, signatures cochées, affectations, historique cliquable

Cette section complète et, là où elle le contredit, remplace ce qui précède. L'application remplace les formulaires papier : on ne remplit plus rien à la main, et l'impression n'est pas le but.

### 9.1 Structures et types de machine

Dans Paramètres § 6.2, les structures (catégories des employés) et les types de machine (catégories des machines) peuvent être **ajoutés, renommés, archivés ou réactivés, et supprimés**.

- Renommer : le nouveau nom s'applique partout où la structure ou le type apparaît. Deux structures, ou deux types, ne peuvent pas porter le même nom.
- Supprimer : refusé tant qu'au moins une fiche, active ou archivée, appartient à la structure ou au type. Le message dit combien : « Cette structure contient encore 3 employés. Déplacez-les dans une autre structure avant de la supprimer. » L'interface montre le nombre de fiches de chaque structure et de chaque type, et explique pourquoi la suppression est indisponible plutôt que de la cacher. Une suppression demande une confirmation.
- Les thèmes et le Magasin ne changent pas.

### 9.2 Signatures

Le bloc `signature` n'est plus un cadre vide à signer à la main. C'est une **case à cocher « Signé »** portant le libellé du signataire (« Visa du demandeur », « Intervenant »…).

- Dans le document : `ok` (signé ou non) et `val`, la date à laquelle la case a été cochée, posée par le back au moment où `ok` passe à vrai et effacée quand la case est décochée. L'interface affiche « Signé le JJ/MM/AAAA » ou « Non signé ».
- Plusieurs signatures qui se suivent restent côte à côte.
- Les documents existants ont leurs signatures non cochées.
- Tout ce qui servait à écrire à la main disparaît : lignes vides ajoutées aux tableaux, lignes et pointillés des champs et des zones, champs vides imprimés pour un bloc employé ou machine non renseigné. L'action « Imprimer » reste, et imprime ce qui est saisi à l'écran, rien de plus.

### 9.3 Affectations

Une **affectation** relie une machine à un employé pendant une période. Elle remplace l'« association ».

- On affecte une machine à un employé **depuis la fiche de l'employé**, par un bouton « Affecter une machine » visible dès l'ouverture de la fiche, avec l'aide à la saisie. Aucun dossier ni document n'est nécessaire. La même action existe sur la fiche d'une machine (« Affecter à un employé »).
- Seules des fiches actives peuvent être affectées. Une machine peut être affectée à plusieurs employés en même temps, et inversement.
- **« Retirer l'affectation » est toujours possible**, même si un dossier relie la paire : l'affectation reçoit une date de fin et passe dans les anciennes affectations ; le dossier reste lié aux deux fiches. On peut réaffecter plus tard : c'est une nouvelle période.
- Créer un dossier pour une paire qui n'a pas d'affectation en cours en crée une, comme avant.
- La fiche montre les affectations en cours et les anciennes, avec leurs dates. Chaque ligne ouvre la fiche de l'autre côté.
- Migration 003 (`user_version = 3`) : les associations existantes deviennent des affectations en cours, qui commencent à leur date de création. Le contrôle du schéma à l'ouverture accepte les versions 1, 2 et 3 exactement conformes et migre les deux premières, avec la sauvegarde préalable déjà en place.

### 9.4 Historique cliquable

Dans toutes les frises (onglets d'historique d'un employé et d'une machine), les noms cités par un événement sont des liens :

- le nom d'une machine ou d'un employé ouvre sa fiche, que l'affectation soit en cours ou terminée, et que la fiche soit active ou archivée ;
- le nom d'un dossier ouvre le dossier.

Les événements d'affectation s'intitulent « Affectation de {nom} » et « Fin de l'affectation de {nom} ».

### 9.5 Contrat

```ts
export interface Categorie extends Classement { kind: Kind; nbFiches: number }   // fiches actives et archivées
export interface Affectation { id: number; entite: Entite; debut: string; fin: string | null }   // entite : la fiche de l'autre côté
export interface FicheEntite { /* … */ affectations: Affectation[] }   // en cours d'abord, puis terminées de la plus récente à la plus ancienne ; `associees` = fiches des affectations en cours
export interface Evenement { /* … */ aLibelle: string | null; bLibelle: string | null; dossierNom: string | null }

categorieRenommer(id: number, nom: string): Promise<Categorie>;
categorieSupprimer(id: number): Promise<void>;
associationCreer(aId: number, bId: number): Promise<void>;     // démarre une affectation
associationRetirer(aId: number, bId: number): Promise<void>;   // termine l'affectation en cours ; jamais refusée pour cause de dossier
```

### 9.6 Version

L'application passe en **1.2.0**.

## 10. Version 1.3 — États de dossier, recherche, dossiers libres, citations, identifiant codé, champs obligatoires

Cette section complète et, là où elle le contredit, remplace ce qui précède.

### 10.1 États de dossier

L'état d'un dossier n'est plus une liste fermée. Trois états sont fournis et ne peuvent être ni renommés ni supprimés ; l'utilisateur en ajoute d'autres.

| État | Rôle | Effet |
| --- | --- | --- |
| En cours | `cours` | dossier ouvert, modifiable |
| Pièce manquante | `piece` | dossier ouvert, modifiable, **clôture interdite** |
| Clôturé | `clos` | dossier en lecture seule |
| états ajoutés par l'utilisateur | `perso` | dossier ouvert, modifiable |

- **Changer l'état depuis le dossier** : l'en-tête du dossier ouvert porte une liste des états ouverts (`cours`, `piece`, `perso`) ; on passe librement de l'un à l'autre, y compris pour quitter « Pièce manquante » à la main. « Ajouter la pièce finale » ramène toujours un dossier en « Pièce manquante » à « En cours ».
- **Clôturer** reste une action distincte, refusée par le back et désactivée dans l'interface, avec son explication, tant que l'état est « Pièce manquante ». **Rouvrir** ramène à « En cours ».
- **Gérer les états** dans Paramètres : ajouter un état (nom et couleur), le renommer, changer sa couleur, le supprimer. La suppression est refusée tant qu'un dossier porte cet état, avec le nombre de dossiers, comme pour les structures. Deux états ne portent pas le même nom.
- **Couleurs** : une palette fermée de neuf couleurs nommées (`gris`, `bleu`, `turquoise`, `vert`, `ambre`, `orange`, `rouge`, `rose`, `violet`), définies dans les feuilles de style pour le thème clair et le thème sombre avec un contraste lisible. Aucune couleur libre : la CSP interdit les styles en ligne, et le badge porte une classe par couleur.
- Tout ce qui s'appuyait sur les trois états (badges, filtres et regroupements de Dossiers & Archives, répartition du tableau de bord, recherche, frises) s'appuie sur la liste réelle. Le tableau de bord compte comme « ouverts » tous les dossiers non clôturés.
- Un changement d'état est inscrit au journal du dossier et des fiches concernées.

### 10.2 Recherche globale

Plus de limite à 4 résultats par groupe. Chaque groupe renvoie jusqu'à 50 résultats, et indique s'il y en a davantage. La liste déroulante a une hauteur maximale et défile, à la molette comme au clavier (l'élément sélectionné reste visible) ; les titres de groupe indiquent le nombre de résultats.

### 10.3 Dossiers sans employé ni machine

- L'employé et la machine d'un dossier sont **facultatifs**, séparément. On peut les choisir, les changer ou les retirer plus tard depuis le dossier ouvert, tant qu'il n'est pas clôturé.
- Une affectation n'est démarrée automatiquement que si le dossier a les deux.
- Sans employé ou sans machine, les variables correspondantes s'affichent « — » et les blocs `employe` / `machine` d'un nouveau document ne sont pas préremplis.

### 10.4 Citations : documents et dossiers visibles sur le profil

Le profil d'un employé ou d'une machine montre **tous les documents où il figure**, et les dossiers qui les contiennent. Une fiche figure dans un document quand :

1. un bloc `employe` ou `machine` du document la désigne (citation certaine) ; ou
2. elle est l'employé ou la machine du dossier qui contient le document ; ou
3. son nom est écrit dans une valeur saisie du document (champ, zone, cellule de tableau) : pour un employé, le nom et le prénom ensemble, dans un ordre ou l'autre ; pour une machine, son identifiant en mot entier. La comparaison ignore la casse et les accents. Un employé sans prénom n'est pas recherché de cette façon.

Pour chaque document : son nom, le nom de son modèle (« Fiche d'intervention informatique », « Fiche d'identification »… ou « Fichier importé »), le dossier, la date du document, et la façon dont la fiche y figure. Un clic ouvre le document dans son dossier. Les dossiers liés d'une fiche sont ceux dont elle est l'employé ou la machine, plus ceux qui contiennent un document où elle figure.

Ces citations sont calculées à la lecture, jamais stockées. Elles apparaissent aussi dans l'historique de la fiche, à la date du document, avec un intitulé qui dit de quoi il s'agit (« Fiche d'intervention informatique : Document_02 »), cliquable comme les autres.

### 10.5 Identifiant d'un employé

L'identifiant reste calculé automatiquement à partir du nom, du prénom, de la date de naissance et du poste, mais **on ne doit plus pouvoir le deviner ni en lire quoi que ce soit**.

- Calcul : empreinte à clé (HMAC-SHA-256) du nom, du prénom, de la date de naissance et du poste normalisés, avec une clé secrète tirée au hasard à la création de la base et conservée dans la base. Les 50 premiers bits sont écrits en dix caractères d'un alphabet sans caractères ambigus (ni I, L, O, U).
- Forme : `EMP-XXXXX-XXXXX`.
- Mêmes informations dans la même base : même identifiant. En cas de collision, on prend les bits suivants de l'empreinte.
- Il manque une information : pas d'identifiant, fiche « à compléter », comme avant. Il est recalculé quand l'une des quatre informations change.
- Migration : tous les identifiants d'employés existants sont recalculés. L'ancien identifiant est inscrit au journal de la fiche (« Ancien identifiant : BENSO-140590-TEC »).
- Le formulaire continue d'afficher en direct l'identifiant qui sera attribué, sans décrire sa composition.

### 10.6 Champs obligatoires

Dans toute l'application, un champ obligatoire porte une **étoile rouge** après son libellé, et chaque formulaire qui en contient affiche la mention « * champ obligatoire ». L'étoile est doublée de l'attribut `required` / `aria-required` ; un formulaire incomplet n'est pas envoyé et désigne le premier champ manquant.

- Employé : nom, prénom, date de naissance, poste et structure sont obligatoires à la création et à la modification. Les fiches incomplètes venues d'une version précédente restent « à compléter » jusqu'à leur prochaine modification.
- Machine : nom et type de machine. L'identifiant reste facultatif.
- Dossier : nom, année et thème.
- Partout ailleurs où une saisie vide est refusée aujourd'hui (noms dans Paramètres, fenêtres de création et de renommage, nom d'un modèle, nom d'un état…) : l'étoile.
- **Modèles** : chaque bloc de saisie (`champ`, `zone`, `date`, `case`, `choix`, `tableau`, `magasin`, `employe`, `machine`, `signature`) peut être marqué « Champ obligatoire » dans le Studio. Dans le document, le bloc porte l'étoile ; le document affiche le nombre de champs obligatoires restant à remplir et les met en évidence. Cela informe et n'empêche ni l'enregistrement ni la clôture.
- Dans les quatre modèles standards, sont obligatoires : les blocs `employe` et `machine`, et le tableau de l'état des besoins. Les modèles déjà présents dans une base ne sont pas modifiés.

### 10.7 Contrat

```ts
export type RoleStatut = 'cours' | 'piece' | 'clos' | 'perso';
export type Couleur = 'gris' | 'bleu' | 'turquoise' | 'vert' | 'ambre' | 'orange' | 'rouge' | 'rose' | 'violet';
export interface StatutDossier { id: number; nom: string; couleur: Couleur; role: RoleStatut; nbDossiers: number }
export interface DossierResume { /* … */ statut: StatutDossier; aId: number | null; aNom: string | null; bId: number | null; bNom: string | null }
export interface DossierDetail { /* … */ a: Entite | null; b: Entite | null }
export interface BlocModele { /* … */ obligatoire?: boolean }
export type FaconDeFigurer = 'bloc' | 'dossier' | 'texte';
export interface DocumentLie extends DocumentFichier { dossierNom: string; modeleNom: string; facons: FaconDeFigurer[] }
export interface TableauDeBord { /* … */ repartition: { statut: StatutDossier; nb: number }[] }
export interface ResultatsRecherche { a: Entite[]; b: Entite[]; dossiers: DossierResume[]; aTotal: number; bTotal: number; dossiersTotal: number }

statutsLister(): Promise<StatutDossier[]>;
statutCreer(nom: string, couleur: Couleur): Promise<StatutDossier>;
statutModifier(id: number, saisie: { nom: string; couleur: Couleur }): Promise<StatutDossier>;   // états ajoutés seulement
statutSupprimer(id: number): Promise<void>;
dossierDefinirStatut(id: number, statutId: number): Promise<DossierResume>;
dossierCreer(saisie: { nom: string; annee: number; themeId: number; aId: number | null; bId: number | null; statutId: number | null }): Promise<DossierResume>;   // statutId absent = « En cours »
dossierDefinirFiches(id: number, aId: number | null, bId: number | null): Promise<DossierResume>;
```

`FicheEntite.documents` contient les documents où la fiche figure (§10.4), `FicheEntite.dossiers` les dossiers liés au sens du §10.4, et `FicheEntite.evenements` inclut les citations calculées. Un événement calculé porte le type `document_cite` et un `documentId` ; `Evenement` gagne `documentId: number | null` et `documentNom: string | null`.

### 10.8 Migration et version

Migration 004 (`user_version = 4`) : table des états, dossiers rattachés à un état et à des fiches facultatives, clé secrète, identifiants recalculés. Les états actuels des dossiers sont repris à l'identique. Le contrôle du schéma à l'ouverture accepte les versions 1 à 4 exactement conformes, avec la sauvegarde préalable. L'application passe en **1.3.0**.

## 11. Version 1.4 — Dossiers sans rattachement, nominations datées, recherche dans les profils, suppression de modèles

Cette section complète et, là où elle le contredit, remplace ce qui précède.

### 11.1 Un dossier n'est plus rattaché à un employé ni à une machine

Le rattachement d'un dossier à un employé et à une machine disparaît entièrement : la section « Employé et machine » du dossier ouvert, les champs Employé et Machine du formulaire de dossier, leur mention sur les cartes, dans l'arborescence et dans la recherche, le bouton « Créer un dossier » des fiches, et l'affectation automatique à la création d'un dossier. **Une fiche n'est liée à un dossier que parce qu'elle est nommée dans l'un de ses documents.**

- Une fiche est **nommée** dans un document quand un bloc `employe` ou `machine` la désigne, ou quand son nom est écrit dans une valeur saisie (règles du §10.4, cas 1 et 3). Le cas « employé ou machine du dossier » n'existe plus.
- Les variables « Employé · … » et « Machine · … » d'un document se lisent désormais dans le document lui-même : elles prennent la fiche désignée par son premier bloc `employe`, respectivement `machine`, et valent « — » s'il n'y en a pas.
- **Fichiers importés** : un fichier importé n'a aucun champ, donc personne ne pourrait y être nommé. Il porte deux blocs facultatifs, « Employé concerné » et « Machine concernée », affichés au-dessus de l'aperçu, avec l'aide à la saisie.
- Une machine ne s'affecte plus que depuis une fiche (§9.3).

### 11.2 Nominations datées

Les nominations sont **enregistrées**, avec le champ et le moment.

- Table `nominations(document_id, entite_id, facon, champ, depuis)` : `facon` vaut `bloc` ou `texte` ; `champ` est le libellé du bloc où la fiche est nommée (pour un tableau, le libellé de la colonne) ; `depuis` est le moment où la nomination est apparue.
- Elle est tenue à jour à chaque création et enregistrement d'un document (les nominations apparues sont ajoutées avec l'heure courante, les disparues retirées, les autres gardent leur date), et pour toute fiche créée, renommée ou dont l'identifiant change (ses nominations par le texte sont recalculées sur tous les documents). Supprimer un document supprime ses nominations.
- **Profil** : « Documents où figure l'employé / la machine » donne pour chaque document son modèle, son nom, son dossier, sa date, **le ou les champs où la fiche est nommée** et la façon. Les dossiers liés d'une fiche sont ceux qui contiennent un document où elle est nommée.
- **Historique** : chaque nomination est un événement à la date `depuis` : « Nommé dans {modèle} : {document} », avec en détail le champ (« Champ « Utilisateur » ») et le dossier, les trois étant cliquables comme les autres liens. Les événements d'un dossier (ouverture, changement d'état, clôture) apparaissent dans l'historique des fiches nommées dans ses documents.

### 11.3 Recherche dans les profils

- La section « Documents où figure… » a un champ de recherche qui filtre sur le nom du document, le modèle, le dossier, le champ et la date (au format JJ/MM/AAAA ou par année), sans tenir compte de la casse ni des accents. Les étiquettes du résumé par modèle sont des filtres cliquables, cumulables avec la recherche. Le nombre de documents affichés sur le total est indiqué, et un état vide dit qu'aucun document ne correspond.
- Chaque onglet d'historique d'une fiche a le même champ de recherche, sur le titre, le détail et la date des événements.
- Le filtrage est fait dans l'interface, sur les données déjà chargées ; la liste reste bornée par paquets comme aujourd'hui.

### 11.4 Suppression d'un modèle

Un modèle peut être **supprimé**, et plus seulement archivé, à condition qu'aucun document n'ait été créé à partir de lui.

- Chaque document garde la référence de son modèle (`modele_id`). Pour les documents existants, elle est retrouvée à la migration par le nom du modèle quand il est sans ambiguïté.
- Suppression refusée tant qu'un document vient de ce modèle, avec le nombre : « 3 documents ont été créés à partir de ce modèle. Archivez-le si vous ne voulez plus l'utiliser. » L'interface explique pourquoi la suppression est indisponible plutôt que de la cacher. Une suppression demande une confirmation.
- Un modèle standard peut être supprimé dans les mêmes conditions ; « Restaurer les modèles standards » le recrée.

### 11.5 Migration 005 (`user_version = 5`)

Rien ne doit être perdu.

- Pour chaque dossier rattaché à un employé ou à une machine, chacun de ses documents reçoit ce rattachement : si le document n'a pas déjà un bloc `employe` (respectivement `machine`) qui désigne cette fiche, un bloc `employe` « Employé » (respectivement `machine` « Machine ») désignant la fiche est ajouté à la fin de ses blocs — ou renseigné, s'il existe déjà et qu'il est vide. Les fichiers importés reçoivent leurs deux blocs, renseignés de la même façon.
- Les colonnes de rattachement des dossiers sont supprimées ; `modele_id` est ajouté aux documents ; la table `nominations` est créée et remplie à partir des documents, avec pour date la création du document.
- Le journal existant est conservé.
- Le contrôle du schéma à l'ouverture accepte les versions 1 à 5 exactement conformes, avec la sauvegarde préalable.

### 11.6 Contrat

```ts
export interface DossierResume { /* … sans aId, aNom, bId, bNom */ }
export interface DossierDetail { /* … sans a ni b ; entitesCitees reste */ }
export type FaconDeFigurer = 'bloc' | 'texte';
export interface DocumentLie extends DocumentFichier { dossierNom: string; modeleNom: string; facons: FaconDeFigurer[]; champs: string[]; depuis: string }
export interface DocumentFichier { /* … */ modeleId: number | null }
export interface Modele { /* … */ nbDocuments: number }
export interface Evenement { /* … */ champ: string | null }      // renseigné pour une nomination

dossierCreer(saisie: { nom: string; annee: number; themeId: number; statutId: number | null }): Promise<DossierResume>;
modeleSupprimer(id: number): Promise<void>;
// dossierDefinirFiches est retirée
```

Le type d'événement d'une nomination est `nomination` ; `document_cite` disparaît.

### 11.7 Version

L'application passe en **1.4.0**.

## 12. Version 1.4.1 : renommage en INVENTORY

L'application s'appelle désormais **INVENTORY**. C'est un renommage, sans aucun changement fonctionnel.

**Ce qui change.** Nom du produit (`productName`), titre de la fenêtre, barre de titre, titre de la page, éditeur et copyright de l'installateur, messages natifs (« INVENTORY ne peut pas démarrer »), messages de base refusée ; exécutable `inventory.exe` (`mainBinaryName`) ; installateur `INVENTORY_1.4.1_x64-setup.exe` ; dossier d'installation proposé `%LOCALAPPDATA%\INVENTORY` ; raccourcis « INVENTORY » ; clé de désinstallation `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\INVENTORY`.

**Ce qui ne change pas, et pourquoi.**

- L'identifiant `fr.entitesdossiers.app` : c'est lui qui fixe le dossier de données `%APPDATA%\fr.entitesdossiers.app` (et le profil WebView2 sous `%LOCALAPPDATA%\fr.entitesdossiers.app`). Le changer ferait repartir l'application d'un dossier vide : les données existantes ne seraient plus trouvées.
- Le schéma de la base : aucune migration, `user_version` reste à 5. Une base de la 1.4.0 est ouverte telle quelle, sans sauvegarde `avant-version-…`.
- La variable de test `ENTITES_DOSSIERS_DONNEES`, les noms internes (paquet npm et crate Cargo `entites-dossiers`, bibliothèque `entites_dossiers_lib`, préfixes CSS et dossiers temporaires) : ils ne sont pas visibles de l'utilisateur, et les changer n'apporterait rien.

**Reprise de l'ancienne installation.** L'installateur NSIS range l'installation sous le nom du produit : sans précaution, INVENTORY s'installerait à côté d'« Entités et Dossiers », les deux sur les mêmes données. Avant d'installer, l'installateur (crochet `NSIS_HOOK_PREINSTALL` de `src-tauri/windows/hooks.nsh`) cherche la clé de désinstallation « Entités et Dossiers » (HKCU, puis HKLM par précaution) et, si elle existe, retire l'ancienne installation à la main : raccourcis « Entités et Dossiers » du menu Démarrer et du bureau qui pointent vers l'ancien exécutable, fichiers `entites-dossiers.exe` et `uninstall.exe` de l'ancien dossier, puis ce dossier s'il est vide, clé de désinstallation et clé `Software\Entités et Dossiers`. L'ancien `uninstall.exe` n'est pas lancé : il contient une suppression du dossier de données (case « Supprimer les données de l'application ») ; le retrait manuel ne vise que ces deux fichiers et un dossier vide, il ne peut pas toucher aux données. Si l'ancienne application est ouverte, l'installateur demande de la fermer, comme il le fait pour l'application courante ; si l'ancien exécutable ne peut pas être supprimé, l'installation s'arrête avec un message.

## 13. Version 1.5 — Suppression directe des documents, des employés et des machines

Objectif : pouvoir supprimer directement les documents déjà créés, ainsi que les employés et les machines, en plus de l'archivage. L'archivage reste tel qu'il est ; la suppression s'ajoute à côté.

### 13.1 Supprimer un document directement

La suppression d'un document existe déjà (§ 4), mais seulement une fois le document ouvert. Elle devient accessible **directement, sans ouvrir le document**, partout où un document est listé :

- dans le dossier : sur chaque ligne de document du contenu (liste et arborescence) ;
- dans la fiche d'un employé ou d'une machine : sur chaque ligne de la liste des documents où la fiche est nommée ;
- le bouton du document ouvert reste.

Le bouton est une icône « corbeille » avec infobulle et nom accessible « Supprimer le document », visible sans survol. Confirmation avant toute suppression, qui nomme le document et son dossier, et précise le cas du fichier importé (sa copie est supprimée) : « Cette action est irréversible. » Les règles ne changent pas : refus dans un dossier clôturé (bouton désactivé, avec l'explication « Rouvrez le dossier pour le modifier. » plutôt que caché), suppression des nominations du document, de sa copie dans `fichiers/`. Après suppression depuis une fiche, la liste, son compteur « N sur M » et l'historique sont à jour sans rechargement.

En 1.5, un dossier ne se supprimait pas (non demandé) ; il se supprime depuis la version 1.6 (§ 15).

### 13.2 Supprimer un employé ou une machine

Sur la fiche, à côté de « Archiver » / « Réactiver » : **« Supprimer »**. La suppression est toujours possible, que la fiche soit active ou archivée, affectée ou non, nommée dans des documents ou non. Elle est définitive.

**Confirmation.** La fenêtre dit précisément ce qui va se passer, avec les nombres réels (`entiteSuppressionApercu`) :

- le nom et l'identifiant de la fiche ;
- l'affectation en cours qui sera terminée et le nombre d'affectations passées qui disparaîtront de son historique. Pour un employé : « L’affectation de la machine « … » à cet employé prendra fin. » (pluriel : « Les affectations des machines « … » et « … » à cet employé prendront fin. ») — la machine peut rester affectée à un autre employé, la phrase ne dit donc pas qu'elle ne sera plus affectée à personne. Pour une machine : « L’employé « … » n’aura plus cette machine. » ;
- le nombre de documents et de dossiers où la fiche est nommée : « Son nom reste écrit dans ces 4 documents, mais ils ne mèneront plus à sa fiche. » ;
- « Son historique sera supprimé. Cette action est irréversible. Pour garder la fiche et son historique, archivez-la plutôt. » — avec un bouton « Archiver plutôt » quand la fiche est active.

Le bouton de confirmation s'appelle « Supprimer définitivement ».

**Effets** (une seule transaction ; en cas d'échec rien n'est modifié) :

1. La ligne de `entites` est supprimée, avec ses `affectations` (en cours et passées) et ses `nominations`.
2. **Les documents ne perdent aucun texte.** Un bloc `employe` ou `machine` qui désignait la fiche garde le nom (et l'identifiant) affichés comme texte, suivi de la mention « fiche supprimée » ; il ne mène plus nulle part et la fiche n'est plus proposée. Si le bloc ne stocke aujourd'hui que le numéro de la fiche, le nom et l'identifiant y sont inscrits au moment de la suppression — y compris dans les dossiers clôturés (c'est une conservation du contenu, pas une modification par l'utilisateur). Les variables d'un document qui affichaient le nom ou l'identifiant de cette fiche continuent d'afficher ces valeurs. Les colonnes et cellules de tableau qui désignaient la fiche suivent la même règle. L'utilisateur peut ensuite choisir une autre fiche dans le bloc, si le dossier n'est pas clôturé.
3. **L'historique des autres ne disparaît pas.** Les événements du journal rattachés aussi à une autre fiche ou à un dossier (affectation, fin d'affectation, nomination) restent dans l'historique de cette autre fiche et de ce dossier, avec le nom de la fiche supprimée en texte non cliquable et la mention « supprimé(e) ». Les événements qui n'appartenaient qu'à la fiche supprimée (création, modification, archivage…) sont supprimés.
4. Un événement `fiche_supprimee` est ajouté au journal, rattaché à aucune fiche ni dossier : « Employé « Nom Prénom » supprimé » / « Machine « Nom » supprimée ». Il sert de trace dans la base ; aucun écran n'affiche aujourd'hui le journal général.
5. La fiche disparaît du répertoire, de la recherche globale, des suggestions, des compteurs du tableau de bord et du compteur `nbFiches` de sa structure ou de son type (qui peut donc devenir supprimable, § 9).

Recréer plus tard un employé avec les mêmes nom, prénom, date de naissance et poste redonne le même identifiant (§ 10) : c'est une nouvelle fiche, sans lien avec les anciens documents sauf par le texte (nomination `texte`, recalculée comme pour toute fiche créée).

Après la suppression, l'interface revient au répertoire correspondant (Employés ou Machines) avec un message bref « … supprimé ». Toute page encore ouverte sur la fiche supprimée (historique de navigation, lien d'un ancien événement) affiche « Cette fiche a été supprimée. » avec un retour au répertoire, sans erreur.

### 13.3 Migration

Migration 006 (`user_version = 6`) : deux colonnes ajoutées à `evenements`, `a_libelle_supprime` et `b_libelle_supprime` (texte, nul par défaut). Elle est nécessaire parce que SQLite peut redonner le numéro d'une fiche supprimée à une nouvelle fiche : les événements gardés ne conservent donc pas ce numéro (`a_id` / `b_id` passent à nul) mais le nom, en texte. Sauvegarde `avant-version-6_…` comme pour les précédentes, contrôle du schéma étendu aux versions 1 à 6, aucune donnée existante modifiée ni perdue.

Dans un document, le bloc dont la fiche est supprimée devient `entiteId: null` avec une copie `ficheSupprimee` (nom, identifiant, libellé et caractéristiques au moment de la suppression) ; la copie disparaît si l'utilisateur choisit une autre fiche. Un tableau ne contient que du texte : ses cellules ne sont pas concernées.

### 13.4 Contrat

```ts
export interface SuppressionApercu {
  affectationEnCours: { id: number; nom: string } | null;   // la plus récente
  affectationsEnCours: { id: number; nom: string }[];       // toutes : une machine peut avoir plusieurs employés
  nbAffectationsPassees: number;
  nbDocuments: number;                                      // documents où la fiche est nommée
  nbDossiers: number;                                       // dossiers distincts de ces documents
}

entiteSuppressionApercu(id: number): Promise<SuppressionApercu>;
entiteSupprimer(id: number): Promise<void>;
// documentSupprimer(id) existe déjà et ne change pas.
// Type d'événement ajouté : 'fiche_supprimee'.
export interface Evenement { /* … */ aSupprime: boolean; bSupprime: boolean }   // aId / bId nuls, aLibelle / bLibelle gardés
export interface BlocDocument { /* … */ ficheSupprimee?: FicheSupprimee }       // seulement si entiteId === null
```

### 13.5 Version

L'application passe en **1.5.0** (nom INVENTORY, § 12).

## 14. Version 1.5.1 — premier lancement sur une base vide

### 14.1 Base neuve

Au premier lancement d'une installation neuve (aucune base dans le dossier des données, ou base jamais initialisée : aucun paramètre `donnees_exemple`), la base est créée **vide**. Elle contient seulement :

- les quatre modèles standards (§ 8.6) — État des besoins, Fiche d'intervention informatique, Fiche d'identification, Fiche pour formatage PC —, actifs, et leur thème « Support informatique » ;
- les trois états de dossier fournis (« En cours », « Pièce manquante », « Clôturé ») et la clé des identifiants (§ 10.5), créés par les migrations ;
- `donnees_exemple = 0` ; les préférences d'affichage ne sont pas écrites (valeurs par défaut : thème Système, densité Équilibrée).

Aucun employé, aucune machine, aucune affectation, aucun dossier, sous-dossier, document, fichier importé, événement ni nomination ; aucun autre thème, aucune structure, aucun type de machine, aucun mot-clé du Magasin. La barre de titre n'affiche pas « Données d'exemple ».

C'est exactement l'état laissé par « Effacer toutes les données » (6.4) sur une base sans préférences enregistrées : les deux passent par la même fonction (`domaine::donnees` : `donnees_exemple = 0`, puis `modeles::assurer_standards`). Le premier lancement n'efface rien.

### 14.2 Bases existantes

Une base déjà initialisée (paramètre `donnees_exemple` présent, à 0 ou à 1) est ouverte telle quelle : ni vidée, ni remplie ; un modèle standard archivé ou supprimé n'est pas recréé à l'ouverture. Aucune migration : `user_version` reste 6.

### 14.3 Données d'exemple

Elles restent disponibles à la demande : Paramètres 6.4, « Recharger les données d'exemple » (inchangé, précédé d'une sauvegarde). L'exécutable n'a aucune autre façon de les charger (ni variable d'environnement, ni option). La suite de bout en bout les charge par ce bouton (scénario `donnees-exemple`), après avoir contrôlé la base vide (`premier-lancement`) et le parcours « de zéro » (`de-zero`).

### 14.4 Partir de zéro

Un employé appartient à une structure et une machine a un type ; une base neuve n'en a aucun. Le formulaire « Créer un employé » (« Créer une machine ») le dit — « Aucune structure pour l'instant » (« Aucun type de machine pour l'instant ») — et propose de créer la première sur place : nom obligatoire, « Créer la structure » (« Créer le type »). Elle est aussitôt choisie dans la liste, sans quitter le formulaire ni perdre ce qui est déjà saisi ; « Enregistrer la fiche » reste inactif tant qu'il n'y en a aucune. S'il n'en existe que d'archivées, le titre reste « Aucune structure active » (« Aucun type de machine actif ») et un bouton ouvre les Paramètres (6.2) pour les réactiver. Un dossier n'a besoin que d'un thème (celui des modèles standards existe) et d'un état (« En cours » par défaut) ; aucun bloc des modèles standards ne dépend du Magasin.

Sur une base vide, chaque écran a un état vide qui dit quoi faire :

- tableau de bord : compteurs à 0 (le compteur « Fiches à compléter » n'est en alerte que s'il y a des fiches à compléter), graphiques sans valeur, « Aucun employé pour l'instant. Créez le premier depuis Employés, avec « Créer un employé ». », de même pour les machines et les dossiers ouverts ; « Toutes les fiches des employés sont complètes » (« Toutes les machines ont un identifiant ») ne s'affiche que s'il existe des fiches ;
- Employés, Machines, Dossiers & Archives : « Aucun … pour l'instant », avec le bouton de création ;
- recherche globale : « Aucun résultat pour « … ». Essayez un nom, un prénom, une marque ou un identifiant. » ;
- Création › Modèles de document : les quatre modèles standards.

### 14.5 Version

L'application passe en **1.5.1**.

## 15. Version 1.6 — Suppression d'un dossier

Objectif : pouvoir supprimer directement, depuis « Dossiers & Archives », un dossier avec tout son contenu.

### 15.1 Règle

Un dossier se supprime avec tout son contenu, quel que soit son état (en cours, pièce manquante, état ajouté, clôturé), vide ou non. C'est définitif. En une seule transaction (en cas d'échec, rien n'est modifié, ni en base ni sur le disque) :

- le dossier, ses sous-dossiers (toute profondeur), ses documents, ses options et les nominations de ses documents sont supprimés ; les copies de ses fichiers importés sont supprimées de `fichiers/` comme pour un document (mises de côté d'abord ; une copie verrouillée par une autre application fait refuser la suppression, « fichier_ouvert », sans rien supprimer) ;
- journal : les événements rattachés au dossier sont supprimés ; aucun événement ne garde son numéro, qu'un nouveau dossier peut recevoir ;
- chaque employé ou machine nommé dans au moins un de ses documents reçoit un événement `dossier_supprime`, rattaché à la fiche seule : « Dossier « Nom » supprimé », « Il contenait N document(s) où cet employé était nommé. » / « … où cette machine était nommée. », sans lien ;
- fiches, affectations, modèles, thèmes et états ne sont pas touchés ; le nombre de documents des modèles et le nombre de dossiers des états suivent ;
- par prudence, si la suppression atteignait le contenu d'un autre dossier (base incohérente), elle est refusée (« donnees_incoherentes ») ; une copie aussi référencée par un document d'un autre dossier n'est pas supprimée.

Aucune migration : `user_version` reste 6.

### 15.2 Interface

- « Dossiers & Archives » : une corbeille « Supprimer le dossier » sur chaque carte (vue Groupes, quel que soit le regroupement) et au bout de la ligne de chaque dossier dans l'arborescence ; elle n'ouvre pas le dossier.
- Dossier ouvert, à sa racine : bouton « Supprimer le dossier » (style danger) après « Renommer », clôturé compris. Dans un sous-dossier, « Supprimer » vise toujours le sous-dossier.
- Confirmation « Supprimer le dossier ? » alimentée par l'aperçu (nombres réels), « Supprimer définitivement » en rouge, focus sur « Annuler ». Après : message « Dossier « Nom » supprimé. » ; on reste sur la liste, ou on y revient depuis le dossier ouvert. Une page ouverte sur un dossier supprimé affiche « Ce dossier a été supprimé. » avec « Retour aux dossiers ».
- La confirmation de suppression d'un document a désormais elle aussi un bouton rouge et le focus sur « Annuler ».

### 15.3 Contrat

```ts
export interface DossierSuppressionApercu {
  nbSousDossiers: number;
  nbDocuments: number;          // sous-dossiers compris
  nbFichiersImportes: number;   // documents importés dont la copie sera supprimée du disque
  nbFichesNommees: number;      // employés et machines distincts nommés dans ses documents
}
dossierSuppressionApercu(id: number): Promise<DossierSuppressionApercu>;
dossierSupprimer(id: number): Promise<void>;
// type d'événement ajouté : 'dossier_supprime'
```

### 15.4 Version

L'application passe en **1.6.0**.

## 16. Version 1.7 — Catégories (ex-thèmes) modifiables

### 16.1 Vocabulaire

À l'écran, le classement des dossiers et des modèles de document s'appelle désormais **catégorie** (« la catégorie », « Aucune catégorie »…) au lieu de « thème » : Paramètres, création et en-tête d'un dossier, filtres et regroupement de « Dossiers & Archives », Studio, messages d'erreur. La section 6.2 de Paramètres s'intitule « Catégories, états, structures et types de machine ». Le mot « catégorie » n'est plus employé à l'écran pour les structures (employés) ni pour les types de machine. Le **thème d'affichage** (Système / Clair / Sombre, section 6.1) ne change pas.

En interne, rien n'est renommé : table `themes`, colonnes `theme_id`, champs `themeId` / `theme`, commandes `themes_lister`, `theme_creer`, `theme_basculer`. Les noms des catégories existantes ne sont pas modifiés. Aucune migration : `user_version` reste 6.

### 16.2 Règles

- **Ajouter, archiver / réactiver** : inchangés. Une catégorie archivée n'est plus proposée pour un nouveau dossier, un nouveau classement de dossier ou de modèle ; ce qui y est déjà rangé y reste.
- **Renommer** (active ou archivée) : nom obligatoire, 200 caractères au plus, refusé (`doublon`, « Cette catégorie existe déjà. ») s'il est déjà porté par une autre catégorie, sans tenir compte des espaces aux extrémités ni de la casse, lettres accentuées comprises (même comparaison que pour les structures, désormais aussi à la création). Changer seulement la casse est permis. Le nom est lu partout par jointure : dossiers, modèles, filtres, recherche suivent aussitôt.
- **Supprimer** (active ou archivée) : seulement si aucun dossier et aucun modèle de document, actif ou archivé, n'y appartient. Sinon refus `categorie_utilisee` : « Cette catégorie contient encore 3 dossiers et 2 modèles de document. Déplacez-les ou supprimez-les avant de la supprimer. » (« 1 dossier. Déplacez-le ou supprimez-le », « 1 modèle de document », etc.). Paramètres affiche pour chaque catégorie « N dossiers · N modèles » ; le bouton « Supprimer » reste atteignable et explique le motif quand la suppression est impossible ; sinon une confirmation est demandée.
- **Changer la catégorie d'un dossier** : liste « Catégorie » dans l'en-tête du dossier ouvert (à sa racine), catégories actives plus la catégorie actuelle ; refusé pour un dossier clôturé (`dossier_clos`) et vers une catégorie archivée (`theme_archive`). Aucun événement de journal. Celle d'un modèle se change dans le Studio (inchangé).
- **Plus aucune catégorie active** : le formulaire « Créer un dossier » et le Studio affichent « Aucune catégorie pour l'instant » (ou « Aucune catégorie active ») avec la création sur place, la saisie étant conservée.
- **« Support informatique »** (catégorie des modèles standards) se renomme comme les autres et ne se supprime que vide. Les modèles standards sont retrouvés par leur nom de modèle, jamais par le nom de leur catégorie : un renommage ne recrée rien au démarrage. Si « Restaurer les modèles standards » doit recréer un modèle manquant et qu'aucune catégorie ne s'appelle « Support informatique », cette catégorie est recréée pour l'y ranger.

### 16.3 Contrat

```ts
export interface ThemeClassement extends Classement { nbDossiers: number; nbModeles: number }
themesLister(): Promise<ThemeClassement[]>;                 // avec les nombres (actifs et archivés)
themeRenommer(id: number, nom: string): Promise<Classement>; // 'saisie_invalide' | 'doublon' | 'introuvable'
themeSupprimer(id: number): Promise<void>;                  // 'categorie_utilisee' | 'introuvable'
dossierDefinirTheme(id: number, themeId: number): Promise<DossierResume>; // 'dossier_clos' | 'theme_archive' | 'introuvable'
```

### 16.4 Version

L'application passe en **1.7.0**.

## 17. Version 1.8 — Mots-clés du Magasin modifiables, numéros de module retirés

### 17.1 Mots-clés du Magasin

Un document garde le mot-clé choisi dans un bloc « Choix du Magasin » sous forme de **texte** (`val` du bloc `magasin` dans le JSON des blocs), pas sous forme de numéro. La page Magasin offre, sur chaque mot-clé, les mêmes boutons que les catégories (§ 16) : « Renommer » (en place), « Archiver » / « Réactiver », « Supprimer », et affiche sous chaque nom « Choisi dans N documents » (dossiers ouverts et clôturés ; un document est compté une fois s'il a plusieurs blocs portant ce mot-clé).

- **Ajouter, archiver / réactiver** : inchangés ; le refus d'un doublon suit désormais la même comparaison que les catégories.
- **Renommer** (actif ou archivé) : nom obligatoire, 200 caractères au plus, refusé (`doublon`, « Ce mot-clé existe déjà dans le Magasin. ») s'il est déjà porté par un autre mot-clé, sans tenir compte des espaces aux extrémités ni de la casse, lettres accentuées comprises. Changer seulement la casse est permis. C'est une correction de libellé : dans la même transaction, chaque bloc `magasin` de document dont la valeur est **exactement** l'ancien nom reçoit le nouveau, dossiers clôturés compris ; les autres blocs (même texte dans un champ, autre casse, nom plus long qui commence pareil) ne changent pas, et la date de modification des dossiers non plus.
- **Supprimer** (actif ou archivé) : toujours possible, après confirmation « Ce mot-clé est choisi dans 3 documents. Il y restera écrit, mais ne sera plus proposé. » (« … dans 1 document. … » ; « Ce mot-clé n’est choisi dans aucun document. »), suivie de « Cette action est irréversible. ». Aucun document n'est modifié : la valeur reste affichée dans le document (comme pour un mot-clé archivé), le document s'enregistre normalement et, si le dossier n'est pas clôturé, une autre valeur peut y être choisie. Un mot-clé recréé plus tard sous le même nom est de nouveau proposé, et les documents qui portaient ce texte le retrouvent.
- Aucune migration : `user_version` reste 6.

```ts
export interface MotCleMagasin extends Classement { nbDocuments: number }
magasinLister(): Promise<MotCleMagasin[]>;                     // avec le nombre de documents
magasinRenommer(id: number, nom: string): Promise<MotCleMagasin>; // 'saisie_invalide' | 'doublon' | 'introuvable'
magasinSupprimer(id: number): Promise<void>;                   // 'introuvable'
```

### 17.2 Numéros de module retirés de l'affichage

- La petite ligne au-dessus du titre des pages ne dit plus « Module N ». Il reste « Dossier ouvert », « Fiche », « Formulaire », « Studio de Modèles », « Dossier » ; les pages Tableau de bord, Employés, Machines, Dossiers & Archives, Création, Magasin et Paramètres n'ont plus cette ligne (pas d'espace laissé à sa place). Règle (`src/lib/bandeau.ts`) : pas de ligne si elle est vide ou répète le titre.
- Les numéros 1 à 6 des entrées de la barre latérale ne s'affichent plus (ils ne correspondaient à aucun raccourci clavier).
- Les numéros de section (« 5.7 », « 4.3 »…) ne s'affichent plus devant les titres de section ; ils restent dans le code (`num`) et se réaffichent en passant `AFFICHER_NUMERO_SECTION` à `true` dans `src/ui/Section.tsx`. Les références « § » et numéros de section de cette spécification ne changent pas.

### 17.3 Version

L'application passe en **1.8.0**.

## 18. Version 1.8.1 — modèles standards neutres

Les quatre modèles standards ne reprennent plus aucune information propre à un organisme réel :

- **En-têtes** : un bloc « Nom de l'organisme » suivi de « Adresse · Téléphone » (deux lignes d'un même bloc `texte`), puis, sauf dans l'État des besoins (qui garde son champ « Division »), un bloc « Nom de la division ou du service ». Ni pays, ni tutelle, ni numéro. L'utilisateur les adapte dans le Studio.
- **Fiche d'identification** : la consigne d'accès à la messagerie devient « Tapez l'adresse web de la messagerie de votre organisme. » ; la remarque sur la fin de relation professionnelle parle de « l'organisme ».
- **Références et révisions de formulaire** : retirées (blocs supprimés, ou mention retirée du texte du RSSI).
- Les noms des modèles, leur catégorie « Support informatique », leurs champs, leurs choix, leurs signatures et leur ordre ne changent pas.
- **Données d'exemple** : les adresses électroniques fictives sont en `exemple.org` ; une structure d'exemple est renommée « Division administrative ».
- **Bases existantes** : aucune migration, `user_version` reste 6. Les modèles déjà présents dans une base gardent leur texte. Seules une base neuve, « Effacer toutes les données », « Recharger les données d'exemple » et « Restaurer les modèles standards » (qui ne recrée que les modèles manquants, reconnus à leur nom) écrivent le texte neutre.
- Un test (`tests_v181.rs`) échoue si le texte d'un modèle standard contient une adresse web, un domaine national, une suite de plus de 8 chiffres, une abréviation de téléphone ou de fax, une boîte postale, un numéro de révision ou une référence de formulaire.

L'application passe en **1.8.1**.
