import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api, BLOCS_FICHIER_IMPORTE, fichesDesVariables, fichierUrl, type BlocDocument, type Classement, type DocumentFichier, type DossierDetail,
  type Entite,
} from '../../api';
import { useAction } from '../../lib/action';
import { texte } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { blocAvecFiche, ficheSupprimeeDe, LECTURE_SEULE } from '../../lib/suppression';
import { PAS_BLOCS } from '../../lib/borne';
import { nav } from '../../nav';
import { ChoixFiche, Etoile, Icon, MentionObligatoire, PlusDElements, UNITES, useBorne } from '../../ui';
import { useAutosave } from '../blocs/autosave';
import {
  blocsFichierImporte, blocsLisibles, entiteIdDe, estObligatoire, messageObligatoires, obligatoiresManquants, valeursVariables,
} from '../blocs/blocs';
import { BlocSaisie, BlocsPapier, GabaritGris, Papier, useFicheDesignee } from '../blocs/Papier';
import { decisionApercu } from './apercu';

/** Date `AAAA-MM-JJ` complète (un champ date en cours de frappe peut donner « 0002-… »). */
const dateComplete = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 1900;

/** Met à jour un document dans le détail du dossier en cache, sans relire le back. */
function useMajCache(doc: DocumentFichier) {
  const qc = useQueryClient();
  return (patch: Partial<DocumentFichier>) =>
    qc.setQueryData<DossierDetail>(qk.dossier(doc.dossierId), (old) =>
      old && { ...old, documents: old.documents.map((x) => (x.id === doc.id ? { ...x, ...patch } : x)) });
}

/** Date du document, en haut à droite du papier, enregistrée automatiquement. */
function useDateDocument(doc: DocumentFichier) {
  const majCache = useMajCache(doc);
  const [date, setDate] = useState(doc.dateDoc);
  const save = useAutosave<string>({ local: (d) => majCache({ dateDoc: d }), send: (d) => api.documentDefinirDate(doc.id, d) });
  const change = (v: string) => {
    setDate(v);
    if (dateComplete(v)) save.schedule(v);
  };
  return [date, change] as const;
}

/**
 * Fiches que les blocs Employé / Machine peuvent afficher sans les relire : celles que désignent les documents du
 * dossier (`entitesCitees`), et celles choisies ici depuis l'ouverture du document (`retenir`).
 */
function useFichesConnues(detail: DossierDetail) {
  const [choisies, setChoisies] = useState<readonly Entite[]>([]);
  const fiches = useMemo(() => {
    const m = new Map<number, Entite>();
    const citees: unknown = detail.entitesCitees;
    // Les fiches relues du back passent après celles choisies ici : leurs informations sont les plus récentes.
    for (const e of [...choisies, ...(Array.isArray(citees) ? (citees as Entite[]) : [])]) {
      if (e && typeof e === 'object') m.set(e.id, e);
    }
    return m;
  }, [detail.entitesCitees, choisies]);
  const retenir = (e: Entite) => setChoisies((xs) => [...xs.filter((x) => x.id !== e.id), e]);
  return { fiches, retenir };
}

