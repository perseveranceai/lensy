// Cookie banner: asks once whether Google Analytics may run. Accept and
// Decline carry the same weight on purpose, so saying no is as easy as yes.
// Reopened from the footer's "Cookie settings" link.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ConsentChoice, getConsent, onOpenCookieSettings, setConsent } from "./consent";

export function CookieBanner() {
  const [open, setOpen] = useState(() => getConsent() === null);

  useEffect(() => onOpenCookieSettings(() => setOpen(true)), []);

  if (!open) return null;

  const choose = (choice: ConsentChoice) => {
    setConsent(choice);
    setOpen(false);
  };

  const buttonCls =
    "flex-1 rounded-[var(--radius-sm)] border border-[var(--line-strong)] bg-[var(--bg)] px-4 py-2 text-[var(--ink)] transition-colors hover:border-[var(--ink)]";

  return (
    <div
      role="region"
      aria-label="Cookie settings"
      data-testid="cookie-banner"
      className="popup-shadow fixed inset-x-3 bottom-3 z-50 rounded-[var(--radius-md)] border border-[var(--line-strong)] bg-[var(--bg)] p-4 sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[360px]"
    >
      <p className="text-[13px] leading-relaxed text-[var(--ink)]">
        Can we use Google Analytics cookies? They show us which pages people visit and how many scans run. No ads. Analytics stays off unless you accept.
      </p>
      {/* Font size sits on the wrapper: index.css gives buttons "font: inherit",
          which outranks utility classes placed on the button itself. */}
      <div className="mt-3 flex gap-2 text-[13px] font-medium tracking-[-.02em]">
        <button type="button" onClick={() => choose("granted")} className={buttonCls}>Accept</button>
        <button type="button" onClick={() => choose("denied")} className={buttonCls}>Decline</button>
      </div>
      <Link to="/privacy" className="mt-3 inline-block text-[12px] text-[var(--ink-soft)] underline underline-offset-2 hover:text-[var(--ink)]">
        Privacy policy
      </Link>
    </div>
  );
}
