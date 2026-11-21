//! Données d'exemple (§ 8.7) : employés et machines fictifs (aucune personne réelle), dossiers et documents
//! issus des quatre modèles standards, avec des dates réalistes réparties sur l'année en cours et la précédente,
//! calculées par rapport à la date du jour. Chargées seulement à la demande, par « Recharger les données d'exemple »
//! (Paramètres 6.4) : une base neuve reste vide (§ 14).

use crate::domaine::entites::{identifiant_employe, libelle_employe};
use crate::domaine::journal::{self, Cible};
use crate::domaine::modeles::{self, Bloc, TypeBloc};
use crate::domaine::statuts::{self, Role};
use crate::domaine::documents::{SOURCE_IMPORT, blocs_import};
use crate::domaine::{Kind, dossiers::OPTIONS_PAR_DEFAUT, nominations, parametres, standards};
use crate::error::{AppError, AppResult};
use chrono::{Datelike, NaiveDate, NaiveDateTime, TimeDelta};
use rusqlite::{Connection, params};

/// Calendrier relatif : `decalage` 0 = année en cours (du 1er janvier à aujourd'hui),
/// -1 = année précédente (année entière). `frac` place la date dans cet intervalle.
struct Calendrier {
    annee: i32,
    aujourd_hui: NaiveDate,
    limite: NaiveDateTime,
}

impl Calendrier {
    fn new(aujourd_hui: NaiveDate) -> AppResult<Self> {
        let fin_du_jour = aujourd_hui
            .and_hms_opt(23, 59, 59)
            .ok_or_else(|| AppError::interne("Date du jour invalide."))?;
        let maintenant = chrono::Local::now().naive_local();
        Ok(Calendrier { annee: aujourd_hui.year(), aujourd_hui, limite: fin_du_jour.min(maintenant) })
    }

    fn jour(&self, decalage: i32, frac: f64) -> AppResult<NaiveDate> {
        let an = self.annee + decalage;
        let invalide = || AppError::interne("Date d’exemple invalide.");
        let debut = NaiveDate::from_ymd_opt(an, 1, 1).ok_or_else(invalide)?;
        let fin = if decalage >= 0 {
            self.aujourd_hui
        } else {
            NaiveDate::from_ymd_opt(an, 12, 31).ok_or_else(invalide)?
        };
        let jours = (fin - debut).num_days().max(0) as f64;
        Ok(debut + TimeDelta::days((jours * frac.clamp(0.0, 1.0)).round() as i64))
    }

    /// Horodatage, jamais dans le futur.
    fn moment(&self, decalage: i32, frac: f64, heure: u32, minute: u32) -> AppResult<NaiveDateTime> {
        let dt = self
            .jour(decalage, frac)?
            .and_hms_opt(heure, minute, 0)
            .ok_or_else(|| AppError::interne("Heure d’exemple invalide."))?;
        Ok(dt.min(self.limite))
    }
}

fn horo(dt: NaiveDateTime) -> String {
    dt.format("%Y-%m-%d %H:%M:%S").to_string()
}

/// Fraction `k / n` de l'intervalle `[debut, fin]`.
fn entre(debut: NaiveDateTime, fin: NaiveDateTime, k: i64, n: i64) -> NaiveDateTime {
    let ecart = (fin - debut).num_seconds().max(0);
    debut + TimeDelta::seconds(ecart * k / n)
}

struct Fiche {
    id: i64,
    libelle: String,
}

/// Employés fictifs : nom, prénom, date de naissance, poste, structure (indice), actif.
/// Deux fiches restent à compléter (sans date de naissance ni poste).
type LigneEmploye = (&'static str, &'static str, Option<&'static str>, &'static str, usize, bool);
const EMPLOYES: [LigneEmploye; 8] = [
    ("Benali", "Sofia", Some("1990-05-14"), "Technicienne", 0, true),
    ("Haddad", "Karim", Some("1985-11-02"), "Ingénieur", 0, true),
    ("Cherif", "Amine", None, "", 1, true),
    ("Mansouri", "Leïla", Some("1992-03-27"), "Assistante administrative", 1, true),
    ("Ould Ali", "Nadia", Some("1988-01-30"), "Chercheuse", 2, true),
    ("Djebbar", "Samia", None, "", 2, true),
    ("Lefèvre", "Thomas", Some("1995-07-18"), "Technicien", 0, false),
    ("Brahimi", "Yacine", Some("1979-08-09"), "Chef de service", 1, true),
];

