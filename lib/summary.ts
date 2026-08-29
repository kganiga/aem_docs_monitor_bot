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

export function formatScanSummary(summary: ScanSummary): string {
  const when = summary.timestamp.replace("T", " ").replace(/\.\d+Z$/, " UTC");

  const lines = [
    `📊 Scan complete — ${when}`,
    `Checked: ${summary.checked} page(s)`,
    `✏️ Updated: ${summary.changed.length}`,
    `🆕 Added: ${summary.newlyTracked.length}`,
    `🗑️ Removed: ${summary.removed.length}`,
    `⚠️ Failed: ${summary.failed.length}`,
  ];

  if (summary.changed.length > 0) {
    lines.push("", "Updated:", formatList(summary.changed));
  }
  if (summary.newlyTracked.length > 0) {
    lines.push("", "Added:", formatList(summary.newlyTracked));
  }
  if (summary.removed.length > 0) {
    lines.push("", "Removed:", formatList(summary.removed));
  }
  if (summary.failed.length > 0) {
    lines.push("", "Failed:", formatList(summary.failed.map((f) => `${f.url}: ${f.error}`)));
  }

  const text = lines.join("\n");
  return text.length > MAX_MESSAGE_LEN ? text.slice(0, MAX_MESSAGE_LEN) + "\n...(truncated)" : text;
}
