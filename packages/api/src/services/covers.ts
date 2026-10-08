import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { Resvg } from "@resvg/resvg-js";
import { fallbackCover } from "@mdb/shared";
import { db, schema } from "../db/client";

/**
 * Cover art for stories (chapters) and series: a checked SVG stored next to
 * the content (re-saving a text keeps its cover). Items without one get a
 * generated cover from their title.
 */

export type CoverKind = "story" | "series";

/** Changes whenever the cover does (for cache-busting image URLs). */
export const coverVersion = (svg: string | null | undefined) =>
  svg ? createHash("sha1").update(svg).digest("hex").slice(0, 12) : null;

const table = (kind: CoverKind) => (kind === "story" ? schema.stories : schema.series);

export function getStoredCover(userId: number, kind: CoverKind, id: string): string | null | undefined {
  const t = table(kind);
  const row = db.select({ cover: t.cover }).from(t).where(and(eq(t.userId, userId), eq(t.id, id))).get();
  return row ? row.cover : undefined;
}

/** Set (or with null, remove) a cover. False when there's no such item. */
export function setCover(userId: number, kind: CoverKind, id: string, svg: string | null): boolean {
  const t = table(kind);
  return db.update(t).set({ cover: svg }).where(and(eq(t.userId, userId), eq(t.id, id))).run().changes > 0;
}

/** The cover to show: the stored art, or one generated from the title. */
export function coverFor(
  userId: number,
  kind: CoverKind,
  id: string,
): { svg: string; generated: boolean } | null {
  if (kind === "story") {
    const row = db
      .select({ data: schema.stories.data, cover: schema.stories.cover, chapter: schema.stories.chapter })
      .from(schema.stories)
      .where(and(eq(schema.stories.userId, userId), eq(schema.stories.id, id)))
      .get();
    if (!row) return null;
    if (row.cover) return { svg: row.cover, generated: false };
    return {
      svg: fallbackCover({
        seed: id,
        title: row.data.title,
        subtitle: row.data.subtitle,
        level: row.data.level,
        label: row.chapter ? `Kapitel ${row.chapter}` : undefined,
      }),
      generated: true,
    };
  }
  const row = db
    .select({ data: schema.series.data, cover: schema.series.cover })
    .from(schema.series)
    .where(and(eq(schema.series.userId, userId), eq(schema.series.id, id)))
    .get();
  if (!row) return null;
  if (row.cover) return { svg: row.cover, generated: false };
  return {
    svg: fallbackCover({ seed: id, title: row.data.title, subtitle: row.data.subtitle, level: row.data.level }),
    generated: true,
  };
}

const GENERIC: Record<string, string> = {
  serif: "DejaVu Serif",
  "sans-serif": "DejaVu Sans",
  monospace: "DejaVu Sans Mono",
};

/** resvg doesn't resolve generic families, so name the installed fonts. */
function concreteFonts(svg: string): string {
  return svg.replace(/(font-family\s*=\s*)(["'])(.*?)\2/g, (_m, pre: string, q: string, list: string) => {
    const families = list.split(",").map((f) => f.trim().replace(/^["']|["']$/g, ""));
    const mapped = families.map((f) => GENERIC[f.toLowerCase()] ?? f);
    return `${pre}${q}${mapped.map((f) => (q === '"' ? `'${f}'` : `"${f}"`)).join(", ")}${q}`;
  });
}

/**
 * A cover as PNG (for EPUBs: e-readers, Kindle especially, want a raster
 * cover). Covers may only use the generic font families; those map to the
 * DejaVu fonts installed in the image.
 */
export function coverPng(svg: string, width: number): Uint8Array {
  const r = new Resvg(concreteFonts(svg), {
    fitTo: { mode: "width", value: width },
    background: "#ffffff",
    font: {
      loadSystemFonts: true,
      defaultFontFamily: "DejaVu Serif",
      serifFamily: "DejaVu Serif",
      sansSerifFamily: "DejaVu Sans",
      monospaceFamily: "DejaVu Sans Mono",
    },
    logLevel: "off",
  });
  return r.render().asPng();
}
