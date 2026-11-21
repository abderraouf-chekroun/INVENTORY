//! Modèles de document et blocs (§ 8.5), modèles standards (§ 8.6).

use super::entites;
use super::standards;
use super::texte::replier;
use super::{Kind, OuIntrouvable, classement, maintenant, nom_requis, pad2};
use crate::error::{AppError, AppResult, journaliser};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Deserializer, Serialize};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TypeBloc {
    Titre,
    #[default]
    Texte,
    Champ,
    Zone,
    Date,
    Case,
    Choix,
    Tableau,
    Magasin,
    Variable,
    Employe,
    Machine,
    Signature,
}

impl TypeBloc {
    /// Répertoire désigné par un bloc `employe` ou `machine`.
    pub fn kind_designe(self) -> Option<Kind> {
        match self {
            TypeBloc::Employe => Some(Kind::A),
            TypeBloc::Machine => Some(Kind::B),
            _ => None,
        }
    }

    /// Bloc de saisie : il peut être marqué « Champ obligatoire » (§ 10.6). Ni `titre`, ni `texte`, ni `variable`.
    pub fn est_saisie(self) -> bool {
        !matches!(self, TypeBloc::Titre | TypeBloc::Texte | TypeBloc::Variable)
    }
}

/// `entiteId` présent (nombre ou `null`) → `Some(…)` ; absent → `None` (par `default`).
fn option_presente<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Option<i64>>, D::Error> {
    Option::<i64>::deserialize(d).map(Some)
}

/// Bloc de modèle (structure) ou de document (structure et valeurs saisies).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Bloc {
    pub t: TypeBloc,
    #[serde(default)]
    pub v: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cols: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub multiple: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub heure: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub niveau: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub val: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rows: Option<Vec<Vec<String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub choisis: Option<Vec<String>>,
    /// Fiche choisie dans un bloc `employe` / `machine` : `Some(None)` = aucune (sérialisé `null`).
    #[serde(default, rename = "entiteId", skip_serializing_if = "Option::is_none", deserialize_with = "option_presente")]
    pub entite_id: Option<Option<i64>>,
    /// § 10.6 : bloc de saisie marqué « Champ obligatoire ». Conservé seulement s'il vaut vrai, sur un bloc de saisie.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub obligatoire: Option<bool>,
    /// § 13.2 : bloc `employe` / `machine` dont la fiche a été supprimée (`entiteId` vaut alors `null`) : copie de la
    /// fiche prise au moment de la suppression. Écrite seulement par le back ; la valeur envoyée par le front est ignorée.
    #[serde(
        default,
        rename = "ficheSupprimee",
        skip_serializing_if = "Option::is_none",
        deserialize_with = "fiche_supprimee_tolerante"
    )]
    pub fiche_supprimee: Option<FicheSupprimee>,
}

/// Une copie de fiche supprimée mal formée (envoyée par le front, ou base modifiée à la main) est ignorée, sans
/// rendre illisible le reste des blocs.
fn fiche_supprimee_tolerante<'de, D: Deserializer<'de>>(d: D) -> Result<Option<FicheSupprimee>, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.and_then(|v| serde_json::from_value(v).ok()))
}

/// § 13.2 : copie d'une fiche supprimée, conservée dans les blocs qui la désignaient (mêmes champs que
/// [`entites::Entite`], sans son identifiant numérique, qui peut être réattribué).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FicheSupprimee {
    pub kind: Kind,
    #[serde(default)]
    pub nom: String,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub libelle: String,
    #[serde(default)]
    pub categorie: String,
    #[serde(default)]
    pub prenom: String,
    #[serde(default)]
    pub date_naissance: Option<String>,
    #[serde(default)]
    pub poste: String,
    #[serde(default)]
    pub marque: String,
    #[serde(default)]
    pub cpu: String,
    #[serde(default)]
    pub ram: String,
    #[serde(default)]
    pub stockage: String,
    #[serde(default)]
    pub supprimee_le: String,
}

impl FicheSupprimee {
    pub fn de(e: &entites::Entite, supprimee_le: &str) -> Self {
        FicheSupprimee {
            kind: e.kind,
            nom: e.nom.clone(),
            code: e.code.clone(),
            libelle: e.libelle.clone(),
            categorie: e.categorie.clone(),
            prenom: e.prenom.clone(),
            date_naissance: e.date_naissance.clone(),
            poste: e.poste.clone(),
            marque: e.marque.clone(),
            cpu: e.cpu.clone(),
            ram: e.ram.clone(),
            stockage: e.stockage.clone(),
            supprimee_le: supprimee_le.to_string(),
        }
    }
}

