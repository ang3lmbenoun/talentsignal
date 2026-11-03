import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronDown, CircleHelp, Moon, Save, Sun, UserRound, X } from "lucide-react";
import { applyTheme, getStoredTheme, storeTheme, type Theme } from "./theme";
import { getStoredDisplayName, getStoredRole, getStoredToken, storeDisplayName, storeEmail } from "./auth";

interface TopBarProps {
  // The backend-health indicator — App.tsx already owns that fetch/state;
  // TopBar just renders whatever it's handed, same pattern as Sidebar.
  health: ReactNode;
  email: string | null;
  onLogout: () => void;
  // Replays the onboarding tour. Omitted when the tour is disabled, in which
  // case the link is not rendered at all.
  onTakeTour?: () => void;
}

function roleLabel(role: string | null): string | null {
  if (!role) return null;
  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function TopBar({ health, email, onLogout, onTakeTour }: TopBarProps) {
  // Lazy initializer reads the attribute main.tsx already applied before
  // mount (see theme.ts), so this never disagrees with what's on screen.
  const [theme, setTheme] = useState<Theme>(() => getStoredTheme());
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [profileName, setProfileName] = useState(() => getStoredDisplayName() ?? "");
  const [profileEmail, setProfileEmail] = useState(() => email ?? "");
  const [savedProfileEmail, setSavedProfileEmail] = useState(() => email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProfileEmail(email ?? "");
  }, [email]);

  function toggleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    storeTheme(next);
    applyTheme(next);
  }

  // Click-outside and Escape both close the dropdown -- standard menu
  // behavior, no library needed for either.
  useEffect(() => {
    if (!profileOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setProfileOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

  useEffect(() => {
    if (!profileSettingsOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !profileSaving) setProfileSettingsOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [profileSettingsOpen, profileSaving]);

  async function openProfileSettings() {
    setProfileOpen(false);
    setProfileSettingsOpen(true);
    setProfileLoading(true);
    setProfileMessage(null);
    try {
      const token = getStoredToken();
      const res = await fetch("/api/auth/me", { headers: { Authorization: `Bearer ${token}` } });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Profile could not be loaded.");
      setProfileName(body.user.displayName ?? "");
      setProfileEmail(body.user.email ?? "");
      setSavedProfileEmail(body.user.email ?? "");
      setCurrentPassword("");
    } catch (err) {
      setProfileMessage({ kind: "error", text: err instanceof Error ? err.message : "Profile could not be loaded." });
    } finally {
      setProfileLoading(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileSaving(true);
    setProfileMessage(null);
    try {
      const token = getStoredToken();
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ displayName: profileName, email: profileEmail, currentPassword }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Profile could not be updated.");
      setProfileName(body.user.displayName ?? "");
      setProfileEmail(body.user.email);
      setSavedProfileEmail(body.user.email);
      setCurrentPassword("");
      storeDisplayName(body.user.displayName ?? "");
      storeEmail(body.user.email);
      setProfileMessage({ kind: "success", text: "Your profile has been updated." });
    } catch (err) {
      setProfileMessage({ kind: "error", text: err instanceof Error ? err.message : "Profile could not be updated." });
    } finally {
      setProfileSaving(false);
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-health">{health}</div>
      <div className="topbar-user">
        {onTakeTour && (
          <button type="button" className="btn-link topbar-tour-link" onClick={onTakeTour}>
            <CircleHelp size={15} aria-hidden="true" /> Take the tour
          </button>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          className="topbar-theme-toggle"
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Sun size={17} aria-hidden="true" /> : <Moon size={17} aria-hidden="true" />}
        </button>

        <div className="topbar-profile" ref={profileRef}>
          <button
            type="button"
            className="topbar-profile-trigger"
            onClick={() => setProfileOpen((open) => !open)}
            aria-haspopup="true"
            aria-expanded={profileOpen}
            aria-label="Account menu"
          >
            <UserRound size={18} aria-hidden="true" />
            <span className="topbar-email">{profileName || email || "Account"}</span>
            <ChevronDown size={14} aria-hidden="true" className={profileOpen ? "chevron open" : "chevron"} />
          </button>

          {profileOpen && (
            <div className="topbar-profile-menu" role="menu">
              <div className="topbar-profile-menu-header">
                <UserRound size={18} aria-hidden="true" />
                <div className="topbar-profile-menu-identity">
                  <span className="topbar-profile-menu-name">{profileName || "Your account"}</span>
                  <span className="topbar-profile-menu-email">{email ?? "Unknown user"}</span>
                </div>
              </div>
              {roleLabel(getStoredRole()) && (
                <span className="topbar-profile-menu-role">{roleLabel(getStoredRole())}</span>
              )}
              <hr className="topbar-profile-menu-divider" />
              <button
                type="button"
                role="menuitem"
                className="topbar-profile-menu-item"
                onClick={openProfileSettings}
              >
                Profile settings
              </button>
              <button
                type="button"
                role="menuitem"
                className="topbar-profile-menu-item"
                onClick={onLogout}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
      {profileSettingsOpen && (
        <div className="profile-dialog-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !profileSaving) setProfileSettingsOpen(false);
        }}>
          <section className="profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
            <div className="profile-dialog-heading">
              <div>
                <span className="profile-dialog-eyebrow">ACCOUNT</span>
                <h2 id="profile-dialog-title">Profile settings</h2>
                <p>Keep your name and sign-in email up to date.</p>
              </div>
              <button type="button" className="profile-dialog-close" aria-label="Close profile settings" onClick={() => setProfileSettingsOpen(false)} disabled={profileSaving}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            {profileLoading ? (
              <p className="profile-dialog-loading" role="status">Loading your profile…</p>
            ) : (
              <form className="profile-form" onSubmit={saveProfile}>
                <label htmlFor="profile-name">Full name</label>
                <input id="profile-name" type="text" autoComplete="name" maxLength={80} required value={profileName} onChange={(event) => setProfileName(event.target.value)} />
                <label htmlFor="profile-email">Sign-in email</label>
                <input id="profile-email" type="email" autoComplete="email" maxLength={254} required value={profileEmail} onChange={(event) => setProfileEmail(event.target.value)} />
                {profileEmail.trim().toLowerCase() !== savedProfileEmail.trim().toLowerCase() && <>
                  <label htmlFor="profile-current-password">Current password</label>
                  <input id="profile-current-password" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
                </>}
                <p className="profile-form-note">Your role and access are managed by your workspace administrator. Email changes take effect immediately; double-check the address before saving.</p>
                {profileMessage && <p className={`profile-form-message ${profileMessage.kind}`} role={profileMessage.kind === "error" ? "alert" : "status"}>{profileMessage.kind === "success" && <Check size={15} aria-hidden="true" />}{profileMessage.text}</p>}
                <div className="profile-form-actions">
                  <button type="button" className="profile-cancel-button" onClick={() => setProfileSettingsOpen(false)} disabled={profileSaving}>Cancel</button>
                  <button type="submit" className="profile-save-button" disabled={profileSaving}>
                    <Save size={15} aria-hidden="true" />{profileSaving ? "Saving…" : "Save changes"}
                  </button>
                </div>
              </form>
            )}
            {profileLoading && profileMessage && <p className="profile-form-message error" role="alert">{profileMessage.text}</p>}
          </section>
        </div>
      )}
    </header>
  );
}
