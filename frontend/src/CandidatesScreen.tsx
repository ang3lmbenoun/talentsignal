import { useEffect, useState, type DragEvent, type FormEvent } from "react";
import { UploadCloud } from "lucide-react";
import { getStoredToken, getStoredRole } from "./auth";
import { bestMatchForCandidate, type MatchJobInput } from "./lib/candidateMatch";

interface Candidate {
  id: string;
  name: string;
  skills: string[];
  experience: number | null;
  availability: string | null;
  contactInfo?: { email?: string; phone?: string };
  createdAt: string;
}

type CandidatesState =
  | { status: "loading" }
  | { status: "ok"; candidates: Candidate[] }
  | { status: "unauthenticated" }
  | { status: "error" };

// Matches the backend's PII_VISIBLE_ROLES (backend/src/routes/candidates.ts).
const CAN_MANAGE_ROLES = ["admin", "recruiter"];

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// S-25: static, hardcoded, explicitly-labeled preview of what a parsed
// resume will eventually look like -- real PDF parsing is deferred to
// 00_scope/stories/S-27.md. Never confused with a real candidate: no id,
// not in the candidates list, and captioned "illustrative" wherever shown.
const PARSED_PREVIEW = {
  name: "Redacted candidate",
  skills: ["Analytics", "Operations", "SQL", "Client strategy", "Sourcing"],
  years: "Experience · on file",
  availability: "Available · now",
};

