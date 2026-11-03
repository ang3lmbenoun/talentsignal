import type { ReactNode } from "react";
import "./ShowTheMath.css";

// A collapsed <details> for the definitions behind a number (what it counts,
// which cut-off it uses). Numbers that carry a trust/provenance rule (n counts,
// basis, weights version, live/seeded labels) are MOVED in here, never deleted.
// Native <details> keeps it closed by default with no React state.
export function ShowTheMath({ children, label = "Show the math" }: { children: ReactNode; label?: string }) {
  return (
    <details className="show-the-math">
      <summary>{label}</summary>
      <div className="show-the-math-body">{children}</div>
    </details>
  );
}