impl Bloc {
    pub fn nouveau(t: TypeBloc, v: &str) -> Self {
        Bloc { t, v: v.to_string(), ..Default::default() }
    }

    /// Fiche désignée par un bloc `employe` / `machine` d'un document.
    pub fn fiche_designee(&self) -> Option<i64> {
        self.t.kind_designe().and(self.entite_id.flatten())
    }

    /// Marque « Champ obligatoire » retenue : seulement `true`, et seulement sur un bloc de saisie.
    fn obligatoire_retenu(&self) -> Option<bool> {
        (self.t.est_saisie() && self.obligatoire == Some(true)).then_some(true)
    }

    /// Copie de la structure seule (type, libellé et réglages, marque « obligatoire »), sans aucune valeur saisie.
    fn structure(&self) -> Self {
        let mut n = Bloc::nouveau(self.t, &self.v);
        n.obligatoire = self.obligatoire_retenu();
        match self.t {
            TypeBloc::Titre => n.niveau = self.niveau,
            TypeBloc::Date => n.heure = self.heure,
            TypeBloc::Choix => {
                n.options = self.options.clone();
                n.multiple = self.multiple;
            }
            TypeBloc::Tableau => n.cols = Some(colonnes_document(self.cols.as_ref())),
            _ => {}
        }
        n
    }
}

/// Variables automatiques (§ 8.5), dans l'ordre de la palette du Studio.
pub const VARIABLES: [&str; 12] = [
    "Employé · Nom",
    "Employé · Prénom",
    "Employé · Poste",
    "Employé · Structure",
    "Employé · Identifiant",
    "Machine · Nom",
    "Machine · Identifiant",
    "Machine · Marque et modèle",
    "Machine · Processeur",
    "Machine · RAM",
    "Machine · Stockage",
    "Date du jour",
];

/// Noms de la version 1.0, toujours reconnus, et la variable qu'ils désignent désormais.
pub const VARIABLES_ANCIENNES: [(&str, &str); 4] = [
    ("Entité A · Nom", "Employé · Nom"),
    ("Entité A · Code", "Employé · Identifiant"),
    ("Entité B · Nom", "Machine · Nom"),
    ("Entité B · Code unique", "Machine · Identifiant"),
];

/// Nom actuel d'une variable (ancien nom compris), ou `None` si elle est inconnue.
pub fn variable_canonique(nom: &str) -> Option<&'static str> {
    VARIABLES
        .iter()
        .copied()
        .find(|v| *v == nom)
        .or_else(|| VARIABLES_ANCIENNES.iter().find(|(ancien, _)| *ancien == nom).map(|(_, v)| *v))
}

/// Colonnes d'un tableau par défaut.
const NB_COLONNES: usize = 3;

/// Bornes des blocs reçus du front (modèle ou saisie d'un document).
pub const MAX_BLOCS: usize = 200;
pub const MAX_TEXTE: usize = 10_000;
pub const MAX_LIGNES: usize = 500;
pub const MAX_COLONNES: usize = 8;
pub const MIN_OPTIONS: usize = 2;
pub const MAX_OPTIONS: usize = 12;
pub const MAX_OPTION: usize = 200;
/// Taille maximale du JSON des blocs écrit en base (octets).
pub const MAX_JSON_BLOCS: usize = 2_000_000;
/// Au-delà, un JSON relu en base est traité comme illisible (marge pour les bases plus anciennes).
pub const MAX_JSON_LECTURE: usize = 4 * MAX_JSON_BLOCS;

pub const TEXTE_ILLISIBLE: &str =
    "Contenu illisible : ces données ont été endommagées et ne peuvent pas être affichées.";

/// Remplace des blocs illisibles : un seul bloc de texte qui le signale.
pub fn blocs_illisibles() -> Vec<Bloc> {
    vec![Bloc::nouveau(TypeBloc::Texte, TEXTE_ILLISIBLE)]
}

