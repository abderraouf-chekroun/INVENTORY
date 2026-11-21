//! Nominations (§ 11.1, 11.2) : fiches nommées dans un document, enregistrées dans la table `nominations` avec le
//! champ et le moment où elles sont apparues. Elles remplacent les citations calculées à la lecture de la 1.3.
//!
//! Une fiche est nommée dans un document quand :
//! - un bloc `employe` ou `machine` du document la désigne (`bloc`), le bloc et la fiche étant du même répertoire ;
//! - son nom est écrit dans une valeur saisie — champ, zone, cellule de tableau (`texte`) :
//!   - employé : le nom et le prénom ensemble, dans un ordre ou l'autre, en mots entiers, séparés seulement par des
//!     espaces, traits d'union ou apostrophes (« Benali ; Sofia » ou « benali.sofia@… » ne comptent pas) ;
//!     un employé sans prénom n'est pas cherché ainsi ;
//!   - machine : son identifiant en mot entier (ni lettre ni chiffre collé, ni un autre identifiant qui le prolonge,
//!     comme `PC-0412-B` pour `PC-0412`) ; un identifiant de moins de 3 lettres ou chiffres n'est pas cherché ainsi
//!     (« 12 » se confondrait avec une quantité).
//!
//! La comparaison ignore la casse et les accents. `champ` est le libellé du bloc (de la colonne pour une cellule de
//! tableau). La table est tenue à jour à chaque création et enregistrement d'un document ([`mettre_a_jour_document`]),
//! et pour toute fiche créée, renommée ou dont l'identifiant change ([`mettre_a_jour_fiche`]) ; les nominations
//! d'un document supprimé partent avec lui (`ON DELETE CASCADE`).
//!
//! Coût : l'enregistrement d'un document lit les fiches une fois et cherche les noms par un index (premier mot d'un
//! employé, premier morceau de l'identifiant d'une machine) : il ne dépend presque pas du nombre de fiches.

use super::documents::{COLONNES_DOCUMENT, DocumentLie, NB_COLONNES_DOCUMENT, ligne};
use super::dossiers::{self, DossierResume};
use super::entites::{Entite, SELECT_ENTITE, ligne_entite};
use super::journal::{self, Evenement};
use super::modeles::{MAX_JSON_LECTURE, TypeBloc};
use super::texte::replier;
use super::Kind;
use crate::error::AppResult;
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::Path;

/// Façon dont une fiche est nommée dans un document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Facon {
    Bloc,
    Texte,
}

impl Facon {
    fn as_str(self) -> &'static str {
        match self {
            Facon::Bloc => "bloc",
            Facon::Texte => "texte",
        }
    }
}

impl ToSql for Facon {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        Ok(ToSqlOutput::from(self.as_str()))
    }
}

impl FromSql for Facon {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "bloc" => Ok(Facon::Bloc),
            "texte" => Ok(Facon::Texte),
            _ => Err(FromSqlError::InvalidType),
        }
    }
}

/// Une nomination, sans sa date.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct Nomination {
    pub entite_id: i64,
    pub facon: Facon,
    pub champ: String,
}

// ---------- recherche d'un nom dans le texte ----------

/// Ce qui est cherché dans les valeurs saisies pour une fiche.
#[derive(Debug, Clone)]
enum Recherche {
    /// Employé : mots du nom puis du prénom, et l'inverse.
    Employe { nom_prenom: Vec<String>, prenom_nom: Vec<String> },
    /// Machine : identifiant replié.
    Machine(String),
    /// Rien à chercher dans le texte.
    Aucune,
}

/// Mots repliés d'un texte (casse et accents ignorés), séparés par tout ce qui n'est ni lettre ni chiffre.
fn mots(s: &str) -> Vec<String> {
    mots_lies(s).into_iter().map(|(m, _)| m).collect()
}

/// Séparateur faible : deux mots qu'il sépare peuvent appartenir au même nom (« Ould Ali », « Jean-Pierre »,
/// « N’Diaye »). Tout autre séparateur (virgule, point, point-virgule, retour à la ligne…) coupe un nom.
fn separateur_faible(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\u{a0}' | '\u{202f}' | '-' | '\'' | '’')
}

