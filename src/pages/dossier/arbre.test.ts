import { describe, expect, it } from 'vitest';
import type { DocumentFichier, DossierDetail, SousDossier } from '../../api';
import { chemin, lieuAffiche, nbDocuments } from './arbre';

const sd = (id: number, parentId: number | null): SousDossier => ({ id, dossierId: 1, parentId, nom: `S${id}` });
const doc = (id: number, sousDossierId: number | null) => ({ id, sousDossierId }) as DocumentFichier;
const detail = (sousDossiers: SousDossier[], documents: DocumentFichier[]) =>
  ({ sousDossiers, documents }) as unknown as DossierDetail;

describe('nbDocuments', () => {
  it('compte les documents du lieu et de ses sous-dossiers', () => {
    const d = detail([sd(1, null), sd(2, 1), sd(3, null)], [doc(1, null), doc(2, 1), doc(3, 2), doc(4, 2), doc(5, 3)]);
    expect(nbDocuments(d, null)).toBe(5);
    expect(nbDocuments(d, 1)).toBe(3);
    expect(nbDocuments(d, 2)).toBe(2);
  });

  it('cycle de parentId (données piégées) : se termine', () => {
    const d = detail([sd(1, 2), sd(2, 1), sd(3, 3)], [doc(1, 1), doc(2, 2), doc(3, 3)]);
    expect(nbDocuments(d, 1)).toBe(2);
    expect(nbDocuments(d, 3)).toBe(1);
    expect(chemin(d, 1)).toBeNull();
  });

  it('lieuAffiche : la route d’abord, sinon l’emplacement du document demandé, sinon la racine', () => {
    const d = detail([sd(1, null), sd(2, 1)], [doc(10, null), doc(11, 2)]);
    expect(lieuAffiche(d, { sousDossierId: 1, documentId: 11 })).toBe(1);
    expect(lieuAffiche(d, { sousDossierId: null, documentId: 11 })).toBeNull();
    expect(lieuAffiche(d, { documentId: 11 })).toBe(2);
    expect(lieuAffiche(d, { documentId: 99 })).toBeNull();
    expect(lieuAffiche(d, {})).toBeNull();
  });

  it('arborescence très profonde : pas de débordement de pile', () => {
    const n = 200_000;
    const sous = Array.from({ length: n }, (_, i) => sd(i + 1, i === 0 ? null : i));
    const d = detail(sous, [doc(1, n)]);
    expect(nbDocuments(d, null)).toBe(1);
  });
});