/// Décode des blocs relus en base ; `None` (et une ligne de journal) s'ils sont illisibles ou démesurés.
pub fn decoder_blocs(json: &str) -> Option<Vec<Bloc>> {
    if json.len() > MAX_JSON_LECTURE {
        journaliser("blocs", &format!("JSON de {} octets ignoré", json.len()));
        return None;
    }
    serde_json::from_str(json).map_err(|e| journaliser("blocs", &e)).ok()
}

/// Bornes appliquées à un enregistrement. Elles ne sont jamais plus strictes que le contenu déjà stocké :
/// un document ou un modèle qui dépassait une borne (données antérieures) reste modifiable tant que son
/// contenu ne grossit pas au-delà de ce qu'il était.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bornes {
    pub blocs: usize,
    pub texte: usize,
    pub lignes: usize,
    pub colonnes: usize,
    pub options: usize,
    pub json: usize,
}

impl Default for Bornes {
    fn default() -> Self {
        Bornes {
            blocs: MAX_BLOCS,
            texte: MAX_TEXTE,
            lignes: MAX_LIGNES,
            colonnes: MAX_COLONNES,
            options: MAX_OPTIONS,
            json: MAX_JSON_BLOCS,
        }
    }
}

impl Bornes {
    /// Bornes par défaut, relevées au niveau du contenu stocké (`json` : sa taille en octets).
    pub fn depuis(stockes: &[Bloc], json: usize) -> Self {
        let longueur = |s: &str| s.chars().count();
        let mut b = Bornes::default();
        b.blocs = b.blocs.max(stockes.len());
        b.json = b.json.max(json);
        for bloc in stockes {
            let textes = std::iter::once(bloc.v.as_str())
                .chain(bloc.val.as_deref())
                .chain(bloc.cols.iter().flatten().map(String::as_str))
                .chain(bloc.rows.iter().flatten().flatten().map(String::as_str));
            b.texte = textes.map(longueur).fold(b.texte, usize::max);
            b.lignes = b.lignes.max(bloc.rows.as_ref().map_or(0, Vec::len));
            b.colonnes = b.colonnes.max(bloc.cols.as_ref().map_or(0, Vec::len));
            b.options = b.options.max(bloc.options.as_ref().map_or(0, Vec::len));
        }
        b
    }

    fn texte(&self, s: &str) -> AppResult<()> {
        if s.chars().count() > self.texte {
            return Err(AppError::invalide(format!("Un texte dépasse la limite de {} caractères.", self.texte)));
        }
        Ok(())
    }

    fn nombre_blocs(&self, n: usize) -> AppResult<()> {
        if n > self.blocs {
            return Err(AppError::invalide(format!("Un modèle ne peut pas compter plus de {} blocs.", self.blocs)));
        }
        Ok(())
    }
}

/// Encode des blocs pour la base, en refusant un contenu plus volumineux que `limite` octets.
pub fn encoder_blocs(blocs: &[Bloc], limite: usize) -> AppResult<String> {
    let json = serde_json::to_string(blocs)?;
    if json.len() > limite {
        return Err(AppError::invalide("Le contenu est trop volumineux pour être enregistré."));
    }
    Ok(json)
}

/// En-têtes d'un tableau déjà stocké : ceux du modèle (3 par défaut), un en-tête vide reprend « Colonne n ».
fn colonnes_document(cols: Option<&Vec<String>>) -> Vec<String> {
    let v: Vec<String> = match cols {
        Some(c) if !c.is_empty() => c.clone(),
        _ => vec![String::new(); NB_COLONNES],
    };
    v.into_iter()
        .enumerate()
        .map(|(i, c)| {
            let c = c.trim().to_string();
            if c.is_empty() { format!("Colonne {}", i + 1) } else { c }
        })
        .collect()
}

/// En-têtes d'un tableau de modèle : 1 à 8 (3 par défaut si aucun).
fn colonnes_modele(cols: Option<&Vec<String>>, bornes: &Bornes) -> AppResult<Vec<String>> {
    if cols.is_some_and(|c| c.len() > bornes.colonnes) {
        return Err(AppError::invalide(format!("Un tableau compte de 1 à {} colonnes.", bornes.colonnes)));
    }
    let cols = colonnes_document(cols);
    cols.iter().try_for_each(|c| bornes.texte(c))?;
    Ok(cols)
}

