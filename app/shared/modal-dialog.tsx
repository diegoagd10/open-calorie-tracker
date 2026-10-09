import {
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router";

import styles from "../food-log.module.css";

/**
 * Focus, scroll lock, Escape, and Tab containment for a dialog that closes by navigating to
 * `closeHref`; focus returns to the opener, or to `restoreFocusSelector` when it is gone.
 */
export function useModalDialog({
  closeHref,
  initialFocusSelector,
  restoreFocusSelector,
}: {
  closeHref: string;
  initialFocusSelector: string;
  restoreFocusSelector: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (
      !previousFocusRef.current &&
      document.activeElement instanceof HTMLElement
    ) {
      previousFocusRef.current = document.activeElement;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(initialFocusSelector)
        ?.focus();
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      const previousFocus = previousFocusRef.current;
      requestAnimationFrame(() => {
        const restoreTarget =
          previousFocus?.isConnected && previousFocus !== document.body
            ? previousFocus
            : // Responsive layouts keep hidden copies of an opener; focus the shown one.
              [...document.querySelectorAll<HTMLElement>(restoreFocusSelector)]
                .find((element) => element.getClientRects().length > 0);
        restoreTarget?.focus();
      });
    };
  }, [initialFocusSelector, restoreFocusSelector]);

  function closeDialog() {
    void navigate(closeHref);
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), a[href]',
      ) ?? []),
    ].filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return { closeDialog, dialogRef, handleDialogKeyDown };
}

/** The dimmed page behind a dialog; a click on the backdrop itself, not the dialog, closes it. */
export function DialogBackdrop({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className={styles.dialogBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}
