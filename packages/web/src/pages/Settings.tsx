import { useEffect, useState } from "react";
import type { Settings } from "@mdb/shared";
import { api } from "../lib/api";
import { useAsync } from "../lib/useAsync";

export function SettingsPage() {
  const loaded = useAsync(() => api.settings(), []);
  const [form, setForm] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (loaded.status === "ready") setForm(loaded.data);
  }, [loaded.status]);

  // Apply theme immediately for a live preview.
  useEffect(() => {
    if (!form) return;
    const root = document.documentElement;
    const dark =
      form.theme === "dark" ||
      (form.theme === "system" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.classList.toggle("dark", dark);
  }, [form]);

  if (!form) return <p className="text-slate-500">Lädt…</p>;

  async function save() {
    if (!form) return;
    await api.saveSettings(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="max-w-md">
      <h1 className="mb-6 text-2xl font-bold">Einstellungen</h1>
      <div className="space-y-4">
        <Field label="Anzeigename">
          <input
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            className="input"
          />
        </Field>
        <Field label="Niveau (CEFR)">
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
        <Field label="Tagesziel (Aufgaben)">
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
        <Field label="Design">
          <select
            value={form.theme}
            onChange={(e) =>
              setForm({ ...form, theme: e.target.value as Settings["theme"] })
            }
            className="input"
          >
            <option value="system">System</option>
            <option value="light">Hell</option>
            <option value="dark">Dunkel</option>
          </select>
        </Field>
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-slate-900 px-4 py-2 font-medium text-white dark:bg-white dark:text-slate-900"
        >
          Speichern
        </button>
        {saved && <span className="ml-3 text-sm text-green-600">Gespeichert ✓</span>}
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
