import { useState, type ReactNode } from 'react';
import type { DocumentFichier, DossierDetail, DossierResume, StatutDossier } from '../../api';
import { PAS_LISTE } from '../../lib/borne';
import { plural } from '../../lib/format';
import { useDossier } from '../../lib/queries';
import { estClos } from '../../lib/statuts';
import { nav } from '../../nav';
import { ErrorAlert, Icon, PlusDElements, StatutBadge, UNITES, useBorne } from '../../ui';
import { documentsDe, nbDocuments, sousDossiersDe, type Emplacement } from '../dossier/arbre';
import { ConfirmerSuppressionDocument, CorbeilleDocument } from '../dossier/SuppressionDocument';
import { cleNoeud, useDossiersUi } from './store';
import { CorbeilleDossier } from './Suppression';

/*
 * Vue « Arborescence » (`treeNode()` du prototype). Le contenu d'un dossier n'est lu (`dossierDetail`)
 * qu'une fois le dossier déplié. Cliquer un sous-dossier ou un fichier ouvre le dossier au bon endroit.
 */

const INDENT = 36;

function Ligne({ cle, nom, niveau, sousTitre, badge, onOpen, fin }: {
  cle: string;
  nom: string;
  niveau: number;
  sousTitre: string;
  badge?: StatutDossier;
  onOpen: () => void;
  /** Bouton posé au bout de la ligne, à côté (jamais dedans) du bouton qui ouvre : la corbeille d'un dossier (§ 15). */
  fin?: ReactNode;
}) {
  const ouvert = useDossiersUi((s) => s.ouverts.includes(cle));
  const basculer = useDossiersUi((s) => s.basculer);
  return (
    <div className="trow" style={{ marginLeft: niveau * INDENT }}>
      <button type="button" className="tg" aria-label={`${ouvert ? 'Replier' : 'Déplier'} ${nom}`} aria-expanded={ouvert}
        onClick={() => basculer(cle)}>
        <Icon name={ouvert ? 'down' : 'right'} size={20} />
      </button>
      <button type="button" className="open" onClick={onOpen}>
        <Icon name={ouvert ? 'ouvert' : 'dossier'} size={niveau ? 24 : 28} />
        <span>
          <b>{nom}</b>
          <br />
          <small>{sousTitre}</small>
        </span>
        <span className="sp" />
        {badge && <StatutBadge statut={badge} />}
      </button>
      {fin}
    </div>
  );
}

/** Contenu déplié d'un emplacement : sous-dossiers (dépliables) puis fichiers. */
function Contenu({ detail, lieu, niveau }: { detail: DossierDetail; lieu: Emplacement; niveau: number }) {
  const id = detail.dossier.id;
  // Rendu borné (lib/borne.ts) : un emplacement aux milliers d'éléments ne gèle pas l'interface.
  const sous = useBorne(sousDossiersDe(detail, lieu), PAS_LISTE);
  const docs = useBorne(documentsDe(detail, lieu), PAS_LISTE);
  const decalage = { marginLeft: (niveau + 1) * INDENT + 40 };
  const clos = estClos(detail.dossier.statut);
  const [aSupprimer, setASupprimer] = useState<DocumentFichier | null>(null);
  return (
    <>
      {sous.visibles.map((s) => (
        <SousDossierNoeud key={s.id} detail={detail} id={s.id} nom={s.nom} niveau={niveau + 1} />
      ))}
      {sous.masques > 0 && (
        <div className="trow f" style={decalage}>
          <PlusDElements masques={sous.masques} pas={PAS_LISTE} unite={UNITES.dossiers} onPlus={sous.plus} />
        </div>
      )}
      {docs.visibles.map((f) => (
        <div key={f.id} className="trow f" style={decalage}>
          <button type="button" className="open"
            onClick={() => nav.go({ name: 'dossier', id, sousDossierId: f.sousDossierId, documentId: f.id })}>
            <Icon name="fichier" size={22} />
            <span>
              <b>{f.nom}</b>
              <br />
              <small>{f.source}</small>
            </span>
          </button>
          {/* § 13.1 : suppression directe, sans ouvrir le document. */}
          <CorbeilleDocument clos={clos} onSupprimer={() => setASupprimer(f)} />
        </div>
      ))}
      {docs.masques > 0 && (
        <div className="trow f" style={decalage}>
          <PlusDElements masques={docs.masques} pas={PAS_LISTE} unite={UNITES.documents} onPlus={docs.plus} />
        </div>
      )}
      {aSupprimer && (
        <ConfirmerSuppressionDocument doc={aSupprimer} dossierNom={detail.dossier.nom} onClose={() => setASupprimer(null)} />
      )}
    </>
  );
}

function SousDossierNoeud({ detail, id, nom, niveau }: { detail: DossierDetail; id: number; nom: string; niveau: number }) {
  const cle = cleNoeud(detail.dossier.id, id);
  const ouvert = useDossiersUi((s) => s.ouverts.includes(cle));
  return (
    <>
      <Ligne cle={cle} nom={nom} niveau={niveau} sousTitre={plural(nbDocuments(detail, id), 'fichier')}
        onOpen={() => nav.go({ name: 'dossier', id: detail.dossier.id, sousDossierId: id })} />
      {ouvert && <Contenu detail={detail} lieu={id} niveau={niveau} />}
    </>
  );
}

/** Contenu d'un dossier déplié, lu à la demande. */
function ContenuDossier({ id }: { id: number }) {
  const q = useDossier(id);
  if (q.isError) return <div style={{ marginLeft: INDENT }}><ErrorAlert error={q.error} title="Chargement impossible" /></div>;
  if (!q.data) return null;
  return <Contenu detail={q.data} lieu={null} niveau={0} />;
}

function DossierNoeud({ d, onSupprimer }: { d: DossierResume; onSupprimer: (d: DossierResume) => void }) {
  const cle = cleNoeud(d.id, null);
  const ouvert = useDossiersUi((s) => s.ouverts.includes(cle));
  return (
    <>
      {/* § 15 : corbeille du dossier au bout de sa ligne, alignée sur celles des documents (« Supprimer le dossier »). */}
      <Ligne cle={cle} nom={d.nom} niveau={0} badge={d.statut}
        sousTitre={`${d.theme} · Année ${d.annee} · ${plural(d.nbFichiers, 'fichier')}`}
        onOpen={() => nav.go({ name: 'dossier', id: d.id })}
        fin={<CorbeilleDossier onSupprimer={() => onSupprimer(d)} />} />
      {ouvert && <ContenuDossier id={d.id} />}
    </>
  );
}

export function Arbre({ dossiers, onSupprimer }: { dossiers: readonly DossierResume[]; onSupprimer: (d: DossierResume) => void }) {
  return (
    <div className="tree">
      {dossiers.map((d) => <DossierNoeud key={d.id} d={d} onSupprimer={onSupprimer} />)}
    </div>
  );
}
