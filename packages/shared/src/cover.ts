/**
 * Cover art for stories and series: a small, static SVG (minimal black and
 * white, portrait 2:3). Covers are written by models, so they are checked
 * against an allowlist before they're stored — shapes and text only, no
 * scripts, links, external files, styles or embedded images. They're shown
 * as images (which can't run scripts anyway) and rasterised for EPUBs.
 */

export const COVER_MAX_BYTES = 200_000;
/** The canvas covers are drawn on (2:3, like a paperback). */
export const COVER_VIEWBOX = "0 0 600 900";

const ALLOWED_TAGS = new Set(
  [
    "svg",
    "g",
    "defs",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "title",
    "desc",
    "lineargradient",
    "radialgradient",
    "stop",
    "clippath",
    "mask",
    "pattern",
    "use",
    "symbol",
  ],
);

const SAFE_ENTITY = /&(?:amp|lt|gt|quot|apos);/g;

/** Problems with a cover SVG (empty = fine to store). */
export function checkCoverSvg(svg: string): string[] {
  const problems: string[] = [];
  const s = svg.trim();
  if (s.length > COVER_MAX_BYTES) {
    problems.push(`the SVG is larger than ${COVER_MAX_BYTES / 1000} kB`);
  }
  const body = s.replace(/^<\?xml[^>]*\?>\s*/, "");
  if (!/^<svg[\s>]/.test(body) || !/<\/svg>$/.test(body)) {
    problems.push("it must be a single <svg>…</svg> element");
  }
  if (/<\?/.test(body)) problems.push("processing instructions (<?…?>) aren't allowed");
  if (/<!(?!--)/.test(body)) problems.push("<!DOCTYPE>, <!ENTITY> and CDATA aren't allowed");

  const tags = /<([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  const attrs = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
  let root = true;
  for (const m of body.matchAll(tags)) {
    const tag = m[1]!.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      problems.push(`<${m[1]}> isn't allowed (shapes, text and gradients only)`);
      continue;
    }
    if (root) {
      root = false;
      if (!/\sviewBox\s*=/.test(m[2] ?? "")) problems.push(`the <svg> needs a viewBox (use "${COVER_VIEWBOX}")`);
    }
    for (const a of (m[2] ?? "").matchAll(attrs)) {
      const name = a[1]!.toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      if (a[4] !== undefined) problems.push(`attribute ${a[1]} must be quoted`);
      if (name.startsWith("on")) problems.push(`event attributes (${a[1]}) aren't allowed`);
      if (value.replace(SAFE_ENTITY, "").includes("&")) problems.push(`character references in ${a[1]} aren't allowed`);
      if ((name === "href" || name.endsWith(":href")) && !value.startsWith("#")) {
        problems.push(`${a[1]} may only point inside the SVG ("#id")`);
      }
      if (/url\(\s*(?!['"]?#)/i.test(value)) problems.push(`url() in ${a[1]} may only point inside the SVG ("url(#id)")`);
      if (/javascript:|data:|@import|expression\(/i.test(value)) problems.push(`${a[1]} has a disallowed value`);
    }
  }
  return [...new Set(problems)];
}

// --- the generated cover (when a book or chapter has none) ----------------

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A small deterministic PRNG, so a title always gets the same cover. */
function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.codePointAt(0)!, 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

/** Split a title into lines of about `max` characters. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + word).length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** One of a few simple motifs, drawn in the upper half (x 60–540, y 110–470). */
function motif(r: () => number): string {
  const ink = `fill="none" stroke="#111" stroke-width="3"`;
  switch (Math.floor(r() * 4)) {
    case 0: {
      // Sun over a horizon.
      const cx = 200 + r() * 200;
      const rad = 70 + r() * 50;
      return `<circle cx="${cx.toFixed(0)}" cy="290" r="${rad.toFixed(0)}" fill="#111"/>
<line x1="60" y1="${(290 + rad + 30).toFixed(0)}" x2="540" y2="${(290 + rad + 30).toFixed(0)}" stroke="#111" stroke-width="3"/>`;
    }
    case 1: {
      // Lines of different lengths, like a page of text.
      const out: string[] = [];
      for (let i = 0; i < 9; i++) {
        const w = 120 + r() * 360;
        out.push(`<line x1="60" y1="${130 + i * 38}" x2="${(60 + w).toFixed(0)}" y2="${130 + i * 38}" stroke="#111" stroke-width="${i % 3 === 0 ? 8 : 3}" stroke-linecap="round"/>`);
      }
      return out.join("\n");
    }
    case 2: {
      // Hills.
      const a = 150 + r() * 120;
      const b = 330 + r() * 120;
      return `<path d="M60 470 L${a.toFixed(0)} ${(180 + r() * 80).toFixed(0)} L${((a + b) / 2).toFixed(0)} 360 L${b.toFixed(0)} ${(150 + r() * 80).toFixed(0)} L540 470 Z" fill="#111"/>
<circle cx="${(100 + r() * 60).toFixed(0)}" cy="160" r="22" ${ink}/>`;
    }
    default: {
      // A grid of dots with one filled.
      const out: string[] = [];
      const pick = Math.floor(r() * 35);
      for (let i = 0; i < 35; i++) {
        const x = 120 + (i % 7) * 60;
        const y = 140 + Math.floor(i / 7) * 70;
        out.push(i === pick ? `<circle cx="${x}" cy="${y}" r="16" fill="#111"/>` : `<circle cx="${x}" cy="${y}" r="5" fill="#111"/>`);
      }
      return out.join("\n");
    }
  }
}

/** A plain black-and-white cover with the title, for items without art. */
export function fallbackCover(o: { seed: string; title: string; subtitle?: string; label?: string; level?: string }): string {
  const r = rng(o.seed);
  const long = o.title.length > 40;
  const size = long ? 40 : 50;
  const lines = wrap(o.title, long ? 20 : 16).slice(0, 5);
  const top = 560;
  const title = lines
    .map((l, i) => `<text x="300" y="${top + i * size * 1.15}" text-anchor="middle" font-family="serif" font-size="${size}" font-weight="bold" fill="#111">${esc(l)}</text>`)
    .join("\n");
  const after = top + (lines.length - 1) * size * 1.15 + 50;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${COVER_VIEWBOX}" width="600" height="900">
<rect width="600" height="900" fill="#fff"/>
<rect x="24" y="24" width="552" height="852" fill="none" stroke="#111" stroke-width="2"/>
${o.label ? `<text x="300" y="80" text-anchor="middle" font-family="sans-serif" font-size="20" letter-spacing="4" fill="#111">${esc(o.label.toUpperCase())}</text>` : ""}
${motif(r)}
${title}
${o.subtitle ? `<text x="300" y="${after.toFixed(0)}" text-anchor="middle" font-family="serif" font-style="italic" font-size="24" fill="#444">${esc(o.subtitle)}</text>` : ""}
${o.level ? `<text x="300" y="840" text-anchor="middle" font-family="sans-serif" font-size="20" letter-spacing="3" fill="#111">${esc(o.level)}</text>` : ""}
</svg>`;
}