/// Mots repliés d'un texte, chacun avec `lié` : vrai s'il suit le mot précédent avec seulement des séparateurs
/// faibles entre eux.
fn mots_lies(s: &str) -> Vec<(String, bool)> {
    let mut v: Vec<(String, bool)> = Vec::new();
    let mut courant = String::new();
    let mut coupe = false;
    for c in replier(s).chars() {
        if c.is_alphanumeric() {
            courant.push(c);
            continue;
        }
        if !courant.is_empty() {
            let lie = !v.is_empty() && !coupe;
            v.push((std::mem::take(&mut courant), lie));
            coupe = false;
        }
        if !separateur_faible(c) {
            coupe = true;
        }
    }
    if !courant.is_empty() {
        let lie = !v.is_empty() && !coupe;
        v.push((courant, lie));
    }
    v
}

/// Longueur minimale (lettres et chiffres) d'un identifiant de machine cherché dans le texte.
const MIN_IDENTIFIANT: usize = 3;

fn recherche(kind: Kind, nom: &str, prenom: &str, code: Option<&str>) -> Recherche {
    match kind {
        Kind::A => {
            let (nom, prenom) = (mots(nom), mots(prenom));
            if nom.is_empty() || prenom.is_empty() {
                return Recherche::Aucune;
            }
            Recherche::Employe {
                nom_prenom: nom.iter().chain(&prenom).cloned().collect(),
                prenom_nom: prenom.iter().chain(&nom).cloned().collect(),
            }
        }
        Kind::B => match code.map(|c| replier(c.trim())) {
            Some(c) if c.chars().filter(|x| x.is_alphanumeric()).count() >= MIN_IDENTIFIANT => Recherche::Machine(c),
            _ => Recherche::Aucune,
        },
    }
}

/// Vrai si les deux fiches sont cherchées de la même façon dans le texte (recalcul inutile après une modification).
pub(crate) fn meme_recherche(x: &Entite, y: &Entite) -> bool {
    let cle = |e: &Entite| match recherche(e.kind, &e.nom, &e.prenom, e.code.as_deref()) {
        Recherche::Employe { nom_prenom, .. } => Some((nom_prenom, String::new())),
        Recherche::Machine(c) => Some((Vec::new(), c)),
        Recherche::Aucune => None,
    };
    x.kind == y.kind && cle(x) == cle(y)
}

/// Ponctuation qui lie deux morceaux d'un même identifiant (`PC-0412-B`, `SN/12`, `lab.01`).
const LIANTS: [char; 7] = ['-', '_', '.', '/', '\\', '#', '+'];

/// Vrai si le caractère `voisin` (juste avant ou juste après une occurrence) ferme bien un mot entier ;
/// `au_dela` est le caractère suivant dans la même direction.
fn frontiere(voisin: Option<char>, au_dela: Option<char>) -> bool {
    match voisin {
        None => true,
        Some(c) if c.is_alphanumeric() => false,
        Some(c) if LIANTS.contains(&c) => !au_dela.is_some_and(char::is_alphanumeric),
        Some(_) => true,
    }
}

/// Vrai si `identifiant` (replié) apparaît en mot entier dans `texte` (replié).
fn identifiant_present(texte: &str, identifiant: &str) -> bool {
    texte.match_indices(identifiant).any(|(i, m)| {
        let mut avant = texte[..i].chars().rev();
        let mut apres = texte[i + m.len()..].chars();
        let (a1, a2) = (avant.next(), avant.next());
        let (p1, p2) = (apres.next(), apres.next());
        frontiere(a1, a2) && frontiere(p1, p2)
    })
}

/// Vrai si `suite` apparaît dans `mots` à partir de la position `i`, en mots liés entre eux (sans séparateur fort).
fn suite_en(mots: &[(String, bool)], i: usize, suite: &[String]) -> bool {
    !suite.is_empty()
        && mots.len() >= i + suite.len()
        && suite.iter().enumerate().all(|(j, s)| mots[i + j].0 == *s && (j == 0 || mots[i + j].1))
}