export function CandidatesScreen() {
  const [state, setState] = useState<CandidatesState>({ status: "loading" });
  const [jobOpenings, setJobOpenings] = useState<MatchJobInput[]>([]);
  const [name, setName] = useState("");
  const [skills, setSkills] = useState("");
  const [experience, setExperience] = useState("");
  const [availability, setAvailability] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [linkedInUrl, setLinkedInUrl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Visual stub only -- no backend, no parsing. See S-27 (deferred story).
  const [uploadToast, setUploadToast] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState("all");
  const role = getStoredRole();
  const canManage = role !== null && CAN_MANAGE_ROLES.includes(role);
  // contactInfo only ever appears in the response for recruiter/admin — any
  // other role never sees the key at all, this isn't re-checking anything.
  const showContactInfo = canManage;

  async function loadCandidates() {
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch("/api/candidates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) throw new Error("unauthenticated");
      if (!res.ok) throw new Error(`candidates fetch failed: ${res.status}`);
      const body = (await res.json()) as { candidates: Candidate[] };
      setState({ status: "ok", candidates: body.candidates });
    } catch (err) {
      setState(
        err instanceof Error && err.message === "unauthenticated"
          ? { status: "unauthenticated" }
          : { status: "error" },
      );
    }
  }

  useEffect(() => {
    loadCandidates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Best-effort only, same convention as Overview/OpportunitiesList's
    // secondary KPI fetches -- job openings back the real "why this
    // candidate matches" panel below, but must never block or error the
    // candidates screen if this fails.
    const token = getStoredToken();
    if (!token) return;
    let cancelled = false;
    fetch("/api/job-openings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ jobOpenings: MatchJobInput[] }>) : null))
      .then((body) => {
        if (!cancelled && body && Array.isArray(body.jobOpenings)) setJobOpenings(body.jobOpenings);
      })
      .catch(() => {
        // Best-effort only.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);

    const token = getStoredToken();
    const contactInfo: Record<string, string> = {};
    if (email.trim()) contactInfo.email = email.trim();
    if (phone.trim()) contactInfo.phone = phone.trim();
    const skillsArray = skills
      .split(",")
      .map((skill) => skill.trim())
      .filter((skill) => skill.length > 0);

    try {
      const res = await fetch("/api/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name,
          skills: skillsArray,
          experience: experience.trim() ? Number(experience) : null,
          availability: availability.trim() || null,
          contactInfo,
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setFormError(body.error ?? "failed to create candidate");
        return;
      }
      setName("");
      setSkills("");
      setExperience("");
      setAvailability("");
      setEmail("");
      setPhone("");
      await loadCandidates();
    } catch {
      setFormError("network error — could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  function handleUploadDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setUploadToast(true);
  }

  function handleUploadClick() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf";
    input.onchange = () => setUploadToast(true);
    input.click();
  }

  const candidates = state.status === "ok" ? state.candidates : [];
  const totalCandidates = candidates.length;
  // Profiles loaded from the fixture file carry a "Fixture Candidate" name
  // prefix; saying how many are demo data keeps the count honest.
  const fixtureCount = candidates.filter((c) => /^Fixture Candidate/i.test(c.name)).length;
  // "Available now": a real, disclosed substring rule over the free-text
  // availability field (no enum exists for it) -- never a guess at intent
  // beyond what the text itself says.
  const availableNow = candidates.filter((c) => {
    const text = (c.availability ?? "").toLowerCase();
    return text.includes("now") || text.includes("immediate");
  }).length;
  const bestMatches = candidates.map((c) => bestMatchForCandidate(c, jobOpenings));
  const avgSkillsMatched =
    candidates.length > 0
      ? Math.round((bestMatches.reduce((sum, m) => sum + (m?.result.matchedSkills.length ?? 0), 0) / candidates.length) * 10) / 10
      : 0;
  const visibleCandidates = candidates.filter((candidate) => {
    const haystack = `${candidate.name} ${candidate.skills.join(" ")}`.toLowerCase();
    if (candidateSearch.trim() && !haystack.includes(candidateSearch.trim().toLowerCase())) return false;
    if (availabilityFilter === "known" && !candidate.availability) return false;
    if (availabilityFilter === "unknown" && candidate.availability) return false;
    return true;
  });

  return (
    <section aria-label="candidates">
      <h2>Candidates</h2>
      <p className="screen-description">Review candidate profiles and the evidence available for matching. Fixture profiles are demo data; uploaded files are not parsed yet.</p>

      <div className="opportunity-kpi-strip">
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">Total candidates</div>
          <div className="opportunity-kpi-value">{totalCandidates}</div>
          <p className="opportunity-kpi-why">Profiles currently in the candidate pool{fixtureCount > 0 ? `; ${fixtureCount} ${fixtureCount === 1 ? "is a demo (fixture) profile" : "are demo (fixture) profiles"}` : ""}.</p>
        </div>
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">Available now</div>
          <div className="opportunity-kpi-value opportunity-kpi-value--accent">{availableNow}</div>
          <p className="opportunity-kpi-why">Profiles whose availability text says “now” or “immediate”; availability can be missing.</p>
        </div>
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">Avg. skills in common with best job</div>
          <div className="opportunity-kpi-value" title="Average real skill overlap with the best-matching job opening on file, per candidate.">
            {jobOpenings.length > 0 ? avgSkillsMatched : "No data yet"}
          </div>
          <p className="opportunity-kpi-why">Average number of skills each candidate shares with their best-matching job opening. Shows “No data yet” when no job openings are on file.</p>
        </div>
      </div>

      {canManage && (
        <>
          {/* S-25: prominent drop zone per Ali's Sep 22 ask -- visually
              complete and functionally accepts a drop/click, but real PDF
              parsing is deferred (00_scope/stories/S-27.md). */}
          <div
            className="resume-upload-zone resume-upload-zone--prominent"
            aria-label="resume upload"
            onClick={handleUploadClick}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleUploadDrop}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") handleUploadClick();
            }}
          >
            <UploadCloud size={27} aria-hidden="true" />
            <p className="resume-upload-zone-title">Drop a resume PDF or paste a LinkedIn URL</p>
            <p className="resume-upload-zone-hint">
              Choose a file to preview the import flow · files stay local in this prototype
            </p>
            <input
              type="text"
              className="select resume-upload-linkedin"
              placeholder="Paste LinkedIn URL"
              aria-label="LinkedIn URL"
              value={linkedInUrl}
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setLinkedInUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && linkedInUrl.trim()) {
                  event.preventDefault();
                  setUploadToast(true);
                }
              }}
            />
          </div>
          {uploadToast && (
            <p role="status" className="resume-upload-toast">
              Parsed preview — resume PDF parsing wiring coming in follow-up story.
              <button type="button" onClick={() => setUploadToast(false)} aria-label="dismiss">
                ✕
              </button>
            </p>
          )}

          {/* S-25: static, hardcoded preview of the target end-state so Ali
              can see it without real parsing existing yet -- never mixed
              into the real candidate list below. */}
          <div className="overview-card candidate-parsed-preview">
            <div className="candidate-parsed-preview-head">
              <span className="eyebrow-label">Parsed preview · illustrative</span>
              <span className="opportunity-pill">PII redacted</span>
            </div>
            <div className="candidate-row">
              <span className="candidate-initials">RC</span>
              <div>
                <h4>{PARSED_PREVIEW.name}</h4>
                <div className="candidate-skills">
                  {PARSED_PREVIEW.skills.map((skill) => (
                    <span className="candidate-skill-pill" key={skill}>
                      {skill}
                    </span>
                  ))}
                </div>
                <div className="candidate-chips">
                  <span className="opportunity-pill">{PARSED_PREVIEW.years}</span>
                  <span className="opportunity-pill">{PARSED_PREVIEW.availability}</span>
                </div>
              </div>
            </div>
          </div>

          <details className="candidate-add-manually">
            <summary className="btn-link">Add manually</summary>
            <form onSubmit={handleSubmit} aria-label="create candidate">
              <div>
                <label htmlFor="candidate-name">Name</label>
                <br />
                <input id="candidate-name" value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
              <div>
                <label htmlFor="candidate-skills">Skills (comma-separated)</label>
                <br />
                <input id="candidate-skills" value={skills} onChange={(event) => setSkills(event.target.value)} />
              </div>
              <div>
                <label htmlFor="candidate-experience">Years of experience</label>
                <br />
                <input
                  id="candidate-experience"
                  type="number"
                  min={0}
                  value={experience}
                  onChange={(event) => setExperience(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="candidate-availability">Availability</label>
                <br />
                <input
                  id="candidate-availability"
                  value={availability}
                  onChange={(event) => setAvailability(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="candidate-email">Contact email</label>
                <br />
                <input
                  id="candidate-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="candidate-phone">Contact phone</label>
                <br />
                <input id="candidate-phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
              </div>
              <button type="submit" disabled={submitting}>
                {submitting ? "Adding..." : "Add candidate"}
              </button>
            </form>
          </details>
        </>
      )}
      {!canManage && <p>Only recruiters and admins can add candidates.</p>}
      {formError && <p role="alert">{formError}</p>}

      {state.status === "loading" && <p>Loading candidates...</p>}
      {state.status === "unauthenticated" && <p>Your session has expired. Please log in again.</p>}
      {state.status === "error" && <p>Could not load candidates.</p>}
      {state.status === "ok" && candidates.length === 0 && <p>No candidates yet.</p>}
      {state.status === "ok" && candidates.length > 0 && (
        <>
        <div className="filterbar candidate-filters">
          <input className="select" type="search" placeholder="Search name or skills" aria-label="Search candidates by name or skills" value={candidateSearch} onChange={(event) => setCandidateSearch(event.target.value)} />
          <select className="select" aria-label="Filter by availability information" value={availabilityFilter} onChange={(event) => setAvailabilityFilter(event.target.value)}>
            <option value="all">All availability</option><option value="known">Availability on file</option><option value="unknown">Availability not listed</option>
          </select>
          <span className="caption">Showing {visibleCandidates.length} of {candidates.length} profiles</span>
        </div>
        <ul aria-label="candidate list" className="candidate-grid">
          {visibleCandidates.map((candidate) => {
            const bestMatch = bestMatchForCandidate(candidate, jobOpenings);
            return (
              <li className="overview-card candidate-card" key={candidate.id}>
                <div className="candidate-row">
                  <span className="candidate-initials">{initialsFor(candidate.name)}</span>
                  <div>
                    <h4>{candidate.name}</h4>
                    {candidate.skills.length > 0 && (
                      <div className="candidate-skills">
                        {candidate.skills.map((skill) => (
                          <span className="candidate-skill-pill" key={skill}>
                            {skill}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="candidate-chips">
                      <span className="opportunity-pill">
                        {candidate.experience !== null ? `${candidate.experience} yrs experience` : "experience unknown"}
                      </span>
                      <span className="opportunity-pill">{candidate.availability ?? "availability unknown"}</span>
                    </div>
                    {showContactInfo &&
                      candidate.contactInfo &&
                      (candidate.contactInfo.email || candidate.contactInfo.phone) && (
                        <div className="candidate-chips">
                          {candidate.contactInfo.email && <span className="opportunity-pill">{candidate.contactInfo.email}</span>}
                          {candidate.contactInfo.phone && <span className="opportunity-pill">{candidate.contactInfo.phone}</span>}
                        </div>
                      )}
                  </div>
                </div>
                <div className="opportunity-why" data-tour="candidates-fit">
                  <b>Why this candidate matches</b>
                  {jobOpenings.length === 0
                    ? "No job openings on file yet to compare against."
                    : bestMatch && bestMatch.result.matchedSkills.length > 0
                      ? `Matches ${bestMatch.result.matchedSkills.length} skill${bestMatch.result.matchedSkills.length === 1 ? "" : "s"} with "${bestMatch.job.title}": ${bestMatch.result.matchedSkills.join(", ")}.`
                      : `No skill overlap yet with any job opening on file — ${candidate.name} has ${candidate.skills.length} skill${candidate.skills.length === 1 ? "" : "s"} listed and won't be blamed for missing requirements.`}
                </div>
              </li>
            );
          })}
        </ul>
        {visibleCandidates.length === 0 && <p className="targeting-empty-state">No candidates match these filters. Try another name or skill.</p>}
        </>
      )}
    </section>
  );
}
