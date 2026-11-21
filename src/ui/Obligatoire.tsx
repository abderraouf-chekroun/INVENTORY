import { useState, type FormEvent, type ReactNode } from 'react';
import type { ApiError } from '../api';
import { messageManquant, nomSansEtoile, premierManquant, type ChampControle } from '../lib/formulaire';

/*
 * Champs obligatoires (spécification § 10.6), le même moyen partout :
 * - <Etoile /> après le libellé : étoile rouge visible, masquée aux lecteurs d'écran (le champ porte `required`
 *   ou `aria-required`, qu'ils annoncent déjà) ;
 * - <MentionObligatoire /> dans chaque formulaire qui en contient : « * champ obligatoire » ;
 * - useChampsObligatoires() : à l'envoi, un champ obligatoire vide (ou fait d'espaces) bloque l'envoi, reçoit le
 *   focus, et un message le nomme. Les formulaires portent `noValidate` : ce contrôle remplace la bulle du navigateur,
 *   pour un message en français, toujours le même.
 */

/** Étoile rouge d'un champ obligatoire, après son libellé. */
export function Etoile() {
  return <span className="etoile" aria-hidden="true">*</span>;
}

/** Libellé suivi de l'étoile si le champ est obligatoire. */
export function Libelle({ children, obligatoire }: { children: ReactNode; obligatoire?: boolean }) {
  return <>{children}{obligatoire && <Etoile />}</>;
}

/** Mention « * champ obligatoire », à placer dans chaque formulaire qui contient un champ obligatoire. */
export function MentionObligatoire({ className }: { className?: string }) {
  return (
    <p className={className ? `mention-obligatoire ${className}` : 'mention-obligatoire'}>
      <span className="etoile" aria-hidden="true">*</span> champ obligatoire
    </p>
  );
}

type Controle = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const estControle = (el: Element): el is Controle =>
  el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;

/** Nom d'un champ : son libellé (sans l'étoile ni les petites aides), sinon son aria-label. */
function nomDuChamp(el: Controle): string {
  const label = el.labels?.[0];
  if (label) {
    const copie = label.cloneNode(true);
    if (copie instanceof HTMLElement) {
      copie.querySelectorAll('small, input, select, textarea, .etoile, .sr-only').forEach((x) => x.remove());
      const t = nomSansEtoile(copie.textContent ?? '');
      if (t) return t;
    }
  }
  return nomSansEtoile(el.getAttribute('aria-label') ?? '');
}

/** Champs d'un formulaire dans l'ordre du document (cases et boutons radio exclus : ils ont toujours une valeur). */
function champsDe(form: HTMLFormElement): { el: Controle; champ: ChampControle }[] {
  return Array.from(form.querySelectorAll('input, select, textarea'))
    .filter(estControle)
    .filter((el) => !(el instanceof HTMLInputElement && ['checkbox', 'radio', 'hidden', 'submit', 'button'].includes(el.type)))
    .map((el) => ({
      el,
      champ: {
        nom: '',
        valeur: el.value,
        obligatoire: el.required || el.getAttribute('aria-required') === 'true',
        inactif: el.disabled || (!(el instanceof HTMLSelectElement) && el.readOnly),
      },
    }));
}

/**
 * Contrôle des champs obligatoires d'un formulaire.
 *
 *   const oblig = useChampsObligatoires();
 *   <form noValidate className={oblig.classe('form')} onSubmit={(e) => { e.preventDefault(); if (!oblig.verifier(e)) return; … }}
 *     onInput={oblig.revoir}>
 *     …
 *     <ErrorAlert error={oblig.erreur ?? action.error} />
 */
export function useChampsObligatoires() {
  const [manquant, setManquant] = useState<string | null>(null);

  const chercher = (form: HTMLFormElement): { el: Controle; nom: string } | null => {
    const champs = champsDe(form);
    const i = premierManquant(champs.map((c) => c.champ));
    if (i < 0) return null;
    const { el } = champs[i];
    return { el, nom: nomDuChamp(el) };
  };

  /** À l'envoi : vrai si tout est rempli ; sinon focus sur le premier champ manquant et message. */
  const verifier = (e: FormEvent<HTMLFormElement> | HTMLFormElement): boolean => {
    const form = e instanceof HTMLFormElement ? e : e.currentTarget;
    const m = chercher(form);
    if (!m) {
      setManquant(null);
      return true;
    }
    setManquant(m.nom);
    m.el.focus();
    return false;
  };

  /** Pendant la saisie après un envoi refusé : le message suit (autre champ manquant, ou plus rien). */
  const revoir = (e: FormEvent<HTMLFormElement>) => {
    if (manquant === null) return;
    const m = chercher(e.currentTarget);
    setManquant(m ? m.nom : null);
  };

  const erreur: ApiError | null = manquant !== null ? { code: 'champ_obligatoire', message: messageManquant(manquant) } : null;
  return {
    verifier,
    revoir,
    erreur,
    /** Classe du formulaire (`base` + « verifie » après un envoi refusé : les champs obligatoires vides sont mis en évidence). */
    classe: (base: string) => (manquant !== null ? `${base} verifie` : base),
    effacer: () => setManquant(null),
  };
}
