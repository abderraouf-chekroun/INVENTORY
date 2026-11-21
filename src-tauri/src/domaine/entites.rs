//! Fiches : employés (`kind = 'a'`) et machines (`kind = 'b'`) (§ 8.2, 8.3), affectations d'une machine
//! à un employé (§ 9.3). Les commandes gardent leur nom d'origine (`association_creer` / `association_retirer`).

use super::documents::DocumentLie;
use super::dossiers::DossierResume;
use super::identifiant;
use super::journal::{self, Cible, Evenement};
use super::nominations;
use super::texte::{commence_un_mot, replier};
use super::{Kind, OuIntrouvable, classement, maintenant, nom_requis, texte_borne};
use crate::error::{AppError, AppResult};
use chrono::NaiveDate;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Entite {
    pub id: i64,
    pub kind: Kind,
    pub nom: String,
    /// Identifiant : calculé (employé) ou saisi (machine).
    pub code: Option<String>,
    /// Employé : « NOM Prénom » (le nom seul tant que le prénom manque) ; machine : son nom.
    pub libelle: String,
    pub categorie_id: i64,
    pub categorie: String,
    pub actif: bool,
    pub cree_le: String,
    pub maj_le: String,
    pub prenom: String,
    pub date_naissance: Option<String>,
    pub poste: String,
    pub marque: String,
    pub cpu: String,
    pub ram: String,
    pub stockage: String,
}

/// Fiche d'employé saisie (§ 8.8). L'identifiant n'est jamais saisi.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaisieEmploye {
    pub nom: String,
    #[serde(default)]
    pub prenom: String,
    #[serde(default)]
    pub date_naissance: Option<String>,
    #[serde(default)]
    pub poste: String,
    pub categorie_id: i64,
}

/// Fiche de machine saisie (§ 8.8).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaisieMachine {
    pub nom: String,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub marque: String,
    #[serde(default)]
    pub cpu: String,
    #[serde(default)]
    pub ram: String,
    #[serde(default)]
    pub stockage: String,
    pub categorie_id: i64,
}

/// `SaisieEmploye | SaisieMachine`, distinguées par `kind`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind")]
pub enum SaisieEntite {
    #[serde(rename = "a")]
    Employe(SaisieEmploye),
    #[serde(rename = "b")]
    Machine(SaisieMachine),
}

impl SaisieEntite {
    pub fn kind(&self) -> Kind {
        match self {
            SaisieEntite::Employe(_) => Kind::A,
            SaisieEntite::Machine(_) => Kind::B,
        }
    }
}

/// Ce qui sert à calculer l'identifiant d'un employé (aperçu du formulaire).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaisieIdentifiant {
    #[serde(default)]
    pub nom: String,
    #[serde(default)]
    pub prenom: String,
    #[serde(default)]
    pub date_naissance: Option<String>,
    #[serde(default)]
    pub poste: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FicheEntite {
    pub entite: Entite,
    /// Fiches des affectations en cours.
    pub associees: Vec<Entite>,
    /// En cours d'abord, puis terminées de la plus récente à la plus ancienne (§ 9.5).
    pub affectations: Vec<Affectation>,
    pub dossiers: Vec<DossierResume>,
    pub documents: Vec<DocumentLie>,
    pub evenements: Vec<Evenement>,
}

/// Longueur maximale des champs texte d'une fiche (comme un nom).
pub const MAX_CHAMP: usize = 200;
/// Longueur maximale de l'identifiant d'une machine.
pub const MAX_IDENTIFIANT_MACHINE: usize = 40;
/// Nombre maximal de propositions de l'aide à la saisie.
pub const MAX_SUGGESTIONS: usize = 8;

pub(crate) const SELECT_ENTITE: &str =
    "SELECT e.id, e.kind, e.nom, e.code, e.categorie_id, c.nom, e.actif, e.cree_le, e.maj_le,
            e.libelle, e.prenom, e.date_naissance, e.poste, e.marque, e.cpu, e.ram, e.stockage
     FROM entites e JOIN categories c ON c.id = e.categorie_id";

/// Tri des listes de fiches.
pub(crate) const ORDRE_ENTITES: &str = " ORDER BY e.libelle COLLATE NOCASE, e.id";

pub(crate) fn ligne_entite(r: &rusqlite::Row<'_>) -> rusqlite::Result<Entite> {
    Ok(Entite {
        id: r.get(0)?,
        kind: r.get(1)?,
        nom: r.get(2)?,
        code: r.get(3)?,
        categorie_id: r.get(4)?,
        categorie: r.get(5)?,
        actif: r.get(6)?,
        cree_le: r.get(7)?,
        maj_le: r.get(8)?,
        libelle: r.get(9)?,
        prenom: r.get(10)?,
        date_naissance: r.get(11)?,
        poste: r.get(12)?,
        marque: r.get(13)?,
        cpu: r.get(14)?,
        ram: r.get(15)?,
        stockage: r.get(16)?,
    })
}

