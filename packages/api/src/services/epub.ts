import { createHash } from "node:crypto";
import { zipSync, strToU8, type Zippable } from "fflate";
import { compiler } from "markdown-to-jsx";
import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { APP_NAME, type Story } from "@mdb/shared";
import { coverFor, coverPng } from "./covers";
import { getSeriesView } from "./series";
import { getStory } from "./stories";

/**
 * EPUB 3 export of a story or a whole series, for reading on an e-reader:
 * the German text (marked as German, so the device's dictionary works), a
 * table of contents, and each chapter's glossary as a word list at its end.
 * No translations or questions — those stay in the app. An EPUB 2 NCX is
 * included for older readers and Kindle's converter.
 *
 * Markdown is rendered with the reader's own library (markdown-to-jsx) via
 * React's static renderer, whose output is well-formed XHTML.
 */

type Chapter = {
  label: string | null;
  title: string;
  body: string;
  glossary: Story["glossary"];
  /** The chapter's own cover art as PNG, shown at its start. */
  image?: Uint8Array;
};
type Book = {
  /** Stable per learner and item, so re-exports update the same book on a device. */
  uid: string;
  title: string;
  subtitle?: string;
  description?: string;
  level: string;
  modified: number;
  /** Cover image (PNG). */
  cover?: Uint8Array;
  chapters: Chapter[];
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** A UUID derived from a name (so the same story always gets the same id). */
function uuidFrom(name: string): string {
  const h = createHash("sha1").update(name).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// Headings without the generated slug ids: two equal headings in a chapter
// would otherwise repeat an id, which isn't valid in an EPUB.
const plainHeading = (tag: string) => ({
  component: ({ children }: { children?: ReactNode }) => createElement(tag, null, children),
});

/** Markdown → XHTML fragment (images dropped: an EPUB can't load remote files). */
function markdownToXhtml(md: string): string {
  return renderToStaticMarkup(
    compiler(md, {
      forceBlock: true,
      wrapper: Fragment,
      overrides: {
        img: { component: () => null },
        ...Object.fromEntries(["h1", "h2", "h3", "h4", "h5", "h6"].map((h) => [h, plainHeading(h)])),
      },
    }),
  );
}

const page = (title: string, body: string, extraHead = "") => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="de" lang="de">
<head>
<meta charset="UTF-8"/>
<title>${esc(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>${extraHead}
</head>
<body>
${body}
</body>
</html>
`;

const en = (text: string, tag = "span", cls = "") =>
  `<${tag}${cls ? ` class="${cls}"` : ""} xml:lang="en" lang="en">${esc(text)}</${tag}>`;

const STYLE = `body { margin: 0 4%; line-height: 1.5; }
h1 { font-size: 1.45em; line-height: 1.25; margin: 1.2em 0 1em; page-break-before: always; break-before: page; }
h2 { font-size: 1.15em; margin: 1.4em 0 0.6em; }
h3 { font-size: 1em; margin: 1.2em 0 0.5em; }
p { margin: 0 0 0.8em; text-indent: 0; orphans: 2; widows: 2; }
blockquote { margin: 0 0 0.8em 1em; font-style: italic; }
.label { display: block; font-size: 0.55em; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7; margin-bottom: 0.3em; }
.glossary { margin-top: 2em; padding-top: 0.6em; border-top: 1px solid #999; font-size: 0.9em; page-break-inside: avoid; }
.glossary h2 { font-size: 1em; margin-top: 0; }
.glossary dt { font-weight: bold; margin-top: 0.3em; }
.glossary dd { margin: 0 0 0 1.2em; }
.title-page { text-align: center; margin-top: 25%; }
.title-page h1 { page-break-before: auto; break-before: auto; font-size: 1.8em; }
.subtitle { font-style: italic; }
.cover { margin: 0; padding: 0; text-align: center; }
.cover img { max-width: 100%; max-height: 100%; }
.chapter-image { text-align: center; margin: 0 0 1.2em; }
.chapter-image img { max-width: 60%; }
.meta { font-size: 0.85em; opacity: 0.75; margin-top: 2em; }
.description { margin-top: 2em; text-align: left; }
nav ol { list-style: none; padding: 0; }
nav li { margin: 0.4em 0; }
`;

export function buildEpub(book: Book): Uint8Array {
  const files = book.chapters.map((_, i) => `chapter-${String(i + 1).padStart(2, "0")}.xhtml`);
  const chapterTitle = (c: Chapter) => (c.label ? `${c.label}: ${c.title}` : c.title);
  const modified = new Date(book.modified * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const titlePage = page(
    book.title,
    `<section class="title-page" epub:type="titlepage">
<h1>${esc(book.title)}</h1>
${book.subtitle ? `<p class="subtitle">${en(book.subtitle)}</p>` : ""}
<p class="meta">Niveau ${esc(book.level)}</p>
${book.description ? `<p class="description">${esc(book.description)}</p>` : ""}
</section>`,
  );

  const nav = page(
    "Inhalt",
    `<nav epub:type="toc" id="toc">
<h1>Inhalt</h1>
<ol>
${book.chapters.map((c, i) => `<li><a href="${files[i]}">${esc(chapterTitle(c))}</a></li>`).join("\n")}
</ol>
</nav>
<nav epub:type="landmarks" hidden="hidden">
<ol>
${book.cover ? `<li><a epub:type="cover" href="cover.xhtml">Cover</a></li>` : ""}
<li><a epub:type="titlepage" href="title.xhtml">Titel</a></li>
<li><a epub:type="toc" href="nav.xhtml">Inhalt</a></li>
<li><a epub:type="bodymatter" href="${files[0]}">${esc(chapterTitle(book.chapters[0]!))}</a></li>
</ol>
</nav>`,
  );

  const images = book.chapters.map((c, i) => (c.image ? `images/chapter-${String(i + 1).padStart(2, "0")}.png` : null));
  const coverPage = page(
    book.title,
    `<section class="cover" epub:type="cover"><img src="cover.png" alt="${esc(book.title)}"/></section>`,
  );

  const chapters = book.chapters.map((c, i) =>
    page(
      chapterTitle(c),
      `<section epub:type="chapter" role="doc-chapter">
<h1>${c.label ? `<span class="label">${esc(c.label)}</span>` : ""}${esc(c.title)}</h1>
${images[i] ? `<div class="chapter-image"><img src="${images[i]}" alt=""/></div>` : ""}
${markdownToXhtml(c.body)}
${
  c.glossary.length
    ? `<section epub:type="glossary" class="glossary">
<h2>Wörter</h2>
<dl>
${c.glossary.map((g) => `<dt>${esc(g.term)}</dt>\n${en(g.meaning, "dd")}`).join("\n")}
</dl>
</section>`
    : ""
}
</section>`,
    ),
  );

  const ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="de">
<head>
<meta name="dtb:uid" content="urn:uuid:${book.uid}"/>
<meta name="dtb:depth" content="1"/>
<meta name="dtb:totalPageCount" content="0"/>
<meta name="dtb:maxPageNumber" content="0"/>
</head>
<docTitle><text>${esc(book.title)}</text></docTitle>
<navMap>
${book.chapters
  .map(
    (c, i) =>
      `<navPoint id="np-${i + 1}" playOrder="${i + 1}"><navLabel><text>${esc(chapterTitle(c))}</text></navLabel><content src="${files[i]}"/></navPoint>`,
  )
  .join("\n")}
</navMap>
</ncx>
`;

  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="de">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:${book.uid}</dc:identifier>
<dc:title>${esc(book.title)}</dc:title>
<dc:language>de</dc:language>
<dc:creator>${esc(APP_NAME)}</dc:creator>
${book.description ? `<dc:description>${esc(book.description)}</dc:description>` : ""}
<meta property="dcterms:modified">${modified}</meta>
${book.cover ? `<meta name="cover" content="cover-image"/>` : ""}
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>
${book.cover ? `<item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>\n<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>` : ""}
${images.map((f, i) => (f ? `<item id="img${i + 1}" href="${f}" media-type="image/png"/>` : "")).filter(Boolean).join("\n")}
${files.map((f, i) => `<item id="ch${i + 1}" href="${f}" media-type="application/xhtml+xml"/>`).join("\n")}
</manifest>
<spine toc="ncx">
${book.cover ? `<itemref idref="cover" linear="yes"/>` : ""}
<itemref idref="title"/>
<itemref idref="nav"/>
${files.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join("\n")}
</spine>
</package>
`;

  const container = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles>
<rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
</rootfiles>
</container>
`;

  const mtime = new Date(book.modified * 1000);
  // The mimetype entry must come first and be stored uncompressed.
  const zip: Zippable = {
    mimetype: [strToU8("application/epub+zip"), { level: 0, mtime }],
    "META-INF/container.xml": [strToU8(container), { mtime }],
    "OEBPS/content.opf": [strToU8(opf), { mtime }],
    "OEBPS/toc.ncx": [strToU8(ncx), { mtime }],
    "OEBPS/nav.xhtml": [strToU8(nav), { mtime }],
    "OEBPS/style.css": [strToU8(STYLE), { mtime }],
    "OEBPS/title.xhtml": [strToU8(titlePage), { mtime }],
  };
  if (book.cover) {
    // PNGs are already compressed.
    zip["OEBPS/cover.png"] = [book.cover, { level: 0, mtime }];
    zip["OEBPS/cover.xhtml"] = [strToU8(coverPage), { mtime }];
  }
  chapters.forEach((xhtml, i) => {
    zip[`OEBPS/${files[i]}`] = [strToU8(xhtml), { mtime }];
    if (images[i]) zip[`OEBPS/${images[i]}`] = [book.chapters[i]!.image!, { level: 0, mtime }];
  });
  return zipSync(zip, { level: 9 });
}

export type EpubFile = { filename: string; data: Uint8Array };

/** The book's cover (drawn or generated) as a PNG, sized for e-readers. */
function bookCover(userId: number, kind: "story" | "series", id: string): Uint8Array | undefined {
  const art = coverFor(userId, kind, id);
  return art ? coverPng(art.svg, 1200) : undefined;
}

/** One story as a book with a single chapter. */
export function storyEpub(userId: number, id: string): EpubFile | null {
  const view = getStory(userId, id);
  if (!view) return null;
  const s = view.story;
  return {
    filename: `${s.id}.epub`,
    data: buildEpub({
      uid: uuidFrom(`wortschritt:${userId}:story:${s.id}`),
      title: s.title,
      subtitle: s.subtitle,
      level: s.level,
      modified: view.updatedAt,
      cover: bookCover(userId, "story", s.id),
      chapters: [{ label: null, title: s.title, body: s.body, glossary: s.glossary }],
    }),
  };
}

/** A series' written chapters, in order (planned ones are left out). */
export function seriesEpub(userId: number, id: string): EpubFile | null | "empty" {
  const view = getSeriesView(userId, id);
  if (!view) return null;
  const chapters: Chapter[] = [];
  let modified = view.updatedAt;
  for (const c of view.chapters) {
    const story = c.storyId ? getStory(userId, c.storyId) : null;
    if (!story) continue;
    modified = Math.max(modified, story.updatedAt);
    const art = coverFor(userId, "story", c.storyId!);
    chapters.push({
      label: `Kapitel ${c.chapter}`,
      title: story.story.title,
      body: story.story.body,
      glossary: story.story.glossary,
      // Only drawn chapter art; generated chapter covers would just repeat the title.
      image: art && !art.generated ? coverPng(art.svg, 800) : undefined,
    });
  }
  if (!chapters.length) return "empty";
  return {
    filename: `${view.id}.epub`,
    data: buildEpub({
      uid: uuidFrom(`wortschritt:${userId}:series:${view.id}`),
      title: view.title,
      subtitle: view.subtitle,
      description: view.description,
      level: view.level,
      modified,
      cover: bookCover(userId, "series", view.id),
      chapters,
    }),
  };
}
