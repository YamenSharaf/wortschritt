/**
 * Cover art for stories and series: a static SVG illustration (portrait
 * 2:3). Covers are written by models, so they are checked against an
 * allowlist before they're stored — shapes, text, gradients and filters
 * only; no scripts, links, external files, styles or embedded images.
 * They're shown as images (which can't run scripts anyway) and rasterised
 * for EPUBs.
 */

export const COVER_MAX_BYTES = 300_000;
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
    // Filters (paper grain, ink wobble, watercolour edges, shadows) — but
    // not feImage, which can load files.
    "filter",
    "feturbulence",
    "fedisplacementmap",
    "fegaussianblur",
    "fecolormatrix",
    "fecomposite",
    "feblend",
    "feoffset",
    "feflood",
    "femerge",
    "femergenode",
    "femorphology",
    "fecomponenttransfer",
    "fefuncr",
    "fefuncg",
    "fefuncb",
    "fefunca",
    "fedropshadow",
    "fediffuselighting",
    "fespecularlighting",
    "fedistantlight",
    "fepointlight",
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
      problems.push(`<${m[1]}> isn't allowed (shapes, text, gradients and filters only)`);
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

const INK = "#1d1a17";
const PAPER = "#f4ead5";
/** Background and highlight colours for generated covers. */
const PALETTES: Array<[string, string]> = [
  ["#3d7d84", "#f2c14e"],
  ["#b5473a", "#f4d58d"],
  ["#4f7a4a", "#f1b77e"],
  ["#2f4a6d", "#f4a259"],
  ["#6d4c6f", "#f2d0a4"],
  ["#c98a2e", "#2f4a6d"],
];

const FILTERS = `<filter id="wash" x="-5%" y="-5%" width="110%" height="110%">
<feTurbulence type="fractalNoise" baseFrequency="0.02" numOctaves="3" seed="8" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="8" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="ink" x="-5%" y="-5%" width="110%" height="110%">
<feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="3" result="n"/>
<feDisplacementMap in="SourceGraphic" in2="n" scale="3" xChannelSelector="R" yChannelSelector="G"/>
</filter>
<filter id="grain" x="0" y="0" width="100%" height="100%">
<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="5" result="g"/>
<feColorMatrix in="g" type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.28  0 0 0 0 0.2  0 0 0 0.14 0"/>
</filter>`;

/** A simple ink-and-wash scene in the picture panel (x 0–600, y 0–540). */
function motif(r: () => number, hi: string): string {
  const line = `stroke="${INK}" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round"`;
  switch (Math.floor(r() * 4)) {
    case 0: {
      // Sun over rolling hills.
      const cx = 160 + r() * 280;
      return `<circle cx="${cx.toFixed(0)}" cy="230" r="78" fill="${hi}" ${line}/>
<path d="M-20 420 Q150 330 300 400 T620 380 L620 560 L-20 560 Z" fill="${PAPER}" fill-opacity="0.35" ${line}/>
<path d="M-20 470 Q200 400 360 460 T620 450 L620 560 L-20 560 Z" fill="${PAPER}" fill-opacity="0.6" ${line}/>`;
    }
    case 1: {
      // A row of houses under the moon.
      const out = [`<circle cx="${(120 + r() * 360).toFixed(0)}" cy="150" r="46" fill="${hi}" ${line}/>`];
      let x = 30;
      while (x < 560) {
        const w = 70 + r() * 50;
        const h = 150 + r() * 130;
        out.push(`<path d="M${x.toFixed(0)} 540 V${(540 - h).toFixed(0)} L${(x + w / 2).toFixed(0)} ${(500 - h).toFixed(0)} L${(x + w).toFixed(0)} ${(540 - h).toFixed(0)} V540" fill="${PAPER}" fill-opacity="0.55" ${line}/>`);
        for (let y = 560 - h; y < 500; y += 50) {
          out.push(`<rect x="${(x + w / 2 - 12).toFixed(0)}" y="${y.toFixed(0)}" width="24" height="26" fill="${r() < 0.4 ? hi : INK}" stroke="${INK}" stroke-width="3"/>`);
        }
        x += w + 8;
      }
      return out.join("\n");
    }
    case 2: {
      // A boat on waves.
      const bx = 180 + r() * 160;
      return `<circle cx="${(bx + 160).toFixed(0)}" cy="170" r="50" fill="${hi}" ${line}/>
<path d="M${bx.toFixed(0)} 360 h150 l-25 45 h-100 Z" fill="${hi}" ${line}/>
<path d="M${(bx + 70).toFixed(0)} 360 V230 L${(bx + 140).toFixed(0)} 340 Z" fill="${PAPER}" ${line}/>
<path d="M-20 420 q40 -22 80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 t80 0 L640 560 L-20 560 Z" fill="${PAPER}" fill-opacity="0.45" ${line}/>
<path d="M-20 480 q50 -22 100 0 t100 0 t100 0 t100 0 t100 0 t100 0 t100 0 L640 560 L-20 560 Z" fill="${PAPER}" fill-opacity="0.7" ${line}/>`;
    }
    default: {
      // Pine trees under a moon.
      const out = [`<circle cx="${(400 + r() * 100).toFixed(0)}" cy="150" r="52" fill="${hi}" ${line}/>`];
      for (let i = 0; i < 5; i++) {
        const x = 40 + i * 120 + r() * 40;
        const h = 220 + r() * 120;
        out.push(`<path d="M${x.toFixed(0)} ${(540 - h).toFixed(0)} L${(x + 55).toFixed(0)} 520 H${(x - 55).toFixed(0)} Z" fill="${PAPER}" fill-opacity="${(0.35 + i * 0.1).toFixed(2)}" ${line}/>`);
      }
      out.push(`<path d="M-20 520 H620 V560 H-20 Z" fill="${PAPER}" fill-opacity="0.7" ${line}/>`);
      return out.join("\n");
    }
  }
}

