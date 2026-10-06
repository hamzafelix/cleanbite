import { ProductParseSchema, type ProductParse } from "./schema";

const SYSTEM_PROMPT = `You are a food-label OCR expert. You read photos of food product labels: ingredients lists and nutrition facts tables.
Labels may be in English, Arabic, French, or German — often mixed.

RULES:
1. Extract ALL visible ingredients as a list, in English where possible (translate Arabic/French/German names to English, keep original if unsure).
2. Extract nutrition values NORMALIZED TO PER 100g (or 100ml). If the label shows per-portion or per-serving only, convert using the serving size. State conversion in warnings.
3. Extract E-numbers (E100-E1521) from ingredients text, uppercase, e.g. "E250".
4. Detect language of the label: en, ar, fr, de, or other.
5. Set confidence 0..1 based on readability. If a value is not visible, use null — NEVER invent numbers.
6. List allergens if declared (milk, gluten, nuts, soy, eggs, fish, sesame, mustard, celery, sulfites...).
7. Return ONLY valid JSON matching this schema, no markdown, no extra text:
{
  "product_name": string | null,
  "language_detected": "en"|"ar"|"fr"|"de"|"other",
  "raw_text_ingredients": string,
  "raw_text_nutrition": string,
  "ingredients": string[],
  "allergens": string[],
  "additives_e_numbers": string[],
  "nutrition_per_100g": {
    "energy_kcal": number|null, "fat": number|null, "saturated_fat": number|null,
    "carbs": number|null, "sugars": number|null, "fiber": number|null,
    "protein": number|null, "salt": number|null, "sodium": number|null,
    "fruit_veg_nuts_pct": number|null
  },
  "serving_size": string|null,
  "confidence": number,
  "warnings": string[]
}
Energy: if label shows kJ only, convert kJ/4.184 = kcal. Salt: if sodium only, salt = sodium*2.5. Sodium: if salt only, sodium = salt/2.5.`;

export interface VisionImage {
  base64: string; // raw base64 without data: prefix
  mimeType: string;
}

export interface VisionDebug {
  provider: string;
  model: string;
  imageCount: number;
  imageBytes: number[];
  strategy: "combined" | "per-photo-merged";
  rawResponses: { photoIndex: number; chars: number; preview: string; parsedOk: boolean; error?: string }[];
  mergedWarnings: string[];
  durationMs: number;
}

export interface VisionResult {
  parsed: ProductParse;
  provider: string;
  debug: VisionDebug;
}

function log(...args: unknown[]) {
  console.log("[cleanbite][ocr]", ...args);
}

const PREVIEW_CHARS = 1200;

export const CMD_DEFAULT_MODEL = "deepseek/deepseek-v4-flash-vision-exp";
export const CMD_DEFAULT_BASE_URL = "https://api.commandcode.ai/provider/v1";
/**
 * Vision models here are reasoning models: they emit a separate `reasoning`
 * field first. A dense ingredient + nutrition panel can burn 13k+ reasoning
 * tokens before the JSON answer, so the cap has to be generous.
 */
const CMD_MAX_TOKENS = Number(process.env.CMD_MAX_TOKENS) || 16000;

/**
 * Per-request budget for the upstream call. Reasoning vision models can take
 * minutes on a dense label, so this is generous — but it must be finite, or a
 * stalled upstream leaves the request hanging and the client spinning forever.
 */
const CMD_REQUEST_TIMEOUT_MS = Number(process.env.CMD_REQUEST_TIMEOUT_MS) || 90_000;

function timeoutError(ms: number): Error {
  return new Error(
    `Command Code: no response after ${Math.round(ms / 1000)}s. The model is too slow for this label — ` +
      `try one photo at a time, or lower CMD_MAX_TOKENS / use a non-reasoning model.`
  );
}

function cmdConfig() {
  const apiKey = process.env.CMD_API_KEY;
  if (!apiKey) throw new Error("CMD_API_KEY not configured");
  const model = process.env.CMD_MODEL || CMD_DEFAULT_MODEL;
  const baseUrl = (process.env.CMD_BASE_URL || CMD_DEFAULT_BASE_URL).replace(/\/$/, "");
  return { apiKey, model, baseUrl };
}

