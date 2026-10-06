import { useEffect, useState } from "react";
import { Flame, Users, Target as TargetIcon, Percent, type LucideIcon } from "lucide-react";
import { getStoredToken } from "./auth";

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
// (icon badge, big value, placeholder sparkline, "why it matters" caption),
// reused here rather than invented fresh, so Targeting finally matches the
// rest of the app instead of being the one screen still on bare <ul>/<li>.
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
      <svg className="kpi-tile-sparkline" viewBox="0 0 100 24" role="img" aria-label="Trend placeholder, no history yet">
        <path d="M0 18 L15 12 L30 15 L45 8 L60 12 L75 6 L100 10" fill="none" stroke="var(--border)" strokeWidth="2" />
      </svg>
      {caption && <p className="kpi-tile-caption">{caption}</p>}
      <p className="kpi-tile-trend">Trend pending · needs 4+ weeks of ingestion</p>
      <p className="kpi-tile-why">Why it matters: {why}</p>
    </div>
  );
}

function companyMonogram(company: string): string {
  return company.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase() || "—";
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
        <b>{student.name}</b>
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
  const topFit = target.students[0]?.fitScore ?? 0;

  return (
    <article className="overview-card targeting-role-card">
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
        <span className="opportunity-age-badge opportunity-age-badge--red">
          🔴 {Math.round(target.hardToFillScore * 100)}% hard to fill
        </span>
      </div>

      <div className="opportunity-card-pills" style={{ marginTop: "10px" }}>
        <span className="opportunity-pill">Requirements · n={target.requirements.length}</span>
        <span className="opportunity-pill">Ranked candidates · n={target.students.length}</span>
        {target.roleType && <span className="opportunity-pill">{target.roleType}</span>}
        <span className="opportunity-pill">Top fit · {Math.round(topFit * 100)}%</span>
      </div>

      <div className="opportunity-why" style={{ marginTop: "10px" }}>
        <b>Why this is a signal</b>
        {target.hardToFillReasons.join(", ")}
      </div>

      {target.requirements.length > 0 && (
        <p className="small" style={{ marginTop: "8px" }}>
          <em>Needs:</em> {target.requirements.join(", ")}
        </p>
      )}

      <div className="hr" />

      <div className="between">
        <h4 className="section-title">Candidate-fit clusters</h4>
        <span className="small">Each cluster is a real, shared fit percentage — not a chosen range.</span>
      </div>

      <div className="target-bars">
        {clusters.map((cluster) => (
          <details className="cluster" key={cluster.percent}>
            <summary>
              <span className="cluster-label">
                {cluster.label} · {cluster.percent}%
              </span>
              <span className="barline">
                <i
                  style={{
                    width: `${(cluster.students.length / target.students.length) * 100}%`,
                    background: cluster.percent === 0 ? "var(--border)" : undefined,
                  }}
                />
              </span>
              <b className="mono">n={cluster.students.length}</b>
            </summary>
            <div className="cluster-list targeting-cluster-list">
              {cluster.students.map((student) => (
                <CandidateRow student={student} key={student.id} />
              ))}
            </div>
          </details>
        ))}
      </div>
      <p className="caption">
        Counts total n={target.students.length}. The {Math.round(target.hardToFillScore * 100)}% hard-to-fill score is not a
        candidate fit score.
      </p>
    </article>
  );
}

export function HardToFillTargeting() {
  const [state, setState] = useState<TargetingState>({ status: "loading" });

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
  const totalStudents = targets.reduce((sum, t) => sum + t.students.length, 0);
  const topFitAcrossAll = Math.max(0, ...targets.flatMap((t) => t.students.map((s) => s.fitScore)));
  const avgHardToFill = targets.reduce((sum, t) => sum + t.hardToFillScore, 0) / targets.length;

  return (
    <section aria-label="hard-to-fill targeting">
      <h2>Targeting</h2>

      <div className="kpi-grid">
        <KpiTile
          icon={Flame}
          value={String(targets.length)}
          label="Target roles"
          why="hard-to-fill roles currently cleared for targeting"
          caption={`n=${targets.length} requisitions`}
        />
        <KpiTile
          icon={Users}
          value={String(totalStudents)}
          label="Ranked candidate rows"
          why="every candidate ranked against at least one target role"
          caption={`n=${totalStudents} ranked rows`}
        />
        <KpiTile
          icon={TargetIcon}
          value={`${Math.round(topFitAcrossAll * 100)}%`}
          label="Top candidate fit"
          why="the single best real match across every target role"
          caption="n=1 candidate"
        />
        <KpiTile
          icon={Percent}
          value={`${Math.round(avgHardToFill * 100)}%`}
          label="Avg hard-to-fill score"
          why="average difficulty across the roles shown below"
          caption={`n=${targets.length} roles`}
        />
      </div>

      {/* The whole point of the trust scenario (HF-3): this is a SUGGESTION.
          A human decides who to submit; the app never submits anyone. There is
          deliberately no "submit" control anywhere on this screen. */}
      <p role="note" className="opportunity-why" style={{ marginBottom: "14px" }}>
        <b>Suggestion, not an action</b>
        Suggested matches — a human decides who to submit. Nothing is submitted automatically.
      </p>

      <div className="targeting-role-list">
        {targets.map((target) => (
          <TargetRoleCard target={target} key={target.opportunityId} />
        ))}
      </div>
    </section>
  );
}
