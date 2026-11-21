//! Thèmes (appelés « catégories » à l'écran depuis la 1.7), catégories internes (structures des employés / types de
//! machine) et mots-clés du Magasin. On archive, on ne supprime pas ; exceptions : une structure ou un type de machine
//! vide (§ 9.1) et, depuis la 1.7 (§ 16), un thème sans dossier ni modèle de document peuvent être supprimés ; depuis
//! la 1.8 (§ 17), un mot-clé du Magasin se renomme et se supprime.

use super::{Kind, OuIntrouvable, modeles, nom_requis};
use crate::error::{AppError, AppResult};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Classement {
    pub id: i64,
    pub nom: String,
    pub actif: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Categorie {
    pub id: i64,
    pub nom: String,
    pub actif: bool,
    pub kind: Kind,
    /// Fiches actives et archivées de la catégorie (§ 9.1).
    pub nb_fiches: i64,
}

/// Tables simples (id, nom UNIQUE, actif).
#[derive(Clone, Copy)]
enum Table {
    Themes,
    Magasin,
}

impl Table {
    fn nom(self) -> &'static str {
        match self {
            Table::Themes => "themes",
            Table::Magasin => "magasin",
        }
    }
    fn msg_vide(self) -> &'static str {
        match self {
            Table::Themes => "Le nom de la catégorie est obligatoire.",
            Table::Magasin => "Le mot-clé est obligatoire.",
        }
    }
    fn msg_doublon(self) -> &'static str {
        match self {
            Table::Themes => "Cette catégorie existe déjà.",
            Table::Magasin => "Ce mot-clé existe déjà dans le Magasin.",
        }
    }
    fn msg_introuvable(self) -> &'static str {
        match self {
            Table::Themes => "Catégorie introuvable.",
            Table::Magasin => "Mot-clé introuvable.",
        }
    }
}

