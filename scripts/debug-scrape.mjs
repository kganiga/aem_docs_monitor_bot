// Run once, locally: node scripts/debug-scrape.mjs <url>
// Same purpose as the Python version's `scraper.py debug` mode --
// confirms CONTENT_SELECTORS in lib/scraper.ts is actually picking up
// article text, not nav/sidebar/cookie-banner junk. This still has
// not been verified against real HTML from this build environment.

import * as cheerio from "cheerio";
import { createHash } from "crypto";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/debug-scrape.mjs <url>");
  process.exit(1);
}

const CONTENT_SELECTORS = ["main", "article", "#content", "[class*='content']"];
const STRIP_SELECTORS = [
  "nav", "footer", "aside", "script", "style",
  "[class*='related' i]", "[class*='recommendation' i]", "[class*='feedback' i]",
  "[class*='breadcrumb' i]", "[class*='toc' i]", "[class*='sidebar' i]", "[class*='cookie' i]",
];

const resp = await fetch(url, { headers: { "User-Agent": "aem-docs-watcher-next/0.1 debug" } });
const html = await resp.text();
const $ = cheerio.load(html);

const metaLastUpdate =
  $('meta[name="last-update"]').attr("content") ??
  $('meta[name="meta-last-update"]').attr("content") ??
  null;

let container = null;
for (const selector of CONTENT_SELECTORS) {
  const found = $(selector).first();
  if (found.length && found.text().trim().length > 200) {
    container = found;
    break;
  }
}
if (!container) container = $("body");

const clone = cheerio.load(container.html() ?? "");
for (const sel of STRIP_SELECTORS) clone(sel).remove();

const text = clone("body").text().split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
const hash = createHash("sha256").update(text, "utf-8").digest("hex");

console.log(`--- meta_last_update: ${metaLastUpdate} ---`);
console.log(`--- content hash: ${hash} ---`);
console.log(`--- extracted text (${text.length} chars) ---`);
console.log(text.slice(0, 3000));
console.log("\n--- (truncated if longer) ---");
