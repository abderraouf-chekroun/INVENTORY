import { describe, expect, it } from 'vitest';
import { citationsSupprimees, decouper, lienChamp, liensEvenement, morceauxEvenement, type LienEvenement } from './liensEvenement';

const pc: LienEvenement = { role: 'b', id: 7, nom: 'PC Accueil 01' };
const sofia: LienEvenement = { role: 'a', id: 3, nom: 'BENALI Sofia' };
const dossier: LienEvenement = { role: 'dossier', id: 12, nom: 'Dossier 2025-01' };

describe('liensEvenement', () => {
  it('garde les fiches et le dossier renseignés, sauf la fiche affichée', () => {
    const e = { aId: 3, aLibelle: 'BENALI Sofia', bId: 7, bLibelle: 'PC Accueil 01', dossierId: 12, dossierNom: 'Dossier 2025-01' };
    expect(liensEvenement(e, 3)).toEqual([pc, dossier]);
    expect(liensEvenement(e, 7)).toEqual([sofia, dossier]);
    expect(liensEvenement(e)).toEqual([sofia, pc, dossier]);
  });

  it('un identifiant ou un nom absent ne donne pas de lien (simple texte)', () => {
    expect(liensEvenement({ aId: 3, aLibelle: null, bId: null, bLibelle: 'PC', dossierId: 12, dossierNom: '  ' })).toEqual([]);
    expect(liensEvenement({})).toEqual([]);
    // Données inattendues : jamais de plantage.
    expect(liensEvenement({ aId: 'x', aLibelle: 5 } as unknown as Parameters<typeof liensEvenement>[0])).toEqual([]);
    expect(liensEvenement({ aId: 0, aLibelle: 'Zéro' })).toEqual([]);
  });
});

describe('liens vers un document et son champ (§ 11.2)', () => {
  const doc: LienEvenement = { role: 'document', id: 40, nom: 'Document_02', dossierId: 12 };
  const champ: LienEvenement = { role: 'champ', id: 40, nom: 'Utilisateur', dossierId: 12 };

  it('un document est un lien s’il a un nom et un dossier où l’ouvrir', () => {
    const e = { aId: 3, aLibelle: 'BENALI Sofia', dossierId: 12, dossierNom: 'Dossier 2025-01', documentId: 40, documentNom: 'Document_02' };
    expect(liensEvenement(e, 3)).toEqual([dossier, doc]);
    expect(liensEvenement({ ...e, dossierId: null }, 3)).toEqual([]);
    expect(liensEvenement({ ...e, documentNom: ' ' }, 3)).toEqual([dossier]);
    expect(liensEvenement({ ...e, documentId: -1 }, 3)).toEqual([dossier]);
  });

  it('le champ est un lien vers le document, s’il est renseigné et que l’on sait où ouvrir le document', () => {
    const e = { dossierId: 12, documentId: 40, champ: ' Utilisateur ' };
    expect(lienChamp(e)).toEqual(champ);
    expect(lienChamp({ ...e, champ: '' })).toBeNull();
    expect(lienChamp({ ...e, champ: null })).toBeNull();
    expect(lienChamp({ ...e, documentId: null })).toBeNull();
    expect(lienChamp({ ...e, dossierId: 0 })).toBeNull();
  });

  it('nomination : le document dans le titre, le champ et le dossier dans le détail', () => {
    const r = morceauxEvenement({
      titre: 'Nommé dans Fiche d’intervention informatique : Document_02', detail: 'Champ « Utilisateur » · Dossier 2025-01',
      aId: 3, aLibelle: 'BENALI Sofia', dossierId: 12, dossierNom: 'Dossier 2025-01', documentId: 40, documentNom: 'Document_02',
      champ: 'Utilisateur',
    }, 3);
    expect(r.titre).toEqual([{ texte: 'Nommé dans Fiche d’intervention informatique : ' }, { texte: 'Document_02', lien: doc }]);
    expect(r.detail).toEqual([
      { texte: 'Champ « ' }, { texte: 'Utilisateur', lien: champ }, { texte: ' » · ' }, { texte: 'Dossier 2025-01', lien: dossier },
    ]);
    expect(r.autres).toEqual([]);
  });

  it('le champ n’est pas cherché dans le titre ; absent du détail, il est proposé à part', () => {
    const r = morceauxEvenement({
      titre: 'Nommée dans Fiche pour formatage PC : Machine', detail: 'Dossier 2025-01',
      dossierId: 12, dossierNom: 'Dossier 2025-01', documentId: 40, documentNom: 'Formatage', champ: 'Machine',
    });
    expect(r.titre.filter((m) => m.lien)).toEqual([]);
    expect(r.autres).toEqual([{ role: 'document', id: 40, nom: 'Formatage', dossierId: 12 }, { role: 'champ', id: 40, nom: 'Machine', dossierId: 12 }]);
  });
});

