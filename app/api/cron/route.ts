/**
 * Called by Vercel Cron (see vercel.json) once daily. Also safe to hit
 * manually for testing, since it's protected by CRON_SECRET.
 *
 * Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` when
 * it invokes this route from the cron schedule -- you must set
 * CRON_SECRET yourself as an env var for this check to mean anything;
 * an unset value would make this comparison meaningless.
 */
import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/scan";
import { sendPlainMessage } from "@/lib/notify";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runScan();

    if (summary.newlyTracked.length > 0) {
      const newList = summary.newlyTracked.map((u) => `- ${u}`).join("\n");
      try {
        await sendPlainMessage(
          `🆕 Daily scan: ${summary.newlyTracked.length} new page(s) discovered and now being tracked:\n${newList.slice(0, 2000)}`
        );
      } catch (notifyErr) {
        console.error("Failed to send new-pages Telegram message:", notifyErr);
      }
    }

    if (summary.failed.length > 0) {
      const failedList = summary.failed.map((f) => `- ${f.url}: ${f.error}`).join("\n");
      try {
        await sendPlainMessage(
          `⚠️ Daily scan: ${summary.failed.length} page(s) failed to fetch:\n${failedList.slice(0, 2000)}`
        );
      } catch (notifyErr) {
        console.error("Failed to send failure-report Telegram message:", notifyErr);
      }
    }

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
