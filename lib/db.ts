/**
 * State storage via Upstash Redis.
 *
 * IMPORTANT, and worth being upfront about: this is a hosted third-party
 * service, not self-hosted infrastructure. Serverless functions have no
 * persistent local disk (same reason GitHub Actions and Netlify Functions
 * were ruled out earlier) -- going serverless means SOME external service
 * has to hold state between runs. Upstash's client library is open source
 * (MIT), but the Redis instance itself runs on Upstash's servers, not
 * yours. Free tier as of now: 10,000 commands/day, 256MB storage -- this
 * project uses roughly 2 Redis calls per page per run. The page list is
 * now pulled live from Adobe's sitemap each run (see lib/discover.ts)
 * rather than fixed at 105, but even a few hundred pages stays nowhere
 * close to the limit. Flagging this trade-off explicitly
 * rather than letting it slide past unnoticed: this is the real cost of
 * avoiding a VM.
 */
import { Redis } from "@upstash/redis";
import type { ScanSummary } from "./scan";

const redis = Redis.fromEnv();

export interface PageState {
  contentHash: string;
  contentSnapshot: string;
  title: string;
  metaLastUpdate: string | null;
  lastCheckedAt: string;
  lastModifiedHeader?: string | null;
}

function keyFor(url: string): string {
  return `page:${url}`;
}

export async function getPageState(url: string): Promise<PageState | null> {
  const data = await redis.get<PageState>(keyFor(url));
  return data ?? null;
}

export async function getPageStateBatch(urls: string[]): Promise<(PageState | null)[]> {
  if (urls.length === 0) return [];
  const keys = urls.map(keyFor);
  const states = await redis.mget<(PageState | null)[]>(...keys);
  return states.map((s) => s ?? null);
}

export async function setPageState(url: string, state: PageState): Promise<void> {
  await redis.set(keyFor(url), state);
}

export async function updatePageLastModified(url: string, lastModifiedHeader: string): Promise<void> {
  const current = await getPageState(url);
  if (current && current.lastModifiedHeader !== lastModifiedHeader) {
    current.lastModifiedHeader = lastModifiedHeader;
    await setPageState(url, current);
  }
}

export async function deletePageState(url: string): Promise<void> {
  await redis.del(keyFor(url));
}

// Used to detect pages that dropped out of the live sitemap (see
// lib/scan.ts): the set of URLs with stored state IS the set of
// currently-tracked pages, so no separate "known urls" key needs to be
// maintained in sync -- it's derived from the same data every time.
export async function listTrackedUrls(): Promise<string[]> {
  const keys = await redis.keys("page:*");
  return keys.map((k) => k.slice("page:".length));
}

// One batched MGET instead of 355 individual GETs for /sitemap.
export async function listAllPageInfo(): Promise<{ url: string; title: string }[]> {
  const keys = await redis.keys("page:*");
  if (keys.length === 0) return [];
  const states = await redis.mget<(PageState | null)[]>(...keys);
  return keys.map((k, i) => ({
    url: k.slice("page:".length),
    title: states[i]?.title ?? k.slice("page:".length),
  }));
}

const DISCOVERED_URLS_KEY = "discovered-urls-cache";
const SITEMAP_CACHE_KEY = "sitemap-cache-v2";

export interface SitemapCache {
  urls: string[];
  lastModified?: string | null;
}

// Adobe's sitemap is ~75MB. Instead of blind re-downloading, we cache the
// parsed URLs along with Adobe's Last-Modified header. On subsequent runs,
// we send an If-Modified-Since HTTP request to Adobe: if unchanged (304),
// we reuse the cached URLs with zero download and near-zero latency.
export async function getCachedSitemap(): Promise<SitemapCache | null> {
  const data = await redis.get<SitemapCache>(SITEMAP_CACHE_KEY);
  if (data && Array.isArray(data.urls)) return data;
  const legacy = await redis.get<string[]>(DISCOVERED_URLS_KEY);
  if (legacy && Array.isArray(legacy)) return { urls: legacy };
  return null;
}

export async function setCachedSitemap(cache: SitemapCache): Promise<void> {
  await redis.set(SITEMAP_CACHE_KEY, cache);
}

export async function getCachedDiscoveredUrls(): Promise<string[] | null> {
  const cache = await getCachedSitemap();
  return cache ? cache.urls : null;
}

export async function setCachedDiscoveredUrls(urls: string[], ttlSeconds?: number): Promise<void> {
  const opts = ttlSeconds ? { ex: ttlSeconds } : undefined;
  await redis.set(DISCOVERED_URLS_KEY, urls, opts);
}

const SUBSCRIBERS_KEY = "subscribers";

// The bot owner (TELEGRAM_CHAT_ID) is always notified regardless of this
// set -- these are the *additional* people who opted in via /subscribe.
export async function addSubscriber(chatId: string): Promise<void> {
  await redis.sadd(SUBSCRIBERS_KEY, chatId);
}

export async function removeSubscriber(chatId: string): Promise<void> {
  await redis.srem(SUBSCRIBERS_KEY, chatId);
}

export async function listSubscribers(): Promise<string[]> {
  return await redis.smembers(SUBSCRIBERS_KEY);
}

const LAST_SCAN_KEY = "last-scan-summary";

// Powers /lastScan and /lastModified -- both answer from this instead of
// triggering a fresh scan, since "when did we last check" and "what
// changed last time" are questions about history, not a reason to
// re-scrape 355 pages.
export async function setLastScanSummary(summary: ScanSummary): Promise<void> {
  await redis.set(LAST_SCAN_KEY, summary);
}

export async function getLastScanSummary(): Promise<ScanSummary | null> {
  const data = await redis.get<ScanSummary>(LAST_SCAN_KEY);
  return data ?? null;
}