pub fn lister(conn: &Connection, kind: Kind) -> AppResult<Vec<Entite>> {
    let mut stmt = conn.prepare(&format!("{SELECT_ENTITE} WHERE e.kind = ?1{ORDRE_ENTITES}"))?;
    let v = stmt.query_map([kind], ligne_entite)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

pub fn lire(conn: &Connection, id: i64) -> AppResult<Entite> {
    conn.query_row(&format!("{SELECT_ENTITE} WHERE e.id = ?1"), [id], ligne_entite)
        .ou_introuvable("Fiche introuvable.")
}

// ---------- libellé et identifiant d'un employé ----------

/// « NOM Prénom » ; le nom seul tant que le prénom manque (fiches reprises de la version 1.0).
pub fn libelle_employe(nom: &str, prenom: &str) -> String {
    if prenom.is_empty() { nom.to_string() } else { format!("{} {prenom}", nom.to_uppercase()) }
}

/// Identifiant à attribuer à un employé (§ 10.5) : `EMP-XXXXX-XXXXX`, ou `None` s'il manque une information.
/// L'identifiant actuel (`actuel`) est conservé tant que les quatre informations ne changent pas ;
/// `sauf` : la fiche elle-même, exclue du contrôle d'unicité.
pub(crate) fn identifiant_employe(
    conn: &Connection,
    nom: &str,
    prenom: &str,
    date_naissance: Option<&str>,
    poste: &str,
    actuel: Option<&str>,
    sauf: Option<i64>,
) -> AppResult<Option<String>> {
    let infos = identifiant::infos(nom, prenom, date_naissance, poste);
    identifiant::attribuer(conn, infos.as_ref(), actuel, sauf)
}

/// Migration 004 (§ 10.5) : recalcule l'identifiant de chaque employé avec la clé de la base. L'ancien identifiant
/// est inscrit au journal de la fiche (« Ancien identifiant : … »). Sans transaction ; la date de modification des
/// fiches ne change pas.
pub(crate) fn recalculer_identifiants(conn: &Connection) -> AppResult<()> {
    type Ligne = (i64, String, String, Option<String>, String, Option<String>);
    let employes: Vec<Ligne> = {
        let mut stmt =
            conn.prepare("SELECT id, nom, prenom, date_naissance, poste, code FROM entites WHERE kind = 'a' ORDER BY id")?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?
            .collect::<rusqlite::Result<_>>()?
    };
    let now = maintenant();
    for (id, nom, prenom, date, poste, ancien) in employes {
        let nouveau = identifiant_employe(conn, &nom, &prenom, date.as_deref(), &poste, None, Some(id))?;
        if nouveau == ancien {
            continue;
        }
        conn.execute("UPDATE entites SET code = ?1 WHERE id = ?2", params![nouveau, id])?;
        if let Some(ancien) = ancien {
            journal::ajouter(
                conn,
                journal::IDENTIFIANT_RECALCULE,
                "Identifiant recalculé",
                &format!("Ancien identifiant : {ancien}"),
                Cible::fiche(Kind::A, id),
                &now,
            )?;
        }
    }
    Ok(())
}

/// Date de naissance facultative : vide → aucune ; sinon `AAAA-MM-JJ`, entre 1900 et aujourd'hui.
fn normaliser_date_naissance(date: Option<&str>) -> AppResult<Option<String>> {
    let d = match date.map(str::trim) {
        None | Some("") => return Ok(None),
        Some(d) => d,
    };
    let date = NaiveDate::parse_from_str(d, "%Y-%m-%d")
        .map_err(|_| AppError::invalide("La date de naissance est invalide (format attendu : AAAA-MM-JJ)."))?;
    let min = NaiveDate::from_ymd_opt(1900, 1, 1).unwrap_or(NaiveDate::MIN);
    if date < min || date > chrono::Local::now().date_naive() {
        return Err(AppError::invalide("La date de naissance doit être comprise entre 1900 et aujourd’hui."));
    }
    Ok(Some(date.format("%Y-%m-%d").to_string()))
}

/// Identifiant d'une machine, facultatif : vide → aucun ; sinon 1 à 40 caractères, sans caractère de contrôle.
pub fn normaliser_identifiant_machine(code: Option<&str>) -> AppResult<Option<String>> {
    let c = match code.map(str::trim) {
        None | Some("") => return Ok(None),
        Some(c) => c,
    };
    if c.chars().count() > MAX_IDENTIFIANT_MACHINE {
        return Err(AppError::refus(
            "code_invalide",
            format!("L’identifiant d’une machine compte {MAX_IDENTIFIANT_MACHINE} caractères au plus."),
        ));
    }
    if c.chars().any(char::is_control) {
        return Err(AppError::refus("code_invalide", "L’identifiant contient des caractères non permis."));
    }
    Ok(Some(c.to_string()))
}

/// Refuse un identifiant déjà porté par une autre fiche du même répertoire (sans tenir compte de la casse).
fn verifier_code_libre(conn: &Connection, kind: Kind, code: &str, sauf: Option<i64>) -> AppResult<()> {
    let mut stmt =
        conn.prepare("SELECT libelle, code FROM entites WHERE kind = ?1 AND code IS NOT NULL AND id IS NOT ?2")?;
    let cherche = code.to_lowercase();
    let porteur = stmt
        .query_map(params![kind, sauf], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .find(|(_, c)| c.to_lowercase() == cherche);
    match porteur {
        Some((libelle, _)) => {
            Err(AppError::refus("code_doublon", format!("Cet identifiant est déjà utilisé par {libelle}.")))
        }
        None => Ok(()),
    }
}

/// La catégorie doit exister, être du bon répertoire et active (sauf si c'est la catégorie actuelle).
fn verifier_categorie(conn: &Connection, kind: Kind, categorie_id: i64, actuelle: Option<i64>) -> AppResult<()> {
    let cat = classement::categorie_lire(conn, categorie_id)?;
    if cat.kind != kind {
        return Err(AppError::invalide(match kind {
            Kind::A => "Choisissez une structure.",
            Kind::B => "Choisissez un type de machine.",
        }));
    }
    if !cat.actif && actuelle != Some(categorie_id) {
        return Err(AppError::refus(
            "categorie_archivee",
            match kind {
                Kind::A => format!("La structure « {} » est archivée.", cat.nom),
                Kind::B => format!("Le type de machine « {} » est archivé.", cat.nom),
            },
        ));
    }
    Ok(())
}

/// Champs d'une fiche, validés et prêts à écrire.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Champs {
    nom: String,
    libelle: String,
    code: Option<String>,
    categorie_id: i64,
    prenom: String,
    date_naissance: Option<String>,
    poste: String,
    marque: String,
    cpu: String,
    ram: String,
    stockage: String,
}

/// Valide une saisie ; `avant` : la fiche modifiée (son identifiant et sa catégorie actuels).
fn champs(conn: &Connection, saisie: &SaisieEntite, avant: Option<&Entite>) -> AppResult<Champs> {
    let kind = saisie.kind();
    let sauf = avant.map(|e| e.id);
    match saisie {
        SaisieEntite::Employe(s) => {
            // § 10.6 : nom, prénom, date de naissance, poste et structure obligatoires, dans cet ordre.
            // Un texte sans aucune lettre ni chiffre (« - ») ne compte pas : il ne permettrait pas de calculer l'identifiant.
            let rempli = |t: &str| t.chars().any(char::is_alphanumeric);
            let nom = nom_requis(&s.nom, "Le nom de l’employé est obligatoire.")?;
            if !rempli(&nom) {
                return Err(AppError::invalide("Le nom de l’employé est obligatoire."));
            }
            let prenom = texte_borne(&s.prenom, MAX_CHAMP, "Le prénom")?;
            if !rempli(&prenom) {
                return Err(AppError::invalide("Le prénom est obligatoire."));
            }
            let date_naissance = normaliser_date_naissance(s.date_naissance.as_deref())?;
            if date_naissance.is_none() {
                return Err(AppError::invalide("La date de naissance est obligatoire."));
            }
            let poste = texte_borne(&s.poste, MAX_CHAMP, "Le poste")?;
            if !rempli(&poste) {
                return Err(AppError::invalide("Le poste est obligatoire."));
            }
            if s.categorie_id <= 0 {
                return Err(AppError::invalide("La structure est obligatoire."));
            }
            verifier_categorie(conn, kind, s.categorie_id, avant.map(|e| e.categorie_id))?;
            let code = identifiant_employe(
                conn,
                &nom,
                &prenom,
                date_naissance.as_deref(),
                &poste,
                avant.and_then(|e| e.code.as_deref()),
                sauf,
            )?;
            Ok(Champs {
                libelle: libelle_employe(&nom, &prenom),
                nom,
                code,
                categorie_id: s.categorie_id,
                prenom,
                date_naissance,
                poste,
                marque: String::new(),
                cpu: String::new(),
                ram: String::new(),
                stockage: String::new(),
            })
        }
        SaisieEntite::Machine(s) => {
            let nom = nom_requis(&s.nom, "Le nom de la machine est obligatoire.")?;
            let code = normaliser_identifiant_machine(s.code.as_deref())?;
            let marque = texte_borne(&s.marque, MAX_CHAMP, "La marque et le modèle")?;
            let cpu = texte_borne(&s.cpu, MAX_CHAMP, "Le processeur")?;
            let ram = texte_borne(&s.ram, MAX_CHAMP, "La RAM")?;
            let stockage = texte_borne(&s.stockage, MAX_CHAMP, "Le stockage")?;
            if s.categorie_id <= 0 {
                return Err(AppError::invalide("Le type de machine est obligatoire."));
            }
            verifier_categorie(conn, kind, s.categorie_id, avant.map(|e| e.categorie_id))?;
            if let Some(c) = &code {
                verifier_code_libre(conn, kind, c, sauf)?;
            }
            Ok(Champs {
                libelle: nom.clone(),
                nom,
                code,
                categorie_id: s.categorie_id,
                prenom: String::new(),
                date_naissance: None,
                poste: String::new(),
                marque,
                cpu,
                ram,
                stockage,
            })
        }
    }
}

/// Vrai si la saisie d'un employé reprend exactement la fiche enregistrée (espaces aux extrémités ignorés).
fn saisie_inchangee(saisie: &SaisieEntite, e: &Entite) -> bool {
    match saisie {
        SaisieEntite::Employe(s) => {
            let date = s.date_naissance.as_deref().map(str::trim).filter(|d| !d.is_empty());
            s.nom.trim() == e.nom
                && s.prenom.trim() == e.prenom
                && date == e.date_naissance.as_deref()
                && s.poste.trim() == e.poste
                && s.categorie_id == e.categorie_id
        }
        SaisieEntite::Machine(_) => false,
    }
}

pub fn creer(conn: &Connection, saisie: &SaisieEntite) -> AppResult<Entite> {
    let kind = saisie.kind();
    let c = champs(conn, saisie, None)?;
    let tx = conn.unchecked_transaction()?;
    let now = maintenant();
    tx.execute(
        "INSERT INTO entites (kind, nom, code, categorie_id, actif, cree_le, maj_le,
                              libelle, prenom, date_naissance, poste, marque, cpu, ram, stockage)
         VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        params![
            kind, c.nom, c.code, c.categorie_id, now, c.libelle, c.prenom, c.date_naissance, c.poste, c.marque,
            c.cpu, c.ram, c.stockage
        ],
    )?;
    let id = tx.last_insert_rowid();
    journal::ajouter(
        &tx,
        journal::FICHE_CREEE,
        "Fiche créée",
        &format!("Création de la fiche {}.", c.libelle),
        Cible::fiche(kind, id),
        &now,
    )?;
    // § 11.2 : son nom peut déjà être écrit dans des documents.
    nominations::mettre_a_jour_fiche(&tx, &lire(&tx, id)?, &now)?;
    tx.commit()?;
    lire(conn, id)
}