/// Machines fictives : nom, identifiant, marque et modèle, processeur, RAM, stockage, type (indice), active.
/// Deux machines restent sans identifiant.
type LigneMachine = (&'static str, Option<&'static str>, &'static str, &'static str, &'static str, &'static str, usize, bool);
const MACHINES: [LigneMachine; 8] = [
    ("PC accueil", Some("PC-0101"), "Dell OptiPlex 7090", "Intel Core i5-10500", "16 Go", "SSD 512 Go", 0, true),
    ("Portable mission 01", None, "HP ProBook 450 G8", "Intel Core i5-1135G7", "8 Go", "SSD 256 Go", 1, true),
    ("Poste laboratoire 02", Some("PC-0103"), "Lenovo ThinkCentre M70q", "Intel Core i7-10700T", "16 Go", "SSD 1 To", 0, true),
    ("Station de calcul", Some("ST-0001"), "HP Z4 G4", "Intel Xeon W-2245", "64 Go", "SSD 1 To + HDD 4 To", 2, false),
    ("Portable direction", Some("LT-0105"), "Lenovo ThinkPad T14", "AMD Ryzen 5 PRO 5650U", "16 Go", "SSD 512 Go", 1, true),
    ("PC secrétariat", Some("PC-0106"), "Dell Vostro 3910", "Intel Core i3-12100", "8 Go", "HDD 1 To", 0, true),
    ("PC atelier", None, "Acer Veriton X2690G", "Intel Core i5-12400", "8 Go", "SSD 256 Go", 0, true),
    ("Portable formation", Some("LT-0108"), "Asus ExpertBook B1", "Intel Core i5-1235U", "8 Go", "SSD 512 Go", 1, true),
];

/// Thème : id existant (même nom) ou nouveau.
fn theme(conn: &Connection, nom: &str, actif: bool) -> AppResult<i64> {
    conn.execute("INSERT OR IGNORE INTO themes (nom, actif) VALUES (?1, ?2)", params![nom, actif])?;
    Ok(conn.query_row("SELECT id FROM themes WHERE nom = ?1", [nom], |r| r.get(0))?)
}

/// Remplit un instantané de modèle standard avec des valeurs plausibles ; la première signature est cochée
/// (`signe_le` : horodatage de la signature), les autres restent non signées.
fn remplir(blocs: &mut [Bloc], a: i64, b: i64, machine: &str, date: &str, signe_le: &str) {
    let mut premiere_signature = true;
    for bl in blocs.iter_mut() {
        match bl.t {
            TypeBloc::Signature => {
                bl.ok = Some(premiere_signature);
                bl.val = premiere_signature.then(|| signe_le.to_string());
                premiere_signature = false;
            }
            TypeBloc::Employe => bl.entite_id = Some(Some(a)),
            TypeBloc::Machine => bl.entite_id = Some(Some(b)),
            TypeBloc::Choix => {
                bl.choisis = Some(bl.options.iter().flatten().take(1).cloned().collect());
            }
            TypeBloc::Date => {
                bl.val = Some(if bl.heure == Some(true) { format!("{date}T09:30") } else { date.to_string() });
            }
            TypeBloc::Tableau => {
                bl.rows = Some(vec![
                    vec!["1".into(), "Barrette mémoire 8 Go".into(), "2".into(), format!("Pour {machine}")],
                    vec!["2".into(), "Disque SSD 512 Go".into(), "1".into(), String::new()],
                ]);
            }
            TypeBloc::Champ | TypeBloc::Zone => {
                let val = match bl.v.as_str() {
                    "Division" => "Division informatique",
                    "Signalée par" => "Appel au support",
                    "N° de poste" => "2145",
                    "N° de série" => "SN-48213-FR",
                    "Défauts signalés" => "Le poste ne démarre plus après une coupure de courant.",
                    "Défauts constatés" => "Alimentation défaillante.",
                    "Tâches effectuées" => "Remplacement de l’alimentation, contrôle du démarrage.",
                    // Un employé nommé par son nom (§ 11.2) : le document figure sur le profil de Karim Haddad.
                    "Noms des intervenants" | "Nom de l’intervenant" => "Karim Haddad (équipe support)",
                    "Motif de l’acquisition" => "Remplacement de pièces usées.",
                    "Adresse mail" => "prenom.nom@exemple.org",
                    "Motifs" => "Lenteurs répétées et erreurs au démarrage.",
                    "OS installé" => "Windows 11 Professionnel",
                    _ => "",
                };
                bl.val = Some(val.to_string());
            }
            _ => {}
        }
    }
}

