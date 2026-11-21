import { create } from 'zustand';
import type { Entite, Kind, TableauDeBord } from '../api';
import { enumeration, manquesEmploye, nomAffiche, plural, texte } from '../lib/format';
import { dossiersOuvertsVide, inventaireVide } from '../lib/tableauVide';
import { useTableauDeBord } from '../lib/queries';
import { couleurDe, nomStatut } from '../lib/statuts';
import { nav, type PageProps, type Route } from '../nav';
import { Badge, Empty, FileRow, Icon, PageHeader, QueryView, Section, Seg, StatutBadge } from '../ui';

/** Répertoire montré dans « Inventaire à compléter » (`S.inv` du prototype), gardé d'une visite à l'autre. */
const useInventaire = create<{ kind: Kind; choisir: (kind: Kind) => void }>()((set) => ({
  kind: 'a',
  choisir: (kind) => set({ kind }),
}));

/** Au-delà, les listes 1.3 et 1.4 renvoient vers la page complète. */
const MAX_LIGNES = 20;

const MOIS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const INITIALES = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

/**
 * Haut de l'échelle verticale : 3 intervalles (les lignes de la grille du prototype), pas « rond » (1, 2, 5 × 10^n),
 * au moins 1 par intervalle. 24 → 30 (comme le prototype), 0 → 3, 140 → 150, 7 → 15.
 */
function hautEchelle(max: number): number {
  const brut = Math.max(max, 1) / 3;
  const p = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= brut) ?? 10 * p;
  return Math.max(1, Math.round(pas)) * 3;
}

const nombre = (n: number) => n.toLocaleString('fr-FR');

function Kpi({ label, value, detail, to, alert }: { label: string; value: number; detail: string; to: Route; alert?: boolean }) {
  return (
    <button type="button" className={alert ? 'kpi att' : 'kpi'} onClick={() => nav.root(to)}>
      <small>{label}{alert && <Icon name="alerte" size={14} />}</small>
      <strong className="num">{nombre(value)}</strong>
      <em>{detail}</em>
    </button>
  );
}

/** 1.1 — Compteurs. */
function Compteurs({ t }: { t: TableauDeBord }) {
  const noA = t.sansCodeA.length;
  const noB = t.sansCodeB.length;
  return (
    <div className="kpis">
      <Kpi label="Employés actifs" value={t.aActives} detail={`sur ${plural(t.aTotal, 'fiche')}`} to={{ name: 'rep', kind: 'a' }} />
      <Kpi label="Machines actives" value={t.bActives} detail={`sur ${plural(t.bTotal, 'fiche')}`} to={{ name: 'rep', kind: 'b' }} />
      <Kpi label="Dossiers ouverts" value={t.dossiersOuverts} detail={`dont ${t.dossiersPiece} en attente de pièce finale`} to={{ name: 'dossiers' }} />
      <Kpi label="Fiches à compléter" value={noA + noB} detail={`${plural(noA, 'employé')} · ${plural(noB, 'machine')}`}
        to={{ name: 'rep', kind: noA === 0 && noB > 0 ? 'b' : 'a', sansCode: true }} alert={noA + noB > 0} />
    </div>
  );
}

/**
 * Répartition des dossiers par état (§ 10.1 : la liste réelle des états, chacun dans sa couleur) : barre empilée +
 * légende. Le nom de chaque état est écrit dans la légende : la couleur n'est jamais seule à informer.
 */
