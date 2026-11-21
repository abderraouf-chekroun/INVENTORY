import { useState, type FormEvent, type ReactNode } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, BORNES_BLOCS, type ApiError, type Categorie, type Entite, type Kind, type SaisieEmploye, type SaisieMachine } from '../api';
import { useAction } from '../lib/action';
import { categoryLabel, enumeration, manquesEmploye, nomAffiche, texte } from '../lib/format';
import { useCategories, useEntites } from '../lib/queries';
import { qk } from '../lib/queryKeys';
import { nav, repNavId, useBreadcrumb, useNav, type PageProps } from '../nav';
import { Alert, Etoile, ErrorAlert, MentionObligatoire, PageHeader, QueryView, Section, Select, useChampsObligatoires } from '../ui';
import { AlerteFicheSupprimee } from './fiche/Suppression';

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

const DATE_INCOMPLETE: ApiError = { code: 'invalide', message: 'La date de naissance est incomplète ou impossible. Complétez-la.' };

/** Date `AAAA-MM-JJ` plausible, sinon null (un champ date en cours de frappe peut donner « 0002-… »). */
const dateValide = (s: string): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0, 4)) >= 1900 ? s : null);

/** Après l'enregistrement : la fiche. Création → Retour ramène au répertoire (comme le prototype). */
function apresEnregistrement(e: Entite, creation: boolean) {
  if (creation) {
    nav.root({ name: 'rep', kind: e.kind });
    nav.go({ name: 'fiche', id: e.id });
    return;
  }
  // Modification ouverte depuis la fiche : on y revient sans l'empiler une seconde fois.
  const { stack } = useNav.getState();
  const prev = stack[stack.length - 1];
  if (prev && prev.name === 'fiche' && prev.id === e.id) nav.back();
  else nav.replace({ name: 'fiche', id: e.id });
}

/** Catégories proposées : les actives du répertoire, plus la catégorie actuelle de la fiche si elle a été archivée. */
function optionsCategories(kind: Kind, categories: readonly Categorie[], actuelle: number | undefined) {
  return categories
    .filter((c) => c.kind === kind && (c.actif || c.id === actuelle))
    .sort((p, q) => collator.compare(p.nom, q.nom))
    .map((c): readonly [string, string] => [String(c.id), c.actif ? c.nom : `${c.nom} (archivé)`]);
}

/** Libellé + champ, avec une petite aide facultative ; étoile rouge si le champ est obligatoire (§ 10.6). */
function Champ({ id, label, aide, obligatoire, children }: {
  id: string; label: string; aide?: ReactNode; obligatoire?: boolean; children: ReactNode;
}) {
  return (
    <label htmlFor={id}>
      <span>{label}{obligatoire && <Etoile />}{aide && <> <small>{aide}</small></>}</span>
      {children}
    </label>
  );
}

function Boutons({ creation, disabled }: { creation: boolean; disabled: boolean }) {
  return (
    <div className="acts">
      <button className="btn primary lg" disabled={disabled}>
        {creation ? 'Enregistrer la fiche' : 'Enregistrer les modifications'}
      </button>
      <button type="button" className="btn lg" onClick={() => nav.back()}>Annuler</button>
    </div>
  );
}

/**
 * Aucune structure (employés) ou aucun type de machine (machines) actif. Sur une base neuve (§ 14), il n'y en a aucun :
 * le premier se crée ici, sans quitter le formulaire ni perdre ce qui est déjà saisi, et il est aussitôt choisi.
 * S'il en existe d'archivés, ils se réactivent dans les Paramètres (6.2).
 */