/// Premier morceau (suite de lettres et chiffres) d'un identifiant replié, s'il commence par une lettre ou un chiffre.
fn premier_morceau(identifiant: &str) -> Option<&str> {
    let fin = identifiant.find(|c: char| !c.is_alphanumeric()).unwrap_or(identifiant.len());
    (fin > 0).then(|| &identifiant[..fin])
}

/// Index des fiches cherchées : répertoire de chaque fiche connue (blocs `employe` / `machine`) et noms à chercher
/// dans le texte.
///
/// Une occurrence d'identifiant en mot entier commence au début d'un morceau du texte et ce morceau est exactement le
/// premier morceau de l'identifiant : seules les machines indexées sous un morceau présent dans le texte sont
/// vérifiées. De même, un employé n'est vérifié qu'à partir d'un mot égal au premier mot cherché.
#[derive(Debug, Default)]
pub(crate) struct Index {
    kinds: HashMap<i64, Kind>,
    employes: HashMap<String, Vec<(i64, Vec<String>)>>,
    machines: HashMap<String, Vec<(i64, String)>>,
    machines_sans_morceau: Vec<(i64, String)>,
}

impl Index {
    fn ajouter(&mut self, id: i64, kind: Kind, nom: &str, prenom: &str, code: Option<&str>) {
        self.kinds.insert(id, kind);
        match recherche(kind, nom, prenom, code) {
            Recherche::Employe { nom_prenom, prenom_nom } => {
                let inverse = (prenom_nom != nom_prenom).then_some(prenom_nom);
                for suite in std::iter::once(nom_prenom).chain(inverse) {
                    self.employes.entry(suite[0].clone()).or_default().push((id, suite));
                }
            }
            Recherche::Machine(c) => match premier_morceau(&c) {
                Some(m) => self.machines.entry(m.to_string()).or_default().push((id, c)),
                None => self.machines_sans_morceau.push((id, c)),
            },
            Recherche::Aucune => {}
        }
    }

    /// Toutes les fiches de la base, archivées comprises.
    pub(crate) fn complet(conn: &Connection) -> AppResult<Self> {
        let mut index = Index::default();
        let mut stmt = conn.prepare("SELECT id, kind, nom, prenom, code FROM entites")?;
        let mut lignes = stmt.query([])?;
        while let Some(l) = lignes.next()? {
            let code: Option<String> = l.get(4)?;
            index.ajouter(l.get(0)?, l.get(1)?, &l.get::<_, String>(2)?, &l.get::<_, String>(3)?, code.as_deref());
        }
        Ok(index)
    }

    /// Une seule fiche.
    pub(crate) fn de(e: &Entite) -> Self {
        let mut index = Index::default();
        index.ajouter(e.id, e.kind, &e.nom, &e.prenom, e.code.as_deref());
        index
    }

    fn cherche_dans_le_texte(&self) -> bool {
        !self.employes.is_empty() || !self.machines.is_empty() || !self.machines_sans_morceau.is_empty()
    }

    /// Ajoute à `trouvees` les fiches dont le nom est écrit dans `texte`.
    fn trouver(&self, texte: &str, trouvees: &mut BTreeSet<i64>) {
        if texte.trim().is_empty() {
            return;
        }
        if !self.employes.is_empty() {
            let m = mots_lies(texte);
            for (i, (mot, _)) in m.iter().enumerate() {
                for (id, suite) in self.employes.get(mot).into_iter().flatten() {
                    if suite_en(&m, i, suite) {
                        trouvees.insert(*id);
                    }
                }
            }
        }
        if self.machines.is_empty() && self.machines_sans_morceau.is_empty() {
            return;
        }
        let t = replier(texte);
        let morceaux: HashSet<&str> = t.split(|c: char| !c.is_alphanumeric()).filter(|s| !s.is_empty()).collect();
        let candidates = morceaux
            .into_iter()
            .filter_map(|m| self.machines.get(m))
            .flatten()
            .chain(&self.machines_sans_morceau);
        for (id, identifiant) in candidates {
            if !trouvees.contains(id) && identifiant_present(&t, identifiant) {
                trouvees.insert(*id);
            }
        }
    }
}

