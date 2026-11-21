import { useId, useState, type FormEvent } from 'react';
import { api, type DossierDetail, type OptionDossier } from '../../api';
import { useAction } from '../../lib/action';
import { ConfirmModal, Etoile, ErrorAlert, Icon, MentionObligatoire, useChampsObligatoires } from '../../ui';

const LECTURE_SEULE = 'Rouvrez le dossier pour le modifier.';

/** Section 4.4 « Options à cocher » : cocher, ajouter, supprimer (avec confirmation). */
export function Options({ detail, readOnly }: { detail: DossierDetail; readOnly: boolean }) {
  const dossierId = detail.dossier.id;
  const [nom, setNom] = useState('');
  const [aSupprimer, setASupprimer] = useState<OptionDossier | null>(null);
  // Valeurs demandées pas encore relues : la case change dès le clic (une case contrôlée qui attendrait
  // l'état de la mutation serait remise à l'ancienne valeur par React le temps d'un rendu).
  const [demandes, setDemandes] = useState<ReadonlyMap<number, boolean>>(new Map());
  const oublier = (id: number) => setDemandes((m) => {
    const n = new Map(m);
    n.delete(id);
    return n;
  });
  const cocher = useAction(({ id, ok }: { id: number; ok: boolean }) => api.optionCocher(id, ok), {
    onSuccess: (_r, { id }) => oublier(id),
    onError: (_e, { id }) => oublier(id),
  });
  const basculer = (id: number, ok: boolean) => {
    setDemandes((m) => new Map(m).set(id, ok));
    cocher.mutate({ id, ok });
  };
  const ajouter = useAction((n: string) => api.optionCreer(dossierId, n), {
    errors: 'local',
    onSuccess: () => setNom(''),
  });
  const oblig = useChampsObligatoires();
  const nomId = useId();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (oblig.verifier(e)) ajouter.mutate(nom.trim());
  };
  const coche = (o: OptionDossier) => demandes.get(o.id) ?? o.ok;

  return (
    <div className="checks">
      {detail.options.map((o) => {
        const ok = coche(o);
        const id = `ck-${o.id}`;
        return (
          <div key={o.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label className="ckrow" htmlFor={id} style={{ flex: 1 }} title={readOnly ? LECTURE_SEULE : undefined}>
              <input type="checkbox" id={id} checked={ok} disabled={readOnly}
                onChange={(e) => basculer(o.id, e.target.checked)} />
              <span>{o.nom}</span>
              <em className={ok ? 'on' : ''}>{ok ? 'Coché' : 'Non coché'}</em>
            </label>
            {!readOnly && (
              <button type="button" className="btn ghost" aria-label={`Supprimer l’option ${o.nom}`} title="Supprimer l’option"
                onClick={() => setASupprimer(o)}>
                <Icon name="close" size={14} />
              </button>
            )}
          </div>
        );
      })}
      {detail.options.length === 0 && <p className="empty">Aucune option pour ce dossier.</p>}
      <form className={oblig.classe('inline')} noValidate onSubmit={submit} onInput={oblig.revoir}>
        <label className="inline-lib" htmlFor={nomId}>Nom de la nouvelle option<Etoile /></label>
        <input className="field" id={nomId} placeholder="Ex. : Bon de livraison reçu" required
          value={nom} disabled={readOnly} title={readOnly ? LECTURE_SEULE : undefined} onChange={(e) => setNom(e.target.value)} />
        <button className="btn" disabled={readOnly || ajouter.isPending}>Ajouter l’option</button>
        {!readOnly && <MentionObligatoire className="inline-mention" />}
      </form>
      <ErrorAlert error={oblig.erreur ?? ajouter.error} />
      {aSupprimer && (
        <ConfirmModal title="Supprimer l’option ?" confirmLabel="Supprimer l’option"
          message={`L’option « ${aSupprimer.nom} » sera retirée de ce dossier.`}
          action={() => api.optionSupprimer(aSupprimer.id)} onClose={() => setASupprimer(null)} />
      )}
    </div>
  );
}