pub fn modifier(conn: &Connection, id: i64, saisie: &SaisieEntite) -> AppResult<Entite> {
    let avant = lire(conn, id)?;
    if saisie.kind() != avant.kind {
        return Err(AppError::invalide(format!("{} n’est pas {}.", avant.libelle, saisie.kind().un())));
    }
    let c = match champs(conn, saisie, Some(&avant)) {
        Ok(c) => c,
        // § 10.6 : une fiche incomplète venue d'une version précédente, renvoyée telle quelle, n'est pas modifiée :
        // rien n'est refusé ni écrit. Toute modification réelle exige les champs obligatoires.
        Err(e) if e.code == "saisie_invalide" && saisie_inchangee(saisie, &avant) => return Ok(avant),
        Err(e) => return Err(e),
    };
    let mut changements = Vec::new();
    let mut noter = |change: bool, quoi: &'static str| {
        if change {
            changements.push(quoi);
        }
    };
    noter(c.nom != avant.nom, "nom");
    match avant.kind {
        Kind::A => {
            noter(c.prenom != avant.prenom, "prénom");
            noter(c.date_naissance != avant.date_naissance, "date de naissance");
            noter(c.poste != avant.poste, "poste");
            noter(c.categorie_id != avant.categorie_id, "structure");
            noter(c.code != avant.code, "identifiant");
        }
        Kind::B => {
            noter(c.code != avant.code, "identifiant");
            noter(c.marque != avant.marque, "marque et modèle");
            noter(c.cpu != avant.cpu, "processeur");
            noter(c.ram != avant.ram, "RAM");
            noter(c.stockage != avant.stockage, "stockage");
            noter(c.categorie_id != avant.categorie_id, "type de machine");
        }
    }
    if changements.is_empty() && c.libelle == avant.libelle {
        return Ok(avant);
    }
    let tx = conn.unchecked_transaction()?;
    let now = maintenant();
    tx.execute(
        "UPDATE entites SET nom = ?1, code = ?2, categorie_id = ?3, maj_le = ?4, libelle = ?5, prenom = ?6,
                date_naissance = ?7, poste = ?8, marque = ?9, cpu = ?10, ram = ?11, stockage = ?12
         WHERE id = ?13",
        params![
            c.nom, c.code, c.categorie_id, now, c.libelle, c.prenom, c.date_naissance, c.poste, c.marque, c.cpu,
            c.ram, c.stockage, id
        ],
    )?;
    let cible = Cible::fiche(avant.kind, id);
    if !changements.is_empty() {
        let detail = format!("Modification : {}.", changements.join(", "));
        journal::ajouter(&tx, journal::FICHE_MODIFIEE, "Fiche modifiée", &detail, cible, &now)?;
    }
    if let Some(code) = &c.code
        && c.code != avant.code
    {
        journal::ajouter(
            &tx,
            journal::CODE_SAISI,
            "Identifiant attribué",
            &format!("Identifiant {code} attribué à la fiche."),
            cible,
            &now,
        )?;
    }
    // § 11.2 : fiche renommée ou identifiant changé : ses nominations par le texte sont recalculées.
    let apres = lire(&tx, id)?;
    if !nominations::meme_recherche(&avant, &apres) {
        nominations::mettre_a_jour_fiche(&tx, &apres, &now)?;
    }
    tx.commit()?;
    lire(conn, id)
}

