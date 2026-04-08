import { useEffect, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";

type CenteredModalProps = {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  showCloseButton?: boolean;
};

export function CenteredModal({
  open,
  title,
  closeLabel,
  onClose,
  children,
  actions,
  showCloseButton = true,
}: CenteredModalProps) {
  const headingId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal((
    <div className="centered-modal-overlay" role="presentation" onClick={onClose}>
      <section
        className="centered-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="centered-modal-header">
          <h3 id={headingId}>{title}</h3>
          {showCloseButton ? (
            <button type="button" onClick={onClose} aria-label={closeLabel}>
              {closeLabel}
            </button>
          ) : null}
        </header>
        <div className="centered-modal-body">{children}</div>
        {actions ? <footer className="centered-modal-actions">{actions}</footer> : null}
      </section>
    </div>
  ), document.body);
}