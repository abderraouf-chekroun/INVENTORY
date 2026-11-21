# Changelog

All notable changes to INVENTORY are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/). Interface labels are quoted in French, as they appear in the application. The detailed specification of each version is in [`docs/specification.md`](docs/specification.md) (French), §§ 8 to 18.

Every version installs over the previous one and keeps the data. When a version changes the database schema, the database is backed up to `sauvegardes\avant-version-N_…` before it is upgraded.

## 1.8.2 - 2026-11-21

### Security

- Security review and hardening of the code base and of the delivery chain. See [`SECURITY.md`](SECURITY.md).

### Changed

- Repository prepared for public hosting: licence (GPL-3.0), English documentation with architecture description, contribution guide and security policy.
- Continuous integration workflow running the type-check, the front-end unit tests, the front-end build and the Rust tests, and auditing the dependencies.

## 1.8.1 - 2026-11-21

### Changed

- The four standard templates now ship with neutral placeholder headers ("Nom de l'organisme", "Adresse · Téléphone", "Nom de la division ou du service"), to be adapted in the template studio. Form reference and revision numbers were removed from them.
- Example data uses neutral fictitious values.
- Existing databases are not modified: standard templates already present keep their text. Only a new database, "Effacer toutes les données", "Recharger les données d'exemple" and "Restaurer les modèles standards" write the new text. No schema change.

## 1.8.0 - 2026-11-21

### Added

- Keywords of the keyword list ("Magasin") can be renamed: documents that chose a keyword immediately show the new name, closed dossiers included.
- Keywords can be deleted after a confirmation giving the real number of documents that chose them; those documents keep the written value, and the keyword is no longer offered.
- The number of documents that chose each keyword is shown.

### Removed

- "Module N" above page titles, the numbers 1 to 6 in the sidebar and the section numbers before section titles are no longer displayed.

No schema change.

## 1.7.0 - 2026-11-21

### Changed

- The classification of dossiers and templates, formerly called "thèmes", is now called "catégories" on screen. Existing names do not change.

### Added

- Categories can be renamed (a duplicate name, compared without case and surrounding spaces, is refused) and deleted when they no longer contain any dossier or template; otherwise the reason is given with the counts.
- The category of a dossier can be changed from the header of the open dossier; that of a template, in the studio.
- When no category is active, the dossier form and the studio offer to create one in place.

No schema change.

## 1.6.0 - 2026-11-21

### Added

- A dossier can be deleted with all its content (sub-folders, documents, copies of imported files), in any status, from "Dossiers & Archives" (cards and tree) and from the header of the open dossier, after a confirmation giving the real numbers.
- Employees and machines mentioned in a deleted dossier keep their record; their history notes that the dossier was deleted.
- A page left open on a deleted dossier shows that it was deleted, with a way back to the list.

### Changed

- Deletion confirmations use a red confirmation button with the focus on "Annuler".

No schema change.

## 1.5.1 - 2026-11-21

### Changed

- On a machine where the application was never installed, it starts with an empty database: no employee, machine, dossier or document, only the four standard templates. Example data is loaded only on demand, from Settings.
- Every screen has an empty state that says what to do next.
- The employee and machine forms offer to create the first structure or machine type in place.
- An existing database is opened as it is, neither emptied nor filled. No schema change.

## 1.5.0 - 2026-11-21

### Added

- A document can be deleted directly, without opening it, from every list where it appears (dossier content, tree, record profile), after a confirmation. In a closed dossier the button is disabled with its reason.
- Employees and machines can be deleted, next to "Archiver". The confirmation gives the real numbers (assignments that end, past assignments erased, documents and dossiers where the record is mentioned) and offers "Archiver plutôt".
- Nothing is lost elsewhere: documents keep the name and identifier of a deleted record, marked "fiche supprimée", and the history of other records keeps its name as plain text. Recreating an identical employee gives back the same identifier.

### Changed

- Database schema version 6: two columns added to the history table; no existing data modified.

## 1.4.1 - 2026-11-21

### Changed

