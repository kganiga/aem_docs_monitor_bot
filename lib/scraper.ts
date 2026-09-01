/**
 * Fetch a doc page, isolate the actual content (not nav/sidebar/footer),
 * return content text + hash + opportunistic meta-last-update.
 *
 * SAME CAVEAT AS THE ORIGINAL PYTHON VERSION, carried over unchanged:
 * CONTENT_SELECTORS below is a best-effort guess based on common
 * Experience League / Edge Delivery Services conventions. It has NOT
 * been verified against live HTML from this build environment (no
 * network path to experienceleague.adobe.com from here, same
 * restriction as before -- switching language didn't remove this gap).
 *
 * Before trusting real notifications: run
 *   node scripts/debug-scrape.mjs <one-url>
 * and read the extracted text. If it's nav/related-articles/cookie
 * junk instead of the article body, inspect the raw HTML yourself and
 * adjust CONTENT_SELECTORS.
 */
import * as cheerio from "cheerio";
import { createHash } from "crypto";

const USER_AGENT = "aem-docs-watcher-next/0.1 (personal use, low-frequency polling)";

const CONTENT_SELECTORS = ["main", "article", "#content", "[class*='content']"];

const STRIP_SELECTORS = [
  "nav",
  "footer",
  "aside",
  "script",
  "style",
  "[class*='related' i]",
  "[class*='recommendation' i]",
  "[class*='feedback' i]",
  "[class*='breadcrumb' i]",
  "[class*='toc' i]",
  "[class*='sidebar' i]",
  "[class*='cookie' i]",
  "[id*='related' i]",
  "[id*='feedback' i]",
];

export interface ScrapeResult {
  text: string;
  title: string;
  hash: string;
  metaLastUpdate: string | null;
}

function deriveTitleFromUrl(url: string): string {
  const slug = url.replace(/\/+$/, "").split("/").pop() ?? url;
  return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function scrapePage(url: string): Promise<ScrapeResult> {
  const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!resp.ok) {
    const bodySnippet = (await resp.text().catch(() => "")).slice(0, 300).replace(/\s+/g, " ").trim();
    throw new Error(
      `Fetch failed: ${resp.status} ${resp.statusText} for ${url} | body: ${bodySnippet || "(empty)"}`
    );
  }
  const html = await resp.text();
  const $ = cheerio.load(html);

  const metaLastUpdate =
    $('meta[name="last-update"]').attr("content") ??
    $('meta[name="meta-last-update"]').attr("content") ??
    null;

  // <title> ("Page Name | Adobe Experience Manager") is clean; h1 is not --
  // Experience League appends a visually-hidden anchor-slug duplicate
  // straight into the h1's text content (e.g. "Managing Content Fragments
  // managing-content-fragments"), confirmed against a live page, so h1
  // is only the fallback.
  const titleTag = $("title").first().text().trim().split("|")[0]?.trim();
  const title = titleTag || $("h1").first().text().trim() || deriveTitleFromUrl(url);

  let container: cheerio.Cheerio<any> | null = null;
  for (const selector of CONTENT_SELECTORS) {
    const found = $(selector).first();
    if (found.length && found.text().trim().length > 200) {
      container = found;
      break;
    }
  }
  if (!container) {
    container = $("body");
  }

  const clone = cheerio.load(container.html() ?? "");
  for (const sel of STRIP_SELECTORS) {
    clone(sel).remove();
  }

  const text = clone("body")
    .text()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");

  const hash = createHash("sha256").update(text, "utf-8").digest("hex");

  return { text, title, hash, metaLastUpdate };
}
