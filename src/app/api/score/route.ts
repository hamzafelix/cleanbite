import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ProductParseSchema } from "@/lib/schema";
import { calculateScore } from "@/lib/score";
import { buildExplanation } from "@/lib/ai-vision";

const Body = z.object({
  product: ProductParseSchema,
  locale: z.enum(["en", "ar", "fr", "de"]).optional().default("en"),
});

/** Re-score edited values instantly (no LLM call). */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid product" }, { status: 400 });
  const score = calculateScore(parsed.data.product);
  return NextResponse.json({
    score,
    explanation: buildExplanation(score.score, score.grade, score.adjustments, parsed.data.locale),
  });
}
