import { useEffect, useState } from "react";
import {
  LayoutDashboard,
  Briefcase,
  Radio,
  Target,
  Building2,
  Users,
  ClipboardList,
  Link2,
  Columns3,
  Package,
  Handshake,
  Sparkles,
  BarChart3,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { OverviewScreen } from "./OverviewScreen";
import { OpportunitiesList } from "./OpportunitiesList";
import { SignalsScreen } from "./SignalsScreen";
import { HardToFillTargeting } from "./HardToFillTargeting";
import { LoginScreen } from "./LoginScreen";
import { RegisterScreen } from "./RegisterScreen";
import { ClientsScreen } from "./ClientsScreen";
import { CandidatesScreen } from "./CandidatesScreen";
import { JobOpeningsScreen } from "./JobOpeningsScreen";
import { MatchScreen } from "./MatchScreen";
import { SalesPipelineBoard } from "./SalesPipelineBoard";
import { PackageReviewScreen } from "./PackageReviewScreen";
import { RelationshipsPanel } from "./RelationshipsPanel";
import { RecommendationScreen } from "./RecommendationScreen";
import { AnalyticsDashboard } from "./AnalyticsDashboard";
import { PrivacyRequestScreen } from "./PrivacyRequestScreen";
import { RoleGate } from "./RoleGate";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { clearStoredToken, getStoredToken, getStoredEmail } from "./auth";
import { getStoredSidebarState, storeSidebarState } from "./sidebarState";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; db: string }
  | { status: "error" };

type AuthView = "login" | "register";

