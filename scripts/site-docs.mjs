// Wraps a Markdown guide, rendered to HTML by `marked`, in the download
// page's look, for wortschritt.yamen.dev/docs/. The Pages workflow runs:
//
//   npx --yes marked@18.0.14 --gfm -i docs/self-hosting.md | node scripts/site-docs.mjs > _site/docs/index.html
//
// Headings get ids (as GitHub makes them, so links like #configuration work in
// both places) and a contents list; links to other docs go to GitHub.
import { readFileSync } from "node:fs";

const REPO = "https://github.com/YamenSharaf/wortschritt/blob/main/docs/";
let body = readFileSync(0, "utf8");

const text = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const slug = (s) =>
  text(s)
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s/g, "-");

const toc = [];
let title = "Wortschritt";
body = body.replace(/<h([1-3])>(.*?)<\/h\1>/g, (_, level, inner) => {
  if (level === "1") {
    title = text(inner);
    return `<h1>${inner}</h1>`;
  }
  const id = slug(inner);
  if (level === "2") toc.push(`<li><a href="#${id}">${inner}</a></li>`);
  return `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true">#</a>${inner}</h${level}>`;
});
// The other guides live in the repository.
body = body.replace(/href="([a-z-]+\.md)(#[^"]*)?"/g, (_, file, hash = "") => `href="${REPO}${file}${hash}"`);
// Each cell knows its column's name, so a table can stack into cards on phones.
body = body.replace(/<table>([\s\S]*?)<\/table>/g, (table) => {
  const heads = [...table.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map((m) => text(m[1]));
  return table.replace(/<tr>([\s\S]*?)<\/tr>/g, (row) => {
    let i = 0;
    return row.replace(/<td([^>]*)>/g, (_, attrs) => `<td${attrs} data-label="${heads[i++] ?? ""}">`);
  });
});
// The title and its intro come before the contents.
const firstH2 = body.indexOf("<h2");
const intro = body.slice(0, firstH2);
const rest = body.slice(firstH2);

process.stdout.write(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<meta name="robots" content="noindex">
<link rel="icon" href="../favicon.svg" type="image/svg+xml">
<link rel="preload" href="../fonts/geist-400.woff2" as="font" type="font/woff2" crossorigin>
<style>
@font-face{font-family:Geist;src:url(../fonts/geist-400.woff2) format("woff2");font-weight:400;font-display:swap}
@font-face{font-family:Geist;src:url(../fonts/geist-500.woff2) format("woff2");font-weight:500;font-display:swap}
@font-face{font-family:Geist;src:url(../fonts/geist-600.woff2) format("woff2");font-weight:600;font-display:swap}
@font-face{font-family:Geist;src:url(../fonts/geist-700.woff2) format("woff2");font-weight:700;font-display:swap}
html{color-scheme:light dark;scroll-behavior:smooth}
:root{--bg:#f6f7fa;--surface:#fff;--sunken:#eef1f6;--border:#e3e7ee;--ink:#0f1420;--muted:#566074;--brand:#2b6cb0;--brand-ink:#1f5a99;--coral:#ff8a65;--green:#127a4b;--blob:.3;--glass-edge:rgba(255,255,255,.85);--glass-fill:rgba(255,255,255,.6);--shadow:0 1px 2px rgba(15,20,32,.06),0 12px 32px rgba(15,20,32,.08)}
@media (prefers-color-scheme:dark){:root{--bg:#0b0d12;--surface:#12151c;--sunken:#0e1117;--border:#ffffff14;--ink:#edf0f5;--muted:#9aa3b2;--brand:#5aa9f5;--brand-ink:#8ec5ff;--green:#3dd68c;--blob:.35;--glass-edge:rgba(255,255,255,.12);--glass-fill:rgba(15,20,32,.55);--shadow:0 1px 2px rgba(0,0,0,.4),0 12px 32px rgba(0,0,0,.45)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 Geist,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.backdrop{position:fixed;inset:0;overflow:hidden;z-index:-1;background:var(--bg)}
.backdrop i{position:absolute;border-radius:50%;opacity:var(--blob);filter:blur(90px)}
header{max-width:820px;margin:0 auto;padding:20px 16px 0}
header a{display:inline-flex;align-items:center;gap:10px;color:var(--ink);text-decoration:none;font-weight:600}
header img{width:32px;height:32px;border-radius:8px}
main{max-width:820px;margin:0 auto;padding:16px}
.card{border-radius:24px;border:1px solid var(--glass-edge);background:var(--glass-fill);backdrop-filter:blur(30px) saturate(1.2);-webkit-backdrop-filter:blur(30px) saturate(1.2);box-shadow:var(--shadow);padding:28px}
h1{margin:0 0 8px;font-size:34px;line-height:1.15;letter-spacing:-.02em}
h2{margin:44px 0 12px;font-size:24px;letter-spacing:-.01em;line-height:1.25}
h3{margin:28px 0 8px;font-size:18px}
h2,h3{position:relative;scroll-margin-top:16px}
.anchor{position:absolute;left:-1em;color:var(--muted);text-decoration:none;opacity:0;font-weight:400}
h2:hover .anchor,h3:hover .anchor{opacity:1}
nav.toc{margin:20px 0 0;padding:16px 20px;border-radius:16px;background:var(--sunken);border:1px solid var(--border)}
nav.toc b{display:block;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
nav.toc ol{margin:0;padding-left:20px;columns:2;column-gap:24px}
nav.toc li{break-inside:avoid}
a{color:var(--brand-ink)}
p,ul,ol{margin:0 0 14px}
li{margin:4px 0}
code{font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--sunken);border:1px solid var(--border);border-radius:6px;padding:1px 5px}
pre{background:var(--sunken);border:1px solid var(--border);border-radius:14px;padding:14px 16px;overflow-x:auto;margin:0 0 16px}
pre code{background:none;border:0;padding:0;font-size:13.5px}
.table{overflow-x:auto;margin:0 0 18px;border:1px solid var(--border);border-radius:14px;background:var(--surface)}
table{border-collapse:collapse;width:100%;font-size:15px}
th,td{text-align:left;vertical-align:top;padding:10px 14px;border-top:1px solid var(--border)}
thead th{border-top:0;background:var(--sunken);font-weight:600;font-size:14px}
td:first-child{white-space:nowrap}
strong{font-weight:600}
footer{max-width:820px;margin:0 auto;padding:8px 16px 40px;color:var(--muted);font-size:14px}
footer a{color:var(--ink);text-decoration:none;font-weight:500;border-bottom:1px solid var(--border)}
@media (max-width:600px){.card{padding:20px;border-radius:20px}h1{font-size:28px}nav.toc ol{columns:1}.anchor{display:none}
.table{border:0;background:none;overflow:visible}table,tbody,tr,td{display:block}thead{display:none}
tr{border:1px solid var(--border);border-radius:14px;background:var(--surface);padding:12px 14px;margin:0 0 10px}
td{border:0;padding:0}td:first-child{white-space:normal;margin-bottom:4px}td:first-child code{font-weight:600}
td+td+td{margin-top:6px;font-size:14px;color:var(--muted)}td+td+td::before{content:attr(data-label) ": ";font-weight:600}}
</style>
</head>
<body>
<div class="backdrop"><i style="width:460px;height:460px;background:var(--brand);top:-160px;left:-200px"></i><i style="width:420px;height:420px;background:var(--coral);top:240px;right:-220px"></i></div>
<header><a href="../"><img src="../icon-192.png" alt="">Wortschritt</a></header>
<main><article class="card">
${intro}<nav class="toc" aria-label="Contents"><b>Contents</b><ol>${toc.join("")}</ol></nav>
${rest.replace(/<table>/g, '<div class="table"><table>').replace(/<\/table>/g, "</table></div>")}
</article></main>
<footer>Made by <a href="https://yamen.dev">Yamen Sharaf</a></footer>
</body>
</html>
`);