// ---------- nominations d'un document ----------

/// Bloc lu pour les nominations : seulement le type, le libellé, les colonnes, les valeurs saisies et la fiche
/// désignée (le reste n'est pas décodé).
#[derive(Deserialize)]
struct BlocLu<'a> {
    #[serde(borrow, default)]
    t: Cow<'a, str>,
    #[serde(borrow, default)]
    v: Cow<'a, str>,
    #[serde(borrow, default)]
    val: Option<Cow<'a, str>>,
    #[serde(default)]
    cols: Option<Vec<String>>,
    #[serde(default)]
    rows: Option<Vec<Vec<String>>>,
    #[serde(default, rename = "entiteId")]
    entite_id: Option<i64>,
}

/// Libellé d'une colonne de tableau, « Colonne n » s'il manque.
fn libelle_colonne(cols: Option<&Vec<String>>, i: usize) -> String {
    match cols.and_then(|c| c.get(i)).map(|c| c.trim()) {
        Some(c) if !c.is_empty() => c.to_string(),
        _ => format!("Colonne {}", i + 1),
    }
}

/// Nominations d'un document d'après ses blocs (JSON stocké). Des blocs illisibles ou démesurés ne nomment personne.
/// `blocs_designes` : faux pour ne chercher que dans le texte.
pub(crate) fn dans_le_document(json: &str, index: &Index, blocs_designes: bool) -> BTreeSet<Nomination> {
    let mut v = BTreeSet::new();
    if json.len() > MAX_JSON_LECTURE {
        return v;
    }
    let texte = index.cherche_dans_le_texte();
    // Ni texte à chercher, ni bloc qui désigne une fiche : inutile de décoder.
    if !texte && !(blocs_designes && json.contains("entiteId")) {
        return v;
    }
    let Ok(blocs) = serde_json::from_str::<Vec<BlocLu<'_>>>(json) else { return v };
    let mut ajouter = |trouvees: BTreeSet<i64>, champ: String| {
        for entite_id in trouvees {
            v.insert(Nomination { entite_id, facon: Facon::Texte, champ: champ.clone() });
        }
    };
    let mut designes = Vec::new();
    for b in &blocs {
        match b.t.as_ref() {
            "employe" | "machine" if blocs_designes => {
                let kind = if b.t == "employe" { Kind::A } else { Kind::B };
                if let Some(id) = b.entite_id
                    && index.kinds.get(&id) == Some(&kind)
                {
                    designes.push(Nomination { entite_id: id, facon: Facon::Bloc, champ: b.v.trim().to_string() });
                }
            }
            "champ" | "zone" if texte => {
                if let Some(val) = &b.val {
                    let mut trouvees = BTreeSet::new();
                    index.trouver(val, &mut trouvees);
                    ajouter(trouvees, b.v.trim().to_string());
                }
            }
            "tableau" if texte => {
                let mut par_colonne: BTreeMap<usize, BTreeSet<i64>> = BTreeMap::new();
                for ligne in b.rows.iter().flatten() {
                    for (i, cellule) in ligne.iter().enumerate() {
                        index.trouver(cellule, par_colonne.entry(i).or_default());
                    }
                }
                for (i, trouvees) in par_colonne {
                    ajouter(trouvees, libelle_colonne(b.cols.as_ref(), i));
                }
            }
            _ => {}
        }
    }
    v.extend(designes);
    v
}

fn lire_nominations(conn: &Connection, document_id: i64) -> AppResult<BTreeSet<Nomination>> {
    let mut stmt = conn.prepare("SELECT entite_id, facon, champ FROM nominations WHERE document_id = ?1")?;
    let v = stmt
        .query_map([document_id], |r| Ok(Nomination { entite_id: r.get(0)?, facon: r.get(1)?, champ: r.get(2)? }))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(v)
}

