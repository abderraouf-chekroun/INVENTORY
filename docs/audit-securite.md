# Audit de sécurité — Entités et Dossiers 1.0.0

> Ce document contient deux parties : l'audit complet de la version 1.0.0 (ci-dessous, inchangé) et la [revue de la version 1.8.2](#revue-de-la-version-182), qui couvre le code ajouté par les versions 1.1 à 1.8.1. Les risques résiduels à jour sont ceux de la revue 1.8.2.
>
> Depuis la version 1.4.1, l'application s'appelle **INVENTORY** (exécutable `inventory.exe`, même identifiant `fr.entitesdossiers.app`) ; ce document daté garde l'ancien nom.

Audit réalisé le 20 novembre 2026 sur l'ensemble du projet : back Rust et configuration Tauri, interface React, dépendances, exécutable livré, installateur et outillage de test. Il s'est déroulé en trois temps : audit, corrections, puis contre-audit indépendant des corrections.

## Modèle de menace

L'application est locale, mono-utilisateur et ne fait aucune requête réseau. Un attaquant distant est donc hors sujet. Les attaquants réalistes sont :

1. un fichier piégé que l'utilisateur importe ;
2. des données piégées : une base ou un dossier de données reçus de quelqu'un ;
3. du script hostile qui s'exécuterait dans l'interface (par 1 ou 2) et appellerait les commandes du back ;
4. un autre programme ou un autre compte sur la machine.

## Bilan

| Étape | Constats |
| --- | --- |
| Audit initial | 19 : 0 critique, 2 élevés (la même faille vue du back et du front), 6 moyens, 11 faibles |
| Contre-audit des corrections | 12 points à reprendre, dont 1 élevé introduit par les corrections elles-mêmes |

Aucune injection de script n'a été trouvée dans l'interface principale, aucune injection SQL, et aucune vulnérabilité connue dans les dépendances (`npm audit` et `cargo audit` : 0 vulnérabilité atteignable).

## Constats de l'audit initial

| Réf. | Constat | Gravité | État |
| --- | --- | --- | --- |
| BACK-01 / FRONT-01 | « Ouvrir avec l'application par défaut » lançait n'importe quel fichier stocké, y compris un programme affiché sous un nom de document | élevée | corrigé |
| BACK-02 | Le nom de fichier lu en base n'était pas contrôlé : chemin relatif, absolu ou réseau | moyenne | corrigé |
| BACK-03 | L'interface avait des permissions d'ouverture de fichiers dont elle ne se servait pas | moyenne | corrigé |
| BACK-04 | L'import acceptait un chemin fourni par l'interface, sans limite de taille, en bloquant la base pendant la copie | moyenne | corrigé |
| BACK-05 | L'effacement de toutes les données n'avait ni garde-fou côté back ni sauvegarde | moyenne | corrigé |
| FRONT-02 | Un fichier HTML déguisé en `.pdf` exécutait son script dans l'aperçu | moyenne | corrigé |
| CHAINE-01 | Installateur et exécutable non signés | moyenne | **non corrigé** : demande un certificat de signature |
| BACK-06 | Un cycle de sous-dossiers dans une base piégée figeait l'application | faible | corrigé |
| BACK-07 / CHAINE-02 | Des variables d'environnement de test et de débogage restent honorées par l'exécutable livré | faible | **partiel**, par décision (voir plus bas) |
| CHAINE-03 | Pendant les tests de bout en bout, le port de débogage est joignable par un autre compte de la machine | faible | règle d'usage documentée |
| CHAINE-04 | Sans WebView2, l'installateur allait le télécharger sur internet | faible | corrigé |
| CHAINE-05 | Le nom du compte Windows du développeur était incrusté dans l'exécutable | faible | corrigé |
| CHAINE-06 | Installé hors du profil, le dossier était modifiable par d'autres comptes | faible | corrigé en partie (voir CA-07) |
| CHAINE-07 | Données stockées en clair | faible | documenté ; effacement sécurisé activé dans la base |
| FRONT-03 | Un fichier glissé sur la fenêtre pouvait remplacer l'application | faible | corrigé |
| FRONT-04 | La fenêtre pouvait devenir impossible à fermer si l'interface était gelée | faible | corrigé |
| FRONT-05 | Un document piégé faisait planter tout l'affichage | faible | corrigé |

## Ce qui a changé

