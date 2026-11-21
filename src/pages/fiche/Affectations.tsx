import { useId, useState, type FormEvent } from 'react';
import { api, type Affectation, type Entite } from '../../api';
import { useAction } from '../../lib/action';
import { autreKind, libelleAffecter, messageRetrait, paireAffectation } from '../../lib/affectations';
import { formatDate, nomAffiche } from '../../lib/format';
import { messageManquant } from '../../lib/formulaire';
import { nav } from '../../nav';
import {
  CellulesFiche, ChoixFiche, colonnesFiche, ConfirmModal, Empty, ErrorAlert, MentionObligatoire, Modal, Table, useChampsObligatoires,
} from '../../ui';

/** Titre (`.group-h`) au-dessus d'une liste d'affectations, avec leur nombre. */
function BarreOnglet({ titre, count }: { titre: string; count: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <p className="group-h" style={{ margin: 0 }}>
        {titre}
        <span className="count">{count}</span>
      </p>
    </div>
  );
}

const ouvrir = (a: Affectation) => nav.go({ name: 'fiche', id: a.entite.id });

/**
 * Affectations d'une fiche (§ 9.3) : celles en cours, avec « Retirer l'affectation », puis les anciennes, avec leurs
 * dates. Chaque ligne ouvre la fiche de l'autre côté (active ou archivée).
 */
export function ListeAffectations({ entite, enCours, terminees }: {
  entite: Entite;
  enCours: readonly Affectation[];
  terminees: readonly Affectation[];
}) {
  const o = autreKind(entite.kind);
  const [aRetirer, setARetirer] = useState<Entite | null>(null);
  const titreEnCours = 'Affectations en cours';
  return (
    <>
      <BarreOnglet titre={titreEnCours} count={enCours.length} />
      {enCours.length === 0 ? (
        <Empty>
          {o === 'b' ? 'Aucune machine n’est affectée à cet employé.' : 'Cette machine n’est affectée à aucun employé.'}
          {entite.actif && <> Utilisez « {libelleAffecter(entite.kind)} » en haut de la fiche.</>}
        </Empty>
      ) : (
        <Table
          heads={[...colonnesFiche(o), 'Depuis le', '']}
          rows={enCours}
          rowKey={(a) => a.id}
          rowClassName={(a) => (a.entite.actif ? undefined : 'arch')}
          onOpen={ouvrir}
          label={titreEnCours}
          className="fiches affectations"
          cells={(a) => (
            <>
              <CellulesFiche x={a.entite} archive />
              <td>{formatDate(a.debut)}</td>
              <td style={{ width: 1, textAlign: 'right' }}>
                <button type="button" className="btn" aria-label={`Retirer l’affectation de ${nomAffiche(a.entite)}`}
                  onClick={(e) => { e.stopPropagation(); setARetirer(a.entite); }}>
                  Retirer l’affectation
                </button>
              </td>
            </>
          )}
        />
      )}
      {terminees.length > 0 && (
        <>
          <BarreOnglet titre="Anciennes affectations" count={terminees.length} />
          <Table
            heads={[...colonnesFiche(o), 'Du', 'Au']}
            rows={terminees}
            rowKey={(a) => a.id}
            rowClassName={(a) => (a.entite.actif ? 'ancienne' : 'ancienne arch')}
            onOpen={ouvrir}
            label="Anciennes affectations"
            className="fiches affectations"
            cells={(a) => (
              <>
                <CellulesFiche x={a.entite} archive />
                <td>{formatDate(a.debut)}</td>
                <td>{formatDate(a.fin)}</td>
              </>
            )}
          />
        </>
      )}
      {aRetirer && (
        <ConfirmModal
          title="Retirer l’affectation ?"
          message={messageRetrait(entite, aRetirer)}
          confirmLabel="Retirer l’affectation"
          action={() => api.associationRetirer(...paireAffectation(entite, aRetirer))}
          onClose={() => setARetirer(null)}
        />
      )}
    </>
  );
}

/**
 * Fenêtre « Affecter une machine » / « Affecter à un employé » : aide à la saisie parmi les fiches actives de l'autre
 * répertoire qui ne sont pas déjà affectées à celle-ci, puis « Affecter ». Aucun dossier n'est nécessaire.
 */
export function AffecterModal({ entite, dejaIds, onClose }: { entite: Entite; dejaIds: readonly number[]; onClose: () => void }) {
  const o = autreKind(entite.kind);
  const titre = libelleAffecter(entite.kind);
  const id = useId();
  const [choix, setChoix] = useState<Entite | null>(null);
  const affecter = useAction((y: Entite) => api.associationCreer(...paireAffectation(entite, y)), { errors: 'local', onSuccess: onClose });
  const oblig = useChampsObligatoires();
  // Choix obligatoire : sans fiche choisie (saisie vide, ou lettres tapées sans choisir), le focus revient sur la saisie.
  const [sansChoix, setSansChoix] = useState(false);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!oblig.verifier(e)) return;
    if (!choix) {
      setSansChoix(true);
      document.getElementById(id)?.focus();
      return;
    }
    setSansChoix(false);
    affecter.mutate(choix);
  };
  const libelle = o === 'a' ? 'Employé' : 'Machine à affecter';

  return (
    <Modal label={titre} onClose={onClose}>
      <h3>{titre}</h3>
      <p style={{ margin: 0, color: 'var(--fg2)' }}>
        {o === 'b'
          ? <>Choisissez la machine à affecter à <b>{nomAffiche(entite)}</b>. Aucun dossier n’est nécessaire.</>
          : <>Choisissez l’employé à qui affecter <b>{nomAffiche(entite)}</b>. Aucun dossier n’est nécessaire.</>}
      </p>
      <form className={oblig.classe('mform')} noValidate onSubmit={submit} onInput={oblig.revoir}>
        <MentionObligatoire />
        <ChoixFiche kind={o} id={id} label={libelle} autoFocus required
          aide={o === 'a'
            ? `Employés actifs à qui cette machine n’est pas déjà affectée.`
            : `Machines actives qui ne sont pas déjà affectées à cet employé.`}
          value={choix} onChange={(x) => { setChoix(x); setSansChoix(false); }} exclure={[...dejaIds, entite.id]} />
        <ErrorAlert error={oblig.erreur ?? (sansChoix && !choix ? { code: 'champ_obligatoire', message: messageManquant(libelle) } : null) ?? affecter.error}
          title={oblig.erreur || (sansChoix && !choix) ? 'Action impossible' : 'Affectation impossible'} />
        <div className="acts">
          <button className="btn primary" disabled={affecter.isPending}>Affecter</button>
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </Modal>
  );
}