fn inserer(conn: &Connection, document_id: i64, n: &Nomination, depuis: &str) -> AppResult<()> {
    conn.execute(
        "INSERT OR IGNORE INTO nominations (document_id, entite_id, facon, champ, depuis) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![document_id, n.entite_id, n.facon, n.champ, depuis],
    )?;
    Ok(())
}

fn retirer(conn: &Connection, document_id: i64, n: &Nomination) -> AppResult<()> {
    conn.execute(
        "DELETE FROM nominations WHERE document_id = ?1 AND entite_id = ?2 AND facon = ?3 AND champ = ?4",
        params![document_id, n.entite_id, n.facon, n.champ],
    )?;
    Ok(())
}

/// Tient à jour les nominations d'un document d'après ses blocs (JSON stocké) : celles qui apparaissent sont ajoutées
/// avec la date `maintenant`, celles qui disparaissent sont retirées, les autres gardent leur date. Sans transaction.
pub(crate) fn mettre_a_jour_document(
    conn: &Connection,
    document_id: i64,
    json: &str,
    index: &Index,
    maintenant: &str,
) -> AppResult<()> {
    let nouvelles = dans_le_document(json, index, true);
    let anciennes = lire_nominations(conn, document_id)?;
    for n in anciennes.difference(&nouvelles) {
        retirer(conn, document_id, n)?;
    }
    for n in nouvelles.difference(&anciennes) {
        inserer(conn, document_id, n, maintenant)?;
    }
    Ok(())
}

