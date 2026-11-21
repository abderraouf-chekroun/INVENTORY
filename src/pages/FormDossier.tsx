import { useId, useState, type FormEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { useAction } from '../lib/action';
import { digitsOnly } from '../lib/format';
import { useStatuts, useThemes } from '../lib/queries';
import { qk } from '../lib/queryKeys';
import { classeCouleur, etatsOuverts, nomStatut, roleDe } from '../lib/statuts';
import { nav, type PageProps } from '../nav';
import { Etoile, ErrorAlert, MentionObligatoire, PageHeader, Section, useChampsObligatoires } from '../ui';
import { SansCategorie } from './categories/SansCategorie';

const anneeValide = (s: string): number | null => {
  if (!/^\d{4}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1900 && n <= 2200 ? n : null;
};

const ANNEE_INVALIDE = { code: 'invalide', message: 'L’année doit compter 4 chiffres, entre 1900 et 2200.' };

/**
 * Module 5 · Formulaire « Créer un dossier » (section 5.8). Nom, année et catégorie obligatoires ; état de départ choisi
 * parmi les états ouverts, « En cours » par défaut (§ 10.1). Un dossier n'est rattaché à aucun employé ni aucune
 * machine (§ 11.1) : ils y apparaissent quand ils sont nommés dans l'un de ses documents.
 * § 16 : sans catégorie active, elle se crée sur place, la saisie est conservée.
 */
export default function FormDossier(_props: PageProps<'form-dossier'>) {
  const ids = { annee: useId(), nom: useId(), theme: useId(), etat: useId() };
  const themes = useThemes();
  const statuts = useStatuts();
  const oblig = useChampsObligatoires();

  const [anneeTexte, setAnneeTexte] = useState(String(new Date().getFullYear()));
  const annee = anneeValide(anneeTexte);
  /** null tant que l'utilisateur n'a pas modifié le nom : il suit alors le nom suggéré pour l'année. */
  const [nomSaisi, setNomSaisi] = useState<string | null>(null);
  const suggere = useQuery({
    queryKey: qk.dossierNomSuggere(annee ?? 0),
    queryFn: () => api.dossierNomSuggere(annee ?? 0),
    enabled: annee !== null,
    placeholderData: keepPreviousData,
  });
  const nom = nomSaisi ?? suggere.data ?? '';

  const themesActifs = (themes.data ?? []).filter((t) => t.actif);
  const ouverts = etatsOuverts(statuts.data ?? []);

  const [themeChoisi, setThemeChoisi] = useState<number | null>(null);
  const themeId = themeChoisi ?? themesActifs[0]?.id ?? null;
  /** État de départ : null = « En cours ». */
  const [etatChoisi, setEtatChoisi] = useState<number | null>(null);
  const etat = ouverts.find((s) => s.id === etatChoisi) ?? ouverts.find((s) => roleDe(s) === 'cours') ?? null;
  const [anneeKo, setAnneeKo] = useState(false);

  const creer = useAction(api.dossierCreer, {
    errors: 'local',
    onSuccess: (d) => nav.replace({ name: 'dossier', id: d.id }),
  });

  const charge = themes.data !== undefined;
  const manqueTheme = charge && themesActifs.length === 0;
  const bloque = !charge || manqueTheme;

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!oblig.verifier(e)) return;
    if (annee === null) {
      setAnneeKo(true);
      document.getElementById(ids.annee)?.focus();
      return;
    }
    setAnneeKo(false);
    if (bloque || themeId === null) return;
    creer.mutate({
      nom: nom.trim(), annee, themeId,
      statutId: etat && roleDe(etat) !== 'cours' ? etat.id : null,
    });
  };

  return (
    <>
      <PageHeader eyebrow="Formulaire" title="Créer un dossier"
        lead="Son nom est proposé automatiquement et reste modifiable. Les employés et les machines apparaîtront dans le dossier dès qu’ils seront nommés dans l’un de ses documents." />
      <Section num="5.8" title="Informations du dossier">
        <ErrorAlert error={themes.error} title="Chargement impossible" />
        {manqueTheme && (
          <SansCategorie pour="dossier" archivees={(themes.data ?? []).length}
            onCreee={(t) => {
              setThemeChoisi(t.id);
              // Le bandeau disparaît : le focus va à la liste des catégories, une fois la page rendue.
              window.setTimeout(() => document.getElementById(ids.theme)?.focus(), 0);
            }} />
        )}
        <form className={oblig.classe('form')} noValidate onSubmit={submit} onInput={oblig.revoir}>
          <MentionObligatoire />
          <label htmlFor={ids.annee}>
            <span>Année<Etoile /> <small>4 chiffres, l’année en cours par défaut</small></span>
            <input className="field mono" id={ids.annee} inputMode="numeric" maxLength={4} required placeholder="AAAA"
              value={anneeTexte} onChange={(e) => { setAnneeTexte(digitsOnly(e.target.value)); setAnneeKo(false); }}
              aria-invalid={(anneeKo || anneeTexte.length === 4) && annee === null ? true : undefined} />
          </label>
          <label htmlFor={ids.nom}>
            <span>Nom<Etoile /> <small>{nomSaisi === null ? 'Proposé selon l’année : « Dossier année-NN »' : 'Nom choisi'}</small></span>
            <input className="field" id={ids.nom} required placeholder="Dossier" value={nom}
              onChange={(e) => setNomSaisi(e.target.value)} />
          </label>
          <label htmlFor={ids.theme}>
            <span>Catégorie<Etoile /></span>
            <select className="field" id={ids.theme} required value={themeId ?? ''} disabled={manqueTheme}
              onChange={(e) => setThemeChoisi(e.target.value ? Number(e.target.value) : null)}>
              {themesActifs.length === 0 && (
                <option value="">{(themes.data ?? []).length > 0 ? 'Aucune catégorie active' : 'Aucune catégorie pour l’instant'}</option>
              )}
              {themesActifs.map((t) => <option key={t.id} value={t.id}>{t.nom}</option>)}
            </select>
          </label>
          <label htmlFor={ids.etat}>
            <span>État <small>« En cours » par défaut ; « Pièce manquante » si le dossier attend sa pièce finale</small></span>
            <span className="etat-select">
              <span className={`etat-pastille ${classeCouleur(etat?.couleur)}`} aria-hidden="true" />
              <select className="field" id={ids.etat} value={etat ? String(etat.id) : ''} disabled={ouverts.length === 0}
                onChange={(e) => setEtatChoisi(Number(e.target.value))}>
                {ouverts.length === 0 && <option value="">En cours</option>}
                {ouverts.map((s) => <option key={s.id} value={String(s.id)}>{nomStatut(s)}</option>)}
              </select>
            </span>
          </label>
          <ErrorAlert error={oblig.erreur ?? (anneeKo ? ANNEE_INVALIDE : null) ?? creer.error} />
          <div className="acts">
            <button className="btn primary lg" disabled={bloque || creer.isPending}>Créer le dossier</button>
            <button type="button" className="btn lg" onClick={() => nav.back()}>Annuler</button>
          </div>
        </form>
      </Section>
    </>
  );
}
