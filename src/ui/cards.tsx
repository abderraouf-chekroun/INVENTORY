import type { ReactNode } from 'react';
import type { DossierResume } from '../api';
import { plural } from '../lib/format';
import { nav } from '../nav/store';
import { StatutBadge } from './Badge';
import { Icon, type IconName } from './Icon';

/**
 * Grande carte de dossier (`folder()` du prototype). À placer dans `<div className="folders">`.
 * Clic par défaut : ouvre le dossier (`nav.go`).
 */
export function FolderCard({ dossier: d, onOpen }: { dossier: DossierResume; onOpen?: () => void }) {
  return (
    <button type="button" className="folder" onClick={onOpen ?? (() => nav.go({ name: 'dossier', id: d.id }))}>
      <span className="top">
        <span className="fic"><Icon name="dossier" size={32} /></span>
        <StatutBadge statut={d.statut} />
      </span>
      <span>
        <b>{d.nom}</b>
        <small>{d.theme} · Année {d.annee}</small>
      </span>
      <span className="ft">
        <span>
          {plural(d.nbFichiers, 'fichier')} · {plural(d.nbSousDossiers, 'dossier')}
          {d.nbOptions > 0 && ` · ${d.nbOptionsCochees}/${d.nbOptions} cochées`}
        </span>
        <Icon name="right" />
      </span>
    </button>
  );
}

export interface FileRowProps {
  icon: IconName;
  /** 20 par défaut (22 dans le contenu d'un dossier, comme le prototype). */
  iconSize?: number;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Éléments avant le chevron : badge, faux bouton `<span className="btn">Saisir le code</span>`… */
  trailing?: ReactNode;
  /** Chevron « › » à droite (vrai par défaut). */
  chevron?: boolean;
  /** Ligne sélectionnable : aria-pressed (document affiché dans l'aperçu). */
  pressed?: boolean;
  onClick: () => void;
}

/**
 * Ligne de fichier / de fiche / de dossier (`.file`). À placer dans `<div className="files">`.
 *   <FileRow icon="dossier" title={d.nom} subtitle={`${d.theme} · Année ${d.annee}`} trailing={<Badge kind={d.statut} />} onClick={…} />
 */
export function FileRow({ icon, iconSize = 20, title, subtitle, trailing, chevron = true, pressed, onClick }: FileRowProps) {
  return (
    <button type="button" className="file" aria-pressed={pressed} onClick={onClick}>
      <span className="fic"><Icon name={icon} size={iconSize} /></span>
      <span>
        <b>{title}</b>
        {subtitle != null && <small>{subtitle}</small>}
      </span>
      <span className="sp" />
      {trailing}
      {chevron && <Icon name="right" />}
    </button>
  );
}

/**
 * Carte d'entrée de la page Création (`.hubcard`). À placer dans `<div className="hub">`.
 */
export function HubCard({ icon, title, text, cta, onClick }: {
  icon: IconName;
  title: ReactNode;
  text: ReactNode;
  cta: ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="hubcard" onClick={onClick}>
      <span className="tile"><Icon name={icon} size={22} /></span>
      <span>
        <b>{title}</b>
        <p>{text}</p>
      </span>
      <span className="cta">{cta}<Icon name="arrow" size={14} /></span>
    </button>
  );
}