/// Insère les données d'exemple dans une base vide (sans ouvrir de transaction).
/// Les modèles standards déjà présents ne sont pas dupliqués.
pub fn inserer(conn: &Connection, aujourd_hui: NaiveDate) -> AppResult<()> {
    let cal = Calendrier::new(aujourd_hui)?;
    let y = cal.annee as i64;

    // ---------- classement et modèles standards ----------
    let support = theme(conn, standards::THEME, true)?;
    let maintenance = theme(conn, "Maintenance", true)?;
    theme(conn, "Ancien parc", false)?;
    modeles::assurer_standards(conn)?;
    let cree_modeles = horo(cal.moment(-1, 0.04, 10, 0)?);
    conn.execute(
        "UPDATE modeles SET cree_le = ?1, maj_le = ?1 WHERE standard IS NOT NULL",
        [&cree_modeles],
    )?;
    // Modèles standards (identifiant, nom, blocs), dans l'ordre des définitions.
    let modeles_std: Vec<(i64, String, Vec<Bloc>)> = standards::definitions()
        .into_iter()
        .map(|s| {
            let id: i64 = conn.query_row("SELECT id FROM modeles WHERE standard = ?1", [s.cle], |r| r.get(0))?;
            let m = modeles::lire(conn, id)?;
            Ok((m.id, m.nom, m.blocs))
        })
        .collect::<AppResult<_>>()?;
    for nom in ["RAM", "Stockage", "Écran"] {
        conn.execute("INSERT INTO magasin (nom, actif) VALUES (?1, 1)", [nom])?;
    }
    let mut structures = Vec::new();
    for nom in ["Division informatique", "Division administrative", "Département maintenance"] {
        conn.execute("INSERT INTO categories (kind, nom, actif) VALUES ('a', ?1, 1)", [nom])?;
        structures.push(conn.last_insert_rowid());
    }
    let mut types = Vec::new();
    for nom in ["PC de bureau", "Ordinateur portable", "Station de travail"] {
        conn.execute("INSERT INTO categories (kind, nom, actif) VALUES ('b', ?1, 1)", [nom])?;
        types.push(conn.last_insert_rowid());
    }

    // ---------- fiches ----------
    let fiche_creee = |kind: Kind, id: i64, libelle: &str, actif: bool, cree: NaiveDateTime, maj: NaiveDateTime| {
        journal::ajouter(conn, journal::FICHE_CREEE, "Fiche créée", &format!("Création de la fiche {libelle}."), Cible::fiche(kind, id), &horo(cree))?;
        if !actif {
            journal::ajouter(
                conn,
                journal::FICHE_ARCHIVEE,
                "Fiche archivée",
                &format!("La fiche {libelle} est archivée. Rien n’est supprimé."),
                Cible::fiche(kind, id),
                &horo(maj),
            )?;
        }
        AppResult::Ok(())
    };
    let mut employes = Vec::new();
    for (i, (nom, prenom, naissance, poste, structure, actif)) in EMPLOYES.into_iter().enumerate() {
        let cree = cal.moment(-1, 0.02 + 0.006 * i as f64, 9 + (i % 3) as u32, (i * 7 % 60) as u32)?;
        let maj = if actif {
            cal.moment(0, 0.05 + 0.06 * i as f64, 14, (i * 11 % 60) as u32)?
        } else {
            cal.moment(-1, 0.85, 15, 20)?
        };
        let code = identifiant_employe(conn, nom, prenom, naissance, poste, None, None)?;
        let libelle = libelle_employe(nom, prenom);
        conn.execute(
            "INSERT INTO entites (kind, nom, code, categorie_id, actif, cree_le, maj_le, libelle, prenom, date_naissance, poste)
             VALUES ('a', ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![nom, code, structures[structure], actif, horo(cree), horo(maj), libelle, prenom, naissance, poste],
        )?;
        let id = conn.last_insert_rowid();
        fiche_creee(Kind::A, id, &libelle, actif, cree, maj)?;
        employes.push(Fiche { id, libelle });
    }
    let mut machines = Vec::new();
    for (i, (nom, code, marque, cpu, ram, stockage, type_machine, actif)) in MACHINES.into_iter().enumerate() {
        let cree = cal.moment(-1, 0.03 + 0.006 * i as f64, 10 + (i % 3) as u32, (i * 13 % 60) as u32)?;
        let maj = if actif {
            cal.moment(0, 0.08 + 0.07 * i as f64, 11, (i * 9 % 60) as u32)?
        } else {
            cal.moment(-1, 0.80, 9, 45)?
        };
        conn.execute(
            "INSERT INTO entites (kind, nom, code, categorie_id, actif, cree_le, maj_le, libelle, marque, cpu, ram, stockage)
             VALUES ('b', ?1, ?2, ?3, ?4, ?5, ?6, ?1, ?7, ?8, ?9, ?10)",
            params![nom, code, types[type_machine], actif, horo(cree), horo(maj), marque, cpu, ram, stockage],
        )?;
        let id = conn.last_insert_rowid();
        fiche_creee(Kind::B, id, nom, actif, cree, maj)?;
        machines.push(Fiche { id, libelle: nom.to_string() });
    }

    // ---------- affectations : machine(i) et machine(i+1) affectées à employé(i) ----------
    // Deux d'entre elles sont terminées (anciennes affectations), les autres sont en cours.
    for (i, a) in employes.iter().enumerate() {
        for (k, j) in [(0_usize, i), (1, (i + 1) % machines.len())] {
            let Some(b) = machines.get(j) else { continue };
            let debut = horo(cal.moment(-1, 0.08 + 0.006 * i as f64 + 0.002 * k as f64, 11, (i * 5 % 60) as u32)?);
            let fin = if k == 1 && (i == 2 || i == 5) {
                Some(horo(cal.moment(0, 0.15 + 0.01 * i as f64, 16, 0)?))
            } else {
                None
            };
            conn.execute(
                "INSERT INTO affectations (a_id, b_id, debut, fin) VALUES (?1, ?2, ?3, ?4)",
                params![a.id, b.id, debut, fin],
            )?;
            journal::ajouter(
                conn,
                journal::ASSOCIATION,
                &format!("Affectation de {} à {}", b.libelle, a.libelle),
                &format!("Machine {} affectée à {}.", b.libelle, a.libelle),
                Cible::paire(a.id, b.id),
                &debut,
            )?;
            if let Some(fin) = fin {
                journal::ajouter(
                    conn,
                    journal::DISSOCIATION,
                    &format!("Fin de l’affectation de {} à {}", b.libelle, a.libelle),
                    &format!("Machine {} retirée à {}.", b.libelle, a.libelle),
                    Cible::paire(a.id, b.id),
                    &fin,
                )?;
            }
        }
    }

    // ---------- dossiers ----------
    // (rang 1-8, décalage d'année, numéro, thème, statut, création (décalage, frac), clôture)
    type Moment = (i32, f64);
    type LigneDossier = (usize, i64, &'static str, bool, Role, Moment, Option<Moment>);
    let dossiers_ex: [LigneDossier; 7] = [
        (1, -1, "01", true, Role::Cours, (-1, 0.40), None),
        (2, -1, "02", true, Role::Piece, (-1, 0.52), None),
        (3, -1, "03", true, Role::Clos, (-1, 0.58), Some((0, 0.25))),
        (4, -1, "04", false, Role::Cours, (-1, 0.78), None),
        (5, 0, "01", false, Role::Clos, (0, 0.08), Some((0, 0.70))),
        (6, 0, "02", true, Role::Piece, (0, 0.40), None),
        (7, -2, "01", false, Role::Clos, (-1, 0.15), Some((-1, 0.35))),
    ];
    for (rang, dec_annee, num, theme_support, statut, (cd, cf), clos) in dossiers_ex {
        let statut_id = statuts::fourni(conn, statut)?.id;
        let annee = y + dec_annee;
        let nom = format!("Dossier {annee}-{num}");
        let (theme_id, theme_nom) =
            if theme_support { (support, standards::THEME) } else { (maintenance, "Maintenance") };
        let a = &employes[rang - 1];
        let b = &machines[rang - 1];
        let cree = cal.moment(cd, cf, 9, 30)?;
        let clos_le = match clos {
            Some((d, f)) => Some(cal.moment(d, f, 17, 15)?),
            None => None,
        };
        let fin = clos_le.unwrap_or(cal.limite).max(cree);
        let derniere = entre(cree, fin, 4, 5);
        let maj = clos_le.unwrap_or(derniere);
        conn.execute(
            "INSERT INTO dossiers (nom, annee, theme_id, statut_id, cree_le, maj_le, clos_le)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![nom, annee, theme_id, statut_id, horo(cree), horo(maj), clos_le.map(horo)],
        )?;
        let did = conn.last_insert_rowid();
        let cible = Cible::dossier(did);

        // options à cocher
        let est_clos = statut == Role::Clos;
        for (pos, (opt, ok)) in OPTIONS_PAR_DEFAUT.iter().zip([est_clos || rang % 2 == 1, est_clos]).enumerate() {
            conn.execute(
                "INSERT INTO options (dossier_id, nom, ok, position) VALUES (?1, ?2, ?3, ?4)",
                params![did, opt, ok, pos as i64],
            )?;
        }

        // sous-dossiers et documents : deux issus des modèles standards, deux fichiers importés (sans copie réelle) ;
        // l'employé et la machine du dossier sont nommés dans les blocs de chaque document (§ 11.1).
        let sd_date = horo(cree + TimeDelta::hours(1));
        let mut sous = Vec::new();
        for sd in ["Demandes", "Interventions"] {
            conn.execute(
                "INSERT INTO sous_dossiers (dossier_id, parent_id, nom, cree_le) VALUES (?1, NULL, ?2, ?3)",
                params![did, sd, sd_date],
            )?;
            sous.push(conn.last_insert_rowid());
        }
        let emplacements = [Some(sous[0]), Some(sous[0]), Some(sous[1]), None];
        for (k, sd) in emplacements.iter().enumerate() {
            let n = k + 1;
            let date = entre(cree, fin, n as i64, 5);
            let date_doc = date.format("%Y-%m-%d").to_string();
            let (origine, source, blocs, modele_id) = if n % 2 == 1 {
                let (modele_id, modele_nom, modele_blocs) = &modeles_std[(rang + k) % modeles_std.len()];
                let mut blocs = modeles::instantane(modele_blocs);
                remplir(&mut blocs, a.id, b.id, &b.libelle, &date_doc, &horo(date));
                ("modele", modele_nom.as_str(), blocs, Some(*modele_id))
            } else {
                ("import", SOURCE_IMPORT, blocs_import(Some(a.id), Some(b.id)), None)
            };
            conn.execute(
                "INSERT INTO documents (dossier_id, sous_dossier_id, nom, origine, source, date_doc, blocs,
                                        fichier_stocke, fichier_nom, piece_finale, cree_le, modele_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, NULL, NULL, 0, ?8, ?9)",
                params![
                    did,
                    sd,
                    format!("Document_{n:02}"),
                    origine,
                    source,
                    date_doc,
                    serde_json::to_string(&blocs)?,
                    horo(date),
                    modele_id
                ],
            )?;
        }

        // journal du dossier
        journal::ajouter(conn, journal::DOSSIER_OUVERT, &format!("{nom} ouvert"), &format!("{theme_nom}."), cible, &horo(cree))?;
        if statut == Role::Piece {
            journal::ajouter(
                conn,
                journal::PIECE_MANQUANTE,
                "Pièce finale manquante",
                &format!("{nom} en attente de sa pièce finale."),
                cible,
                &horo(entre(cree, fin, 1, 10)),
            )?;
        }
        if let Some(c) = clos_le {
            journal::ajouter(conn, journal::DOSSIER_CLOS, &format!("{nom} clôturé"), &format!("{theme_nom}."), cible, &horo(c))?;
        }
    }

    // § 11.2 : nominations des documents d'exemple, datées de leur création.
    nominations::remplir_tout(conn)?;
    parametres::ecrire(conn, parametres::DONNEES_EXEMPLE, "1")?;
    Ok(())
}

/// Tests : remplit une base neuve avec les données d'exemple, dans une transaction. Depuis la version 1.5.1 (§ 14),
/// l'application ne les charge plus au premier lancement, seulement à la demande (« Recharger les données d'exemple »).
#[cfg(test)]
pub fn initialiser(conn: &Connection, aujourd_hui: NaiveDate) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    inserer(&tx, aujourd_hui)?;
    tx.commit()?;
    Ok(())
}
