import { useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, type Categorie, type Kind, type Parametres as ParametresData, type ThemeClassement } from '../api';
import { useAction } from '../lib/action';
import {
  contenuCategorieLabel, motifSuppressionCategorie, motifSuppressionImpossible, nbContenuCategorie, nbFichesDe, nbFichesLabel,
} from '../lib/categories';
import { useCategories, useInfosSysteme, useParametres, useStatuts, useThemes } from '../lib/queries';
import { qk } from '../lib/queryKeys';
import { nav, type PageProps } from '../nav';
import { ClassementList, ConfirmModal, PageHeader, QueryView, Section, Seg } from '../ui';
import { Etats } from './parametres/Etats';

type Theme = ParametresData['theme'];
type Densite = ParametresData['densite'];

/** Ligne `.set .line` : libellé à gauche, valeur ou action à droite. */
function Line({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="line">
      <span>{label}</span>
      {children}
    </div>
  );
}

/** 6.1 — Thème et densité, appliqués tout de suite puis enregistrés. */
function Affichage({ p }: { p: ParametresData }) {
  const qc = useQueryClient();
  const definir = useAction(
    ({ cle, valeur }: { cle: 'theme' | 'densite'; valeur: string }) => api.parametreDefinir(cle, valeur),
    // En cas d'échec, relire les paramètres remet l'affichage sur la valeur enregistrée.
    { invalidate: [qk.parametres], onError: () => void qc.invalidateQueries({ queryKey: qk.parametres }) },
  );
  // Mise à jour immédiate du cache : App applique data-theme / data-density sans attendre le back.
  const choisir = (cle: 'theme' | 'densite', valeur: Theme | Densite) => {
    qc.setQueryData<ParametresData>(qk.parametres, (old) => (old ? { ...old, [cle]: valeur } : old));
    definir.mutate({ cle, valeur });
  };
  return (
    <div className="set">
      <Line label="Thème">
        <Seg<Theme> label="Thème" value={p.theme} onChange={(v) => choisir('theme', v)}
          options={[{ value: 'system', label: 'Système' }, { value: 'light', label: 'Clair' }, { value: 'dark', label: 'Sombre' }]} />
      </Line>
      <Line label="Densité des tableaux">
        <Seg<Densite> label="Densité des tableaux" value={p.densite} onChange={(v) => choisir('densite', v)}
          options={[{ value: 'eq', label: 'Équilibrée' }, { value: 'compact', label: 'Compacte' }]} />
      </Line>
    </div>
  );
}

/**
 * Structures (employés) ou types de machine : catégories d'un répertoire (§ 9.1). Ajouter, renommer en place,
 * archiver ou réactiver, supprimer (seulement sans aucune fiche, active ou archivée ; sinon le motif est expliqué).
 */
function Categories({ kind }: { kind: Kind }) {
  const categories = useCategories(kind);
  const a = kind === 'a';
  return (
    <>
      <p className="group-h">
        {a ? 'Structures des employés' : 'Types de machine'}
        {categories.data && <span className="count">{categories.data.length}</span>}
      </p>
      <QueryView query={categories}>
        {(items) => (
          <ClassementList<Categorie> items={items}
            toggle={(id) => api.categorieBasculer(id)} create={(nom) => api.categorieCreer(kind, nom)}
            rename={(id, nom) => api.categorieRenommer(id, nom)}
            detail={(c) => nbFichesLabel(kind, nbFichesDe(c))}
            remove={{
              action: (id) => api.categorieSupprimer(id),
              titre: a ? 'Supprimer la structure ?' : 'Supprimer le type de machine ?',
              message: (c) => a
                ? `La structure « ${c.nom} » ne contient aucun employé. Elle sera définitivement supprimée.`
                : `Le type de machine « ${c.nom} » ne contient aucune machine. Il sera définitivement supprimé.`,
              motifImpossible: (c) => motifSuppressionImpossible(kind, nbFichesDe(c)),
            }}
            placeholder={a ? 'Nom de la structure' : 'Nom du type de machine'}
            inputLabel={a ? 'Nom de la nouvelle structure' : 'Nom du nouveau type de machine'}
            submitLabel={a ? 'Ajouter la structure' : 'Ajouter le type'} empty={a ? 'Aucune structure.' : 'Aucun type de machine.'} />
        )}
      </QueryView>
    </>
  );
}

/**
 * 6.2 — Catégories des dossiers et des modèles (thèmes en interne, § 16), états des dossiers, structures (employés),
 * types de machine. Les catégories s'ajoutent, se renomment, s'archivent ou se réactivent, et se suppriment seulement
 * sans aucun dossier ni modèle de document (sinon le motif est expliqué), comme les structures.
 */
