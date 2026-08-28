/**
 * Pulls the current URL list straight from Adobe's own sitemap instead of
 * relying on a static file -- this is what the original 105-URL list
 * (mechanically generated, only 2 samples ever confirmed live) should
 * have done from the start. 74/105 of those had gone dead by the time
 * this was caught.
 *
 * The sitemap is ~75MB (every Experience League product, every locale --
 * there's no server-side filtering available), but fetches and regex-
 * filters down to this doc section in a few seconds, so it's cheap
 * enough to do on every cron run rather than caching it.
 */
import urlsFallback from "../config/urls_verified.json";

const SITEMAP_URL = "https://experienceleague.adobe.com/en/sitemap.xml";
const PATH_PREFIX =
  "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/";

export async function fetchLiveUrls(): Promise<string[]> {
  try {
    const resp = await fetch(SITEMAP_URL);
    if (!resp.ok) {
      throw new Error(`Sitemap fetch failed: ${resp.status} ${resp.statusText}`);
    }
    const xml = await resp.text();

    const escapedPrefix = PATH_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`<loc>(${escapedPrefix}[^<]*)</loc>`, "g");
    const urls = [...new Set([...xml.matchAll(re)].map((m) => m[1]))].sort();

    const fallback = urlsFallback as string[];
    if (urls.length < fallback.length / 2) {
      // Sanity check: a parsing bug or a malformed/partial sitemap response
      // should not be allowed to silently collapse coverage to near-zero.
      throw new Error(
        `Sitemap returned suspiciously few URLs (${urls.length}, expected ~${fallback.length})`
      );
    }
    return urls;
  } catch (err) {
    console.error("Live sitemap fetch failed, falling back to config/urls_verified.json:", err);
    return urlsFallback as string[];
  }
}
