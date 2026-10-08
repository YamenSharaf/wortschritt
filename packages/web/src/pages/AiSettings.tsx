import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  MAX_AI_MODELS,
  type AiModelOption,
  type AiProviderView,
  type AiSettingsView,
  type AiTestResult,
} from "@mdb/shared";
import { api, ApiError } from "../lib/api";
import { CrossIcon, PlusIcon } from "../components/icons";
import { btn } from "../components/ui";

const smallBtn = `${btn.secondary} ${btn.sm} `;
const primaryBtn = btn.primary;

const PRESETS = [
  { name: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1" },
  { name: "OpenAI", baseUrl: "https://api.openai.com/v1" },
  { name: "", baseUrl: "" },
];

const errorText = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong.");

/** Settings → Connections → AI tutor: the user's providers and the order models are tried in. */
export function AiSettings() {
  const [view, setView] = useState<AiSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<AiTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    api.aiSettings().then(setView).catch((e) => setError(errorText(e)));
  }, []);

  /** Run a change that returns the new settings; show the server's reason on failure. */
  async function apply(fn: () => Promise<AiSettingsView>): Promise<boolean> {
    setError(null);
    try {
      setView(await fn());
      setTest(null);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    }
  }

  if (!view) return <p className="text-ink-muted">{error ?? "Loading…"}</p>;

  const providerName = (id: number) => view.providers.find((p) => p.id === id)?.name ?? "?";
  const order = view.models.map((m) => ({ providerId: m.providerId, model: m.model }));
  const saveOrder = (next: typeof order) => apply(() => api.saveAiModels(next));

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">
        The tutor uses your own AI provider (any OpenAI-compatible API). Models are tried in
        order: if one fails, the next one answers. Keys are stored encrypted and never shown again.
      </p>
      {!view.encryptionAvailable && (
        <p className="rounded-control bg-warning-soft p-3 text-sm text-warning ">
          This server can't store API keys yet: the admin needs to set <code>ENCRYPTION_KEY</code>.
        </p>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}

      <section className="space-y-3">
        <h3 className="font-semibold">Providers</h3>
        {view.providers.map((p) => (
          <ProviderRow key={p.id} provider={p} view={view} apply={apply} />
        ))}
        <ProviderForm
          view={view}
          onSubmit={(body) => apply(() => api.addAiProvider(body))}
          submitLabel="Add provider"
          collapsedLabel={view.providers.length ? "Add another provider" : "Add a provider"}
        />
      </section>

      <section className="space-y-3">
        <h3 className="font-semibold">Models, in order</h3>
        {view.models.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {view.providers.length ? "Add a model to turn the tutor on." : "Add a provider first."}
          </p>
        ) : (
          <ol className="divide-y divide-[var(--border)] rounded-card border border-line ">
            {view.models.map((m, i) => {
              const result = test?.results.find((r) => r.id === m.id);
              const move = (to: number) => {
                const next = [...order];
                const [item] = next.splice(i, 1);
                next.splice(to, 0, item!);
                void saveOrder(next);
              };
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-2 p-3">
                  <span className="w-5 text-sm text-ink-subtle">{i + 1}.</span>
                  <span className="min-w-0 flex-1 break-all text-sm">
                    <span className="font-medium">{m.model}</span>
                    <span className="text-ink-subtle"> · {providerName(m.providerId)}</span>
                    {result && (
                      <span className={`block text-xs ${result.ok ? "text-success" : "text-danger"}`}>
                        {result.ok ? `Replied in ${(result.ms / 1000).toFixed(1)} s` : result.error}
                      </span>
                    )}
                  </span>
                  <button type="button" className={smallBtn} disabled={i === 0} onClick={() => move(i - 1)} aria-label="Move up">
                    ↑
                  </button>
                  <button
                    type="button"
                    className={smallBtn}
                    disabled={i === view.models.length - 1}
                    onClick={() => move(i + 1)}
                    aria-label="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className={smallBtn}
                    onClick={() => void saveOrder(order.filter((_, j) => j !== i))}
                    aria-label="Remove"
                  >
                    <CrossIcon className="h-4 w-4" />
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {view.providers.length > 0 && view.models.length < MAX_AI_MODELS && (
          <AddModel
            providers={view.providers}
            onAdd={(providerId, model) => saveOrder([...order, { providerId, model }])}
          />
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {view.models.length > 0 && (
          <button
            type="button"
            className={primaryBtn}
            disabled={testing}
            onClick={async () => {
              setTesting(true);
              setError(null);
              try {
                setTest(await api.testAi());
              } catch (e) {
                setError(errorText(e));
              } finally {
                setTesting(false);
              }
            }}
          >
            {testing ? "Testing…" : "Test connection"}
          </button>
        )}
        {(view.providers.length > 0 || view.models.length > 0) && (
          <button
            type="button"
            className="rounded-control border border-line-control px-4 py-2 text-sm text-danger "
            onClick={() => {
              if (window.confirm("Turn the AI tutor off and remove all providers and models?")) {
                void apply(() => api.deleteAiSettings());
              }
            }}
          >
            Turn off
          </button>
        )}
      </div>
    </div>
  );
}

function ProviderRow({
  provider,
  view,
  apply,
}: {
  provider: AiProviderView;
  view: AiSettingsView;
  apply: (fn: () => Promise<AiSettingsView>) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <ProviderForm
        view={view}
        initial={provider}
        submitLabel="Save"
        onSubmit={async (body) => {
          const ok = await apply(() => api.updateAiProvider(provider.id, body));
          if (ok) setEditing(false);
          return ok;
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-card border border-line p-3 text-sm ">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{provider.name}</p>
        <p className="break-all text-xs text-ink-subtle">{provider.baseUrl}</p>
        {provider.keyUnreadable ? (
          <p className="text-xs text-warning">Saved key can't be read any more — enter it again.</p>
        ) : (
          <p className="text-xs text-ink-subtle">{provider.hasKey ? "Key saved" : "No key"}</p>
        )}
      </div>
      <button type="button" className={smallBtn} onClick={() => setEditing(true)}>
        Edit
      </button>
      <button
        type="button"
        className={`${smallBtn} text-danger`}
        onClick={() => {
          if (window.confirm(`Remove ${provider.name} and its models?`)) {
            void apply(() => api.deleteAiProvider(provider.id));
          }
        }}
      >
        Remove
      </button>
    </div>
  );
}

function ProviderForm({
  view,
  initial,
  submitLabel,
  collapsedLabel,
  onSubmit,
  onCancel,
}: {
  view: AiSettingsView;
  initial?: AiProviderView;
  submitLabel: string;
  collapsedLabel?: string;
  onSubmit: (body: { name: string; baseUrl: string; apiKey?: string | null }) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const [open, setOpen] = useState(Boolean(initial));
  const [name, setName] = useState(initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState("");
  const [removeKey, setRemoveKey] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" className={smallBtn} onClick={() => setOpen(true)}>
        <PlusIcon className="h-4 w-4" />
        {collapsedLabel}
      </button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const body = {
      name,
      baseUrl,
      // Empty = keep the saved key (or none, for a new provider).
      ...(apiKey.trim() ? { apiKey: apiKey.trim() } : removeKey ? { apiKey: null } : {}),
    };
    const ok = await onSubmit(body);
    setBusy(false);
    if (ok && !initial) {
      setOpen(false);
      setName("");
      setBaseUrl("");
      setApiKey("");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-card border border-line p-3 ">
      {!initial && (
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.name || "custom"}
              type="button"
              className={smallBtn}
              onClick={() => {
                setName(p.name);
                setBaseUrl(p.baseUrl);
              }}
            >
              {p.name || "Custom"}
            </button>
          ))}
        </div>
      )}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name, e.g. OpenRouter"
        className="input"
      />
      <input
        value={baseUrl}
        onChange={(e) => setBaseUrl(e.target.value)}
        placeholder="https://… (OpenAI-compatible base URL)"
        inputMode="url"
        autoCapitalize="none"
        spellCheck={false}
        className="input"
      />
      <input
        type="password"
        autoComplete="off"
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        placeholder={initial?.hasKey && !initial.keyUnreadable ? "•••••• saved — leave empty to keep" : "API key"}
        disabled={!view.encryptionAvailable}
        className="input"
      />
      {initial?.hasKey && (
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" checked={removeKey} onChange={(e) => setRemoveKey(e.target.checked)} />
          Remove the saved key
        </label>
      )}
      <div className="flex gap-2">
        <button type="submit" className={primaryBtn} disabled={busy || !name.trim() || !baseUrl.trim()}>
          {busy ? "…" : submitLabel}
        </button>
        <button
          type="button"
          className="px-3 text-sm text-ink-muted"
          onClick={() => (onCancel ? onCancel() : setOpen(false))}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

const price = (n: number | null) => (n === null ? "" : n === 0 ? "free" : `$${n}`);

function AddModel({
  providers,
  onAdd,
}: {
  providers: AiProviderView[];
  onAdd: (providerId: number, model: string) => Promise<boolean>;
}) {
  const [providerId, setProviderId] = useState(providers[0]!.id);
  const [model, setModel] = useState("");
  const [options, setOptions] = useState<AiModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // A different provider has a different list.
  useEffect(() => {
    setOptions(null);
    setLoadError(null);
  }, [providerId]);

  const matches = useMemo(() => {
    if (!options) return [];
    const q = model.trim().toLowerCase();
    return options
      .filter((o) => !q || o.id.toLowerCase().includes(q) || o.name?.toLowerCase().includes(q))
      .slice(0, 30);
  }, [options, model]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setOptions(await api.aiProviderModels(providerId));
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function add(id: string) {
    if (await onAdd(providerId, id)) setModel("");
  }

  return (
    <div className="space-y-2 rounded-card border border-dashed border-line-control p-3 ">
      <div className="flex flex-wrap gap-2">
        <select
          value={providerId}
          onChange={(e) => setProviderId(Number(e.target.value))}
          className="input max-w-44"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button type="button" className={smallBtn} disabled={loading} onClick={load}>
          {loading ? "Loading…" : options ? `${options.length} models loaded` : "Load models"}
        </button>
      </div>
      {loadError && <p className="text-xs text-danger">{loadError} You can still type a model name.</p>}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (model.trim()) void add(model.trim());
        }}
      >
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={options ? "Search models…" : "Model name, e.g. openai/gpt-4o-mini"}
          autoCapitalize="none"
          spellCheck={false}
          className="input"
        />
        <button type="submit" className={smallBtn} disabled={!model.trim()}>
          Add
        </button>
      </form>
      {options && matches.length > 0 && (
        <ul className="max-h-64 divide-y divide-[var(--border)] overflow-y-auto rounded-control border border-line text-sm ">
          {matches.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left hover:bg-surface-sunken "
                onClick={() => void add(o.id)}
              >
                <span className="block break-all font-medium">{o.name ?? o.id}</span>
                <span className="block break-all text-xs text-ink-subtle">
                  {o.name ? o.id : ""}
                  {o.promptPrice !== null &&
                    ` · ${price(o.promptPrice)} in / ${price(o.completionPrice)} out per 1M tokens`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
