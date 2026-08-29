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
import { broadcast } from "@/lib/notify";
import { formatScanSummary } from "@/lib/summary";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runScan();

    try {
      await broadcast(formatScanSummary(summary));
    } catch (notifyErr) {
      console.error("Failed to broadcast scan summary:", notifyErr);
    }

    return NextResponse.json(summary);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
