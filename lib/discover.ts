/**
 * Pulls the current URL list straight from Adobe's own sitemap instead of
 * relying on a static file -- this is what the original 105-URL list
 * (mechanically generated, only 2 samples ever confirmed live) should
 * have done from the start. 74/105 of those had gone dead by the time
 * this was caught.
 *
 * The sitemap is ~75MB (every Experience League product, every locale --
 * there's no server-side filtering available). Fetching and regex-
 * filtering it down to this doc section takes a few seconds -- fine once
 * a day, wasteful to repeat on every /check within the same day, so the
 * result is cached in Redis (see lib/db.ts) with a TTL short enough to
 * still pick up new/removed pages daily.
 */
import { getCachedDiscoveredUrls, setCachedDiscoveredUrls } from "./db";
import urlsFallback from "../config/urls_verified.json";

const SITEMAP_URL = "https://experienceleague.adobe.com/en/sitemap.xml";
const CACHE_TTL_SECONDS = 18 * 60 * 60; // 18h: outlives same-day /check reruns, still expires before the next daily cron

// Sites feature/admin/authoring docs, and the separate developer-facing
// "implementing" tree (component dev, extending AEM, deploying, developer
// tools, etc.) -- two distinct top-level sections in Adobe's docs, not
// nested under each other, so both need their own prefix.
const PATH_PREFIXES = [
  "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/",
  "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/",
];

async function fetchAndParseSitemap(): Promise<string[]> {
  const resp = await fetch(SITEMAP_URL);
  if (!resp.ok) {
    throw new Error(`Sitemap fetch failed: ${resp.status} ${resp.statusText}`);
  }
  const xml = await resp.text();

  const escapedAlternation = PATH_PREFIXES.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|");
  const re = new RegExp(`<loc>(${escapedAlternation})([^<]*)</loc>`, "g");
  const urls = [...new Set([...xml.matchAll(re)].map((m) => m[1] + m[2]))].sort();

  const fallback = urlsFallback as string[];
  if (urls.length < fallback.length / 2) {
    // Sanity check: a parsing bug or a malformed/partial sitemap response
    // should not be allowed to silently collapse coverage to near-zero.
    throw new Error(
      `Sitemap returned suspiciously few URLs (${urls.length}, expected ~${fallback.length})`
    );
  }
  return urls;
}

export async function fetchLiveUrls(): Promise<string[]> {
  try {
    const cached = await getCachedDiscoveredUrls();
    if (cached) return cached;

    const urls = await fetchAndParseSitemap();
    await setCachedDiscoveredUrls(urls, CACHE_TTL_SECONDS);
    return urls;
  } catch (err) {
    console.error("Live sitemap fetch failed, falling back to config/urls_verified.json:", err);
    return urlsFallback as string[];
  }
}
