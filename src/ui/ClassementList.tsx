import { useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { Classement } from '../api';
import { useAction } from '../lib/action';
import { ErrorAlert } from './Alert';
import { Badge } from './Badge';
import { Empty } from './controls';
import { ConfirmModal } from './dialogs';
import { Icon, type IconName } from './Icon';
import { Etoile, MentionObligatoire, useChampsObligatoires } from './Obligatoire';

/** Suppression d'un élément (structures et types de machine, § 9.1 ; catégories des dossiers et des modèles, § 16). */
export interface SuppressionClassement<T> {
  action: (id: number) => Promise<unknown>;
  /** Titre de la confirmation : « Supprimer la structure ? » (ou selon l'élément : « Supprimer le mot-clé « RAM » ? »). */
  titre: string | ((x: T) => string);
  /** Texte de la confirmation. */
  message: (x: T) => string;
  /** Pourquoi la suppression est indisponible, ou null si elle est possible. */
  motifImpossible: (x: T) => string | null;
}

export interface ClassementListProps<T extends Classement> {
  items: readonly T[];
  /** Icône devant chaque nom (Magasin : 'magasin'). Sans icône : nom seul, comme les thèmes du prototype. */
  icon?: IconName;
  /** Archive ↔ réactive (ex. `api.themeBasculer`). Erreur : bandeau global. */
  toggle: (id: number) => Promise<unknown>;
  /** Ajoute un élément (ex. `api.themeCreer`). Erreur (doublon…) : affichée sous le formulaire. */
  create: (nom: string) => Promise<unknown>;
  /** Texte d'aide du champ d'ajout, aussi utilisé comme nom accessible si `inputLabel` est absent. */
  placeholder: string;
  inputLabel?: string;
  submitLabel: string;
  /** Bouton d'ajout en `.btn.primary` (Magasin) ou `.btn` (Paramètres). */
  primary?: boolean;
  empty?: string;
  /** Renommer en place (catégories, structures, types de machine). Absent : pas de bouton « Renommer ». */
  rename?: (id: number, nom: string) => Promise<unknown>;
  /** Supprimer avec confirmation. Absent : pas de bouton « Supprimer ». */
  remove?: SuppressionClassement<T>;
  /** Information à côté du nom (nombre de fiches…). */
  detail?: (x: T) => ReactNode;
}

/**
 * Liste « nom · badge Actif/Archivé · bouton Archiver/Réactiver » + formulaire d'ajout en ligne (`.set`).
 * Sert aux catégories (thèmes en interne), structures, types de machine (Paramètres 6.2) et aux mots-clés du Magasin (5.7).
 * Tous ajoutent « Renommer » (en place) et « Supprimer » (avec confirmation ; quand c'est impossible, le bouton reste
 * atteignable et explique pourquoi) ; les mots-clés du Magasin depuis la 1.8 (§ 17).
 */
export function ClassementList<T extends Classement>({
  items, icon, toggle, create, placeholder, inputLabel, submitLabel, primary, empty, rename, remove, detail,
}: ClassementListProps<T>) {
  const [nom, setNom] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const [enEdition, setEnEdition] = useState<number | null>(null);
  const retourFocus = useRef<number | null>(null);
  const baseId = useId();
  const [motifVu, setMotifVu] = useState<number | null>(null);
  const [aSupprimer, setASupprimer] = useState<T | null>(null);
  const basculer = useAction(toggle);
  const ajouter = useAction(create, {
    errors: 'local',
    onSuccess: () => {
      setNom('');
      input.current?.focus();
    },
  });
  const oblig = useChampsObligatoires();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (oblig.verifier(e)) ajouter.mutate(nom.trim());
  };
  return (
    <div className="set">
      {items.length === 0 && empty && <Empty>{empty}</Empty>}
      {items.map((x) => {
        const motif = remove ? remove.motifImpossible(x) : null;
        if (rename && enEdition === x.id) {
          return (
            <RenommerEnPlace key={x.id} item={x} rename={rename}
              onClose={() => { retourFocus.current = x.id; setEnEdition(null); }} />
          );
        }
        return (
          <div className="cl-item" key={x.id}>
            <div className="line">
              <span className="cl-nom">
                <b style={icon ? { fontWeight: 500, display: 'flex', gap: 8, alignItems: 'center' } : { fontWeight: 500 }}>
                  {icon && <Icon name={icon} />}
                  {x.nom}
                </b>
                {detail && <small>{detail(x)}</small>}
              </span>
              <span className="cl-acts">
                <Badge kind={x.actif ? 'actif' : 'archive'} />
                {rename && (
                  <button type="button" className="btn" aria-label={`Renommer ${x.nom}`}
                    ref={(el) => {
                      // Fin du renommage : le focus revient sur « Renommer » de la même ligne.
                      if (el && retourFocus.current === x.id) {
                        retourFocus.current = null;
                        el.focus();
                      }
                    }}
                    onClick={() => { setEnEdition(x.id); setMotifVu(null); }}>
                    Renommer
                  </button>
                )}
                <button type="button" className="btn" disabled={basculer.isPending}
                  aria-label={`${x.actif ? 'Archiver' : 'Réactiver'} ${x.nom}`} onClick={() => basculer.mutate(x.id)}>
                  {x.actif ? 'Archiver' : 'Réactiver'}
                </button>
                {remove && (
                  // Indisponible : le bouton reste atteignable au clavier (aria-disabled), annonce le motif, et
                  // l'affiche sous la ligne quand on l'actionne.
                  <button type="button" className={motif ? 'btn indispo' : 'btn'} aria-label={`Supprimer ${x.nom}`}
                    aria-disabled={motif ? true : undefined} aria-expanded={motif ? motifVu === x.id : undefined}
                    aria-describedby={motif ? `${baseId}-motif-${x.id}` : undefined}
                    title={motif ?? undefined}
                    onClick={() => (motif ? setMotifVu((v) => (v === x.id ? null : x.id)) : setASupprimer(x))}>
                    Supprimer
                  </button>
                )}
                {motif && <span className="sr-only" id={`${baseId}-motif-${x.id}`}>{motif}</span>}
              </span>
            </div>
            {motif && motifVu === x.id && (
              <p className="cl-motif" role="status">
                <Icon name="info" size={14} />
                <span><b>Suppression impossible.</b> {motif}</span>
              </p>
            )}
          </div>
        );
      })}
      <form className={oblig.classe('inline')} noValidate onSubmit={submit} onInput={oblig.revoir}>
        <label className="inline-lib" htmlFor={`${baseId}-ajout`}>{inputLabel ?? placeholder}<Etoile /></label>
        <input ref={input} className="field" id={`${baseId}-ajout`} placeholder={placeholder} required
          value={nom} onChange={(e) => { setNom(e.target.value); if (ajouter.error) ajouter.reset(); }} />
        <button className={primary ? 'btn primary' : 'btn'} disabled={ajouter.isPending}>{submitLabel}</button>
        <MentionObligatoire className="inline-mention" />
      </form>
      <ErrorAlert error={oblig.erreur ?? ajouter.error} />
      {remove && aSupprimer && (
        <ConfirmModal title={typeof remove.titre === 'function' ? remove.titre(aSupprimer) : remove.titre} message={remove.message(aSupprimer)} confirmLabel="Supprimer"
          action={() => remove.action(aSupprimer.id)} onClose={() => setASupprimer(null)} />
      )}
    </div>
  );
}