describe('decouper', () => {
  it('fait un lien de la première occurrence de chaque nom', () => {
    const r = decouper('Affectation de PC Accueil 01', [pc]);
    expect(r.morceaux).toEqual([{ texte: 'Affectation de ' }, { texte: 'PC Accueil 01', lien: pc }]);
    expect(r.restants).toEqual([]);
  });

  it('plusieurs noms, dans l’ordre du texte', () => {
    const r = decouper('BENALI Sofia et PC Accueil 01 sont liés par Dossier 2025-01.', [pc, dossier, sofia]);
    expect(r.morceaux.map((m) => (m.lien ? `[${m.texte}]` : m.texte)).join('')).toBe('[BENALI Sofia] et [PC Accueil 01] sont liés par [Dossier 2025-01].');
  });

  it('un nom collé à un autre mot n’est pas reconnu', () => {
    const court: LienEvenement = { role: 'b', id: 1, nom: 'PC' };
    const r = decouper('PCB et PC', [court]);
    expect(r.morceaux).toEqual([{ texte: 'PCB et ' }, { texte: 'PC', lien: court }]);
  });

  it('le nom le plus long passe d’abord, sans chevauchement', () => {
    const court: LienEvenement = { role: 'a', id: 2, nom: 'PC' };
    const r = decouper('Affectation de PC Accueil 01', [court, pc]);
    expect(r.morceaux).toEqual([{ texte: 'Affectation de ' }, { texte: 'PC Accueil 01', lien: pc }]);
    expect(r.restants).toEqual([court]);
  });

  it('nom absent du texte : renvoyé dans les restants ; texte vide', () => {
    expect(decouper('Fiche modifiée', [pc])).toEqual({ morceaux: [{ texte: 'Fiche modifiée' }], restants: [pc] });
    expect(decouper('', [])).toEqual({ morceaux: [], restants: [] });
  });
});

describe('fiche supprimée citée par un événement (§ 13.2)', () => {
  const sofiaSupprimee: LienEvenement = { role: 'a', id: 0, nom: 'BENALI Sofia', supprimee: true };
  const pcSupprime: LienEvenement = { role: 'b', id: 0, nom: 'PC Accueil 01', supprimee: true };

  it('n’est jamais un lien, mais son nom est repéré (id nul, nom en texte)', () => {
    const e = { aId: null, aLibelle: 'BENALI Sofia', aSupprime: true, bId: 7, bLibelle: 'PC Accueil 01', bSupprime: false };
    expect(liensEvenement(e, 7)).toEqual([]);
    expect(citationsSupprimees(e)).toEqual([sofiaSupprimee]);
    expect(citationsSupprimees({ bLibelle: 'PC Accueil 01', bSupprime: true })).toEqual([pcSupprime]);
    // Drapeau absent, faux ou nom vide : rien.
    expect(citationsSupprimees({ aLibelle: 'BENALI Sofia' })).toEqual([]);
    expect(citationsSupprimees({ aLibelle: 'BENALI Sofia', aSupprime: false })).toEqual([]);
    expect(citationsSupprimees({ aLibelle: ' ', aSupprime: true })).toEqual([]);
  });

  it('titre du back qui porte déjà la mention : le nom est du texte, sans mention répétée', () => {
    const r = morceauxEvenement({
      titre: 'Fin de l’affectation de BENALI Sofia (supprimé)', detail: '',
      aId: null, aLibelle: 'BENALI Sofia', aSupprime: true, bId: 7, bLibelle: 'PC Accueil 01', bSupprime: false,
    }, 7);
    expect(r.titre).toEqual([{ texte: 'Fin de l’affectation de ' }, { texte: 'BENALI Sofia', lien: sofiaSupprimee }, { texte: ' (supprimé)' }]);
    expect(r.autres).toEqual([]);
  });

  it('texte sans la mention : « (supprimé) » pour un employé, « (supprimée) » pour une machine', () => {
    const r = morceauxEvenement({
      titre: 'Affectation de PC Accueil 01', detail: 'Avec BENALI Sofia.',
      aId: null, aLibelle: 'BENALI Sofia', aSupprime: true, bId: null, bLibelle: 'PC Accueil 01', bSupprime: true,
    });
    expect(r.titre[1]).toEqual({ texte: 'PC Accueil 01', lien: pcSupprime, mention: ' (supprimée)' });
    expect(r.detail[1]).toEqual({ texte: 'BENALI Sofia', lien: sofiaSupprimee, mention: ' (supprimé)' });
  });

  it('nom absent des textes : proposé à part, toujours sans lien', () => {
    const r = morceauxEvenement({ titre: 'Dossier ouvert', detail: '', aId: null, aLibelle: 'BENALI Sofia', aSupprime: true });
    expect(r.autres).toEqual([sofiaSupprimee]);
  });

  it('événement « fiche_supprimee » du journal général : nom en texte, rien de cliquable', () => {
    const r = morceauxEvenement({
      titre: 'Machine « PC Accueil 01 » supprimée', detail: '',
      aId: null, bId: null, dossierId: null, bLibelle: 'PC Accueil 01', bSupprime: true,
    });
    expect(r.titre).toEqual([{ texte: 'Machine « ' }, { texte: 'PC Accueil 01', lien: pcSupprime }, { texte: ' » supprimée' }]);
    expect([...r.titre, ...r.detail].some((m) => m.lien && !m.lien.supprimee)).toBe(false);
  });
});

describe('morceauxEvenement', () => {
  it('chaque nom est un lien une seule fois : titre d’abord, puis détail ; les autres à part', () => {
    const r = morceauxEvenement({
      titre: 'Affectation de PC Accueil 01', detail: 'PC Accueil 01 est affectée à BENALI Sofia.',
      aId: 3, aLibelle: 'BENALI Sofia', bId: 7, bLibelle: 'PC Accueil 01', dossierId: 12, dossierNom: 'Dossier 2025-01',
    }, 3);
    expect(r.titre.filter((m) => m.lien).map((m) => m.texte)).toEqual(['PC Accueil 01']);
    expect(r.detail.filter((m) => m.lien)).toEqual([]);
    expect(r.autres).toEqual([dossier]);
  });

  it('nom trouvé seulement dans le détail', () => {
    const r = morceauxEvenement({ titre: 'Dossier ouvert', detail: 'Dossier 2025-01 : Support.', dossierId: 12, dossierNom: 'Dossier 2025-01' });
    expect(r.titre).toEqual([{ texte: 'Dossier ouvert' }]);
    expect(r.detail[0]).toEqual({ texte: 'Dossier 2025-01', lien: dossier });
    expect(r.autres).toEqual([]);
  });
});
