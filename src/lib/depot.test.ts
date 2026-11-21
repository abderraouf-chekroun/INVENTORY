import { describe, expect, it, vi } from 'vitest';
import { installerBlocageDepot, refuserDepotFichiers, transporteDesFichiers } from './depot';

const evt = (types: string[] | null) => ({
  dataTransfer: types ? { types, dropEffect: 'copy' } : null,
  preventDefault: vi.fn(),
});

describe('dépôt de fichiers', () => {
  it('reconnaît un glisser de fichiers', () => {
    expect(transporteDesFichiers(['Files'])).toBe(true);
    expect(transporteDesFichiers(['text/uri-list', 'Files'])).toBe(true);
    expect(transporteDesFichiers(['text/plain'])).toBe(false);
    expect(transporteDesFichiers(undefined)).toBe(false);
  });

  it('neutralise un dépôt de fichiers', () => {
    const e = evt(['Files']);
    expect(refuserDepotFichiers(e)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.dataTransfer?.dropEffect).toBe('none');
  });

  it('laisse passer le glisser-déposer des blocs du Studio (text/plain)', () => {
    const e = evt(['text/plain']);
    expect(refuserDepotFichiers(e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(e.dataTransfer?.dropEffect).toBe('copy');
    expect(refuserDepotFichiers(evt(null))).toBe(false);
  });

  it('s’installe en phase de capture sur dragenter, dragover et drop', () => {
    const addEventListener = vi.fn();
    installerBlocageDepot({ addEventListener } as unknown as Window);
    expect(addEventListener.mock.calls.map((c) => [c[0], c[2]])).toEqual([
      ['dragenter', true], ['dragover', true], ['drop', true],
    ]);
  });
});
