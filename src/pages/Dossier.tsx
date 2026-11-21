import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api, versApiError, type Classement, type DocumentFichier, type DossierDetail, type StatutDossier, type SousDossier,
} from '../api';
import { useAction } from '../lib/action';
import { PAS_LISTE } from '../lib/borne';
import { formatDate, plural } from '../lib/format';
import { useDossier, useMagasin, useStatuts, useThemes } from '../lib/queries';
import { classeCouleur, estClos, etatsOuverts, motifClotureImpossible, nomStatut, roleDe, statutDeRole } from '../lib/statuts';
import { LECTURE_SEULE, NOM_CORBEILLE_DOSSIER } from '../lib/suppression';
import { nav, useBreadcrumb, type Crumb, type PageProps, type RouteOf } from '../nav';
import {
  Alert, ConfirmModal, Empty, FileRow, Icon, PageHeader, PlusDElements, QueryView, RenameModal, Section, StatutBadge, UNITES, useBorne,
} from '../ui';
import { flushAll } from './blocs/autosave';
import { AjouterModal } from './dossier/AjouterModal';
import { chemin, compteurDocuments, documentsDe, lieuAffiche, nbDocuments, sousDossiersDe, type Emplacement } from './dossier/arbre';
import { DocumentVue } from './dossier/DocumentVue';
import { Options } from './dossier/Options';
import { ConfirmerSuppressionDocument, CorbeilleDocument } from './dossier/SuppressionDocument';
import { DossierSupprimePage, SupprimerDossierModal } from './dossiers/Suppression';

type RouteDossier = RouteOf<'dossier'>;

/** Fil d'Ariane : le dossier puis les sous-dossiers jusqu'à l'emplacement courant. */
function crumbsOf(d: DossierDetail | undefined, route: RouteDossier): Crumb[] | null {
  if (!d) return null;
  const id = d.dossier.id;
  const path = chemin(d, lieuAffiche(d, route)) ?? [];
  return [
    { label: d.dossier.nom, to: { name: 'dossier', id } },
    ...path.map((s): Crumb => ({ label: s.nom, to: { name: 'dossier', id, sousDossierId: s.id } })),
  ];
}

type Fenetre =
  | { t: 'ajouter'; pieceFinale: boolean }
  | { t: 'renommer-dossier' }
  | { t: 'renommer-sous'; s: SousDossier }
  | { t: 'supprimer-sous'; s: SousDossier }
  | { t: 'renommer-doc'; doc: DocumentFichier }
  | { t: 'supprimer-doc'; doc: DocumentFichier }
  | { t: 'supprimer-dossier' };

/**
 * État du dossier dans l'en-tête (§ 10.1) : la liste des états ouverts (on passe librement de l'un à l'autre), avec
 * une pastille de la couleur de l'état choisi (son nom est écrit dans la liste), puis « Clôturer le dossier »,
 * indisponible en « Pièce manquante », avec son explication. Dossier clôturé : son badge et « Rouvrir le dossier ».
 */
function EtatDossier({ detail, statuts, motifId, motifVu, setMotifVu }: {
  detail: DossierDetail;
  statuts: readonly StatutDossier[];
  /** Le motif d'une clôture indisponible est affiché sous l'en-tête, par la page. */
  motifId: string;
  motifVu: boolean;
  setMotifVu: (f: (v: boolean) => boolean) => void;
}) {
  const d = detail.dossier;
  const id = useId();
  // Toute saisie en attente part avant un changement d'état (un dossier clôturé refuse l'écriture).
  const changer = useAction(async (statutId: number) => {
    await flushAll();
    return api.dossierDefinirStatut(d.id, statutId);
  });
  // La liste peut ne pas encore être lue : l'état actuel est toujours proposé.
  const ouverts = etatsOuverts(statuts.some((s) => s.id === d.statut.id) ? statuts : [d.statut, ...statuts]);
  const clos = statutDeRole(statuts, 'clos');
  const cours = statutDeRole(statuts, 'cours');

  if (estClos(d.statut)) {
    return (
      <>
        <StatutBadge statut={d.statut} />
        <button type="button" className="btn" disabled={changer.isPending || !cours} onClick={() => cours && changer.mutate(cours.id)}>
          Rouvrir le dossier
        </button>
      </>
    );
  }

  const motif = motifClotureImpossible(d.statut);
  return (
    <>
      <label className="etat-choix" htmlFor={id}>
        <span>État</span>
        <span className="etat-select">
          <span className={`etat-pastille ${classeCouleur(d.statut.couleur)}`} aria-hidden="true" />
          <select className="field" id={id} value={String(d.statut.id)} disabled={changer.isPending}
            onChange={(e) => changer.mutate(Number(e.target.value))}>
            {ouverts.map((s) => <option key={s.id} value={String(s.id)}>{nomStatut(s)}</option>)}
          </select>
        </span>
      </label>
      {/* Clôture indisponible : le bouton reste atteignable au clavier (aria-disabled), annonce le motif et
          l'affiche sous l'en-tête quand on l'actionne. */}
      <button type="button" className={motif ? 'btn indispo' : 'btn'} disabled={changer.isPending || !clos}
        aria-disabled={motif ? true : undefined} aria-describedby={motif ? motifId : undefined} title={motif ?? undefined}
        aria-expanded={motif ? motifVu : undefined}
        onClick={() => (motif ? setMotifVu((v) => !v) : clos && changer.mutate(clos.id))}>
        Clôturer le dossier
      </button>
      {motif && <span className="sr-only" id={motifId}>{motif}</span>}
    </>
  );
}

