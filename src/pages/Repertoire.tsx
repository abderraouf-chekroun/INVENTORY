import { useLayoutEffect, useMemo, useState } from 'react';
import type { Entite, Kind } from '../api';
import { categoryLabel, kindLabel, plural } from '../lib/format';
import { useEntites } from '../lib/queries';
import { nav, type PageProps } from '../nav';
import { Chip, Empty, EntityTable, Icon, PageHeader, QueryView, Section, Select } from '../ui';
import { filtrer, useFiltresRepertoire, type StatutFiltre, type TriFiltre } from './repertoire/filtres';

/** Nombre de lignes rendues d'un coup ; « Afficher … fiches de plus » en ajoute autant. */
const PAGE = 200;

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

function Liste({ kind, entites, sansCode }: { kind: Kind; entites: readonly Entite[]; sansCode: boolean }) {
  const f = useFiltresRepertoire((s) => s[kind]);
  const modifier = useFiltresRepertoire((s) => s.modifier);
  const n = kind === 'a' ? 2 : 3;
  const catL = categoryLabel(kind);

  const cats = useMemo(() => [...new Set(entites.map((x) => x.categorie))].sort(collator.compare), [entites]);
  // Une catégorie retenue qui n'existe plus dans la liste (données effacées…) revient à « Tous ».
  const cat = cats.includes(f.cat) ? f.cat : '';
  const rows = useMemo(() => filtrer(entites, f, cat), [entites, f, cat]);

  // Rendu progressif des longues listes : la limite repart à PAGE dès que les filtres changent.
  const sig = JSON.stringify([f, cat]);
  const [lim, setLim] = useState({ sig, n: PAGE });
  const limite = lim.sig === sig ? lim.n : PAGE;
  const visibles = rows.length > limite ? rows.slice(0, limite) : rows;

  const basculerNoid = () => {
    modifier(kind, { noid: !f.noid });
    // L'arrivée « à compléter » (tableau de bord) ne doit pas réimposer le filtre quand on revient sur cette page.
    if (sansCode) nav.update({ name: 'rep', kind });
  };

  return (
    <>
      <Section num={`${n}.1`} title="Filtres et tri">
        <div className="fbar">
          <Icon name="filtre" />
          <label>
            Statut{' '}
            <Select<StatutFiltre> id={`f-${kind}-statut`} value={f.statut} onChange={(statut) => modifier(kind, { statut })}
              options={[['tous', 'Tous'], ['actif', 'Actif'], ['archive', 'Archivé']]} />
          </label>
          <label>
            {catL}{' '}
            <Select<string> id={`f-${kind}-cat`} value={cat} onChange={(c) => modifier(kind, { cat: c })}
              options={[['', 'Toutes'], ...cats.map((c): readonly [string, string] => [c, c])]} />
          </label>
          <Chip pressed={f.noid} onToggle={basculerNoid}>{kind === 'a' ? 'Fiche à compléter' : 'Sans identifiant'}</Chip>
          <span className="vr" />
          <label>
            Trier par{' '}
            <Select<TriFiltre> id={`f-${kind}-sort`} value={f.sort} onChange={(sort) => modifier(kind, { sort })}
              options={[['nom', 'Nom'], ['code', 'Identifiant']]} />
          </label>
          <span className="sp" />
          <span className="cnt num" aria-live="polite">{plural(rows.length, 'fiche')}</span>
          <input className="field" id={`f-${kind}-code`} type="search" value={f.code}
            placeholder={kind === 'a' ? 'Nom, poste ou identifiant…' : 'Nom, marque ou identifiant…'}
            aria-label={kind === 'a' ? 'Rechercher un employé' : 'Rechercher une machine'} style={{ width: 200 }} autoComplete="off"
            onChange={(e) => modifier(kind, { code: e.target.value })} />
        </div>
      </Section>
      <Section num={`${n}.2`} title={kind === 'a' ? 'Liste des employés' : 'Liste des machines'}>
        {entites.length === 0 ? (
          <Empty>
            {kind === 'a'
              ? 'Aucun employé pour l’instant. Créez le premier avec « Créer un employé ».'
              : 'Aucune machine pour l’instant. Créez la première avec « Créer une machine ».'}
          </Empty>
        ) : (
          <EntityTable kind={kind} entites={visibles} label={kind === 'a' ? 'Liste des employés' : 'Liste des machines'} />
        )}
        {rows.length > visibles.length && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="num" style={{ fontSize: 12, color: 'var(--fg3)' }}>
              {visibles.length} sur {plural(rows.length, 'fiche')} affichées
            </span>
            <button type="button" className="btn" onClick={() => setLim({ sig, n: limite + PAGE })}>
              Afficher {plural(Math.min(PAGE, rows.length - visibles.length), 'fiche')} de plus
            </button>
          </div>
        )}
      </Section>
    </>
  );
}

/** Modules 2 et 3 · Employés / Machines : filtres, tri, tableau ; un clic sur une ligne ouvre la fiche. */
export default function Repertoire({ route }: PageProps<'rep'>) {
  const { kind } = route;
  const entites = useEntites(kind);
  const modifier = useFiltresRepertoire((s) => s.modifier);

  // `route.sansCode` (compteur « Fiches à compléter ») impose le filtre à l'arrivée, avant le premier affichage.
  // À l'arrivée seulement : la page est remontée à chaque navigation.
  const arriveeSansCode = route.sansCode === true;
  useLayoutEffect(() => {
    if (arriveeSansCode) modifier(kind, { noid: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageHeader title={kindLabel(kind, true)}
        lead={kind === 'a'
          ? 'Tous les employés du centre. Un clic sur une ligne ouvre la fiche en pleine page.'
          : 'Tous les PC et ordinateurs portables. Un clic sur une ligne ouvre la fiche en pleine page.'}
        actions={
          <button type="button" className="btn primary" onClick={() => nav.go({ name: 'form-entite', kind })}>
            <Icon name="plus" size={14} />{kind === 'a' ? 'Créer un employé' : 'Créer une machine'}
          </button>
        } />
      <QueryView query={entites}>
        {(liste) => <Liste kind={kind} entites={liste} sansCode={route.sansCode === true} />}
      </QueryView>
    </>
  );
}
