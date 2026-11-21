import { useState, type CSSProperties, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, type BlocDocument, type BlocModele, type Classement, type Entite, type Kind } from '../../api';
import { PAS_TABLEAU } from '../../lib/borne';
import { libellesFiche, texte, todayIso } from '../../lib/format';
import { blocAvecFiche, ficheSupprimeeDe } from '../../lib/suppression';
import { qk } from '../../lib/queryKeys';
import { ChoixFiche, Etoile, Icon, PlusDElements, UNITES, useBorne } from '../../ui';
import {
  basculerChoix, choisisDe, colonneEtroite, colonnes, dateSaisieComplete, entiteIdDe, estObligatoire, estSigne, etatSignature, formatDateBloc,
  grouperBlocs, indexTitrePrincipal, lignesDe, motsClesProposes,
  niveauTitre, optionsDe, signer, valeurDate, valeurVariable, variableCanonique,
} from './blocs';
import './papier.css';

/*
 * Le « papier » (`paper()` du prototype) et le rendu d'un bloc sur ce papier, en deux variantes :
 * - `BlocApercu` : aperçu direct du Studio (formulaire vierge, champs inertes, variables montrées avec leur nom) ;
 * - `BlocSaisie` : document à remplir à l'écran.
 * Version 1.2 (§ 9.2) : on ne remplit plus rien à la main. Rien n'est ajouté pour écrire au stylo (lignes vides,
 * pointillés, cadres de signature) : l'impression montre ce qui est saisi, rien de plus. Les éléments propres à l'écran
 * (boutons) portent `.no-print` ; ceux propres à l'impression (texte d'une zone, date mise en forme) `.print-only`.
 * Un type de bloc inconnu ne fait jamais planter le rendu.
 */

/** Cadre du papier : titre à gauche, date en haut à droite, puis le contenu. */
export function Papier({ titre, sousTitre, date, children }: {
  titre: ReactNode;
  /** Ligne sous le titre (« Dossier 2025-01 · Achats », la catégorie du dossier) ; absente dans l'aperçu du Studio. */
  sousTitre?: ReactNode;
  date: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="paper">
      <div className="p-top">
        {sousTitre != null ? (
          <div>
            <h4>{titre}</h4>
            <p>{sousTitre}</p>
          </div>
        ) : (
          <h4>{titre}</h4>
        )}
        {date}
      </div>
      {children}
    </div>
  );
}

/** Gabarit gris d'un fichier importé sans aperçu (prototype : lignes grises). */
export function GabaritGris({ texte: t }: { texte: ReactNode }) {
  return (
    <>
      <span className="ln" />
      <span className="ln" />
      <span className="ln s" />
      <p>{t}</p>
      <span className="ln" />
      <span className="ln s" />
    </>
  );
}

/** Repère d'un bloc obligatoire encore vide (§ 10.6) : un texte, pas seulement une couleur. Non imprimé. */
function AFaire() {
  return <span className="p-manque-tag no-print"><Icon name="alerte" size={12} />Obligatoire, à remplir</span>;
}

/**
 * Blocs du papier, dans l'ordre, les « Signature » qui se suivent regroupées côte à côte.
 * Les textes placés avant le titre principal forment l'en-tête du formulaire (centrés).
 * `manquants` : index des blocs obligatoires encore vides, mis en évidence. Chaque bloc porte `data-bloc` (son index).
 */