/**
 * § 16 : catégorie du dossier dans l'en-tête, à la racine du dossier : la liste des catégories actives (plus la
 * catégorie actuelle si elle est archivée). Dossier clôturé : la liste reste visible mais indisponible.
 */
function CategorieDossier({ detail, themes, readOnly }: {
  detail: DossierDetail;
  themes: readonly Classement[];
  readOnly: boolean;
}) {
  const d = detail.dossier;
  const id = useId();
  // Toute saisie en attente part avant le changement.
  const changer = useAction(async (themeId: number) => {
    await flushAll();
    return api.dossierDefinirTheme(d.id, themeId);
  });
  // La liste peut ne pas encore être lue : la catégorie actuelle est toujours proposée.
  const actuelle = themes.find((t) => t.id === d.themeId) ?? { id: d.themeId, nom: d.theme, actif: true };
  const proposees = [actuelle, ...themes.filter((t) => t.actif && t.id !== d.themeId)]
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' }));
  return (
    <label className="etat-choix categorie-select" htmlFor={id}>
      <span>Catégorie</span>
      <select className="field" id={id} value={String(d.themeId)} disabled={readOnly || changer.isPending}
        title={readOnly ? LECTURE_SEULE : undefined}
        onChange={(e) => changer.mutate(Number(e.target.value))}>
        {proposees.map((t) => <option key={t.id} value={String(t.id)}>{t.actif ? t.nom : `${t.nom} (archivée)`}</option>)}
      </select>
    </label>
  );
}

