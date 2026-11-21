import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type BlocModele, type Classement, type Modele, type TypeBloc } from '../../api';
import { formatDate, todayIso } from '../../lib/format';
import { qk } from '../../lib/queryKeys';
import { Empty, Etoile, Icon, MentionObligatoire, Section } from '../../ui';
import { useAutosave } from '../blocs/autosave';
import { BLOC_AIDE, BLOC_LABEL, estObligatoire, nouveauBloc, PALETTE, pourEnregistrer, valeursExemple } from '../blocs/blocs';
import { BlocApercu, BlocsPapier, Papier } from '../blocs/Papier';
import { BlocEditeur, type Deplacement } from './BlocEditeur';

interface Ligne {
  k: number;
  b: BlocModele;
}

/** Déplace l'élément `from` pour qu'il arrive au rang `to`. */
function deplacer<T>(xs: readonly T[], from: number, to: number): T[] {
  const out = xs.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/**
 * Sections 5.5 « Éditeur par blocs » et 5.6 « Aperçu direct » d'un modèle.
 * Le brouillon est local (monté à neuf pour chaque modèle) ; il est enregistré automatiquement
 * et recopié aussitôt dans le cache, pour que la liste 5.4 suive le nom en direct.
 * `actions` : boutons Dupliquer / Archiver / Gérer le Magasin / Supprimer, fournis par la page.
 */
export function Editeur({ modele, themes, magasin, actions }: {
  modele: Modele;
  themes: readonly Classement[];
  magasin: readonly Classement[];
  actions: ReactNode;
}) {
  const qc = useQueryClient();
  const seq = useRef(0);
  const [nom, setNom] = useState(modele.nom);
  const [themeId, setThemeId] = useState(modele.themeId);
  const [lignes, setLignes] = useState<Ligne[]>(() => modele.blocs.map((b) => ({ k: seq.current++, b })));
  const dernierNom = useRef(modele.nom);
  const save = useAutosave<{ nom: string; themeId: number; blocs: BlocModele[] }>({
    send: (s) => api.modeleEnregistrer(modele.id, s),
  });

  const themesProposes = themes.filter((t) => t.actif || t.id === themeId);
  const motsCles = magasin.filter((m) => m.actif).map((m) => m.nom).join(', ') || 'aucun mot-clé actif';

  /** Applique une modification : état local, cache (liste 5.4), enregistrement temporisé. */
  const appliquer = (next: { nom?: string; themeId?: number; lignes?: Ligne[] }) => {
    const n = next.nom ?? nom;
    const t = next.themeId ?? themeId;
    const l = next.lignes ?? lignes;
    if (next.nom !== undefined) setNom(n);
    if (next.themeId !== undefined) setThemeId(t);
    if (next.lignes !== undefined) setLignes(l);
    if (n.trim()) dernierNom.current = n.trim();
    const blocs = l.map((x) => x.b);
    const theme = themes.find((x) => x.id === t)?.nom ?? modele.theme;
    qc.setQueryData<Modele[]>(qk.modeles, (old) =>
      old?.map((m) => (m.id === modele.id ? { ...m, nom: dernierNom.current, themeId: t, theme, blocs } : m)));
    // Un nom vide n'est pas enregistré (le back le refuse) : on garde le dernier nom valide.
    save.schedule({ nom: dernierNom.current, themeId: t, blocs: blocs.map(pourEnregistrer) });
  };

  // ----- réordonnancement -----
  const blocsRef = useRef<HTMLDivElement>(null);
  const focusApres = useRef<{ k: number; act: Deplacement } | null>(null);
  // Bloc ajouté depuis la palette : il défile à l'écran et son premier champ prend le focus.
  const focusNouveau = useRef<number | null>(null);
  useEffect(() => {
    const k = focusNouveau.current;
    if (k === null || !blocsRef.current) return;
    focusNouveau.current = null;
    const el = blocsRef.current.querySelector<HTMLElement>(`[data-blk="${k}"] .bd .field`);
    el?.focus({ preventScroll: true });
    el?.closest('.blk')?.scrollIntoView({ block: 'nearest' });
  });
  useEffect(() => {
    const f = focusApres.current;
    if (!f || !blocsRef.current) return;
    focusApres.current = null;
    const el = blocsRef.current.querySelector<HTMLButtonElement>(`[data-blk="${f.k}"] [data-act="${f.act}"]`);
    const other = blocsRef.current.querySelector<HTMLButtonElement>(`[data-blk="${f.k}"] [data-act="${f.act === 'monter' ? 'descendre' : 'monter'}"]`);
    (el && !el.disabled ? el : other)?.focus();
  });
  const bouger = (i: number, sens: Deplacement) => {
    const to = sens === 'monter' ? i - 1 : i + 1;
    if (to < 0 || to >= lignes.length) return;
    focusApres.current = { k: lignes[i].k, act: sens };
    appliquer({ lignes: deplacer(lignes, i, to) });
  };

  // Glisser-déposer HTML5 : la poignée « arme » le bloc (draggable), le bloc survolé montre le point de dépôt.
  // La logique lit des refs (et la position du dépôt dans l'événement lui-même), jamais un état pas encore rendu.
  const [arme, setArme] = useState<number | null>(null);
  const [glisse, setGlisse] = useState<number | null>(null);
  const glisseRef = useRef<number | null>(null);
  const [cible, setCible] = useState<{ i: number; apres: boolean } | null>(null);
  const finGlisser = () => {
    glisseRef.current = null;
    setArme(null);
    setGlisse(null);
    setCible(null);
  };
  const apresMilieu = (e: DragEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientY > r.top + r.height / 2;
  };
  const survol = (i: number) => (e: DragEvent<HTMLDivElement>) => {
    if (glisseRef.current === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const apres = apresMilieu(e);
    setCible((c) => (c && c.i === i && c.apres === apres ? c : { i, apres }));
  };
  const dragProps = (i: number, k: number) => ({
    armed: arme === k,
    dragging: glisse === i,
    indicator: cible && cible.i === i && glisse !== null && glisse !== i ? (cible.apres ? 'apres' as const : 'avant' as const) : null,
    arm: (on: boolean) => setArme(on ? k : null),
    onDragStart: (e: DragEvent<HTMLDivElement>) => {
      if (arme !== k) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
      glisseRef.current = i;
      setGlisse(i);
    },
    onDragEnter: survol(i),
    onDragOver: survol(i),
    onDrop: (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const from = glisseRef.current;
      if (from !== null) {
        let to = apresMilieu(e) ? i + 1 : i;
        if (from < to) to -= 1;
        if (to !== from) appliquer({ lignes: deplacer(lignes, from, to) });
      }
      finGlisser();
    },
    onDragEnd: finGlisser,
  });

  const ajouter = (t: TypeBloc) => {
    const k = seq.current++;
    focusNouveau.current = k;
    appliquer({ lignes: [...lignes, { k, b: nouveauBloc(t) }] });
  };
  const variables = valeursExemple();
  const blocsApercu = lignes.map((l) => l.b);

  return (
    <>
      <Section num="5.5" title="Éditeur par blocs">
        <MentionObligatoire />
        <div className="form" style={{ maxWidth: 'none', gridTemplateColumns: '1fr 160px' }}>
          <label htmlFor="m-nom">
            <span>Nom du modèle<Etoile /></span>
            <input className="field" id="m-nom" required value={nom} aria-invalid={!nom.trim()} aria-describedby={!nom.trim() ? 'm-nom-vide' : undefined}
              onChange={(e) => appliquer({ nom: e.target.value })} />
            {!nom.trim() && <small id="m-nom-vide" className="champ-manque">Le nom du modèle est obligatoire. Tant qu’il est vide, le dernier nom est conservé.</small>}
          </label>
          <label htmlFor="m-theme">
            <span>Catégorie<Etoile /></span>
            <select className="field" id="m-theme" required value={themeId} onChange={(e) => appliquer({ themeId: Number(e.target.value) })}>
              {themesProposes.map((t) => <option key={t.id} value={t.id}>{t.actif ? t.nom : `${t.nom} (archivée)`}</option>)}
            </select>
          </label>
        </div>
        <div className="blocks" ref={blocsRef}>
          {lignes.length === 0 && <Empty>Ce modèle est vide. Ajoutez un premier bloc.</Empty>}
          {lignes.map((l, i) => (
            <BlocEditeur key={l.k} bloc={l.b} cle={l.k} rang={i} total={lignes.length} motsCles={motsCles}
              onChange={(b) => appliquer({ lignes: lignes.map((x) => (x.k === l.k ? { ...x, b } : x)) })}
              onRemove={() => appliquer({ lignes: lignes.filter((x) => x.k !== l.k) })}
              onMove={(sens) => bouger(i, sens)}
              drag={dragProps(i, l.k)} />
          ))}
        </div>
        <div className="palette-v11" role="group" aria-labelledby="palette-titre">
          <p className="palette-titre" id="palette-titre">
            <b>Champs personnalisés</b>
            <span>Cliquez sur un champ pour l’ajouter à la fin du modèle, puis réglez-le ci-dessus.</span>
          </p>
          {PALETTE.map((g) => (
            <div key={g.titre} className="palette-groupe">
              <p className="mh">{g.titre}</p>
              <div className="palette">
                {g.types.map((t) => (
                  <button key={t} type="button" title={BLOC_AIDE[t]} aria-label={`Ajouter : ${BLOC_LABEL[t]}`} onClick={() => ajouter(t)}>
                    <Icon name={t} />
                    <span className="pal-txt"><span>{BLOC_LABEL[t]}</span><small>{BLOC_AIDE[t]}</small></span>
                    <Icon name="plus" size={14} />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="acts studio-acts">{actions}</div>
      </Section>
      <Section num="5.6" title="Aperçu direct">
        <div className="preview" style={{ position: 'static' }}>
          <div className="pv-b">
            <Papier titre={nom}
              date={<span className="p-date">Date du document<span className="field ro">{formatDate(todayIso())}</span></span>}>
              <p>La date est ajoutée automatiquement et reste modifiable dans chaque document.</p>
              {blocsApercu.some((b) => estObligatoire(b)) && <MentionObligatoire />}
              <BlocsPapier blocs={blocsApercu} rendre={(i) => <BlocApercu bloc={blocsApercu[i]} variables={variables} />} />
            </Papier>
          </div>
        </div>
      </Section>
    </>
  );
}
