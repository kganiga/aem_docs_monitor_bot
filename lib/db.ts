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
}

function keyFor(url: string): string {
  return `page:${url}`;
}

export async function getPageState(url: string): Promise<PageState | null> {
  const data = await redis.get<PageState>(keyFor(url));
  return data ?? null;
}

export async function setPageState(url: string, state: PageState): Promise<void> {
  await redis.set(keyFor(url), state);
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

// Adobe's sitemap is ~75MB and gets fetched+parsed in full on every run
// (see lib/discover.ts) -- fine once a day, wasteful if /check gets hit
// several times in the same day (each call re-downloading the whole
// thing for a list that hasn't changed). Cached here with a TTL so
// repeated calls within the window reuse the same result; expires well
// before the next scheduled cron run so daily discovery still happens.
export async function getCachedDiscoveredUrls(): Promise<string[] | null> {
  const data = await redis.get<string[]>(DISCOVERED_URLS_KEY);
  return data ?? null;
}

export async function setCachedDiscoveredUrls(urls: string[], ttlSeconds: number): Promise<void> {
  await redis.set(DISCOVERED_URLS_KEY, urls, { ex: ttlSeconds });
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
