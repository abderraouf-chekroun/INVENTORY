import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { entiteDeFicheSupprimee, type Entite, type FicheSupprimee, type Kind } from '../api';
import { prochainIndex } from '../lib/aideSaisie';
import { champsFiche, detailFiche, kindLabel, nomAffiche, plural } from '../lib/format';
import { MENTION_FICHE_SUPPRIMEE, nomFicheSupprimee } from '../lib/suppression';
import { useSuggestions } from '../lib/queries';
import { EntityCode } from './Badge';
import { Icon } from './Icon';
import { Etoile } from './Obligatoire';
import { Surligne } from './Surligne';

export interface ChoixFicheProps {
  kind: Kind;
  /** Identifiant DOM du champ de saisie (le libellé lui est associé). */
  id: string;
  /** Libellé visible : « Employé », « Utilisateur », « Machine »… */
  label: ReactNode;
  /** Texte accessible du libellé quand `label` n'est pas un simple texte. */
  labelTexte?: string;
  /** Petite aide sous le libellé. */
  aide?: ReactNode;
  value: Entite | null;
  onChange: (e: Entite | null) => void;
  /** Lecture seule (dossier clôturé) : la fiche choisie s'affiche sans boutons. */
  readOnly?: boolean;
  /** Fiches à ne pas proposer (déjà associées…). */
  exclure?: readonly number[];
  /** Bouton « Retirer » pour vider le choix (blocs de document). */
  effacable?: boolean;
  /** Fiche choisie : toutes ses informations (document) ou un résumé (formulaires). */
  details?: 'complet' | 'court';
  autoFocus?: boolean;
  placeholder?: string;
  /** Choix obligatoire (§ 10.6) : étoile rouge après le libellé, `aria-required` sur la saisie. */
  required?: boolean;
  /** Bouton « Ouvrir la fiche » à côté de la fiche choisie (fichier importé). */
  onOuvrir?: (e: Entite) => void;
  /**
   * § 13.2 : copie de la fiche supprimée que désignait le bloc (sans fiche choisie). Affichée en texte, sans lien, avec
   * la mention « fiche supprimée » ; « Choisir une autre fiche » ouvre l'aide à la saisie (sauf en lecture seule).
   */
  supprimee?: FicheSupprimee | null;
}

/** Informations d'une fiche choisie, en liste « libellé : valeur » (imprimable). */
export function DetailsFiche({ e }: { e: Entite }) {
  return (
    <dl className="cf-details">
      {champsFiche(e).map(([l, v]) => (
        <div key={l}><dt>{l}</dt><dd className={l === 'Identifiant' && e.code ? 'mono' : undefined}>{v}</dd></div>
      ))}
    </dl>
  );
}

/**
 * Aide à la saisie d'un employé ou d'une machine (§ 8.4) : on tape les premières lettres, une liste propose
 * les fiches actives correspondantes (8 au plus, ordre décidé par le back). Motif ARIA « combobox » :
 * ↓ ↑ parcourent (en boucle), Début / Fin, Entrée choisit, Échap ferme la liste (puis efface la saisie),
 * clic sur une proposition. Le nombre de propositions est annoncé aux lecteurs d'écran.
 * Une fois la fiche choisie, elle s'affiche dans un cadre avec « Changer » (et « Retirer » si `effacable`).
 */
