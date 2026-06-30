/** Zod schemas for the machine-readable verdict artifacts agents emit. */
import { z } from "zod";

export const acceptanceResultSchema = z.object({
  passed: z.boolean(),
  summary: z.string().default(""),
  issues: z
    .array(
      z.object({
        ac: z.string().default(""),
        problem: z.string().default(""),
        suggestion: z.string().default(""),
      }),
    )
    .default([]),
});
export type AcceptanceResult = z.infer<typeof acceptanceResultSchema>;

export const reviewItemSchema = z.object({
  area: z.string().default(""),
  problem: z.string().default(""),
  suggestion: z.string().default(""),
});

export const codeReviewResultSchema = z.object({
  approved: z.boolean(),
  summary: z.string().default(""),
  mustFix: z.array(reviewItemSchema).default([]),
  minor: z.array(reviewItemSchema).default([]),
  previousItemsVerified: z.boolean().default(false),
});
export type CodeReviewResult = z.infer<typeof codeReviewResultSchema>;

export const summarySchema = z.object({
  productOwnerSummary: z.string(),
  technicalSummary: z.string(),
});
export type Summary = z.infer<typeof summarySchema>;

/**
 * Parse JSON that an agent wrote, tolerating accidental markdown code fences or
 * leading/trailing prose around the JSON object.
 */
export function parseJsonLoose<S extends z.ZodTypeAny>(
  raw: string,
  schema: S,
): { ok: true; value: z.infer<S> } | { ok: false; error: string } {
  let text = raw.trim();
  // Strip ```json ... ``` fences if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) text = fence[1].trim();
  // Fall back to the outermost { ... } span.
  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      text = text.slice(start, end + 1);
    }
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `invalid JSON: ${(e as Error).message}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, value: result.data };
}
