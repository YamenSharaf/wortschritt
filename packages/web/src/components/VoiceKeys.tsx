import { useState, type ReactNode } from "react";
import { GEMINI_TTS_MODELS, type TtsEntryView, type TtsKeyView } from "@mdb/shared";
import { retryText } from "@mdb/client";
import { ApiError } from "../lib/api";
import { btn } from "./ui";

type Model = (typeof GEMINI_TTS_MODELS)[number];
type Entry = Pick<TtsEntryView, "keyId" | "model" | "background" | "waiting" | "taps">;
type KeyForm = { provider: "gemini" | "azure"; region: string; label: string; kind: "free" | "paid"; key: string };
export type KeyBody = { provider: "gemini" | "azure"; region?: string; label: string; kind: "free" | "paid"; key?: string };
/** Changing keys and the order: each returns the keys and order as they are after it. */
export type KeyOps = {
  add: (b: KeyBody) => Promise<unknown>;
  update: (id: number, b: KeyBody) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
  saveEntries: (list: Entry[]) => Promise<unknown>;
};

/** Rough price of an hour of audio (USD, Google's list price through 2026), for "≈ $0.09 today" on paid keys. */
const HOURLY: Record<Model, number> = { "gemini-3.8-flash-tts": 0.81, "gemini-3.8-flash-lite-tts": 0.54 };
const modelName = (m: string) => (m.includes("lite") ? "Flash-Lite" : "Flash");
const USES = [
  ["background", "Background", "The audiobook queue"],
  ["waiting", "When waiting", "Listen, Try now"],
  ["taps", "Taps", "A word or sentence read aloud"],
] as const;

