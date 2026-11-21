import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, type Kind } from '../api';
import { qk } from './queryKeys';

/*
 * Un hook par lecture du contrat (§ 5). Chacun renvoie le résultat de `useQuery` :
 * `data` (undefined pendant le premier chargement), `isPending`, `isError`, `error`.
 * Pour afficher chargement + erreur sans y penser : `<QueryView query={…}>{(data) => …}</QueryView>` (ui/QueryView).
 */

export const useParametres = () => useQuery({ queryKey: qk.parametres, queryFn: () => api.parametresLire() });
export const useInfosSysteme = () => useQuery({ queryKey: qk.infosSysteme, queryFn: () => api.infosSysteme() });

export const useThemes = () => useQuery({ queryKey: qk.themes, queryFn: () => api.themesLister() });
export const useCategories = (kind: Kind) =>
  useQuery({ queryKey: qk.categories(kind), queryFn: () => api.categoriesLister(kind) });
export const useMagasin = () => useQuery({ queryKey: qk.magasin, queryFn: () => api.magasinLister() });

export const useEntites = (kind: Kind) => useQuery({ queryKey: qk.entites(kind), queryFn: () => api.entitesLister(kind) });
export const useFiche = (id: number) => useQuery({ queryKey: qk.fiche(id), queryFn: () => api.entiteFiche(id) });

/** Aide à la saisie : rien n'est demandé pour une saisie vide ; l'ancienne liste reste affichée pendant la frappe. */
export const useSuggestions = (kind: Kind, q: string) =>
  useQuery({
    queryKey: qk.suggestions(kind, q),
    queryFn: () => api.entitesSuggerer(kind, q),
    enabled: q !== '',
    placeholderData: keepPreviousData,
  });

/** États de dossier (§ 10.1) : les trois fournis, puis ceux ajoutés par l'utilisateur. */
export const useStatuts = () => useQuery({ queryKey: qk.statuts, queryFn: () => api.statutsLister() });

export const useDossiers = () => useQuery({ queryKey: qk.dossiers, queryFn: () => api.dossiersLister() });
export const useDossier = (id: number) => useQuery({ queryKey: qk.dossier(id), queryFn: () => api.dossierDetail(id) });
export const useDossierNomSuggere = (annee: number) =>
  useQuery({ queryKey: qk.dossierNomSuggere(annee), queryFn: () => api.dossierNomSuggere(annee) });

export const useModeles = () => useQuery({ queryKey: qk.modeles, queryFn: () => api.modelesLister() });

export const useTableauDeBord = () => useQuery({ queryKey: qk.tableauDeBord, queryFn: () => api.tableauDeBord() });

/** Recherche globale : rien n'est demandé pour une saisie vide ; l'ancien résultat reste affiché pendant la frappe. */
export const useRecherche = (q: string) =>
  useQuery({
    queryKey: qk.recherche(q),
    queryFn: () => api.recherche(q),
    enabled: q !== '',
    placeholderData: keepPreviousData,
  });
