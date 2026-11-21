//! Normalisation du texte : comparaison sans tenir compte de la casse ni des accents (§ 8.4, 10.4, 10.5).

/// Équivalent sans accent d'une lettre minuscule (alphabet latin), ou `None` si elle n'en a pas.
fn sans_accent(c: char) -> Option<&'static str> {
    Some(match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => "a",
        'æ' => "ae",
        'ç' | 'ć' | 'ĉ' | 'ċ' | 'č' => "c",
        'ď' | 'đ' | 'ð' => "d",
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' => "e",
        'ĝ' | 'ğ' | 'ġ' | 'ģ' => "g",
        'ĥ' | 'ħ' => "h",
        'ì' | 'í' | 'î' | 'ï' | 'ĩ' | 'ī' | 'ĭ' | 'į' | 'ı' => "i",
        'ĳ' => "ij",
        'ĵ' => "j",
        'ķ' => "k",
        'ĺ' | 'ļ' | 'ľ' | 'ŀ' | 'ł' => "l",
        'ñ' | 'ń' | 'ņ' | 'ň' | 'ŉ' => "n",
        'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ŏ' | 'ő' => "o",
        'œ' => "oe",
        'ŕ' | 'ŗ' | 'ř' => "r",
        'ś' | 'ŝ' | 'ş' | 'š' | 'ș' => "s",
        'ß' => "ss",
        'ţ' | 'ť' | 'ŧ' | 'ț' => "t",
        'þ' => "th",
        'ù' | 'ú' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'ű' | 'ų' => "u",
        'ŵ' => "w",
        'ý' | 'ÿ' | 'ŷ' => "y",
        'ź' | 'ż' | 'ž' => "z",
        _ => return None,
    })
}

/// Marque diacritique combinante (forme décomposée : « e » + accent).
fn est_diacritique(c: char) -> bool {
    matches!(c, '\u{0300}'..='\u{036F}')
}

/// Texte en minuscules et sans accents, pour comparer : « Élodie » → « elodie », « Œuvre » → « oeuvre ».
/// Les caractères non latins sont gardés tels quels (en minuscules).
pub fn replier(s: &str) -> String {
    let mut r = String::with_capacity(s.len());
    for c in s.chars().flat_map(char::to_lowercase) {
        if est_diacritique(c) {
            continue;
        }
        match sans_accent(c) {
            Some(t) => r.push_str(t),
            None => r.push(c),
        }
    }
    r
}

/// Vrai si `aiguille` (déjà repliée) apparaît dans `botte` (déjà repliée) au début d'un mot.
pub fn commence_un_mot(botte: &str, aiguille: &str) -> bool {
    if aiguille.is_empty() {
        return false;
    }
    botte.match_indices(aiguille).any(|(i, _)| {
        botte[..i].chars().next_back().is_none_or(|p| !p.is_alphanumeric())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repli_casse_et_accents() {
        assert_eq!(replier("Élodie FRANÇOIS"), "elodie francois");
        assert_eq!(replier("Œuvre Æsir Straße"), "oeuvre aesir strasse");
        assert_eq!(replier("Leïla Mansouri"), "leila mansouri");
        // Forme décomposée : e + accent aigu combinant.
        assert_eq!(replier("Ele\u{0301}onore"), "eleonore");
        // Non latin : gardé.
        assert_eq!(replier("علي"), "علي");
    }

    #[test]
    fn debut_de_mot() {
        assert!(commence_un_mot("benali sofia", "so"));
        assert!(commence_un_mot("benali sofia", "ben"));
        assert!(commence_un_mot("ould-ali nadia", "ali"));
        assert!(!commence_un_mot("benali sofia", "ali"));
        assert!(!commence_un_mot("benali", ""));
    }
}
