import type { CSSProperties, DragEvent, ReactNode } from 'react';
import { BORNES_BLOCS, type BlocModele } from '../../api';
import { plural, texte } from '../../lib/format';
import { Etoile, Icon, Seg } from '../../ui';
import {
  colonnesBrutes, estBlocDeSaisie, estVariable, iconeBloc, libelleBloc, marquerObligatoire, optionsBrutes, niveauTitre, variableCanonique, VARIABLES,
} from '../blocs/blocs';

/** Petite aide sous un champ (`hint()` du prototype). */
const Hint = ({ children, id }: { children: ReactNode; id?: string }) => <small id={id} style={{ color: 'var(--fg3)', fontSize: 12 }}>{children}</small>;

export type Deplacement = 'monter' | 'descendre';

/** Bouton d'en-tête de bloc désactivé (premier / dernier bloc). */
const INACTIF: CSSProperties = { color: 'var(--fg-dis)', cursor: 'default' };
/** Boutons « ↑ » / « ↓ » : une zone cliquable un peu plus large que la flèche. */
const FLECHE: CSSProperties = { padding: '0 4px', borderRadius: 4 };
/** Poignée de glisser-déposer : mêmes couleur et marge que l'icône `.blk>.ic` du prototype. */
const POIGNEE: CSSProperties = { color: 'var(--fg-dis)', marginTop: 2, display: 'flex', flex: 'none', alignSelf: 'flex-start', cursor: 'grab' };
/** Ligne de réglages d'un bloc (niveau, type de réponse, heure…). */
const REGLAGES: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 12, color: 'var(--fg2)' };

/**
 * Un bloc dans l'éditeur du Studio (`blk()` de `P.studio` dans le prototype).
 * Ajouts : boutons « Monter » / « Descendre » (clavier) et poignée de glisser-déposer ; réglages propres à chaque type
 * (niveau d'un titre, heure d'une date, options d'une liste, colonnes d'un tableau…).
 */