/// Identifiant d'une machine (« Inventaire à compléter »). Celui d'un employé est calculé : refus.
pub fn definir_code(conn: &Connection, id: i64, code: &str) -> AppResult<Entite> {
    let avant = lire(conn, id)?;
    if avant.kind == Kind::A {
        return Err(AppError::refus(
            "identifiant_automatique",
            "L’identifiant d’un employé est calculé automatiquement : complétez son nom, son prénom, \
             sa date de naissance et son poste.",
        ));
    }
    let code = normaliser_identifiant_machine(Some(code))?
        .ok_or_else(|| AppError::refus("code_invalide", "Saisissez l’identifiant de la machine."))?;
    if avant.code.as_deref() == Some(code.as_str()) {
        return Ok(avant);
    }
    verifier_code_libre(conn, avant.kind, &code, Some(id))?;
    let tx = conn.unchecked_transaction()?;
    let now = maintenant();
    tx.execute("UPDATE entites SET code = ?1, maj_le = ?2 WHERE id = ?3", params![code, now, id])?;
    journal::ajouter(
        &tx,
        journal::CODE_SAISI,
        "Identifiant saisi",
        &format!("Identifiant {code} attribué à la fiche."),
        Cible::fiche(avant.kind, id),
        &now,
    )?;
    let apres = lire(&tx, id)?;
    if !nominations::meme_recherche(&avant, &apres) {
        nominations::mettre_a_jour_fiche(&tx, &apres, &now)?;
    }
    tx.commit()?;
    lire(conn, id)
}

