import { useEffect, useState, type FormEvent } from "react";
import { getStoredToken } from "./auth";

interface PrivacyRequestSummary {
  id: string;
  subjectType: "candidate" | "client";
  subjectId: string;
  requestType: "access" | "erasure";
  status: "submitted" | "queued" | "actioned";
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
}

// The access payload / erasure summary for the request just submitted, in
// this component's own state only — it is never persisted anywhere
// (backend/src/privacy/piiRegistry.ts, 06_decisions/023: the audit log
// records column NAMES, never values). Reloading this screen or refetching
// the list can never bring an old result back; only the moment right after
// submission can show it.
type LastResult =
  | { requestId: string; kind: "access"; values: Record<string, unknown> }
  | { requestId: string; kind: "erasure"; columnsErased: string[]; columnsRetained: string[] };

type RequestsState =
  | { status: "loading" }
  | { status: "ok"; requests: PrivacyRequestSummary[] }
  | { status: "unauthenticated" }
  | { status: "error" };

// The privacy-request workflow (S-15): a staff member (admin/recruiter —
// there is no candidate-facing login anywhere in this app) submits an
// access or erasure request on behalf of a candidate or client. Every step
// is recorded in the append-only privacy_audit_log; this screen only ever
// shows the RESULT of a request just submitted, never a stored history of
// what PII was returned in the past.
export function PrivacyRequestScreen() {
  const [state, setState] = useState<RequestsState>({ status: "loading" });
  const [subjectType, setSubjectType] = useState<"candidate" | "client">("candidate");
  const [subjectId, setSubjectId] = useState("");
  const [requestType, setRequestType] = useState<"access" | "erasure">("access");
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<LastResult | null>(null);

  async function load() {
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch("/api/privacy/requests", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) throw new Error("unauthenticated");
      if (!res.ok) throw new Error("requests fetch failed");
      const body = (await res.json()) as { requests: PrivacyRequestSummary[] };
      setState({ status: "ok", requests: body.requests });
    } catch (err) {
      setState(
        err instanceof Error && err.message === "unauthenticated"
          ? { status: "unauthenticated" }
          : { status: "error" },
      );
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setSubmitting(true);
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/privacy/request", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ subjectType, subjectId, requestType }),
      });
      if (res.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? "failed to submit privacy request");
        return;
      }

      const request = body.request as PrivacyRequestSummary;
      setLastResult(
        requestType === "access"
          ? { requestId: request.id, kind: "access", values: body.result }
          : {
              requestId: request.id,
              kind: "erasure",
              columnsErased: body.result.columnsErased,
              columnsRetained: body.result.columnsRetained,
            },
      );
      setState((prev) =>
        prev.status === "ok"
          ? { ...prev, requests: [request, ...prev.requests] }
          : { status: "ok", requests: [request] },
      );
      setSubjectId("");
    } catch {
      setActionError("network error — could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  if (state.status === "loading") return <p>Loading privacy requests...</p>;
  if (state.status === "unauthenticated") {
    return <p>Your session has expired. Please log in again.</p>;
  }
  if (state.status === "error") return <p>Could not load privacy requests.</p>;

  return (
    <section aria-label="privacy requests">
      <h2>Privacy Requests</h2>
      <p className="screen-description">Record a candidate or client access or erasure request, then follow its status. The result of an access request is displayed once and is not stored here.</p>
      <p role="note">
        Submitted on behalf of a candidate or client who asked what TalentSignal holds on
        them, or asked for it to be erased. Every step (submitted, queued, actioned) is
        written to an append-only audit log. The result below is shown only once, right
        after a request is actioned — it is never stored, so this screen can never show
        what a past request returned.
      </p>

      <form onSubmit={handleSubmit} aria-label="submit a privacy request">
        <label htmlFor="privacy-subject-type">Subject type</label>
        <br />
        <select
          id="privacy-subject-type"
          value={subjectType}
          onChange={(event) => setSubjectType(event.target.value as "candidate" | "client")}
        >
          <option value="candidate">Candidate</option>
          <option value="client">Client</option>
        </select>{" "}
        <label htmlFor="privacy-subject-id">Subject id</label>
        <br />
        <input
          id="privacy-subject-id"
          type="text"
          value={subjectId}
          onChange={(event) => setSubjectId(event.target.value)}
          placeholder="candidate or client id"
          required
        />
        <br />
        <label htmlFor="privacy-request-type">Request type</label>
        <br />
        <select
          id="privacy-request-type"
          value={requestType}
          onChange={(event) => setRequestType(event.target.value as "access" | "erasure")}
        >
          <option value="access">Access — what do we hold on this person?</option>
          <option value="erasure">Erasure — delete everything we hold on this person</option>
        </select>
        <br />
        <button type="submit" disabled={!subjectId || submitting}>
          {submitting ? "Submitting..." : "Submit request"}
        </button>
      </form>
      {actionError && <p role="alert">{actionError}</p>}

      {lastResult && (
        <section aria-label="result of the request just submitted">
          <h3>Result</h3>
          {lastResult.kind === "access" ? (
            <pre>{JSON.stringify(lastResult.values, null, 2)}</pre>
          ) : (
            <>
              <p>Erased: {lastResult.columnsErased.join(", ") || "(nothing to erase)"}</p>
              <p>
                Retained (exempt by policy):{" "}
                {lastResult.columnsRetained.join(", ") || "(nothing retained)"}
              </p>
            </>
          )}
        </section>
      )}

      {state.requests.length === 0 ? (
        <p>No privacy requests yet.</p>
      ) : (
        <ul aria-label="privacy request history">
          {state.requests.map((req) => (
            <li key={req.id}>
              <strong>{req.requestType}</strong> for {req.subjectType} <code>{req.subjectId}</code>{" "}
              — status: {req.status}, requested by {req.requestedBy} at{" "}
              {new Date(req.createdAt).toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