/** An illustrated cover with the title, for items without their own art. */
export function fallbackCover(o: { seed: string; title: string; subtitle?: string; label?: string; level?: string }): string {
  const r = rng(o.seed);
  const [bg, hi] = PALETTES[Math.floor(r() * PALETTES.length)]!;
  const long = o.title.length > 34;
  const size = long ? 40 : 50;
  const lines = wrap(o.title, long ? 20 : 15).slice(0, 4);
  const top = 560 + (o.label ? 76 : 64) + (4 - lines.length) * 10;
  const title = lines
    .map((l, i) => `<text x="300" y="${(top + i * size * 1.12).toFixed(0)}" text-anchor="middle" font-family="serif" font-size="${size}" font-weight="bold" fill="${INK}">${esc(l)}</text>`)
    .join("\n");
  const after = top + (lines.length - 1) * size * 1.12 + 44;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${COVER_VIEWBOX}" width="600" height="900" data-spine="${bg}">
<defs>${FILTERS}</defs>
<rect width="600" height="900" fill="${PAPER}"/>
<rect x="-30" y="-30" width="660" height="590" fill="${bg}" filter="url(#wash)"/>
<g filter="url(#ink)">
${motif(r, hi)}
</g>
<path d="M0 556 H600" stroke="${INK}" stroke-width="5" filter="url(#ink)"/>
${o.label ? `<text x="300" y="604" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="bold" letter-spacing="4" fill="${bg}">${esc(o.label.toUpperCase())}</text>` : ""}
${title}
${o.subtitle && after < 830 ? `<text x="300" y="${after.toFixed(0)}" text-anchor="middle" font-family="serif" font-style="italic" font-size="24" fill="#5b5248">${esc(o.subtitle.length > 44 ? `${o.subtitle.slice(0, 42)}…` : o.subtitle)}</text>` : ""}
${o.level ? `<circle cx="530" cy="842" r="28" fill="${bg}" stroke="${INK}" stroke-width="3.5" filter="url(#ink)"/>
<text x="530" y="851" text-anchor="middle" font-family="sans-serif" font-size="24" font-weight="bold" fill="${PAPER}">${esc(o.level)}</text>` : ""}
<rect width="600" height="900" filter="url(#grain)"/>
</svg>`;
}

/**
 * The cover's main colour (for a book's spine on the shelf): its
 * data-spine attribute, else the most used saturated fill or stop colour,
 * else a neutral.
 */
export function coverColor(svg: string): string {
  // The artist may name it: <svg data-spine="#3f8f4a" …>.
  const named = svg.match(/<svg\b[^>]*\sdata-spine\s*=\s*["'](#[0-9a-fA-F]{6})["']/);
  if (named) return named[1]!.toLowerCase();
  const counts = new Map<string, number>();
  for (const m of svg.matchAll(/(?:fill|stop-color)\s*=\s*["']#([0-9a-f]{6}|[0-9a-f]{3})["']/gi)) {
    let hex = m[1]!.toLowerCase();
    if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
    const [rr, gg, bb] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    const light = (max + min) / 2;
    const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * light - 1));
    if (sat < 0.25 || light < 0.15 || light > 0.85) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  const best = [...counts].sort((a, b) => b[1] - a[1])[0];
  return best ? `#${best[0]}` : "#5b5248";
}