/** Date du document : obligatoire (une date vide ou incomplète n'est jamais enregistrée). */
function ChampDate({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const id = useId();
  return (
    <label className="p-date" htmlFor={id}>
      <span>Date du document<Etoile /></span>
      <input className="field" type="date" id={id} value={value} disabled={readOnly} title={readOnly ? LECTURE_SEULE : undefined}
        required onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

/**
 * Champs obligatoires du document (§ 10.6) : combien restent à remplir, et un bouton qui mène au premier.
 * Informatif : n'empêche ni l'enregistrement ni la clôture. Non imprimé.
 */
function BilanObligatoires({ total, manquants, readOnly, onAller }: {
  total: number;
  manquants: number;
  readOnly: boolean;
  onAller: () => void;
}) {
  if (total === 0) return null;
  const ok = manquants === 0;
  return (
    <div className={ok ? 'p-oblig ok no-print' : 'p-oblig no-print'}>
      <Icon name={ok ? 'check' : 'alerte'} size={14} />
      <span role="status">{messageObligatoires(manquants)}</span>
      <span className="sp" />
      {!ok && !readOnly && (
        <button type="button" className="btn ghost" onClick={onAller}>Aller au premier champ à remplir</button>
      )}
      <MentionObligatoire />
    </div>
  );
}

/** Document issu d'un modèle : date modifiable puis blocs remplissables, enregistrés automatiquement. */
function PapierModele({ doc, detail, magasin, readOnly }: {
  doc: DocumentFichier;
  detail: DossierDetail;
  magasin: readonly Classement[];
  readOnly: boolean;
}) {
  const prefix = useId();
  const majCache = useMajCache(doc);
  const [date, setDate] = useDateDocument(doc);
  const [blocs, setBlocs] = useState<BlocDocument[]>(doc.blocs ?? []);
  const save = useAutosave<BlocDocument[]>({
    local: (b) => majCache({ blocs: b }),
    send: (b) => api.documentEnregistrerBlocs(doc.id, b),
  });
  const { fiches, retenir } = useFichesConnues(detail);
  // Variables (§ 11.1) : lues dans le document lui-même (premier bloc Employé, premier bloc Machine qui désignent une
  // fiche), en direct : elles suivent le choix fait dans ces blocs ; « — » sans fiche.
  const pourVariables = fichesDesVariables(blocsLisibles(blocs), [...fiches.values()]);
  const variables = valeursVariables(pourVariables.a, pourVariables.b, date);
  // Rendu borné : un document aux blocs innombrables (données piégées) ne gèle pas l'interface.
  const borne = useBorne(blocs, PAS_BLOCS);
  const change = (i: number, b: BlocDocument, fiche?: Entite) => {
    const next = blocs.map((x, j) => (j === i ? b : x));
    setBlocs(next);
    save.schedule(next);
    if (fiche) retenir(fiche);
  };

  // Champs obligatoires (§ 10.6) : nombre restant, mise en évidence, accès au premier.
  const manquants = obligatoiresManquants(blocs);
  const total = blocs.filter((b) => estObligatoire(b)).length;
  const papier = useRef<HTMLDivElement>(null);
  const [aAtteindre, setAAtteindre] = useState<number | null>(null);
  useEffect(() => {
    if (aAtteindre === null) return;
    const el = papier.current?.querySelector<HTMLElement>(`[data-bloc="${aAtteindre}"]`);
    if (!el) return; // pas encore rendu (rendu borné) : on réessaie au prochain rendu
    setAAtteindre(null);
    el.scrollIntoView({ block: 'center' });
    el.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])')
      ?.focus({ preventScroll: true });
  });
  const allerAuPremier = () => {
    const i = manquants[0];
    if (i === undefined) return;
    borne.assurer(i + 1);
    setAAtteindre(i);
  };

  return (
    <div ref={papier} className="papier-cadre">
      <Papier titre={doc.nom} sousTitre={`${detail.dossier.nom} · ${detail.dossier.theme}`}
        date={<ChampDate value={date} onChange={setDate} readOnly={readOnly} />}>
        <BilanObligatoires total={total} manquants={manquants.length} readOnly={readOnly} onAller={allerAuPremier} />
        <BlocsPapier blocs={borne.visibles} manquants={new Set(manquants)} rendre={(i) => (
          <BlocSaisie bloc={borne.visibles[i]} id={`${prefix}-${i}`} variables={variables} magasin={magasin} fiches={fiches}
            readOnly={readOnly} onChange={(nb, fiche) => change(i, nb, fiche)} />
        )} />
        <PlusDElements masques={borne.masques} pas={PAS_BLOCS} unite={UNITES.blocs} onPlus={borne.plus} />
      </Papier>
    </div>
  );
}

const AIDE_FICHE = {
  a: 'Facultatif. Tapez les premières lettres du nom, du prénom ou l’identifiant.',
  b: 'Facultatif. Tapez les premières lettres du nom, de la marque ou l’identifiant.',
} as const;

/**
 * Fichier importé (§ 11.1) : « Employé concerné » et « Machine concernée », facultatifs, avec l'aide à la saisie.
 * Ce sont les deux blocs du document : un choix y nomme la fiche, comme dans un document issu d'un modèle.
 * Enregistrés automatiquement ; en lecture seule dans un dossier clôturé.
 */
function FichesImport({ doc, detail, readOnly }: { doc: DocumentFichier; detail: DossierDetail; readOnly: boolean }) {
  const ids = { a: useId(), b: useId() };
  const majCache = useMajCache(doc);
  const [etat, setEtat] = useState(() => blocsFichierImporte(doc.blocs));
  const save = useAutosave<BlocDocument[]>({
    local: (b) => majCache({ blocs: b }),
    send: (b) => api.documentEnregistrerBlocs(doc.id, b),
  });
  const { fiches, retenir } = useFichesConnues(detail);
  const blocA = etat.blocs[etat.a];
  const blocB = etat.blocs[etat.b];
  const a = useFicheDesignee(entiteIdDe(blocA), 'a', fiches);
  const b = useFicheDesignee(entiteIdDe(blocB), 'b', fiches);
  const choisir = (i: number, e: Entite | null) => {
    const blocs = etat.blocs.map((x, j) => (j === i ? blocAvecFiche(x, e ? e.id : null) : x));
    setEtat({ ...etat, blocs });
    save.schedule(blocs);
    if (e) retenir(e);
  };
  const ouvrir = (e: Entite) => nav.go({ name: 'fiche', id: e.id });
  const champ = (kind: 'a' | 'b') => {
    const bloc = kind === 'a' ? blocA : blocB;
    const lu = kind === 'a' ? a : b;
    const libelle = texte(bloc.v).trim() || (kind === 'a' ? BLOCS_FICHIER_IMPORTE.employe : BLOCS_FICHIER_IMPORTE.machine);
    return (
      <div className="p-fiche">
        <ChoixFiche kind={kind} id={ids[kind]} label={libelle} value={lu.fiche} effacable readOnly={readOnly} onOuvrir={ouvrir}
          required={estObligatoire(bloc)} aide={readOnly ? undefined : AIDE_FICHE[kind]} supprimee={ficheSupprimeeDe(bloc, kind)}
          onChange={(e) => choisir(kind === 'a' ? etat.a : etat.b, e)} />
        {lu.introuvable && <p className="p-inconnu no-print">La fiche choisie est introuvable. Choisissez-en une autre.</p>}
      </div>
    );
  };
  return (
    <div className="fiches-import" role="group" aria-label="Employé et machine concernés par ce fichier">
      {champ('a')}
      {champ('b')}
    </div>
  );
}

/**
 * Fichier importé : « Employé concerné » et « Machine concernée », puis l'aperçu réel (image, PDF), sinon un
 * message ; gabarit gris s'il n'y a pas de fichier.
 */
function PapierImport({ doc, detail, readOnly, ouvrir }: {
  doc: DocumentFichier;
  detail: DossierDetail;
  readOnly: boolean;
  ouvrir: { run: () => void; pending: boolean };
}) {
  const [date, setDate] = useDateDocument(doc);
  // Aperçu et bouton décidés par le back d'après le contenu réel du fichier (`apercu`, `ouvrable`) ;
  // `fichierNom` n'est qu'un libellé.
  const d = decisionApercu(doc);
  let contenu;
  if (d.contenu === 'image' && doc.fichierChemin) {
    contenu = <img src={fichierUrl(doc.fichierChemin)} alt={doc.fichierNom ?? doc.nom} style={{ maxWidth: '100%', height: 'auto', alignSelf: 'center' }} />;
  } else if (d.contenu === 'pdf' && doc.fichierChemin) {
    contenu = (
      <iframe src={fichierUrl(doc.fichierChemin)} title={`Aperçu de ${doc.fichierNom ?? doc.nom}`} referrerPolicy="no-referrer"
        style={{ width: '100%', height: 560, border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)' }} />
    );
  } else {
    contenu = (
      <>
        <GabaritGris texte={d.message} />
        {d.ouvrir && (
          <div className="no-print">
            <button type="button" className="btn" disabled={ouvrir.pending} onClick={ouvrir.run}>
              Ouvrir avec l’application par défaut
            </button>
          </div>
        )}
      </>
    );
  }
  return (
    <Papier titre={doc.nom} sousTitre={`${detail.dossier.nom} · ${detail.dossier.theme}`}
      date={<ChampDate value={date} onChange={setDate} readOnly={readOnly} />}>
      <FichesImport doc={doc} detail={detail} readOnly={readOnly} />
      {contenu}
    </Papier>
  );
}

/**
 * Section « Document » : en-tête de l'aperçu (nom, source, actions) et le papier.
 * Le papier est remonté à chaque changement de document (`key`), ce qui envoie la saisie en attente.
 */
export function DocumentVue({ doc, detail, magasin, readOnly, onRenommer, onSupprimer }: {
  doc: DocumentFichier;
  detail: DossierDetail;
  magasin: readonly Classement[];
  readOnly: boolean;
  onRenommer: () => void;
  onSupprimer: () => void;
}) {
  const ouvrir = useAction(() => api.documentOuvrirExterne(doc.id), { invalidate: 'none' });
  const ouvrirExt = { run: () => ouvrir.mutate(), pending: ouvrir.isPending };
  // « Enregistrer une copie… » : sélecteur d'enregistrement natif ouvert par le back (tout type, y compris .bin).
  const exporter = useAction(() => api.documentExporter(doc.id), { invalidate: 'none' });
  const ro = readOnly ? LECTURE_SEULE : undefined;
  return (
    <div className="preview">
      <div className="pv-h" style={{ flexWrap: 'wrap' }}>
        <Icon name="fichier" size={20} />
        <span style={{ minWidth: 0 }}>
          <b style={{ overflowWrap: 'anywhere' }}>{doc.nom}</b>
          <small>{doc.source}{doc.pieceFinale ? ' · Pièce finale' : ''}</small>
        </span>
        <span className="sp" />
        {/* Les actions restent groupées : si elles ne tiennent pas à côté du nom, elles passent ensemble
            à la ligne, alignées à droite (et non une partie à gauche sous l'icône). */}
        <span style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 4, marginLeft: 'auto' }}>
          {doc.origine === 'import' && decisionApercu(doc).ouvrir && (
            <button type="button" className="btn ghost" disabled={ouvrir.isPending} onClick={ouvrirExt.run}>
              Ouvrir avec l’application par défaut
            </button>
          )}
          {doc.origine === 'import' && doc.fichierChemin !== null && (
            <button type="button" className="btn ghost" disabled={exporter.isPending} onClick={() => exporter.mutate()}>
              Enregistrer une copie…
            </button>
          )}
          <button type="button" className="btn ghost" onClick={() => window.print()}>Imprimer</button>
          <button type="button" className="btn ghost" disabled={readOnly} title={ro} onClick={onRenommer}>Renommer</button>
          <button type="button" className="btn ghost" disabled={readOnly} title={ro} onClick={onSupprimer}>Supprimer</button>
        </span>
      </div>
      <div className="pv-b">
        {doc.origine === 'modele' && doc.blocs ? (
          <PapierModele key={doc.id} doc={doc} detail={detail} magasin={magasin} readOnly={readOnly} />
        ) : (
          <PapierImport key={doc.id} doc={doc} detail={detail} readOnly={readOnly} ouvrir={ouvrirExt} />
        )}
      </div>
    </div>
  );
}
