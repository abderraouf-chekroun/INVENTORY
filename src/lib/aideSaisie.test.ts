import { describe, expect, it } from 'vitest';
import { identifiantTape, indexIdentifiantExact, positionSurlignage, prochainIndex } from './aideSaisie';

describe('prochainIndex', () => {
  it('↓ et ↑ bouclent', () => {
    expect(prochainIndex(-1, 3, 'ArrowDown')).toBe(0);
    expect(prochainIndex(0, 3, 'ArrowDown')).toBe(1);
    expect(prochainIndex(2, 3, 'ArrowDown')).toBe(0);
    expect(prochainIndex(0, 3, 'ArrowUp')).toBe(2);
    expect(prochainIndex(-1, 3, 'ArrowUp')).toBe(2);
    expect(prochainIndex(2, 3, 'ArrowUp')).toBe(1);
  });

  it('Début et Fin', () => {
    expect(prochainIndex(1, 5, 'Home')).toBe(0);
    expect(prochainIndex(1, 5, 'End')).toBe(4);
  });

  it('aucune proposition : -1', () => {
    expect(prochainIndex(0, 0, 'ArrowDown')).toBe(-1);
  });
});

describe('positionSurlignage', () => {
  it('sans casse ni accents', () => {
    expect(positionSurlignage('BENALI Sofia', 'ben')).toEqual([0, 3]);
    expect(positionSurlignage('Hélène MARTIN', 'helene')).toEqual([0, 6]);
    expect(positionSurlignage('BENALI Sofia', 'sof')).toEqual([7, 10]);
  });

  it('absente ou saisie vide : null', () => {
    expect(positionSurlignage('BENALI', 'xyz')).toBeNull();
    expect(positionSurlignage('BENALI', '  ')).toBeNull();
  });
});

describe('identifiant exact', () => {
  const codes = [null, 'PC-0412', 'BENSO-140590-TEC', '0412'];

  it('casse ignorée, « # » et espaces retirés', () => {
    expect(identifiantTape('  #pc-0412 ')).toBe('pc-0412');
    expect(indexIdentifiantExact(codes, 'pc-0412')).toBe(1);
    expect(indexIdentifiantExact(codes, 'benso-140590-tec')).toBe(2);
    expect(indexIdentifiantExact(codes, '#0412')).toBe(3);
  });

  it('début d’identifiant ou saisie vide : pas de présélection', () => {
    expect(indexIdentifiantExact(codes, 'PC-04')).toBe(-1);
    expect(indexIdentifiantExact(codes, '')).toBe(-1);
    expect(indexIdentifiantExact([null, ''], '#')).toBe(-1);
  });
});