export function BlocEditeur({ bloc: b, cle, rang, total, motsCles, onChange, onRemove, onMove, drag }: {
  bloc: BlocModele;
  /** Clé stable du bloc (identifiants DOM). */
  cle: number;
  rang: number;
  total: number;
  /** Mots-clés actifs du Magasin, pour l'aide du bloc « Choix du Magasin ». */
  motsCles: string;
  onChange: (b: BlocModele) => void;
  onRemove: () => void;
  onMove: (sens: Deplacement) => void;
  drag: {
    armed: boolean;
    dragging: boolean;
    indicator: 'avant' | 'apres' | null;
    arm: (on: boolean) => void;
    onDragStart: (e: DragEvent<HTMLDivElement>) => void;
    onDragEnter: (e: DragEvent<HTMLDivElement>) => void;
    onDragOver: (e: DragEvent<HTMLDivElement>) => void;
    onDrop: (e: DragEvent<HTMLDivElement>) => void;
    onDragEnd: () => void;
  };
}) {
  const id = `blk-${cle}`;
  const label = libelleBloc(b.t);
  const v = texte(b.v);
  // Point de dépôt : un trait de la couleur d'accent au-dessus ou au-dessous du bloc survolé.
  const shadow = drag.indicator === 'avant' ? '0 -4px 0 -1px var(--accent)' : drag.indicator === 'apres' ? '0 4px 0 -1px var(--accent)' : undefined;
  const libelle = (aria: string, aide?: ReactNode) => (
    <>
      <input className="field" id={id} aria-label={aria} value={v} onChange={(e) => onChange({ ...b, v: e.target.value })} />
      {aide && <Hint>{aide}</Hint>}
    </>
  );

  let champ: ReactNode;
  switch (b.t) {
    case 'titre':
      champ = (
        <>
          <input className="field" id={id} aria-label="Texte du titre" value={v} onChange={(e) => onChange({ ...b, v: e.target.value })} />
          <span style={REGLAGES}>
            <Seg<'1' | '2'> label={`Niveau du titre ${rang + 1}`} value={niveauTitre(b) === 2 ? '2' : '1'}
              onChange={(n) => onChange({ ...b, niveau: n === '2' ? 2 : 1 })}
              options={[{ value: '1', label: 'Titre principal' }, { value: '2', label: 'Intertitre de section' }]} />
          </span>
        </>
      );
      break;
    case 'texte':
      champ = (
        <>
          <textarea className="field" id={id} rows={2} aria-label="Texte du bloc" value={v} onChange={(e) => onChange({ ...b, v: e.target.value })} />
        </>
      );
      break;
    case 'champ':
      champ = libelle('Libellé du champ', 'Réponse courte saisie quand vous remplissez le document.');
      break;
    case 'zone':
      champ = libelle('Libellé de la zone de texte', 'Réponse sur plusieurs lignes.');
      break;
    case 'date':
      champ = (
        <>
          {libelle('Libellé de la date')}
          <label className="ck" htmlFor={`${id}-heure`} style={{ fontSize: 12, fontWeight: 400 }}>
            <input type="checkbox" id={`${id}-heure`} checked={b.heure === true} onChange={(e) => onChange({ ...b, heure: e.target.checked })} />
            <span>Demander aussi l’heure</span>
          </label>
        </>
      );
      break;
    case 'variable': {
      const courant = variableCanonique(b.v);
      const options: string[] = estVariable(courant) ? [...VARIABLES] : [courant, ...VARIABLES];
      champ = (
        <>
          <select className="field" id={id} aria-label="Information automatique" value={courant} onChange={(e) => onChange({ ...b, v: e.target.value })}>
            {options.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <Hint>Valeur reprise du premier bloc Employé ou Machine du document, ou de la date du document.</Hint>
        </>
      );
      break;
    }
    case 'case':
      champ = libelle('Nom de l’option à cocher', 'Nom affiché à côté de la case.');
      break;
    case 'choix':
      champ = <EditeurChoix bloc={b} id={id} rang={rang} onChange={onChange} />;
      break;
    case 'magasin':
      champ = libelle('Libellé du choix', <>Propose les mots-clés du Magasin : {motsCles}.</>);
      break;
    case 'tableau':
      champ = <EditeurTableau bloc={b} id={id} onChange={onChange} />;
      break;
    case 'employe':
      champ = libelle('Libellé du choix de l’employé', 'Liste d’aide à la saisie. Affiche nom, prénom, poste, structure et identifiant. Le document apparaît alors sur le profil de l’employé choisi.');
      break;
    case 'machine':
      champ = libelle('Libellé du choix de la machine', 'Liste d’aide à la saisie. Affiche identifiant, marque, processeur, RAM et stockage. Le document apparaît alors sur le profil de la machine choisie.');
      break;
    case 'signature':
      champ = libelle('Libellé de la signature',
        'Nom du signataire (« Visa du demandeur »…). Dans le document, une case « Signé » à cocher ; la date est notée automatiquement. Plusieurs signatures qui se suivent sont côte à côte.');
      break;
    default:
      champ = <Hint>Ce type de bloc n’est pas reconnu par cette version de l’application. Il est conservé tel quel.</Hint>;
  }

  return (
    <div className="blk" data-blk={cle} draggable={drag.armed}
      style={{ boxShadow: shadow, opacity: drag.dragging ? 0.5 : undefined }}
      onDragStart={drag.onDragStart} onDragEnter={drag.onDragEnter} onDragOver={drag.onDragOver} onDrop={drag.onDrop} onDragEnd={drag.onDragEnd}>
      <span style={POIGNEE} title="Glisser pour déplacer le bloc" aria-hidden="true"
        onMouseDown={() => drag.arm(true)} onMouseUp={() => drag.arm(false)}>
        <Icon name="grip" />
      </span>
      <div className="bd">
        <div className="bh">
          <Icon name={iconeBloc(b.t)} size={14} />
          {label}
          <button type="button" data-act="monter" disabled={rang === 0} style={{ ...FLECHE, ...(rang === 0 ? INACTIF : {}) }}
            aria-label={`Monter le bloc ${rang + 1} (${label})`} title="Monter" onClick={() => onMove('monter')}>↑</button>
          <button type="button" data-act="descendre" disabled={rang === total - 1}
            style={{ ...FLECHE, marginLeft: 0, ...(rang === total - 1 ? INACTIF : {}) }}
            aria-label={`Descendre le bloc ${rang + 1} (${label})`} title="Descendre" onClick={() => onMove('descendre')}>↓</button>
          <button type="button" style={{ marginLeft: 0 }} aria-label={`Retirer le bloc ${rang + 1} (${label})`} onClick={onRemove}>Retirer</button>
        </div>
        {champ}
        {estBlocDeSaisie(b.t) && (
          // § 10.6 : bloc de saisie marqué obligatoire → étoile rouge dans le document, et compté parmi les champs à remplir.
          <label className="ck blk-oblig" htmlFor={`${id}-oblig`}>
            <input type="checkbox" id={`${id}-oblig`} checked={b.obligatoire === true}
              onChange={(e) => onChange(marquerObligatoire(b, e.target.checked))} />
            <span>Champ obligatoire<span className="sr-only"> : bloc {rang + 1} ({label})</span></span>
            {b.obligatoire === true && <Etoile />}
          </label>
        )}
      </div>
    </div>
  );
}

/** Réglages d'une liste d'options : libellé, une ou plusieurs réponses, options (2 à 12). */
function EditeurChoix({ bloc: b, id, rang, onChange }: { bloc: BlocModele; id: string; rang: number; onChange: (b: BlocModele) => void }) {
  const options = optionsBrutes(b);
  const setOptions = (next: string[]) => onChange({ ...b, options: next });
  const peutRetirer = options.length > BORNES_BLOCS.optionsMin;
  const peutAjouter = options.length < BORNES_BLOCS.optionsMax;
  return (
    <>
      <input className="field" id={id} aria-label="Libellé de la liste d’options" value={texte(b.v)} onChange={(e) => onChange({ ...b, v: e.target.value })} />
      <span style={REGLAGES}>
        <Seg<'unique' | 'multiple'> label={`Réponses du bloc ${rang + 1}`} value={b.multiple === true ? 'multiple' : 'unique'}
          onChange={(m) => onChange({ ...b, multiple: m === 'multiple' })}
          options={[{ value: 'unique', label: 'Une seule réponse' }, { value: 'multiple', label: 'Plusieurs réponses' }]} />
      </span>
      <div style={{ display: 'grid', gap: 6 }}>
        {options.map((o, i) => (
          <span key={i} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span aria-hidden="true" className={b.multiple === true ? 'p-box' : 'p-box rond'} />
            <input className="field" style={{ flex: 1 }} aria-label={`Option ${i + 1}`} value={o} maxLength={BORNES_BLOCS.optionLongueurMax}
              placeholder={`Option ${i + 1}`}
              onChange={(e) => setOptions(options.map((x, j) => (j === i ? e.target.value : x)))} />
            <button type="button" className="btn ghost" disabled={!peutRetirer} aria-label={`Retirer l’option ${i + 1}`}
              title={peutRetirer ? 'Retirer l’option' : `Au moins ${BORNES_BLOCS.optionsMin} options`}
              onClick={() => setOptions(options.filter((_, j) => j !== i))}>
              <Icon name="close" size={14} />
            </button>
          </span>
        ))}
      </div>
      <span style={REGLAGES}>
        <button type="button" className="btn" disabled={!peutAjouter}
          onClick={() => setOptions([...options, `Option ${options.length + 1}`])}>
          <Icon name="plus" size={14} />Ajouter une option
        </button>
        <Hint>De {BORNES_BLOCS.optionsMin} à {BORNES_BLOCS.optionsMax} options.</Hint>
      </span>
    </>
  );
}

/** Réglages d'un tableau : nombre de colonnes (1 à 8) et leurs en-têtes. */
function EditeurTableau({ bloc: b, id, onChange }: { bloc: BlocModele; id: string; onChange: (b: BlocModele) => void }) {
  const cols = colonnesBrutes(b);
  const n = cols.length;
  const setN = (k: number) => {
    const m = Math.min(BORNES_BLOCS.colonnesMax, Math.max(BORNES_BLOCS.colonnesMin, k));
    onChange({ ...b, cols: Array.from({ length: m }, (_, i) => cols[i] ?? `Colonne ${i + 1}`) });
  };
  return (
    <>
      <span style={REGLAGES}>
        <span>Nombre de colonnes</span>
        <button type="button" className="btn" disabled={n <= BORNES_BLOCS.colonnesMin} aria-label="Retirer une colonne" onClick={() => setN(n - 1)}>−</button>
        <b className="num" aria-live="polite">{plural(n, 'colonne')}</b>
        <button type="button" className="btn" disabled={n >= BORNES_BLOCS.colonnesMax} aria-label="Ajouter une colonne" onClick={() => setN(n + 1)}>+</button>
      </span>
      {/* Deux en-têtes par ligne au plus : l'éditeur est étroit, quatre champs côte à côte coupaient les en-têtes. */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(n, 2)}, minmax(0, 1fr))`, gap: 6 }}>
        {cols.map((c, i) => (
          <input key={i} className="field" id={i === 0 ? id : undefined} aria-label={`En-tête de la colonne ${i + 1}`}
            placeholder={`Colonne ${i + 1}`} value={c}
            onChange={(e) => onChange({ ...b, cols: cols.map((x, j) => (j === i ? e.target.value : x)) })} />
        ))}
      </div>
      <Hint>Les lignes sont ajoutées quand vous remplissez le document.</Hint>
    </>
  );
}
