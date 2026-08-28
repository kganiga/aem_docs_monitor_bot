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
import urls from "../config/urls_verified.json";
import { getPageState, setPageState, PageState } from "./db";
import { scrapePage } from "./scraper";
import { sendUpdateNotification } from "./notify";

const BATCH_SIZE = 10;
const BATCH_PAUSE_MS = 500; // brief pause between batches -- still polite, just not 2s x 105

export interface ScanSummary {
  checked: number;
  changed: string[];
  newlyTracked: string[];
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
    metaLastUpdate: result.metaLastUpdate,
    lastCheckedAt: now,
  };

  if (!prior) {
    await setPageState(url, newState);
    return { status: "new", url };
  }

  if (prior.contentHash !== result.hash) {
    const diffExcerpt = buildDiffExcerpt(prior.contentSnapshot, result.text);
    await sendUpdateNotification(url, diffExcerpt);
    await setPageState(url, newState);
    return { status: "changed", url };
  }

  await setPageState(url, newState); // refresh lastCheckedAt even when unchanged
  return { status: "unchanged", url };
}

export async function runScan(): Promise<ScanSummary> {
  const summary: ScanSummary = { checked: 0, changed: [], newlyTracked: [], failed: [] };
  const list = urls as string[];

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
