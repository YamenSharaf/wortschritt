import { useEffect, useState, type FormEvent } from "react";
import type { AiSettingsView } from "@mdb/shared";
import { api, ApiError } from "../lib/api";

const smallBtn =
  "rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium hover:border-slate-500 disabled:opacity-50 dark:border-slate-700";

/** Where people usually get an OpenAI-compatible endpoint. */
const EXAMPLES = [
  { label: "OpenAI", url: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { label: "OpenRouter", url: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
];

/** Settings → AI tutor: the signed-in user's own OpenAI-compatible endpoint. */
export function AiSettings() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "remove" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function load(v: AiSettingsView) {
    setView(v);
    setBaseUrl(v.baseUrl);
    setModel(v.model);
    setApiKey("");
  }
  useEffect(() => {
    api.aiSettings().then(load).catch(() => setMessage({ ok: false, text: "Couldn't load." }));
  }, []);

  async function run(kind: "save" | "test" | "remove", fn: () => Promise<string>) {
    setBusy(kind);
    setMessage(null);
    try {
      setMessage({ ok: true, text: await fn() });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
    } finally {
      setBusy(null);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    void run("save", async () => {
      load(
        await api.saveAiSettings({
          baseUrl,
          model,
          // Empty field = keep the saved key.
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        }),
      );
      return "Saved. Use “Test connection” to check it works.";
    });
  }

  if (!view) return <p className="text-slate-500">{message?.text ?? "Loading…"}</p>;

  return (
    <div className="max-w-md space-y-5">
      <p className="text-sm text-slate-500">
        The tutor (explanations, hints, translations, AI grading, generating exercises) uses your
        own AI provider. Any OpenAI-compatible API works. Your key is stored encrypted and is never
        shown again.
      </p>
      {!view.encryptionAvailable && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          This server can't store API keys yet: the admin needs to set <code>ENCRYPTION_KEY</code>.
          Endpoints that need no key still work.
        </p>
      )}
      {view.keyUnreadable && (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          Your saved key can't be read any more (the server's encryption key changed). Enter it again.
        </p>
      )}
      <form onSubmit={save} className="space-y-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium">API base URL</span>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://api.openai.com/v1"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            className="input"
          />
          <span className="mt-1 flex flex-wrap gap-2 text-xs text-slate-400">
            Must be https and publicly reachable. Examples:
            {EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                className="underline hover:text-slate-600 dark:hover:text-slate-200"
                onClick={() => {
                  setBaseUrl(ex.url);
                  if (!model) setModel(ex.model);
                }}
              >
                {ex.label}
              </button>
            ))}
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">Model</span>
          <input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-4o-mini"
            autoCapitalize="none"
            spellCheck={false}
            className="input"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium">API key</span>
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={view.hasKey && !view.keyUnreadable ? "•••••• saved — leave empty to keep" : "sk-…"}
            disabled={!view.encryptionAvailable}
            className="input"
          />
          {view.hasKey && (
            <button
              type="button"
              className="mt-1 text-xs text-slate-400 underline hover:text-slate-600"
              onClick={() =>
                void run("save", async () => {
                  load(await api.saveAiSettings({ baseUrl, model, apiKey: null }));
                  return "Key removed.";
                })
              }
            >
              Remove saved key
            </button>
          )}
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={busy !== null || !baseUrl.trim() || !model.trim()}
            className="rounded-lg bg-accent px-4 py-2 font-medium text-accent-foreground disabled:opacity-50"
          >
            {busy === "save" ? "…" : "Save"}
          </button>
          {view.configured && (
            <button
              type="button"
              disabled={busy !== null}
              className={smallBtn}
              onClick={() =>
                void run("test", async () => {
                  const r = await api.testAi();
                  return `Connected — the model replied “${r.reply}”.`;
                })
              }
            >
              {busy === "test" ? "Testing…" : "Test connection"}
            </button>
          )}
          {(view.configured || view.baseUrl) && (
            <button
              type="button"
              disabled={busy !== null}
              className={`${smallBtn} text-red-600`}
              onClick={() =>
                void run("remove", async () => {
                  load(await api.deleteAiSettings());
                  return "AI tutor turned off.";
                })
              }
            >
              Turn off
            </button>
          )}
        </div>
        {message && (
          <p className={`text-sm ${message.ok ? "text-green-600" : "text-red-600"}`}>{message.text}</p>
        )}
      </form>
    </div>
  );
}
