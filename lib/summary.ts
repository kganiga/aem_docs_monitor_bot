import { ScanSummary } from "./scan";

const LIST_PREVIEW = 10;
const MAX_MESSAGE_LEN = 3500;

function formatList(items: string[]): string {
  const shown = items.slice(0, LIST_PREVIEW).map((i) => `  - ${i}`);
  if (items.length > LIST_PREVIEW) {
    shown.push(`  ...and ${items.length - LIST_PREVIEW} more`);
  }
  return shown.join("\n");
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // fixed UTC+5:30, no DST -- manual shift avoids relying on ICU timezone data

function formatIST(isoTimestamp: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(new Date(isoTimestamp).getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} IST`;
}

export function formatScanSummary(summary: ScanSummary): string {
  const when = formatIST(summary.timestamp);

  const lines = [
    `Scan complete — ${when}`,
    `Checked: ${summary.checked} | Updated: ${summary.changed.length} | Added: ${summary.newlyTracked.length} | Removed: ${summary.removed.length} | Failed: ${summary.failed.length}`,
  ];

  if (summary.changedDetails.length > 0) {
    lines.push("");
    for (const c of summary.changedDetails.slice(0, LIST_PREVIEW)) {
      lines.push(c.title);
      if (c.metaLastUpdate) lines.push(`Last updated: ${c.metaLastUpdate}`);
      lines.push(c.digest, c.url, "");
    }
    if (summary.changedDetails.length > LIST_PREVIEW) {
      const rest = summary.changedDetails.slice(LIST_PREVIEW).map((c) => c.url);
      lines.push(`...and ${rest.length} more updated page(s):`, formatList(rest), "");
    }
  }
  if (summary.newlyTracked.length > 0) {
    lines.push("Added:", formatList(summary.newlyTracked), "");
  }
  if (summary.removed.length > 0) {
    lines.push("Removed:", formatList(summary.removed), "");
  }
  if (summary.failed.length > 0) {
    lines.push("Failed:", formatList(summary.failed.map((f) => `${f.url}: ${f.error}`)), "");
  }

  const text = lines.join("\n").trimEnd();
  return text.length > MAX_MESSAGE_LEN ? text.slice(0, MAX_MESSAGE_LEN) + "\n...(truncated)" : text;
}
