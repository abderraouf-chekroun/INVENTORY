import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, COULEURS, type Couleur, type StatutDossier } from '../../api';
import { useAction } from '../../lib/action';
import {
  COULEUR_LABEL, classeCouleur, couleurDe, couleurProposee, estFourni, motifModificationImpossible, motifSuppressionStatut, nbDossiersLabel,
  nbDossiersDe, nomStatut,
} from '../../lib/statuts';
import { ConfirmModal, Empty, Etoile, ErrorAlert, Icon, MentionObligatoire, StatutBadge, useChampsObligatoires } from '../../ui';

/*
 * Paramètres · États des dossiers (§ 10.1) : ajouter un état (nom et couleur), le renommer, changer sa couleur, le
 * supprimer. Les trois états fournis ne changent pas ; un état porté par des dossiers ne se supprime pas. Quand une
 * action est indisponible, son bouton reste atteignable et explique pourquoi (comme pour les structures, § 9.1).
 */

/**
 * Choix de la couleur : neuf pastilles, chacune avec son nom (la couleur n'est jamais seule), en boutons radio
 * (flèches pour passer de l'une à l'autre). La couleur choisie porte une coche et un contour.
 */
function ChoixCouleur({ valeur, onChange, legende = 'Couleur' }: { valeur: Couleur; onChange: (c: Couleur) => void; legende?: string }) {
  const nom = useId();
  return (
    <fieldset className="couleurs">
      <legend>{legende}</legend>
      <span className="couleurs-opts">
        {COULEURS.map((c) => (
          <label key={c} className="couleur-opt">
            <input type="radio" name={nom} value={c} checked={valeur === c} onChange={() => onChange(c)} />
            <span className={`badge st ${classeCouleur(c)}`}>
              {valeur === c ? <Icon name="check" size={12} /> : <i />}
              {COULEUR_LABEL[c]}
            </span>
          </label>
        ))}
      </span>
    </fieldset>
  );
}

/** Formulaire d'ajout : nom (obligatoire), couleur, aperçu du badge. */
function NouvelEtat({ statuts }: { statuts: readonly StatutDossier[] }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [nom, setNom] = useState('');
  const [couleur, setCouleur] = useState<Couleur | null>(null);
  const c = couleur ?? couleurProposee(statuts);
  const oblig = useChampsObligatoires();
  const ajouter = useAction((x: { nom: string; couleur: Couleur }) => api.statutCreer(x.nom, x.couleur), {
    errors: 'local',
    onSuccess: () => {
      setNom('');
      setCouleur(null);
      input.current?.focus();
    },
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (oblig.verifier(e)) ajouter.mutate({ nom: nom.trim(), couleur: c });
  };
  return (
    <form className={oblig.classe('etat-form')} noValidate onSubmit={submit} onInput={oblig.revoir}>
      <p className="etat-form-titre">Ajouter un état</p>
      <MentionObligatoire />
      <label className="etat-nom" htmlFor={id}>
        <span>Nom du nouvel état<Etoile /></span>
        <input ref={input} className="field" id={id} required placeholder="Ex. : En attente de livraison" maxLength={60} value={nom}
          onChange={(e) => { setNom(e.target.value); if (ajouter.error) ajouter.reset(); }} />
      </label>
      <ChoixCouleur valeur={c} onChange={setCouleur} />
      <p className="etat-apercu">
        <span>Aperçu :</span>
        <StatutBadge statut={{ nom: nom.trim() || 'Nouvel état', couleur: c, role: 'perso' }} />
      </p>
      <ErrorAlert error={oblig.erreur ?? ajouter.error} title="État non ajouté" />
      <div className="acts">
        <button className="btn" disabled={ajouter.isPending}>Ajouter l’état</button>
      </div>
    </form>
  );
}

/** Modifier un état ajouté, en place : nom et couleur. Entrée enregistre, Échap annule. */
function ModifierEtat({ statut, onClose }: { statut: StatutDossier; onClose: () => void }) {
  const id = useId();
  const [nom, setNom] = useState(statut.nom);
  const [couleur, setCouleur] = useState<Couleur>(couleurDe(statut));
  const oblig = useChampsObligatoires();
  const run = useAction((x: { nom: string; couleur: Couleur }) => api.statutModifier(statut.id, x), { errors: 'local', onSuccess: onClose });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!oblig.verifier(e)) return;
    const n = nom.trim();
    if (n === statut.nom && couleur === couleurDe(statut)) onClose();
    else run.mutate({ nom: n, couleur });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <div className="cl-item">
      <form className={oblig.classe('etat-form en-place')} noValidate onSubmit={submit} onInput={oblig.revoir} onKeyDown={onKeyDown}
        aria-label={`Modifier l’état ${statut.nom}`}>
        <MentionObligatoire />
        <label className="etat-nom" htmlFor={id}>
          <span>Nom de l’état<Etoile /></span>
          <input className="field" id={id} autoFocus required maxLength={60} value={nom}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => { setNom(e.target.value); if (run.error) run.reset(); }} />
        </label>
        <ChoixCouleur valeur={couleur} onChange={setCouleur} />
        <p className="etat-apercu">
          <span>Aperçu :</span>
          <StatutBadge statut={{ nom: nom.trim() || statut.nom, couleur, role: 'perso' }} />
        </p>
        <ErrorAlert error={oblig.erreur ?? run.error} title="État non modifié" />
        <div className="acts">
          <button className="btn primary" disabled={run.isPending}>Enregistrer</button>
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
        </div>
      </form>
    </div>
  );
}

