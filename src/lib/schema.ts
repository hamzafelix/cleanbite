import { z } from "zod";

export const LocaleSchema = z.enum(["en", "ar", "fr", "de"]);
export type Locale = z.infer<typeof LocaleSchema>;

/** Lenient number parser for LLM output: "12,5 g" | "12.5g" | "n/a" | "" -> number | null */
function parseLooseNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 ? v : null;
  if (typeof v !== "string") return null;
  let s = v.trim().toLowerCase();
  if (s === "" || s === "n/a" || s === "na" || s === "-" || s === "—" || s === "null" || s === "none") return null;
  // strip units (g, mg, kcal, kj, %, ml...) — keep digits , . -
  s = s.replace(/\s*(kcal|kj|mg|mcg|µg|g|ml|l|%|percent)\s*\.?$/i, "").trim();
  // "1 234,5" -> "1234.5" ; "1,234.5" -> "1234.5"
  s = s.replace(/\s+/g, "");
  if (/^\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",") && s.includes(".")) s = s.replace(/,/g, "");
  else if (s.includes(",")) s = s.replace(",", ".");
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

const looseNumber = () =>
  z.preprocess(parseLooseNumber, z.number().nonnegative().nullable().default(null));

const loosePercent = () =>
  z.preprocess((v) => {
    const n = parseLooseNumber(v);
    if (n == null) return null;
    return Math.min(100, n);
  }, z.number().min(0).max(100).nullable().default(null));

/** Accept "salt, sugar" string or mixed array -> string[] */
const looseStringArray = () =>
  z.preprocess((v) => {
    if (v == null) return [];
    if (typeof v === "string") return v.split(/[,;\n]/).map((s) => String(s).trim()).filter(Boolean);
    if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
    return [];
  }, z.array(z.string()).default([]));

const looseText = () =>
  z.preprocess((v) => {
    if (v == null) return "";
    if (typeof v === "string") return v;
    if (Array.isArray(v)) return v.map((x) => String(x ?? "")).join("\n");
    return String(v);
  }, z.string().default(""));

export const NutritionPer100gSchema = z.object({
  energy_kcal: looseNumber(),
  fat: looseNumber(),
  saturated_fat: looseNumber(),
  carbs: looseNumber(),
  sugars: looseNumber(),
  fiber: looseNumber(),
  protein: looseNumber(),
  salt: looseNumber(),
  sodium: looseNumber(),
  fruit_veg_nuts_pct: loosePercent(),
});
export type NutritionPer100g = z.infer<typeof NutritionPer100gSchema>;

export const ProductParseSchema = z.object({
  product_name: z.preprocess(
    (v) => (v == null ? null : String(v).slice(0, 200) || null),
    z.string().max(200).nullable().default(null)
  ),
  language_detected: z.preprocess((v) => {
    const s = String(v ?? "").toLowerCase().slice(0, 2);
    return ["en", "ar", "fr", "de"].includes(s) ? s : "other";
  }, z.enum(["en", "ar", "fr", "de", "other"]).default("other")),
  raw_text_ingredients: looseText(),
  raw_text_nutrition: looseText(),
  ingredients: looseStringArray(),
  allergens: looseStringArray(),
  additives_e_numbers: looseStringArray(),
  nutrition_per_100g: z.preprocess((v) => {
    const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
    // strip unknown keys, keep only the 10 known nutrients
    const out: Record<string, unknown> = {};
    for (const k of ["energy_kcal", "fat", "saturated_fat", "carbs", "sugars", "fiber", "protein", "salt", "sodium", "fruit_veg_nuts_pct"]) {
      if (k in o) out[k] = o[k];
    }
    return out;
  }, NutritionPer100gSchema),
  serving_size: z.preprocess(
    (v) => (v == null || v === "" ? null : String(v)),
    z.string().nullable().default(null)
  ),
  confidence: z.preprocess((v) => {
    const n = parseLooseNumber(v);
    if (n == null) return 0.5;
    return Math.max(0, Math.min(1, n > 1 ? n / 100 : n));
  }, z.number().min(0).max(1).default(0.5)),
  warnings: looseStringArray(),
});
export type ProductParse = z.infer<typeof ProductParseSchema>;

export const GradeSchema = z.enum(["A", "B", "C", "D", "E"]);
export type Grade = z.infer<typeof GradeSchema>;

export const ScoreResultSchema = z.object({
  score: z.number().min(0).max(100),
  grade: GradeSchema,
  nutriScoreRaw: z.number(),
  baseScore: z.number(),
  adjustments: z.array(
    z.object({
      key: z.string(),
      delta: z.number(),
      label_en: z.string(),
    })
  ),
  flags: z.array(z.string()),
  nova_group: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  breakdown: z.object({
    n_points: z.number(),
    p_points: z.number(),
    energy_pts: z.number(),
    sugars_pts: z.number(),
    satfat_pts: z.number(),
    sodium_pts: z.number(),
    fiber_pts: z.number(),
    protein_pts: z.number(),
    fruit_pts: z.number(),
  }),
});
export type ScoreResult = z.infer<typeof ScoreResultSchema>;

export const ParseRequestSchema = z.object({
  images: z.array(z.string().min(100)).max(4).optional().default([]),
  mimeTypes: z.array(z.string()).optional().default([]),
  localeHint: LocaleSchema.optional(),
  barcode: z.string().optional(),
  debug: z.boolean().optional().default(false),
});
export type ParseRequest = z.infer<typeof ParseRequestSchema>;
