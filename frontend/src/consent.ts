// Analytics consent. Google Analytics only loads after the visitor accepts in
// the cookie banner; the loader and the consent-mode calls live in
// public/index.html (window.lensyAnalytics), so the choice is applied before
// React starts on the next visit.

export type ConsentChoice = "granted" | "denied";

const CONSENT_KEY = "lensy-analytics-consent";
const OPEN_EVENT = "lensy:open-cookie-settings";

declare global {
  interface Window {
    lensyAnalytics?: { grant: () => void; deny: () => void };
  }
}

export function getConsent(): ConsentChoice | null {
  try {
    const saved = window.localStorage.getItem(CONSENT_KEY);
    return saved === "granted" || saved === "denied" ? saved : null;
  } catch {
    return null;
  }
}

export function setConsent(choice: ConsentChoice) {
  try {
    window.localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // Storage blocked: the choice still applies for this visit.
  }
  if (choice === "granted") window.lensyAnalytics?.grant();
  else window.lensyAnalytics?.deny();
}

// The footer's "Cookie settings" link reopens the banner.
export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onOpenCookieSettings(handler: () => void) {
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}