/** Renommer en place : champ prérempli et sélectionné ; Entrée enregistre, Échap annule. */
function RenommerEnPlace<T extends Classement>({ item, rename, onClose }: {
  item: T;
  rename: (id: number, nom: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [valeur, setValeur] = useState(item.nom);
  const run = useAction((nom: string) => rename(item.id, nom), { errors: 'local', onSuccess: onClose });
  const oblig = useChampsObligatoires();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!oblig.verifier(e)) return;
    const v = valeur.trim();
    if (v === item.nom) onClose();
    else run.mutate(v);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };
  return (
    <div className="cl-item">
      <form className={oblig.classe('line cl-renommer')} noValidate onSubmit={submit} onInput={oblig.revoir}>
        <span className="cl-renommer-lib" aria-hidden="true">Nouveau nom<Etoile /></span>
        <input className="field" autoFocus required aria-label={`Nouveau nom de ${item.nom}`} value={valeur}
          onFocus={(e) => e.currentTarget.select()} onKeyDown={onKeyDown}
          onChange={(e) => { setValeur(e.target.value); if (run.error) run.reset(); }} />
        <span className="cl-acts">
          <button className="btn primary" disabled={run.isPending}>Enregistrer</button>
          <button type="button" className="btn ghost" onClick={onClose}>Annuler</button>
        </span>
        <MentionObligatoire className="inline-mention" />
      </form>
      <ErrorAlert error={oblig.erreur ?? run.error} title="Nom non enregistré" />
    </div>
  );
}
