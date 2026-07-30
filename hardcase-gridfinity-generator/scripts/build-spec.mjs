// Render the Casefinity spec (../../docs/casefinity-spec.md, at the workspace
// root) to a self-contained, theme-aware HTML page served by the app at
// /casefinity-spec.html. Re-run after editing the spec: `npm run build-spec`.
// The output is committed, so a plain `npm run build` does not need the source.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const specUrl = new URL("../../docs/casefinity-spec.md", import.meta.url);
const outUrl = new URL("../public/casefinity-spec.html", import.meta.url);

let md;
try {
  md = readFileSync(specUrl, "utf8");
} catch {
  console.warn(`build-spec: source not found at ${fileURLToPath(specUrl)} — skipping.`);
  process.exit(0);
}

// GFM (tables, autolinks) is on by default in marked. Wrap tables so wide ones
// scroll inside their own box instead of overflowing the page.
let body = marked.parse(md, { gfm: true });
body = body.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, "</table></div>");

const css = `
  :root { color-scheme: light dark; --fg:#1a1a1a; --muted:#606770; --bg:#ffffff; --panel:#f6f7f9; --border:#e2e5ea; --accent:#2d6cdf; --code:#f0f2f5; }
  @media (prefers-color-scheme: dark) { :root { --fg:#e6e6e6; --muted:#9aa0a6; --bg:#16171a; --panel:#1e2024; --border:#2c2f36; --accent:#6ea8fe; --code:#22252b; } }
  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }
  body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .bar { position:sticky; top:0; z-index:10; display:flex; align-items:center; justify-content:space-between; gap:1rem;
         padding:.65rem 1.1rem; background:var(--panel); border-bottom:1px solid var(--border); backdrop-filter:saturate(1.2) blur(4px); }
  .bar .name { font-weight:600; letter-spacing:.01em; }
  .bar .tag { color:var(--muted); font-size:.82rem; margin-left:.5rem; }
  .bar a { color:var(--accent); text-decoration:none; font-size:.9rem; }
  .bar a:hover { text-decoration:underline; }
  main { max-width:860px; margin:0 auto; padding:1.5rem 1.25rem 5rem; }
  h1,h2,h3,h4 { line-height:1.25; font-weight:650; }
  h1 { font-size:1.9rem; margin:.2em 0 .6em; }
  h2 { font-size:1.35rem; margin:2.2em 0 .5em; padding-bottom:.3em; border-bottom:1px solid var(--border); }
  h3 { font-size:1.1rem; margin:1.6em 0 .4em; }
  h4 { font-size:1rem; margin:1.3em 0 .3em; color:var(--muted); }
  p, li { margin:.5em 0; }
  a { color:var(--accent); }
  strong { font-weight:650; }
  hr { border:0; border-top:1px solid var(--border); margin:2.2em 0; }
  code { font-family:"SF Mono",ui-monospace,Menlo,Consolas,monospace; font-size:.88em; background:var(--code); padding:.12em .38em; border-radius:4px; }
  pre { background:var(--code); border:1px solid var(--border); border-radius:8px; padding:.85em 1em; overflow-x:auto; }
  pre code { background:none; padding:0; font-size:.86em; line-height:1.5; }
  .table-wrap { overflow-x:auto; margin:1em 0; border:1px solid var(--border); border-radius:8px; }
  table { border-collapse:collapse; width:100%; font-size:.92rem; }
  th, td { text-align:left; padding:.5em .7em; border-bottom:1px solid var(--border); vertical-align:top; }
  th { background:var(--panel); font-weight:600; white-space:nowrap; }
  tbody tr:last-child td { border-bottom:0; }
  td code, th code { white-space:nowrap; }
  blockquote { margin:1em 0; padding:.2em 1em; border-left:3px solid var(--border); color:var(--muted); }
`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Proposed Specification v0.1 — Casefinity</title>
<style>${css}</style>
</head>
<body>
<div class="bar">
  <span><span class="name">Casefinity</span><span class="tag">proposed specification v0.1</span></span>
  <a href="/">← Back to generator</a>
</div>
<main>
${body}
</main>
</body>
</html>
`;

writeFileSync(outUrl, html);
console.log(`build-spec: wrote ${fileURLToPath(outUrl)} (${(html.length / 1024).toFixed(1)} kB)`);