/// Identifiant qui serait attribué à cet employé (aperçu en direct du formulaire), sans rien écrire.
/// `id_existant` : la fiche en cours de modification, dont l'identifiant actuel est conservé si sa base ne change pas.
pub fn apercu_identifiant(
    conn: &Connection,
    saisie: &SaisieIdentifiant,
    id_existant: Option<i64>,
) -> AppResult<Option<String>> {
    // Champs plus longs que ce que l'enregistrement accepte : aucun identifiant (et aucun calcul sur un texte démesuré).
    let trop_long = |s: &str| s.trim().chars().nth(MAX_CHAMP).is_some();
    if [&saisie.nom, &saisie.prenom, &saisie.poste].into_iter().any(|s| trop_long(s))
        || saisie.date_naissance.as_deref().is_some_and(|d| d.len() > 32)
    {
        return Ok(None);
    }
    let actuel = match id_existant {
        Some(id) => exiger(conn, id, Kind::A, false)?.code,
        None => None,
    };
    // Même calcul que l'enregistrement ; une date invalide ou hors bornes donne « aucun identifiant », sans erreur.
    let date = normaliser_date_naissance(saisie.date_naissance.as_deref()).ok().flatten();
    identifiant_employe(
        conn,
        saisie.nom.trim(),
        saisie.prenom.trim(),
        date.as_deref(),
        saisie.poste.trim(),
        actuel.as_deref(),
        id_existant,
    )
}

pub fn basculer(conn: &Connection, id: i64) -> AppResult<Entite> {
    let avant = lire(conn, id)?;
    let tx = conn.unchecked_transaction()?;
    let now = maintenant();
    tx.execute("UPDATE entites SET actif = ?1, maj_le = ?2 WHERE id = ?3", params![!avant.actif, now, id])?;
    let (t, titre, detail) = if avant.actif {
        (journal::FICHE_ARCHIVEE, "Fiche archivée", format!("La fiche {} est archivée. Rien n’est supprimé.", avant.libelle))
    } else {
        (journal::FICHE_REACTIVEE, "Fiche réactivée", format!("La fiche {} est de nouveau active.", avant.libelle))
    };
    journal::ajouter(&tx, t, titre, &detail, Cible::fiche(avant.kind, id), &now)?;
    tx.commit()?;
    lire(conn, id)
}

/// Lit une fiche et vérifie son répertoire ; `active` exige qu'elle ne soit pas archivée.
pub(crate) fn exiger(conn: &Connection, id: i64, kind: Kind, active: bool) -> AppResult<Entite> {
    let e = lire(conn, id)?;
    if e.kind != kind {
        return Err(AppError::invalide(format!("{} n’est pas {}.", e.libelle, kind.un())));
    }
    if active && !e.actif {
        return Err(AppError::refus(
            "fiche_archivee",
            format!("La fiche {} est archivée. Réactivez-la d’abord.", e.libelle),
        ));
    }
    Ok(e)
}

// ---------- recherche et aide à la saisie ----------

/// Texte où chercher une fiche, replié (§ 8.4) : nom, prénom et identifiant d'un employé ;
/// nom, marque et identifiant d'une machine.
pub fn texte_cherchable(e: &Entite) -> String {
    let champs: [&str; 3] = match e.kind {
        Kind::A => [&e.nom, &e.prenom, e.code.as_deref().unwrap_or("")],
        Kind::B => [&e.nom, &e.marque, e.code.as_deref().unwrap_or("")],
    };
    replier(&champs.join(" "))
}

/// Aide à la saisie (§ 8.4) : fiches actives dont un mot commence par la saisie, puis celles qui la contiennent ;
/// sans tenir compte de la casse ni des accents ; 8 au plus ; saisie vide → aucune proposition.
pub fn suggerer(conn: &Connection, kind: Kind, q: &str) -> AppResult<Vec<Entite>> {
    let q = replier(q.chars().take(super::recherche::MAX_RECHERCHE).collect::<String>().trim());
    if q.is_empty() {
        return Ok(Vec::new());
    }
    let mut trouvees: Vec<(u8, String, Entite)> = lister(conn, kind)?
        .into_iter()
        .filter(|e| e.actif)
        .filter_map(|e| {
            let texte = texte_cherchable(&e);
            let rang = if commence_un_mot(&texte, &q) {
                0
            } else if texte.contains(&q) {
                1
            } else {
                return None;
            };
            Some((rang, replier(&e.libelle), e))
        })
        .collect();
    trouvees.sort_by(|x, y| (x.0, &x.1, x.2.id).cmp(&(y.0, &y.1, y.2.id)));
    Ok(trouvees.into_iter().take(MAX_SUGGESTIONS).map(|(_, _, e)| e).collect())
}

