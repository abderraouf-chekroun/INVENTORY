import { describe, expect, it } from 'vitest';
import { LimiteErreur } from './LimiteErreur';

describe('LimiteErreur', () => {
  it('une erreur de rendu passe la limite en état d’erreur', () => {
    expect(LimiteErreur.getDerivedStateFromError()).toEqual({ error: true });
  });

  it('un changement de route oublie l’erreur (la page est retentée)', () => {
    const avant = { name: 'dossier' };
    const apres = { name: 'dashboard' };
    expect(LimiteErreur.getDerivedStateFromProps({ resetKey: apres, children: null }, { error: true, cle: avant }))
      .toEqual({ error: false, cle: apres });
  });

  it('même route : l’erreur reste affichée', () => {
    const r = { name: 'dossier' };
    expect(LimiteErreur.getDerivedStateFromProps({ resetKey: r, children: null }, { error: true, cle: r })).toBeNull();
  });
});
