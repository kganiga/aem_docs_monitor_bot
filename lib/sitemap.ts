/**
 * Formats the tracked URL list for /sitemap as a small number of
 * Telegram messages with clickable titles (HTML parse_mode).
 *
 * 355 pages across 16 sections, one as large as 73 pages -- a naive
 * "one message per section" would still be ~20 messages once large
 * sections get split to fit Telegram's length limit. Bin-packs section
 * headers and page links into as few messages as possible instead: small
 * sections share a message, only sections too big to fit alone get split.
 */
const MAX_MESSAGE_LEN = 3500;

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

export function formatSitemapMessages(pages: { url: string; title: string }[]): string[] {
  const bySection = new Map<string, { url: string; title: string }[]>();
  for (const p of [...pages].sort((a, b) => a.title.localeCompare(b.title))) {
    const key = sectionKey(p.url);
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key)!.push(p);
  }

  const messages: string[] = [];
  let current: string[] = [];
  let currentLen = 0;

  function flush() {
    if (current.length > 0) {
      messages.push(current.join("\n"));
      current = [];
      currentLen = 0;
    }
  }

  function pushLine(line: string) {
    const addLen = line.length + 1;
    if (currentLen + addLen > MAX_MESSAGE_LEN) flush();
    current.push(line);
    currentLen += addLen;
  }

  for (const [key, sectionPages] of [...bySection.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (current.length > 0) pushLine("");
    pushLine(`<b>${escapeHtml(sectionLabel(key))}</b> (${sectionPages.length})`);
    for (const p of sectionPages) {
      pushLine(`<a href="${escapeHtml(p.url)}">${escapeHtml(p.title)}</a>`);
    }
  }
  flush();

  return messages.length > 0 ? messages : ["No pages are currently tracked."];
}
