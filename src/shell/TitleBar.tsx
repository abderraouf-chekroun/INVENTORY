import { useEffect, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useParametres } from '../lib/queries';
import { Icon } from '../ui/Icon';

/** Exécute une commande de fenêtre Tauri ; sans effet hors de Tauri (navigateur de développement). */
function withWindow(fn: (w: ReturnType<typeof getCurrentWindow>) => Promise<unknown>): void {
  if (!isTauri()) return;
  fn(getCurrentWindow()).catch(() => {
    /* permission absente ou fenêtre fermée : rien à afficher */
  });
}

/**
 * Vraie barre de titre (fenêtre sans décorations, spécification § 7) : zone de déplacement,
 * double clic = agrandir/restaurer (géré par Tauri via data-tauri-drag-region), trois boutons.
 */
export function TitleBar() {
  const parametres = useParametres();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    const w = getCurrentWindow();
    let alive = true;
    let unlisten: (() => void) | undefined;
    const refresh = () => {
      w.isMaximized().then((m) => alive && setMaximized(m)).catch(() => {});
    };
    refresh();
    w.onResized(refresh)
      .then((f) => (alive ? (unlisten = f) : f()))
      .catch(() => {});
    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  return (
    <div className="titlebar" data-tauri-drag-region="">
      <span className="glyph" data-tauri-drag-region="" />
      INVENTORY
      {parametres.data?.donneesExemple && <span className="demo" data-tauri-drag-region="">Données d’exemple</span>}
      <div className="ctl">
        <button type="button" tabIndex={-1} aria-label="Réduire" title="Réduire" onClick={() => withWindow((w) => w.minimize())}>
          <Icon name="min" size={12} />
        </button>
        <button type="button" tabIndex={-1} aria-label={maximized ? 'Restaurer' : 'Agrandir'} title={maximized ? 'Restaurer' : 'Agrandir'}
          onClick={() => withWindow((w) => w.toggleMaximize())}>
          <Icon name={maximized ? 'restore' : 'max'} size={12} />
        </button>
        <button type="button" className="close" tabIndex={-1} aria-label="Fermer" title="Fermer" onClick={() => withWindow((w) => w.close())}>
          <Icon name="close" size={12} />
        </button>
      </div>
    </div>
  );
}