// ---------- affectations (§ 9.3) ----------

/// Identifiant de l'affectation en cours de la paire (machine `b_id` affectée à l'employé `a_id`), s'il y en a une.
pub fn affectation_en_cours(conn: &Connection, a_id: i64, b_id: i64) -> AppResult<Option<i64>> {
    Ok(conn
        .query_row(
            "SELECT id FROM affectations WHERE a_id = ?1 AND b_id = ?2 AND fin IS NULL",
            params![a_id, b_id],
            |r| r.get(0),
        )
        .optional()?)
}

/// Vrai si la machine est actuellement affectée à l'employé.
pub fn sont_associees(conn: &Connection, a_id: i64, b_id: i64) -> AppResult<bool> {
    Ok(affectation_en_cours(conn, a_id, b_id)?.is_some())
}

/// Démarre une affectation et écrit sa ligne de journal (sans vérification ni transaction).
fn inserer_affectation(conn: &Connection, a: &Entite, b: &Entite, date: &str) -> AppResult<()> {
    conn.execute("INSERT INTO affectations (a_id, b_id, debut) VALUES (?1, ?2, ?3)", params![a.id, b.id, date])?;
    journal::ajouter(
        conn,
        journal::ASSOCIATION,
        &format!("Affectation de {} à {}", b.libelle, a.libelle),
        &format!("Machine {} affectée à {}.", b.libelle, a.libelle),
        Cible::paire(a.id, b.id),
        date,
    )
}

/// « Affecter une machine » : nouvelle période pour la paire. Fiches actives seulement ;
/// refus `deja_associees` si une affectation de la paire est déjà en cours.
pub fn associer(conn: &Connection, a_id: i64, b_id: i64) -> AppResult<()> {
    let a = exiger(conn, a_id, Kind::A, true)?;
    let b = exiger(conn, b_id, Kind::B, true)?;
    if sont_associees(conn, a_id, b_id)? {
        return Err(AppError::refus(
            "deja_associees",
            format!("La machine {} est déjà affectée à {}.", b.libelle, a.libelle),
        ));
    }
    let tx = conn.unchecked_transaction()?;
    inserer_affectation(&tx, &a, &b, &maintenant())?;
    tx.commit()?;
    Ok(())
}

/// « Retirer l'affectation » : l'affectation en cours reçoit une date de fin. Jamais refusé à cause d'un
/// dossier ni d'une fiche archivée ; refus `non_associees` s'il n'y a pas d'affectation en cours.
pub fn dissocier(conn: &Connection, a_id: i64, b_id: i64) -> AppResult<()> {
    let a = exiger(conn, a_id, Kind::A, false)?;
    let b = exiger(conn, b_id, Kind::B, false)?;
    let Some(id) = affectation_en_cours(conn, a_id, b_id)? else {
        return Err(AppError::refus(
            "non_associees",
            format!("La machine {} n’est pas affectée à {}.", b.libelle, a.libelle),
        ));
    };
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE affectations SET fin = ?1 WHERE id = ?2", params![now, id])?;
    journal::ajouter(
        &tx,
        journal::DISSOCIATION,
        &format!("Fin de l’affectation de {} à {}", b.libelle, a.libelle),
        &format!("Machine {} retirée à {}.", b.libelle, a.libelle),
        Cible::paire(a_id, b_id),
        &now,
    )?;
    tx.commit()?;
    Ok(())
}

/// Fiches de l'autre répertoire affectées en ce moment à `entite`.
pub fn associees(conn: &Connection, entite: &Entite) -> AppResult<Vec<Entite>> {
    let (col, autre) = match entite.kind {
        Kind::A => ("a_id", "b_id"),
        Kind::B => ("b_id", "a_id"),
    };
    let mut stmt = conn.prepare(&format!(
        "{SELECT_ENTITE} JOIN affectations s ON s.{autre} = e.id
         WHERE s.{col} = ?1 AND s.fin IS NULL{ORDRE_ENTITES}"
    ))?;
    let v = stmt.query_map([entite.id], ligne_entite)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// Affectation vue depuis une fiche : `entite` est la fiche de l'autre côté.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Affectation {
    pub id: i64,
    pub entite: Entite,
    pub debut: String,
    /// `None` : affectation en cours.
    pub fin: Option<String>,
}