export function BlocsPapier({ blocs, rendre, manquants }: {
  blocs: readonly BlocModele[];
  rendre: (i: number) => ReactNode;
  manquants?: ReadonlySet<number>;
}) {
  const titre = indexTitrePrincipal(blocs);
  const manque = (i: number) => manquants?.has(i) === true;
  return (
    <>
      {grouperBlocs(blocs).map((s) => (s.t === 'seul' ? (
        <div key={s.i} data-bloc={s.i}
          className={`${s.i < titre && blocs[s.i]?.t === 'texte' ? 'p-bloc entete' : 'p-bloc'}${manque(s.i) ? ' p-manque' : ''}`}>
          {rendre(s.i)}
          {manque(s.i) && <AFaire />}
        </div>
      ) : (
        <div key={`s${s.indices[0]}`} className="p-sigs">
          {s.indices.map((i) => (
            <div key={i} data-bloc={i} className={manque(i) ? 'p-sig p-manque' : 'p-sig'}>
              {rendre(i)}
              {manque(i) && <AFaire />}
            </div>
          ))}
        </div>
      )))}
    </>
  );
}

/** Libellé d'un bloc, suivi de l'étoile rouge s'il est obligatoire. */
function LibelleBloc({ bloc }: { bloc: BlocModele }) {
  return <>{lib(bloc)}{estObligatoire(bloc) && <Etoile />}</>;
}

/** Précision pour les lecteurs d'écran quand le champ ne peut pas porter `required` (liste à cocher, tableau). */
const ObligatoireSr = ({ bloc }: { bloc: BlocModele }) => (estObligatoire(bloc) ? <span className="sr-only"> (obligatoire)</span> : null);

