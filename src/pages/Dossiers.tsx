import { Fragment, useState, type ReactNode } from 'react';
import type { DossierResume, StatutDossier } from '../api';
import { plural } from '../lib/format';
import { useDossiers, useStatuts } from '../lib/queries';
import { nomStatut } from '../lib/statuts';
import { nav, type PageProps } from '../nav';
import { Empty, FolderCard, Icon, PageHeader, QueryView, Section, Seg, Select, StatutBadge } from '../ui';
import { Arbre } from './dossiers/Arbre';
import { useDossiersUi, type Regroupement, type VueDossiers } from './dossiers/store';
import { CorbeilleDossier, SupprimerDossierModal } from './dossiers/Suppression';

const trier = (xs: Iterable<string>) => Array.from(new Set(xs)).sort((p, q) => p.localeCompare(q, 'fr'));

/** Ajoute la valeur courante aux options si elle n'y est plus (filtre conservé d'une visite précédente). */
const avecCourant = (opts: string[], cur: string) => (cur === 'tous' || opts.includes(cur) ? opts : [...opts, cur]);

/**
 * États proposés dans le filtre et ordre des groupes : la liste réelle des états (§ 10.1), complétée des états
 * portés par des dossiers mais absents de la liste (liste pas encore lue, par exemple).
 */
function etatsConnus(statuts: readonly StatutDossier[], dossiers: readonly DossierResume[]): StatutDossier[] {
  const out = [...statuts];
  for (const d of dossiers) if (d.statut && !out.some((s) => s.id === d.statut.id)) out.push(d.statut);
  return out;
}

/**
 * Carte d'un dossier avec sa corbeille (§ 15), posée dans le cadre de la carte, en bas à droite : deux boutons frères,
 * le clic sur la corbeille n'ouvre jamais le dossier.
 */
function CarteDossier({ dossier, onSupprimer }: { dossier: DossierResume; onSupprimer: (d: DossierResume) => void }) {
  return (
    <div className="folder-carte">
      <FolderCard dossier={dossier} />
      <CorbeilleDossier onSupprimer={() => onSupprimer(dossier)} />
    </div>
  );
}

function Liste({ dossiers, statuts }: { dossiers: DossierResume[]; statuts: readonly StatutDossier[] }) {
  const f = useDossiersUi();
  const [aSupprimer, setASupprimer] = useState<DossierResume | null>(null);
  const etats = etatsConnus(statuts, dossiers);
  // Un état retenu qui n'existe plus (supprimé depuis) revient à « Tous ».
  const statut = f.statut === 'tous' || etats.some((s) => String(s.id) === f.statut) ? f.statut : 'tous';
  const rows = dossiers.filter((d) =>
    (f.annee === 'tous' || String(d.annee) === f.annee)
    && (f.theme === 'tous' || d.theme === f.theme)
    && (statut === 'tous' || String(d.statut?.id) === statut));
  const years = avecCourant(trier(dossiers.map((d) => String(d.annee))), f.annee);
  const themes = avecCourant(trier(dossiers.map((d) => d.theme)), f.theme);

  let body;
  if (!rows.length) {
    body = <Empty>{dossiers.length ? 'Aucun dossier avec ces filtres.' : 'Aucun dossier pour l’instant. Cliquez sur « Créer un dossier » pour commencer.'}</Empty>;
  } else if (f.view === 'groupes') {
    // Groupes : par ordre alphabétique ; par état, dans l'ordre de la liste des états, chacun avec son badge.
    const groupes: { cle: string; titre: ReactNode; it: DossierResume[] }[] = f.group === 'statut'
      ? etats.map((s) => ({ cle: `s${s.id}`, titre: <StatutBadge statut={s} />, it: rows.filter((d) => d.statut?.id === s.id) }))
        .filter((g) => g.it.length > 0)
      : trier(rows.map((d) => (f.group === 'theme' ? d.theme : f.group === 'annee' ? `Année ${d.annee}` : 'Tous les dossiers')))
        .map((g) => ({
          cle: g,
          titre: g,
          it: rows.filter((d) => (f.group === 'theme' ? d.theme : f.group === 'annee' ? `Année ${d.annee}` : 'Tous les dossiers') === g),
        }));
    body = groupes.map((g) => (
      <Fragment key={g.cle}>
        <p className="group-h">{g.titre} <span className="count">{g.it.length}</span></p>
        <div className="folders">{g.it.map((d) => <CarteDossier key={d.id} dossier={d} onSupprimer={setASupprimer} />)}</div>
      </Fragment>
    ));
  } else {
    body = <Arbre dossiers={rows} onSupprimer={setASupprimer} />;
  }

  return (
    <>
      <Section num="4.1" title="Filtres et classement">
        <div className="fbar">
          <Icon name="filtre" />
          <label>Année <Select value={f.annee} onChange={(annee) => f.set({ annee })} options={[['tous', 'Toutes'], ...years]} /></label>
          <label>Catégorie <Select value={f.theme} onChange={(theme) => f.set({ theme })} options={[['tous', 'Toutes'], ...themes]} /></label>
          <label>
            État{' '}
            <Select<string> value={statut} onChange={(s) => f.set({ statut: s })}
              options={[['tous', 'Tous'], ...etats.map((s): readonly [string, string] => [String(s.id), nomStatut(s)])]} />
          </label>
          <span className="vr" />
          <label>
            Regrouper par{' '}
            <Select<Regroupement> value={f.group} onChange={(group) => f.set({ group })}
              options={[['theme', 'Catégorie'], ['annee', 'Année'], ['statut', 'État'], ['aucun', 'Aucun']]} />
          </label>
          <span className="sp" />
          <span className="cnt num">{plural(rows.length, 'dossier')}</span>
          <Seg<VueDossiers> label="Vue" value={f.view} onChange={(view) => f.set({ view })}
            options={[{ value: 'groupes', label: 'Groupes', icon: 'liste' }, { value: 'arbo', label: 'Arborescence', icon: 'arbo' }]} />
        </div>
      </Section>
      <Section num="4.2" title={f.view === 'groupes' ? 'Dossiers regroupés' : 'Arborescence des dossiers'}>
        {body}
      </Section>
      {aSupprimer && <SupprimerDossierModal dossier={aSupprimer} depuis="liste" onClose={() => setASupprimer(null)} />}
    </>
  );
}

/**
 * Module 4 · Dossiers & Archives : filtres, regroupement, vues Groupes et Arborescence. Chaque dossier porte sa
 * corbeille (§ 15) ; après une suppression, on reste ici et le message « Dossier « … » supprimé. » s'affiche.
 */
export default function Dossiers(_props: PageProps<'dossiers'>) {
  const dossiers = useDossiers();
  const statuts = useStatuts();
  return (
    <>
      <PageHeader title="Dossiers & Archives"
        lead="Tous les dossiers. Filtrez, regroupez, puis ouvrez un dossier en pleine page."
        actions={
          <button type="button" className="btn primary" onClick={() => nav.go({ name: 'form-dossier' })}>
            <Icon name="plus" size={14} />Créer un dossier
          </button>
        } />
      <QueryView query={dossiers}>{(list) => <Liste dossiers={list} statuts={statuts.data ?? []} />}</QueryView>
    </>
  );
}