function toFriendlyError(status: number, raw: string): Error {
  const body = raw.slice(0, 500);
  // Try OpenAI error envelope: { error: { message, code, type } }
  let code = "";
  let message = "";
  try {
    const parsed = JSON.parse(raw);
    code = parsed?.error?.code ?? "";
    message = parsed?.error?.message ?? "";
  } catch {
    /* raw is not JSON */
  }
  if (status === 401) return new Error(`Command Code: invalid API key (401). Check CMD_API_KEY. ${message}`.trim());
  if (status === 403 && code === "upgrade_required")
    return new Error("Command Code: Go plan has no API access — upgrade to GOAT or higher.");
  if (status === 400 && code === "unsupported_model")
    return new Error(`Command Code: model not in catalog (400). Check CMD_MODEL. ${message}`.trim());
  if (status === 400 && /unsupported image|invalid.*image|image.*invalid/i.test(`${message} ${body}`))
    return new Error("Command Code: image rejected as unsupported/corrupt. Please retake the photo (JPEG/PNG) and retry.");
  if (status === 400 && message) return new Error(`Command Code error 400: ${message}`);
  if (status === 429) return new Error("Command Code: rate limited (429). Retry with backoff.");
  if (status >= 500) return new Error(`Command Code: upstream failure (${status}). ${message || body}`);
  return new Error(`Command Code error ${status}: ${message || body}`);
}

/**
 * One OCR request for a set of photos. Returns the raw model text so the
 * caller can log it even when JSON parsing fails.
 */
async function ocrRequest(
  apiKey: string,
  model: string,
  baseUrl: string,
  images: VisionImage[],
  label: string
): Promise<{ text: string; usage?: unknown }> {
  const content: unknown[] = [{ type: "text", text: SYSTEM_PROMPT }];
  for (const img of images) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${img.mimeType};base64,${img.base64}`, detail: "low" },
    });
  }
  content.push({ type: "text", text: "Read these food label photo(s). Return ONLY the JSON object." });

  log(`${label}: POST ${baseUrl}/chat/completions model=${model} photos=${images.length}`);
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CMD_REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        temperature: 0.1,
        max_tokens: CMD_MAX_TOKENS,
        response_format: { type: "json_object" },
      }),
    });
  } catch (e) {
    // AbortError means our own budget expired, not that upstream refused.
    if (controller.signal.aborted) {
      log(`${label}: TIMEOUT after ${CMD_REQUEST_TIMEOUT_MS}ms`);
      throw timeoutError(CMD_REQUEST_TIMEOUT_MS);
    }
    throw new Error(`Command Code: network error — ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
  const ms = Date.now() - started;
  if (!res.ok) {
    const t = await res.text();
    log(`${label}: HTTP ${res.status} in ${ms}ms body=${t.slice(0, 500)}`);
    throw toFriendlyError(res.status, t);
  }
  const json = await res.json();
  const choice = json?.choices?.[0];
  const msgContent = choice?.message?.content;
  // Some gateways return content as an array of parts instead of a plain string
  const text: string =
    typeof msgContent === "string"
      ? msgContent
      : Array.isArray(msgContent)
        ? msgContent.map((p) => (typeof p?.text === "string" ? p.text : "")).join("")
        : "";
  const reasoning: string = typeof choice?.message?.reasoning === "string" ? choice.message.reasoning : "";
  log(
    `${label}: OK in ${ms}ms chars=${text.length} reasoning=${reasoning.length} finish=${choice?.finish_reason ?? "?"} usage=${JSON.stringify(json?.usage ?? null)}`
  );
  // Reasoning models burn the token budget on a `reasoning` field and return
  // content: null once max_tokens is hit. Surface that instead of "no JSON".
  if (!text) {
    throw new Error(
      reasoning
        ? `Model spent all ${CMD_MAX_TOKENS} output tokens reasoning and returned no answer (finish_reason=${
            choice?.finish_reason ?? "?"
          }). Raise CMD_MAX_TOKENS or use a non-reasoning model.`
        : `Model returned an empty response (finish_reason=${choice?.finish_reason ?? "?"}).`
    );
  }
  log(`${label}: raw preview >>>${text.slice(0, PREVIEW_CHARS)}<<<`);
  return { text, usage: json?.usage };
}