function AucuneCategorie({ kind, archivees, onCreee }: { kind: Kind; archivees: number; onCreee: (c: Categorie) => void }) {
  const a = kind === 'a';
  const [nom, setNom] = useState('');
  const creer = useAction((n: string) => api.categorieCreer(kind, n), { errors: 'local', onSuccess: (c) => onCreee(c) });
  const oblig = useChampsObligatoires();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (oblig.verifier(e)) creer.mutate(nom.trim());
  };
  const titre = archivees > 0
    ? (a ? 'Aucune structure active' : 'Aucun type de machine actif')
    : (a ? 'Aucune structure pour l’instant' : 'Aucun type de machine pour l’instant');
  const texte = (a
    ? 'Chaque employé appartient à une structure (division, service…). Créez-la ici : elle sera choisie pour cet employé.'
    : 'Chaque machine a un type (PC de bureau, ordinateur portable…). Créez-le ici : il sera choisi pour cette machine.')
    + (archivees > 0
      ? ` Pour réactiver ${a ? 'une structure archivée' : 'un type archivé'}, ouvrez les Paramètres (section 6.2).`
      : '');
  return (
    <>
      <Alert tone="warn" title={titre} text={texte}>
        <form className={oblig.classe('saisie-code')} noValidate onSubmit={submit} onInput={oblig.revoir}>
          <label className="saisie-code-lib" htmlFor="n-cat-nouvelle">
            {a ? 'Nom de la nouvelle structure' : 'Nom du nouveau type de machine'}<Etoile />
          </label>
          <input className="field" id="n-cat-nouvelle" required style={{ width: 220 }} autoComplete="off"
            placeholder={a ? 'Ex. : Division informatique' : 'Ex. : PC de bureau'} value={nom}
            onChange={(e) => { setNom(e.target.value); if (creer.error) creer.reset(); }} />
          <button className="btn primary" disabled={creer.isPending}>{a ? 'Créer la structure' : 'Créer le type'}</button>
          {archivees > 0 && (
            <button type="button" className="btn" onClick={() => nav.go({ name: 'parametres' })}>Ouvrir les Paramètres</button>
          )}
          <MentionObligatoire className="inline-mention" />
        </form>
      </Alert>
      <ErrorAlert error={oblig.erreur ?? creer.error} title={a ? 'Structure non créée' : 'Type de machine non créé'} />
    </>
  );
}

/** Le bandeau « Aucune structure » disparaît après la création : le focus va au champ `id`, une fois la page rendue. */
const focaliserApres = (id: string) => window.setTimeout(() => document.getElementById(id)?.focus(), 0);

/** Catégories archivées du répertoire (pour le message « Aucune … active »). */
const nbArchivees = (kind: Kind, categories: readonly Categorie[]) =>
  categories.filter((c) => c.kind === kind && !c.actif).length;

/**
 * Identifiant qui sera attribué à l'employé, calculé par le back pendant la saisie (§ 10.5). Il est affiché tel quel,
 * sans rien dire de sa composition.
 */
function ApercuIdentifiant({ nom, prenom, dateNaissance, poste, entite }: {
  nom: string; prenom: string; dateNaissance: string | null; poste: string; entite: Entite | null;
}) {
  const manques = manquesEmploye({ nom, prenom, dateNaissance, poste });
  const saisie = { nom: nom.trim(), prenom: prenom.trim(), dateNaissance, poste: poste.trim() };
  const apercu = useQuery({
    queryKey: qk.identifiantApercu(saisie.nom, saisie.prenom, dateNaissance, saisie.poste, entite?.id ?? null),
    queryFn: () => api.identifiantEmployeApercu(saisie, entite?.id ?? null),
    enabled: manques.length === 0,
    placeholderData: keepPreviousData,
  });
  let valeur: ReactNode;
  let note: string;
  if (manques.length > 0) {
    valeur = <span className="id-vide">À venir</span>;
    note = `Il s’affichera dès que ${enumeration(manques)} ${manques.length > 1 ? 'seront remplis' : 'sera rempli'}.`;
  } else if (apercu.isError) {
    valeur = <span className="id-vide">—</span>;
    note = 'L’identifiant ne peut pas être calculé pour l’instant.';
  } else if (apercu.data === undefined) {
    valeur = <span className="id-vide">Calcul…</span>;
    note = 'Calcul de l’identifiant…';
  } else if (apercu.data === null) {
    valeur = <span className="id-vide">À venir</span>;
    note = 'Il manque une information pour attribuer l’identifiant.';
  } else {
    valeur = <span className="mono">{apercu.data}</span>;
    note = entite?.code && entite.code === apercu.data
      ? 'Identifiant actuel, conservé.'
      : 'Attribué automatiquement à l’enregistrement de la fiche.';
  }
  return (
    <div className="id-apercu" role="status" aria-live="polite" aria-atomic="true">
      <span className="id-tete">Identifiant qui sera attribué</span>
      <b>{valeur}</b>
      <small>{note}</small>
    </div>
  );
}

