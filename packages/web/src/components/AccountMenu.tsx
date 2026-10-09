import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useBackClose } from "../lib/useDevice";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  AccountIcon,
  AdminIcon,
  ConnectionsIcon,
  LearningIcon,
  LogOutIcon,
} from "./icons";

const items = [
  { to: "/settings/learning", label: "Learning", Icon: LearningIcon },
  { to: "/settings/account", label: "Account", Icon: AccountIcon },
  { to: "/settings/connections", label: "Connections", Icon: ConnectionsIcon },
];

const itemClass = (active: boolean) =>
  `flex w-full items-center gap-3 rounded-control px-3 py-2.5 text-sm font-medium transition-colors md:py-2 ${
    active ? "bg-surface-sunken text-ink" : "text-ink-muted hover:bg-surface-sunken hover:text-ink"
  }`;

/**
 * The account button in the header: your initial in a glass circle. It opens
 * your settings, administration (admins) and log out — a dropdown on wide
 * screens, a sheet from the bottom on phones. Rendered in a portal because the
 * header's backdrop-filter would otherwise trap fixed positioning.
 */
export function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const { pathname } = useLocation();

  // Close when the route changes (an item was followed), or on Android's back button.
  useEffect(() => setOpen(false), [pathname]);
  useBackClose(open, () => setOpen(false));

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const r = button.current?.getBoundingClientRect();
      if (r) setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function close() {
    setOpen(false);
    button.current?.focus();
  }

  if (!user) return null;
  const initial = user.username.slice(0, 1).toUpperCase();
  const admin = user.role === "admin";

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={id}
        aria-label="Account menu"
        title={user.username}
        className="ws-glass-icon grid h-9 w-9 place-items-center rounded-full text-sm font-semibold"
        style={{ "--tint": "var(--brand)" } as React.CSSProperties}
      >
        {initial}
      </button>
      {open &&
        createPortal(
          <>
            {/* Click-away layer: dims the page under the phone sheet, invisible on wide screens. */}
            <div className="ws-scrim fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
            <div
              ref={panel}
              id={id}
              role="dialog"
              aria-label="Account"
              className="ws-sheet fixed inset-x-3 bottom-[calc(var(--sa-bottom)+10px)] z-50 p-2 md:inset-x-auto md:bottom-auto md:w-64 md:p-1.5"
              style={
                anchor && window.matchMedia("(min-width: 768px)").matches
                  ? { top: anchor.top, right: anchor.right }
                  : undefined
              }
            >
              <div className="flex items-center gap-3 px-3 pb-3 pt-2 md:pb-2">
                <span
                  className="ws-glass-icon grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-semibold"
                  style={{ "--tint": "var(--brand)" } as React.CSSProperties}
                  aria-hidden
                >
                  {initial}
                </span>
                <div className="min-w-0">
                  <p className="truncate font-semibold leading-5">{user.username}</p>
                  <p className="text-xs text-ink-subtle">{admin ? "Admin" : "Learner"}</p>
                </div>
              </div>
              <div className="border-t border-line pt-1.5">
                <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  Settings
                </p>
                {items.map(({ to, label, Icon }) => (
                  <Link key={to} to={to} className={itemClass(pathname === to)} aria-current={pathname === to ? "page" : undefined}>
                    <Icon className="h-[18px] w-[18px]" />
                    {label}
                  </Link>
                ))}
                {admin && (
                  <Link to="/admin" className={itemClass(pathname.startsWith("/admin"))} aria-current={pathname.startsWith("/admin") ? "page" : undefined}>
                    <AdminIcon className="h-[18px] w-[18px]" />
                    Administration
                  </Link>
                )}
              </div>
              <div className="mt-1.5 border-t border-line pt-1.5">
                <button type="button" onClick={() => void logout()} className={itemClass(false)}>
                  <LogOutIcon className="h-[18px] w-[18px]" />
                  Log out
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
