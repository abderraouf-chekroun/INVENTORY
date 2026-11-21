import { useId, useState, type MouseEvent } from 'react';
import { api } from '../../api';
import { LECTURE_SEULE, messageSuppressionDocument, type DocumentASupprimer } from '../../lib/suppression';
import { ConfirmModal, Icon } from '../../ui';
import { flushAll } from '../blocs/autosave';

/*
 * Suppression directe d'un document (§ 13.1), partout où un document est listé : contenu du dossier (liste et
 * arborescence) et documents où une fiche est nommée. Le bouton du document ouvert reste (même confirmation).
 */

/** Nom accessible et infobulle de la corbeille. */
export const NOM_CORBEILLE = 'Supprimer le document';

/**
 * Corbeille d'une ligne de document : icône seule, toujours visible, nom accessible « Supprimer le document ».
 * C'est un bouton à part, à côté du bouton qui ouvre le document (jamais dedans) : son clic n'ouvre pas le document.
 * Dossier clôturé : le bouton reste atteignable au clavier (aria-disabled), annonce le motif, l'affiche en infobulle
 * et, quand on l'actionne, sous la ligne.
 */
export function CorbeilleDocument({ clos, onSupprimer }: { clos: boolean; onSupprimer: () => void }) {
  const motifId = useId();
  const [motifVu, setMotifVu] = useState(false);
  const clic = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    if (clos) setMotifVu((v) => !v);
    else onSupprimer();
  };
  return (
    <>
      <button type="button" className={clos ? 'btn ghost corbeille indispo' : 'btn ghost corbeille'} aria-label={NOM_CORBEILLE}
        title={clos ? LECTURE_SEULE : NOM_CORBEILLE} aria-disabled={clos ? true : undefined}
        aria-describedby={clos ? motifId : undefined} aria-expanded={clos ? motifVu : undefined} onClick={clic}>
        <Icon name="corbeille" size={16} />
      </button>
      {clos && <span className="sr-only" id={motifId}>{LECTURE_SEULE}</span>}
      {clos && motifVu && (
        <p className="cl-motif corbeille-motif" role="status">
          <Icon name="info" size={14} />
          <span><b>Suppression impossible.</b> {LECTURE_SEULE}</span>
        </p>
      )}
    </>
  );
}

/**
 * Confirmation de la suppression d'un document : nomme le document et son dossier, précise le cas du fichier importé.
 * Toute saisie en attente (enregistrement automatique d'un document ouvert) part avant la suppression. Après succès,
 * tout le cache est relu (listes, compteur « N sur M », historiques des fiches nommées), puis `onDone`.
 */
export function ConfirmerSuppressionDocument({ doc, dossierNom, onDone, onClose }: {
  doc: DocumentASupprimer;
  dossierNom: string;
  onDone?: () => void;
  onClose: () => void;
}) {
  return (
    // § 15 (1.6) : bouton rouge, comme les autres suppressions définitives, et focus sur « Annuler ».
    <ConfirmModal title="Supprimer le document ?" confirmLabel="Supprimer le document" danger
      message={messageSuppressionDocument(doc, dossierNom)}
      action={async () => {
        await flushAll();
        await api.documentSupprimer(doc.id);
      }}
      onDone={onDone}
      onClose={onClose} />
  );
}
