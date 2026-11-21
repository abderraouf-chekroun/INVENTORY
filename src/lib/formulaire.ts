/*
 * Champs obligatoires (spécification § 10.6) : un formulaire incomplet n'est pas envoyé et désigne le premier champ
 * manquant. Ces fonctions pures servent au contrôle fait à l'envoi (ui/Obligatoire.tsx).
 */

/** Un champ du formulaire, dans l'ordre du formulaire. */
export interface ChampControle {
  nom: string;
  valeur: string;
  /** Marqué obligatoire (required ou aria-required). */
  obligatoire: boolean;
  /** Désactivé : jamais contrôlé. */
  inactif?: boolean;
}

/** Index du premier champ obligatoire vide (espaces seuls compris), ou -1. */
export function premierManquant(champs: readonly ChampControle[]): number {
  return champs.findIndex((c) => c.obligatoire && !c.inactif && c.valeur.trim() === '');
}

/** Nom d'un champ tiré de son libellé : sans l'étoile, sans espaces superflus. « Nom * » → « Nom ». */
export function nomSansEtoile(libelle: string): string {
  return libelle.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
}

/** Message affiché près du formulaire : « Remplissez le champ obligatoire « Nom ». » */
export function messageManquant(nom: string): string {
  const n = nomSansEtoile(nom);
  return n ? `Remplissez le champ obligatoire « ${n} ».` : 'Remplissez les champs obligatoires.';
}