export function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  // Lazy initializer (the () => ... form) runs getStoredToken() once, on
  // the first render only — not on every re-render the way `useState(getStoredToken())`
  // would call it.
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [authView, setAuthView] = useState<AuthView>("login");
  // Which screen the sidebar nav is currently showing. Every screen stays
  // mounted (so it keeps fetching and so the role-gating tests still see it);
  // only the active one is visible — the others carry the `hidden` attribute.
  // Overview is now the default landing view (was "opportunities").
  const [view, setView] = useState<string>("overview");
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(
    () => getStoredSidebarState() === "closed",
  );

  useEffect(() => {
    let cancelled = false;

    fetch("/api/health")
      .then((res) => {
        if (!res.ok) throw new Error(`health check failed: ${res.status}`);
        return res.json() as Promise<{ status: string; db: string }>;
      })
      .then((body) => {
        if (!cancelled) setHealth({ status: "ok", db: body.db });
      })
      .catch(() => {
        if (!cancelled) setHealth({ status: "error" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogout() {
    clearStoredToken();
    setToken(null);
    setAuthView("login");
  }

  function toggleSidebarCollapsed() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    storeSidebarState(next ? "closed" : "open");
  }

  // A small helper so each nav button is written the same way. `key` matches the
  // `view` value that reveals its screen below.
  function navBtn(key: string, label: string, Icon: LucideIcon) {
    return (
      <button
        type="button"
        className={view === key ? "navbtn on" : "navbtn"}
        onClick={() => setView(key)}
      >
        <Icon size={17} aria-hidden="true" />
        <span>{label}</span>
      </button>
    );
  }

  const healthPill = (
    <section aria-label="backend health">
      {health.status === "loading" && <p>Checking backend...</p>}
      {health.status === "ok" && <p>Backend reachable — db: {health.db}</p>}
      {health.status === "error" && <p>Backend unreachable</p>}
    </section>
  );

  if (!token) {
    // The health pill still needs to render pre-login — App.test.tsx's
    // happy/failure-path tests check it with no stored token — but it would
    // clutter the branded card, so it sits as a small unobtrusive corner
    // badge rather than inside the card itself.
    return (
      <>
        <div className="auth-health-badge">{healthPill}</div>
        {authView === "login" ? (
          <LoginScreen onSuccess={setToken} onSwitchToRegister={() => setAuthView("register")} />
        ) : (
          <RegisterScreen onSuccess={setToken} onSwitchToLogin={() => setAuthView("login")} />
        )}
      </>
    );
  }

  return (
    <div className={sidebarCollapsed ? "app-shell sidebar-collapsed" : "app-shell"}>
      <Sidebar collapsed={sidebarCollapsed} onToggleCollapsed={toggleSidebarCollapsed}>
        {/* Each item is role-gated the same way its screen is, so a role
            only ever sees tabs it is allowed to open. */}
        <RoleGate allow={["admin", "sales", "recruiter"]}>
          {navBtn("overview", "Overview", LayoutDashboard)}
        </RoleGate>
        <RoleGate allow={["admin", "sales"]}>{navBtn("opportunities", "Opportunities", Briefcase)}</RoleGate>
        <RoleGate allow={["admin", "sales"]}>{navBtn("signals", "Signals", Radio)}</RoleGate>
        <RoleGate allow={["admin", "sales"]}>{navBtn("targeting", "Targeting", Target)}</RoleGate>
        {/* S-25: Clients now aggregates GET /api/hidden-demand/opportunities
            (admin/sales-only on the backend), not the old CRM /api/clients
            (admin/sales/recruiter) -- narrowed to match, so a recruiter
            never lands on a screen that can't load. */}
        <RoleGate allow={["admin", "sales"]}>{navBtn("clients", "Clients", Building2)}</RoleGate>
        <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("candidates", "Candidates", Users)}</RoleGate>
        <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("jobs", "Jobs", ClipboardList)}</RoleGate>
        <RoleGate allow={["admin", "sales"]}>{navBtn("match", "Match", Link2)}</RoleGate>
        <RoleGate allow={["admin", "sales"]}>{navBtn("pipeline", "Pipeline", Columns3)}</RoleGate>
        <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("packages", "Packages", Package)}</RoleGate>
        <RoleGate allow={["admin", "sales", "recruiter"]}>
          {navBtn("relationships", "Relationships", Handshake)}
        </RoleGate>
        <RoleGate allow={["admin", "recruiter"]}>
          {navBtn("recommendations", "Recommendations", Sparkles)}
        </RoleGate>
        <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("analytics", "Analytics", BarChart3)}</RoleGate>
        <RoleGate allow={["admin", "recruiter"]}>{navBtn("privacy", "Privacy", ShieldCheck)}</RoleGate>
      </Sidebar>

      <div className="app-main">
        <TopBar health={healthPill} email={getStoredEmail()} onLogout={handleLogout} />

        <main className="content">
          {/* Role gates per 06_decisions/022's permission matrix — UX only,
              the backend requireRole gate is the real boundary. */}
          <div hidden={view !== "overview"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <OverviewScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "opportunities"}>
            <RoleGate allow={["admin", "sales"]}>
              <section aria-label="opportunities">
                <h2>Opportunities</h2>
                <OpportunitiesList />
              </section>
            </RoleGate>
          </div>
          <div hidden={view !== "signals"}>
            <RoleGate allow={["admin", "sales"]}>
              <SignalsScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "targeting"}>
            <RoleGate allow={["admin", "sales"]}>
              <section aria-label="hard-to-fill targeting">
                <h2>Hard-to-fill targeting</h2>
                <HardToFillTargeting />
              </section>
            </RoleGate>
          </div>
          <div hidden={view !== "clients"}>
            <RoleGate allow={["admin", "sales"]}>
              <ClientsScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "candidates"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <CandidatesScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "jobs"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <JobOpeningsScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "match"}>
            <RoleGate allow={["admin", "sales"]}>
              <MatchScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "pipeline"}>
            <RoleGate allow={["admin", "sales"]}>
              <SalesPipelineBoard />
            </RoleGate>
          </div>
          <div hidden={view !== "packages"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <PackageReviewScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "relationships"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <RelationshipsPanel />
            </RoleGate>
          </div>
          <div hidden={view !== "recommendations"}>
            <RoleGate allow={["admin", "recruiter"]}>
              <RecommendationScreen />
            </RoleGate>
          </div>
          <div hidden={view !== "analytics"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <AnalyticsDashboard />
            </RoleGate>
          </div>
          {/* Staff-initiated privacy workflow, not a candidate-facing
              portal — there is no candidate login anywhere in this app
              (06_decisions/023). */}
          <div hidden={view !== "privacy"}>
            <RoleGate allow={["admin", "recruiter"]}>
              <PrivacyRequestScreen />
            </RoleGate>
          </div>
        </main>
      </div>
    </div>
  );
}
