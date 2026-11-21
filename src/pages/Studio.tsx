import { useId, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Classement, type Modele } from '../api';
import { useAction } from '../lib/action';
import { modeleApresSuppression, motifSuppressionModele, nbDocumentsDe, nbDocumentsLabel } from '../lib/modeles';
import { useMagasin, useModeles, useThemes } from '../lib/queries';
import { nav, type PageProps } from '../nav';
import { ConfirmModal, Empty, Icon, PageHeader, QueryView, Section } from '../ui';
import { flushAll } from './blocs/autosave';
import { SansCategorie } from './categories/SansCategorie';
import { Editeur } from './studio/Editeur';

/**
 * « Supprimer le modèle » (§ 11.4) : possible seulement si aucun document n'a été créé à partir de lui. Sinon le
 * bouton reste atteignable au clavier (aria-disabled), annonce le motif et l'affiche quand on l'actionne, comme les
 * suppressions de Paramètres.
 */
function SupprimerModele({ modele, busy, onSupprimer }: { modele: Modele; busy: boolean; onSupprimer: () => void }) {
  const motifId = useId();
  const [motifVu, setMotifVu] = useState(false);
  const n = nbDocumentsDe(modele);
  const motif = motifSuppressionModele(n);
  return (
    <>
      <button type="button" className={motif ? 'btn indispo' : 'btn'} disabled={busy}
        aria-disabled={motif ? true : undefined} aria-expanded={motif ? motifVu : undefined}
        aria-describedby={motif ? motifId : undefined} title={motif ?? undefined}
        onClick={() => (motif ? setMotifVu((v) => !v) : onSupprimer())}>
        Supprimer
      </button>
      <span className="studio-nbdocs">
        {n > 0 ? `${nbDocumentsLabel(n)} créé${n > 1 ? 's' : ''} à partir de ce modèle` : 'Aucun document créé à partir de ce modèle'}
      </span>
      {motif && <span className="sr-only" id={motifId}>{motif}</span>}
      {motif && motifVu && (
        <p className="cl-motif" role="status">
          <Icon name="info" size={14} />
          <span><b>Suppression impossible.</b> {motif}</span>
        </p>
      )}
    </>
  );
}

