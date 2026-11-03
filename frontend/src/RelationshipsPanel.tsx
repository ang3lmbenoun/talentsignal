import { useEffect, useState } from "react";
import { getStoredToken } from "./auth";

interface OpportunityOption {
  id: string;
  company: string;
  title?: string;
}

interface PathFactor {
  edgeId: string | null;
  relationshipType: string;
  strength: "strong" | "weak" | null;
  contribution: number;
}

interface RelationshipPath {
  edgeIds: string[];
  hops: number;
  userIds: string[];
  confidence: number;
  factors: PathFactor[];
  status: "unconfirmed" | "confirmed" | "dismissed";
}

type RelationshipsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; client: { id: string; name: string } | null; paths: RelationshipPath[] }
  | { status: "unauthenticated" }
  | { status: "error" };

const STATUS_LABEL: Record<RelationshipPath["status"], string> = {
  unconfirmed: "Unconfirmed — advisory guess",
  confirmed: "Confirmed",
  dismissed: "Dismissed",
};

// The confirm/dismiss review screen: every path is a GUESS (advisory,
// confidence-scored — TBI rule 2) until a human decides, and that label
// leads each path, not a footnote. Same human-in-the-loop DNA as S-09's
// PackageReviewScreen, but the decision here is reversible (a rep can
// change their mind), so Confirm/Dismiss stay clickable either way rather
// than disappearing once decided.
export function RelationshipsPanel() {
  const [opportunities, setOpportunities] = useState<OpportunityOption[]>([]);
  const [opportunityId, setOpportunityId] = useState("");
  const [state, setState] = useState<RelationshipsState>({ status: "idle" });
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;

    fetch("/api/hidden-demand/opportunities?includeSeedData=true", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ opportunities: OpportunityOption[] }>) : null))
      .then((body) => {
        if (body) setOpportunities(body.opportunities);
      })
      .catch(() => {});
  }, []);

  async function loadRelationships(id: string) {
    setState({ status: "loading" });
    setActionError(null);
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch(`/api/opportunities/${id}/relationships`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      if (!res.ok) throw new Error("relationships fetch failed");
      const body = (await res.json()) as { client: { id: string; name: string } | null; paths: RelationshipPath[] };
      setState({ status: "ok", client: body.client, paths: body.paths });
    } catch {
      setState({ status: "error" });
    }
  }

  function handleSelect(id: string) {
    setOpportunityId(id);
    if (id) loadRelationships(id);
    else setState({ status: "idle" });
  }

  async function decide(edgeIds: string[], decision: "confirmed" | "dismissed") {
    setActionError(null);
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch(`/api/opportunities/${opportunityId}/relationships/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ edgeIds, decision }),
      });
      if (res.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? "failed to record decision");
        return;
      }
      setState((prev) =>
        prev.status === "ok"
          ? {
              ...prev,
              paths: prev.paths.map((path) =>
                path.edgeIds.join(",") === edgeIds.join(",") ? { ...path, status: decision } : path,
              ),
            }
          : prev,
      );
    } catch {
      setActionError("network error — could not reach the server");
    }
  }

  return (
    <section aria-label="warm relationships">
      <h2>Warm Relationships</h2>
      <p className="screen-description">Look for existing relationship paths that could support a client introduction. Confirm or dismiss each suggested path to keep the view useful.</p>

      <label htmlFor="relationships-opportunity">Opportunity</label>
      <br />
      <select
        id="relationships-opportunity"
        value={opportunityId}
        onChange={(event) => handleSelect(event.target.value)}
      >
        <option value="">Select an opportunity</option>
        {opportunities.map((opportunity) => (
          <option key={opportunity.id} value={opportunity.id}>
            {opportunity.title ? `${opportunity.title} · ${opportunity.company}` : opportunity.company}
          </option>
        ))}
      </select>

      {opportunities.length === 0 && <p className="workflow-empty-note">No opportunities are available to explore yet.</p>}

      {actionError && <p role="alert">{actionError}</p>}
      {state.status === "loading" && <p>Loading relationships...</p>}
      {state.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
      {state.status === "error" && <p>Could not load relationships.</p>}

      {state.status === "ok" && state.client === null && (
        <p>No known client matches this opportunity's company yet.</p>
      )}

      {state.status === "ok" && state.client !== null && (
        <>
          <p>
            Warm paths toward <strong>{state.client.name}</strong>
          </p>
          {state.paths.length === 0 ? (
            <p>No relationship paths found.</p>
          ) : (
            <ul aria-label="relationship paths">
              {state.paths.map((path) => (
                <li key={path.edgeIds.join(",")}>
                  <p>
                    <strong>{STATUS_LABEL[path.status]}</strong>{" "}
                    <span>{Math.round(path.confidence * 100)}% confidence</span>{" "}
                    <span>
                      ({path.hops}-hop via {path.userIds.join(" → ")})
                    </span>
                  </p>
                  <details>
                    <summary>Why this confidence</summary>
                    <ul>
                      {path.factors.map((factor, index) => (
                        <li key={`${factor.edgeId ?? "hop-penalty"}-${index}`}>
                          {factor.relationshipType}
                          {factor.strength ? ` (${factor.strength})` : ""}: multiplies by {factor.contribution}
                        </li>
                      ))}
                    </ul>
                  </details>
                  <button
                    onClick={() => decide(path.edgeIds, "confirmed")}
                    disabled={path.status === "confirmed"}
                  >
                    Confirm
                  </button>{" "}
                  <button
                    onClick={() => decide(path.edgeIds, "dismissed")}
                    disabled={path.status === "dismissed"}
                  >
                    Dismiss
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