/// Options d'un bloc `choix` : 2 à 12 textes non vides, distincts, de 200 caractères au plus.
fn options_modele(bloc: &Bloc, bornes: &Bornes) -> AppResult<Vec<String>> {
    let options: Vec<String> = bloc.options.iter().flatten().map(|o| o.trim().to_string()).collect();
    if !(MIN_OPTIONS..=bornes.options).contains(&options.len()) {
        return Err(AppError::invalide(format!(
            "La liste « {} » doit proposer de {MIN_OPTIONS} à {} options.",
            bloc.v, bornes.options
        )));
    }
    for (i, o) in options.iter().enumerate() {
        if o.is_empty() {
            return Err(AppError::invalide(format!("Une option de la liste « {} » est vide.", bloc.v)));
        }
        if o.chars().count() > MAX_OPTION {
            return Err(AppError::invalide(format!("Une option ne doit pas dépasser {MAX_OPTION} caractères.")));
        }
        if options[..i].contains(o) {
            return Err(AppError::invalide(format!("Deux options de la liste « {} » portent le même texte.", bloc.v)));
        }
    }
    Ok(options)
}

/// Valide et nettoie les blocs d'un modèle (aucune valeur saisie n'y est conservée).
pub fn normaliser_blocs_modele(blocs: &[Bloc], bornes: &Bornes) -> AppResult<Vec<Bloc>> {
    bornes.nombre_blocs(blocs.len())?;
    blocs
        .iter()
        .map(|b| {
            bornes.texte(&b.v)?;
            let mut n = Bloc::nouveau(b.t, &b.v);
            n.obligatoire = b.obligatoire_retenu();
            match b.t {
                TypeBloc::Titre => {
                    let niveau = b.niveau.unwrap_or(1);
                    if !(1..=2).contains(&niveau) {
                        return Err(AppError::invalide("Le niveau d’un titre vaut 1 (titre) ou 2 (intertitre)."));
                    }
                    n.niveau = Some(niveau);
                }
                TypeBloc::Date => n.heure = Some(b.heure.unwrap_or(false)),
                TypeBloc::Choix => {
                    n.options = Some(options_modele(b, bornes)?);
                    n.multiple = Some(b.multiple.unwrap_or(false));
                }
                TypeBloc::Tableau => n.cols = Some(colonnes_modele(b.cols.as_ref(), bornes)?),
                TypeBloc::Variable => {
                    if variable_canonique(&b.v).is_none() {
                        return Err(AppError::invalide(format!("Variable automatique inconnue : « {} ».", b.v)));
                    }
                }
                TypeBloc::Texte
                | TypeBloc::Champ
                | TypeBloc::Zone
                | TypeBloc::Case
                | TypeBloc::Magasin
                | TypeBloc::Employe
                | TypeBloc::Machine
                | TypeBloc::Signature => {}
            }
            Ok(n)
        })
        .collect()
}

/// Instantané des blocs d'un modèle pour un nouveau document, valeurs vides (blocs `employe` / `machine` compris).
pub fn instantane(blocs: &[Bloc]) -> Vec<Bloc> {
    blocs
        .iter()
        .map(|b| {
            let mut n = b.structure();
            match b.t {
                TypeBloc::Champ | TypeBloc::Zone | TypeBloc::Magasin | TypeBloc::Date => n.val = Some(String::new()),
                TypeBloc::Case | TypeBloc::Signature => n.ok = Some(false),
                TypeBloc::Choix => n.choisis = Some(Vec::new()),
                TypeBloc::Tableau => n.rows = Some(Vec::new()),
                TypeBloc::Employe | TypeBloc::Machine => n.entite_id = Some(None),
                TypeBloc::Titre | TypeBloc::Texte | TypeBloc::Variable => {}
            }
            n
        })
        .collect()
}

/// Blocs d'un document tels qu'envoyés au front : une signature d'un document antérieur à la version 1.2
/// (sans `ok`) est « non signée » (§ 9.2) ; une signature non cochée n'a jamais de date.
pub fn completer_signatures(blocs: &mut [Bloc]) {
    for b in blocs.iter_mut().filter(|b| b.t == TypeBloc::Signature) {
        let signe = b.ok.unwrap_or(false);
        b.ok = Some(signe);
        if !signe {
            b.val = None;
        }
    }
}