/** Tableau du papier : en-têtes, puis les lignes (ou une ligne « — » à l'écran seulement s'il n'y en a pas). */
function TableauPapier({ cols, rows, cell, trailingHead, trailingCell }: {
  cols: string[];
  rows: readonly string[][];
  cell?: (row: number, col: number) => ReactNode;
  trailingHead?: ReactNode;
  trailingCell?: (row: number) => ReactNode;
}) {
  return (
    <table className="p-table">
      <thead>
        <tr>
          {cols.map((c, i) => <th key={i} scope="col" className={colonneEtroite(c) ? 'etroite' : undefined}>{c}</th>)}
          {trailingHead}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          // Tableau sans ligne : « — » à l'écran ; rien à l'impression (une ligne vide encadrée inviterait à écrire à la main, § 9.2).
          <tr className="no-print">
            {cols.map((_, i) => <td key={i}>—</td>)}
            {trailingHead && <td className="no-print" />}
          </tr>
        ) : (
          rows.map((r, ri) => (
            <tr key={ri}>
              {cols.map((_, ci) => (cell ? <td key={ci} className="cell-saisie">{cell(ri, ci)}</td> : <td key={ci}>{r[ci] || '—'}</td>))}
              {trailingCell?.(ri)}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

/** Aperçu du Studio d'un bloc Employé / Machine : la zone de recherche, inerte, et ce qui s'affichera. */
function FicheApercu({ kind }: { kind: Kind }) {
  return (
    <>
      <span className="cf-zone p-inerte" aria-hidden="true">
        <Icon name="search" size={14} />
        {kind === 'a' ? 'Tapez les premières lettres du nom ou l’identifiant…' : 'Tapez les premières lettres du nom, de la marque ou l’identifiant…'}
      </span>
      <small className="p-aide">La fiche choisie affichera : {libellesFiche(kind).join(' · ')}.</small>
    </>
  );
}

/** Case ou rond inerte de l'aperçu. */
const Boite = ({ rond }: { rond?: boolean }) => <span className={rond ? 'p-box rond' : 'p-box'} aria-hidden="true" />;

/** Libellé d'un bloc venu des données. */
const lib = (b: BlocModele) => texte(b.v);

/** Bloc dans l'aperçu direct du Studio (`pv()` du prototype) : le formulaire vierge, étoile comprise. */
export function BlocApercu({ bloc: b, variables }: { bloc: BlocModele; variables: Record<string, string> }) {
  switch (b.t) {
    case 'titre':
      return niveauTitre(b) === 1 ? <h5 className="p-titre">{lib(b)}</h5> : <h6 className="p-intertitre">{lib(b)}</h6>;
    case 'texte':
      return <p className="p-texte">{lib(b)}</p>;
    case 'champ':
      return <div className="df ligne"><span><LibelleBloc bloc={b} /></span><input className="field" disabled aria-label={lib(b)} placeholder="À remplir" /></div>;
    case 'zone':
      return <div className="df"><span><LibelleBloc bloc={b} /></span><textarea className="field" disabled rows={3} aria-label={lib(b)} placeholder="À remplir" /></div>;
    case 'date':
      return (
        <div className="df ligne">
          <span><LibelleBloc bloc={b} /></span>
          <input className="field p-date-in" disabled aria-label={lib(b)} type={b.heure === true ? 'datetime-local' : 'date'} />
        </div>
      );
    case 'variable':
      return (
        <p>
          <span className="var"><Icon name="variable" size={12} />{variableCanonique(b.v)}</span> → {valeurVariable(variables, lib(b))}
        </p>
      );
    case 'case':
      return <span className="ck"><Boite /><span><LibelleBloc bloc={b} /></span></span>;
    case 'choix':
      return (
        <div className="p-choix">
          <span className="p-legende"><LibelleBloc bloc={b} /></span>
          <span className="p-opts">
            {optionsDe(b).map((o) => <span key={o} className="ck"><Boite rond={b.multiple !== true} /><span>{o}</span></span>)}
          </span>
        </div>
      );
    case 'magasin':
      return (
        <div className="df">
          <span><LibelleBloc bloc={b} /></span>
          <select className="field" disabled aria-label={lib(b)}><option>Choisir dans le Magasin…</option></select>
        </div>
      );
    case 'tableau':
      return (
        <div className="p-tab">
          {(lib(b).trim() || estObligatoire(b)) && <span className="p-legende">{lib(b).trim() || 'Tableau'}{estObligatoire(b) && <Etoile />}</span>}
          <div className="p-tab-defile"><TableauPapier cols={colonnes(b)} rows={[]} /></div>
        </div>
      );
    case 'employe':
    case 'machine':
      return (
        <div className="p-fiche">
          <span className="p-legende"><LibelleBloc bloc={b} /></span>
          <FicheApercu kind={b.t === 'employe' ? 'a' : 'b'} />
        </div>
      );
    case 'signature':
      // Dans le papier, BlocsPapier place déjà le bloc dans sa cellule `.p-sig`.
      return (
        <>
          <span className="p-sig-lib"><LibelleBloc bloc={b} /></span>
          <span className="ck p-sig-case"><Boite /><span>Signé</span></span>
          <small className="p-sig-etat">Non signé</small>
        </>
      );
    default:
      return <BlocInconnu />;
  }
}

function BlocInconnu() {
  return <p className="p-inconnu no-print">Bloc non reconnu par cette version de l’application : il est conservé tel quel.</p>;
}

/** Champ de cellule : occupe toute la cellule, sans bordure propre. */
const CELLULE: CSSProperties = { width: '100%', height: 27, border: 0, borderRadius: 0, background: 'none', padding: '0 8px' };

export interface BlocSaisieProps {
  bloc: BlocDocument;
  /** Identifiant DOM du champ (associé à son libellé). */
  id: string;
  variables: Record<string, string>;
  magasin: readonly Classement[];
  /** Fiches déjà connues (fiches désignées par les blocs des documents du dossier, fiches choisies ici). */
  fiches: ReadonlyMap<number, Entite>;
  /** Dossier clôturé : rien n'est modifiable. */
  readOnly: boolean;
  /** `fiche` : la fiche choisie dans un bloc Employé / Machine. */
  onChange: (b: BlocDocument, fiche?: Entite) => void;
}

/**
 * Bloc d'un document, remplissable (`blk()` de `paper()` dans le prototype).
 * Bloc obligatoire (§ 10.6) : étoile rouge après le libellé, `required` sur le champ (ou une précision pour les
 * lecteurs d'écran quand le champ ne peut pas le porter). Cela informe et n'empêche jamais l'enregistrement.
 */
export function BlocSaisie({ bloc: b, id, variables, magasin, fiches, readOnly, onChange }: BlocSaisieProps) {
  const requis = estObligatoire(b) || undefined;
  switch (b.t) {
    case 'titre':
    case 'texte':
      return <BlocApercu bloc={b} variables={variables} />;
    case 'signature':
      return <SignatureBloc bloc={b} id={id} readOnly={readOnly} onChange={onChange} />;
    case 'champ':
      return (
        <label className="df ligne" htmlFor={id}>
          <span><LibelleBloc bloc={b} /></span>
          <input className="field" id={id} value={texte(b.val)} placeholder="À remplir" disabled={readOnly} required={requis}
            onChange={(e) => onChange({ ...b, val: e.target.value })} />
        </label>
      );
    case 'zone':
      return (
        <label className="df" htmlFor={id}>
          <span><LibelleBloc bloc={b} /></span>
          <textarea className="field no-print" id={id} rows={3} value={texte(b.val)} placeholder="À remplir" disabled={readOnly} required={requis}
            onChange={(e) => onChange({ ...b, val: e.target.value })} />
          <span className="p-zone print-only">{texte(b.val)}</span>
        </label>
      );
    case 'date':
      return <DateBloc bloc={b} id={id} readOnly={readOnly} onChange={onChange} />;
    case 'variable':
      return <p className="pv-var"><small>{variableCanonique(b.v)}</small>{valeurVariable(variables, lib(b))}</p>;
    case 'case':
      return (
        <label className="ck" htmlFor={id}>
          <input type="checkbox" id={id} checked={b.ok === true} disabled={readOnly} required={requis}
            onChange={(e) => onChange({ ...b, ok: e.target.checked })} />
          <span><LibelleBloc bloc={b} /></span>
        </label>
      );
    case 'choix':
      return <ChoixBloc bloc={b} id={id} readOnly={readOnly} onChange={onChange} />;
    case 'magasin':
      return (
        <label className="df" htmlFor={id}>
          <span><LibelleBloc bloc={b} /></span>
          <select className="field" id={id} value={texte(b.val)} disabled={readOnly} required={requis}
            onChange={(e) => onChange({ ...b, val: e.target.value })}>
            <option value="">Choisir dans le Magasin…</option>
            {motsClesProposes(magasin, texte(b.val)).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      );
    case 'tableau':
      return <TableauSaisie bloc={b} id={id} readOnly={readOnly} onChange={onChange} />;
    case 'employe':
    case 'machine':
      return <FicheBloc bloc={b} id={id} kind={b.t === 'employe' ? 'a' : 'b'} fiches={fiches} readOnly={readOnly} onChange={onChange} />;
    default:
      return <BlocInconnu />;
  }
}

/** Date (avec l'heure si demandé) : une saisie incomplète reste à l'écran sans être enregistrée. */
function DateBloc({ bloc: b, id, readOnly, onChange }: { bloc: BlocDocument; id: string; readOnly: boolean; onChange: (b: BlocDocument) => void }) {
  const heure = b.heure === true;
  const [saisie, setSaisie] = useState(valeurDate(b));
  return (
    <label className="df ligne" htmlFor={id}>
      <span><LibelleBloc bloc={b} /></span>
      <input className="field p-date-in" id={id} type={heure ? 'datetime-local' : 'date'} value={saisie} disabled={readOnly}
        required={estObligatoire(b) || undefined}
        onChange={(e) => {
          const v = e.target.value;
          setSaisie(v);
          if (v === '' || dateSaisieComplete(v, heure)) onChange({ ...b, val: v });
        }} />
      <span className="p-zone print-only">{formatDateBloc(valeurDate(b))}</span>
    </label>
  );
}

/** Liste d'options : cases (plusieurs réponses) ou boutons radio (une seule réponse). */
function ChoixBloc({ bloc: b, id, readOnly, onChange }: { bloc: BlocDocument; id: string; readOnly: boolean; onChange: (b: BlocDocument) => void }) {
  const multiple = b.multiple === true;
  const choisis = choisisDe(b);
  return (
    <fieldset className="p-choix">
      <legend className="p-legende">
        <LibelleBloc bloc={b} />
        <span className="sr-only">{multiple ? ' (plusieurs réponses possibles)' : ' (une seule réponse)'}</span>
        {multiple && <ObligatoireSr bloc={b} />}
      </legend>
      <span className="p-opts">
        {optionsDe(b).map((o, k) => (
          <label key={o} className="ck" htmlFor={`${id}-${k}`}>
            <input type={multiple ? 'checkbox' : 'radio'} id={`${id}-${k}`} name={id} checked={choisis.includes(o)} disabled={readOnly}
              required={!multiple && estObligatoire(b) ? true : undefined}
              onChange={(e) => onChange({ ...b, choisis: basculerChoix(b, o, e.target.checked) })} />
            <span>{o}</span>
          </label>
        ))}
        {!multiple && choisis.length > 0 && !readOnly && (
          <button type="button" className="btn ghost no-print p-effacer" aria-label={`Effacer le choix : ${lib(b)}`}
            onClick={() => onChange({ ...b, choisis: [] })}>
            Effacer
          </button>
        )}
      </span>
    </fieldset>
  );
}

/**
 * Fiche désignée par un bloc Employé / Machine (`entiteId`), de la sorte attendue : prise parmi les fiches déjà
 * connues, sinon lue (elle a pu être choisie dans une autre visite). `introuvable` : la lecture a échoué.
 */
export function useFicheDesignee(entiteId: number | null, kind: Kind, fiches: ReadonlyMap<number, Entite>): {
  fiche: Entite | null;
  introuvable: boolean;
} {
  const connue = entiteId !== null ? fiches.get(entiteId) : undefined;
  const lue = useQuery({
    queryKey: qk.fiche(entiteId ?? 0),
    queryFn: () => api.entiteFiche(entiteId ?? 0),
    enabled: entiteId !== null && !connue,
    retry: false,
  });
  const fiche = connue ?? (entiteId !== null && lue.data?.entite.id === entiteId ? lue.data.entite : undefined);
  return { fiche: fiche && fiche.kind === kind ? fiche : null, introuvable: entiteId !== null && !connue && lue.isError };
}

/** Bloc Employé / Machine : aide à la saisie, puis les informations de la fiche, lues en direct. */
function FicheBloc({ bloc: b, id, kind, fiches, readOnly, onChange }: {
  bloc: BlocDocument;
  id: string;
  kind: Kind;
  fiches: ReadonlyMap<number, Entite>;
  readOnly: boolean;
  onChange: (b: BlocDocument, fiche?: Entite) => void;
}) {
  const { fiche: value, introuvable } = useFicheDesignee(entiteIdDe(b), kind, fiches);
  return (
    <div className="p-fiche">
      {/* § 13.2 : un bloc dont la fiche a été supprimée en montre la copie (texte, mention « fiche supprimée »). */}
      <ChoixFiche kind={kind} id={id} label={lib(b)} labelTexte={lib(b) || (kind === 'a' ? 'Employé' : 'Machine')} value={value}
        details="complet" effacable readOnly={readOnly} required={estObligatoire(b)} supprimee={ficheSupprimeeDe(b, kind)}
        onChange={(e) => onChange(blocAvecFiche(b, e ? e.id : null), e ?? undefined)} />
      {introuvable && <p className="p-inconnu no-print">La fiche choisie est introuvable. Choisissez-en une autre.</p>}
    </div>
  );
}

/**
 * Signature (§ 9.2) : case « Signé » sous le libellé du signataire, puis « Signé le JJ/MM/AAAA » ou « Non signé ».
 * Nom accessible de la case : « {libellé} : Signé ».
 */
function SignatureBloc({ bloc: b, id, readOnly, onChange }: { bloc: BlocDocument; id: string; readOnly: boolean; onChange: (b: BlocDocument) => void }) {
  const signe = estSigne(b);
  return (
    <>
      <span className="p-sig-lib" aria-hidden="true"><LibelleBloc bloc={b} /></span>
      <label className="ck p-sig-case" htmlFor={id}>
        <input type="checkbox" id={id} checked={signe} disabled={readOnly} aria-describedby={`${id}-etat`}
          required={estObligatoire(b) || undefined}
          onChange={(e) => onChange(signer(b, e.target.checked, todayIso()))} />
        <span><span className="sr-only">{lib(b) || 'Signature'} : </span>Signé</span>
      </label>
      <small className={signe ? 'p-sig-etat ok' : 'p-sig-etat'} id={`${id}-etat`}>{etatSignature(b)}</small>
    </>
  );
}

function TableauSaisie({ bloc: b, id, readOnly, onChange }: {
  bloc: BlocDocument;
  id: string;
  readOnly: boolean;
  onChange: (b: BlocDocument) => void;
}) {
  const cols = colonnes(b);
  const rows = lignesDe(b);
  // Rendu borné (lib/borne.ts) : un tableau géant ne gèle pas l'interface. `visibles` est un préfixe de `rows`,
  // donc les index ri restent ceux du tableau complet.
  const borne = useBorne(rows, PAS_TABLEAU);
  const plus = <PlusDElements masques={borne.masques} pas={PAS_TABLEAU} unite={UNITES.lignes} onPlus={borne.plus} />;
  // Tableau obligatoire sans titre (« État des besoins ») : un titre d'écran porte l'étoile.
  const legende = lib(b).trim() ? (
    <span className="p-legende">{lib(b).trim()}{estObligatoire(b) && <Etoile />}<ObligatoireSr bloc={b} /></span>
  ) : estObligatoire(b) ? (
    <span className="p-legende no-print">Tableau<Etoile /><ObligatoireSr bloc={b} /></span>
  ) : null;
  if (readOnly) {
    return (
      <div className="p-tab">
        {legende}
        <TableauPapier cols={cols} rows={borne.visibles} />
        {plus}
      </div>
    );
  }

  const setCell = (ri: number, ci: number, value: string) =>
    onChange({ ...b, rows: rows.map((r, i) => (i === ri ? r.map((x, j) => (j === ci ? value : x)) : r)) });
  const addRow = () => {
    borne.assurer(rows.length + 1); // la ligne ajoutée reste visible
    onChange({ ...b, rows: [...rows, cols.map(() => '')] });
  };
  const removeRow = (ri: number) => onChange({ ...b, rows: rows.filter((_, i) => i !== ri) });

  return (
    <div className="p-tab">
      {legende}
      <div className="p-tab-defile">
        <TableauPapier
          cols={cols}
          rows={borne.visibles}
          cell={(ri, ci) => (
            <input className="field" id={ri === 0 && ci === 0 ? id : undefined} style={CELLULE}
              aria-label={`${cols[ci]}, ligne ${ri + 1}`} value={rows[ri][ci] ?? ''}
              onChange={(e) => setCell(ri, ci, e.target.value)} />
          )}
          trailingHead={<th className="no-print" style={{ width: 40 }} aria-label="Retirer une ligne" />}
          trailingCell={(ri) => (
            <td className="no-print" style={{ width: 40, padding: 0, textAlign: 'center' }}>
              <button type="button" className="btn ghost" style={{ padding: '0 6px' }}
                aria-label={`Retirer la ligne ${ri + 1}`} title="Retirer la ligne" onClick={() => removeRow(ri)}>
                <Icon name="close" size={14} />
              </button>
            </td>
          )}
        />
      </div>
      {plus}
      <button type="button" className="btn no-print" onClick={addRow}>
        <Icon name="plus" size={14} />Ajouter une ligne
      </button>
    </div>
  );
}
