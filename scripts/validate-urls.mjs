// Run locally: node scripts/validate-urls.mjs
// lib/discover.ts now pulls the live URL list from Adobe's sitemap on
// every cron run, so this script's job is narrower than it used to be:
// it regenerates config/urls_verified.json, the static fallback
// discover.ts uses if the live sitemap fetch ever fails or looks
// malformed. Re-run this occasionally so that fallback doesn't itself
// go stale.

import fs from "fs";

const urls = JSON.parse(fs.readFileSync(new URL("../config/urls.json", import.meta.url)));
const USER_AGENT = "aem-docs-watcher-next/0.1 (personal use, validation run)";

const good = [];
const bad = [];

for (const url of urls) {
  try {
    const resp = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (resp.status === 200) {
      good.push(url);
    } else {
      bad.push({ url, status: resp.status });
    }
  } catch (e) {
    bad.push({ url, status: String(e) });
  }
  await new Promise((r) => setTimeout(r, 300));
}

fs.writeFileSync(
  new URL("../config/urls_verified.json", import.meta.url),
  JSON.stringify(good, null, 2)
);

console.log(`${good.length}/${urls.length} URLs resolved with 200 OK -> config/urls_verified.json`);
if (bad.length) {
  console.log(`\n${bad.length} did NOT resolve cleanly:`);
  for (const b of bad) console.log(`  [${b.status}] ${b.url}`);
}
