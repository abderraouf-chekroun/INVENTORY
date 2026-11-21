import { describe, expect, it } from 'vitest';
import { decisionApercu, MESSAGE_SANS_FICHIER } from './apercu';

const doc = (o: Partial<Parameters<typeof decisionApercu>[0]> = {}) => ({
  fichierChemin: 'C:\\donnees\\fichiers\\a.pdf',
  fichierNom: 'facture.pdf',
  apercu: 'aucun' as const,
  ouvrable: false,
  ...o,
});

describe('decisionApercu', () => {
  it('sans fichier : gabarit gris, pas de bouton', () => {
    expect(decisionApercu(doc({ fichierChemin: null, apercu: 'pdf', ouvrable: true })))
      .toEqual({ contenu: 'vide', ouvrir: false, message: MESSAGE_SANS_FICHIER });
  });

  it('image et pdf : uniquement d’après `apercu`', () => {
    expect(decisionApercu(doc({ apercu: 'image' })).contenu).toBe('image');
    expect(decisionApercu(doc({ apercu: 'pdf' })).contenu).toBe('pdf');
  });

  it('le nom d’origine ne décide jamais de l’aperçu (HTML déguisé en .pdf)', () => {
    const d = decisionApercu(doc({ fichierNom: 'facture.pdf', apercu: 'aucun' }));
    expect(d.contenu).toBe('message');
    const img = decisionApercu(doc({ fichierNom: 'photo.png', apercu: 'aucun' }));
    expect(img.contenu).toBe('message');
  });

  it('le bouton d’ouverture suit uniquement `ouvrable`', () => {
    expect(decisionApercu(doc({ apercu: 'pdf', ouvrable: true })).ouvrir).toBe(true);
    expect(decisionApercu(doc({ apercu: 'pdf', ouvrable: false })).ouvrir).toBe(false);
    expect(decisionApercu(doc({ fichierNom: 'contrat.docx', ouvrable: false })).ouvrir).toBe(false);
  });

  it('ni affichable ni ouvrable : explication de sécurité', () => {
    const d = decisionApercu(doc({ fichierNom: 'contrat.docx', apercu: 'aucun', ouvrable: false }));
    expect(d.ouvrir).toBe(false);
    expect(d.message).toContain('par mesure de sécurité');
    expect(d.message).toContain('(contrat.docx)');
    expect(d.message).toContain('Enregistrer une copie…');
  });

  it('non affichable mais ouvrable : invite à ouvrir', () => {
    const d = decisionApercu(doc({ fichierNom: 'contrat.docx', apercu: 'aucun', ouvrable: true }));
    expect(d).toMatchObject({ contenu: 'message', ouvrir: true });
    expect(d.message).toContain('Ouvrez-le');
  });

  it('valeur inattendue (données piégées) : traitée comme « aucun »', () => {
    const d = decisionApercu(doc({ apercu: 'html' as never, ouvrable: 'oui' as never }));
    expect(d).toMatchObject({ contenu: 'message', ouvrir: false });
  });
});
