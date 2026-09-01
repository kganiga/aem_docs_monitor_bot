/**
 * One-line change digest via Gemini's free tier (ai.google.dev, no
 * credit card required, free tier does not expire). Tested live against
 * both current flash models before picking one: gemini-3.7-flash's free
 * tier is capped at 5 requests/minute (hit that limit immediately in
 * testing -- too tight given pages are scanned in batches of 20, so
 * several real changes in one batch could exceed it). gemini-3.5-flash-lite
 * (the model Google's own API error for the now-retired 2.5-flash-lite
 * pointed us to) has a much more generous free allotment and worked
 * cleanly.
 *
 * GEMINI_API_KEY is optional: without it, or if the call fails for any
 * reason (including hitting a rate limit), this falls back to a
 * heuristic digest built from data we already have -- an optional AI
 * call must never be the reason a change notification doesn't go out.
 */
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/interactions";
const GEMINI_MODEL = "gemini-3.5-flash-lite";

interface GeminiResponse {
  output_text?: string;
  steps?: { type: string; content?: { type: string; text?: string }[] }[];
}

function heuristicDigest(diffExcerpt: string): string {
  const lines = diffExcerpt.split("\n");
  const added = lines.filter((l) => l.startsWith("+ ")).length;
  const removed = lines.filter((l) => l.startsWith("- ")).length;
  return `${added + removed} line(s) changed (${removed} removed, ${added} added)`;
}

export async function summarizeChange(diffExcerpt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return heuristicDigest(diffExcerpt);

  try {
    const resp = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        input:
          "Summarize what changed in this documentation page diff in ONE short plain-text " +
          "sentence, under 20 words, no markdown, no quotes. Lines starting with + were added, " +
          `lines starting with - were removed:\n\n${diffExcerpt.slice(0, 4000)}`,
        generation_config: { temperature: 0.2, thinking_level: "low" },
      }),
    });
    if (!resp.ok) {
      throw new Error(`Gemini request failed: ${resp.status} ${await resp.text()}`);
    }

    const data = (await resp.json()) as GeminiResponse;
    const modelOutput = data.steps?.find((s) => s.type === "model_output");
    const text = data.output_text ?? modelOutput?.content?.find((c) => c.type === "text")?.text;
    const trimmed = text?.trim();
    if (!trimmed) throw new Error("Gemini returned no summary text");
    return trimmed;
  } catch (err) {
    console.error("Gemini summary failed, falling back to heuristic digest:", err);
    return heuristicDigest(diffExcerpt);
  }
}
