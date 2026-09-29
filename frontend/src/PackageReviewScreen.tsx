import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getStoredToken } from "./auth";
import { composeEmailDraft } from "./lib/emailDraft";

// name/title-only shapes needed for the two pickers.
interface OpportunityOption {
  id: string;
  company: string;
  confidenceScore: number;
}

interface JobOpeningOption {
  id: string;
  title: string;
  requirements: string[];
}

interface PackageCandidate {
  id: string;
  name: string;
  fitScore: number;
  matchedSkills: string[];
  reasons: string[];
}

interface PackageContent {
  company: string;
  confidenceScore: number;
  opportunityReasons: string[];
  jobTitle: string;
  candidates: PackageCandidate[];
}

interface OpportunityPackage {
  id: string;
  opportunityId: string;
  jobOpeningId: string;
  content: PackageContent;
  aiGenerated: boolean;
  status: "draft" | "released";
  releasedBy: string | null;
  releasedAt: string | null;
  draftEmailBody: string | null;
  createdAt: string;
}

type PackagesState =
  | { status: "loading" }
  | { status: "ok"; packages: OpportunityPackage[] }
  | { status: "unauthenticated" }
  | { status: "error" };

function monogramFor(name: string): { initials: string; color: string } {
  const palette = ["#5a4be0", "#0d9488", "#c02c86", "#c67c12", "#1f8a54", "#2f6fed"];
  const initials = name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "—";
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return { initials, color: palette[hash % palette.length] };
}

const SIGNAL_CHIP_MAP: { test: (reason: string) => boolean; label: string; color: string }[] = [
  { test: (r) => r.includes("reposted"), label: "reposted role", color: "#7c70ed" },
  { test: (r) => /open (\d+) days?/i.test(r), label: "long-open", color: "#19a985" },
  { test: (r) => r.includes("no salary range"), label: "no salary range", color: "#dc6370" },
];

function signalChipsFor(reasons: string[]): { label: string; color: string }[] {
  const chips: { label: string; color: string }[] = [];
  for (const reason of reasons) {
    const match = SIGNAL_CHIP_MAP.find((s) => s.test(reason));
    if (match && !chips.some((c) => c.label === match.label)) chips.push(match);
  }
  return chips;
}

// Real, derivable from data the picker already has -- job requirements
// minus this candidate's real matchedSkills, case-insensitive to match the
// backend's own normalize() convention. Never a guess at what "should" be
// required.
function gapSkillsFor(requirements: string[], matchedSkills: string[]): string[] {
  const matchedNorm = new Set(matchedSkills.map((s) => s.trim().toLowerCase()));
  return requirements.filter((r) => !matchedNorm.has(r.trim().toLowerCase()));
}

function FitBar({ fitScore }: { fitScore: number }) {
  const pct = Math.round(fitScore * 100);
  return (
    <div className="package-fit-bar" title={`${pct}% fit`}>
      <div className="package-fit-bar-track">
        <div className="package-fit-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="package-fit-bar-label">{pct}%</span>
    </div>
  );
}

