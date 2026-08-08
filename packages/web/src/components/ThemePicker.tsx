import { useEffect, useRef, useState } from "react";
import { useTheme } from "../lib/theme";
import { ACCENTS } from "../lib/themes";

/** Navbar popover for choosing the accent theme (saved per browser). */
export function ThemePicker() {
  const { accent, setAccent } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Theme color"
        onClick={() => setOpen((o) => !o)}
        className="grid h-9 w-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-white"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <circle cx="8.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
          <circle cx="15.5" cy="10" r="1.1" fill="currentColor" stroke="none" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                setAccent(a.id);
                setOpen(false);
              }}
              aria-label={a.label}
              title={a.label}
              className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-900 ${
                accent === a.id ? "ring-slate-900 dark:ring-white" : "ring-transparent"
              }`}
              style={{ backgroundColor: a.swatch }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