function Classement() {
  const themes = useThemes();
  const statuts = useStatuts();
  return (
    <>
      <p className="group-h" id="categories-dossiers">
        Catégories
        {themes.data && <span className="count">{themes.data.length}</span>}
      </p>
      <p className="set-aide">
        Chaque dossier et chaque modèle de document est classé dans une catégorie. Une catégorie ne peut être supprimée
        que si elle ne contient plus aucun dossier ni modèle : changez leur catégorie depuis le dossier ouvert ou le Studio.
      </p>
      <QueryView query={themes}>
        {(items) => (
          <ClassementList<ThemeClassement> items={items}
            toggle={(id) => api.themeBasculer(id)} create={(nom) => api.themeCreer(nom)}
            rename={(id, nom) => api.themeRenommer(id, nom)}
            detail={(t) => { const n = nbContenuCategorie(t); return contenuCategorieLabel(n.dossiers, n.modeles); }}
            remove={{
              action: (id) => api.themeSupprimer(id),
              titre: 'Supprimer la catégorie ?',
              message: (t) => `La catégorie « ${t.nom} » ne contient aucun dossier ni modèle de document. Elle sera définitivement supprimée.`,
              motifImpossible: (t) => { const n = nbContenuCategorie(t); return motifSuppressionCategorie(n.dossiers, n.modeles); },
            }}
            placeholder="Nom de la catégorie" inputLabel="Nom de la nouvelle catégorie" submitLabel="Ajouter la catégorie"
            empty="Aucune catégorie." />
        )}
      </QueryView>
      <p className="group-h" id="etats-dossiers">
        États des dossiers
        {statuts.data && <span className="count">{statuts.data.length}</span>}
      </p>
      <p className="set-aide">
        L’état d’un dossier se choisit depuis le dossier ouvert. « En cours », « Pièce manquante » et « Clôturé » sont fournis ;
        ajoutez les vôtres, avec la couleur de leur badge.
      </p>
      <QueryView query={statuts}>{(items) => <Etats statuts={items} />}</QueryView>
      <Categories kind="a" />
      <Categories kind="b" />
    </>
  );
}

/** 6.3 — Informations système réelles. */
function Systeme() {
  const infos = useInfosSysteme();
  return (
    <QueryView query={infos}>
      {(i) => (
        <div className="set">
          <Line label="Version de l’application"><b className="mono">{i.version}</b></Line>
          <Line label="Moteur d’affichage"><b className="mono">{i.webview}</b></Line>
          <Line label="Version de Tauri"><b className="mono">{i.tauri}</b></Line>
          <Line label="Fenêtre minimale"><b className="mono">1024 × 640</b></Line>
        </div>
      )}
    </QueryView>
  );
}

type Reinit = 'exemple' | 'vide' | null;

/** 6.4 — Emplacement des données, ouverture du dossier, réinitialisation (avec confirmation). */
function Donnees() {
  const infos = useInfosSysteme();
  const [confirm, setConfirm] = useState<Reinit>(null);
  const ouvrir = useAction(() => api.dossierDonneesOuvrir(), { invalidate: 'none' });
  const path = { overflowWrap: 'anywhere', textAlign: 'right', maxWidth: '100%' } as const;
  return (
    <div className="set">
      <Line label="Emplacement des données"><b className="mono" style={path}>{infos.data?.dossierDonnees ?? '—'}</b></Line>
      <Line label="Fichier de la base"><b className="mono" style={path}>{infos.data?.cheminBase ?? '—'}</b></Line>
      <Line label="Afficher les données dans l’Explorateur Windows">
        <button type="button" className="btn" disabled={ouvrir.isPending} onClick={() => ouvrir.mutate()}>Ouvrir le dossier des données</button>
      </Line>
      <Line label="Remplacer toutes les données par les données d’exemple">
        <button type="button" className="btn" onClick={() => setConfirm('exemple')}>Recharger les données d’exemple</button>
      </Line>
      <Line label="Supprimer tous les employés, machines, dossiers, documents et modèles">
        <button type="button" className="btn" onClick={() => setConfirm('vide')}>Effacer toutes les données</button>
      </Line>
      {confirm === 'exemple' && (
        <ConfirmModal title="Recharger les données d’exemple ?"
          message="Toutes les données actuelles (employés, machines, dossiers, documents, modèles et fichiers importés) seront remplacées par les données d’exemple. Cette action est irréversible."
          confirmLabel="Recharger les données d’exemple"
          action={() => api.donneesReinitialiser('exemple')}
          onDone={() => nav.root({ name: 'parametres' })} onClose={() => setConfirm(null)} />
      )}
      {confirm === 'vide' && (
        <ConfirmModal title="Effacer toutes les données ?"
          message="Tous les employés, machines, dossiers, documents, modèles et fichiers importés seront définitivement supprimés. Seuls les modèles standards seront recréés. Cette action est irréversible."
          confirmLabel="Effacer toutes les données"
          action={() => api.donneesReinitialiser('vide')}
          onDone={() => nav.root({ name: 'parametres' })} onClose={() => setConfirm(null)} />
      )}
    </div>
  );
}

/** Module 6 · Paramètres (6.1 à 6.4). */
export default function Parametres(_props: PageProps<'parametres'>) {
  const parametres = useParametres();
  return (
    <>
      <PageHeader title="Paramètres" lead="Préférences d’affichage, classement et informations système." />
      <Section num="6.1" title="Préférences d’affichage">
        <QueryView query={parametres}>{(p) => <Affichage p={p} />}</QueryView>
      </Section>
      <Section num="6.2" title="Catégories, états, structures et types de machine">
        <Classement />
      </Section>
      <Section num="6.3" title="Informations système">
        <Systeme />
      </Section>
      <Section num="6.4" title="Données">
        <Donnees />
      </Section>
    </>
  );
}