function Repartition({ t }: { t: TableauDeBord }) {
  const lignes: unknown = t.repartition;
  const dist = (Array.isArray(lignes) ? (lignes as TableauDeBord['repartition']) : [])
    .filter((r) => r && r.statut)
    .map((r) => ({
      key: r.statut.id,
      label: nomStatut(r.statut),
      color: `var(--st-${couleurDe(r.statut)})`,
      n: typeof r.nb === 'number' && r.nb > 0 ? r.nb : 0,
    }));
  const total = dist.reduce((s, d) => s + d.n, 0);
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  return (
    <div className="card">
      <h3>Répartition des dossiers par état<span>{plural(total, 'dossier')}</span></h3>
      <div className="stack" role="img"
        aria-label={total ? dist.map((d) => `${d.label} : ${d.n}`).join(', ') : 'Aucun dossier'}>
        {total === 0
          ? <i style={{ flex: 1, background: 'var(--muted)' }} title="Aucun dossier" />
          : dist.filter((d) => d.n > 0).map((d) => (
            <i key={d.key} style={{ flex: d.n, background: d.color }} title={`${d.label} : ${d.n}`} />
          ))}
      </div>
      <ul className="legend">
        {dist.map((d) => (
          <li key={d.key}>
            <i style={{ background: d.color }} />
            {d.label}
            <b className="num">{nombre(d.n)}</b>
            <span className="num">{pct(d.n)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Volume traité par période : documents ajoutés par mois sur l'année en cours. */
function Volume({ t }: { t: TableauDeBord }) {
  const { annee } = t.volume;
  const mois = Array.from({ length: 12 }, (_, i) => t.volume.mois[i] ?? 0);
  const haut = hautEchelle(Math.max(0, ...mois));
  const now = new Date();
  const courant = annee === now.getFullYear() ? now.getMonth() : -1;
  const graduations = [haut, (haut * 2) / 3, haut / 3, 0];
  return (
    <div className="card">
      <h3>Volume traité par période<span>Année {annee}</span></h3>
      <div className="bars" role="img"
        aria-label={`Documents ajoutés par mois en ${annee} : ${mois.map((v, i) => `${MOIS[i].toLowerCase()} ${v}`).join(', ')}`}>
        <div className="y">{graduations.map((g) => <span key={g}>{nombre(g)}</span>)}</div>
        <div className="plot">
          {mois.map((v, i) => (
            <i key={i} className={i === courant ? 'm' : undefined} style={{ height: `${(v / haut) * 100}%` }}
              title={`${MOIS[i]} : ${v}`} />
          ))}
        </div>
        <div className="x">{INITIALES.map((l, i) => <span key={i} title={MOIS[i]}>{l}</span>)}</div>
      </div>
      <ul className="legend" style={{ gridAutoFlow: 'column', justifyContent: 'start', gap: 16 }}>
        <li><i style={{ background: 'var(--vol)' }} />Période terminée</li>
        <li><i style={{ background: 'var(--vol-m)' }} />Période en cours</li>
      </ul>
    </div>
  );
}

/** Sous-titre d'une ligne de l'inventaire : ce qui manque à l'employé, ou ce qu'on sait de la machine. */
function sousTitre(x: Entite): string {
  if (x.kind === 'a') {
    const manques = manquesEmploye({ nom: x.nom, prenom: texte(x.prenom), dateNaissance: x.dateNaissance, poste: texte(x.poste) });
    return manques.length ? `Il manque ${enumeration(manques)}` : x.categorie;
  }
  return [texte(x.marque).trim(), x.categorie].filter(Boolean).join(' · ');
}

/** 1.3 — Inventaire à compléter : employés sans identifiant (fiche incomplète), machines sans identifiant. */
function Inventaire({ t }: { t: TableauDeBord }) {
  const kind = useInventaire((s) => s.kind);
  const choisir = useInventaire((s) => s.choisir);
  const liste = kind === 'a' ? t.sansCodeA : t.sansCodeB;
  return (
    <Section num="1.3" title="Inventaire à compléter"
      extra={
        <Seg<Kind> label="Fiches de l’inventaire" value={kind} onChange={choisir}
          options={[
            { value: 'a', label: 'Employés', count: t.sansCodeA.length },
            { value: 'b', label: 'Machines', count: t.sansCodeB.length },
          ]} />
      }>
      {liste.length ? (
        <div className="files">
          {liste.slice(0, MAX_LIGNES).map((x) => (
            <FileRow key={x.id} icon={x.kind} title={nomAffiche(x)} subtitle={sousTitre(x)} chevron={false}
              trailing={x.kind === 'a'
                ? <><Badge kind="incomplet" /><span className="btn">Compléter</span></>
                : <><Badge kind="noid" /><span className="btn">Saisir</span></>}
              onClick={() => nav.go(x.kind === 'a'
                ? { name: 'form-entite', kind: 'a', id: x.id }
                : { name: 'fiche', id: x.id, focusCode: true })} />
          ))}
          {liste.length > MAX_LIGNES && (
            <button type="button" className="btn" style={{ alignSelf: 'center' }}
              onClick={() => nav.go({ name: 'rep', kind, sansCode: true })}>
              Voir les {liste.length} fiches dans {kind === 'a' ? 'Employés' : 'Machines'}
            </button>
          )}
        </div>
      ) : (
        <Empty>{inventaireVide(kind, kind === 'a' ? t.aTotal : t.bTotal)}</Empty>
      )}
    </Section>
  );
}

/** 1.4 — Dossiers ouverts : tous les dossiers non clôturés, quel que soit leur état (§ 10.1). */
function EnCours({ t }: { t: TableauDeBord }) {
  const liste = t.dossiersEnCours;
  return (
    <Section num="1.4" title="Dossiers ouverts">
      {liste.length ? (
        <div className="files">
          {liste.slice(0, MAX_LIGNES).map((d) => (
            <FileRow key={d.id} icon="dossier" title={d.nom} subtitle={`${d.theme} · Année ${d.annee}`}
              trailing={<StatutBadge statut={d.statut} />} onClick={() => nav.go({ name: 'dossier', id: d.id })} />
          ))}
          {liste.length > MAX_LIGNES && (
            <button type="button" className="btn" style={{ alignSelf: 'center' }} onClick={() => nav.root({ name: 'dossiers' })}>
              Voir les {liste.length} dossiers ouverts dans Dossiers &amp; Archives
            </button>
          )}
        </div>
      ) : (
        <Empty>{dossiersOuvertsVide(t.dossiersTotal)}</Empty>
      )}
    </Section>
  );
}

/** Module 1 · Tableau de bord (sections 1.1 à 1.4). */
export default function Dashboard(_props: PageProps<'dashboard'>) {
  const tableau = useTableauDeBord();
  return (
    <>
      <PageHeader title="Tableau de bord"
        lead="Pilotage global : compteurs, graphiques, inventaire à compléter et dossiers ouverts." />
      <QueryView query={tableau}>
        {(t) => (
          <>
            <Section num="1.1" title="Compteurs"><Compteurs t={t} /></Section>
            <Section num="1.2" title="Graphiques">
              <div className="cols">
                <Repartition t={t} />
                <Volume t={t} />
              </div>
            </Section>
            <div className="cols listes">
              <Inventaire t={t} />
              <EnCours t={t} />
            </div>
          </>
        )}
      </QueryView>
    </>
  );
}
