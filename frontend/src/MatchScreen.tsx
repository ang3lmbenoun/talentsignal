import { useEffect, useState, type FormEvent } from "react";
import { getStoredToken } from "./auth";

// name-only shape needed for the job picker.
interface JobOpeningOption {
  id: string;
  title: string;
}

interface RankedCandidate {
  id: string;
  name: string;
  experience: number | null;
  availability: string | null;
  fitScore: number;
  matchedSkills: string[];
  reasons: string[];
  rankDriver: "no-skill-match" | "skills-only" | "skills-plus-experience";
}

type MatchState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; candidates: RankedCandidate[] }
  | { status: "unauthenticated" }
  | { status: "error" };

const RANK_DRIVER_LABEL: Record<RankedCandidate["rankDriver"], string | null> = {
  "no-skill-match": "no skills matched",
  "skills-only": null,
  "skills-plus-experience": "experience added to this rank",
};

export function MatchScreen() {
  const [jobOpenings, setJobOpenings] = useState<JobOpeningOption[]>([]);
  const [jobId, setJobId] = useState("");
  const [state, setState] = useState<MatchState>({ status: "idle" });

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;

    fetch("/api/job-openings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ jobOpenings: JobOpeningOption[] }>) : null))
      .then((body) => {
        if (body) setJobOpenings(body.jobOpenings);
      })
      .catch(() => {
        // The job picker just shows no options; there's nothing else useful
        // to do with this failure on a screen whose real state is the match
        // result below.
      });
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "loading" });

    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    try {
      const res = await fetch("/api/client-matchmaking/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jobId }),
      });
      if (res.status === 401) throw new Error("unauthenticated");
      if (!res.ok) throw new Error(`match failed: ${res.status}`);
      const body = (await res.json()) as { candidates: RankedCandidate[] };
      setState({ status: "ok", candidates: body.candidates });
    } catch (err) {
      setState(
        err instanceof Error && err.message === "unauthenticated"
          ? { status: "unauthenticated" }
          : { status: "error" },
      );
    }
  }

  return (
    <section aria-label="client matchmaking">
      <h2>Client Matchmaking</h2>
      <p className="screen-description">Choose a job to rank candidates by fit. The list explains matched skills and gaps; it does not contact candidates.</p>

      <form onSubmit={handleSubmit} aria-label="run match">
        <label htmlFor="match-job">Job opening</label>
        <br />
        <select id="match-job" value={jobId} onChange={(event) => setJobId(event.target.value)} required>
          <option value="" disabled>
            Select a job opening
          </option>
          {jobOpenings.map((jobOpening) => (
            <option key={jobOpening.id} value={jobOpening.id}>
              {jobOpening.title}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!jobId || state.status === "loading"}>
          {state.status === "loading" ? "Matching..." : "Find candidates"}
        </button>
      </form>

      {jobOpenings.length === 0 && <p className="workflow-empty-note">There are no job openings to match yet. Add a client and create a job opening in Jobs first.</p>}

      {state.status === "ok" && (
        <>
          {/* The suggestion/trust half of REQ-020: this is a ranked draft
              for a human to review, never an auto-submission — there is no
              "submit to client" button anywhere on this screen or endpoint. */}
          <p role="note">
            Suggested ranking — review before contacting any candidate. Nothing here has
            been sent to a client.
          </p>

          {state.candidates.length === 0 ? (
            <p>No candidates in the pool.</p>
          ) : (
            <ol aria-label="ranked candidates">
              {state.candidates.map((candidate, index) => {
                const driverLabel = RANK_DRIVER_LABEL[candidate.rankDriver];
                return (
                  <li key={candidate.id}>
                    <span>#{index + 1}</span> <strong>{candidate.name}</strong>{" "}
                    <span>{Math.round(candidate.fitScore * 100)}% fit</span>
                    {" — "}
                    <span>
                      {candidate.matchedSkills.length > 0
                        ? `matched: ${candidate.matchedSkills.join(", ")}`
                        : "no skills matched"}
                    </span>
                    {" · "}
                    <span>{candidate.reasons.join(", ")}</span>
                    {" · "}
                    <span>{candidate.experience ?? 0} years experience</span>
                    {" · "}
                    <span>availability: {candidate.availability ?? "not stated"}</span>
                    {driverLabel && <span> · {driverLabel}</span>}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}

      {state.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
      {state.status === "error" && <p>Could not run matchmaking.</p>}
    </section>
  );
}
