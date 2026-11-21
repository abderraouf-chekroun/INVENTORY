import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useAction, type Invalidation } from '../lib/action';
import { ErrorAlert } from './Alert';
import { Modal } from './Modal';
import { Etoile, MentionObligatoire, useChampsObligatoires } from './Obligatoire';

/**
 * Confirmation avant une action irréversible (supprimer un sous-dossier, effacer les données…).
 * L'action est lancée par le bouton principal ; en cas de succès : invalidation (défaut 'all'),
 * `onDone`, puis fermeture. En cas d'échec, le message du back s'affiche DANS la fenêtre.
 *
 *   {aSupprimer && <ConfirmModal title="Supprimer le document ?" message="…" confirmLabel="Supprimer"
 *      action={() => api.documentSupprimer(aSupprimer.id)} onClose={() => setASupprimer(null)} />}
 */
export function ConfirmModal({ title, message, confirmLabel, action, invalidate, onDone, onClose, danger = false }: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  action: () => Promise<unknown>;
  invalidate?: Invalidation;
  onDone?: () => void;
  onClose: () => void;
  /** Suppression définitive : bouton principal rouge (`btn danger fort`) et focus sur « Annuler ». */
  danger?: boolean;
}) {
  const run = useAction(action, {
    invalidate,
    errors: 'local',
    onSuccess: () => {
      onDone?.();
      onClose();
    },
  });
  return (
    <Modal label={title} onClose={onClose}>
      <h3>{title}</h3>
      <p style={{ margin: 0, color: 'var(--fg2)' }}>{message}</p>
      <ErrorAlert error={run.error} />
      <div className="mform">
        <div className="acts">
          <button type="button" className={danger ? 'btn danger fort' : 'btn primary'} disabled={run.isPending} onClick={() => run.mutate()}>
            {confirmLabel}
          </button>
          <button type="button" className="btn" autoFocus={danger} onClick={onClose}>Annuler</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Renommer (dossier, sous-dossier, document) ou saisir un nom. Le champ est prérempli et sélectionné.
 * Nom vide : refusé par le champ (required). Nom inchangé : la fenêtre se ferme sans appel.
 *
 *   <RenameModal title="Renommer le document" label="Nom du document" initial={doc.nom}
 *     action={(nom) => api.documentRenommer(doc.id, nom)} onClose={…} />
 */
export function RenameModal({ title, label, initial, submitLabel = 'Renommer', action, invalidate, onDone, onClose }: {
  title: string;
  label: string;
  initial: string;
  submitLabel?: string;
  action: (nom: string) => Promise<unknown>;
  invalidate?: Invalidation;
  onDone?: (nom: string) => void;
  onClose: () => void;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const run = useAction(action, {
    invalidate,
    errors: 'local',
    onSuccess: (_r, nom) => {
      onDone?.(nom);
      onClose();
    },
  });
  const oblig = useChampsObligatoires();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!oblig.verifier(e)) return;
    const nom = value.trim();
    if (nom === initial) onClose();
    else run.mutate(nom);
  };
  return (
    <Modal label={title} onClose={onClose}>
      <h3>{title}</h3>
      <form className={oblig.classe('mform')} noValidate onSubmit={submit} onInput={oblig.revoir}>
        <MentionObligatoire />
        <label htmlFor={id}>
          <span>{label}<Etoile /></span>
          <input className="field" id={id} required autoFocus value={value}
            onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} />
        </label>
        <ErrorAlert error={oblig.erreur ?? run.error} />
        <div className="acts">
          <button className="btn primary" disabled={run.isPending}>{submitLabel}</button>
          <button type="button" className="btn" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </Modal>
  );
}
