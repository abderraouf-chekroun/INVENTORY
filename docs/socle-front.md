# Socle du front — mode d'emploi

> **Note (English):** this document lists the front-end conventions for writing or changing a page: navigation, data reading and invalidation, error display, shared UI components. It is written in French; the front-end overview in English is [`src/README.md`](../src/README.md).

Conventions à suivre pour écrire ou modifier une page. Imports : `../ui`, `../nav`, `../lib/…`, `../api`.

## Une page

```tsx
import type { PageProps } from '../nav';
export default function Fiche({ route }: PageProps<'fiche'>) { … }   // route typée (src/nav/routes.ts)
```

- La page est enregistrée dans `renderPage` (`src/App.tsx`) ; elle renvoie un fragment, que la coquille place dans `.content > .page`, sous le bandeau d'erreur global et le message bref (`montrerAvis`).
- Elle est remontée à chaque nouvelle page (`key={seq}`) : son état local (onglet, modale, formulaire) repart de zéro, et le défilement revient en haut.
- Une erreur de rendu de la page est arrêtée par `LimiteErreur` : la barre de titre, la barre latérale et la recherche restent utilisables.
- Tout le texte affiché est en français, avec le vocabulaire de l'application : Employés, Machines, Dossiers & Archives, Catégories (dossiers et modèles), Structures (employés), Types de machine, États, Magasin. Aucun numéro de module ni de section n'est affiché.

## Navigation (`src/nav`)

- `nav.go(route)` ouvre une page en empilant la page courante.
- `nav.root(route)` ouvre une page en vidant l'historique (entrées de la barre latérale).
- `nav.back()` revient à la page précédente ; le bouton Retour et Alt+← font la même chose.
- `nav.replace(route)` remplace la page courante sans l'empiler. Exemple : après l'enregistrement d'un formulaire, `nav.replace({ name: 'fiche', id: e.id })`.
- `nav.update(route)` change les paramètres de la route **sans** remonter la page ni empiler. Exemple : choisir le document affiché, `nav.update({ ...route, documentId })`.
- Dans un composant, l'état se lit avec `useNav(s => s.route)`.
- Également exportés : `NAV` (les six entrées de la barre latérale), `navEntry(id)`, `repNavId(kind)`, `defaultModule(route)`, `RouteOf<'x'>`.

## Fil d'Ariane et entrée allumée dans la barre latérale

```tsx
useBreadcrumb(crumbs, { module })   // hook : à appeler sans condition, en haut de la page
```

- La coquille ajoute toute seule le premier maillon, celui de l'entrée de la barre latérale, qui ouvre avec `root`. La page ne déclare que la suite.
- Le dernier maillon s'affiche en gras. Les autres maillons qui ont un `to` sont cliquables (`go`).
- `crumbs` à null, undefined ou false (données pas encore chargées) : la coquille affiche le fil par défaut de la route.
- `module` absent : valeur de `defaultModule(route)`.
- Pour une fiche, le module par défaut est `null` : la page doit le déclarer.
  - `useBreadcrumb(f && [{ label: nomAffiche(f.entite) }], { module: f && repNavId(f.entite.kind) })`
- Pour un dossier :
  - `useBreadcrumb([{ label: d.nom, to: { name: 'dossier', id: d.id } }, …sousDossiers.map(s => ({ label: s.nom, to: { name: 'dossier', id: d.id, sousDossierId: s.id } }))])`
- Fil par défaut déjà fourni : `form-entite` (« Créer un employé », « Créer une machine » ou « Modifier la fiche »), `form-dossier` (« Créer un dossier »), `studio` (« Studio de Modèles »), `magasin` (« Magasin »).
- `form-entite` en modification peut déclarer `{ module: repNavId(kind) }`.

## Lire les données (`src/lib/queries.ts`)

- Un hook par lecture du contrat : `useParametres`, `useInfosSysteme`, `useThemes` (catégories des dossiers et des modèles), `useCategories(kind)` (structures ou types de machine), `useMagasin`, `useEntites(kind)`, `useFiche(id)`, `useSuggestions(kind, q)` (aide à la saisie), `useStatuts`, `useDossiers`, `useDossier(id)`, `useDossierNomSuggere(annee)`, `useModeles`, `useTableauDeBord`, `useRecherche(q)`.
- Pour gérer le chargement et l'erreur : `<QueryView query={useFiche(route.id)}>{(f) => …}</QueryView>`. Il n'affiche rien pendant le premier chargement, puis un `.alert.bad` « Chargement impossible » en cas d'erreur.
- Clés de requête : toutes dans `lib/queryKeys.ts` (`qk.fiche(id)`, `qk.dossiers`…). Ne jamais écrire une clé à la main.