- The application is renamed **INVENTORY** (formerly "Entités et Dossiers"); the executable is `inventory.exe` and the default installation folder `%LOCALAPPDATA%\INVENTORY`.
- The installer removes a former "Entités et Dossiers" installation (program, shortcuts, registry entries) without running its uninstaller and without touching the data. The application identifier, hence the data directory, does not change. No schema change.

## 1.4.0 - 2026-11-21

### Changed

- Dossiers are no longer attached to an employee or a machine. A record is linked to a dossier because it is **mentioned** in one of its documents: chosen in an employee or machine block, or its name or identifier written in the document. Assigning a machine is done from the records only.
- The variables "Employé · …" and "Machine · …" of a document follow its first employee or machine block.

### Added

- Imported files have optional "Employé concerné" and "Machine concernée" fields above the preview.
- Mentions are stored with the field and the time they appeared; a record's profile lists them, and its history shows "Nommé dans …" events with links to the document, the field and the dossier.
- Search inside a profile's documents (name, template, dossier, field, date) with template filters, and in each history tab.
- A template from which no document was created can be deleted; a deleted standard template comes back with "Restaurer les modèles standards".

### Changed (database)

- Schema version 5: each dossier's employee and machine are carried into its documents before the attachment columns are removed; mentions are filled from existing documents. Nothing is lost.

## 1.3.0 - 2026-11-21

### Added

- Configurable dossier statuses: the three built-in statuses plus user statuses with a colour among nine, to rename, recolour or delete when no dossier uses them. "Pièce manquante" can be left by hand; closing stays impossible in that status.
- Each record's profile shows all the documents where it appears.
- Mandatory fields carry a red star and incomplete forms are not sent; template blocks can be marked mandatory, and documents show how many mandatory fields remain.

### Changed

- Global search returns up to 50 results per group in a scrolling list.
- The employee identifier becomes non-guessable: `EMP-XXXXX-XXXXX`, computed with a secret key specific to each database. Existing identifiers are recomputed and the old one is written to each record's history.
- The employee and machine of a dossier become optional.
- Schema version 4.

## 1.2.0 - 2026-11-21

### Added

- Structures (employees) and machine types can be added, renamed, archived and deleted when empty; the number of records of each is shown.
- **Assignments** replace associations: a machine is assigned to an employee for a period, from either record, without needing a dossier. Ending an assignment is always possible; current and past assignments are listed with their dates.
- Names in the history are links to the employee, machine or dossier.

### Changed

- Signatures become dated "Signé" checkboxes; everything meant for handwriting is removed, and printing shows what was entered on screen.
- Schema version 3: existing associations become current assignments.

## 1.1.0 - 2026-11-20

### Changed

- The generic directories become **employees** and **machines** (desktop PCs and laptops), with their own fields: name, first name, date of birth, job title and structure for an employee; identifier, brand and model, processor, RAM, storage and type for a machine.
- Employee identifiers are computed from the record (replaced by a non-guessable form in 1.3); machine identifiers are typed, up to 40 characters.
- Schema version 2: records of version 1.0 are converted without loss.

### Added

- Search by name, first name, brand or identifier, ignoring case and accents, and type-ahead suggestions wherever an employee or a machine is chosen.
- New block types: title, multi-line field, date, choice list, employee, machine and signature; tables of 1 to 8 columns.
- Four standard templates in the category "Support informatique": "État des besoins", "Fiche d'intervention informatique", "Fiche d'identification", "Fiche pour formatage PC".

## 1.0.0 - 2026-11-20

### Added

- First release, as "Entités et Dossiers": two directories of records with optional four-digit codes, associations between them, dossiers with nested sub-folders, statuses ("En cours", "Pièce manquante", "Clôturé") and checklists.
- Documents created from block templates or imported from files, edited with automatic saving and printable; template studio; keyword list; categories; global search; dashboard; history.
- Settings: theme and density, system information, data directory, reset to an empty database or to example data.
- Fully local operation, SQLite database embedded in the executable, per-user NSIS installer.

### Security

- Security review before release ([`docs/audit-securite.md`](docs/audit-securite.md), French): file type decided by content and allow-list for opening, read-only database validation, backup before reset, minimal interface permissions, strict CSP, navigation restricted to the application, close driven by Rust, hardened release build with a SHA-256 fingerprint.