function FormulaireEmploye({ entite, categories }: { entite: Entite | null; categories: readonly Categorie[] }) {
  const creation = entite === null;
  const ids = { nom: 'n-nom', prenom: 'n-prenom', naissance: 'n-naissance', poste: 'n-poste', cat: 'n-cat' };
  const options = optionsCategories('a', categories, entite?.categorieId);
  const aucune = options.length === 0;
  const [nom, setNom] = useState(entite?.nom ?? '');
  const [prenom, setPrenom] = useState(texte(entite?.prenom));
  const [naissance, setNaissance] = useState(texte(entite?.dateNaissance));
  const [poste, setPoste] = useState(texte(entite?.poste));
  const [cat, setCat] = useState(entite ? String(entite.categorieId) : (options[0]?.[0] ?? ''));
  const [dateKo, setDateKo] = useState(false);

  const enregistrer = useAction(
    (s: SaisieEmploye) => (entite ? api.entiteModifier(entite.id, s) : api.entiteCreer(s)),
    { errors: 'local', onSuccess: (e) => apresEnregistrement(e, creation) },
  );
  const oblig = useChampsObligatoires();
  const dateNaissance = dateValide(naissance);

  // § 10.6 : nom, prénom, date de naissance, poste et structure sont obligatoires, à la création comme à la modification.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!oblig.verifier(e)) return;
    if (aucune) return;
    if (dateNaissance === null) {
      setDateKo(true);
      document.getElementById(ids.naissance)?.focus();
      return;
    }
    setDateKo(false);
    enregistrer.mutate({
      kind: 'a', nom: nom.trim(), prenom: prenom.trim(), dateNaissance, poste: poste.trim(), categorieId: Number(cat),
    });
  };

  return (
    <>
      {aucune && (
        <AucuneCategorie kind="a" archivees={nbArchivees('a', categories)}
          onCreee={(c) => { setCat(String(c.id)); focaliserApres(nom.trim() ? ids.cat : ids.nom); }} />
      )}
      <form className={oblig.classe('form')} noValidate onSubmit={submit} onInput={oblig.revoir}>
        <MentionObligatoire />
        <Champ id={ids.nom} label="Nom" obligatoire>
          <input className="field" id={ids.nom} required placeholder="Nom de famille" autoComplete="off" value={nom}
            onChange={(e) => setNom(e.target.value)} autoFocus={!creation} />
        </Champ>
        <Champ id={ids.prenom} label="Prénom" obligatoire>
          <input className="field" id={ids.prenom} required placeholder="Prénom" autoComplete="off" value={prenom}
            onChange={(e) => setPrenom(e.target.value)} />
        </Champ>
        <Champ id={ids.naissance} label="Date de naissance" obligatoire>
          <input className="field" id={ids.naissance} type="date" required value={naissance} aria-invalid={dateKo || undefined}
            onChange={(e) => { setNaissance(e.target.value); setDateKo(false); }} />
        </Champ>
        <Champ id={ids.poste} label="Poste" aide="Grade ou fonction" obligatoire>
          <input className="field" id={ids.poste} required placeholder="Technicien, ingénieur, secrétaire…" autoComplete="off" value={poste}
            onChange={(e) => setPoste(e.target.value)} />
        </Champ>
        <ApercuIdentifiant nom={nom} prenom={prenom} dateNaissance={dateNaissance} poste={poste} entite={entite} />
        <Champ id={ids.cat} label={categoryLabel('a')} obligatoire>
          <Select<string> id={ids.cat} value={aucune ? '' : cat} onChange={setCat} disabled={aucune} required
            options={aucune ? [['', nbArchivees('a', categories) ? 'Aucune structure active' : 'Aucune structure pour l’instant']] : options} />
        </Champ>
        <ErrorAlert error={oblig.erreur ?? (dateKo ? DATE_INCOMPLETE : enregistrer.error)} title="Enregistrement impossible" />
        <Boutons creation={creation} disabled={aucune || enregistrer.isPending} />
      </form>
    </>
  );
}