/** Bouton d'action d'une ligne : indisponible, il reste atteignable, annonce le motif et l'affiche quand on l'actionne. */
function BoutonLigne({ label, nom, motif, motifId, ouvert, onBasculerMotif, onClick, btnRef }: {
  label: string;
  nom: string;
  motif: string | null;
  motifId: string;
  ouvert: boolean;
  onBasculerMotif: () => void;
  onClick: () => void;
  btnRef?: (el: HTMLButtonElement | null) => void;
}) {
  return (
    <button type="button" ref={btnRef} className={motif ? 'btn indispo' : 'btn'} aria-label={`${label} ${nom}`}
      aria-disabled={motif ? true : undefined} aria-expanded={motif ? ouvert : undefined}
      aria-describedby={motif ? motifId : undefined} title={motif ?? undefined}
      onClick={() => (motif ? onBasculerMotif() : onClick())}>
      {label}
    </button>
  );
}

/** Liste des états, avec leur nombre de dossiers, puis le formulaire d'ajout. */
export function Etats({ statuts }: { statuts: readonly StatutDossier[] }) {
  const baseId = useId();
  const [enEdition, setEnEdition] = useState<number | null>(null);
  const retourFocus = useRef<number | null>(null);
  const [motifVu, setMotifVu] = useState<{ id: number; action: 'modifier' | 'supprimer' } | null>(null);
  const [aSupprimer, setASupprimer] = useState<StatutDossier | null>(null);
  const basculerMotif = (id: number, action: 'modifier' | 'supprimer') =>
    setMotifVu((v) => (v && v.id === id && v.action === action ? null : { id, action }));

  return (
    <div className="set etats">
      {statuts.length === 0 && <Empty>Aucun état.</Empty>}
      {statuts.map((s) => {
        if (enEdition === s.id && !estFourni(s)) {
          return <ModifierEtat key={s.id} statut={s} onClose={() => { retourFocus.current = s.id; setEnEdition(null); }} />;
        }
        const nom = nomStatut(s);
        const motifModif = motifModificationImpossible(s);
        const motifSuppr = motifSuppressionStatut(s);
        const vu = motifVu && motifVu.id === s.id ? motifVu.action : null;
        const motifAffiche = vu === 'modifier' ? motifModif : vu === 'supprimer' ? motifSuppr : null;
        return (
          <div className="cl-item" key={s.id}>
            <div className="line">
              <span className="cl-nom">
                <StatutBadge statut={s} />
                <small>{nbDossiersLabel(nbDossiersDe(s))}{estFourni(s) ? ' · fourni avec l’application' : ''}</small>
              </span>
              <span className="cl-acts">
                <BoutonLigne label="Modifier" nom={nom} motif={motifModif} motifId={`${baseId}-m-${s.id}`} ouvert={vu === 'modifier'}
                  onBasculerMotif={() => basculerMotif(s.id, 'modifier')}
                  onClick={() => { setEnEdition(s.id); setMotifVu(null); }}
                  btnRef={(el) => {
                    // Fin de la modification : le focus revient sur « Modifier » de la même ligne.
                    if (el && retourFocus.current === s.id) {
                      retourFocus.current = null;
                      el.focus();
                    }
                  }} />
                <BoutonLigne label="Supprimer" nom={nom} motif={motifSuppr} motifId={`${baseId}-s-${s.id}`} ouvert={vu === 'supprimer'}
                  onBasculerMotif={() => basculerMotif(s.id, 'supprimer')} onClick={() => setASupprimer(s)} />
                {motifModif && <span className="sr-only" id={`${baseId}-m-${s.id}`}>{motifModif}</span>}
                {motifSuppr && <span className="sr-only" id={`${baseId}-s-${s.id}`}>{motifSuppr}</span>}
              </span>
            </div>
            {motifAffiche && (
              <p className="cl-motif" role="status">
                <Icon name="info" size={14} />
                <span><b>{vu === 'modifier' ? 'Modification impossible.' : 'Suppression impossible.'}</b> {motifAffiche}</span>
              </p>
            )}
          </div>
        );
      })}
      <NouvelEtat statuts={statuts} />
      {aSupprimer && (
        <ConfirmModal title="Supprimer l’état ?" confirmLabel="Supprimer"
          message={`L’état « ${nomStatut(aSupprimer)} » n’est porté par aucun dossier. Il sera définitivement supprimé.`}
          action={() => api.statutSupprimer(aSupprimer.id)} onClose={() => setASupprimer(null)} />
      )}
    </div>
  );
}
