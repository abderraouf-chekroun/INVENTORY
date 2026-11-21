import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { api, BORNES_BLOCS, versApiError, type Entite, type Evenement, type FicheEntite, type TypeEvenement } from '../api';
import { useAction } from '../lib/action';
import { libelleAffecter, repartirAffectations } from '../lib/affectations';
import { useFichesSupprimees } from '../lib/fichesSupprimees';
import { categoryLabel, enumeration, formatDate, manquesEmploye, nomAffiche, texte } from '../lib/format';
import { useFiche } from '../lib/queries';
import { nav, repNavId, useBreadcrumb, type PageProps, type RouteOf } from '../nav';
import {
  Alert, Badge, Empty, EntityCode, Etoile, ErrorAlert, FolderCard, Icon, MentionObligatoire, PageHeader, QueryView, Section, Tabs,
  useChampsObligatoires,
} from '../ui';
import { AffecterModal, ListeAffectations } from './fiche/Affectations';
import { DocumentsNommes, HistoriqueFiltrable } from './fiche/Recherche';
import { FicheSupprimeePage, SupprimerFicheModal } from './fiche/Suppression';

/* Onglets et journal (spécification § 4 « Journal », § 9.3) :
   A · « Journal chronologique » = affectations + événements de dossier ; « Historique complet » = tout.
   B · « Historique des affectations » = début et fin des affectations ; « Journal des opérations » = tout le reste.
   Les types techniques 'association' / 'dissociation' désignent le début et la fin d'une affectation.
   Chaque onglet d'historique a son champ de recherche (§ 11.3). */
const ASSOCIATION: ReadonlySet<TypeEvenement> = new Set<TypeEvenement>(['association', 'dissociation']);
// Événements des dossiers où la fiche est nommée, et nominations (§ 11.2). 'dossier_fiches' ne vient plus que du
// journal d'une version précédente (rattachement d'un dossier, retiré en 1.4) : il reste affiché.
// § 15 : 'dossier_supprime', trace d'un dossier supprimé où la fiche était nommée (texte seul, sans lien).
const DOSSIER: ReadonlySet<TypeEvenement> = new Set<TypeEvenement>([
  'dossier_ouvert', 'dossier_rouvert', 'piece_manquante', 'piece_ajoutee', 'dossier_clos',
  'statut_modifie', 'dossier_fiches', 'nomination', 'dossier_supprime',
]);
const filtrer = (ev: readonly Evenement[], garder: (t: TypeEvenement) => boolean) => ev.filter((e) => garder(e.type));

/** Machine sans identifiant : alerte avec la saisie de l'identifiant (focus automatique depuis l'inventaire à compléter). */
function SaisieCode({ entite, autoFocus }: { entite: Entite; autoFocus: boolean }) {
  const [code, setCode] = useState('');
  const enregistrer = useAction((c: string) => api.entiteDefinirCode(entite.id, c), { errors: 'local' });
  const oblig = useChampsObligatoires();
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (oblig.verifier(e)) enregistrer.mutate(code.trim());
  };
  return (
    <>
      <Alert tone="bad" title="Identifiant manquant"
        text={`Cette machine n’a pas encore d’identifiant. Saisissez-le : ${BORNES_BLOCS.identifiantMachineMax} caractères au plus, propre à chaque machine.`}>
        <form className={oblig.classe('saisie-code')} noValidate onSubmit={submit} onInput={oblig.revoir}>
          <label className="saisie-code-lib" htmlFor="code-input">Identifiant de la machine<Etoile /></label>
          <input className="field mono" id="code-input" maxLength={BORNES_BLOCS.identifiantMachineMax} placeholder="Ex. : PC-0000"
            required style={{ width: 180 }} autoComplete="off" spellCheck={false} autoFocus={autoFocus} value={code}
            onChange={(e) => setCode(e.target.value)} />
          <button className="btn primary" disabled={enregistrer.isPending}>Enregistrer l’identifiant</button>
          <MentionObligatoire className="inline-mention" />
        </form>
      </Alert>
      <ErrorAlert error={oblig.erreur ?? enregistrer.error} title="Identifiant non enregistré" />
    </>
  );
}

