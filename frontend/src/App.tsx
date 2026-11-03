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
import { clearStoredToken, getStoredToken, getStoredEmail, storeDisplayName, storeEmail } from "./auth";
import { getStoredSidebarState, storeSidebarState } from "./sidebarState";
import { OnboardingTour } from "./components/OnboardingTour";
import { getTourUserId, hasSeenTour, markTourSeen } from "./lib/onboardingTour";

type HealthState =
  | { status: "loading" }
  | { status: "ok"; db: string }
  | { status: "error" };

type AuthView = "login" | "register";

interface AppProps {
  // Opt-in: main.tsx turns the first-run tour on; everything that renders
  // <App /> without it (including the existing tests) never sees the tour.
  onboarding?: boolean;
}

export function App({ onboarding = false }: AppProps = {}) {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  // Lazy initializer (the () => ... form) runs getStoredToken() once, on
  // the first render only — not on every re-render the way `useState(getStoredToken())`
  // would call it.
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [authView, setAuthView] = useState<AuthView>("login");
  const [tourOpen, setTourOpen] = useState(false);
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

  // A cached token can expire while the app is closed. Validate it before
  // rendering authenticated screens so users land on login instead of seeing
  // a dashboard full of failed/empty requests. Network errors are left to the
  // normal workspace status handling; only an explicit 401 ends the session.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        // A 404 also means the running API is an older build without the
        // session-profile route; keeping the dashboard open in that case
        // would leave the user with nonfunctional, misleading empty panels.
        if (res.status === 401 || res.status === 404) {
          if (!cancelled) {
            clearStoredToken();
            setToken(null);
            setAuthView("login");
          }
          return;
        }
        if (!res.ok) return;
        const body = (await res.json()) as { user?: { email?: string; displayName?: string } };
        if (!cancelled && body.user) {
          if (body.user.email) storeEmail(body.user.email);
          storeDisplayName(body.user.displayName ?? "");
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [token]);

  // First-run tour: once the user is authenticated, open it if this user id
  // has no "seen" flag yet. Runs again when the token changes, so signing in
  // as a different user re-checks that user's own flag.
  useEffect(() => {
    if (!onboarding || !token) return;
    const userId = getTourUserId(token);
    if (userId && !hasSeenTour(userId)) setTourOpen(true);
  }, [onboarding, token]);

  // Called for "Get started", "Skip tour" and Escape alike. It only ever SETS
  // the seen flag, so replaying the tour from the header can't make it
  // auto-open again later.
  function closeTour() {
    const userId = getTourUserId(token);
    if (userId) markTourSeen(userId);
    setTourOpen(false);
  }

  function handleLogout() {
    setTourOpen(false);
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
    <section aria-label="workspace status">
      {health.status === "loading" && <p className="workspace-status-loading">Connecting to your workspace…</p>}
      {health.status === "ok" && <p className="workspace-status-ready">Workspace ready</p>}
      {health.status === "error" && <p className="workspace-status-error">Some workspace data may be unavailable. Try refreshing.</p>}
    </section>
  );

  if (!token) {
    // The health pill still needs to render pre-login — App.test.tsx's
    // happy/failure-path tests check it with no stored token — but it would
    // clutter the branded card, so it sits as a small unobtrusive corner
    // badge rather than inside the card itself.
    return (
      <>
        {/* On the login view the fixed corner badge collides with the headline on
            narrow screens, so it is visually hidden there (still in the DOM and
            readable by assistive tech). Register keeps the normal badge. */}
        <div
          className="auth-health-badge"
          style={
            authView === "login"
              ? { position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }
              : undefined
          }
        >
          {healthPill}
        </div>
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
        {/* Each item and its group are role-gated just like the matching screen. */}
        <div className="sidebar-group">
          <span className="sidebar-group-label">Workspace</span>
          <RoleGate allow={["admin", "sales", "recruiter"]}>
            {navBtn("overview", "Overview", LayoutDashboard)}
          </RoleGate>
        </div>
        <RoleGate allow={["admin", "sales"]}>
          <div className="sidebar-group">
            <span className="sidebar-group-label">Demand intelligence</span>
            {navBtn("opportunities", "Opportunities", Briefcase)}
            {navBtn("signals", "Signals", Radio)}
            {navBtn("targeting", "Targeting", Target)}
            {navBtn("clients", "Clients", Building2)}
          </div>
        </RoleGate>
        <div className="sidebar-group">
          <span className="sidebar-group-label">Talent</span>
          <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("candidates", "Candidates", Users)}</RoleGate>
          <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("jobs", "Jobs", ClipboardList)}</RoleGate>
          <RoleGate allow={["admin", "sales"]}>{navBtn("match", "Match", Link2)}</RoleGate>
        </div>
        <div className="sidebar-group">
          <span className="sidebar-group-label">Workflow</span>
          <RoleGate allow={["admin", "sales"]}>{navBtn("pipeline", "Pipeline", Columns3)}</RoleGate>
          <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("packages", "Packages", Package)}</RoleGate>
          <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("relationships", "Relationships", Handshake)}</RoleGate>
          <RoleGate allow={["admin", "recruiter"]}>{navBtn("recommendations", "Recommendations", Sparkles)}</RoleGate>
        </div>
        <div className="sidebar-group">
          <span className="sidebar-group-label">Insights &amp; privacy</span>
          <RoleGate allow={["admin", "sales", "recruiter"]}>{navBtn("analytics", "Analytics", BarChart3)}</RoleGate>
          <RoleGate allow={["admin", "recruiter"]}>{navBtn("privacy", "Privacy", ShieldCheck)}</RoleGate>
        </div>
      </Sidebar>

      <div className="app-main">
        <TopBar
          health={healthPill}
          email={getStoredEmail()}
          onLogout={handleLogout}
          onTakeTour={onboarding ? () => setTourOpen(true) : undefined}
        />

        <main className="content">
          {/* Role gates per 06_decisions/022's permission matrix — UX only,
              the backend requireRole gate is the real boundary. */}
          <div hidden={view !== "overview"}>
            <RoleGate allow={["admin", "sales", "recruiter"]}>
              <OverviewScreen onNavigate={setView} />
            </RoleGate>
          </div>
          <div hidden={view !== "opportunities"}>
            <RoleGate allow={["admin", "sales"]}>
              <OpportunitiesList />
            </RoleGate>
          </div>
          <div hidden={view !== "signals"}>
            <RoleGate allow={["admin", "sales"]}>
              <SignalsScreen onNavigate={setView} />
            </RoleGate>
          </div>
          <div hidden={view !== "targeting"}>
            <RoleGate allow={["admin", "sales"]}>
              <HardToFillTargeting />
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
      {onboarding && tourOpen && <OnboardingTour onClose={closeTour} />}
    </div>
  );
}
