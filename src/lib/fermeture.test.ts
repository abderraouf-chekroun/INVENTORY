import { describe, expect, it, vi } from 'vitest';
import { creerFermeture } from './fermeture';

describe('creerFermeture', () => {
  it('envoie puis détruit la fenêtre', async () => {
    const ordre: string[] = [];
    const fermer = creerFermeture(
      async () => { ordre.push('envoi'); },
      async () => { ordre.push('destroy'); },
    );
    await fermer();
    expect(ordre).toEqual(['envoi', 'destroy']);
  });

  it('envoi qui ne se termine jamais : détruit après l’attente', async () => {
    const detruire = vi.fn(async () => {});
    const debut = Date.now();
    await creerFermeture(() => new Promise(() => {}), detruire, 30)();
    expect(detruire).toHaveBeenCalledTimes(1);
    expect(Date.now() - debut).toBeGreaterThanOrEqual(25);
  });

  it('envoi qui lève une erreur (synchrone ou rejet) : détruit quand même', async () => {
    const d1 = vi.fn(async () => {});
    await creerFermeture(() => { throw new Error('x'); }, d1, 1000)();
    expect(d1).toHaveBeenCalledTimes(1);
    const d2 = vi.fn(async () => {});
    await creerFermeture(() => Promise.reject(new Error('x')), d2, 1000)();
    expect(d2).toHaveBeenCalledTimes(1);
  });

  it('destroy en échec : pas d’erreur propagée', async () => {
    await expect(creerFermeture(async () => {}, () => Promise.reject(new Error('déjà fermée')))()).resolves.toBeUndefined();
  });

  it('demandes répétées pendant la fermeture : un seul envoi, un seul destroy', async () => {
    const envoyer = vi.fn(() => new Promise<void>((r) => setTimeout(r, 10)));
    const detruire = vi.fn(async () => {});
    const fermer = creerFermeture(envoyer, detruire, 1000);
    await Promise.all([fermer(), fermer(), fermer()]);
    expect(envoyer).toHaveBeenCalledTimes(1);
    expect(detruire).toHaveBeenCalledTimes(1);
  });
});