## Écrire et invalider (`src/lib/action.ts`)

```tsx
const archiver = useAction((id: number) => api.entiteBasculer(id));
<button className="btn" disabled={archiver.isPending} onClick={() => archiver.mutate(x.id)}>Archiver</button>
```

- **Convention d'invalidation** : par défaut, tout le cache est invalidé après une écriture réussie (`invalidate: 'all'`). Seules les requêtes affichées sont relues.
- Restreindre seulement quand c'est utile : `invalidate: [qk.dossier(id)]`, ou `'none'` pour une action qui ne change pas les données (ouvrir un fichier, enregistrer une copie).
- Options : `onSuccess(data, vars)` (appelé après la relecture), `onError`, `errors`.
- Utiliser `mutate`, pas `mutateAsync`.
- **Saisie d'un document** : elle ne passe pas par `useAction` mais par `useAutosave` (`pages/blocs/autosave.ts`) : envoi environ 400 ms après la dernière frappe, mise à jour locale du cache, aucune relecture pendant la saisie. Avant une action qui dépend de la saisie (changer l'état, renommer, supprimer), appeler `await flushAll()` dans la fonction de l'action.

## Afficher une erreur

- **Par défaut**, l'échec d'un `useAction` s'affiche tout seul dans un bandeau `.alert.bad` collé en haut de la page, avec un bouton « Fermer ». Le bandeau est effacé au changement de page.
- **Près d'un formulaire** (nom en doublon…) : `useAction(fn, { errors: 'local' })`, puis `<ErrorAlert error={action.error} />`, qui ne rend rien si l'erreur est null.
- Depuis n'importe où, même hors composant : `showError(e)` (`lib/errors.ts`).
- Toute erreur est normalisée par `versApiError` (`src/api`) ; le message du back est en français et s'affiche tel quel.
- Après une action qui change de page (suppression d'une fiche…), un message bref s'affiche avec `montrerAvis(texte)` (`lib/avis.ts`), appelé juste après la navigation.

## Composants `src/ui`

- `Icon {name, size=16}` : les icônes du prototype, plus celles ajoutées depuis (`restore`, icônes des types de bloc, `corbeille`, `magasin`…). Type `IconName`.
- `Badge {kind: Statut | 'noid' | 'incomplet' | 'actif' | 'archive'}` : badges de fiche (« Sans identifiant », « Fiche à compléter », « Actif », « Archivé »).
- `StatutBadge {statut, nom?}` : état d'un dossier, dans sa couleur (classe `st-<couleur>`), le nom toujours écrit.
- `EntityCode {code, kind='b'}` : l'identifiant tel quel, en police mono ; sans identifiant, le badge « Fiche à compléter » (employé) ou « Sans identifiant » (machine).
- `PageHeader {eyebrow?, title, lead?, actions?}` : la petite ligne `eyebrow` n'est affichée que si elle n'est pas vide et ne répète pas le titre (`texteBandeau`, `lib/bandeau.ts`).
- `Section {num, title, extra?, children}` : `num` est gardé dans le code mais n'est pas affiché ; `extra`, par exemple `<span className="cnt">…</span>`.
- `Seg<T> {value, options: {value, label, icon?, count?}[], onChange, label?}` · `Chip {pressed, onToggle, children}` · `Select<T> {value, options: (T | [T, libellé])[], onChange, id?, label?, disabled?, required?, className?, style?}` · `Kbd` · `Empty {children}`.
- `Table<T> {heads, rows, rowKey, cells(row) → <td>…, onOpen?, rowClassName?, empty?, label?, className?}` : chevron et ouverture par Entrée inclus ; rendu borné (« Afficher … de plus »).
- `EntityTable {kind, entites, empty?, onOpen?, label?}` : employés : Nom, Identifiant, Poste, Structure ; machines : Nom, Identifiant, Marque et configuration, Type de machine ; puis Statut et Mise à jour (JJ/MM/AAAA). Clic par défaut : ouvre la fiche. Ses colonnes et cellules sont aussi disponibles seules : `colonnesFiche(kind)`, `CellulesFiche {x, archive?}`.
- `ChoixFiche {kind, id, label, value, onChange, …}` : aide à la saisie d'un employé ou d'une machine (8 propositions au plus, clavier ↑ ↓ Entrée Échap) ; `DetailsFiche {e}` : informations d'une fiche choisie.
- `Timeline {items, empty?, courante?}` : regroupée par année (`.tl-year`), dates JJ/MM/AAAA, noms cités cliquables (fiche, dossier, document, champ), sauf la fiche `courante`. Filtrer les événements avant de les passer.
- `FolderCard {dossier: DossierResume, onOpen?}`, dans `<div className="folders">`.
- `FileRow {icon, iconSize=20, title, subtitle?, trailing?, chevron=true, pressed?, onClick}`, dans `<div className="files">`.
- `HubCard {icon, title, text, cta, onClick}`, dans `<div className="hub">`.
- `Tabs {tabs: {label, count?}[], value, onChange, label?}` : clavier ← → Début Fin.
- `Alert {tone: 'warn'|'bad'|'info', title, text?, icon?, children?}` · `ErrorAlert {error, title?='Action impossible', onDismiss?}`.
- `Modal {label, onClose, children}` : fond + `.modal`, Échap et clic sur le fond ferment. Focus sur l'élément `autoFocus` ou le premier élément focalisable, Tab reste dans la fenêtre, le focus revient où il était à la fermeture. Le contenu est libre (`<h3>`, `.choices`, `.opt`, `form.mform`). Usage : `{open && <Modal …/>}`.
- `ConfirmModal {title, message, confirmLabel, action: () => Promise, invalidate?, onDone?, onClose, danger?}` : l'erreur s'affiche dans la fenêtre ; `danger` pour une suppression définitive (bouton rouge, focus sur « Annuler »).
- `RenameModal {title, label, initial, submitLabel='Renommer', action: (nom) => Promise, invalidate?, onDone?, onClose}`.
- `ClassementList` : liste nom / badge / Archiver-Réactiver avec ajout en ligne, et en option Renommer (en place) et Supprimer (avec confirmation, ou le motif quand c'est impossible). Sert aux catégories, structures et types de machine (Paramètres) et aux mots-clés du Magasin.
- Champs obligatoires (`Obligatoire.tsx`) : `<Etoile />` après le libellé, `<Libelle obligatoire>`, `<MentionObligatoire />` dans chaque formulaire qui en contient, et `useChampsObligatoires()` pour refuser l'envoi et mettre le focus sur le premier champ manquant.
- `Surligne {texte, q}` : met en évidence la recherche dans un texte, sans tenir compte de la casse ni des accents.
- Rendu borné : `useBorne(items, pas)` et `PlusDElements` (avec `UNITES`) pour les longues listes ; les pas sont dans `lib/borne.ts`.
- `QueryView` (voir plus haut) et `LimiteErreur` (utilisée par la coquille).

## Autres utilitaires

- **Formatage** (`lib/format.ts`) : `formatDate`, `formatDateHeure`, `yearOf`, `todayIso`, `pad2`, `plural`, `enumeration`, `codeLabel`, `STATUT_LABEL`, `kindLabel`, `kindUn`, `categoryLabel` (« Structure » ou « Type de machine »), `nomAffiche`, `detailFiche`, `caracteristiques`, `libellesFiche`, `champsFiche`, `manquesEmploye`, `digitsOnly`, `texte`, `lettres`, `pourComparer`.
- **États de dossier** (`lib/statuts.ts`) : rôles, couleurs (`classeCouleur`), états ouverts, motifs d'impossibilité (clôture, modification, suppression).
- **Suppressions** (`lib/suppression.ts`) : textes des confirmations et des messages après suppression d'un document, d'une fiche ou d'un dossier.
- **Raccourcis globaux** : Alt+← et Ctrl+K sont désactivés quand une modale est ouverte (`isModalOpen()`).
- **Impression** : `window.print()` suffit, la feuille d'impression (`styles/print.css`) ne garde que `.paper`, toujours avec les couleurs du thème clair.
- **Formulaires** : la CSP contient `form-action 'none'`. Tout `<form>` porte `noValidate` et appelle `e.preventDefault()` dans `onSubmit`.
- **Styles** (`src/styles/`) : les feuilles viennent du prototype HTML statique d'origine, [`design/prototype-entites-dossiers.html`](../design/prototype-entites-dossiers.html) ; `index.css` les importe dans l'ordre du prototype (polices, jetons, base, coquille, contrôles, pages…), puis les ajouts des versions suivantes (`v11.css` à `v17.css`), `responsive.css` et `print.css`. Le thème et la densité sont les attributs `data-theme` et `data-density` de `<html>` (`lib/appearance.ts`). La CSP de production n'autorise ni élément `<style>` ni attribut `style` écrit dans le HTML : on ajoute des classes dans ces feuilles, et une couleur choisie par l'utilisateur passe par une classe (`st-<couleur>`), jamais par une valeur libre.
