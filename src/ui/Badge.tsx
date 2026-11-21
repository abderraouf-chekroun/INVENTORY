import type { Kind, Statut, StatutDossier } from '../api';
import { classeCouleur, nomStatut, roleDe } from '../lib/statuts';
import { Icon } from './Icon';

export type BadgeKind = Statut | 'noid' | 'incomplet' | 'actif' | 'archive';

/* Table BADGE du prototype : classe CSS + libellé. */
const BADGE: Record<BadgeKind, readonly [string, string]> = {
  clos: ['ok', 'Clôturé'],
  cours: ['warn', 'En cours'],
  piece: ['warn strong', 'Pièce manquante'],
  noid: ['bad', 'Sans identifiant'],
  incomplet: ['bad', 'Fiche à compléter'],
  actif: ['plain', 'Actif'],
  archive: ['mute', 'Archivé'],
};

/** Badge de fiche : `<Badge kind={x.actif ? 'actif' : 'archive'} />`, `<Badge kind="noid" />`. Pour un dossier : StatutBadge. */
export function Badge({ kind }: { kind: BadgeKind }) {
  const [cls, label] = BADGE[kind];
  return (
    <span className={`badge ${cls}`}>
      {kind === 'piece' ? <Icon name="alerte" size={12} /> : <i />}
      {label}
    </span>
  );
}

/**
 * Badge de l'état d'un dossier (§ 10.1) : le nom de l'état, dans la couleur choisie (classe `st-<couleur>` définie
 * pour le thème clair et le thème sombre). Le nom est toujours écrit : la couleur n'est jamais seule à informer.
 * « Pièce manquante » garde son icône d'alerte.
 */
export function StatutBadge({ statut, nom }: { statut: Pick<StatutDossier, 'couleur' | 'role' | 'nom'>; nom?: string }) {
  const texte = nom ?? nomStatut(statut);
  return (
    <span className={`badge st ${classeCouleur(statut.couleur)}`} title={texte.length > 24 ? texte : undefined}>
      {roleDe(statut) === 'piece' ? <Icon name="alerte" size={12} /> : <i />}
      <span className="st-nom">{texte}</span>
    </span>
  );
}

/**
 * Identifiant d'une fiche, affiché tel quel en mono ; sans identifiant, le badge
 * « Fiche à compléter » (employé) ou « Sans identifiant » (machine).
 */
export function EntityCode({ code, kind = 'b' }: { code: string | null; kind?: Kind }) {
  return code ? <span className="mono">{code}</span> : <Badge kind={kind === 'a' ? 'incomplet' : 'noid'} />;
}
