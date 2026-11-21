import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { MouseEvent } from 'react';
import { api, type DossierResume } from '../../api';
import { useAction } from '../../lib/action';
import { montrerAvis } from '../../lib/avis';
import { qk } from '../../lib/queryKeys';
import { estClos } from '../../lib/statuts';
import {
  AVERTISSEMENT_SUPPRESSION_DOSSIER, effetsSuppressionDossier, identiteSuppressionDossier, messageDossierSupprime,
  NOM_CORBEILLE_DOSSIER, TITRE_SUPPRESSION_DOSSIER, type DossierASupprimer,
} from '../../lib/suppression';
import { nav, useNav } from '../../nav';
import { Alert, ErrorAlert, Icon, Modal, PageHeader } from '../../ui';
import { flushAll } from '../blocs/autosave';
import { oublierDossier } from './store';

/*
 * Suppression d'un dossier avec tout son contenu (§ 15) : corbeille sur chaque dossier de « Dossiers & Archives »,
 * bouton du dossier ouvert, fenêtre de confirmation alimentée par l'aperçu du back (nombres réels), message bref,
 * et page « Ce dossier a été supprimé. ».
 */

/**
 * Corbeille d'un dossier (cartes et arborescence) : icône seule, toujours visible, nom accessible et infobulle
 * « Supprimer le dossier ». Bouton frère de celui qui ouvre le dossier (jamais dedans) : son clic n'ouvre pas le
 * dossier. Toujours disponible, quel que soit l'état du dossier (clôturé compris).
 */
export function CorbeilleDossier({ onSupprimer }: { onSupprimer: () => void }) {
  const clic = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    onSupprimer();
  };
  return (
    <button type="button" className="btn ghost corbeille corbeille-dossier" aria-label={NOM_CORBEILLE_DOSSIER}
      title={NOM_CORBEILLE_DOSSIER} onClick={clic}>
      <Icon name="corbeille" size={16} />
    </button>
  );
}

/** Après une suppression depuis le dossier ouvert : « Dossiers & Archives » (la page précédente si c'est déjà elle). */
function revenirAuxDossiers() {
  const { stack } = useNav.getState();
  const prev = stack[stack.length - 1];
  if (prev && prev.name === 'dossiers') nav.back();
  else nav.replace({ name: 'dossiers' });
}

/**
 * Fenêtre « Supprimer le dossier ? » : identité du dossier, ce qui va se passer (aperçu du back), « Cette action est
 * irréversible. », puis « Supprimer définitivement » (rouge) et « Annuler » (focus).
 * `depuis` : 'liste' (on reste sur Dossiers & Archives) ou 'dossier' (retour à Dossiers & Archives).
 * Toute saisie en attente d'enregistrement automatique part avant la suppression (le dossier existe encore) : rien ne
 * part après, rien n'échoue ensuite.
 */
export function SupprimerDossierModal({ dossier: d, depuis, onClose }: {
  dossier: DossierASupprimer;
  depuis: 'liste' | 'dossier';
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const apercu = useQuery({
    queryKey: qk.dossierSuppressionApercu(d.id),
    queryFn: () => api.dossierSuppressionApercu(d.id),
    gcTime: 0,
  });
  const supprimer = useAction(async () => {
    await flushAll();
    await api.dossierSupprimer(d.id);
  }, {
    // Rien n'est relu avant de quitter le dossier : relu, il n'existerait plus.
    invalidate: 'none',
    errors: 'local',
    onSuccess: () => {
      // Les listes en cache ne le montrent plus, même le temps de leur relecture.
      qc.setQueryData<DossierResume[]>(qk.dossiers, (old) => old?.filter((x) => x.id !== d.id));
      oublierDossier(d.id);
      if (depuis === 'dossier') revenirAuxDossiers();
      else onClose();
      montrerAvis(messageDossierSupprime(d));
      // Le contenu du dossier sort du cache ; tout le reste est relu : tableau de bord, recherche, profils des fiches
      // (documents, dossiers liés, historique), modèles (nombre de documents), états (nombre de dossiers).
      qc.removeQueries({ queryKey: qk.dossier(d.id) });
      void qc.invalidateQueries();
    },
  });
  const effets = apercu.data ? effetsSuppressionDossier(apercu.data, estClos(d.statut)) : [];

  return (
    <Modal label={TITRE_SUPPRESSION_DOSSIER} onClose={onClose}>
      <h3>{TITRE_SUPPRESSION_DOSSIER}</h3>
      <p className="sup-identite">{identiteSuppressionDossier(d)}</p>
      {apercu.data ? (
        <ul className="sup-effets">{effets.map((t) => <li key={t}>{t}</li>)}</ul>
      ) : !apercu.isError && (
        <p className="sup-lecture" role="status">Lecture de ce qui sera supprimé…</p>
      )}
      <p className="sup-avert">{AVERTISSEMENT_SUPPRESSION_DOSSIER}</p>
      <ErrorAlert error={apercu.error} title="Aperçu de la suppression impossible" />
      <ErrorAlert error={supprimer.error} />
      <div className="mform">
        <div className="acts">
          <button type="button" className="btn danger fort" disabled={!apercu.data || supprimer.isPending} onClick={() => supprimer.mutate()}>
            Supprimer définitivement
          </button>
          <button type="button" className="btn" autoFocus onClick={onClose}>Annuler</button>
        </div>
      </div>
    </Modal>
  );
}

/**
 * Page d'un dossier qui n'existe plus (bouton Retour, lien d'un ancien événement, dossier lié resté en cache) :
 * « Ce dossier a été supprimé. » et le retour à « Dossiers & Archives ».
 */
export function DossierSupprimePage() {
  return (
    <>
      <PageHeader eyebrow="Dossier" title="Dossier supprimé" />
      <Alert tone="info" title="Ce dossier a été supprimé."
        text="Il n’existe plus, ni son contenu. Les employés et les machines qui y étaient nommés gardent leur fiche.">
        <span className="sup-retours">
          <button type="button" className="btn" onClick={() => nav.root({ name: 'dossiers' })}>Retour aux dossiers</button>
        </span>
      </Alert>
    </>
  );
}
