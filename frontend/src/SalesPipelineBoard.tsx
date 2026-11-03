import { useEffect, useState, type FormEvent } from "react";
import { getStoredToken } from "./auth";

interface PipelineEntry {
  id: string;
  clientId: string;
  clientName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface ClientOption {
  id: string;
  name: string;
}

const STAGES = ["prospecting", "contacted", "negotiation", "closed"] as const;
type Stage = (typeof STAGES)[number];

const STAGE_LABELS: Record<Stage, string> = {
  prospecting: "Prospecting",
  contacted: "Contacted",
  negotiation: "Negotiation",
  closed: "Closed",
};

type BoardState =
  | { status: "loading" }
  | { status: "ok"; pipeline: PipelineEntry[]; clients: ClientOption[] }
  | { status: "unauthenticated" }
  | { status: "error" };

// Kanban with literal stage-advance buttons, not drag-and-drop — simpler,
// and any button works (not just "next"), reflecting the freeform-transition
// decision (06_decisions/014): a rep can move a client to any other stage
// directly, including backward.
export function SalesPipelineBoard() {
  const [state, setState] = useState<BoardState>({ status: "loading" });
  const [selectedClientId, setSelectedClientId] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const [pipelineRes, clientsRes] = await Promise.all([
        fetch("/api/sales-pipeline", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/clients", { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      if (pipelineRes.status === 401 || clientsRes.status === 401) {
        throw new Error("unauthenticated");
      }
      if (!pipelineRes.ok || !clientsRes.ok) throw new Error("board fetch failed");
      const pipelineBody = (await pipelineRes.json()) as { pipeline: PipelineEntry[] };
      const clientsBody = (await clientsRes.json()) as { clients: ClientOption[] };
      setState({ status: "ok", pipeline: pipelineBody.pipeline, clients: clientsBody.clients });
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
    // load only reads from stable module-level storage helpers and never
    // changes identity across renders, so this only needs to run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Updates local state directly from the mutation response — no separate
  // re-fetch. This is what satisfies AC-4-5 ("reflects the new stage within
  // a second"): an ordinary synchronous state update after the awaited
  // request resolves, not a websocket or a polling loop.
  async function moveStage(clientId: string, toStage: Stage) {
    setActionError(null);
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch("/api/sales-pipeline/update", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ clientId, toStage }),
      });
      if (res.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? "failed to move stage");
        return;
      }

      setState((prev) => {
        if (prev.status !== "ok") return prev;
        const clientName = prev.clients.find((client) => client.id === clientId)?.name ?? "";
        const updatedEntry: PipelineEntry = { ...body.pipeline, clientName };
        const alreadyOnBoard = prev.pipeline.some((entry) => entry.clientId === clientId);
        const pipeline = alreadyOnBoard
          ? prev.pipeline.map((entry) => (entry.clientId === clientId ? updatedEntry : entry))
          : [...prev.pipeline, updatedEntry];
        return { ...prev, pipeline };
      });
    } catch {
      setActionError("network error — could not reach the server");
    }
  }

  async function handleAddSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedClientId) return;
    await moveStage(selectedClientId, "prospecting");
    setSelectedClientId("");
  }

  if (state.status === "loading") return <p>Loading pipeline...</p>;
  if (state.status === "unauthenticated") {
    return <p>Your session has expired. Please log in again.</p>;
  }
  if (state.status === "error") return <p>Could not load the sales pipeline.</p>;

  const enrolledClientIds = new Set(state.pipeline.map((entry) => entry.clientId));
  const availableClients = state.clients.filter((client) => !enrolledClientIds.has(client.id));

  return (
    <section aria-label="sales pipeline">
      <h2>Sales Pipeline</h2>
      <p className="screen-description">Track client conversations from prospecting through close. Moving a card records the stage your team selected.</p>

      <form onSubmit={handleAddSubmit} aria-label="add client to pipeline">
        <label htmlFor="pipeline-add-client">Add a client</label>
        <br />
        <select
          id="pipeline-add-client"
          value={selectedClientId}
          onChange={(event) => setSelectedClientId(event.target.value)}
        >
          <option value="" disabled>
            Select a client
          </option>
          {availableClients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!selectedClientId}>
          Add to pipeline
        </button>
      </form>
      {actionError && <p role="alert">{actionError}</p>}

      {availableClients.length === 0 && state.pipeline.length === 0 && <p className="workflow-empty-note">No clients are available to add yet. Create or identify a client before tracking an opportunity here.</p>}

      <div aria-label="pipeline board">
        {STAGES.map((stage) => (
          <section key={stage} aria-label={`${stage} column`}>
            <h3>{STAGE_LABELS[stage]}</h3>
            <ul>
              {state.pipeline
                .filter((entry) => entry.status === stage)
                .map((entry) => (
                  <li key={entry.clientId}>
                    <strong>{entry.clientName}</strong>{" "}
                    {STAGES.filter((target) => target !== stage).map((target) => (
                      <button key={target} onClick={() => moveStage(entry.clientId, target)}>
                        {`→ ${STAGE_LABELS[target]}`}
                      </button>
                    ))}
                  </li>
                ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
