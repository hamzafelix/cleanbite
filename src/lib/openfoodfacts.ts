import type { ProductParse } from "@/lib/schema";

interface OFFProduct {
  product_name?: string;
  ingredients_text?: string;
  ingredients_tags?: string[];
  allergens_tags?: string[];
  additives_tags?: string[];
  nutriments?: Record<string, number | string | undefined>;
  serving_size?: string;
  lang?: string;
}

export async function lookupBarcode(barcode: string): Promise<ProductParse | null> {
  const res = await fetch(
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,ingredients_text,ingredients_tags,allergens_tags,additives_tags,nutriments,serving_size,lang`,
    { next: { revalidate: 86400 } }
  );
  if (!res.ok) return null;
  const json = await res.json();
  if (json.status !== 1 || !json.product) return null;
  const p: OFFProduct = json.product;
  const num = (v: unknown): number | null => {
    const n = typeof v === "string" ? parseFloat(v) : (v as number);
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  };
  const nz = p.nutriments ?? {};
  // OFF uses per-100g keys like energy-kcal_100g, fat_100g, sugars_100g, salt_100g, sodium_100g...
  const g = (k: string) => num(nz[`${k}_100g`] ?? nz[k]);
  const energyKcal = g("energy-kcal") ?? (g("energy") != null ? (g("energy") as number) / 4.184 : null);
  const ingredients = (p.ingredients_text ?? "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);
  const eNumbers = (p.additives_tags ?? [])
    .map((t) => t.replace(/^.*:/, "").toUpperCase())
    .filter((t) => /^E\d/.test(t));
  const allergens = (p.allergens_tags ?? []).map((t) => t.replace(/^.*:/, ""));
  const langMap: Record<string, ProductParse["language_detected"]> = { en: "en", ar: "ar", fr: "fr", de: "de" };

  return {
    product_name: p.product_name ?? null,
    language_detected: langMap[p.lang ?? ""] ?? "other",
    raw_text_ingredients: p.ingredients_text ?? "",
    raw_text_nutrition: "",
    ingredients,
    allergens,
    additives_e_numbers: eNumbers,
    nutrition_per_100g: {
      energy_kcal: energyKcal,
      fat: g("fat"),
      saturated_fat: g("saturated-fat"),
      carbs: g("carbohydrates"),
      sugars: g("sugars"),
      fiber: g("fiber"),
      protein: g("proteins"),
      salt: g("salt"),
      sodium: g("sodium"),
      fruit_veg_nuts_pct: null,
    },
    serving_size: p.serving_size ?? null,
    confidence: 0.9,
    warnings: ["Data from Open Food Facts (barcode lookup), verify against your package."],
  };
}