**Fichiers importés**
- Le type d'un fichier est décidé d'après son contenu réel (octets de signature), jamais d'après son nom. Un aperçu n'est affiché que pour un vrai PDF ou une vraie image.
- Seuls des types de documents connus peuvent être ouverts par Windows (PDF, images, bureautique, courriels). Tout autre fichier est stocké sous une extension neutre, et reste récupérable par « Enregistrer une copie… ».
- Chaque copie importée porte la marque « venu d'Internet » de Windows, pour que les applications bureautiques l'ouvrent en mode protégé.
- Les boîtes de choix de fichier s'ouvrent côté Rust : aucun chemin ne vient plus de l'interface. Taille limitée à 200 Mo.

**Base de données**
- Une base existante est contrôlée en lecture seule avant d'être ouverte : structure identique à celle attendue, aucun déclencheur ni vue, intégrité, cohérence de l'arborescence. Une base refusée n'est pas modifiée, et le message indique où elle se trouve et quoi faire.
- Les contenus de taille excessive sont bornés à l'écriture comme à l'affichage ; un contenu illisible n'empêche plus d'ouvrir le reste.

**Données de l'utilisateur**
- Une sauvegarde automatique est créée avant toute réinitialisation, dans `sauvegardes\` du dossier de données. Les trois plus récentes sont gardées, et aucune sauvegarde de moins de sept jours n'est supprimée.
- Le ménage au démarrage ne supprime jamais un fichier importé, même s'il n'est plus référencé par la base.

**Interface et fenêtre**
- Les permissions accordées à l'interface sont réduites à ce qu'elle utilise réellement.
- La politique de sécurité de contenu est resserrée : plus de style en ligne, plus d'objet embarqué.
- La fenêtre ne peut naviguer que dans l'application ; nouvelles fenêtres et téléchargements sont refusés.
- La fermeture est pilotée par Rust et aboutit toujours, en 3,5 secondes au plus, après enregistrement de la saisie en cours.

**Livraison**
- `npm run livrer` est la seule façon de produire un installateur : il retire les chemins de la machine de compilation, active la protection Control Flow Guard, refuse de livrer si un contrôle échoue, et écrit l'empreinte SHA-256 à côté de l'installateur.

## Contre-audit

Une relecture indépendante, menée sans avoir participé aux corrections, a cherché à les contourner.

| Réf. | Constat | Gravité | État |
| --- | --- | --- | --- |
| CA-01 | Le nouveau ménage au démarrage supprimait les fichiers importés non référencés (base absente ou restaurée) | élevée | corrigé |
| CA-02 | Un déclencheur nommé `sqlite_…` échappait au contrôle de la base | moyenne | corrigé |
| CA-03 | L'import depuis un lecteur réseau était devenu impossible | moyenne | corrigé |
| CA-04 | Quatre réinitialisations d'affilée chassaient la seule sauvegarde utile | moyenne | corrigé |
| CA-05 | Des types autorisés peuvent porter des macros | faible à moyenne | atténué : marque « venu d'Internet » |
| CA-06 | Un refus de démarrer laissait l'utilisateur sans explication | faible à moyenne | corrigé |
| CA-08 | La variable de test acceptait un lecteur réseau mappé | faible | corrigé |
| CA-09 | Les nouvelles limites de taille bloquaient des documents existants | faible | corrigé |
| CA-10 | Les fichiers de type inconnu étaient devenus inaccessibles | faible | corrigé : export « Enregistrer une copie… » |
| CA-12 | Une double demande de fermeture pouvait perdre la dernière saisie | faible | corrigé |
| CA-07 | Le crochet de l'installateur ne protège pas un dossier d'installation qui existait déjà | faible | **non corrigé** |
| CA-11 | Un lien dans un PDF pourrait mener la zone d'aperçu vers un autre fichier stocké servi comme page web | faible | **non corrigé** |

## Risques résiduels

- **Installateur non signé (CHAINE-01).** Windows affiche un avertissement, et rien ne prouve techniquement l'origine du fichier. Parade actuelle : vérifier l'empreinte SHA-256 publiée à côté de l'installateur. Correction : un certificat de signature de code.
- **Variables de débogage (CHAINE-02).** L'exécutable livré obéit toujours aux variables de WebView2 et à `ENTITES_DOSSIERS_DONNEES`. C'est un choix : un programme capable de les poser a déjà tous les droits de l'utilisateur, et les bloquer empêcherait de tester l'exécutable réellement livré. Les chemins réseau sont refusés.
- **Aperçu (CA-11).** Il faudrait servir les aperçus par un canal propre à l'application, avec un type de contenu imposé. Exploitation difficile : deux fichiers préparés et la connaissance du nom du compte Windows ; le script n'aurait pas accès aux commandes de l'application.
- **Navigation hors de l'application.** La vérification a montré qu'une tentative de navigation faisait réellement partir une requête, même si l'adresse de la fenêtre ne changeait pas. Un filtre réseau a été ajouté : plus aucune requête HTTP ne sort de l'application. Il reste que WebView2 ouvre deux connexions réseau anticipées, sans contenu, vers l'hôte visé avant tout filtre. Il faut déjà du script hostile dans la fenêtre principale pour le déclencher.
- **Installation dans un dossier partagé préexistant (CA-07).** Garder le dossier d'installation proposé. Hors du profil, les droits du dossier sont restreints à l'utilisateur, au système et aux administrateurs (vérifié par une installation réelle).
- **Données en clair (CHAINE-07).** Elles sont protégées par les droits du profil Windows. Chiffrer le disque avec BitLocker protège contre le vol de l'ordinateur.
- **Programme malveillant déjà actif sous le compte de l'utilisateur.** Il peut lire et modifier les données ; aucune correction dans l'application ne l'empêche.

## Vérification

Résultats sur la version livrée (exécutable et installateur du 20 novembre 2026, 17 h 59) :

| Contrôle | Résultat |
| --- | --- |
| Tests Rust de la logique métier (`cargo test`) | 73 réussis, 0 échec (31 avant l'audit) |
| Typage du front (`npx tsc --noEmit`) | aucune erreur |
| Tests unitaires du front (`npm test`) | 30 réussis, 0 échec |
| Tests de bout en bout sur l'exécutable livré (`npm run e2e`) | 18 scénarios réussis sur 18 (15 avant l'audit) |
| Nom du compte de compilation dans l'exécutable | 0 occurrence |
| Empreinte de l'installateur | identique au fichier `.sha256` publié à côté |

Trois scénarios de bout en bout ont été ajoutés pendant l'audit :

- **Sécurité** : fichier HTML déguisé en PDF, vrai PDF, image, SVG renommé, script importé neutralisé et refusé à l'ouverture, permissions retirées à l'interface, navigation hors de l'application, dépôt de fichier, fermeture avec l'interface gelée, politique de sécurité de contenu.
- **Bases fabriquées** : base piégée refusée sans être modifiée, document piégé, données de très grande taille.
- **Compatibilité** : une base créée par la version d'avant l'audit est acceptée et affichée.

La suite pilote désormais les vraies boîtes Windows de choix de fichier, qui n'étaient pas couvertes auparavant.

Non vérifié par des tests automatiques : l'import depuis un lecteur réseau réel, le comportement de Word et d'Excel face à un document à macros marqué « venu d'Internet », et l'installation sur une machine autre que le poste de développement.

---

# Revue de la version 1.8.2

Revue réalisée le 21 novembre 2026, avant la publication du code source. Les versions 1.1 à 1.8.1 avaient ajouté beaucoup de code sans nouvel audit ; la version 1.8.2 ne change rien pour l'utilisateur : elle corrige les constats ci-dessous, durcit la compilation et ajoute les tests qui les auraient attrapés.

## Périmètre

Même modèle de menace que l'audit 1.0.0 (fichier importé piégé ; base ou dossier de données piégés ; script hostile dans l'interface appelant les commandes ; autre programme ou autre compte de la machine). Ont été relus :

- chaque commande Tauri (`src-tauri/src/commandes/mod.rs`) et le domaine qu'elle appelle : employés et machines, identifiant HMAC des employés, affectations, états de dossier, nominations, modèles standards, suppression de documents, de sous-dossiers, de dossiers et de fiches, renommage et suppression des catégories et des mots-clés du Magasin, réinitialisation ;
- les migrations 002 à 006 et leur partie Rust (`db/migration5.rs`), le contrôle d'une base existante, le premier lancement sur base vide ;
- toutes les requêtes SQL, toutes les lectures et réécritures du JSON des documents, la gestion d'erreurs (messages renvoyés à l'interface, `unwrap`, débordements arithmétiques, verrous) ;
- l'interface : rendu de tout texte venant de la base, couleurs des états, CSP, capacités, configuration Tauri ;
- le crochet de l'installateur `NSIS_HOOK_PREINSTALL` (retrait de l'ancienne installation) ;
- les dépendances, le profil de compilation, les scripts de livraison et l'hygiène du dépôt public.

## Bilan

| Gravité | Constats |
| --- | --- |
| critique | 0 |
| élevée | 0 |
| moyenne | 0 |
| faible à moyenne | 1 (installateur) |
| faible | 4 |
| information | 1 |

Aucune injection SQL (toutes les valeurs sont passées en paramètres ; les seuls morceaux de requête construits sont des noms de table ou de colonne tirés de constantes), aucun `LIKE` sur une saisie, aucun HTML interprété dans l'interface (pas de `dangerouslySetInnerHTML`, aucune URL construite à partir des données ; la couleur d'un état est une classe d'une palette fermée, vérifiée en base par une contrainte et à l'affichage). La CSP (`style-src 'self'` sans exception) et les capacités de l'interface sont identiques à celles de l'audit 1.0.0 ; un test les fige. Aucun message d'erreur renvoyé à l'interface ne contient de chemin, de requête ou de trace interne. La clé de l'identifiant des employés est tirée par le générateur du système (`getrandom`), stockée dans la base, et n'apparaît ni dans le journal des erreurs, ni dans une réponse de commande, ni dans un export.

## Constats

| Réf. | Constat | Gravité | Scénario | Correction | Test |
| --- | --- | --- | --- | --- | --- |
| SEC-182-01 | La suppression d'un document ou d'un sous-dossier supprimait sa copie de fichier même quand un autre document la référençait | faible | Base fabriquée (ou rendue incohérente par un outil) où deux documents de dossiers différents désignent la même copie : supprimer l'un fait perdre son fichier à l'autre. La suppression d'un dossier entier était déjà protégée. | Une copie référencée par un document hors de ce qui est supprimé est conservée | Rust `copie_partagee_conservee_document_et_sous_dossier` ; e2e `bases-fabriquees` |
| SEC-182-02 | Lecture et réécriture du JSON des documents par le Magasin sans borne de taille | faible | Base fabriquée avec un document de plusieurs centaines de Mo : l'ouverture du Magasin ou le renommage d'un mot-clé décode tout le contenu en mémoire (déni de service, arrêt possible faute de mémoire). Les autres lectures étaient bornées (8 Mo). | Même borne que l'affichage : au-delà, le contenu n'est ni compté ni réécrit | Rust `magasin_contenu_demesure_ni_decode_ni_reecrit` ; e2e `bases-fabriquees` |
| SEC-182-03 | Débordement arithmétique atteignable depuis la base | faible | Base fabriquée avec une nomination de numéro de ligne -2⁶³ : la négation de ce numéro déborde ; avec `overflow-checks` et `panic = "abort"`, l'application s'arrête à l'ouverture du profil de la fiche. | Négation saturée | Rust `numero_de_ligne_extreme_sans_arret` ; e2e `bases-fabriquees` |
| SEC-182-04 | Aperçu de l'identifiant d'un employé calculé sur des champs de taille quelconque | faible | Script hostile dans l'interface : `identifiant_employe_apercu` avec des champs de plusieurs Mo, en boucle, occupe le processeur. L'enregistrement, lui, était borné à 200 caractères. | Au-delà des bornes de l'enregistrement, aucun identifiant n'est calculé | Rust `apercu_de_l_identifiant_borne` ; e2e `securite` |
| SEC-182-05 | Le crochet PREINSTALL supprimait deux fichiers dans un dossier lu dans le registre sans le contrôler | faible à moyenne | Un programme du compte écrit dans `HKCU\…\Uninstall\Entités et Dossiers` un dossier quelconque : chemin relatif (dossier courant de l'installateur), racine, chemin réseau, `\\?\…`, `..`. L'installateur y supprime `entites-dossiers.exe` et surtout `uninstall.exe`, même si le dossier n'est pas une ancienne installation. Lancé en administrateur, l'installateur franchirait ainsi une frontière de privilèges (fichier d'un dossier protégé supprimé à la demande d'un programme non privilégié). | Le dossier n'est retenu que s'il est absolu sur un lecteur, autre qu'une racine, sans composant `.` ou `..`, sans `:` après la lettre du lecteur, sans chemin réseau ni périphérique, ET s'il contient l'ancien exécutable ; sinon seul l'enregistrement (clés de noms fixes) est retiré | `npm run test:installateur` (installateur d'essai compilé avec le vrai crochet : 6 échecs sur le crochet 1.8.1, 0 sur 1.8.2) ; test Rust de configuration |
| SEC-182-06 | Protections de l'exécutable : compatibilité CET absente | information | Sans `/CETCOMPAT`, Windows n'active pas la pile fantôme matérielle (protection des adresses de retour) pour l'application. | `-C link-arg=/CETCOMPAT` à la compilation de livraison ; la livraison vérifie désormais aussi CET et l'ASLR 64 bits dans l'en-tête PE | `scripts/compilation.mjs` (`verifierExecutable`), joué par `npm run livrer` et `npm run e2e:build` |

Contrôle sans constat, figé par un test de non-régression : aucune suppression ni ouverture ne peut sortir du dossier `fichiers\`, quel que soit le nom de copie écrit dans la base (`..\`, chemin absolu, `\\?\…`, chemin réseau, flux de données `:flux`, nom réservé, sous-dossier portant un nom de copie valide). Test Rust `aucune_suppression_hors_de_fichiers_quel_que_soit_le_nom_en_base` ; e2e `bases-fabriquees`.

Points vérifiés sans constat : entrées des commandes (noms bornés à 200 caractères, textes des blocs à 10 000, dates analysées, années bornées, énumérations fermées, identifiants inexistants refusés en `introuvable` sans écriture) ; réécritures de JSON (suppression d'une fiche, migrations) bornées ou limitées à un contenu déjà décodé ; ménage au démarrage limité aux fichiers provisoires nommés par l'application ; sauvegardes avant réinitialisation et avant migration ; contrôle d'une base existante (inchangé, il couvre les tables ajoutées depuis) ; aucun `unwrap`, `expect` ni `panic` atteignable par une entrée (seulement sur des constantes) ; un verrou empoisonné n'empêche pas d'utiliser la base.

## Dépendances

| Contrôle | Résultat |
| --- | --- |
| `cargo audit` (490 crates) | 0 vulnérabilité ; 6 avertissements sans correctif disponible ni effet sur l'application : 5 crates « non maintenues » (`chrono`, `proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive` ; les quatre dernières ne sont compilées que sous Linux), 1 « unsound » (`glib`, Linux seulement) |
| `npm audit` (production et développement) | 0 vulnérabilité |
| `cargo build --locked`, `npm ci` | `Cargo.lock` et `package-lock.json` cohérents ; aucune mise à jour nécessaire |
| Licences des dépendances livrées | toutes compatibles avec la GPL-3.0 : MIT, Apache-2.0, BSD, ISC, Zlib, Unicode-3.0, Unlicense, MPL-2.0 (5 crates, licence au niveau du fichier, compatible), SQLite (domaine public) ; polices Inter et JetBrains Mono sous OFL-1.1, qui permet de les distribuer avec un logiciel sous toute licence |

## Durcissement de la compilation et de la livraison

Profil release de `Cargo.toml` (inchangé, vérifié) : `lto = true`, `codegen-units = 1`, `panic = "abort"`, `strip = true`, `overflow-checks = true`. Options de la compilation de livraison (`scripts/compilation.mjs`) : chemins de la machine retirés (`--remap-path-prefix`), Control Flow Guard, et désormais `/CETCOMPAT`. `cargo build --locked` et contrôle de `node_modules` contre `package-lock.json`. L'exécutable est refusé s'il contient un chemin ou le nom du compte de la machine, ou s'il lui manque CFG, ASLR (64 bits), DEP ou CET. L'empreinte SHA-256 de l'installateur est écrite à côté de lui.

## Dépôt public

Ajoutés : `SECURITY.md` (signalement privé par l'onglet Security du dépôt), `.gitignore` durci (bases, journaux, sauvegardes, fichiers importés, secrets, sorties de compilation et de test), `.gitattributes` (fins de ligne LF, binaires marqués), `.editorconfig`, `.nvmrc`, intégration continue `.github/workflows/ci.yml` (Windows : typage, tests du front, compilation du front, tests Rust verrouillés ; audit des dépendances dans un second job ; droits en lecture seule), `.github/dependabot.yml` (npm, cargo et actions, hebdomadaire, regroupé), modèle de signalement d'anomalie.

## Vérification

Résultats sur la version 1.8.2 (21 novembre 2026) :

| Contrôle | Résultat |
| --- | --- |
| Tests Rust (`cargo test --locked`) | 173 réussis, 0 échec (168 avant la revue ; les 4 tests des constats SEC-182-01 à 04 échouent sur le code 1.8.1) |
| Typage du front (`npx tsc --noEmit`) | aucune erreur |
| Tests unitaires du front (`npx vitest run`) | 195 réussis dans 23 fichiers, 0 échec |
| Essai du crochet de l'installateur (`npm run test:installateur`) | tous les contrôles passent ; 6 échecs sur le crochet 1.8.1 |
| Suite de bout en bout sur l'exécutable de livraison (`npm run e2e`) | 35 scénarios réussis sur 35 ; seules origines contactées : l'application elle-même |
| Rejeu, sur une copie propre du dépôt, de chaque commande de l'intégration continue | toutes réussies (`npm ci`, `tsc`, `vitest`, `npm run build`, `cargo test --locked`, `cargo audit`, `npm audit --omit=dev`) |
| Exécutable livré | aucun chemin ni nom de compte de la machine ; CFG, ASLR 64 bits, DEP et CET déclarés |
| Installation silencieuse de l'installateur sur le poste | version 1.8.2 installée ; données de l'utilisateur identiques fichier par fichier ; scénarios « premier lancement » et « sécurité » rejoués avec succès sur l'exécutable installé |

La suite de bout en bout n'avait pas été lancée depuis la version 1.5.1. Remise en état : libellé « Thème » devenu « Catégorie » (§ 16) dans deux scénarios, dont les suivants dépendaient en cascade ; lecture du nombre de pages dans la nouvelle visionneuse PDF de WebView2 (barre dessinée dans des racines fantômes) ; nouvelle frappe du chemin dans la boîte native de choix de fichier quand la saisie automatique avale une touche ; comparaison des corbeilles de l'arborescence une fois l'affichage stable (contenu d'abord lu dans le cache). Aucun contrôle n'a été retiré ni assoupli ; aucun défaut de l'application n'a été révélé par la suite. Ajouts : contrôles des constats SEC-182-01 à 04 et du confinement à `fichiers\` (« bases fabriquées »), entrées démesurées ou hors liste appelées par un script, texte des données jamais interprété comme du HTML, marque « venu d'Internet » de la copie exportée (« sécurité »).

Non vérifié automatiquement : l'installation sur une machine autre que le poste de développement, l'intégration continue sur les serveurs de GitHub (jouée localement, commande par commande), le comportement de l'installateur lancé en administrateur (le contrôle du crochet est vérifié en utilisateur).

## Risques résiduels (à jour)

- **Installateur non signé (CHAINE-01).** Inchangé : vérifier l'empreinte SHA-256 publiée à côté de l'installateur ; la correction demande un certificat de signature de code.
- **Données en clair (CHAINE-07).** Inchangé : protégées par les droits du profil Windows ; BitLocker contre le vol de l'ordinateur.
- **Programme malveillant déjà actif sous le compte de l'utilisateur.** Il peut lire et modifier les données, imposer un autre dossier de données (`ENTITES_DOSSIERS_DONNEES`, CHAINE-02) ou les variables de WebView2, remplacer le dossier `fichiers\` par un lien vers un autre dossier, ou modifier le registre lu par l'installateur. Depuis la 1.8.2, ce dernier point ne lui permet plus de faire supprimer par l'installateur que `entites-dossiers.exe` et `uninstall.exe` d'un dossier qui contient déjà un `entites-dossiers.exe`, ce qu'il pourrait faire lui-même.
- **Clé de l'identifiant des employés.** Elle est stockée dans la base : quiconque obtient le fichier `donnees.sqlite` (ou une sauvegarde) peut recalculer l'identifiant d'une personne dont il connaît le nom, le prénom, la date de naissance et le poste. L'identifiant ne protège pas contre la personne qui détient les données ; il empêche seulement de le deviner sans elles.
- **Aperçu (CA-11), connexions anticipées de WebView2, installation dans un dossier partagé préexistant (CA-07), macros des documents bureautiques (CA-05).** Inchangés (voir l'audit 1.0.0).
- **Base incohérente.** Une base fabriquée peut encore contenir des données contradictoires que le contrôle d'ouverture n'interdit pas (par exemple deux documents désignant la même copie) : l'application les affiche sans rien supprimer à tort (SEC-182-01), mais ne les corrige pas.
- **Dépendances non maintenues.** `chrono` et `proc-macro-error` sont signalées « non maintenues » par RustSec, sans vulnérabilité connue ; Dependabot proposera un remplacement s'il en paraît un.