export function ChoixFiche({
  kind, id, label, labelTexte, aide, value, onChange, readOnly = false, exclure, effacable = false, details = 'court',
  autoFocus, placeholder, required, onOuvrir, supprimee,
}: ChoixFicheProps) {
  const labelId = useId();
  const listId = useId();
  const aideId = useId();
  const [edition, setEdition] = useState(false);
  const [q, setQ] = useState('');
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const changer = useRef<HTMLButtonElement>(null);
  const focusApres = useRef<'changer' | 'saisie' | null>(null);
  const liste = useRef<HTMLUListElement>(null);

  const term = q.trim();
  const { data, isPlaceholderData, isError } = useSuggestions(kind, term);
  const exclus = new Set(exclure ?? []);
  const items = term ? (data ?? []).filter((e) => e.actif && !exclus.has(e.id)) : [];
  const aJour = data !== undefined && !isPlaceholderData;
  const montre = ouvert && term !== '';
  const actifBorne = items.length ? Math.min(Math.max(actif, 0), items.length - 1) : -1;
  // Bloc dont la fiche a été supprimée (§ 13.2) : sa copie s'affiche tant qu'aucune autre fiche n'est choisie.
  const orphelin = value === null && supprimee ? supprimee : null;
  const saisie = (value === null && !orphelin) || edition;
  const nom = kindLabel(kind).toLowerCase();

  // Focus après un choix (sur « Changer ») ou après « Changer » (sur la saisie).
  useLayoutEffect(() => {
    const f = focusApres.current;
    if (!f) return;
    focusApres.current = null;
    (f === 'changer' ? changer.current : input.current)?.focus();
  });

  // La liste qui s'ouvre près du bas de la fenêtre (petit écran, formulaire long) défile à l'écran en entier :
  // sinon les propositions restent cachées sous le bord de la fenêtre pendant que l'on tape.
  const nbItems = items.length;
  useEffect(() => {
    if (!montre || nbItems === 0) return;
    liste.current?.parentElement?.scrollIntoView({ block: 'nearest' });
  }, [montre, nbItems]);

  // La proposition active reste visible dans la liste.
  useEffect(() => {
    if (!montre || actifBorne < 0) return;
    liste.current?.querySelector<HTMLElement>(`[data-i="${actifBorne}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [montre, actifBorne]);

  const choisir = (e: Entite) => {
    onChange(e);
    setQ('');
    setOuvert(false);
    setEdition(false);
    focusApres.current = 'changer';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        e.preventDefault();
        if (!montre) {
          setOuvert(true);
          setActif(e.key === 'ArrowDown' ? 0 : Math.max(0, items.length - 1));
        } else {
          setActif(prochainIndex(actifBorne, items.length, e.key));
        }
        return;
      case 'Home':
      case 'End':
        if (!montre || !items.length || e.shiftKey) return;
        e.preventDefault();
        setActif(prochainIndex(actifBorne, items.length, e.key));
        return;
      case 'Enter':
        // Jamais d'envoi du formulaire avec une saisie en cours : on choisit, ou on attend.
        if (term === '') return;
        e.preventDefault();
        if (montre && aJour && actifBorne >= 0) choisir(items[actifBorne]);
        else setOuvert(true);
        return;
      case 'Escape':
        if (montre) {
          e.preventDefault();
          e.stopPropagation();
          setOuvert(false);
        } else if (q !== '') {
          e.preventDefault();
          e.stopPropagation();
          setQ('');
        } else if (edition && (value || orphelin)) {
          e.preventDefault();
          e.stopPropagation();
          setEdition(false);
          focusApres.current = 'changer';
        }
        return;
      case 'Tab':
        setOuvert(false);
        return;
    }
  };

  let statut = '';
  if (montre) {
    if (isError) statut = 'Les propositions ne peuvent pas être lues.';
    else if (!aJour && items.length === 0) statut = 'Recherche…';
    else if (items.length === 0) statut = `${kind === 'a' ? 'Aucun employé actif' : 'Aucune machine active'} ne correspond à « ${term} ».`;
    else statut = `${plural(items.length, 'proposition')}. Flèches pour parcourir, Entrée pour choisir.`;
  }

  const titre = <span>{label}{required && <Etoile />}</span>;
  const libelle = (
    <>
      {titre}
      {aide && <small id={aideId}>{aide}</small>}
    </>
  );

  if (!saisie && orphelin) {
    // Fiche supprimée (§ 13.2) : nom et identifiant en texte, mention « fiche supprimée », aucun lien.
    const nomChamp = labelTexte ?? (typeof label === 'string' ? label : nom);
    const nomCopie = nomFicheSupprimee(orphelin);
    const actions = readOnly ? null : (
      <span className="cf-acts no-print">
        <button type="button" className="btn" ref={changer}
          aria-label={`Choisir une autre fiche : ${nomChamp} (${nomCopie}, ${MENTION_FICHE_SUPPRIMEE})`}
          onClick={() => { setEdition(true); setQ(''); focusApres.current = 'saisie'; }}>
          Choisir une autre fiche
        </button>
      </span>
    );
    const mention = <small className="cf-supp">{MENTION_FICHE_SUPPRIMEE}</small>;
    if (details === 'complet') {
      return (
        <div className="choix-fiche">
          <div className="cf-tete">
            <span className="cf-label" id={labelId}>{titre}</span>
            {actions}
          </div>
          <div className="cf-carte complet supprimee" role="group" aria-labelledby={labelId}>
            <DetailsFiche e={entiteDeFicheSupprimee(orphelin)} />
            {mention}
          </div>
        </div>
      );
    }
    return (
      <div className="choix-fiche">
        <span className="cf-label" id={labelId}>{titre}</span>
        <div className="cf-carte supprimee" role="group" aria-labelledby={labelId}>
          <span className="cf-ic"><Icon name={kind} size={20} /></span>
          <div className="cf-corps">
            <b>{nomCopie}</b>
            <small>
              {orphelin.code ? <span className="mono">{orphelin.code}</span> : <span>Sans identifiant</span>}
              {mention}
            </small>
          </div>
          {actions}
        </div>
      </div>
    );
  }

  if (!saisie && value) {
    const nomChamp = labelTexte ?? (typeof label === 'string' ? label : nom);
    const ouvrir = onOuvrir && (
      <button type="button" className="btn ghost" aria-label={`Ouvrir la fiche de ${nomAffiche(value)}`} onClick={() => onOuvrir(value)}>
        Ouvrir la fiche
      </button>
    );
    const actions = readOnly ? (ouvrir ? <span className="cf-acts no-print">{ouvrir}</span> : null) : (
      <span className="cf-acts no-print">
        {ouvrir}
        <button type="button" className="btn" ref={changer}
          aria-label={`Changer ${nomChamp} (${nomAffiche(value)})`}
          onClick={() => { setEdition(true); setQ(''); focusApres.current = 'saisie'; }}>
          Changer
        </button>
        {effacable && (
          <button type="button" className="btn ghost"
            aria-label={`Retirer ${nomChamp} (${nomAffiche(value)})`}
            onClick={() => { onChange(null); setEdition(false); focusApres.current = 'saisie'; }}>
            Retirer
          </button>
        )}
      </span>
    );
    const archivee = !value.actif && <small className="cf-arch">Fiche archivée</small>;
    // Document : le libellé et les boutons sur une ligne, puis toutes les informations sur la largeur du papier.
    if (details === 'complet') {
      return (
        <div className="choix-fiche">
          <div className="cf-tete">
            <span className="cf-label" id={labelId}>{titre}</span>
            {actions}
          </div>
          <div className="cf-carte complet" role="group" aria-labelledby={labelId}>
            <DetailsFiche e={value} />
            {archivee}
          </div>
        </div>
      );
    }
    return (
      <div className="choix-fiche">
        <span className="cf-label" id={labelId}>{titre}</span>
        <div className="cf-carte" role="group" aria-labelledby={labelId}>
          <span className="cf-ic"><Icon name={kind} size={20} /></span>
          <div className="cf-corps">
            <b>{nomAffiche(value)}</b>
            <small>
              <EntityCode code={value.code} kind={value.kind} />
              {detailFiche(value) && <span>{detailFiche(value)}</span>}
            </small>
            {archivee}
          </div>
          {actions}
        </div>
      </div>
    );
  }

  if (readOnly) {
    return (
      <div className="choix-fiche">
        <span className="cf-label" id={labelId}>{libelle}</span>
        <div className="cf-carte vide" role="group" aria-labelledby={labelId}>
          <span className="cf-ic"><Icon name={kind} size={20} /></span>
          <span className="cf-corps"><small>Aucun{kind === 'a' ? '' : 'e'} {nom} choisi{kind === 'a' ? '' : 'e'}.</small></span>
        </div>
      </div>
    );
  }

  return (
    <div className="choix-fiche">
      <label className="cf-label" htmlFor={id} id={labelId}>{libelle}</label>
      <div className="cf-saisie">
        <span className="cf-zone">
          <Icon name="search" size={14} />
          <input ref={input} className="cf-input" id={id} type="text" autoComplete="off" spellCheck={false}
            role="combobox" aria-autocomplete="list" aria-expanded={montre} aria-controls={listId}
            aria-activedescendant={montre && actifBorne >= 0 ? `${listId}-${actifBorne}` : undefined}
            aria-describedby={aide ? aideId : undefined} aria-required={required || undefined}
            autoFocus={autoFocus}
            placeholder={placeholder ?? (kind === 'a' ? 'Tapez les premières lettres du nom ou l’identifiant…' : 'Tapez les premières lettres du nom, de la marque ou l’identifiant…')}
            value={q}
            onChange={(e) => { setQ(e.target.value); setOuvert(true); setActif(0); }}
            onFocus={() => { if (q.trim()) setOuvert(true); }}
            onBlur={() => setOuvert(false)}
            onKeyDown={onKeyDown} />
        </span>
        {edition && (value || orphelin) && (
          <button type="button" className="btn ghost no-print" onClick={() => { setEdition(false); setQ(''); focusApres.current = 'changer'; }}>
            Annuler
          </button>
        )}
        <div className="cf-pop" hidden={!montre}>
          <ul ref={liste} id={listId} role="listbox" aria-label={`Propositions : ${labelTexte ?? (typeof label === 'string' ? label : nom)}`}>
            {montre && items.map((e, i) => (
              <li key={e.id} id={`${listId}-${i}`} data-i={i} role="option" aria-selected={i === actifBorne}
                className={i === actifBorne ? 'on' : undefined}
                onMouseDown={(ev) => ev.preventDefault()} onMouseMove={() => { if (i !== actifBorne) setActif(i); }}
                onClick={() => choisir(e)}>
                <Icon name={e.kind} size={16} />
                <span className="cf-txt">
                  <b><Surligne texte={nomAffiche(e)} q={term} /></b>
                  {detailFiche(e) && <small><Surligne texte={detailFiche(e)} q={term} /></small>}
                </span>
                {e.code ? <span className="mono"><Surligne texte={e.code} q={term} /></span> : <EntityCode code={null} kind={e.kind} />}
              </li>
            ))}
          </ul>
          {montre && items.length === 0 && <p className="cf-vide">{statut}</p>}
        </div>
        <span className="sr-only" role="status" aria-live="polite">{statut}</span>
      </div>
    </div>
  );
}