function StudioVue({ modeles, modeleId, themes, themesLus, magasin }: {
  modeles: Modele[];
  modeleId: number | undefined;
  themes: readonly Classement[];
  /** Vrai une fois les catégories lues (le bandeau « Aucune catégorie » n'apparaît qu'alors). */
  themesLus: boolean;
  magasin: readonly Classement[];
}) {
  const m = modeles.find((x) => x.id === modeleId) ?? modeles[0];
  const choisir = (id: number | undefined) => nav.update({ name: 'studio', modeleId: id });

  // Toute modification en attente part avant d'agir sur un modèle (une copie doit inclure la dernière saisie).
  const creer = useAction(async () => {
    await flushAll();
    return api.modeleCreer();
  }, { onSuccess: (x) => choisir(x.id) });
  const dupliquer = useAction(async (id: number) => {
    await flushAll();
    return api.modeleDupliquer(id);
  }, { onSuccess: (x) => choisir(x.id) });
  const basculer = useAction(async (id: number) => {
    await flushAll();
    return api.modeleBasculer(id);
  });
  // « Restaurer les modèles standards » : recrée ceux qui manquent, sans toucher aux modèles existants.
  const [restaures, setRestaures] = useState<string | null>(null);
  const restaurer = useAction(async () => {
    await flushAll();
    return api.modelesStandardsRestaurer();
  }, {
    onSuccess: (xs) => {
      setRestaures(xs.length === 0
        ? 'Les modèles standards sont déjà tous présents. Rien n’a été modifié.'
        : `${xs.length > 1 ? `${xs.length} modèles recréés` : '1 modèle recréé'} : ${xs.map((x) => x.nom).join(', ')}.`);
      if (xs[0]) choisir(xs[0].id);
    },
  });
  const [aSupprimer, setASupprimer] = useState<Modele | null>(null);
  const qc = useQueryClient();
  const busy = creer.isPending || dupliquer.isPending || basculer.isPending || restaurer.isPending;

  return (
    <div className="studio">
      <Section num="5.4" title="Modèles">
        {/* § 16 : sans catégorie active, « Nouveau modèle » serait refusé : la catégorie se crée ici. */}
        {themesLus && !themes.some((t) => t.actif) && <SansCategorie pour="modele" archivees={themes.length} />}
        <div className="mlist">
          {modeles.map((x) => (
            <button key={x.id} type="button" className="mitem" aria-pressed={x.id === m?.id} onClick={() => choisir(x.id)}>
              <b>{x.nom}</b>
              <small>{x.theme}<span>{x.standard === true ? 'Standard · ' : ''}{x.actif ? 'Actif' : 'Archivé'}</span></small>
              <small>{nbDocumentsLabel(nbDocumentsDe(x))}</small>
            </button>
          ))}
          <button type="button" className="btn" disabled={busy} onClick={() => creer.mutate()}>
            <Icon name="plus" size={14} />Nouveau modèle
          </button>
          <button type="button" className="btn" disabled={busy} onClick={() => { setRestaures(null); restaurer.mutate(); }}
            title="Recrée sous leur nom, à neuf, les formulaires fournis avec l’application qui ne sont plus proposés (archivés, renommés, effacés ou supprimés). Vos modèles ne sont pas modifiés.">
            <Icon name="restaurer" size={14} />Restaurer les modèles standards
          </button>
          <p className="studio-note" role="status">{restaures}</p>
        </div>
      </Section>
      {m ? (
        <Editeur key={m.id} modele={m} themes={themes} magasin={magasin}
          actions={
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => dupliquer.mutate(m.id)}>Dupliquer</button>
              <button type="button" className="btn" disabled={busy} onClick={() => basculer.mutate(m.id)}>{m.actif ? 'Archiver' : 'Réactiver'}</button>
              <button type="button" className="btn ghost" onClick={() => nav.go({ name: 'magasin' })}>Gérer le Magasin</button>
              <SupprimerModele key={m.id} modele={m} busy={busy} onSupprimer={() => setASupprimer(m)} />
            </>
          } />
      ) : (
        <Section num="5.5" title="Éditeur par blocs">
          <Empty>Aucun modèle pour l’instant. Cliquez sur « Restaurer les modèles standards » pour retrouver les formulaires fournis, ou sur « Nouveau modèle » pour composer le vôtre.</Empty>
        </Section>
      )}
      {aSupprimer && (
        <ConfirmModal title="Supprimer le modèle ?" confirmLabel="Supprimer le modèle"
          message={`Le modèle « ${aSupprimer.nom} » sera définitivement supprimé. Aucun document n’a été créé à partir de lui.${aSupprimer.standard === true ? ' « Restaurer les modèles standards » pourra le recréer.' : ''} Cette action est irréversible.`}
          action={async () => {
            await flushAll();
            await api.modeleSupprimer(aSupprimer.id);
          }}
          // Le Studio passe d'abord au modèle voisin (ou à l'état vide), puis relit tout : le modèle supprimé n'est
          // jamais remplacé, le temps d'un affichage, par le premier de la liste.
          invalidate="none"
          onDone={() => {
            choisir(modeleApresSuppression(modeles, aSupprimer.id));
            void qc.invalidateQueries();
          }}
          onClose={() => setASupprimer(null)} />
      )}
    </div>
  );
}

/** Module 5 · Studio de Modèles (sections 5.4 à 5.6). */
export default function Studio({ route }: PageProps<'studio'>) {
  const modeles = useModeles();
  const themes = useThemes();
  const magasin = useMagasin();
  return (
    <>
      <PageHeader eyebrow="Studio de Modèles" title="Modèles de document"
        lead="Les formulaires standards sont prêts à remplir. Composez aussi vos propres modèles avec des champs personnalisés : l’aperçu se met à jour à chaque modification." />
      <QueryView query={modeles}>
        {(list) => <StudioVue modeles={list} modeleId={route.modeleId} themes={themes.data ?? []} themesLus={themes.data !== undefined}
          magasin={magasin.data ?? []} />}
      </QueryView>
    </>
  );
}