fn lister(conn: &Connection, t: Table) -> AppResult<Vec<Classement>> {
    let mut stmt = conn.prepare(&format!("SELECT id, nom, actif FROM {} ORDER BY id", t.nom()))?;
    let v = stmt
        .query_map([], |r| Ok(Classement { id: r.get(0)?, nom: r.get(1)?, actif: r.get(2)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

fn lire(conn: &Connection, t: Table, id: i64) -> AppResult<Classement> {
    conn.query_row(&format!("SELECT id, nom, actif FROM {} WHERE id = ?1", t.nom()), [id], |r| {
        Ok(Classement { id: r.get(0)?, nom: r.get(1)?, actif: r.get(2)? })
    })
    .ou_introuvable(t.msg_introuvable())
}

fn creer(conn: &Connection, t: Table, nom: &str) -> AppResult<Classement> {
    let nom = nom_requis(nom, t.msg_vide())?;
    let existe: Option<i64> = conn
        .query_row(
            &format!("SELECT id FROM {} WHERE lower(nom) = lower(?1)", t.nom()),
            [&nom],
            |r| r.get(0),
        )
        .optional()?;
    if existe.is_some() {
        return Err(AppError::refus("doublon", t.msg_doublon()));
    }
    conn.execute(&format!("INSERT INTO {} (nom, actif) VALUES (?1, 1)", t.nom()), [&nom])?;
    lire(conn, t, conn.last_insert_rowid())
}

fn basculer(conn: &Connection, t: Table, id: i64) -> AppResult<Classement> {
    lire(conn, t, id)?;
    conn.execute(&format!("UPDATE {} SET actif = 1 - actif WHERE id = ?1", t.nom()), [id])?;
    lire(conn, t, id)
}

/// Thème (« catégorie » à l'écran, § 16) avec le nombre de dossiers et de modèles de document (actifs et archivés)
/// qui lui appartiennent : la suppression n'est possible qu'à 0 et 0.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ThemeCompte {
    pub id: i64,
    pub nom: String,
    pub actif: bool,
    pub nb_dossiers: i64,
    pub nb_modeles: i64,
}

const SELECT_THEME: &str = "SELECT t.id, t.nom, t.actif,
        (SELECT COUNT(*) FROM dossiers d WHERE d.theme_id = t.id),
        (SELECT COUNT(*) FROM modeles m WHERE m.theme_id = t.id)
     FROM themes t";

fn ligne_theme(r: &rusqlite::Row<'_>) -> rusqlite::Result<ThemeCompte> {
    Ok(ThemeCompte { id: r.get(0)?, nom: r.get(1)?, actif: r.get(2)?, nb_dossiers: r.get(3)?, nb_modeles: r.get(4)? })
}

pub fn themes_lister(conn: &Connection) -> AppResult<Vec<ThemeCompte>> {
    let mut stmt = conn.prepare(&format!("{SELECT_THEME} ORDER BY t.id"))?;
    let v = stmt.query_map([], ligne_theme)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}
pub fn theme_compte(conn: &Connection, id: i64) -> AppResult<ThemeCompte> {
    conn.query_row(&format!("{SELECT_THEME} WHERE t.id = ?1"), [id], ligne_theme)
        .ou_introuvable(Table::Themes.msg_introuvable())
}
pub fn theme_lire(conn: &Connection, id: i64) -> AppResult<Classement> {
    lire(conn, Table::Themes, id)
}

/// Refuse un nom déjà porté par un autre thème (même comparaison que pour les structures : espaces aux extrémités
/// retirés, sans tenir compte de la casse, lettres accentuées comprises).
fn verifier_nom_theme_libre(conn: &Connection, nom: &str, sauf: Option<i64>) -> AppResult<()> {
    let cherche = nom.trim().to_lowercase();
    let mut stmt = conn.prepare("SELECT nom FROM themes WHERE id IS NOT ?1")?;
    let noms = stmt.query_map([sauf], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    if noms.iter().any(|n| n.trim().to_lowercase() == cherche) {
        return Err(AppError::refus("doublon", Table::Themes.msg_doublon()));
    }
    Ok(())
}

pub fn theme_creer(conn: &Connection, nom: &str) -> AppResult<Classement> {
    let nom = nom_requis(nom, Table::Themes.msg_vide())?;
    verifier_nom_theme_libre(conn, &nom, None)?;
    creer(conn, Table::Themes, &nom)
}
pub fn theme_basculer(conn: &Connection, id: i64) -> AppResult<Classement> {
    basculer(conn, Table::Themes, id)
}

/// Renomme un thème (§ 16). Le nom est lu partout par jointure (dossiers, modèles, filtres) : le nouveau nom
/// s'applique aussitôt. Mêmes règles qu'à la création ; changer seulement la casse est permis.
pub fn theme_renommer(conn: &Connection, id: i64, nom: &str) -> AppResult<ThemeCompte> {
    let t = theme_compte(conn, id)?;
    let nom = nom_requis(nom, Table::Themes.msg_vide())?;
    if nom == t.nom {
        return Ok(t);
    }
    verifier_nom_theme_libre(conn, &nom, Some(id))?;
    conn.execute("UPDATE themes SET nom = ?1 WHERE id = ?2", params![nom, id])?;
    theme_compte(conn, id)
}

/// « 3 dossiers et 2 modèles de document » / « 1 dossier » / « 1 modèle de document ».
fn compte_theme(nb_dossiers: i64, nb_modeles: i64) -> String {
    let dossiers = format!("{nb_dossiers} dossier{}", if nb_dossiers > 1 { "s" } else { "" });
    let modeles = format!("{nb_modeles} modèle{} de document", if nb_modeles > 1 { "s" } else { "" });
    match (nb_dossiers > 0, nb_modeles > 0) {
        (true, true) => format!("{dossiers} et {modeles}"),
        (true, false) => dossiers,
        _ => modeles,
    }
}

/// Motif du refus de suppression d'un thème occupé (même texte que l'interface, `src/lib/categories.ts`).
pub fn motif_theme_occupe(nb_dossiers: i64, nb_modeles: i64) -> Option<String> {
    if nb_dossiers <= 0 && nb_modeles <= 0 {
        return None;
    }
    let pronom = if nb_dossiers + nb_modeles > 1 { "les" } else { "le" };
    Some(format!(
        "Cette catégorie contient encore {}. Déplacez-{pronom} ou supprimez-{pronom} avant de la supprimer.",
        compte_theme(nb_dossiers, nb_modeles)
    ))
}

/// Supprime un thème (§ 16), seulement si aucun dossier ni aucun modèle de document (actif ou archivé) n'y
/// appartient ; sinon refus `categorie_utilisee` avec les nombres. Contrôle et suppression dans la même transaction ;
/// les clés étrangères de `dossiers` et `modeles` restent le dernier garde-fou.
pub fn theme_supprimer(conn: &Connection, id: i64) -> AppResult<()> {
    let tx = conn.unchecked_transaction()?;
    let t = theme_compte(&tx, id)?;
    if let Some(motif) = motif_theme_occupe(t.nb_dossiers, t.nb_modeles) {
        return Err(AppError::refus("categorie_utilisee", motif));
    }
    tx.execute("DELETE FROM themes WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}

/// Mot-clé du Magasin (§ 17) avec le nombre de documents (dossiers ouverts et clôturés) qui l'ont choisi dans un bloc
/// « Choix du Magasin ». Un document garde le mot-clé choisi sous forme de texte (`val` du bloc `magasin`) : il est
/// compté quand cette valeur est exactement le nom du mot-clé.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MotCle {
    pub id: i64,
    pub nom: String,
    pub actif: bool,
    pub nb_documents: i64,
}

/// Blocs d'un document (JSON brut) : identifiant et blocs des documents qui ont au moins un bloc `magasin`.
fn documents_avec_magasin(conn: &Connection) -> AppResult<Vec<(i64, String)>> {
    let mut stmt =
        conn.prepare("SELECT id, blocs FROM documents WHERE blocs IS NOT NULL AND instr(blocs, 'magasin') > 0 ORDER BY id")?;
    let v = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// Valeurs choisies dans les blocs `magasin` d'un document, sans doublon. Lu en JSON brut : un document dont les
/// blocs ne se décodent pas entièrement est compté quand même ; un JSON illisible ne compte pour rien.
fn valeurs_magasin(json: &str) -> std::collections::BTreeSet<String> {
    // Même borne qu'à l'affichage : un contenu démesuré (base fabriquée) n'est pas décodé.
    if json.len() > modeles::MAX_JSON_LECTURE {
        return std::collections::BTreeSet::new();
    }
    let blocs: Vec<serde_json::Value> = serde_json::from_str(json).unwrap_or_default();
    blocs
        .iter()
        .filter(|b| b.get("t").and_then(|t| t.as_str()) == Some("magasin"))
        .filter_map(|b| b.get("val").and_then(|v| v.as_str()).map(str::to_string))
        .collect()
}

/// Remplace `ancien` par `nouveau` dans les blocs `magasin` dont la valeur est exactement `ancien` ; `None` si rien
/// ne change. Les blocs sont réécrits comme l'application les enregistre quand ils se relisent à l'identique ; sinon
/// (base ancienne ou modifiée à la main), le JSON brut est modifié pour ne rien perdre de ce qu'il contient.
fn remplacer_valeur_magasin(json: &str, ancien: &str, nouveau: &str) -> Option<String> {
    // Contenu démesuré (base fabriquée) : ni décodé ni réécrit, comme un contenu illisible.
    if json.len() > modeles::MAX_JSON_LECTURE {
        return None;
    }
    if let Ok(mut blocs) = serde_json::from_str::<Vec<modeles::Bloc>>(json)
        && serde_json::to_string(&blocs).ok().as_deref() == Some(json)
    {
        let mut change = false;
        for b in blocs.iter_mut().filter(|b| b.t == modeles::TypeBloc::Magasin && b.val.as_deref() == Some(ancien)) {
            b.val = Some(nouveau.to_string());
            change = true;
        }
        return if change { serde_json::to_string(&blocs).ok() } else { None };
    }
    let mut blocs: Vec<serde_json::Value> = serde_json::from_str(json).ok()?;
    let mut change = false;
    for b in blocs.iter_mut() {
        if b.get("t").and_then(|t| t.as_str()) == Some("magasin")
            && b.get("val").and_then(|v| v.as_str()) == Some(ancien)
            && let Some(o) = b.as_object_mut()
        {
            o.insert("val".into(), serde_json::Value::String(nouveau.to_string()));
            change = true;
        }
    }
    if change { serde_json::to_string(&blocs).ok() } else { None }
}

/// Nombre de documents qui ont choisi chaque valeur du Magasin.
fn compter_documents_magasin(conn: &Connection) -> AppResult<std::collections::HashMap<String, i64>> {
    let mut n = std::collections::HashMap::new();
    for (_, json) in documents_avec_magasin(conn)? {
        for val in valeurs_magasin(&json) {
            *n.entry(val).or_insert(0) += 1;
        }
    }
    Ok(n)
}

fn mot_cle(c: Classement, nb: &std::collections::HashMap<String, i64>) -> MotCle {
    let nb_documents = nb.get(&c.nom).copied().unwrap_or(0);
    MotCle { id: c.id, nom: c.nom, actif: c.actif, nb_documents }
}

pub fn magasin_lister(conn: &Connection) -> AppResult<Vec<MotCle>> {
    let nb = compter_documents_magasin(conn)?;
    Ok(lister(conn, Table::Magasin)?.into_iter().map(|c| mot_cle(c, &nb)).collect())
}
pub fn magasin_lire(conn: &Connection, id: i64) -> AppResult<MotCle> {
    let c = lire(conn, Table::Magasin, id)?;
    Ok(mot_cle(c, &compter_documents_magasin(conn)?))
}

/// Refuse un nom déjà porté par un autre mot-clé (même comparaison que pour les catégories, § 16).
fn verifier_nom_magasin_libre(conn: &Connection, nom: &str, sauf: Option<i64>) -> AppResult<()> {
    let cherche = nom.trim().to_lowercase();
    let mut stmt = conn.prepare("SELECT nom FROM magasin WHERE id IS NOT ?1")?;
    let noms = stmt.query_map([sauf], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    if noms.iter().any(|n| n.trim().to_lowercase() == cherche) {
        return Err(AppError::refus("doublon", Table::Magasin.msg_doublon()));
    }
    Ok(())
}

pub fn magasin_creer(conn: &Connection, nom: &str) -> AppResult<Classement> {
    let nom = nom_requis(nom, Table::Magasin.msg_vide())?;
    verifier_nom_magasin_libre(conn, &nom, None)?;
    creer(conn, Table::Magasin, &nom)
}
pub fn magasin_basculer(conn: &Connection, id: i64) -> AppResult<Classement> {
    basculer(conn, Table::Magasin, id)
}

/// Renomme un mot-clé du Magasin (§ 17), actif ou archivé. Mêmes règles qu'à la création ; changer seulement la casse
/// est permis. Correction de libellé : dans la même transaction, chaque bloc `magasin` de document dont la valeur est
/// exactement l'ancien nom reçoit le nouveau, dossiers clôturés compris, sans changer la date de modification des
/// dossiers ni les autres blocs.
pub fn magasin_renommer(conn: &Connection, id: i64, nom: &str) -> AppResult<MotCle> {
    let k = lire(conn, Table::Magasin, id)?;
    let nom = nom_requis(nom, Table::Magasin.msg_vide())?;
    if nom == k.nom {
        return magasin_lire(conn, id);
    }
    verifier_nom_magasin_libre(conn, &nom, Some(id))?;
    let tx = conn.unchecked_transaction()?;
    tx.execute("UPDATE magasin SET nom = ?1 WHERE id = ?2", params![nom, id])?;
    for (doc, json) in documents_avec_magasin(&tx)? {
        if let Some(nouveau) = remplacer_valeur_magasin(&json, &k.nom, &nom) {
            tx.execute("UPDATE documents SET blocs = ?1 WHERE id = ?2", params![nouveau, doc])?;
        }
    }
    tx.commit()?;
    magasin_lire(conn, id)
}

/// Supprime un mot-clé du Magasin (§ 17), toujours possible. Les documents qui l'avaient choisi gardent la valeur
/// écrite (aucun document n'est modifié) ; il n'est simplement plus proposé.
pub fn magasin_supprimer(conn: &Connection, id: i64) -> AppResult<()> {
    lire(conn, Table::Magasin, id)?;
    conn.execute("DELETE FROM magasin WHERE id = ?1", [id])?;
    Ok(())
}

fn ligne_categorie(r: &rusqlite::Row<'_>) -> rusqlite::Result<Categorie> {
    Ok(Categorie { id: r.get(0)?, kind: r.get(1)?, nom: r.get(2)?, actif: r.get(3)?, nb_fiches: r.get(4)? })
}

/// Colonnes d'une catégorie ; `nbFiches` compte les fiches actives et archivées (§ 9.1).
const SELECT_CATEGORIE: &str = "SELECT c.id, c.kind, c.nom, c.actif,
        (SELECT COUNT(*) FROM entites e WHERE e.categorie_id = c.id)
     FROM categories c";

pub fn categories_lister(conn: &Connection, kind: Kind) -> AppResult<Vec<Categorie>> {
    let mut stmt = conn.prepare(&format!("{SELECT_CATEGORIE} WHERE c.kind = ?1 ORDER BY c.id"))?;
    let v = stmt.query_map([kind], ligne_categorie)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

pub fn categorie_lire(conn: &Connection, id: i64) -> AppResult<Categorie> {
    conn.query_row(&format!("{SELECT_CATEGORIE} WHERE c.id = ?1"), [id], ligne_categorie)
        // « Catégorie » désigne à l'écran les thèmes des dossiers (§ 16) : ici, on nomme ce qui manque.
        .ou_introuvable("Structure ou type de machine introuvable.")
}

/// Messages « nom obligatoire » et « doublon » d'un répertoire.
fn messages_categorie(kind: Kind) -> (&'static str, &'static str) {
    match kind {
        Kind::A => ("Le nom de la structure est obligatoire.", "Cette structure existe déjà."),
        Kind::B => ("Le nom du type de machine est obligatoire.", "Ce type de machine existe déjà."),
    }
}

/// Refuse un nom déjà porté par une autre catégorie du même répertoire (sans tenir compte de la casse,
/// lettres accentuées comprises : « DÉPARTEMENT » = « département »).
fn verifier_nom_categorie_libre(conn: &Connection, kind: Kind, nom: &str, sauf: Option<i64>) -> AppResult<()> {
    let cherche = nom.trim().to_lowercase();
    let mut stmt = conn.prepare("SELECT nom FROM categories WHERE kind = ?1 AND id IS NOT ?2")?;
    let noms = stmt.query_map(params![kind, sauf], |r| r.get::<_, String>(0))?.collect::<rusqlite::Result<Vec<_>>>()?;
    if noms.iter().any(|n| n.trim().to_lowercase() == cherche) {
        return Err(AppError::refus("doublon", messages_categorie(kind).1));
    }
    Ok(())
}

pub fn categorie_creer(conn: &Connection, kind: Kind, nom: &str) -> AppResult<Categorie> {
    let nom = nom_requis(nom, messages_categorie(kind).0)?;
    verifier_nom_categorie_libre(conn, kind, &nom, None)?;
    conn.execute("INSERT INTO categories (kind, nom, actif) VALUES (?1, ?2, 1)", params![kind, nom])?;
    categorie_lire(conn, conn.last_insert_rowid())
}

pub fn categorie_basculer(conn: &Connection, id: i64) -> AppResult<Categorie> {
    categorie_lire(conn, id)?;
    conn.execute("UPDATE categories SET actif = 1 - actif WHERE id = ?1", [id])?;
    categorie_lire(conn, id)
}

/// Renomme une structure ou un type de machine (§ 9.1). Le nom est lu partout par jointure :
/// le nouveau nom s'applique aussitôt à toutes les fiches. Refus si une autre catégorie du même
/// répertoire porte déjà ce nom ; changer seulement la casse est permis.
pub fn categorie_renommer(conn: &Connection, id: i64, nom: &str) -> AppResult<Categorie> {
    let cat = categorie_lire(conn, id)?;
    let nom = nom_requis(nom, messages_categorie(cat.kind).0)?;
    if nom == cat.nom {
        return Ok(cat);
    }
    verifier_nom_categorie_libre(conn, cat.kind, &nom, Some(id))?;
    conn.execute("UPDATE categories SET nom = ?1 WHERE id = ?2", params![nom, id])?;
    categorie_lire(conn, id)
}

/// « 3 employés, dont 1 archivé » / « 1 machine ».
fn compte_fiches(kind: Kind, total: i64, archivees: i64) -> String {
    let (un, plusieurs, archive_un, archive_plusieurs) = match kind {
        Kind::A => ("employé", "employés", "archivé", "archivés"),
        Kind::B => ("machine", "machines", "archivée", "archivées"),
    };
    let mut s = format!("{total} {}", if total > 1 { plusieurs } else { un });
    if archivees > 0 {
        s.push_str(&format!(", dont {archivees} {}", if archivees > 1 { archive_plusieurs } else { archive_un }));
    }
    s
}

/// Supprime une structure ou un type de machine (§ 9.1), seulement si aucune fiche, active ou archivée,
/// n'y appartient ; sinon refus `categorie_utilisee` avec le nombre de fiches.
pub fn categorie_supprimer(conn: &Connection, id: i64) -> AppResult<()> {
    let cat = categorie_lire(conn, id)?;
    let archivees: i64 = conn.query_row(
        "SELECT COUNT(*) FROM entites WHERE categorie_id = ?1 AND actif = 0",
        [id],
        |r| r.get(0),
    )?;
    if cat.nb_fiches > 0 {
        let compte = compte_fiches(cat.kind, cat.nb_fiches, archivees);
        let pronom = match (cat.kind, cat.nb_fiches > 1) {
            (_, true) => "les",
            (Kind::A, false) => "le",
            (Kind::B, false) => "la",
        };
        return Err(AppError::refus(
            "categorie_utilisee",
            match cat.kind {
                Kind::A => format!(
                    "Cette structure contient encore {compte}. Déplacez-{pronom} dans une autre structure avant de la supprimer."
                ),
                Kind::B => format!(
                    "Ce type de machine contient encore {compte}. Déplacez-{pronom} dans un autre type de machine avant de le supprimer."
                ),
            },
        ));
    }
    // Contrôle et suppression dans la même transaction ; la clé étrangère de `entites` reste le dernier garde-fou.
    let tx = conn.unchecked_transaction()?;
    let n: i64 = tx.query_row("SELECT COUNT(*) FROM entites WHERE categorie_id = ?1", [id], |r| r.get(0))?;
    if n > 0 {
        return Err(AppError::refus(
            "categorie_utilisee",
            match cat.kind {
                Kind::A => "Cette structure contient encore des employés.",
                Kind::B => "Ce type de machine contient encore des machines.",
            },
        ));
    }
    tx.execute("DELETE FROM categories WHERE id = ?1", [id])?;
    tx.commit()?;
    Ok(())
}
