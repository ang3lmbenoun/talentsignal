import { useEffect, useState } from "react";
import { Flame, Target as TargetIcon, Percent, type LucideIcon } from "lucide-react";
import { getStoredToken } from "./auth";
import { ShowTheMath } from "./components/ShowTheMath";

interface Student {
  id: string;
  name: string;
  experience: number | null;
  availability: string | null;
  fitScore: number;
  matchedSkills: string[];
  reasons: string[];
}

interface Target {
  opportunityId: string;
  company: string;
  title: string;
  roleType: string | null;
  requirements: string[];
  hardToFillScore: number;
  hardToFillReasons: string[];
  students: Student[];
}

type TargetingState =
  | { status: "loading" }
  | { status: "ok"; targets: Target[] }
  | { status: "unauthenticated" }
  | { status: "error" };

// Redesign per talentsignal-redesign.html's "Targeting" screen -- same
// .kpi-tile visual language S-25/S-29 already established on Overview
// (icon badge, big value, sample-size caption, and plain-English context),
// reused here rather than invented fresh, so Targeting matches the rest of
// the app. This screen has no history series, so it avoids a decorative
// sparkline that could be mistaken for measured trend data.
function KpiTile({
  icon: Icon,
  value,
  label,
  why,
  caption,
}: {
  icon: LucideIcon;
  value: string;
  label: string;
  why: string;
  caption?: string;
}) {
  return (
    <div className="kpi-tile" role="group" aria-label={label}>
      <div className="kpi-tile-top">
        <span className="kpi-tile-label">{label}</span>
        <span className="kpi-tile-icon">
          <Icon size={16} aria-hidden="true" />
        </span>
      </div>
      <span className="kpi-tile-value mono">{value}</span>
      {caption && <p className="kpi-tile-caption">{caption}</p>}
      <p className="kpi-tile-why">Why it matters: {why}</p>
    </div>
  );
}

function companyMonogram(company: string): string {
  return company.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "—";
}

const FIXTURE_NAME_PREFIX = /^Fixture Candidate\s*[—–-]\s*/i;

function isFixtureName(name: string): boolean {
  return FIXTURE_NAME_PREFIX.test(name);
}

function candidateDisplayName(name: string): string {
  return name.replace(FIXTURE_NAME_PREFIX, "");
}

const ROLE_FAMILY_LABELS: Record<string, string> = {
  "engineering-swe": "software engineering", "ml-ai": "AI and machine learning",
  "data-analytics": "data and analytics", security: "security", "cloud-infra": "cloud and infrastructure",
  "support-cs": "support and customer success", "sales-bizdev": "sales and business development",
  "retail-ops": "retail and operations", "general-other": "other roles",
};

