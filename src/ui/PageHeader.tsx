import type { ReactNode } from 'react';
import { texteBandeau } from '../lib/bandeau';

export interface PageHeaderProps {
  /**
   * Petite ligne facultative au-dessus du titre : « Dossier ouvert ». Depuis la 1.8 (§ 17), sans « Module N » ;
   * absente, vide ou répétant le titre : pas de ligne du tout (voir `texteBandeau`).
   */
  eyebrow?: string;
  title: ReactNode;
  lead?: ReactNode;
  /** Boutons à droite (classe .ph-actions, position relative : un .menu peut s'y ancrer). */
  actions?: ReactNode;
}

/** En-tête de page (`head()` du prototype). */
export function PageHeader({ eyebrow, title, lead, actions }: PageHeaderProps) {
  const bandeau = texteBandeau(eyebrow, title);
  return (
    <header className="ph">
      <div>
        {bandeau != null && <p className="eyebrow">{bandeau}</p>}
        <h1>{title}</h1>
        {lead != null && <p className="lead">{lead}</p>}
      </div>
      <div className="ph-actions">{actions}</div>
    </header>
  );
}
