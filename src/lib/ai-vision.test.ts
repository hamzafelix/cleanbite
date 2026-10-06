import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { parseLabelImages } from "./ai-vision";

// cmdConfig() reads process.env at call time, and .env.local is not loaded by
// vitest, so the key has to be injected before each run.
beforeAll(() => {
  process.env.CMD_API_KEY = "test-key";
});

function visionImages(n: number) {
  return Array.from({ length: n }, (_, i) => ({ base64: `AAAA${i}`, mimeType: "image/jpeg" }));
}

/** Minimal valid ProductParse JSON the model could return. */
function okJson(name: string) {
  return JSON.stringify({
    product_name: name,
    language_detected: "en",
    raw_text_ingredients: "",
    raw_text_nutrition: "",
    ingredients: ["water"],
    allergens: [],
    additives_e_numbers: [],
    nutrition_per_100g: {
      energy_kcal: 1, fat: 0, saturated_fat: 0, carbs: 0, sugars: 0,
      fiber: 0, protein: 0, salt: 0, sodium: null, fruit_veg_nuts_pct: null,
    },
    serving_size: null,
    confidence: 0.9,
    warnings: [],
  });
}

function mockFetch(handler: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const fn = vi.fn(async (url: string, init: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fn);
  return fn;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  // Undo resetModules so later tests get the statically imported copy back.
  vi.resetModules();
});

describe("parseLabelImages", () => {
  it("sends the abort signal to the upstream fetch", async () => {
    let seenSignal: AbortSignal | undefined;
    mockFetch(async (_url, init) => {
      seenSignal = init.signal as AbortSignal;
      return jsonResponse({
        choices: [{ message: { content: okJson("Cola") } }],
      });
    });

    await parseLabelImages(visionImages(1));
    expect(seenSignal).toBeInstanceOf(AbortSignal);
    expect(seenSignal?.aborted).toBe(false);
  });

  it("aborts and reports a friendly timeout when the model never answers", async () => {
    // The budget is captured at module load, so shorten it via a fresh
    // module instance rather than waiting out the 90s production default.
    vi.stubEnv("CMD_REQUEST_TIMEOUT_MS", "40");
    vi.resetModules();
    const { parseLabelImages: parseWithShortBudget } = await import("./ai-vision");

    // Honour the abort signal, like a real fetch would, so the deadline fires.
    mockFetch(async (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init.signal as AbortSignal;
        signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      })
    );

    const err: unknown = await parseWithShortBudget(visionImages(1)).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/no response after/i);
  });

  it("retries per-photo concurrently rather than in sequence", async () => {
    const PER_PHOTO_DELAY_MS = 120;
    let perPhotoInFlight = 0;
    let maxPerPhotoInFlight = 0;

    // Combined attempt always fails, forcing the per-photo fallback.
    mockFetch(async (_url, init) => {
      const body = JSON.parse(init.body as string);
      const content = body.messages[0].content as { type: string }[];
      if (content.filter((c) => c.type === "image_url").length > 1) {
        return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 });
      }
      // Each per-photo call takes the same fixed time. Overlapping requests are
      // counted: sequential retries would never exceed 1 in flight, concurrent
      // ones reach 3.
      perPhotoInFlight += 1;
      maxPerPhotoInFlight = Math.max(maxPerPhotoInFlight, perPhotoInFlight);
      await new Promise((r) => setTimeout(r, PER_PHOTO_DELAY_MS));
      perPhotoInFlight -= 1;
      return jsonResponse({ choices: [{ message: { content: okJson("Water") } }] });
    });

    const res = await parseLabelImages(visionImages(3));

    expect(res.parsed.ingredients).toEqual(["water"]);
    expect(res.debug.strategy).toBe("per-photo-merged");
    expect(res.debug.imageCount).toBe(3);
    expect(maxPerPhotoInFlight).toBe(3);
  });

  it("keeps rawResponses ordered by photo index", async () => {
    // Photo 1 answers fast, photo 0 answers slow — index order must still hold.
    mockFetch(async (_url, init) => {
      const body = JSON.parse(init.body as string);
      const content = body.messages[0].content as { type: string }[];
      if (content.filter((c) => c.type === "image_url").length > 1) {
        return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 });
      }
      const imgPart = content.find((c) => c.type === "image_url") as
        | { image_url: { url: string } }
        | undefined;
      if (imgPart?.image_url.url.includes("AAAA0")) await new Promise((r) => setTimeout(r, 60));
      return jsonResponse({ choices: [{ message: { content: okJson("Water") } }] });
    });

    const res = await parseLabelImages(visionImages(2));
    const indices = res.debug.rawResponses.map((r) => r.photoIndex).filter((i) => i >= 0);
    expect(indices).toEqual([0, 1]);
  });
});
