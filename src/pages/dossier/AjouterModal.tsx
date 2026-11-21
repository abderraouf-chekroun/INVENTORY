import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent } from 'react';
import { api, type DocumentFichier } from '../../api';
import { useAction } from '../../lib/action';
import { useModeles } from '../../lib/queries';
import { nav } from '../../nav';
import { Etoile, ErrorAlert, Icon, MentionObligatoire, Modal, useChampsObligatoires } from '../../ui';
import type { Emplacement } from './arbre';

type Etape = 'choose' | 'folder' | 'file';

/**
 * Fenêtre « Que voulez-vous ajouter ? » (`modalHTML()` du prototype) :
 * un dossier (nom), ou un fichier (depuis un modèle actif, nouveau modèle dans le Studio, ou import).
 * Parcours « pièce finale » : directement l'étape fichier, sans « Retour », avec `pieceFinale = true`.
 */
export function AjouterModal({ dossierId, lieu, pieceFinale, onClose, onDocument }: {
  dossierId: number;
  lieu: Emplacement;
  pieceFinale: boolean;
  onClose: () => void;
  /** Document créé ou importé : la page l'affiche. */
  onDocument: (doc: DocumentFichier) => void;
}) {
  const [etape, setEtape] = useState<Etape>(pieceFinale ? 'file' : 'choose');
  const nomId = useId();
  const [nom, setNom] = useState('');
  const modeles = useModeles();

  const creerDossier = useAction((n: string) => api.sousDossierCreer(dossierId, lieu, n), {
    errors: 'local',
    onSuccess: () => onClose(),
  });
  const depuisModele = useAction((modeleId: number) => api.documentCreerDepuisModele(dossierId, lieu, modeleId, pieceFinale), {
    errors: 'local',
    onSuccess: (doc) => {
      onDocument(doc);
      onClose();
    },
  });
  // Le sélecteur de fichier s'ouvre dans le back (le front ne transmet aucun chemin) ; null = choix annulé.
  const importer = useAction(
    (): Promise<DocumentFichier | null> => api.documentImporter(dossierId, lieu, pieceFinale),
    {
      errors: 'local',
      onSuccess: (doc) => {
        if (!doc) return;
        onDocument(doc);
        onClose();
      },
    },
  );
  const nouveauModele = useAction(() => api.modeleCreer(), {
    errors: 'local',
    onSuccess: (m) => nav.go({ name: 'studio', modeleId: m.id }),
  });

  const busy = creerDossier.isPending || depuisModele.isPending || importer.isPending || nouveauModele.isPending;

  // Pendant une action, ses boutons sont désactivés et perdent le focus (il retombe sur la page, hors de la
  // fenêtre : Échap et Tab n'y agissent plus). Ex. : sélecteur de fichier natif annulé. À la fin de l'action,
  // si la fenêtre est toujours ouverte, le focus revient au bouton cliqué.
  const dernierBouton = useRef<HTMLButtonElement | null>(null);
  const etaitOccupe = useRef(false);
  useEffect(() => {
    if (etaitOccupe.current && !busy) {
      const actif = document.activeElement;
      const b = dernierBouton.current;
      if ((!actif || actif === document.body) && b?.isConnected && !b.disabled) b.focus();
    }
    etaitOccupe.current = busy;
  }, [busy]);
  const memoriserBouton = (e: MouseEvent) => {
    dernierBouton.current = e.target instanceof Element ? e.target.closest('button') : null;
  };
  const error = creerDossier.error ?? depuisModele.error ?? importer.error ?? nouveauModele.error;
  const resetErrors = () => {
    creerDossier.reset();
    depuisModele.reset();
    importer.reset();
    nouveauModele.reset();
  };
  const aller = (e: Etape) => {
    resetErrors();
    setEtape(e);
  };

  const oblig = useChampsObligatoires();
  const submitDossier = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (oblig.verifier(e)) creerDossier.mutate(nom.trim());
  };

  const backBtn = pieceFinale ? null : (
    <button type="button" className="btn" onClick={() => aller('choose')}>Retour</button>
  );
  const actifs = (modeles.data ?? []).filter((m) => m.actif);

  return (
    <Modal label="Ajouter au dossier" onClose={onClose}>
      <div style={{ display: 'contents' }} onClickCapture={memoriserBouton}>
      {etape === 'choose' && (
        <>
          <h3>Que voulez-vous ajouter ?</h3>
          <div className="choices">
            <button type="button" className="choice" autoFocus onClick={() => aller('folder')}>
              <Icon name="dossier" size={40} /><b>Un dossier</b><small>Vous choisissez son nom</small>
            </button>
            <button type="button" className="choice" onClick={() => aller('file')}>
              <Icon name="fichier" size={40} /><b>Un fichier</b><small>Depuis un modèle ou un fichier existant</small>
            </button>
          </div>
        </>
      )}
      {etape === 'folder' && (
        <>
          <h3>Nouveau dossier</h3>
          <form className={oblig.classe('mform')} noValidate onSubmit={submitDossier} onInput={oblig.revoir}>
            <MentionObligatoire />
            <label htmlFor={nomId}>
              <span>Nom du dossier<Etoile /></span>
              <input className="field" id={nomId} required autoFocus placeholder="Sous-dossier C" value={nom}
                onChange={(e) => setNom(e.target.value)} />
            </label>
            <ErrorAlert error={oblig.erreur ?? error} />
            <div className="acts">
              <button className="btn primary" disabled={busy}>Créer le dossier</button>
              {backBtn}
            </div>
          </form>
        </>
      )}
      {etape === 'file' && (
        <>
          <h3>{pieceFinale ? 'Ajouter la pièce finale' : 'Nouveau fichier'}</h3>
          <p className="mh">Choisir un modèle</p>
          {actifs.map((m, i) => (
            <button key={m.id} type="button" className="opt" autoFocus={i === 0} disabled={busy}
              onClick={() => depuisModele.mutate(m.id)}>
              <Icon name="fichier" size={20} /><b>{m.nom}</b><small>{m.theme}</small>
            </button>
          ))}
          <button type="button" className="opt" autoFocus={actifs.length === 0} disabled={busy} onClick={() => nouveauModele.mutate()}>
            <Icon name="plus" size={20} /><b>Créer un nouveau modèle</b><small>Ouvre le Studio de Modèles</small>
          </button>
          <p className="mh">Ou un fichier existant</p>
          <button type="button" className="opt" disabled={busy} onClick={() => importer.mutate()}>
            <Icon name="arrow" size={20} /><b>Importer un fichier</b><small>Fichier numérisé</small>
          </button>
          <ErrorAlert error={error} />
          {backBtn && <div>{backBtn}</div>}
        </>
      )}
      <button type="button" className="btn ghost" style={{ alignSelf: 'flex-end' }} onClick={onClose}>Annuler</button>
      </div>
    </Modal>
  );
}