/// Affectations d'une fiche : en cours d'abord (la plus récente en tête), puis terminées de la plus récente
/// à la plus ancienne (par date de fin).
pub fn affectations(conn: &Connection, entite: &Entite) -> AppResult<Vec<Affectation>> {
    let (col, autre) = match entite.kind {
        Kind::A => ("a_id", "b_id"),
        Kind::B => ("b_id", "a_id"),
    };
    // Les colonnes de l'affectation suivent les 17 colonnes de SELECT_ENTITE lues par `ligne_entite`.
    let select = SELECT_ENTITE.replacen(" FROM entites e", ", s.id, s.debut, s.fin FROM entites e", 1);
    let mut stmt = conn.prepare(&format!(
        "{select} JOIN affectations s ON s.{autre} = e.id
         WHERE s.{col} = ?1
         ORDER BY s.fin IS NOT NULL, s.fin DESC, s.debut DESC, s.id DESC"
    ))?;
    let v = stmt
        .query_map([entite.id], |r| {
            Ok(Affectation { entite: ligne_entite(r)?, id: r.get(17)?, debut: r.get(18)?, fin: r.get(19)? })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

// ---------- suppression (§ 13.2) ----------

/// L'autre fiche d'une affectation en cours.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AutreFiche {
    pub id: i64,
    pub nom: String,
}

/// Ce que supprimera [`supprimer`] (§ 13.4).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SuppressionApercu {
    /// La plus récente des affectations en cours, `None` s'il n'y en a pas.
    pub affectation_en_cours: Option<AutreFiche>,
    /// Toutes les affectations en cours, de la plus récente à la plus ancienne.
    pub affectations_en_cours: Vec<AutreFiche>,
    pub nb_affectations_passees: i64,
    /// Documents distincts où la fiche est nommée.
    pub nb_documents: i64,
    /// Dossiers distincts de ces documents.
    pub nb_dossiers: i64,
}

/// Colonne d'une fiche dans `affectations` et `evenements`, et celle de l'autre côté.
fn colonnes(kind: Kind) -> (&'static str, &'static str) {
    match kind {
        Kind::A => ("a_id", "b_id"),
        Kind::B => ("b_id", "a_id"),
    }
}

fn affectations_en_cours(conn: &Connection, e: &Entite) -> AppResult<Vec<AutreFiche>> {
    let (col, autre) = colonnes(e.kind);
    let mut stmt = conn.prepare(&format!(
        "SELECT o.id, o.libelle FROM affectations s JOIN entites o ON o.id = s.{autre}
         WHERE s.{col} = ?1 AND s.fin IS NULL
         ORDER BY s.debut DESC, s.id DESC"
    ))?;
    let v = stmt
        .query_map([e.id], |r| Ok(AutreFiche { id: r.get(0)?, nom: r.get(1)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// Aperçu de la suppression d'une fiche, avec les nombres réels (fenêtre de confirmation).
pub fn apercu_suppression(conn: &Connection, id: i64) -> AppResult<SuppressionApercu> {
    let e = lire(conn, id)?;
    let (col, _) = colonnes(e.kind);
    let en_cours = affectations_en_cours(conn, &e)?;
    let nb_affectations_passees: i64 = conn.query_row(
        &format!("SELECT COUNT(*) FROM affectations WHERE {col} = ?1 AND fin IS NOT NULL"),
        [id],
        |r| r.get(0),
    )?;
    let (nb_documents, nb_dossiers): (i64, i64) = conn.query_row(
        "SELECT COUNT(DISTINCT x.id), COUNT(DISTINCT x.dossier_id)
         FROM nominations n JOIN documents x ON x.id = n.document_id WHERE n.entite_id = ?1",
        [id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    Ok(SuppressionApercu {
        affectation_en_cours: en_cours.first().cloned(),
        affectations_en_cours: en_cours,
        nb_affectations_passees,
        nb_documents,
        nb_dossiers,
    })
}

/// Blocs `employe` / `machine` qui désignent la fiche supprimée : ils ne désignent plus rien et gardent une copie de
/// la fiche (§ 13.2, effet 2), y compris dans les dossiers clôturés. Un bloc de l'autre répertoire qui portait le même
/// numéro (contenu incohérent) est seulement vidé : le numéro pourra être réattribué à une autre fiche.
/// Les documents sans changement ne sont pas réécrits ; des blocs illisibles sont laissés tels quels.
fn conserver_dans_les_documents(conn: &Connection, e: &Entite, now: &str) -> AppResult<usize> {
    let copie = super::modeles::FicheSupprimee::de(e, now);
    let candidats: Vec<(i64, String)> = {
        let mut stmt = conn.prepare("SELECT id, blocs FROM documents WHERE blocs IS NOT NULL AND instr(blocs, 'entiteId') > 0")?;
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?
    };
    let mut modifies = 0;
    for (document_id, json) in candidats {
        let Some(mut blocs) = super::modeles::decoder_blocs(&json) else { continue };
        let mut change = false;
        for b in blocs.iter_mut() {
            let Some(kind) = b.t.kind_designe() else { continue };
            if b.entite_id.flatten() != Some(e.id) {
                continue;
            }
            b.entite_id = Some(None);
            b.fiche_supprimee = (kind == e.kind).then(|| copie.clone());
            change = true;
        }
        if change {
            // Conservation du contenu : aucune borne de taille (la copie d'une fiche est bornée par ses champs).
            let encode = super::modeles::encoder_blocs(&blocs, usize::MAX)?;
            conn.execute("UPDATE documents SET blocs = ?1 WHERE id = ?2", params![encode, document_id])?;
            modifies += 1;
        }
    }
    Ok(modifies)
}

/// « Supprimer » une fiche, active ou archivée (§ 13.2), en une seule transaction : rien n'est modifié en cas d'échec.
///
/// 1. Les affectations en cours se terminent : une ligne « fin d'affectation » est écrite au journal de l'autre fiche.
/// 2. Les blocs qui la désignaient gardent une copie de la fiche ([`conserver_dans_les_documents`]).
/// 3. Les événements qu'elle partage avec une autre fiche ou un dossier restent, sans son identifiant et avec son
///    libellé (`a_libelle_supprime` / `b_libelle_supprime`) ; ses autres événements sont supprimés.
/// 4. Ses nominations, ses affectations (en cours et passées) et la fiche sont supprimées.
/// 5. Un événement `fiche_supprimee`, rattaché à rien, est ajouté au journal.
///
/// Les dossiers ne sont pas « touchés » (date de modification inchangée) : c'est une conservation du contenu.
pub fn supprimer(conn: &Connection, id: i64) -> AppResult<()> {
    let e = lire(conn, id)?;
    let (col, autre) = colonnes(e.kind);
    let (col_libelle, autre_kind) = match e.kind {
        Kind::A => ("a_libelle_supprime", Kind::B),
        Kind::B => ("b_libelle_supprime", Kind::A),
    };
    let now = maintenant();
    let tx = conn.unchecked_transaction()?;

    // 1. Fin des affectations en cours, au journal de l'autre fiche (elle ne cite plus la fiche que par son libellé).
    for autre_fiche in affectations_en_cours(&tx, &e)? {
        let (machine, employe) = match e.kind {
            Kind::A => (autre_fiche.nom.as_str(), e.libelle.as_str()),
            Kind::B => (e.libelle.as_str(), autre_fiche.nom.as_str()),
        };
        let mention = journal::mention_supprimee(e.kind);
        let (a_supprime, b_supprime) = match e.kind {
            Kind::A => (Some(e.libelle.as_str()), None),
            Kind::B => (None, Some(e.libelle.as_str())),
        };
        journal::ajouter_avec_supprimee(
            &tx,
            journal::DISSOCIATION,
            &format!("Fin de l’affectation de {machine} à {employe}"),
            &format!("{} {mention} : fin de l’affectation de la machine {machine} à {employe}.", e.libelle),
            Cible::fiche(autre_kind, autre_fiche.id),
            a_supprime,
            b_supprime,
            &now,
        )?;
    }

    // 2. Documents : le nom et l'identifiant restent écrits dans les blocs.
    conserver_dans_les_documents(&tx, &e, &now)?;

    // 3. Journal : les événements qui n'appartenaient qu'à la fiche partent ; les autres la citent par son libellé.
    tx.execute(
        &format!("DELETE FROM evenements WHERE {col} = ?1 AND {autre} IS NULL AND dossier_id IS NULL"),
        [id],
    )?;
    tx.execute(
        &format!("UPDATE evenements SET {col} = NULL, {col_libelle} = ?2 WHERE {col} = ?1"),
        params![id, e.libelle],
    )?;

    // 4. Nominations, affectations, puis la fiche (les clés étrangères refusent toute référence restante).
    tx.execute("DELETE FROM nominations WHERE entite_id = ?1", [id])?;
    tx.execute("DELETE FROM affectations WHERE a_id = ?1 OR b_id = ?1", [id])?;
    tx.execute("DELETE FROM entites WHERE id = ?1", [id])?;

    // 5. Journal général.
    let titre = match e.kind {
        Kind::A => format!("Employé « {} » supprimé", e.libelle),
        Kind::B => format!("Machine « {} » supprimée", e.libelle),
    };
    let detail = match &e.code {
        Some(c) => format!("Identifiant {c}. Fiche supprimée définitivement."),
        None => "Sans identifiant. Fiche supprimée définitivement.".to_string(),
    };
    let (a_supprime, b_supprime) = match e.kind {
        Kind::A => (Some(e.libelle.as_str()), None),
        Kind::B => (None, Some(e.libelle.as_str())),
    };
    journal::ajouter_avec_supprimee(
        &tx,
        journal::FICHE_SUPPRIMEE,
        &titre,
        &detail,
        Cible::default(),
        a_supprime,
        b_supprime,
        &now,
    )?;
    tx.commit()?;
    Ok(())
}

pub fn fiche(conn: &Connection, fichiers: &Path, id: i64) -> AppResult<FicheEntite> {
    let entite = lire(conn, id)?;
    let associees = associees(conn, &entite)?;
    let affectations = affectations(conn, &entite)?;
    // § 11.2 : documents où la fiche est nommée, dossiers qui les contiennent, nominations et événements de ces
    // dossiers dans l'historique.
    let documents = nominations::documents(conn, fichiers, &entite)?;
    let dossiers = nominations::dossiers_lies(conn, &entite)?;
    let evenements =
        nominations::fusionner(journal::pour_entite(conn, entite.kind, id)?, nominations::evenements(conn, &entite)?);
    Ok(FicheEntite { entite, associees, affectations, dossiers, documents, evenements })
}
