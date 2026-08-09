import { useEffect, useState } from "react";
import { generateCounts, type Settings } from "@mdb/shared";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";
import { useTheme } from "../lib/theme";
import { ACCENTS } from "../lib/themes";
import { ImportPage } from "./Import";

export function SettingsPage() {
  const [tab, setTab] = useState<"preferences" | "import">("preferences");
  const tabBtn = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${
      active
        ? "bg-accent text-accent-foreground"
        : "text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
    }`;
  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold">Settings</h1>
      <div className="mb-6 inline-flex gap-1 rounded-xl border border-slate-200 p-1 dark:border-slate-800">
        <button type="button" className={tabBtn(tab === "preferences")} onClick={() => setTab("preferences")}>
          Preferences
        </button>
        <button type="button" className={tabBtn(tab === "import")} onClick={() => setTab("import")}>
          Import content
        </button>
      </div>
      {tab === "preferences" ? <Preferences /> : <ImportPage />}
    </div>
  );
}

function Preferences() {
  const loaded = useAsync(() => api.settings(), []);
  const { theme, setTheme, accent, setAccent } = useTheme();
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded.status === "ready") setForm(loaded.data);
  }, [loaded.status]);

  if (!form) return <p className="text-slate-500">Loading…</p>;

  async function save() {
    if (!form) return;
    await api.saveSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="max-w-md">
      <div className="space-y-4">
        <Field label="Display name">
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Level (CEFR)">
          <select
            value={form.level}
            onChange={(e) =>
              setForm({ ...form, level: e.target.value as Settings["level"] })
            }
            className="input"
          >
            {["A1", "A2", "B1", "B2", "C1", "C2"].map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </Field>
        <Field label="Daily goal (tasks)">
          <input
            type="number"
            min={1}
            max={500}
            value={form.dailyGoal}
            onChange={(e) =>
              setForm({ ...form, dailyGoal: Number(e.target.value) })
            }
            className="input"
          />
        </Field>
        <Field label="Theme">
          <select
            value={theme}
            onChange={(e) => {
              const next = e.target.value as Settings["theme"];
              setForm({ ...form, theme: next });
              setTheme(next); // live preview + per-device preference
            }}
            className="input"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </Field>
        <Field label="Theme color">
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAccent(a.id)}
                aria-label={a.label}
                title={a.label}
                className={`h-8 w-8 rounded-full ring-2 ring-offset-2 ring-offset-white dark:ring-offset-slate-950 ${
                  accent === a.id
                    ? "ring-slate-900 dark:ring-white"
                    : "ring-transparent"
                }`}
                style={{ backgroundColor: a.swatch }}
              />
            ))}
          </div>
        </Field>
        <Field label="Exercises to generate per batch">
          <select
            value={form.generateCount}
            onChange={(e) =>
              setForm({ ...form, generateCount: Number(e.target.value) })
            }
            className="input"
          >
            {generateCounts.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <p className="-mt-2 text-xs text-slate-400">
          The default count for “Generate more” after finishing an exercise. You
          can still change it there each time.
        </p>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.llmGrading}
            onChange={(e) => setForm({ ...form, llmGrading: e.target.checked })}
            className="h-4 w-4"
          />
          <span className="text-sm font-medium">
            Let the AI tutor grade written answers
          </span>
        </label>
        <p className="-mt-2 text-xs text-slate-400">
          Only used when the tutor is configured. Falls back to exact matching
          otherwise.
        </p>
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground"
        >
          Save
        </button>
        {saved && <span className="ml-3 text-sm text-green-600">Saved ✓</span>}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
    </label>
  );
}
