/*
 * Fermeture de la fenêtre (bouton de la barre de titre, Alt+F4, barre des tâches).
 *
 * Le back intercepte la demande de fermeture, émet `fermeture-demandee` vers la fenêtre et la détruit
 * de lui-même après environ 3,5 s ; les demandes répétées pendant ce délai sont ignorées (elles ne coupent
 * pas l'envoi de la dernière saisie). Ainsi la fenêtre se ferme même si l'interface est figée ou a quitté
 * l'application. Le front, lui, envoie la saisie en attente puis détruit la fenêtre sans attendre ce délai.
 *
 * On n'utilise PAS `onCloseRequested` de Tauri : son écouteur, gardé côté Rust, empêche la fermeture
 * tant que le JavaScript ne répond pas.
 */

/* Le nom de l'événement (`EVENEMENT_FERMETURE`) est défini dans src/api, avec le contrat du back. */

/** Attente maximale de l'envoi de la saisie, inférieure au délai de sécurité du back (≈ 3,5 s). */
export const ATTENTE_FERMETURE = 3000;

/**
 * Gestionnaire de la demande de fermeture : envoie (attente bornée), puis détruit la fenêtre,
 * quoi qu'il arrive à l'envoi (erreur levée, promesse rejetée ou jamais résolue).
 * Les demandes reçues pendant une fermeture en cours sont ignorées.
 */
export function creerFermeture(
  envoyer: () => Promise<unknown>,
  detruire: () => Promise<unknown>,
  attente: number = ATTENTE_FERMETURE,
): () => Promise<void> {
  let enCours = false;
  return async () => {
    if (enCours) return;
    enCours = true;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        Promise.resolve().then(envoyer),
        new Promise<void>((resolve) => {
          minuteur = setTimeout(resolve, attente);
        }),
      ]);
    } catch {
      /* l'envoi a échoué : on ferme quand même (le back fermerait de toute façon) */
    } finally {
      if (minuteur !== undefined) clearTimeout(minuteur);
    }
    try {
      await detruire();
    } catch {
      /* fenêtre déjà détruite : rien à faire */
    }
  };
}
