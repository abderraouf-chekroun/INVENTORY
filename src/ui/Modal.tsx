import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

let openCount = 0;

/** Vrai si une fenêtre modale est ouverte (les raccourcis globaux Alt+← et Ctrl+K se taisent alors). */
export const isModalOpen = (): boolean => openCount > 0;

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  /** Nom accessible de la boîte de dialogue (souvent le titre). */
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Fenêtre modale générique (`.scrim` + `.modal`, comme la fenêtre « Que voulez-vous ajouter ? »).
 * - Échap ou clic sur le fond : `onClose`.
 * - Le focus va sur l'élément `autoFocus` s'il y en a un, sinon sur le premier élément focalisable ;
 *   Tab reste dans la fenêtre ; à la fermeture, le focus revient où il était.
 * Le contenu est libre : `<h3>Titre</h3>`, `.choices`, `.opt`, `<form className="mform">`…
 * Affichage conditionnel par la page : `{open && <Modal …>…</Modal>}`.
 */
export function Modal({ label, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    openCount++;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const box = ref.current;
    if (box && !box.contains(document.activeElement)) {
      const first = box.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? box).focus();
    }
    return () => {
      openCount--;
      if (previous && previous.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="scrim"
      onKeyDown={onKeyDown}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
