import { useEffect, useState, type FormEvent } from "react";
import { getStoredToken } from "./auth";

interface JobOpeningOption {
  id: string;
  title: string;
}

interface RecommendedCandidate {
  id: string;
  name: string;
  experience: number | null;
  availability: string | null;
  fitScore: number;
  matchedSkills: string[];
  reasons: string[];
  rankDriver: "no-skill-match" | "skills-only" | "skills-plus-experience";
  feedback: "good" | "bad" | "none";
}

type RecommendState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; candidates: RecommendedCandidate[] }
  | { status: "unauthenticated" }
  | { status: "error" };

const RANK_DRIVER_LABEL: Record<RecommendedCandidate["rankDriver"], string | null> = {
  "no-skill-match": "no skills matched",
  "skills-only": null,
  "skills-plus-experience": "experience added to this rank",
};

// Reuses S-06's exact ranking + rationale (scoreCandidate(), server-side) —
// this screen adds nothing to HOW candidates are ranked, only the
// thumbs-up/down feedback control. "Bank the signal now, tune later": these
// marks are stored, not acted on by anything yet.
export function RecommendationScreen() {
  const [jobOpenings, setJobOpenings] = useState<JobOpeningOption[]>([]);
  const [jobId, setJobId] = useState("");
  const [state, setState] = useState<RecommendState>({ status: "idle" });
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredToken();
    if (!token) return;

    fetch("/api/job-openings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ jobOpenings: JobOpeningOption[] }>) : null))
      .then((body) => {
        if (body) setJobOpenings(body.jobOpenings);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "loading" });
    setActionError(null);

    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    try {
      const res = await fetch("/api/recommendation-engine/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jobId }),
      });
      if (res.status === 401) throw new Error("unauthenticated");
      if (!res.ok) throw new Error(`recommend failed: ${res.status}`);
      const body = (await res.json()) as { candidates: RecommendedCandidate[] };
      setState({ status: "ok", candidates: body.candidates });
    } catch (err) {
      setState(
        err instanceof Error && err.message === "unauthenticated"
          ? { status: "unauthenticated" }
          : { status: "error" },
      );
    }
  }

  async function handleFeedback(candidateId: string, feedback: "good" | "bad") {
    setActionError(null);
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch("/api/recommendation-engine/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ jobId, candidateId, feedback }),
      });
      if (res.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? "failed to record feedback");
        return;
      }
      setState((prev) =>
        prev.status === "ok"
          ? {
              ...prev,
              candidates: prev.candidates.map((c) => (c.id === candidateId ? { ...c, feedback } : c)),
            }
          : prev,
      );
    } catch {
      setActionError("network error — could not reach the server");
    }
  }

  return (
    <section aria-label="recommendation engine">
      <h2>Candidate Recommendations</h2>
      <p className="screen-description">Select a job to see ranked candidate suggestions with their matching evidence. Recommendations are advisory; your team decides what to do.</p>

      <form onSubmit={handleSubmit} aria-label="get recommendations">
        <label htmlFor="recommend-job">Job opening</label>
        <br />
        <select id="recommend-job" value={jobId} onChange={(event) => setJobId(event.target.value)} required>
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
          {state.status === "loading" ? "Recommending..." : "Get recommendations"}
        </button>
      </form>

      {jobOpenings.length === 0 && <p className="workflow-empty-note">There are no job openings to recommend against yet. Create one in Jobs first.</p>}

      {actionError && <p role="alert">{actionError}</p>}

      {state.status === "ok" && (
        <>
          <p role="note">
            Suggested candidates — review before contacting anyone. Marking good/bad banks
            your feedback for future tuning; nothing is retrained automatically yet.
          </p>

          {state.candidates.length === 0 ? (
            <p>No candidates in the pool.</p>
          ) : (
            <ol aria-label="recommended candidates">
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
                    {driverLabel && <span> · {driverLabel}</span>}
                    <br />
                    <button
                      onClick={() => handleFeedback(candidate.id, "good")}
                      disabled={candidate.feedback === "good"}
                      aria-label={`mark ${candidate.name} good`}
                    >
                      Good
                    </button>{" "}
                    <button
                      onClick={() => handleFeedback(candidate.id, "bad")}
                      disabled={candidate.feedback === "bad"}
                      aria-label={`mark ${candidate.name} bad`}
                    >
                      Bad
                    </button>
                    {candidate.feedback !== "none" && (
                      <span> — you marked this {candidate.feedback}</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </>
      )}

      {state.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
      {state.status === "error" && <p>Could not get recommendations.</p>}
    </section>
  );
}