/** A switch: a real checkbox, drawn as one. */
export function Toggle({ on, label, disabled, onChange }: { on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="relative inline-flex cursor-pointer items-center" title={label}>
      <input type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} className="peer sr-only" />
      <span
        aria-hidden
        className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--focus)] ${
          on ? "justify-end bg-brand" : "justify-start border border-line-control"
        }`}
      >
        <span className={`rounded-full ${on ? "h-4 w-4 bg-bg" : "h-3.5 w-3.5 bg-line-control"}`} />
      </span>
    </label>
  );
}

/**
 * Voice keys and the order Gemini keys are tried in, for the server's keys
 * (Administration) or a learner's own (Settings › Reading aloud). Each
 * Gemini key is a Google project (free, or paid with billing); each entry of
 * the order a key + model with its own daily limit, what it may be used for,
 * and today's count. An Azure key (one, with its region) when `azure`.
 * `after`: what's tried after this order (a learner's: the server's).
 */
export function VoiceKeys({
  keys: allKeys,
  entries,
  ops,
  azure,
  after,
}: {
  keys: TtsKeyView[];
  entries: TtsEntryView[];
  ops: KeyOps;
  azure?: boolean;
  after?: ReactNode;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<KeyForm | null>(null);
  const [editing, setEditing] = useState<(KeyForm & { id: number }) | null>(null);
  const keys = allKeys.filter((k) => k.provider === "gemini");
  const azureKey = allKeys.find((k) => k.provider === "azure");
  const keyOf = (id: number) => keys.find((k) => k.id === id);

  async function run(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (done) setMsg({ ok: true, text: done });
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Something went wrong." });
      return false;
    } finally {
      setBusy(false);
    }
  }
  const save = (list: Entry[]) => run(() => ops.saveEntries(list.map(({ keyId, model, background, waiting, taps }) => ({ keyId, model, background, waiting, taps }))));
  const body = (f: KeyForm): KeyBody => ({ provider: f.provider, label: f.label, kind: f.kind, ...(f.provider === "azure" ? { region: f.region } : {}), ...(f.key ? { key: f.key } : {}) });
  const newKey = (provider: "gemini" | "azure"): KeyForm =>
    provider === "azure"
      ? { provider, region: "", label: "Azure", kind: "free", key: "" }
      : { provider, region: "", label: keys.length ? "Paid" : "Free", kind: keys.length ? "paid" : "free", key: "" };
  const move = (i: number, to: number) => {
    const list = [...entries];
    const [it] = list.splice(i, 1);
    list.splice(to, 0, it!);
    void save(list);
  };
  const missing = keys.flatMap((k) => GEMINI_TTS_MODELS.filter((m) => !entries.some((e) => e.keyId === k.id && e.model === m)).map((m) => ({ key: k, model: m })));

  const status = (e: TtsEntryView) => {
    if (e.limitedUntil) return { text: "Used up", detail: `${e.usedToday} of ${e.dailyLimit} · back ${retryText(e.limitedUntil)}`, warn: true };
    const paid = keyOf(e.keyId)?.kind === "paid";
    const cost = paid && e.secondsToday > 0 ? ` · ≈ $${((e.secondsToday / 3600) * HOURLY[e.model]).toFixed(2)}` : "";
    return { text: `${e.usedToday} of ${e.dailyLimit}`, detail: `today${cost}`, warn: false };
  };

  return (
    <div className="space-y-6">
      {/* Keys */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-medium">{azure ? "Keys" : "Gemini keys"}</h3>
          {!adding && (
            <div className="flex gap-2">
              <button type="button" className={`${btn.secondary} ${btn.sm}`} onClick={() => setAdding(newKey("gemini"))}>
                Add Gemini key
              </button>
              {azure && (
                <button type="button" className={`${btn.secondary} ${btn.sm}`} onClick={() => setAdding(newKey("azure"))}>
                  {azureKey ? "Replace Azure key" : "Add Azure key"}
                </button>
              )}
            </div>
          )}
        </div>
        <p className="text-xs text-ink-muted">
          Each key is a Google AI Studio project. Its limits are its own, per model: on the free tier 10 requests a day (each about a minute or two of audio), with billing (Tier 1) 100. A
          project without billing is free; on it Google may use what's read to improve its products. With billing, each request costs
          (about $0.81 an hour of audio with Flash, $0.54 with Flash-Lite).
          {azure && " An Azure Speech key (its free tier has 0.5 million characters a month) gives Azure's voices, Seraphina, Florian and the HD ones."}
        </p>
        <ul className="divide-y divide-[var(--border)] overflow-hidden rounded-card border border-line bg-surface">
          {[...keys, ...(azureKey ? [azureKey] : [])].map((k: TtsKeyView) =>
            editing?.id === k.id ? (
              <li key={k.id} className="p-3">
                <KeyFields
                  value={editing}
                  submit="Save"
                  busy={busy}
                  keyOptional
                  onChange={(v) => setEditing({ ...editing, ...v })}
                  onCancel={() => setEditing(null)}
                  onSubmit={async () => {
                    if (await run(() => ops.update(k.id, body(editing)), "Saved.")) setEditing(null);
                  }}
                />
              </li>
            ) : (
              <li key={k.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{k.label}</div>
                  <div className="text-xs text-ink-muted">
                    {k.provider === "azure" ? `Azure Speech · ${k.region}` : `Gemini · ${k.kind === "free" ? "no billing" : "billing"}`} · ····{k.hint}
                    {k.unreadable && <span className="text-danger"> · can't be read any more: enter it again</span>}
                  </div>
                </div>
                <span className={`inline-flex h-[22px] items-center rounded-full px-2 text-xs font-medium ${k.kind === "free" ? "bg-success-soft text-success" : "bg-brand-soft text-brand-ink"}`}>
                  {k.kind === "free" ? "Free" : "Paid"}
                </span>
                <button type="button" className={`${btn.ghost} ${btn.sm}`} onClick={() => setEditing({ id: k.id, provider: k.provider, region: k.region ?? "", label: k.label, kind: k.kind, key: "" })}>
                  Edit
                </button>
                <button
                  type="button"
                  className={`${btn.ghost} ${btn.sm}`}
                  disabled={busy}
                  onClick={() => window.confirm(`Remove the key “${k.label}” and its place in the order?`) && void run(() => ops.remove(k.id), "Removed.")}
                >
                  Remove
                </button>
              </li>
            ),
          )}
          {adding && (
            <li className="p-3">
              <KeyFields
                value={adding}
                submit="Add"
                busy={busy}
                onChange={(v) => setAdding({ ...adding, ...v })}
                onCancel={() => setAdding(null)}
                onSubmit={async () => {
                  const done = adding.provider === "azure" ? "Added: Azure's voices are now yours to choose." : "Added: it joins the end of the order with both models.";
                  if (await run(() => ops.add(body(adding)), done)) setAdding(null);
                }}
              />
            </li>
          )}
          {!allKeys.length && !adding && <li className="px-4 py-3 text-sm text-ink-muted">No key yet.</li>}
        </ul>
      </div>

      {/* Order */}
      {(entries.length > 0 || after) && (
        <div className="space-y-2">
          <h3 className="font-medium">Order for Gemini voices</h3>
          <p className="text-xs text-ink-muted">
            Tried top to bottom. One at its limit is passed over until Google resets it (midnight Pacific). The counts are this server's own:
            Google doesn't say what's left.
          </p>
          <ol className="divide-y divide-[var(--border)] overflow-hidden rounded-card border border-line bg-surface">
            {entries.map((e, i) => {
              const k = keyOf(e.keyId);
              const st = status(e);
              const set = (patch: Partial<Entry>) => void save(entries.map((x, j) => (j === i ? { ...x, ...patch } : x)));
              return (
                <li key={e.id} className="flex gap-3 px-3 py-3">
                  <div className="flex flex-col">
                    <button type="button" className="h-6 w-7 rounded text-ink-muted hover:bg-surface-sunken disabled:opacity-30" disabled={busy || i === 0} onClick={() => move(i, i - 1)} aria-label={`Move ${k?.label} · ${modelName(e.model)} up`}>
                      ↑
                    </button>
                    <button type="button" className="h-6 w-7 rounded text-ink-muted hover:bg-surface-sunken disabled:opacity-30" disabled={busy || i === entries.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move ${k?.label} · ${modelName(e.model)} down`}>
                      ↓
                    </button>
                  </div>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-baseline gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          <span className="mr-2 font-mono text-xs text-ink-subtle">{i + 1}</span>
                          {k?.label ?? "?"} · {modelName(e.model)}
                        </div>
                        <div className="truncate text-xs text-ink-muted">
                          {e.model}
                          {k?.kind === "paid" ? " · costs money" : ""}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className={`text-sm font-medium ${st.warn ? "text-warning" : ""}`}>{st.text}</div>
                        <div className="text-xs text-ink-subtle">{st.detail}</div>
                      </div>
                    </div>
                    <div className="h-1 overflow-hidden rounded-full bg-surface-sunken">
                      <div className={`h-full ${st.warn ? "bg-warning" : "bg-brand"}`} style={{ width: `${Math.min(100, (e.usedToday / e.dailyLimit) * 100)}%` }} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                      {USES.map(([use, label, hint]) => (
                        <span key={use} className="inline-flex items-center gap-2 text-xs text-ink-muted" title={hint}>
                          <Toggle on={e[use]} label={`${label}: ${k?.label} · ${modelName(e.model)}`} disabled={busy} onChange={(on) => set({ [use]: on })} />
                          {label}
                        </span>
                      ))}
                      <button type="button" className="ml-auto text-xs text-ink-subtle hover:text-danger" disabled={busy} onClick={() => void save(entries.filter((_, j) => j !== i))}>
                        Take out
                      </button>
                    </div>
                  </div>
                </li>
              );
            })}
            {after}
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            {missing.length > 0 && (
              <select
                className="input w-auto"
                value=""
                disabled={busy}
                onChange={(ev) => {
                  const m = missing[Number(ev.target.value)];
                  if (m) void save([...entries, { keyId: m.key.id, model: m.model, background: m.key.kind === "free", waiting: true, taps: true }]);
                }}
                aria-label="Add to the order"
              >
                <option value="">Add to the order…</option>
                {missing.map((m, i) => (
                  <option key={`${m.key.id}:${m.model}`} value={i}>
                    {m.key.label} · {modelName(m.model)}
                  </option>
                ))}
              </select>
            )}
            <span className="text-xs text-ink-subtle">Background: the audiobook queue · When waiting: Listen, Try now · Taps: a word or sentence read aloud</span>
          </div>
        </div>
      )}

      {msg && <p className={`text-sm ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</p>}
    </div>
  );
}

function KeyFields({
  value,
  submit,
  busy,
  keyOptional,
  onChange,
  onCancel,
  onSubmit,
}: {
  value: KeyForm;
  submit: string;
  busy: boolean;
  keyOptional?: boolean;
  onChange: (v: Partial<KeyForm>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <input value={value.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Name, e.g. Free" aria-label="Name" className="input w-32" maxLength={40} required />
      {value.provider === "azure" && (
        <input
          value={value.region}
          onChange={(e) => onChange({ region: e.target.value.trim() })}
          placeholder="Region, e.g. swedencentral"
          aria-label="Azure region"
          className="input w-48"
          pattern="[a-z0-9]{2,30}"
          required
        />
      )}
      <select value={value.kind} onChange={(e) => onChange({ kind: e.target.value as "free" | "paid" })} aria-label="Kind" className="input w-auto">
        <option value="free">Free (no billing)</option>
        <option value="paid">Paid (billing)</option>
      </select>
      <input
        value={value.key}
        onChange={(e) => onChange({ key: e.target.value })}
        placeholder={`${value.provider === "azure" ? "Azure Speech key" : "Gemini API key"}${keyOptional ? " (leave empty to keep)" : ""}`}
        aria-label="API key"
        type="password"
        autoComplete="off"
        required={!keyOptional}
        className="input min-w-0 flex-1"
      />
      <button type="submit" disabled={busy} className={`${btn.primary} ${btn.sm}`}>
        {submit}
      </button>
      <button type="button" onClick={onCancel} className={`${btn.ghost} ${btn.sm}`}>
        Cancel
      </button>
    </form>
  );
}
