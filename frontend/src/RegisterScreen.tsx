import { useState, type FormEvent } from "react";
import { storeToken, storeRole, storeEmail, storeDisplayName } from "./auth";

interface RegisterScreenProps {
  onSuccess: (token: string) => void;
  onSwitchToLogin: () => void;
}

export function RegisterScreen({ onSuccess, onSwitchToLogin }: RegisterScreenProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const registerRes = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const registerBody = await registerRes.json();

      if (!registerRes.ok) {
        setError(registerBody.error ?? "registration failed");
        return;
      }

      // POST /api/auth/register returns the created user, not a token —
      // log in immediately with the same credentials so a new user lands
      // in the app instead of hitting a second, redundant form.
      const loginRes = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const loginBody = await loginRes.json();

      if (!loginRes.ok) {
        setError("registered, but automatic login failed — try logging in");
        return;
      }

      storeToken(loginBody.token);
      storeRole(loginBody.user.role);
      storeEmail(loginBody.user.email ?? email);
      storeDisplayName(loginBody.user.displayName ?? "");
      onSuccess(loginBody.token);
    } catch {
      setError("network error — could not reach the server");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <section aria-label="register" className="auth-card">
        <div className="auth-brand">
          <span className="auth-brand-mark">TS</span>
          <span className="auth-brand-name">TalentSignal</span>
        </div>
        <h2>Register</h2>
        <p className="auth-subtitle">Create your account</p>
        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="register-email">Email</label>
            <br />
            <input
              id="register-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>
          <div>
            <label htmlFor="register-password">Password (10-72 characters)</label>
            <br />
            <input
              id="register-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={10}
              maxLength={72}
              required
            />
          </div>
          <button type="submit" disabled={submitting} className="auth-submit">
            {submitting ? "Registering..." : "Register"}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        <p className="auth-switch">
          Already have an account?{" "}
          <button type="button" onClick={onSwitchToLogin}>
            Log in
          </button>
        </p>
      </section>
    </div>
  );
}
