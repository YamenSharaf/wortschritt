import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronRightIcon } from "./icons";

/**
 * Small building blocks from the Wortschritt design system, so screens share
 * one look. Colours come from the design tokens (see tailwind.config.js).
 */

/** Button class names. Primary is the glass brand button (see index.css). */
export const btn = {
  base: "inline-flex h-10 items-center justify-center gap-2 rounded-control px-4 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45",
  get primary() {
    return `${this.base} bg-brand text-brand-on`;
  },
  get secondary() {
    return `${this.base} border border-line-control bg-surface text-ink shadow-[inset_0_1px_0_var(--glass-edge)] hover:bg-surface-sunken`;
  },
  get ghost() {
    return `${this.base} text-ink-muted hover:bg-surface-sunken hover:text-ink`;
  },
  get danger() {
    return `${this.base} border border-line-control bg-surface text-danger hover:bg-danger-soft`;
  },
  sm: "h-8 px-3 text-[13px]",
  icon: "w-10 px-0",
};

/** A card that opens something: hairline, soft shadow, lifts on hover. */
export const cardLink =
  "group block rounded-card border border-line bg-surface p-5 shadow-card transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-line-strong hover:shadow-card-hover motion-reduce:transition-none motion-reduce:hover:translate-y-0";

/** A static card. */
export const card = "rounded-card border border-line bg-surface shadow-card";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-balance text-[28px] font-semibold leading-[34px] tracking-[-0.02em]">{title}</h1>
        {subtitle && <p className="mt-1 text-ink-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionHeading({ title, more }: { title: string; more?: { to: string; label: string } }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className="text-xl font-semibold tracking-[-0.01em]">{title}</h2>
      {more && (
        <Link to={more.to} className="inline-flex items-center gap-0.5 text-sm font-medium text-ink-muted hover:text-ink">
          {more.label}
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}

const PILL_TONES = {
  neutral: "border-line bg-surface-sunken text-ink-muted",
  brand: "border-transparent bg-brand-soft text-brand-ink",
  success: "border-transparent bg-success-soft text-success",
  warning: "border-transparent bg-warning-soft text-warning",
  danger: "border-transparent bg-danger-soft text-danger",
} as const;

export function Pill({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof PILL_TONES }) {
  return (
    <span
      className={`inline-flex h-[22px] items-center gap-1 whitespace-nowrap rounded-full border px-2 text-xs font-medium ${PILL_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** "Loading…" / empty-state text. */
export function Muted({ children }: { children: ReactNode }) {
  return <p className="text-ink-muted">{children}</p>;
}