function DossierVue({ detail, route }: { detail: DossierDetail; route: RouteDossier }) {
  const d = detail.dossier;
  const lieu: Emplacement = lieuAffiche(detail, route);
  const path = chemin(detail, lieu);
  const [fenetre, setFenetre] = useState<Fenetre | null>(null);
  const magasin = useMagasin();
  const statuts = useStatuts();
  const themes = useThemes();
  const motifId = useId();
  const [motifVu, setMotifVu] = useState(false);
  const motifCloture = motifClotureImpossible(d.statut);
  // Après la suppression d'un sous-dossier : on quitte d'abord l'emplacement supprimé, puis on relit tout
  // (sinon il s'afficherait « introuvable » un instant).
  const qc = useQueryClient();

  const readOnly = estClos(d.statut);
  const ro = readOnly ? LECTURE_SEULE : undefined;
  const isRoot = lieu === null;
  const sous = sousDossiersDe(detail, lieu);
  const docs = documentsDe(detail, lieu);
  // Rendu borné (lib/borne.ts) : des milliers de sous-dossiers ou de fichiers ne gèlent pas l'interface.
  const sousBorne = useBorne(sous, PAS_LISTE);
  const docsBorne = useBorne(docs, PAS_LISTE);

  if (path === null) {
    return (
      <>
        <PageHeader eyebrow="Dossier ouvert" title={d.nom} lead={`${d.theme} · Année ${d.annee}`} />
        <Alert tone="info" title="Sous-dossier introuvable" text="Ce sous-dossier n’existe plus. Il a peut-être été supprimé.">
          <button type="button" className="btn" onClick={() => nav.replace({ name: 'dossier', id: d.id })}>Ouvrir le dossier</button>
        </Alert>
      </>
    );
  }

  const courant = path.length ? path[path.length - 1] : null;
  const doc = docs.find((f) => f.id === route.documentId) ?? docs[0];
  const nbDocs = compteurDocuments(detail);
  const okN = detail.options.filter((o) => o.ok).length;

  const contenu = (
    <Section num="4.3" title="Contenu du dossier"
      extra={<span className="cnt">{plural(sous.length, 'dossier')} · {plural(docs.length, 'fichier')}</span>}>
      <div className="folders">
        <button type="button" className="folder add" disabled={readOnly} title={ro} style={readOnly ? { cursor: 'default', opacity: 0.6 } : undefined}
          onClick={() => setFenetre({ t: 'ajouter', pieceFinale: false })}>
          <span className="plus"><Icon name="plus" size={36} /></span>
          <b>Ajouter</b>
          <small>{readOnly ? LECTURE_SEULE : 'Un dossier ou un fichier'}</small>
        </button>
        {sousBorne.visibles.map((s) => {
          const n = sousDossiersDe(detail, s.id).length;
          return (
            <button key={s.id} type="button" className="folder sub" onClick={() => nav.go({ name: 'dossier', id: d.id, sousDossierId: s.id })}>
              <span className="top"><span className="fic"><Icon name="dossier" size={28} /></span></span>
              <span>
                <b>{s.nom}</b>
                <small>{plural(nbDocs(s.id), 'fichier')}{n ? ` · ${plural(n, 'dossier')}` : ''}</small>
              </span>
            </button>
          );
        })}
      </div>
      <PlusDElements masques={sousBorne.masques} pas={PAS_LISTE} unite={UNITES.dossiers} onPlus={sousBorne.plus} />
      {docs.length ? (
        <div className="files">
          {docsBorne.visibles.map((f) => (
            // § 13.1 : corbeille sur chaque ligne, à côté du bouton qui ouvre le document (pas dedans).
            <div key={f.id} className="file-ligne">
              <FileRow icon="fichier" iconSize={22} title={f.nom} subtitle={`${f.source} · ${formatDate(f.dateDoc)}`}
                pressed={doc?.id === f.id} onClick={() => nav.update({ ...route, sousDossierId: lieu, documentId: f.id })} />
              <CorbeilleDocument clos={readOnly} onSupprimer={() => setFenetre({ t: 'supprimer-doc', doc: f })} />
            </div>
          ))}
          <PlusDElements masques={docsBorne.masques} pas={PAS_LISTE} unite={UNITES.documents} onPlus={docsBorne.plus} />
        </div>
      ) : (
        <Empty>Aucun fichier ici pour l’instant. Cliquez sur le grand « + » pour en ajouter un.</Empty>
      )}
    </Section>
  );

  return (
    <>
      <PageHeader
        eyebrow="Dossier ouvert"
        title={courant ? courant.nom : d.nom}
        lead={`${d.theme} · Année ${d.annee}${isRoot ? '' : ` · dans ${d.nom}`}`}
        actions={
          <>
            {!courant && <CategorieDossier detail={detail} themes={themes.data ?? []} readOnly={readOnly} />}
            <EtatDossier detail={detail} statuts={statuts.data ?? []} motifId={motifId} motifVu={motifVu} setMotifVu={setMotifVu} />
            <button type="button" className="btn ghost" disabled={readOnly} title={ro}
              onClick={() => setFenetre(courant ? { t: 'renommer-sous', s: courant } : { t: 'renommer-dossier' })}>
              Renommer
            </button>
            {courant && (
              <button type="button" className="btn ghost" disabled={readOnly} title={ro}
                onClick={() => setFenetre({ t: 'supprimer-sous', s: courant })}>
                Supprimer
              </button>
            )}
            {/* § 15 : à la racine du dossier (dans un sous-dossier, « Supprimer » vise le sous-dossier), quel que soit
                son état, clôturé compris. */}
            {!courant && (
              <button type="button" className="btn danger" onClick={() => setFenetre({ t: 'supprimer-dossier' })}>
                {NOM_CORBEILLE_DOSSIER}
              </button>
            )}
          </>
        }
      />
      {motifCloture && motifVu && (
        <p className="cl-motif etat-motif" role="status">
          <Icon name="info" size={14} />
          <span><b>Clôture impossible.</b> {motifCloture}</span>
        </p>
      )}
      {roleDe(d.statut) === 'piece' && (
        <Alert tone="warn" title="Pièce finale manquante"
          text="Ce dossier ne peut pas être clôturé tant qu’il est en « Pièce manquante ». Ajoutez la pièce finale : il repassera « En cours ».">
          <button type="button" className="btn" onClick={() => setFenetre({ t: 'ajouter', pieceFinale: true })}>Ajouter la pièce finale</button>
        </Alert>
      )}
      {readOnly && (
        <Alert tone="info" title="Dossier clôturé" text={`${LECTURE_SEULE} Le contenu reste consultable et imprimable.`} />
      )}
      <div className="split">
        <div style={{ display: 'grid', gap: 28 }}>
          {contenu}
          {isRoot && (
            <Section num="4.4" title="Options à cocher" extra={<span className="cnt">{okN} sur {detail.options.length} cochées</span>}>
              <Options detail={detail} readOnly={readOnly} />
            </Section>
          )}
        </div>
        <Section num={isRoot ? '4.5' : '4.4'} title="Document">
          {doc ? (
            <DocumentVue doc={doc} detail={detail} magasin={magasin.data ?? []} readOnly={readOnly}
              onRenommer={() => setFenetre({ t: 'renommer-doc', doc })}
              onSupprimer={() => setFenetre({ t: 'supprimer-doc', doc })} />
          ) : (
            <Empty>Sélectionnez ou ajoutez un fichier pour l’afficher ici.</Empty>
          )}
        </Section>
      </div>

      {fenetre?.t === 'ajouter' && (
        <AjouterModal dossierId={d.id} lieu={lieu} pieceFinale={fenetre.pieceFinale} onClose={() => setFenetre(null)}
          onDocument={(f) => nav.update({ ...route, sousDossierId: lieu, documentId: f.id })} />
      )}
      {fenetre?.t === 'renommer-dossier' && (
        <RenameModal title="Renommer le dossier" label="Nom du dossier" initial={d.nom}
          action={(nom) => api.dossierRenommer(d.id, nom)} onClose={() => setFenetre(null)} />
      )}
      {fenetre?.t === 'renommer-sous' && (
        <RenameModal title="Renommer le sous-dossier" label="Nom du dossier" initial={fenetre.s.nom}
          action={(nom) => api.sousDossierRenommer(fenetre.s.id, nom)} onClose={() => setFenetre(null)} />
      )}
      {fenetre?.t === 'supprimer-sous' && (
        <ConfirmModal title="Supprimer le sous-dossier ?" confirmLabel="Supprimer le sous-dossier"
          message={`« ${fenetre.s.nom} » sera supprimé avec tout son contenu (${plural(nbDocuments(detail, fenetre.s.id), 'fichier')}, sous-dossiers compris). Cette action est irréversible.`}
          action={async () => {
            await flushAll();
            await api.sousDossierSupprimer(fenetre.s.id);
          }}
          invalidate="none"
          onDone={() => {
            nav.replace({ name: 'dossier', id: d.id, sousDossierId: fenetre.s.parentId });
            void qc.invalidateQueries();
          }}
          onClose={() => setFenetre(null)} />
      )}
      {fenetre?.t === 'renommer-doc' && (
        <RenameModal title="Renommer le document" label="Nom du document" initial={fenetre.doc.nom}
          action={async (nom) => {
            await flushAll();
            await api.documentRenommer(fenetre.doc.id, nom);
          }}
          onClose={() => setFenetre(null)} />
      )}
      {fenetre?.t === 'supprimer-doc' && (
        // Même confirmation depuis la ligne (corbeille) et depuis le document ouvert. Le document affiché ne change
        // que si c'est lui qui est supprimé.
        <ConfirmerSuppressionDocument doc={fenetre.doc} dossierNom={d.nom}
          onDone={() => {
            if (doc?.id === fenetre.doc.id || route.documentId === fenetre.doc.id) {
              nav.update({ ...route, sousDossierId: lieu, documentId: undefined });
            }
          }}
          onClose={() => setFenetre(null)} />
      )}
      {fenetre?.t === 'supprimer-dossier' && (
        <SupprimerDossierModal dossier={d} depuis="dossier" onClose={() => setFenetre(null)} />
      )}
    </>
  );
}

/**
 * Module 4 · Dossier ouvert : état, contenu, grand « + », options à cocher, document. Un dossier n'est rattaché à
 * aucun employé ni aucune machine (§ 11.1) : ils sont nommés dans ses documents.
 * § 15 : un dossier qui n'existe plus (supprimé) n'est pas une erreur : page « Ce dossier a été supprimé. ».
 */
export default function Dossier({ route }: PageProps<'dossier'>) {
  const dossier = useDossier(route.id);
  const supprime = dossier.isError && versApiError(dossier.error).code === 'introuvable';
  useBreadcrumb(supprime ? [{ label: 'Dossier supprimé' }] : crumbsOf(dossier.data, route));
  if (supprime) return <DossierSupprimePage />;
  return <QueryView query={dossier}>{(detail) => <DossierVue detail={detail} route={route} />}</QueryView>;
}