/** Employé sans identifiant : ce qui manque, et le chemin vers le formulaire. */
function ACompleter({ entite, autoFocus }: { entite: Entite; autoFocus: boolean }) {
  const manques = manquesEmploye({
    nom: entite.nom, prenom: texte(entite.prenom), dateNaissance: entite.dateNaissance, poste: texte(entite.poste),
  });
  return (
    <Alert tone="bad" title="Fiche à compléter"
      text={manques.length
        ? `Il manque ${enumeration(manques)}. L’identifiant de l’employé sera attribué automatiquement dès que la fiche sera complète.`
        : 'L’identifiant de l’employé sera attribué à la prochaine modification de la fiche.'}>
      <button type="button" className="btn primary" autoFocus={autoFocus}
        onClick={() => nav.go({ name: 'form-entite', kind: 'a', id: entite.id })}>
        Compléter la fiche
      </button>
    </Alert>
  );
}

/** Contenu d'un onglet (`role="tabpanel"`). */
function Panneau({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="tabpanel" aria-label={label} style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      {children}
    </div>
  );
}

function Onglets({ f, route }: { f: FicheEntite; route: RouteOf<'fiche'> }) {
  const x = f.entite;
  // L'onglet est gardé dans la route (nav.update, sans changer de page) : après un lien de l'historique, Retour
  // ramène à cet onglet, et la page défile jusqu'à lui.
  const [tab, setTab] = useState(route.onglet ?? 0);
  const zone = useRef<HTMLDivElement>(null);
  const retour = useRef(route.onglet !== undefined);
  useEffect(() => {
    if (retour.current) zone.current?.scrollIntoView({ block: 'start' });
  }, []);
  const choisir = (i: number) => {
    setTab(i);
    const { focusCode: _focus, ...reste } = route;   // au retour, pas de nouveau focus sur l'identifiant
    nav.update({ ...reste, onglet: i });
  };
  // Dossiers liés (§ 11.2) : ceux qui contiennent un document où la fiche est nommée.
  const ongletDossiers = {
    label: 'Dossiers liés', count: f.dossiers.length,
    body: f.dossiers.length ? (
      <div className="folders">{f.dossiers.map((d) => <FolderCard key={d.id} dossier={d} />)}</div>
    ) : (
      <Empty>
        {x.kind === 'a'
          ? 'Aucun dossier lié : cet employé n’est nommé dans aucun document.'
          : 'Aucun dossier lié : cette machine n’est nommée dans aucun document.'}
      </Empty>
    ),
  };
  const historique = (items: readonly Evenement[], empty?: string) => <HistoriqueFiltrable courante={x.id} items={items} empty={empty} />;

  const tabs: { label: string; count?: number; body: ReactNode }[] = x.kind === 'a'
    ? [
      ongletDossiers,
      { label: 'Journal chronologique', body: historique(filtrer(f.evenements, (t) => ASSOCIATION.has(t) || DOSSIER.has(t))) },
      { label: 'Historique complet', body: historique(f.evenements) },
    ]
    : [
      {
        label: 'Historique des affectations',
        body: historique(filtrer(f.evenements, (t) => ASSOCIATION.has(t)), 'Aucune affectation pour cette machine.'),
      },
      { label: 'Journal des opérations', body: historique(filtrer(f.evenements, (t) => !ASSOCIATION.has(t))) },
      ongletDossiers,
    ];
  const i = Math.max(0, Math.min(Number.isInteger(tab) ? tab : 0, tabs.length - 1));
  const courant = tabs[i];
  return (
    <div ref={zone} className="fiche-onglets">
      <Tabs tabs={tabs} value={i} onChange={choisir} label="Onglets de la fiche" />
      {/* key : chaque onglet a sa propre recherche, vide à l'ouverture. */}
      <Panneau key={i} label={courant.label}>{courant.body}</Panneau>
    </div>
  );
}

/** Une ligne du récapitulatif. */
const Info = ({ label, children }: { label: string; children: ReactNode }) => <div><dt>{label}</dt><dd>{children}</dd></div>;
const ou = (s: unknown) => texte(s).trim() || '—';

