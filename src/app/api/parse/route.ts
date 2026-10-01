import { NextRequest, NextResponse } from "next/server";
import { ParseRequestSchema } from "@/lib/schema";
import { parseLabelImages, buildExplanation } from "@/lib/ai-vision";
import { calculateScore } from "@/lib/score";
import { lookupBarcode } from "@/lib/openfoodfacts";

export const maxDuration = 60;

function dataUrlToVision(dataUrl: string): { base64: string; mimeType: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/);
  if (!m) throw new Error("Image must be a data URL (data:image/...;base64,...)");
  let [, mimeType, base64] = m;
  base64 = base64.replace(/\s+/g, "");
  // Upstream only accepts webp/png/jpeg/gif — normalize anything else to jpeg
  const mt = mimeType.toLowerCase();
  if (!["image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"].includes(mt)) {
    mimeType = "image/jpeg";
  } else if (mt === "image/jpg") {
    mimeType = "image/jpeg";
  }
  // ~4MB cap per image
  if (base64.length > 5_500_000) throw new Error("Image too large (max ~4MB). Please use a smaller photo.");
  return { base64, mimeType };
}

export async function POST(req: NextRequest) {
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const rlog = (...args: unknown[]) => console.log(`[cleanbite][parse:${requestId}]`, ...args);
  try {
    const body = await req.json();
    const parsed = ParseRequestSchema.safeParse(body);
    if (!parsed.success) {
      rlog("invalid request", JSON.stringify(parsed.error.flatten()).slice(0, 500));
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }
    const { images, mimeTypes, localeHint, barcode, debug: wantDebug } = parsed.data;
    rlog(`photos=${images.length} bytes=[${images.map((i) => i.length).join(",")}] barcode=${barcode ?? "-"} locale=${localeHint ?? "-"}`);

    // 1) Barcode fast-path: try OFF first when only barcode given
    if ((!images || images.length === 0) && barcode) {
      const off = await lookupBarcode(barcode);
      if (!off) return NextResponse.json({ error: "Barcode not found in Open Food Facts. Try photo scan." }, { status: 404 });
      const score = calculateScore(off);
      return NextResponse.json({
        source: "openfoodfacts", provider: "off", product: off, score,
        explanation: buildExplanation(score.score, score.grade, score.adjustments, localeHint ?? "en"),
      });
    }
    if (images.length === 0) return NextResponse.json({ error: "No images provided" }, { status: 400 });

    // 2) Vision LLM parse
    const visionImages = images.map((img, i) => {
      if (img.startsWith("data:")) return dataUrlToVision(img);
      const mimeType = (mimeTypes[i] ?? "image/jpeg").toLowerCase() === "image/jpg" ? "image/jpeg" : (mimeTypes[i] ?? "image/jpeg");
      return { base64: img.replace(/\s+/g, ""), mimeType };
    });
    // Validate each image is decodable before paying for OCR calls
    for (let i = 0; i < visionImages.length; i++) {
      try {
        Buffer.from(visionImages[i].base64, "base64");
      } catch {
        rlog(`photo[${i}] is not valid base64`);
        return NextResponse.json({ error: "Vision parse failed", message: `Photo ${i + 1} is not a valid image. Please retake it.` }, { status: 400 });
      }
      if (visionImages[i].base64.length < 1000) {
        rlog(`photo[${i}] suspiciously small (${visionImages[i].base64.length} chars)`);
        return NextResponse.json({ error: "Vision parse failed", message: `Photo ${i + 1} looks empty or corrupted. Please retake it.` }, { status: 400 });
      }
    }

    let product;
    let provider: string;
    let debug: unknown = null;
    try {
      const r = await parseLabelImages(visionImages);
      product = r.parsed;
      provider = r.provider;
      debug = r.debug;
      rlog(`ocr ok strategy=${r.debug.strategy} ingredients=${product.ingredients.length} confidence=${product.confidence}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Vision parse failed";
      rlog(`ocr FAILED: ${msg}`);
      // No API key configured -> demo mode so UI still works
      if (msg.includes("not configured")) {
        return NextResponse.json(
          { error: "DEMO_MODE", message: "No CMD_API_KEY set. Add it to .env.local to enable real scanning." },
          { status: 501 }
        );
      }
      return NextResponse.json({ error: "Vision parse failed", message: msg }, { status: 502 });
    }

    // 3) Optional: enrich with barcode data if provided
    if (barcode) {
      try {
        const off = await lookupBarcode(barcode);
        if (off) {
          // fill nulls from OFF
          for (const [k, v] of Object.entries(off.nutrition_per_100g)) {
            if ((product.nutrition_per_100g as Record<string, unknown>)[k] == null && v != null) {
              (product.nutrition_per_100g as Record<string, unknown>)[k] = v;
            }
          }
          if (!product.product_name && off.product_name) product.product_name = off.product_name;
          product.warnings.push("Enriched with Open Food Facts barcode data.");
        }
      } catch { /* non-fatal */ }
    }

    const score = calculateScore(product);
    rlog(`score=${score.score} grade=${score.grade}`);
    return NextResponse.json({
      source: "vision", provider, product, score,
      ...(wantDebug ? { debug } : {}),
      explanation: buildExplanation(score.score, score.grade, score.adjustments, localeHint ?? product.language_detected),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    rlog(`server error: ${msg}`);
    return NextResponse.json({ error: "Server error", message: msg }, { status: 500 });
  }
}