function FormulaireMachine({ entite, categories }: { entite: Entite | null; categories: readonly Categorie[] }) {
  const creation = entite === null;
  const options = optionsCategories('b', categories, entite?.categorieId);
  const aucune = options.length === 0;
  const [nom, setNom] = useState(entite?.nom ?? '');
  const [code, setCode] = useState(entite?.code ?? '');
  const [marque, setMarque] = useState(texte(entite?.marque));
  const [cpu, setCpu] = useState(texte(entite?.cpu));
  const [ram, setRam] = useState(texte(entite?.ram));
  const [stockage, setStockage] = useState(texte(entite?.stockage));
  const [cat, setCat] = useState(entite ? String(entite.categorieId) : (options[0]?.[0] ?? ''));

  const enregistrer = useAction(
    (s: SaisieMachine) => (entite ? api.entiteModifier(entite.id, s) : api.entiteCreer(s)),
    { errors: 'local', onSuccess: (e) => apresEnregistrement(e, creation) },
  );
  const oblig = useChampsObligatoires();

  // § 10.6 : nom et type de machine obligatoires ; l'identifiant reste facultatif.
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!oblig.verifier(e)) return;
    if (aucune) return;
    enregistrer.mutate({
      kind: 'b', nom: nom.trim(), code: code.trim() === '' ? null : code.trim(),
      marque: marque.trim(), cpu: cpu.trim(), ram: ram.trim(), stockage: stockage.trim(), categorieId: Number(cat),
    });
  };

  const aideCode = creation
    ? `Saisi à la main, ${BORNES_BLOCS.identifiantMachineMax} caractères au plus, propre à chaque machine. Facultatif à la création.`
    : 'Propre à chaque machine. Vide : la fiche revient dans l’inventaire à compléter.';

  return (
    <>
      {aucune && (
        <AucuneCategorie kind="b" archivees={nbArchivees('b', categories)}
          onCreee={(c) => { setCat(String(c.id)); focaliserApres(nom.trim() ? 'n-cat' : 'n-nom'); }} />
      )}
      <form className={oblig.classe('form')} noValidate onSubmit={submit} onInput={oblig.revoir}>
        <MentionObligatoire />
        <Champ id="n-nom" label="Nom" obligatoire>
          <input className="field" id="n-nom" required placeholder="PC Accueil, Portable direction…" autoComplete="off" value={nom}
            onChange={(e) => setNom(e.target.value)} autoFocus={!creation} />
        </Champ>
        <Champ id="n-code" label="Identifiant" aide={aideCode}>
          <input className="field mono" id="n-code" maxLength={BORNES_BLOCS.identifiantMachineMax} placeholder="Numéro d’inventaire, par exemple PC-0412"
            autoComplete="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
        </Champ>
        <Champ id="n-marque" label="Marque et modèle">
          <input className="field" id="n-marque" placeholder="Dell OptiPlex 7090" autoComplete="off" value={marque}
            onChange={(e) => setMarque(e.target.value)} />
        </Champ>
        <Champ id="n-cpu" label="Processeur">
          <input className="field" id="n-cpu" placeholder="Intel Core i5-10500" autoComplete="off" value={cpu}
            onChange={(e) => setCpu(e.target.value)} />
        </Champ>
        <div className="form-paire">
          <Champ id="n-ram" label="RAM">
            <input className="field" id="n-ram" placeholder="16 Go" autoComplete="off" value={ram} onChange={(e) => setRam(e.target.value)} />
          </Champ>
          <Champ id="n-stockage" label="Stockage">
            <input className="field" id="n-stockage" placeholder="SSD 512 Go" autoComplete="off" value={stockage}
              onChange={(e) => setStockage(e.target.value)} />
          </Champ>
        </div>
        <Champ id="n-cat" label={categoryLabel('b')} obligatoire>
          <Select<string> id="n-cat" value={aucune ? '' : cat} onChange={setCat} disabled={aucune} required
            options={aucune ? [['', nbArchivees('b', categories) ? 'Aucun type de machine actif' : 'Aucun type de machine pour l’instant']] : options} />
        </Champ>
        <ErrorAlert error={oblig.erreur ?? enregistrer.error} title="Enregistrement impossible" />
        <Boutons creation={creation} disabled={aucune || enregistrer.isPending} />
      </form>
    </>
  );
}

