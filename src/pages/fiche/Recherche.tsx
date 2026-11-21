import { useId, useMemo, useState, type ReactNode } from 'react';
import type { DocumentLie, DossierResume, Evenement, Kind } from '../../api';
import { PAS_LISTE } from '../../lib/borne';
import { champsDe, faconsDe, libelleChamps, libelleFacon, libelleNomination, modeleNomDe, resumeParModele } from '../../lib/citations';
import { basculerModele, compteAffiches, filtrerDocuments, filtrerEvenements } from '../../lib/filtrage';
import { formatDate, texte } from '../../lib/format';
import { estClos } from '../../lib/statuts';
import { nav } from '../../nav';
import { Chip, Empty, FileRow, Icon, PlusDElements, Timeline, UNITES, useBorne } from '../../ui';
import { ConfirmerSuppressionDocument, CorbeilleDocument } from '../dossier/SuppressionDocument';

/*
 * Recherche dans un profil (§ 11.3) : documents où la fiche est nommée, et chaque onglet d'historique.
 * Le filtrage est fait ici, sur les données déjà chargées ; les listes restent bornées par paquets.
 */

/** Champ de recherche d'un profil : facultatif (pas d'étoile), filtre en direct ce qui est affiché. */
function ChampRecherche({ label, placeholder, value, onChange }: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (q: string) => void;
}) {
  const id = useId();
  return (
    <span className="recherche-profil">
      <Icon name="search" size={14} />
      <input className="field" id={id} type="search" autoComplete="off" spellCheck={false} aria-label={label}
        placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}

/** Barre au-dessus d'une liste filtrable : recherche, « N sur M », et « Tout réafficher » quand un filtre est actif. */
function BarreRecherche({ children, compte, filtre, onToutAfficher }: {
  children: ReactNode;
  compte: string;
  filtre: boolean;
  onToutAfficher: () => void;
}) {
  return (
    <div className="recherche-barre">
      {children}
      <span className="cnt num" role="status">{compte}</span>
      {filtre && (
        <button type="button" className="btn ghost" onClick={onToutAfficher}>
          <Icon name="close" size={14} />Tout réafficher
        </button>
      )}
    </div>
  );
}

/** « à « intervention » », « dans les modèles choisis »… : ce qui filtre, pour l'état vide. */
function filtreEnMots(q: string, nbModeles: number): string {
  const parts: string[] = [];
  if (q.trim()) parts.push(`à « ${q.trim()} »`);
  if (nbModeles > 0) parts.push(nbModeles > 1 ? 'dans les modèles choisis' : 'dans le modèle choisi');
  return parts.join(' ');
}

/**
 * Documents où la fiche est nommée (§ 11.2, § 11.3) : recherche (nom, modèle, dossier, champ, date), étiquettes par
 * modèle qui filtrent (cumulables entre elles et avec la recherche), compte « N sur M », état vide. Pour chaque
 * document : son modèle, son nom, son dossier, sa date, le ou les champs où la fiche est nommée, le moment de la
 * nomination et la façon. Un clic ouvre le document dans son dossier.
 */
export function DocumentsNommes({ kind, documents, dossiers }: {
  kind: Kind;
  documents: readonly DocumentLie[];
  /** Dossiers liés de la fiche (avec leur état) : un document d'un dossier clôturé ne se supprime pas (§ 13.1). */
  dossiers: readonly DossierResume[];
}) {
  const [q, setQ] = useState('');
  const [choisis, setChoisis] = useState<ReadonlySet<string>>(new Set());
  const [aSupprimer, setASupprimer] = useState<DocumentLie | null>(null);
  const clos = useMemo(() => new Set(dossiers.filter((d) => estClos(d.statut)).map((d) => d.id)), [dossiers]);
  const resume = useMemo(() => resumeParModele(documents), [documents]);
  // Un modèle retenu qui n'a plus de document (données relues) ne filtre plus rien.
  const modeles = useMemo(() => new Set([...choisis].filter((m) => resume.some((r) => r.nom === m))), [choisis, resume]);
  const affiches = useMemo(() => filtrerDocuments(documents, q, modeles), [documents, q, modeles]);
  const borne = useBorne(affiches, PAS_LISTE);
  const filtre = q.trim() !== '' || modeles.size > 0;
  const toutAfficher = () => {
    setQ('');
    setChoisis(new Set());
  };

  if (documents.length === 0) {
    return (
      <Empty>
        {kind === 'a'
          ? 'Cet employé n’est nommé dans aucun document pour l’instant.'
          : 'Cette machine n’est nommée dans aucun document pour l’instant.'}
      </Empty>
    );
  }
  return (
    <>
      <BarreRecherche compte={compteAffiches(affiches.length, documents.length, UNITES.documents)} filtre={filtre} onToutAfficher={toutAfficher}>
        <ChampRecherche label="Rechercher dans les documents" value={q} onChange={setQ}
          placeholder="Document, modèle, dossier, champ ou date (JJ/MM/AAAA)…" />
      </BarreRecherche>
      <div className="filtres-modeles" role="group" aria-label="Filtrer par modèle de document">
        <span className="filtres-lib" aria-hidden="true">Modèles :</span>
        <Chip pressed={modeles.size === 0} onToggle={() => setChoisis(new Set())}>Tous les modèles</Chip>
        {resume.map((r) => (
          <Chip key={r.nom} pressed={modeles.has(r.nom)} onToggle={() => setChoisis(basculerModele(modeles, r.nom))}>
            {`${r.nom} `}<span className="count">{r.n}</span><span className="sr-only">{r.n > 1 ? ' documents' : ' document'}</span>
          </Chip>
        ))}
      </div>
      {affiches.length === 0 ? (
        <div className="empty filtre-vide">
          <p>Aucun document ne correspond {filtreEnMots(q, modeles.size)}.</p>
          <button type="button" className="btn" onClick={toutAfficher}>Tout réafficher</button>
        </div>
      ) : (
        <div className="files">
          {borne.visibles.map((d) => {
            const nomination = [libelleChamps(champsDe(d)), libelleNomination(kind, d.depuis)].filter(Boolean).join(' · ');
            return (
              // § 13.1 : corbeille sur chaque ligne, à côté du bouton qui ouvre le document (pas dedans).
              <div key={d.id} className="file-ligne">
                <FileRow icon="fichier"
                  title={modeleNomDe(d)}
                  subtitle={(
                    <>
                      {d.nom} · {texte(d.dossierNom) || 'Dossier'} · {formatDate(d.dateDoc)}
                      {nomination && <span className="doc-nomme">{nomination}</span>}
                    </>
                  )}
                  trailing={(
                    <span className="facons">
                      {faconsDe(d.facons).map((x) => <span key={x} className={`facon ${x}`}>{libelleFacon(x, kind)}</span>)}
                    </span>
                  )}
                  onClick={() => nav.go({ name: 'dossier', id: d.dossierId, sousDossierId: d.sousDossierId, documentId: d.id })} />
                <CorbeilleDocument clos={clos.has(d.dossierId)} onSupprimer={() => setASupprimer(d)} />
              </div>
            );
          })}
          <PlusDElements masques={borne.masques} pas={PAS_LISTE} unite={UNITES.documents} onPlus={borne.plus} />
        </div>
      )}
      {/* Après la suppression, la fiche est relue : liste, compteur « N sur M » et historique à jour. */}
      {aSupprimer && (
        <ConfirmerSuppressionDocument doc={aSupprimer} dossierNom={texte(aSupprimer.dossierNom)} onClose={() => setASupprimer(null)} />
      )}
    </>
  );
}

/**
 * Onglet d'historique d'une fiche avec son champ de recherche (§ 11.3) : titre, détail et date des événements.
 * Les liens de la frise restent cliquables ; la liste reste bornée par paquets.
 */
export function HistoriqueFiltrable({ items, courante, empty }: {
  items: readonly Evenement[];
  courante: number;
  empty?: string;
}) {
  const [q, setQ] = useState('');
  const affiches = useMemo(() => filtrerEvenements(items, q), [items, q]);
  if (items.length === 0) return <Timeline courante={courante} items={items} empty={empty} />;
  return (
    <>
      <BarreRecherche compte={compteAffiches(affiches.length, items.length, UNITES.evenements)} filtre={q.trim() !== ''}
        onToutAfficher={() => setQ('')}>
        <ChampRecherche label="Rechercher dans l’historique" value={q} onChange={setQ}
          placeholder="Titre, détail ou date (JJ/MM/AAAA)…" />
      </BarreRecherche>
      {affiches.length === 0 ? (
        <div className="empty filtre-vide">
          <p>Aucun événement ne correspond à « {q.trim()} ».</p>
          <button type="button" className="btn" onClick={() => setQ('')}>Tout réafficher</button>
        </div>
      ) : (
        <Timeline courante={courante} items={affiches} empty={empty} />
      )}
    </>
  );
}