/// Recalcule les nominations par le texte d'une fiche (créée, renommée, ou dont l'identifiant a changé) sur tous les
/// documents : les nouvelles sont datées `maintenant`, celles qui persistent gardent leur date. Sans transaction.
pub(crate) fn mettre_a_jour_fiche(conn: &Connection, e: &Entite, maintenant: &str) -> AppResult<()> {
    let index = Index::de(e);
    let mut nouvelles: BTreeSet<(i64, String)> = BTreeSet::new();
    if index.cherche_dans_le_texte() {
        let mut stmt = conn.prepare("SELECT id, blocs FROM documents WHERE blocs IS NOT NULL")?;
        let mut lignes = stmt.query([])?;
        while let Some(l) = lignes.next()? {
            // Lecture sans copie du JSON stocké.
            let Ok(json) = l.get_ref(1)?.as_str() else { continue };
            let document_id: i64 = l.get(0)?;
            nouvelles.extend(dans_le_document(json, &index, false).into_iter().map(|n| (document_id, n.champ)));
        }
    }
    let anciennes: BTreeSet<(i64, String)> = {
        let mut stmt = conn.prepare("SELECT document_id, champ FROM nominations WHERE entite_id = ?1 AND facon = 'texte'")?;
        stmt.query_map([e.id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<rusqlite::Result<_>>()?
    };
    let nomination = |champ: &str| Nomination { entite_id: e.id, facon: Facon::Texte, champ: champ.to_string() };
    for (document_id, champ) in anciennes.difference(&nouvelles) {
        retirer(conn, *document_id, &nomination(champ))?;
    }
    for (document_id, champ) in nouvelles.difference(&anciennes) {
        inserer(conn, *document_id, &nomination(champ), maintenant)?;
    }
    Ok(())
}

/// Remplit les nominations de tous les documents, datées de la création de chaque document (migration 005, données
/// d'exemple). Les nominations déjà présentes sont conservées. Sans transaction.
pub(crate) fn remplir_tout(conn: &Connection) -> AppResult<()> {
    let index = Index::complet(conn)?;
    let mut stmt = conn.prepare("SELECT id, blocs, cree_le FROM documents WHERE blocs IS NOT NULL ORDER BY id")?;
    let mut lignes = stmt.query([])?;
    while let Some(l) = lignes.next()? {
        let Ok(json) = l.get_ref(1)?.as_str() else { continue };
        let nominations = dans_le_document(json, &index, true);
        let (document_id, cree_le): (i64, String) = (l.get(0)?, l.get(2)?);
        for n in &nominations {
            inserer(conn, document_id, n, &cree_le)?;
        }
    }
    Ok(())
}

// ---------- lecture : profil, dossier, historique ----------

/// Documents où la fiche est nommée (§ 11.2), du plus récent (date du document) au plus ancien, avec les façons, les
/// champs et la date de la plus ancienne nomination. Les blocs ne sont pas renvoyés (`blocs` vaut `None`).
pub fn documents(conn: &Connection, fichiers: &Path, e: &Entite) -> AppResult<Vec<DocumentLie>> {
    struct Releve {
        facons: BTreeSet<Facon>,
        champs: Vec<String>,
        depuis: String,
    }
    let mut releves: HashMap<i64, Releve> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT document_id, facon, champ, depuis FROM nominations WHERE entite_id = ?1 ORDER BY depuis, champ, facon",
        )?;
        let mut lignes = stmt.query([e.id])?;
        while let Some(l) = lignes.next()? {
            let (document_id, facon, champ, depuis): (i64, Facon, String, String) =
                (l.get(0)?, l.get(1)?, l.get(2)?, l.get(3)?);
            let r = releves.entry(document_id).or_insert_with(|| Releve {
                facons: BTreeSet::new(),
                champs: Vec::new(),
                depuis,
            });
            r.facons.insert(facon);
            if !r.champs.contains(&champ) {
                r.champs.push(champ);
            }
        }
    }
    if releves.is_empty() {
        return Ok(Vec::new());
    }
    let colonnes = COLONNES_DOCUMENT.replacen("x.blocs", "NULL", 1);
    let mut stmt = conn.prepare(&format!(
        "SELECT {colonnes}, d.nom FROM documents x JOIN dossiers d ON d.id = x.dossier_id
         WHERE x.id IN (SELECT document_id FROM nominations WHERE entite_id = ?1)
         ORDER BY x.date_doc DESC, x.id DESC"
    ))?;
    let v = stmt
        .query_map([e.id], |r| {
            let document = ligne(r, fichiers)?;
            let releve = releves.remove(&document.id);
            let (facons, champs, depuis) = match releve {
                Some(r) => (r.facons.into_iter().collect(), r.champs, r.depuis),
                None => (Vec::new(), Vec::new(), String::new()),
            };
            Ok(DocumentLie {
                modele_nom: document.source.clone(),
                dossier_nom: r.get(NB_COLONNES_DOCUMENT)?,
                facons,
                champs,
                depuis,
                document,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// Sous-requête des dossiers qui contiennent un document où la fiche `?1` est nommée.
pub(crate) const DOSSIERS_DE_LA_FICHE: &str =
    "SELECT x.dossier_id FROM documents x JOIN nominations n ON n.document_id = x.id WHERE n.entite_id = ?1";

/// Dossiers liés à une fiche (§ 11.2) : ceux qui contiennent un document où elle est nommée.
pub fn dossiers_lies(conn: &Connection, e: &Entite) -> AppResult<Vec<DossierResume>> {
    dossiers::lister_ou(conn, &format!("WHERE d.id IN ({DOSSIERS_DE_LA_FICHE})"), [e.id])
}

/// Fiches nommées dans au moins un document du dossier, archivées comprises : employés puis machines, par libellé.
pub fn fiches_du_dossier(conn: &Connection, dossier_id: i64) -> AppResult<Vec<Entite>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT_ENTITE} WHERE e.id IN (
             SELECT n.entite_id FROM nominations n JOIN documents x ON x.id = n.document_id WHERE x.dossier_id = ?1)
         ORDER BY e.kind, e.libelle COLLATE NOCASE, e.id"
    ))?;
    let v = stmt.query_map([dossier_id], ligne_entite)?.collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// « Champ « Utilisateur » ».
fn detail_champ(champ: &str) -> String {
    if champ.is_empty() { "Champ sans libellé".to_string() } else { format!("Champ « {champ} »") }
}

/// Événements `nomination` d'une fiche (§ 11.2) : un par document et par champ, à la date où la nomination est
/// apparue. Jamais écrits au journal : leur `id` est négatif, pour rester distinct des événements enregistrés.
pub fn evenements(conn: &Connection, e: &Entite) -> AppResult<Vec<Evenement>> {
    let mut stmt = conn.prepare(
        "SELECT MIN(n.rowid), n.document_id, n.champ, MIN(n.depuis), x.nom, x.source, x.dossier_id, d.nom
         FROM nominations n JOIN documents x ON x.id = n.document_id JOIN dossiers d ON d.id = x.dossier_id
         WHERE n.entite_id = ?1
         GROUP BY n.document_id, n.champ",
    )?;
    let libelle = Some(e.libelle.clone());
    let v = stmt
        .query_map([e.id], |r| {
            let champ: String = r.get(2)?;
            let document_nom: String = r.get(4)?;
            let modele: String = r.get(5)?;
            Ok(Evenement {
                // Négation saturée : un rowid extrême (base fabriquée) ne doit pas arrêter l'application.
                id: r.get::<_, i64>(0)?.saturating_neg(),
                r#type: journal::NOMINATION.to_string(),
                classe: journal::classe(journal::NOMINATION).to_string(),
                titre: format!("Nommé dans {modele} : {document_nom}"),
                detail: detail_champ(&champ),
                date: r.get(3)?,
                a_id: (e.kind == Kind::A).then_some(e.id),
                b_id: (e.kind == Kind::B).then_some(e.id),
                dossier_id: Some(r.get(6)?),
                a_libelle: if e.kind == Kind::A { libelle.clone() } else { None },
                b_libelle: if e.kind == Kind::B { libelle.clone() } else { None },
                dossier_nom: Some(r.get(7)?),
                document_id: Some(r.get(1)?),
                document_nom: Some(document_nom),
                champ: Some(champ),
                a_supprime: false,
                b_supprime: false,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(v)
}

/// Journal enregistré et nominations, fusionnés du plus récent au plus ancien.
pub fn fusionner(mut enregistres: Vec<Evenement>, nominations: Vec<Evenement>) -> Vec<Evenement> {
    enregistres.extend(nominations);
    enregistres.sort_by(|x, y| y.date.cmp(&x.date).then(y.id.cmp(&x.id)));
    enregistres
}

/// Type de bloc qui désigne une fiche de ce répertoire.
pub(crate) fn type_designant(kind: Kind) -> TypeBloc {
    match kind {
        Kind::A => TypeBloc::Employe,
        Kind::B => TypeBloc::Machine,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn index(kind: Kind, nom: &str, prenom: &str, code: Option<&str>) -> Index {
        let mut i = Index::default();
        i.ajouter(1, kind, nom, prenom, code);
        i
    }

    fn trouve(i: &Index, texte: &str) -> bool {
        let mut t = BTreeSet::new();
        i.trouver(texte, &mut t);
        t.contains(&1)
    }

    fn employe(nom: &str, prenom: &str) -> Index {
        index(Kind::A, nom, prenom, None)
    }

    fn machine(code: &str) -> Index {
        index(Kind::B, "", "", Some(code))
    }

    #[test]
    fn nom_et_prenom_ensemble() {
        let r = employe("Benali", "Sofia");
        for oui in ["Benali Sofia", "Sofia Benali", "Mme BÉNALI Sofia, technicienne", "sofia-benali", "Demande de\nSofia\tbenali."] {
            assert!(trouve(&r, oui), "{oui}");
        }
        for non in [
            "Benali",
            "Sofia",
            "Benali Sofiane",
            "Benalis Sofia",
            "Sofia Ben Ali",
            "Benali, ingénieure, et Sofia",
            "Karim Benali ; Sofia Haddad",
            "Haddad Benali, Sofia Haddad",
            "benali.sofia@exemple.org",
            "Responsable : Benali\nSofia Haddad",
            "",
        ] {
            assert!(!trouve(&r, non), "{non}");
        }
        let r = employe("N’Diaye", "Aïcha");
        assert!(trouve(&r, "Mme N'DIAYE Aicha"));
        assert!(trouve(&r, "aïcha n’diaye"));
        let r = employe("Ould Ali", "Nadia");
        assert!(trouve(&r, "Nadia OULD ALI"));
        assert!(trouve(&r, "ould-ali nadia"));
        assert!(!trouve(&r, "Nadia Ali"));
        // Sans prénom : jamais cherché dans le texte.
        assert!(!trouve(&employe("Benali", ""), "Benali"));
        assert!(!employe("Benali", " - ").cherche_dans_le_texte());
        // Nom et prénom identiques : une seule suite indexée.
        assert!(trouve(&employe("Ali", "Ali"), "M. Ali Ali"));
    }

    #[test]
    fn identifiant_de_machine_en_mot_entier() {
        let r = machine("PC-0412");
        for oui in ["PC-0412", "pc-0412", "Poste PC-0412.", "(PC-0412)", "PC-0412, PC-0500", "« PC-0412 »", "PC-0412-"] {
            assert!(trouve(&r, oui), "{oui}");
        }
        for non in ["PC-04120", "XPC-0412", "PC-0412-B", "A-PC-0412", "PC-0412.5", "PC-041", "PC 0412", "PC-0412/PC-0500"] {
            assert!(!trouve(&r, non), "{non}");
        }
        // Un identifiant contenu dans un autre.
        let court = machine("PC-04");
        assert!(!trouve(&court, "PC-0412"));
        assert!(trouve(&court, "PC-04 et PC-0412"));
        // Accents et casse.
        assert!(trouve(&machine("Été-01"), "ete-01"));
        // Identifiant qui commence par une ponctuation : cherché sans index.
        assert!(trouve(&machine("#PC12"), "voir #pc12."));
        assert!(!trouve(&machine("#PC12"), "voir #pc123"));
        // Trop court pour être cherché.
        assert!(!machine("12").cherche_dans_le_texte());
        assert!(!machine("A-1").cherche_dans_le_texte());
        assert!(machine("PC1").cherche_dans_le_texte());
    }

    #[test]
    fn index_de_plusieurs_fiches() {
        let mut i = Index::default();
        i.ajouter(1, Kind::A, "Benali", "Sofia", None);
        i.ajouter(2, Kind::A, "Haddad", "Karim", None);
        i.ajouter(3, Kind::B, "PC", "", Some("PC-0412"));
        i.ajouter(4, Kind::B, "PC", "", Some("PC-04"));
        let mut t = BTreeSet::new();
        i.trouver("Karim Haddad et Sofia Benali sur PC-0412 (pas PC-04120)", &mut t);
        assert_eq!(t.into_iter().collect::<Vec<_>>(), [1, 2, 3]);
    }

    #[test]
    fn nominations_d_un_document() {
        let mut i = Index::default();
        i.ajouter(1, Kind::A, "Benali", "Sofia", None);
        i.ajouter(2, Kind::B, "PC", "", Some("PC-0412"));
        let json = r#"[
            {"t":"employe","v":"Utilisateur","entiteId":1},
            {"t":"machine","v":"Matériel","entiteId":1},
            {"t":"employe","v":"Autre","entiteId":99},
            {"t":"champ","v":"Demandeur","val":"Sofia Benali"},
            {"t":"zone","v":"Notes","val":"Poste PC-0412, Sofia Benali"},
            {"t":"tableau","cols":["N°","Désignation"],"rows":[["1","PC-0412"],["Sofia Benali","x"]]},
            {"t":"texte","v":"Sofia Benali"}
        ]"#;
        let n = |id, facon, champ: &str| Nomination { entite_id: id, facon, champ: champ.into() };
        let attendu: BTreeSet<_> = [
            n(1, Facon::Bloc, "Utilisateur"),
            n(1, Facon::Texte, "Demandeur"),
            n(1, Facon::Texte, "Notes"),
            n(2, Facon::Texte, "Notes"),
            n(2, Facon::Texte, "Désignation"),
            n(1, Facon::Texte, "N°"),
        ]
        .into();
        assert_eq!(dans_le_document(json, &i, true), attendu);
        // Texte seulement.
        assert!(dans_le_document(json, &i, false).iter().all(|n| n.facon == Facon::Texte));
        // Illisible : personne.
        assert!(dans_le_document("[{\"t\":", &i, true).is_empty());
    }
}