function describeParseError(e: unknown, preview: string): string {
  if (e instanceof Error) {
    // zod errors are long — keep message + first issues
    const msg = e.message.slice(0, 800);
    log(`parse FAILED: ${msg} preview >>>${preview.slice(0, 600)}<<<`);
    return msg;
  }
  return String(e);
}

function tryParseLogged(text: string, label: string): { ok: true; parsed: ProductParse } | { ok: false; error: string } {
  try {
    const parsed = parseModelJson(text);
    log(`${label}: parsed OK ingredients=${parsed.ingredients.length} nutrients=${Object.values(parsed.nutrition_per_100g).filter((v) => v != null).length} confidence=${parsed.confidence}`);
    return { ok: true, parsed };
  } catch (e) {
    return { ok: false, error: describeParseError(e, text) };
  }
}

function parseModelJson(text: string): ProductParse {
  // strip markdown fences if model adds them
  const cleaned = (text ?? "").replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model returned no JSON");
  let obj: unknown;
  try {
    obj = JSON.parse(cleaned.slice(start, end + 1));
  } catch (e) {
    throw new Error(`Model JSON is malformed: ${e instanceof Error ? e.message : e}. Preview: ${cleaned.slice(0, 300)}`);
  }
  const res = ProductParseSchema.safeParse(obj);
  if (!res.success) {
    const issues = res.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Model JSON failed schema validation: ${issues}`);
  }
  return res.data;
}

/** Merge per-photo parses: union ingredients/additives, first non-null nutrient wins. */
function mergeParses(parses: ProductParse[]): ProductParse {
  const base: ProductParse = {
    product_name: parses.map((p) => p.product_name).find(Boolean) ?? null,
    language_detected: parses.map((p) => p.language_detected).find((l) => l !== "other") ?? "other",
    raw_text_ingredients: parses.map((p) => p.raw_text_ingredients).filter(Boolean).join("\n--- photo ---\n"),
    raw_text_nutrition: parses.map((p) => p.raw_text_nutrition).filter(Boolean).join("\n--- photo ---\n"),
    ingredients: [...new Set(parses.flatMap((p) => p.ingredients))],
    allergens: [...new Set(parses.flatMap((p) => p.allergens))],
    additives_e_numbers: [...new Set(parses.flatMap((p) => p.additives_e_numbers))],
    nutrition_per_100g: { ...parses[0].nutrition_per_100g },
    serving_size: parses.map((p) => p.serving_size).find(Boolean) ?? null,
    confidence: Math.min(...parses.map((p) => p.confidence)),
    warnings: [...new Set(parses.flatMap((p) => p.warnings))],
  };
  for (const p of parses.slice(1)) {
    for (const [k, v] of Object.entries(p.nutrition_per_100g)) {
      if ((base.nutrition_per_100g as Record<string, unknown>)[k] == null && v != null) {
        (base.nutrition_per_100g as Record<string, unknown>)[k] = v;
      }
    }
  }
  return base;
}

/**
 * Parse label images with Command Code (OpenAI-compatible /chat/completions).
 * Strategy: try all photos in one request; if that fails (multi-photo payloads
 * are the common failure), retry each photo individually and merge successes.
 * The retries run concurrently, so worst-case latency is two round trips
 * regardless of photo count.
 */
export async function parseLabelImages(images: VisionImage[]): Promise<VisionResult> {
  const { apiKey, model, baseUrl } = cmdConfig();
  const started = Date.now();
  const imageBytes = images.map((i) => Math.round((i.base64.length * 3) / 4));
  log(`parse start: photos=${images.length} bytes=[${imageBytes.join(",")}] model=${model}`);
  const debug: VisionDebug = {
    provider: "commandcode",
    model,
    imageCount: images.length,
    imageBytes,
    strategy: "combined",
    rawResponses: [],
    mergedWarnings: [],
    durationMs: 0,
  };

  // 1) combined attempt
  try {
    const { text } = await ocrRequest(apiKey, model, baseUrl, images, "combined");
    const attempt = tryParseLogged(text, "combined");
    debug.rawResponses.push({
      photoIndex: -1,
      chars: text.length,
      preview: text.slice(0, PREVIEW_CHARS),
      parsedOk: attempt.ok,
      error: attempt.ok ? undefined : attempt.error,
    });
    if (attempt.ok) {
      debug.durationMs = Date.now() - started;
      log(`parse OK via combined in ${debug.durationMs}ms`);
      return { parsed: attempt.parsed, provider: "commandcode", debug };
    }
    debug.mergedWarnings.push(`Combined request parsed badly (${attempt.error}), retrying per-photo.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`combined request FAILED: ${msg} — retrying per-photo`);
    debug.mergedWarnings.push(`Combined request failed (${msg}), retrying per-photo.`);
  }

  // Single photo + combined failure = nothing more to try
  if (images.length === 1) {
    debug.durationMs = Date.now() - started;
    const lastErr = debug.rawResponses[0]?.error ?? debug.mergedWarnings[0] ?? "OCR failed";
    throw new Error(`Vision parse failed: ${lastErr}`);
  }

  // 2) per-photo fallback
  debug.strategy = "per-photo-merged";
  // Fire every photo concurrently. Chaining these meant a 4-photo scan paid the
  // model latency 5 times over (combined + 4 sequential retries), which is how a
  // single label turned into a multi-minute spinner.
  const outcomes = await Promise.all(
    images.map(async (img, i) => {
      try {
        const { text } = await ocrRequest(apiKey, model, baseUrl, [img], `photo[${i}]`);
        const attempt = tryParseLogged(text, `photo[${i}]`);
        return {
          record: {
            photoIndex: i,
            chars: text.length,
            preview: text.slice(0, PREVIEW_CHARS),
            parsedOk: attempt.ok,
            error: attempt.ok ? undefined : attempt.error,
          } satisfies VisionDebug["rawResponses"][number],
          parsed: attempt.ok ? attempt.parsed : null,
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          record: {
            photoIndex: i,
            chars: 0,
            preview: "",
            parsedOk: false,
            error: msg,
          } satisfies VisionDebug["rawResponses"][number],
          parsed: null,
        };
      }
    })
  );
  // Keep rawResponses ordered by photo index regardless of completion order.
  outcomes.sort((a, b) => a.record.photoIndex - b.record.photoIndex);
  const successes: ProductParse[] = [];
  for (const o of outcomes) {
    debug.rawResponses.push(o.record);
    if (o.parsed) successes.push(o.parsed);
  }
  debug.durationMs = Date.now() - started;
  if (successes.length === 0) {
    const errs = debug.rawResponses.map((r) => `photo[${r.photoIndex}]: ${r.error}`).join(" | ");
    throw new Error(`Vision parse failed on all ${images.length} photos: ${errs}`);
  }
  const merged = mergeParses(successes);
  merged.warnings.unshift(
    `Merged from ${successes.length}/${images.length} photos (individual OCR fallback).`
  );
  debug.mergedWarnings.push(`Merged ${successes.length}/${images.length} photos.`);
  log(`parse OK via per-photo merge (${successes.length}/${images.length}) in ${debug.durationMs}ms`);
  return { parsed: merged, provider: "commandcode", debug };
}

/** Build a localized short explanation of the score (deterministic template, no extra LLM call). */
export function buildExplanation(
  score: number,
  grade: string,
  adjustments: { key: string; delta: number; label_en: string }[],
  locale: string
): string {
  const top = [...adjustments].sort((a, b) => a.delta - b.delta).slice(0, 3);
  const reasonEn =
    top.length === 0
      ? "Balanced nutrition profile with no major red flags."
      : top.map((a) => `${a.label_en} (${a.delta > 0 ? "+" : ""}${a.delta})`).join("; ");
  if (locale === "ar")
    return `الدرجة ${score}/100 (التقدير ${grade}). أهم العوامل: ${reasonEn}`;
  if (locale === "fr")
    return `Score ${score}/100 (note ${grade}). Facteurs clés : ${reasonEn}`;
  if (locale === "de")
    return `Wert ${score}/100 (Note ${grade}). Wichtigste Faktoren: ${reasonEn}`;
  return `Score ${score}/100 (grade ${grade}). Key factors: ${reasonEn}`;
}