/// Valeur d'un bloc `signature` (§ 9.2) : `ok` vient de la saisie ; la date (`val`, horodatage
/// `AAAA-MM-JJ HH:MM:SS`) est posée ici quand la case passe à cochée, conservée tant qu'elle le reste,
/// effacée quand elle est décochée. Une date envoyée par le front est toujours ignorée.
fn valeur_signature(stocke: &Bloc, saisi: &Bloc, maintenant: &str) -> (bool, Option<String>) {
    if !saisi.ok.unwrap_or(false) {
        return (false, None);
    }
    let date = match (stocke.ok, stocke.val.as_deref()) {
        (Some(true), Some(d)) if !d.is_empty() => d.to_string(),
        _ => maintenant.to_string(),
    };
    (true, Some(date))
}

/// Valeur d'un bloc `date` : vide, `AAAA-MM-JJ`, ou `AAAA-MM-JJTHH:MM` si le bloc demande l'heure.
fn valeur_date(val: Option<&str>, heure: bool) -> AppResult<String> {
    let v = val.unwrap_or_default().trim();
    if v.is_empty() {
        return Ok(String::new());
    }
    let invalide = || AppError::invalide("Une date saisie est invalide.");
    if let Ok(d) = chrono::NaiveDate::parse_from_str(v, "%Y-%m-%d") {
        return Ok(d.format("%Y-%m-%d").to_string());
    }
    if !heure {
        return Err(invalide());
    }
    chrono::NaiveDateTime::parse_from_str(v, "%Y-%m-%dT%H:%M")
        .or_else(|_| chrono::NaiveDateTime::parse_from_str(v, "%Y-%m-%dT%H:%M:%S"))
        .map(|d| d.format("%Y-%m-%dT%H:%M").to_string())
        .map_err(|_| invalide())
}

/// Options retenues d'un bloc `choix` : parmi ses options, sans doublon, dans l'ordre des options ;
/// une seule si le choix est unique.
fn valeur_choix(stocke: &Bloc, choisis: Option<&Vec<String>>) -> AppResult<Vec<String>> {
    let options = stocke.options.as_deref().unwrap_or_default();
    let choisis = choisis.map(Vec::as_slice).unwrap_or_default();
    if let Some(inconnue) = choisis.iter().find(|c| !options.contains(c)) {
        return Err(AppError::invalide(format!("« {inconnue} » n’est pas une option de la liste « {} ».", stocke.v)));
    }
    let retenues: Vec<String> = options.iter().filter(|o| choisis.contains(o)).cloned().collect();
    if retenues.len() > 1 && !stocke.multiple.unwrap_or(false) {
        return Err(AppError::invalide(format!("Une seule option peut être choisie dans « {} ».", stocke.v)));
    }
    Ok(retenues)
}

/// Fiche choisie dans un bloc `employe` / `machine` : du bon répertoire et active
/// (la fiche déjà enregistrée reste acceptée telle quelle, même archivée depuis).
fn verifier_fiche_choisie(conn: &Connection, stocke: &Bloc, id: i64) -> AppResult<()> {
    if stocke.fiche_designee() == Some(id) {
        return Ok(());
    }
    let Some(kind) = stocke.t.kind_designe() else { return Ok(()) };
    let e = entites::lire(conn, id)?;
    if e.kind != kind {
        return Err(AppError::refus(
            "fiche_incompatible",
            format!("Le bloc « {} » doit désigner {}.", stocke.v, kind.un()),
        ));
    }
    if !e.actif {
        return Err(AppError::refus("fiche_archivee", format!("La fiche {} est archivée.", e.libelle)));
    }
    Ok(())
}

