import { useEffect, useState, type FormEvent } from "react";
import { getStoredToken } from "./auth";

interface JobOpening {
  id: string;
  clientId: string;
  title: string;
  description: string | null;
  requirements: string[];
  createdAt: string;
}

// name-only shape needed for the client picker — the list endpoint already
// strips contactInfo for non-recruiter/admin roles, so this works the same
// regardless of who's logged in.
interface ClientOption {
  id: string;
  name: string;
}

type JobOpeningsState =
  | { status: "loading" }
  | { status: "ok"; jobOpenings: JobOpening[] }
  | { status: "unauthenticated" }
  | { status: "error" };

export function JobOpeningsScreen() {
  const [state, setState] = useState<JobOpeningsState>({ status: "loading" });
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [clientId, setClientId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [requirements, setRequirements] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function loadJobOpenings() {
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch("/api/job-openings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) throw new Error("unauthenticated");
      if (!res.ok) throw new Error(`job openings fetch failed: ${res.status}`);
      const body = (await res.json()) as { jobOpenings: JobOpening[] };
      setState({ status: "ok", jobOpenings: body.jobOpenings });
    } catch (err) {
      setState(
        err instanceof Error && err.message === "unauthenticated"
          ? { status: "unauthenticated" }
          : { status: "error" },
      );
    }
  }

  async function loadClients() {
    const token = getStoredToken();
    if (!token) return;
    try {
      const res = await fetch("/api/clients", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const body = (await res.json()) as { clients: ClientOption[] };
      setClients(body.clients);
    } catch {
      // The create form just shows no client options; the list above still
      // reports its own error state independently.
    }
  }

  useEffect(() => {
    loadJobOpenings();
    loadClients();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    const token = getStoredToken();
    const requirementsArray = requirements
      .split(",")
      .map((requirement) => requirement.trim())
      .filter((requirement) => requirement.length > 0);

    try {
      const res = await fetch("/api/job-openings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          clientId,
          title,
          description: description.trim() || null,
          requirements: requirementsArray,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.error ?? "failed to create job opening");
        return;
      }
      setClientId("");
      setTitle("");
      setDescription("");
      setRequirements("");
      await loadJobOpenings();
    } catch {
      setFormError("network error — could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section aria-label="job openings">
      <h2>Job Openings</h2>
      <p className="screen-description">Add the client’s role and required skills here. Match and recommendations use these details to explain candidate fit.</p>

      <form onSubmit={handleSubmit} aria-label="create job opening">
        <div>
          <label htmlFor="job-client">Client</label>
          <br />
          <select
            id="job-client"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            required
          >
            <option value="" disabled>
              Select a client
            </option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="job-title">Title</label>
          <br />
          <input
            id="job-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
          />
        </div>
        <div>
          <label htmlFor="job-description">Description</label>
          <br />
          <input
            id="job-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="job-requirements">Requirements (comma-separated)</label>
          <br />
          <input
            id="job-requirements"
            value={requirements}
            onChange={(event) => setRequirements(event.target.value)}
          />
        </div>
        <button type="submit" disabled={submitting}>
          {submitting ? "Adding..." : "Add job opening"}
        </button>
      </form>
      {formError && <p role="alert">{formError}</p>}

      {state.status === "loading" && <p>Loading job openings...</p>}
      {state.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
      {state.status === "error" && <p>Could not load job openings.</p>}
      {state.status === "ok" && state.jobOpenings.length === 0 && <p>No job openings yet.</p>}
      {clients.length === 0 && state.status === "ok" && <p className="workflow-empty-note">Add a client first. Once a client is available, you can create its job opening here.</p>}
      {state.status === "ok" && state.jobOpenings.length > 0 && (
        <ul aria-label="job opening list">
          {state.jobOpenings.map((jobOpening) => (
            <li key={jobOpening.id}>
              <strong>{jobOpening.title}</strong>
              {jobOpening.requirements.length > 0 && (
                <span> — {jobOpening.requirements.join(", ")}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