function Formulaire({ kind, entite, categories }: { kind: Kind; entite: Entite | null; categories: readonly Categorie[] }) {
  return kind === 'a'
    ? <FormulaireEmploye entite={entite} categories={categories} />
    : <FormulaireMachine entite={entite} categories={categories} />;
}

/** Formulaire de fiche : création (Module 5, sections 5.2 / 5.3) et modification (`route.id` présent). */
export default function FormEntite({ route }: PageProps<'form-entite'>) {
  const { kind } = route;
  const n = kind === 'a' ? 2 : 3;
  const edition = route.id !== undefined;
  const categories = useCategories(kind);
  const entites = useEntites(kind);
  const entite = edition ? entites.data?.find((x) => x.id === route.id) : undefined;

  // Modification : « Employés › BENALI Sofia › Modifier la fiche », Employés allumé.
  useBreadcrumb(
    edition && entite && [{ label: nomAffiche(entite), to: { name: 'fiche', id: entite.id } }, { label: 'Modifier la fiche' }],
    { module: edition ? repNavId(kind) : undefined },
  );

  if (!edition) {
    return (
      <>
        <PageHeader eyebrow="Formulaire" title={kind === 'a' ? 'Créer un employé' : 'Créer une machine'}
          lead={kind === 'a'
            ? 'L’identifiant de l’employé est attribué automatiquement : il s’affiche dès que la fiche est remplie.'
            : 'L’identifiant de la machine peut être saisi plus tard : la fiche apparaîtra alors dans l’inventaire à compléter.'} />
        <Section num={kind === 'a' ? '5.2' : '5.3'} title={kind === 'a' ? 'Informations de l’employé' : 'Informations de la machine'}>
          <QueryView query={categories}>{(cats) => <Formulaire kind={kind} entite={null} categories={cats} />}</QueryView>
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader eyebrow="Fiche" title="Modifier la fiche"
        lead={`${kind === 'a' ? 'Informations de l’employé' : 'Informations de la machine'}${entite ? ` ${nomAffiche(entite)}` : ''}. La modification est inscrite au journal de la fiche.`} />
      <Section num={`${n}.5`} title={kind === 'a' ? 'Informations de l’employé' : 'Informations de la machine'}>
        <QueryView query={categories}>
          {(cats) => (
            <QueryView query={entites}>
              {/* Le formulaire copie la fiche dans son état local à l'ouverture : il attend donc la relecture du back.
                  Une liste encore en cache peut être périmée (identifiant saisi depuis la fiche, fiche complétée…),
                  et l'enregistrer effacerait ce qui a changé entre-temps. */}
              {() => (!entites.isFetchedAfterMount ? null : entite
                ? <Formulaire kind={kind} entite={entite} categories={cats} />
                : <AlerteFicheSupprimee kind={kind} />)}
            </QueryView>
          )}
        </QueryView>
      </Section>
    </>
  );
}

