/**
 * Builds the /sitemap HTML document -- all tracked pages, grouped by
 * section, titles as real links. Sent as a single file (lib/notify.ts
 * sendDocumentToRequester) rather than the ~19 Telegram messages a
 * chat-message version of this would take at 355 pages: one API call
 * instead of nineteen, no chat clutter, opens in a browser where a long
 * reference list is easier to read/search than scrolling chat anyway.
 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sectionKey(url: string): string {
  const m = url.match(/\/content\/([^/]+)\/([^/]+)/);
  return m ? `${m[1]}/${m[2]}` : "other";
}

function sectionLabel(key: string): string {
  const cap = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const [top, sub] = key.split("/");
  return sub ? `${cap(top)}: ${cap(sub)}` : cap(top);
}

export function formatSitemapHtml(pages: { url: string; title: string }[]): string {
  const bySection = new Map<string, { url: string; title: string }[]>();
  for (const p of [...pages].sort((a, b) => a.title.localeCompare(b.title))) {
    const key = sectionKey(p.url);
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(p);
  }

  const sections = [...bySection.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const body = sections
    .map(([key, sectionPages]) => {
      const items = sectionPages
        .map((p) => `<li><a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a></li>`)
        .join("\n");
      return `<h2>${escapeHtml(sectionLabel(key))} (${sectionPages.length})</h2>\n<ul>\n${items}\n</ul>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>AEM Docs Sitemap</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem}
h1{font-size:1.4rem}h2{font-size:1.1rem;margin-top:2rem}li{margin:.25rem 0}</style>
</head>
<body>
<h1>Tracked Pages (${pages.length})</h1>
${body || "<p>No pages are currently tracked.</p>"}
</body>
</html>`;
}