function EmailDraftEditor({
  pkg,
  onSave,
}: {
  pkg: OpportunityPackage;
  onSave: (packageId: string, body: string) => Promise<void>;
}) {
  const aiDraft = useMemo(() => composeEmailDraft(pkg.content), [pkg.content]);
  const [body, setBody] = useState(pkg.draftEmailBody ?? aiDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const wordCount = body.trim().length > 0 ? body.trim().split(/\s+/).length : 0;
  const editable = pkg.status === "draft";

  async function handleSave() {
    setSaveError(null);
    setSaving(true);
    try {
      await onSave(pkg.id, body);
    } catch {
      setSaveError("network error — could not reach the server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="package-email">
      <div className="between">
        <div className="section-title">Editable email draft</div>
        {editable && (
          <button type="button" className="btn" onClick={() => setBody(aiDraft)}>
            Restore AI draft
          </button>
        )}
      </div>
      <textarea
        className="package-email-textarea"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        readOnly={!editable}
        aria-label="editable email draft"
      />
      <div className="between package-email-meta">
        <span className="small">Word count · n={wordCount} words</span>
        <button type="button" className="btn" onClick={() => setPreview((p) => !p)}>
          {preview ? "Hide preview" : "Preview"}
        </button>
      </div>
      {preview && (
        <pre className="package-email-preview" aria-label="email draft preview">
          {body}
        </pre>
      )}
      {saveError && <p role="alert">{saveError}</p>}
      {editable && (
        <div className="actions">
          <button type="button" className="btn" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save draft"}
          </button>
        </div>
      )}
    </div>
  );
}

// The review-and-release screen: S-09's whole product philosophy in one
// place — AI does the typing (composePackage.ts, server-side), a human owns
// the release. There is no "send" button anywhere on this screen; the
// Release button only ever flips a stored flag, and the composed package
// stays on this platform either way.
export function PackageReviewScreen() {
  const [state, setState] = useState<PackagesState>({ status: "loading" });
  const [opportunities, setOpportunities] = useState<OpportunityOption[]>([]);
  const [jobOpenings, setJobOpenings] = useState<JobOpeningOption[]>([]);
  const [opportunityId, setOpportunityId] = useState("");
  const [jobOpeningId, setJobOpeningId] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function load() {
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch("/api/opportunity-packages", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) throw new Error("unauthenticated");
      if (!res.ok) throw new Error("packages fetch failed");
      const body = (await res.json()) as { packages: OpportunityPackage[] };
      setState({ status: "ok", packages: body.packages });
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
    const token = getStoredToken();
    if (!token) return;

    // Picker options only — a failure here just leaves the picker empty,
    // same "there's nothing else useful to do with this" reasoning
    // MatchScreen.tsx uses for its own job-opening picker.
    fetch("/api/hidden-demand/opportunities?includeSeedData=true", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ opportunities: OpportunityOption[] }>) : null))
      .then((body) => {
        if (body) setOpportunities(body.opportunities);
      })
      .catch(() => {});

    fetch("/api/job-openings", { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => (res.ok ? (res.json() as Promise<{ jobOpenings: JobOpeningOption[] }>) : null))
      .then((body) => {
        if (body) setJobOpenings(body.jobOpenings);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setActionError(null);
    setDrafting(true);
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      setDrafting(false);
      return;
    }
    try {
      const res = await fetch("/api/opportunity-package/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ opportunityId, jobOpeningId }),
      });
      if (res.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      const body = await res.json();
      if (!res.ok) {
        setActionError(body.error ?? "failed to draft package");
        return;
      }
      // Prepend, matching the newest-first order GET already returns.
      setState((prev) =>
        prev.status === "ok"
          ? { ...prev, packages: [body.package as OpportunityPackage, ...prev.packages] }
          : { status: "ok", packages: [body.package as OpportunityPackage] },
      );
    } catch {
      setActionError("network error — could not reach the server");
    } finally {
      setDrafting(false);
    }
  }

  async function handleRelease(packageId: string) {
    setActionError(null);
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    try {
      const res = await fetch(`/api/opportunity-package/${packageId}/release`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 401) {
        setState({ status: "unauthenticated" });
        return;
      }
      const body = await res.json();
      // 200 (released just now) and 409 (already released) both carry the
      // authoritative package in the body — either way, sync local state to
      // it so a stale double-click can never show a button that would lie.
      if (res.status !== 200 && res.status !== 409) {
        setActionError(body.error ?? "failed to release package");
        return;
      }
      const released = body.package as OpportunityPackage;
      setState((prev) =>
        prev.status === "ok"
          ? { ...prev, packages: prev.packages.map((p) => (p.id === released.id ? released : p)) }
          : prev,
      );
      if (res.status === 409) setActionError("this package was already released");
    } catch {
      setActionError("network error — could not reach the server");
    }
  }

  async function handleSaveEmail(packageId: string, draftEmailBody: string) {
    const token = getStoredToken();
    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }
    const res = await fetch(`/api/opportunity-package/${packageId}/email`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ draftEmailBody }),
    });
    if (res.status === 401) {
      setState({ status: "unauthenticated" });
      return;
    }
    const body = await res.json();
    if (!res.ok) {
      setActionError(body.error ?? "failed to save email draft");
      return;
    }
    const updated = body.package as OpportunityPackage;
    setState((prev) =>
      prev.status === "ok"
        ? { ...prev, packages: prev.packages.map((p) => (p.id === updated.id ? updated : p)) }
        : prev,
    );
  }

  if (state.status === "loading") return <p>Loading opportunity packages...</p>;
  if (state.status === "unauthenticated") {
    return <p>Your session has expired. Please log in again.</p>;
  }
  if (state.status === "error") return <p>Could not load opportunity packages.</p>;

  const packages = state.packages;
  const draftsInQueue = packages.filter((p) => p.status === "draft").length;
  const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const releasedThisWeek = packages.filter(
    (p) => p.status === "released" && p.releasedAt && new Date(p.releasedAt).getTime() >= oneWeekAgo,
  ).length;

  return (
    <section aria-label="opportunity packages">
      <h2>Opportunity Packages</h2>
      <p role="note">
        Every package below is composed by PackageAgent, not a person — nothing here has been
        sent to anyone. Release is the only action that records a human decision.
      </p>

      <div className="opportunity-kpi-strip">
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">Drafts in queue</div>
          <div className="opportunity-kpi-value">{draftsInQueue}</div>
        </div>
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">Released this week</div>
          <div className="opportunity-kpi-value opportunity-kpi-value--accent">{releasedThisWeek}</div>
        </div>
        <div className="opportunity-kpi-tile">
          <div className="opportunity-kpi-label">Response rate</div>
          <div className="opportunity-kpi-value">—</div>
          <div className="signal-card-history">trend pending 4+ weeks — no outcome/response tracking exists yet</div>
        </div>
      </div>

      <form onSubmit={handleDraft} aria-label="draft a package" className="filterbar">
        <div>
          <label htmlFor="package-opportunity">Opportunity</label>
          <br />
          <select
            id="package-opportunity"
            className="select"
            value={opportunityId}
            onChange={(event) => setOpportunityId(event.target.value)}
            required
          >
            <option value="" disabled>
              Select an opportunity
            </option>
            {opportunities.map((opportunity) => (
              <option key={opportunity.id} value={opportunity.id}>
                {opportunity.company}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="package-job">Job opening</label>
          <br />
          <select
            id="package-job"
            className="select"
            value={jobOpeningId}
            onChange={(event) => setJobOpeningId(event.target.value)}
            required
          >
            <option value="" disabled>
              Select a job opening
            </option>
            {jobOpenings.map((jobOpening) => (
              <option key={jobOpening.id} value={jobOpening.id}>
                {jobOpening.title}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" disabled={!opportunityId || !jobOpeningId || drafting}>
          {drafting ? "Drafting..." : "Draft package"}
        </button>
        <span className="small">PackageAgent composes draft · no email sent</span>
      </form>
      {actionError && <p role="alert">{actionError}</p>}

      {packages.length === 0 ? (
        <p>No packages drafted yet.</p>
      ) : (
        <ul aria-label="drafted packages" className="package-list">
          {packages.map((pkg) => {
            const monogram = monogramFor(pkg.content.company);
            const chips = signalChipsFor(pkg.content.opportunityReasons);
            const job = jobOpenings.find((j) => j.id === pkg.jobOpeningId);
            return (
              <li className="overview-card package-card" key={pkg.id}>
                <div className="between package-card-header">
                  <div className="opportunity-card-header">
                    <span className="opportunity-monogram" style={{ background: monogram.color }}>
                      {monogram.initials}
                    </span>
                    <div>
                      <h4>
                        {pkg.content.company} — {pkg.content.jobTitle}
                      </h4>
                      <span className="small">
                        {pkg.aiGenerated ? "AI-generated draft" : "Manually authored"} ·{" "}
                        {Math.round(pkg.content.confidenceScore * 100)}% confidence
                      </span>
                    </div>
                  </div>
                  <span className={`opportunity-pill package-status-pill package-status-pill--${pkg.status}`}>
                    {pkg.status}
                  </span>
                </div>

                {chips.length > 0 && (
                  <div className="row package-signal-strip">
                    {chips.map((chip) => (
                      <span
                        key={chip.label}
                        className="opportunity-pill package-signal-chip"
                        style={{ borderColor: chip.color, color: chip.color }}
                      >
                        {chip.label}
                      </span>
                    ))}
                  </div>
                )}

                <div className="package-columns">
                  <div>
                    <div className="section-title">Candidate matches</div>
                    {pkg.content.candidates.length === 0 ? (
                      <p>No matching candidates found.</p>
                    ) : (
                      <table className="table package-match-table">
                        <thead>
                          <tr>
                            <th>Candidate</th>
                            <th>Fit</th>
                            <th>Skills</th>
                            <th>Gaps</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pkg.content.candidates.map((candidate) => {
                            const gaps = job ? gapSkillsFor(job.requirements, candidate.matchedSkills) : [];
                            return (
                              <tr key={candidate.id}>
                                <td>{candidate.name}</td>
                                <td>
                                  <FitBar fitScore={candidate.fitScore} />
                                </td>
                                <td>
                                  {candidate.matchedSkills.length > 0 ? (
                                    candidate.matchedSkills.map((skill) => (
                                      <span className="opportunity-pill" key={skill}>
                                        {skill}
                                      </span>
                                    ))
                                  ) : (
                                    <span className="small">—</span>
                                  )}
                                </td>
                                <td>
                                  {gaps.map((skill) => (
                                    <span className="opportunity-pill package-gap-pill" key={skill}>
                                      {skill}
                                    </span>
                                  ))}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    {pkg.content.candidates.every((c) => c.matchedSkills.length === 0) &&
                      pkg.content.candidates.length > 0 && (
                        <p className="caption">
                          No skill overlap yet — {pkg.content.candidates[0].reasons[0] ?? "no matching evidence found"}.
                          Match visual is intentionally empty, not proof the role is too strict.
                        </p>
                      )}
                  </div>

                  <EmailDraftEditor pkg={pkg} onSave={handleSaveEmail} />
                </div>

                <div className="actions package-actions">
                  {pkg.status === "draft" ? (
                    <>
                      <p className="caption">Release records the human decision to send. Nothing has been sent yet.</p>
                      <button className="btn primary" onClick={() => handleRelease(pkg.id)}>
                        Release
                      </button>
                    </>
                  ) : (
                    <p>
                      Released by <strong>{pkg.releasedBy}</strong> at{" "}
                      {pkg.releasedAt ? new Date(pkg.releasedAt).toLocaleString() : "unknown"}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
