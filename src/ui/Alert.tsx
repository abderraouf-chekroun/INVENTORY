import type { ReactNode } from 'react';
import { versApiError } from '../api';
import { Icon, type IconName } from './Icon';

export interface AlertProps {
  tone: 'warn' | 'bad' | 'info';
  title: ReactNode;
  text?: ReactNode;
  /** Par défaut : 'info' pour tone="info", sinon 'alerte'. */
  icon?: IconName;
  /** À droite : bouton, petit formulaire (`<form>` est déjà mis en ligne par le CSS). */
  children?: ReactNode;
}

/** Bandeau d'alerte (`.alert.warn | .bad | .info`) : « Pièce finale manquante », « Fiche archivée »… */
export function Alert({ tone, title, text, icon, children }: AlertProps) {
  return (
    <div className={`alert ${tone}`} role={tone === 'bad' ? 'alert' : undefined}>
      <Icon name={icon ?? (tone === 'info' ? 'info' : 'alerte')} />
      <div>
        <b>{title}</b>
        {text != null && <p>{text}</p>}
      </div>
      {children}
    </div>
  );
}

/**
 * Affiche une erreur du back (ApiError) ou toute autre erreur, dans le style `.alert.bad`.
 * Ne rend rien si `error` est null/undefined : `<ErrorAlert error={action.error} />` peut rester en place.
 */
export function ErrorAlert({ error, title = 'Action impossible', onDismiss }: {
  error: unknown;
  title?: ReactNode;
  /** Affiche un bouton « Fermer ». */
  onDismiss?: () => void;
}) {
  if (error == null) return null;
  const { message } = versApiError(error);
  return (
    <Alert tone="bad" title={title} text={message}>
      {onDismiss && <button type="button" className="btn" onClick={onDismiss}>Fermer</button>}
    </Alert>
  );
}
