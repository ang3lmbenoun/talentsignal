// "Has this user seen the onboarding tour?" bookkeeping. Kept in its own
// module (not inside the component) so the storage rules live in one place.
//
// Everything here is wrapped in try/catch: localStorage can throw (private
// windows, blocked site data, quota), and a failed read/write must never stop
// the app from working. If storage fails, the tour simply behaves as "not
// seen" for that page load -- it never blocks login or crashes the shell.

const SEEN_KEY_PREFIX = "ts_tour_seen:";

/**
 * Reads the user id (the JWT's `sub` claim) out of the stored access token so
 * the "seen" flag can be per user. This only DECODES the payload for a UI
 * convenience -- it does not verify the signature and is never used for any
 * authorization decision (the backend verifies the token on every request).
 * Returns null if the token isn't a decodable JWT.
 */
export function getTourUserId(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    // JWTs use base64url (-, _ and no padding); atob wants plain base64.
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof claims.sub === "string" && claims.sub.length > 0 ? claims.sub : null;
  } catch {
    return null;
  }
}

export function hasSeenTour(userId: string): boolean {
  try {
    return localStorage.getItem(SEEN_KEY_PREFIX + userId) === "1";
  } catch {
    return false;
  }
}

// Only ever sets the flag. Nothing in the app clears it, so replaying the
// tour from the header can never cause it to auto-open again next login.
export function markTourSeen(userId: string): void {
  try {
    localStorage.setItem(SEEN_KEY_PREFIX + userId, "1");
  } catch {
    // Storage unavailable: the tour just won't be remembered this session.
  }
}