function Contenu({ f, route }: { f: FicheEntite; route: RouteOf<'fiche'> }) {
  const focusCode = route.focusCode === true;
  const x = f.entite;
  const n = x.kind === 'a' ? 2 : 3;
  const basculer = useAction(() => api.entiteBasculer(x.id));
  const [affecter, setAffecter] = useState(false);
  const [supprimer, setSupprimer] = useState(false);
  const { enCours, terminees } = repartirAffectations(f.affectations);
  return (
    <>
      <PageHeader eyebrow="Fiche" title={nomAffiche(x)}
        lead={x.kind === 'a' ? 'Fiche de l’employé, affichée en pleine page.' : 'Fiche de la machine, affichée en pleine page.'}
        actions={
          <>
            <button type="button" className="btn primary" disabled={!x.actif} onClick={() => setAffecter(true)}
              title={x.actif ? undefined : 'Réactivez la fiche pour l’affecter.'}>
              <Icon name="plus" size={14} />{libelleAffecter(x.kind)}
            </button>
            <button type="button" className="btn" onClick={() => nav.go({ name: 'form-entite', kind: x.kind, id: x.id })}>
              Modifier la fiche
            </button>
            <button type="button" className="btn" disabled={basculer.isPending} onClick={() => basculer.mutate()}>
              {x.actif ? 'Archiver la fiche' : 'Réactiver la fiche'}
            </button>
            {/* § 13.2 : toujours possible (active ou archivée, affectée ou nommée), après confirmation. */}
            <button type="button" className="btn danger" onClick={() => setSupprimer(true)}>Supprimer</button>
          </>
        } />
      <Section num={`${n}.3`} title="En-tête récapitulatif">
        <div className="recap">
          <span className="tile"><Icon name={x.kind} size={24} /></span>
          <dl>
            <Info label="Identifiant"><EntityCode code={x.code} kind={x.kind} /></Info>
            {x.kind === 'a' ? (
              <>
                <Info label="Nom">{ou(x.nom)}</Info>
                <Info label="Prénom">{ou(x.prenom)}</Info>
                <Info label="Date de naissance">{formatDate(x.dateNaissance)}</Info>
                <Info label="Poste">{ou(x.poste)}</Info>
              </>
            ) : (
              <>
                <Info label="Marque et modèle">{ou(x.marque)}</Info>
                <Info label="Processeur">{ou(x.cpu)}</Info>
                <Info label="RAM">{ou(x.ram)}</Info>
                <Info label="Stockage">{ou(x.stockage)}</Info>
              </>
            )}
            <Info label={categoryLabel(x.kind)}>{x.categorie}</Info>
            <Info label="Statut"><Badge kind={x.actif ? 'actif' : 'archive'} /></Info>
            <Info label="Mise à jour">{formatDate(x.majLe)}</Info>
          </dl>
        </div>
        {!x.code && (x.kind === 'a'
          ? <ACompleter entite={x} autoFocus={focusCode} />
          : <SaisieCode entite={x} autoFocus={focusCode} />)}
        {!x.actif && (
          <Alert tone="info" title="Fiche archivée" text="Cette fiche est conservée et reste consultable. Rien n’est supprimé." />
        )}
      </Section>
      <Section num={`${n}.4`} title="Affectations">
        <ListeAffectations entite={x} enCours={enCours} terminees={terminees} />
      </Section>
      <Section num={`${n}.5`} title={x.kind === 'a' ? 'Documents où figure l’employé' : 'Documents où figure la machine'}>
        <DocumentsNommes kind={x.kind} documents={f.documents} dossiers={f.dossiers} />
      </Section>
      <Section num={`${n}.6`} title="Onglets de la fiche">
        <Onglets f={f} route={route} />
      </Section>
      {affecter && (
        <AffecterModal entite={x} dejaIds={enCours.map((a) => a.entite.id)} onClose={() => setAffecter(false)} />
      )}
      {supprimer && <SupprimerFicheModal entite={x} onClose={() => setSupprimer(false)} />}
    </>
  );
}

/** Modules 2 et 3 · Fiche A / B en pleine page. */
export default function Fiche({ route }: PageProps<'fiche'>) {
  const fiche = useFiche(route.id);
  // § 13.2 : une fiche qui n'existe plus (supprimée) n'est pas une erreur : page « Cette fiche a été supprimée. ».
  const supprimee = fiche.isError && versApiError(fiche.error).code === 'introuvable';
  const connue = useFichesSupprimees((s) => s.fiches[route.id]);
  const kindSupprimee = connue?.kind ?? fiche.data?.entite.kind ?? null;
  const f = supprimee ? undefined : fiche.data;
  useBreadcrumb(
    supprimee ? [{ label: 'Fiche supprimée' }] : f && [{ label: nomAffiche(f.entite) }],
    { module: supprimee ? (kindSupprimee && repNavId(kindSupprimee)) : f && repNavId(f.entite.kind) },
  );
  if (supprimee) return <FicheSupprimeePage kind={kindSupprimee} />;
  return (
    <QueryView query={fiche}>
      {(data) => <Contenu f={data} route={route} />}
    </QueryView>
  );
}
