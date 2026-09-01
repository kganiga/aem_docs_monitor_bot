/**
 * The rewrite that on-demand/serverless actually required, mentioned
 * earlier as a real cost of this approach: the Python version fetched
 * 105 pages one at a time with a 2s courtesy delay (200+ seconds --
 * would not fit in a serverless timeout). This version fetches in
 * small concurrent batches instead, to land comfortably under the
 * 60s function budget while still not hammering Adobe's site with
 * 105 simultaneous requests.
 */
import * as Diff from "diff";
import { getPageState, setPageState, deletePageState, listTrackedUrls, PageState } from "./db";
import { scrapePage } from "./scraper";
import { sendUpdateNotification } from "./notify";
import { fetchLiveUrls } from "./discover";
import { summarizeChange } from "./summarize";

// Coverage grew from 140 to 355 URLs (sites + implementing/developer docs)
// -- at the original BATCH_SIZE=10/500ms this would run ~65-70s, over the
// 60s function budget. Bumped concurrency and trimmed the pause to bring a
// full run back to ~40-45s (measured: 20 concurrent fetches to Adobe in
// ~600ms), still nowhere near the 105-at-once case this batching exists to
// avoid.
const BATCH_SIZE = 20;
const BATCH_PAUSE_MS = 300;

export interface ScanSummary {
  checked: number;
  timestamp: string;
  changed: string[];
  newlyTracked: string[];
  removed: string[];
  failed: { url: string; error: string }[];
}

function buildDiffExcerpt(oldText: string, newText: string, maxLines = 25): string {
  const parts = Diff.diffLines(oldText, newText);
  const lines: string[] = [];
  for (const part of parts) {
    if (!part.added && !part.removed) continue;
    const prefix = part.added ? "+ " : "- ";
    for (const line of part.value.split("\n")) {
      if (!line.trim()) continue;
      lines.push(prefix + line);
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
  }
  return lines.length ? lines.join("\n") : "(content changed but no line-level diff produced)";
}

async function processUrl(url: string): Promise<{ status: "changed" | "new" | "unchanged"; url: string }> {
  const result = await scrapePage(url);
  const prior = await getPageState(url);
  const now = new Date().toISOString();

  const newState: PageState = {
    contentHash: result.hash,
    contentSnapshot: result.text,
    title: result.title,
    metaLastUpdate: result.metaLastUpdate,
    lastCheckedAt: now,
  };

  if (!prior) {
    await setPageState(url, newState);
    return { status: "new", url };
  }

  if (prior.contentHash !== result.hash) {
    const diffExcerpt = buildDiffExcerpt(prior.contentSnapshot, result.text);
    const digest = await summarizeChange(diffExcerpt);
    await sendUpdateNotification(url, result.title, digest, result.metaLastUpdate);
    await setPageState(url, newState);
    return { status: "changed", url };
  }

  await setPageState(url, newState); // refresh lastCheckedAt even when unchanged
  return { status: "unchanged", url };
}

export async function runScan(): Promise<ScanSummary> {
  const summary: ScanSummary = {
    checked: 0,
    timestamp: new Date().toISOString(),
    changed: [],
    newlyTracked: [],
    removed: [],
    failed: [],
  };
  const [liveList, previouslyTracked] = await Promise.all([fetchLiveUrls(), listTrackedUrls()]);

  // A page missing from the sitemap fetch is only a *candidate* removal --
  // sitemaps aren't guaranteed complete or instantly up to date (a page can
  // move to a new canonical URL and briefly/permanently drop the old one
  // from the sitemap while the old URL still 301-redirects to a live page).
  // Trusting that absence alone previously produced false "removed" reports
  // for pages that were actually fine. Fold candidates into the same batch
  // scan instead and only treat a real fetch failure as confirmation --
  // same principle as fixing the original stale-URL bug: verify with a live
  // HTTP response, not an indirect signal.
  const liveSet = new Set(liveList);
  const candidateRemoved = new Set(previouslyTracked.filter((u) => !liveSet.has(u)));
  const list = [...liveList, ...candidateRemoved];

  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const batch = list.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(processUrl));

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const url = batch[j];
      summary.checked++;
      if (r.status === "fulfilled") {
        if (r.value.status === "changed") summary.changed.push(url);
        if (r.value.status === "new") summary.newlyTracked.push(url);
        // else: still resolves fine, the sitemap fetch just missed it --
        // processUrl already refreshed its state normally, nothing more to do.
      } else if (candidateRemoved.has(url)) {
        await deletePageState(url);
        summary.removed.push(url);
      } else {
        summary.failed.push({ url, error: String(r.reason) });
      }
    }

    if (i + BATCH_SIZE < list.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }

  return summary;
}
