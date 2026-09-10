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
import { getCachedSitemap, setCachedSitemap } from "./db";
import urlsFallback from "../config/urls_verified.json";

const SITEMAP_URL = "https://experienceleague.adobe.com/en/sitemap.xml";

// Sites feature/admin/authoring docs, and the separate developer-facing
// "implementing" tree (component dev, extending AEM, deploying, developer
// tools, etc.) -- two distinct top-level sections in Adobe's docs, not
// nested under each other, so both need their own prefix.
const PATH_PREFIXES = [
  "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/",
  "https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/implementing/",
];

async function parseSitemapStream(
  resp: Response
): Promise<{ urls: string[]; lastModified: string | null }> {
  const lastModified = resp.headers.get("last-modified");
  const escapedAlternation = PATH_PREFIXES.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  ).join("|");
  const re = new RegExp(`<loc>(${escapedAlternation})([^<]*)</loc>`, "g");

  const reader = resp.body?.getReader();
  if (!reader) {
    const xml = await resp.text();
    const urls = [...new Set([...xml.matchAll(re)].map((m) => m[1] + m[2]))].sort();
    return { urls, lastModified };
  }

  const decoder = new TextDecoder();
  const urlSet = new Set<string>();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let match: RegExpExecArray | null;
    let lastIndex = 0;
    while ((match = re.exec(buffer)) !== null) {
      urlSet.add(match[1] + match[2]);
      lastIndex = re.lastIndex;
    }

    buffer = buffer.slice(lastIndex);
    if (buffer.length > 2000) {
      buffer = buffer.slice(-1000);
    }
  }

  buffer += decoder.decode();
  let match: RegExpExecArray | null;
  while ((match = re.exec(buffer)) !== null) {
    urlSet.add(match[1] + match[2]);
  }

  const urls = [...urlSet].sort();
  return { urls, lastModified };
}

export async function fetchLiveUrls(): Promise<string[]> {
  const fallback = urlsFallback as string[];

  try {
    const cached = await getCachedSitemap();

    const headers: Record<string, string> = {
      "User-Agent": "aem-docs-watcher-next/0.1 (sitemap discovery)",
    };
    if (cached?.lastModified) {
      headers["If-Modified-Since"] = cached.lastModified;
    }

    const resp = await fetch(SITEMAP_URL, {
      headers,
      signal: AbortSignal.timeout(15000), // 15s timeout for sitemap
    });

    if (resp.status === 304 && cached && cached.urls.length > 0) {
      // Unchanged: zero body downloaded, immediate return
      return cached.urls;
    }

    if (!resp.ok) {
      if (cached && cached.urls.length > 0) return cached.urls;
      throw new Error(`Sitemap fetch failed: ${resp.status} ${resp.statusText}`);
    }

    const { urls, lastModified } = await parseSitemapStream(resp);

    if (urls.length < fallback.length / 2) {
      throw new Error(
        `Sitemap returned suspiciously few URLs (${urls.length}, expected ~${fallback.length})`
      );
    }

    await setCachedSitemap({ urls, lastModified });
    return urls;
  } catch (err) {
    console.error("Live sitemap fetch failed, falling back to cached or config/urls_verified.json:", err);
    const cached = await getCachedSitemap().catch(() => null);
    if (cached && cached.urls.length > 0) {
      return cached.urls;
    }
    return fallback;
  }
}
