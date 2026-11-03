import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Pre-existing environment bug, unrelated to any redesign change: this
// pinned vitest (2.0.3) copies jsdom's window properties onto the global
// object via an explicit, hardcoded allowlist that predates Node adding its
// own global `localStorage`/`sessionStorage` (Node 22+, a no-op unless
// --localstorage-file is passed). Because "localStorage" was never on that
// allowlist, vitest's copy step sees Node's own (non-functional) global
// already present and skips overriding it -- so every test touching
// auth.ts's getStoredToken/getStoredRole/etc. (i.e. every RoleGate-gated
// screen) throws on this machine's Node v26. Confirmed via `git stash` this
// fails identically on the unmodified pre-redesign code. jsdom's own,
// working localStorage still exists on the real jsdom window instance
// vitest exposes as `globalThis.jsdom.window` -- pointing the global at
// that (rather than the `window` alias, which is the same broken global)
// is the fix.
declare const jsdom: { window: Window } | undefined;
if (typeof jsdom !== "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: jsdom.window.localStorage,
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: jsdom.window.sessionStorage,
  });
}

// jsdom has no canvas implementation and logs "Not implemented" on every
// getContext call. LoginBackdrop (decorative) treats a null context as "skip
// drawing", so stub it to null to keep test output clean.
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;

// testing-library's auto-cleanup only self-registers when it detects a
// global afterEach (vitest doesn't inject one unless test.globals is set),
// so without this, each render() leaves its DOM in place for the next test
// in the same file — harmless until two tests render the same static markup
// (e.g. two "Log in" buttons), at which point queries start matching more
// than one element.
afterEach(() => {
  cleanup();
});
