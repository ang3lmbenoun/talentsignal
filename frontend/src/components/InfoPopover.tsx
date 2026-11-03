import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { CircleHelp } from "lucide-react";
import "./InfoPopover.css";

// A small "How is this counted?" disclosure. The panel opens inline under the
// button (not floating), so it never gets clipped by a card edge. Escape or a
// click outside closes it; the button reports aria-expanded.
export function InfoPopover({ label = "How is this counted?", children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointerDown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open]);

  return (
    <div className="info-popover" ref={rootRef}>
      <button
        type="button"
        className="info-popover-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <CircleHelp size={13} aria-hidden="true" /> {label}
      </button>
      {open && (
        <div id={panelId} className="info-popover-panel" role="note">
          {children}
        </div>
      )}
    </div>
  );
}