function explainTargetReason(reason: string): string {
  const measured = reason.match(/role scarcity: measured \(family '([^']+)', median (\d+)d vs global (\d+)d\)/i);
  if (measured) return `Similar eligible live postings in ${ROLE_FAMILY_LABELS[measured[1]] ?? measured[1]} stay open for a median of ${measured[2]} days, compared with ${measured[3]} days across eligible roles.`;
  if (reason.startsWith("role scarcity: curated")) return "The title matches a role type selected for closer review. This is role guidance, not a measured scarcity rate.";
  const open = reason.match(/^open (\d+) days?$/i);
  if (open) return `This posting has been open for ${open[1]} days. Check that it is still active and whether the sourcing plan needs to change.`;
  if (reason === "reposted role") return "This role appears to have been reposted. Check whether the client is still hiring or renewed the listing.";
  const capacity = reason.match(/^capacity: ([^,]+) matched \(([^)]+)\), (high-confidence|low-confidence)(.*)$/i);
  if (capacity) {
    const confidence = capacity[3].toLowerCase() === "high-confidence" ? "stronger" : "less certain";
    const excluded = capacity[4].includes("excluded") ? " The record is outside the recent-history window, so do not count it as current evidence." : "";
    return `A ${confidence} related hiring record from ${capacity[1]} matched ${capacity[2]}.${excluded}`;
  }
  return reason.replace(/[_-]+/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

interface FitCluster {
  percent: number;
  label: string;
  students: Student[];
}

// Groups by each student's OWN real, exact fit percentage -- not an
// invented numeric range like "21-29%" (which would be exactly the kind of
// unlogged business threshold CLAUDE.md rule 4 forbids). Candidates who
// happen to share a real percentage end up in the same cluster; the
// resulting cluster sizes/gaps are a direct readout of the real score
// distribution, not a boundary this app chose.
function groupByFitPercent(students: Student[]): FitCluster[] {
  const byPercent = new Map<number, Student[]>();
  for (const s of students) {
    const pct = Math.round(s.fitScore * 100);
    if (!byPercent.has(pct)) byPercent.set(pct, []);
    byPercent.get(pct)?.push(s);
  }
  return [...byPercent.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([percent, group]) => ({
      percent,
      label: percent === 0 ? "No skill overlap" : `${percent}% fit`,
      students: group,
    }));
}

function CandidateRow({ student }: { student: Student }) {
  return (
    <div className="targeting-candidate">
      <div className="between">
        <b>{candidateDisplayName(student.name)}</b>
        <span className="targeting-candidate-fit mono">{Math.round(student.fitScore * 100)}% fit</span>
      </div>
      <div className="row" style={{ marginTop: "4px" }}>
        {student.matchedSkills.length > 0 ? (
          student.matchedSkills.map((skill) => (
            <span className="opportunity-pill" key={skill}>
              {skill}
            </span>
          ))
        ) : (
          <span className="small">no matching skills</span>
        )}
      </div>
      <p className="small" style={{ margin: "4px 0 0" }}>
        {student.experience !== null ? `${student.experience} years exp.` : "experience unknown"}
        {student.availability ? ` · ${student.availability}` : ""}
      </p>
      {student.reasons.length > 0 && <p className="caption">{student.reasons.join("; ")}</p>}
    </div>
  );
}

function TargetRoleCard({ target }: { target: Target }) {
  const clusters = groupByFitPercent(target.students);
  const fitAvailable = target.requirements.length > 0 && target.students.length > 0;
  const topFit = fitAvailable ? target.students[0]?.fitScore ?? 0 : null;

  return (
    <details className="overview-card targeting-role-card targeting-role-details">
      <summary className="targeting-role-summary">
      <div className="between">
        <div className="opportunity-card-header" style={{ marginBottom: 0 }}>
          <span className="opportunity-monogram" style={{ background: "var(--accent)" }}>
            {companyMonogram(target.company)}
          </span>
          <div className="opportunity-card-heading">
            <h3 style={{ fontSize: "14px", margin: 0 }}>{target.title}</h3>
            <span className="small">{target.company}</span>
          </div>
        </div>
        <span className="opportunity-age-badge opportunity-age-badge--red" title="Role-difficulty indicator for review; not a probability of hiring">
          Difficulty signal {Math.round(target.hardToFillScore * 100)} of 100
        </span>
      </div>

      <div className="opportunity-card-pills" style={{ marginTop: "10px" }}>
        <span className="opportunity-pill">{target.requirements.length > 0 ? `Role criteria · ${target.requirements.length} skills` : "Role criteria · not identified"}</span>
        <span className="opportunity-pill">{fitAvailable ? `Compared · ${target.students.length} candidates` : `Candidate pool · ${target.students.length} profiles`}</span>
        {target.roleType && <span className="opportunity-pill">{target.roleType}</span>}
        <span className="opportunity-pill">{topFit === null ? "Candidate fit · unavailable" : `Closest fit · ${Math.round(topFit * 100)}%`}</span>
      </div>

      <span className="targeting-expand-label">{target.requirements.length > 0 ? "Open fit breakdown" : "View why this role is flagged"}</span>
      </summary>
      <div className="targeting-role-content">

      <div className="opportunity-why" style={{ marginTop: "10px" }}>
        <b>Why the role is flagged for review</b>
        {target.hardToFillReasons.length > 0
          ? <ul className="targeting-reason-list">{target.hardToFillReasons.map((reason, index) => <li key={`${reason}-${index}`}>{explainTargetReason(reason)}</li>)}</ul>
          : <p>No specific role-difficulty clues were provided. Review the posting details before deciding whether it needs attention.</p>}
      </div>

      {target.requirements.length === 0 && <p className="targeting-data-note" role="note">Candidate fit is not available because the app could not identify role skills to compare. Review or add clear requirements before using fit results to decide whether to adjust the job criteria or source more candidates.</p>}

      {target.requirements.length > 0 && (
        <p className="small" style={{ marginTop: "8px" }}>
          <em>Needs:</em> {target.requirements.join(", ")}
        </p>
      )}

      <div className="hr" />

      <div className="between">
        <h4 className="section-title">{target.requirements.length > 0 ? "Candidate fit by skill overlap" : "Candidate fit unavailable"}</h4>
        <span className="small">{target.requirements.length > 0 ? "Select a bar to see candidates and the skills that matched." : "Add identifiable role criteria before comparing candidates."}</span>
      </div>

      {target.requirements.length > 0 && <div className="target-bars">
        {clusters.map((cluster) => (
          <details className="cluster" key={cluster.percent}>
            <summary>
              <span className="cluster-label">
                {cluster.label}
              </span>
              <span className="barline" aria-hidden="true">
                <i
                  style={{
                    width: `${(cluster.students.length / target.students.length) * 100}%`,
                    background: cluster.percent === 0 ? "var(--border)" : undefined,
                  }}
                />
              </span>
        <b className="mono">{cluster.students.length} candidates</b>
              <span className="cluster-action">Review candidates</span>
            </summary>
            <div className="cluster-list targeting-cluster-list">
              {cluster.students.map((student) => (
                <CandidateRow student={student} key={student.id} />
              ))}
            </div>
          </details>
        ))}
      </div>}
      {target.requirements.length > 0 && clusters.length === 0 && (
        <p className="targeting-empty-state">No candidate profiles are available to compare for this role yet.</p>
      )}
      <p className="caption">
        {target.requirements.length > 0 ? `Compared ${target.students.length} candidates. Candidate fit estimates skill overlap with this role.` : "Candidate fit cannot be estimated until role requirements are identified."} The role-difficulty signal describes the role. Neither is a guarantee of hiring success.
      </p>
      </div>
    </details>
  );
}

export function HardToFillTargeting() {
  const [state, setState] = useState<TargetingState>({ status: "loading" });
  const [query, setQuery] = useState("");
  const [client, setClient] = useState("all");
  const [fitEvidence, setFitEvidence] = useState("all");

  useEffect(() => {
    let cancelled = false;
    const token = getStoredToken();

    if (!token) {
      setState({ status: "unauthenticated" });
      return;
    }

    fetch("/api/hard-to-fill/targeting?includeSeedData=true", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (res.status === 401) throw new Error("unauthenticated");
        if (!res.ok) throw new Error(`targeting fetch failed: ${res.status}`);
        return res.json() as Promise<{ targets: Target[] }>;
      })
      .then((body) => {
        if (!cancelled) setState({ status: "ok", targets: body.targets });
      })
      .catch((err) => {
        if (cancelled) return;
        setState(
          err instanceof Error && err.message === "unauthenticated"
            ? { status: "unauthenticated" }
            : { status: "error" },
        );
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") return <p>Loading targeting...</p>;
  if (state.status === "unauthenticated") return <p>Your session has expired. Please log in again.</p>;
  if (state.status === "error") return <p>Could not load targeting.</p>;
  if (state.targets.length === 0) return <p>No hard-to-fill roles to target yet.</p>;

  const targets = state.targets;
  const comparableTargets = targets.filter((target) => target.requirements.length > 0 && target.students.length > 0);
  const totalStudents = comparableTargets.reduce((sum, target) => sum + target.students.length, 0);
  const topFitAcrossAll = Math.max(0, ...comparableTargets.flatMap((t) => t.students.map((s) => s.fitScore)));
  const avgHardToFill = targets.reduce((sum, t) => sum + t.hardToFillScore, 0) / targets.length;
  const includesFixtureCandidates = targets.some((target) => target.students.some((student) => isFixtureName(student.name)));
  const clients = [...new Set(targets.map((target) => target.company))].sort();
  const visibleTargets = targets.filter((target) => {
    if (client !== "all" && target.company !== client) return false;
    if (query && !`${target.title} ${target.company}`.toLowerCase().includes(query.toLowerCase())) return false;
    const fitAvailable = target.requirements.length > 0 && target.students.length > 0;
    if (fitEvidence === "available" && !fitAvailable) return false;
    if (fitEvidence === "unavailable" && fitAvailable) return false;
    return true;
  });

  return (
    <section aria-label="hard-to-fill targeting">
      <div className="targeting-intro">
        <h2>Hard-to-fill targeting</h2>
        <p>
          Review roles that may take more effort to fill, then compare candidate fit. A hard-to-fill score describes the role; a fit score describes one candidate against that role.
        </p>
      </div>
      {includesFixtureCandidates && (
        <p className="targeting-data-note" role="note">
          Synthetic demo candidate profiles are included. Their repeated “Fixture Candidate” prefix is hidden here for readability.
        </p>
      )}

      <div className="kpi-grid">
        <KpiTile
          icon={Flame}
          value={String(targets.length)}
          label="Target roles"
          why="roles that the existing difficulty rules flagged for a closer look"
          caption={`${targets.length} requisitions in this view`}
        />
        <KpiTile
          icon={TargetIcon}
          value={comparableTargets.length > 0 ? `${Math.round(topFitAcrossAll * 100)}%` : "—"}
          label="Closest available candidate fit"
          why="the strongest skill-overlap score among candidates currently compared; review the gaps before deciding"
          caption={`${totalStudents} candidate-role comparisons with identified requirements`}
        />
        <KpiTile
          icon={Percent}
          value={`${Math.round(avgHardToFill * 100)} of 100`}
          label="Average difficulty signal among flagged roles"
          why="average indicator across flagged roles; it is not a probability that a role will be filled"
          caption={`Across ${targets.length} flagged roles`}
        />
      </div>

      <p className="trend-note">A trend appears after at least four weeks of history, which is not available yet.</p>

      <ShowTheMath>
        <p><b>Fit comparisons: {totalStudents}</b>. Candidate-to-role comparisons across the roles shown below; one candidate can appear for multiple roles.</p>
        <p><b>Difficulty signal</b> is shown out of 100 and is capped at 100. It is an indicator for review, not a probability that a role will be filled.</p>
      </ShowTheMath>

      {/* The whole point of the trust scenario (HF-3): this is a SUGGESTION.
          A human decides who to submit; the app never submits anyone. There is
          deliberately no "submit" control anywhere on this screen. */}
      <p role="note" className="opportunity-why" style={{ marginBottom: "14px" }}>
        <b>How to read this list</b>
        A role-difficulty signal points to a role worth reviewing; candidate fit shows skill overlap with that role. Check the reasons and missing skills, then decide whether to adjust the job criteria or source more candidates. Nothing is submitted automatically.
      </p>

      <div className="filterbar targeting-filters" aria-label="Filter target roles" data-tour="targeting-company-grouping">
        <input className="select" type="search" placeholder="Search role or company" aria-label="Search role or company" value={query} onChange={(event) => setQuery(event.target.value)} />
        <select className="select" aria-label="Filter by company" value={client} onChange={(event) => setClient(event.target.value)}>
          <option value="all">All companies</option>{clients.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <select className="select" aria-label="Filter by candidate evidence" value={fitEvidence} onChange={(event) => setFitEvidence(event.target.value)}>
          <option value="all">All fit evidence</option><option value="available">Fit can be assessed</option><option value="unavailable">Fit unavailable</option>
        </select>
        <span className="caption">Showing {visibleTargets.length} of {targets.length} flagged roles</span>
      </div>

      <div className="targeting-role-list">
        {visibleTargets.map((target) => (
          <TargetRoleCard target={target} key={target.opportunityId} />
        ))}
        {visibleTargets.length === 0 && <p className="targeting-empty-state">No roles match these filters. Clear the search or choose another client.</p>}
      </div>
    </section>
  );
}
