import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Entite, type Kind } from '../../api';
import { useAction } from '../../lib/action';
import { montrerAvis } from '../../lib/avis';
import { marquerFicheSupprimee } from '../../lib/fichesSupprimees';
import { nomAffiche } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import {
  avertissementSuppression, effetsSuppression, identiteSuppression, messageFicheSupprimee, titreSuppressionFiche,
} from '../../lib/suppression';
import { nav, useNav } from '../../nav';
import { Alert, ErrorAlert, Modal, PageHeader } from '../../ui';

/*
 * Suppression d'un employé ou d'une machine (§ 13.2) : fenêtre de confirmation alimentée par l'aperçu du back
 * (nombres réels), retour au répertoire avec un message bref, et page « Cette fiche a été supprimée. ».
 */

/** Répertoire où revenir après la suppression : la page précédente si c'est déjà lui, sinon il remplace la fiche. */
function revenirAuRepertoire(kind: Kind) {
  const { stack } = useNav.getState();
  const prev = stack[stack.length - 1];
  if (prev && prev.name === 'rep' && prev.kind === kind) nav.back();
  else nav.replace({ name: 'rep', kind });
}

/**
 * Fenêtre « Supprimer l’employé ? » / « Supprimer la machine ? » : identité de la fiche, ce qui va se passer (aperçu du
 * back), avertissement, puis « Supprimer définitivement », « Archiver plutôt » (fiche active) et « Annuler ».
 */
export function SupprimerFicheModal({ entite: x, onClose }: { entite: Entite; onClose: () => void }) {
  const qc = useQueryClient();
  const titre = titreSuppressionFiche(x.kind);
  const apercu = useQuery({
    queryKey: qk.suppressionApercu(x.id),
    queryFn: () => api.entiteSuppressionApercu(x.id),
    gcTime: 0,
  });
  const supprimer = useAction(() => api.entiteSupprimer(x.id), {
    // Rien n'est relu avant de quitter la page : la fiche, relue, n'existerait plus.
    invalidate: 'none',
    errors: 'local',
    onSuccess: () => {
      // Le répertoire en cache ne la montre plus, même le temps de sa relecture.
      qc.setQueryData<Entite[]>(qk.entites(x.kind), (old) => old?.filter((e) => e.id !== x.id));
      marquerFicheSupprimee(x.id, x.kind, nomAffiche(x));
      revenirAuRepertoire(x.kind);
      montrerAvis(messageFicheSupprimee(x));
      // La fiche supprimée sort du cache, ainsi que le contenu des dossiers : un document rouvert depuis le cache
      // désignerait encore la fiche (l'éditeur garde les blocs qu'il a reçus à l'ouverture). Tout le reste est relu :
      // répertoire, tableau de bord, catégories et leur nombre de fiches, liste des dossiers, fiches de l'autre côté
      // des affectations, recherche globale, suggestions.
      qc.removeQueries({ queryKey: qk.fiche(x.id) });
      qc.removeQueries({ queryKey: qk.contenusDossiers });
      void qc.invalidateQueries();
    },
  });
  const archiver = useAction(() => api.entiteBasculer(x.id), { errors: 'local', onSuccess: onClose });
  const occupe = supprimer.isPending || archiver.isPending;
  const effets = apercu.data ? effetsSuppression(x.kind, apercu.data) : [];

  return (
    <Modal label={titre} onClose={onClose}>
      <h3>{titre}</h3>
      <p className="sup-identite">{identiteSuppression(x)}</p>
      {apercu.data ? (
        <ul className="sup-effets">{effets.map((t) => <li key={t}>{t}</li>)}</ul>
      ) : !apercu.isError && (
        <p className="sup-lecture" role="status">Lecture de ce qui sera supprimé…</p>
      )}
      <p className="sup-avert">{avertissementSuppression(x.actif)}</p>
      <ErrorAlert error={apercu.error} title="Aperçu de la suppression impossible" />
      <ErrorAlert error={supprimer.error ?? archiver.error} />
      <div className="mform">
        <div className="acts">
          <button type="button" className="btn danger fort" disabled={!apercu.data || occupe} onClick={() => supprimer.mutate()}>
            Supprimer définitivement
          </button>
          {x.actif && (
            <button type="button" className="btn" disabled={occupe} onClick={() => archiver.mutate()}>Archiver plutôt</button>
          )}
          <button type="button" className="btn" autoFocus onClick={onClose}>Annuler</button>
        </div>
      </div>
    </Modal>
  );
}

const REPERTOIRE: Record<Kind, string> = { a: 'Retour aux employés', b: 'Retour aux machines' };

/**
 * Page d'une fiche qui n'existe plus (historique de navigation, lien ancien) : « Cette fiche a été supprimée. » et un
 * retour au répertoire. Répertoire inconnu : les deux sont proposés.
 */
export function FicheSupprimeePage({ kind }: { kind: Kind | null }) {
  return (
    <>
      <PageHeader eyebrow="Fiche" title="Fiche supprimée" />
      <AlerteFicheSupprimee kind={kind} />
    </>
  );
}

/** « Cette fiche a été supprimée. » et le retour au répertoire (aussi dans « Modifier la fiche »). */
export function AlerteFicheSupprimee({ kind }: { kind: Kind | null }) {
  const kinds: Kind[] = kind ? [kind] : ['a', 'b'];
  return (
    <Alert tone="info" title="Cette fiche a été supprimée."
      text="Elle n’existe plus. Les documents où elle était nommée gardent son nom en texte.">
      <span className="sup-retours">
        {kinds.map((k) => (
          <button key={k} type="button" className="btn" onClick={() => nav.root({ name: 'rep', kind: k })}>{REPERTOIRE[k]}</button>
        ))}
      </span>
    </Alert>
  );
}