/// Reporte les valeurs saisies sur les blocs stockés du document.
/// La structure (types, libellés, réglages, colonnes) reste celle de l'instantané ; les variables ne sont jamais stockées.
pub fn fusionner_saisie(conn: &Connection, stockes: &[Bloc], saisis: &[Bloc], bornes: &Bornes) -> AppResult<Vec<Bloc>> {
    let incompatible = || {
        AppError::refus(
            "blocs_incompatibles",
            "Le contenu du document ne correspond plus à sa structure. Rechargez le document.",
        )
    };
    if stockes.len() != saisis.len() {
        return Err(incompatible());
    }
    let now = maintenant();
    stockes
        .iter()
        .zip(saisis)
        .map(|(s, e)| {
            if s.t != e.t {
                return Err(incompatible());
            }
            let mut n = s.structure();
            match s.t {
                TypeBloc::Champ | TypeBloc::Zone | TypeBloc::Magasin => {
                    let val = e.val.clone().unwrap_or_default();
                    bornes.texte(&val)?;
                    n.val = Some(val);
                }
                TypeBloc::Date => n.val = Some(valeur_date(e.val.as_deref(), s.heure.unwrap_or(false))?),
                TypeBloc::Case => n.ok = Some(e.ok.unwrap_or(false)),
                TypeBloc::Choix => n.choisis = Some(valeur_choix(s, e.choisis.as_ref())?),
                TypeBloc::Tableau => {
                    let largeur = n.cols.as_ref().map_or(NB_COLONNES, Vec::len);
                    let lignes = e.rows.as_deref().unwrap_or_default();
                    if lignes.len() > bornes.lignes {
                        return Err(AppError::invalide(format!(
                            "Un tableau ne peut pas dépasser {} lignes.",
                            bornes.lignes
                        )));
                    }
                    let mut rows = Vec::with_capacity(lignes.len());
                    for ligne in lignes {
                        let mut r: Vec<String> = ligne.iter().take(largeur).cloned().collect();
                        r.resize(largeur, String::new());
                        r.iter().try_for_each(|c| bornes.texte(c))?;
                        rows.push(r);
                    }
                    n.rows = Some(rows);
                }
                TypeBloc::Employe | TypeBloc::Machine => {
                    let id = e.entite_id.flatten();
                    if let Some(id) = id {
                        verifier_fiche_choisie(conn, s, id)?;
                    } else {
                        // § 13.2 : la copie d'une fiche supprimée vient toujours du contenu enregistré, jamais du front ;
                        // elle disparaît dès qu'une autre fiche est choisie dans le bloc.
                        n.fiche_supprimee = s.fiche_supprimee.clone();
                    }
                    n.entite_id = Some(id);
                }
                TypeBloc::Signature => {
                    let (ok, val) = valeur_signature(s, e, &now);
                    n.ok = Some(ok);
                    n.val = val;
                }
                TypeBloc::Titre | TypeBloc::Texte | TypeBloc::Variable => {}
            }
            Ok(n)
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Modele {
    pub id: i64,
    pub nom: String,
    pub theme_id: i64,
    pub theme: String,
    pub actif: bool,
    pub blocs: Vec<Bloc>,
    pub cree_le: String,
    pub maj_le: String,
    /// Vrai pour l'un des modèles standards (§ 8.6).
    pub standard: bool,
    /// § 11.4 : documents créés à partir de ce modèle (la suppression n'est possible qu'à 0).
    pub nb_documents: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaisieModele {
    pub nom: String,
    pub theme_id: i64,
    pub blocs: Vec<Bloc>,
}

const SELECT_MODELE: &str =
    "SELECT m.id, m.nom, m.theme_id, t.nom, m.actif, m.blocs, m.cree_le, m.maj_le, m.standard IS NOT NULL,
            (SELECT COUNT(*) FROM documents x WHERE x.modele_id = m.id)
     FROM modeles m JOIN themes t ON t.id = m.theme_id";

fn ligne_modele(r: &rusqlite::Row<'_>) -> rusqlite::Result<(Modele, String)> {
    Ok((
        Modele {
            id: r.get(0)?,
            nom: r.get(1)?,
            theme_id: r.get(2)?,
            theme: r.get(3)?,
            actif: r.get(4)?,
            blocs: Vec::new(),
            cree_le: r.get(6)?,
            maj_le: r.get(7)?,
            standard: r.get(8)?,
            nb_documents: r.get(9)?,
        },
        r.get(5)?,
    ))
}

/// Des blocs illisibles n'empêchent pas de lister les modèles : ils sont remplacés par [`blocs_illisibles`].
fn avec_blocs((mut m, json): (Modele, String)) -> Modele {
    m.blocs = decoder_blocs(&json).unwrap_or_else(blocs_illisibles);
    m
}

pub fn lister(conn: &Connection) -> AppResult<Vec<Modele>> {
    let mut stmt = conn.prepare(&format!("{SELECT_MODELE} ORDER BY m.id"))?;
    let lignes = stmt.query_map([], ligne_modele)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(lignes.into_iter().map(avec_blocs).collect())
}

pub fn lire(conn: &Connection, id: i64) -> AppResult<Modele> {
    let l = conn
        .query_row(&format!("{SELECT_MODELE} WHERE m.id = ?1"), [id], ligne_modele)
        .ou_introuvable("Modèle introuvable.")?;
    Ok(avec_blocs(l))
}

fn nom_libre(conn: &Connection, nom: &str) -> AppResult<bool> {
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM modeles WHERE nom = ?1", [nom], |r| r.get(0))?;
    Ok(n == 0)
}

/// « Modèle NN », premier thème actif, aucun bloc.
pub fn creer(conn: &Connection) -> AppResult<Modele> {
    let theme_id: i64 = conn
        .query_row("SELECT id FROM themes WHERE actif = 1 ORDER BY id LIMIT 1", [], |r| r.get(0))
        .optional()?
        .ok_or_else(|| {
            AppError::refus(
                "aucun_theme",
                "Aucune catégorie active : créez ou réactivez d’abord une catégorie dans les Paramètres.",
            )
        })?;
    let total: i64 = conn.query_row("SELECT COUNT(*) FROM modeles", [], |r| r.get(0))?;
    let mut n = total + 1;
    let mut nom = format!("Modèle {}", pad2(n));
    while !nom_libre(conn, &nom)? {
        n += 1;
        nom = format!("Modèle {}", pad2(n));
    }
    let now = maintenant();
    conn.execute(
        "INSERT INTO modeles (nom, theme_id, actif, blocs, cree_le, maj_le) VALUES (?1, ?2, 1, '[]', ?3, ?3)",
        params![nom, theme_id, now],
    )?;
    lire(conn, conn.last_insert_rowid())
}

/// Blocs stockés d'un modèle et taille de leur JSON ; refus si ces blocs sont illisibles
/// (on n'écrase pas, on ne duplique pas un contenu endommagé).
fn blocs_stockes(conn: &Connection, id: i64) -> AppResult<(Vec<Bloc>, usize)> {
    let json: String = conn
        .query_row("SELECT blocs FROM modeles WHERE id = ?1", [id], |r| r.get(0))
        .ou_introuvable("Modèle introuvable.")?;
    let blocs = decoder_blocs(&json).ok_or_else(|| {
        AppError::refus("donnees_illisibles", "Le contenu de ce modèle est endommagé : il ne peut pas être modifié.")
    })?;
    Ok((blocs, json.len()))
}

/// « {nom} (copie) », actif, mêmes thème et blocs. La copie d'un modèle standard n'est pas standard.
pub fn dupliquer(conn: &Connection, id: i64) -> AppResult<Modele> {
    let m = lire(conn, id)?;
    let (blocs, taille) = blocs_stockes(conn, id)?;
    let now = maintenant();
    conn.execute(
        "INSERT INTO modeles (nom, theme_id, actif, blocs, cree_le, maj_le) VALUES (?1, ?2, 1, ?3, ?4, ?4)",
        params![format!("{} (copie)", m.nom), m.theme_id, encoder_blocs(&blocs, taille.max(MAX_JSON_BLOCS))?, now],
    )?;
    lire(conn, conn.last_insert_rowid())
}

pub fn enregistrer(conn: &Connection, id: i64, saisie: &SaisieModele) -> AppResult<Modele> {
    let avant = lire(conn, id)?;
    let (stockes, taille) = blocs_stockes(conn, id)?;
    let bornes = Bornes::depuis(&stockes, taille);
    let nom = nom_requis(&saisie.nom, "Le nom du modèle est obligatoire.")?;
    let theme = classement::theme_lire(conn, saisie.theme_id)?;
    if !theme.actif && theme.id != avant.theme_id {
        return Err(AppError::refus("theme_archive", format!("La catégorie {} est archivée.", theme.nom)));
    }
    let blocs = normaliser_blocs_modele(&saisie.blocs, &bornes)?;
    conn.execute(
        "UPDATE modeles SET nom = ?1, theme_id = ?2, blocs = ?3, maj_le = ?4 WHERE id = ?5",
        params![nom, theme.id, encoder_blocs(&blocs, bornes.json)?, maintenant(), id],
    )?;
    lire(conn, id)
}

pub fn basculer(conn: &Connection, id: i64) -> AppResult<Modele> {
    lire(conn, id)?;
    conn.execute(
        "UPDATE modeles SET actif = 1 - actif, maj_le = ?1 WHERE id = ?2",
        params![maintenant(), id],
    )?;
    lire(conn, id)
}

/// Supprime définitivement un modèle (§ 11.4), actif ou archivé, standard compris. Refusé (`modele_utilise`) tant
/// qu'un document vient de ce modèle, avec leur nombre. Ne touche à aucun document.
pub fn supprimer(conn: &Connection, id: i64) -> AppResult<()> {
    let m = lire(conn, id)?;
    if m.nb_documents > 0 {
        let message = if m.nb_documents == 1 {
            "1 document a été créé à partir de ce modèle.".to_string()
        } else {
            format!("{} documents ont été créés à partir de ce modèle.", m.nb_documents)
        };
        return Err(AppError::refus(
            "modele_utilise",
            format!("{message} Archivez-le si vous ne voulez plus l’utiliser."),
        ));
    }
    conn.execute("DELETE FROM modeles WHERE id = ?1", [id])?;
    Ok(())
}

// ---------- modèles standards ----------

/// Thème des modèles standards (créé s'il n'existe pas ; un thème du même nom existant est réutilisé tel quel).
pub fn theme_standard(conn: &Connection) -> AppResult<i64> {
    let mut stmt = conn.prepare("SELECT id, nom FROM themes ORDER BY id")?;
    let themes = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let cherche = replier(standards::THEME);
    if let Some((id, _)) = themes.iter().find(|(_, nom)| replier(nom.trim()) == cherche) {
        return Ok(*id);
    }
    conn.execute("INSERT INTO themes (nom, actif) VALUES (?1, 1)", [standards::THEME])?;
    Ok(conn.last_insert_rowid())
}

/// Crée les modèles standards manquants (sans transaction) et renvoie leurs identifiants.
///
/// Un modèle standard est « présent » si un modèle ACTIF porte son nom (sans tenir compte de la casse ni des
/// accents), qu'il soit le modèle d'origine, modifié ou non, ou un modèle de l'utilisateur du même nom : il est
/// alors proposé quand on ajoute un document, et rien n'est recréé.
///
/// Sinon (modèle d'origine archivé ou renommé, ou disparu), il est recréé, actif et sous son nom, à neuf. Les modèles
/// existants gardent leur nom, leurs blocs et leur état ; seul l'ancien porteur de la clé la cède au modèle recréé
/// (il n'est plus marqué « standard » : c'est désormais un modèle de l'utilisateur).
pub fn assurer_standards(conn: &Connection) -> AppResult<Vec<i64>> {
    let existants: Vec<(String, bool)> = {
        let mut stmt = conn.prepare("SELECT nom, actif FROM modeles")?;
        stmt.query_map([], |r| Ok((replier(r.get::<_, String>(0)?.trim()), r.get::<_, bool>(1)?)))?
            .collect::<rusqlite::Result<_>>()?
    };
    let manquants: Vec<standards::Standard> = standards::definitions()
        .into_iter()
        .filter(|s| {
            let nom = replier(s.nom);
            !existants.iter().any(|(n, actif)| *actif && *n == nom)
        })
        .collect();
    if manquants.is_empty() {
        return Ok(Vec::new());
    }
    let theme_id = theme_standard(conn)?;
    let now = maintenant();
    let mut crees = Vec::new();
    for s in manquants {
        let blocs = normaliser_blocs_modele(&s.blocs, &Bornes::default())?;
        // La clé est unique : l'ancien porteur (archivé ou renommé) la cède, sans autre modification.
        conn.execute("UPDATE modeles SET standard = NULL WHERE standard = ?1", [s.cle])?;
        conn.execute(
            "INSERT INTO modeles (nom, theme_id, actif, blocs, cree_le, maj_le, standard)
             VALUES (?1, ?2, 1, ?3, ?4, ?4, ?5)",
            params![s.nom, theme_id, encoder_blocs(&blocs, MAX_JSON_BLOCS)?, now, s.cle],
        )?;
        crees.push(conn.last_insert_rowid());
    }
    Ok(crees)
}

/// « Restaurer les modèles standards » : recrée ceux qui manquent ; renvoie les modèles créés.
pub fn restaurer_standards(conn: &Connection) -> AppResult<Vec<Modele>> {
    let tx = conn.unchecked_transaction()?;
    let ids = assurer_standards(&tx)?;
    tx.commit()?;
    ids.into_iter().map(|id| lire(conn, id)).collect()
}
