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

const redis = Redis.fromEnv();

export interface PageState {
  contentHash: string;
  contentSnapshot: string;
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
