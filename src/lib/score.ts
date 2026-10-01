import type { NutritionPer100g, ProductParse, ScoreResult } from "./schema";

// ---------- Nutri-Score 2023 (general foods) point tables ----------

function energyPoints(kcal: number | null): number {
  if (kcal == null) return 0;
  const kj = kcal * 4.184;
  const t = [335, 670, 1005, 1340, 1675, 2010, 2345, 2680, 3015, 3350];
  let pts = 0;
  for (const th of t) if (kj > th) pts++;
  return Math.min(pts, 10);
}

function sugarsPoints(g: number | null): number {
  if (g == null) return 0;
  const t = [3.4, 6.8, 10.2, 13.6, 17, 20.4, 23.8, 27.2, 30.6, 34];
  let pts = 0;
  for (const th of t) if (g > th) pts++;
  return Math.min(pts, 10);
}

function satFatPoints(g: number | null): number {
  if (g == null) return 0;
  const t = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  let pts = 0;
  for (const th of t) if (g > th) pts++;
  return Math.min(pts, 10);
}

function sodiumPoints(n: NutritionPer100g): number {
  // prefer explicit sodium (g) else derive from salt (g): sodium_mg = salt_g * 400
  let mg: number | null = null;
  if (n.sodium != null) mg = n.sodium * 1000;
  else if (n.salt != null) mg = n.salt * 400;
  if (mg == null) return 0;
  const t = [90, 180, 270, 360, 450, 540, 630, 720, 810, 900];
  let pts = 0;
  for (const th of t) if (mg > th) pts++;
  return Math.min(pts, 10);
}

function fiberPoints(g: number | null): number {
  if (g == null) return 0;
  const t = [0.7, 1.4, 2.1, 2.8, 3.5];
  let pts = 0;
  for (const th of t) if (g > th) pts++;
  return Math.min(pts, 5);
}

function proteinPoints(g: number | null): number {
  if (g == null) return 0;
  const t = [1.6, 3.2, 4.8, 6.4, 8.0];
  let pts = 0;
  for (const th of t) if (g > th) pts++;
  return Math.min(pts, 5);
}

function fruitPoints(pct: number | null): number {
  if (pct == null) return 0;
  if (pct > 80) return 5;
  if (pct > 60) return 2;
  if (pct > 40) return 1;
  return 0;
}

// ---------- additive / ultra-processing knowledge ----------

const HIGH_RISK_E = new Set([
  "E249",
  "E250",
  "E251",
  "E252", // nitrites / nitrates
  "E951", // aspartame
  "E950", // acesulfame K
  "E955", // sucralose
  "E102",
  "E110",
  "E122",
  "E124",
  "E129", // azo dyes
  "E220",
  "E221",
  "E222",
  "E223",
  "E224", // sulfites (allergen-ish)
]);

const MEDIUM_RISK_E = new Set([
  "E621", // MSG
  "E627",
  "E631",
  "E320",
  "E321", // BHA/BHT
  "E211", // sodium benzoate
  "E200",
  "E202",
  "E330", // citric acid is fine normally — keep low weight
]);

const ULTRA_MARKERS = [
  "glucose syrup",
  "glucose-fructose",
  "glucose fructose",
  "fructose syrup",
  "corn syrup",
  "maltodextrin",
  "dextrin",
  "hydrogenated",
  "trans fat",
  "trans-fat",
  "hydrolyzed",
  "hydrolysed",
  "modified starch",
  "modified maize starch",
  "isolated protein",
  "protein isolate",
  "invert sugar",
];

const TRANS_FAT_MARKERS = ["hydrogenated", "trans fat", "trans-fat", "partially hydrogenated"];

const BEVERAGE_MARKERS = [
  "water",
  "carbonated",
  "sparkling",
  "drink",
  "beverage",
  "soda",
  "cola",
  "juice",
  "nectar",
  "lemonade",
  "iced tea",
  "energy drink",
];

const ADDED_SUGAR_MARKERS = [
  "sugar",
  "sucrose",
  "glucose",
  "fructose",
  "syrup",
  "maltodextrin",
  "dextrose",
  "honey",
  "caramel",
  "aspartame",
  "acesulfame",
  "sucralose",
  "saccharin",
  "stevia",
  "sweetener",
];

function isBeverage(ingredients: string[]): boolean {
  const joined = " " + ingredients.map(norm).join(" ") + " ";
  return BEVERAGE_MARKERS.some((m) => joined.includes(m));
}

function hasAddedSugar(ingredients: string[], eNumbers: string[]): boolean {
  const joined = " " + ingredients.map(norm).join(" ") + " ";
  if (ADDED_SUGAR_MARKERS.some((m) => joined.includes(m))) return true;
  return eNumbers.some((e) => ["E951", "E950", "E955", "E954", "E960"].includes(e));
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeENumbers(list: string[]): string[] {
  return list
    .map((e) => e.toUpperCase().replace(/\s+/g, "").replace(/^E0*(\d)/, "E$1"))
    .filter((e) => /^E\d{3,4}[A-Z]?$/.test(e));
}

function detectUltraMarkers(ingredients: string[]): string[] {
  const joined = " " + ingredients.map(norm).join(" | ") + " ";
  const hits: string[] = [];
  for (const m of ULTRA_MARKERS) {
    if (joined.includes(m)) hits.push(m);
  }
  // also count E-numbers as ultra markers when many
  return hits;
}

function estimateNova(
  ingredients: string[],
  eNumbers: string[],
  ultraHits: string[]
): 1 | 2 | 3 | 4 {
  const n = ingredients.length;
  if (n === 0) return 3; // unknown -> middle
  if (ultraHits.length >= 1 && TRANS_FAT_MARKERS.some((m) => ultraHits.includes(m)))
    return 4;
  if (ultraHits.length >= 2) return 4;
  if (eNumbers.length >= 3) return 4;
  if (ultraHits.length >= 1 && eNumbers.length >= 1) return 4;
  if (eNumbers.length >= 1 || ultraHits.length >= 1) return 3;
  if (n <= 5) return 1;
  return 2;
}

export function gradeForScore(score: number): "A" | "B" | "C" | "D" | "E" {
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  if (score >= 20) return "D";
  return "E";
}

export interface ScoreInput {
  nutrition: NutritionPer100g;
  ingredients?: string[];
  additives_e_numbers?: string[];
}

export function calculateScore(input: ProductParse | ScoreInput): ScoreResult {
  const nutrition = "nutrition_per_100g" in input ? input.nutrition_per_100g : input.nutrition;
  const ingredients = ("ingredients" in input ? input.ingredients : input.ingredients) ?? [];
  const rawE = ("additives_e_numbers" in input ? input.additives_e_numbers : input.additives_e_numbers) ?? [];
  const eNumbers = normalizeENumbers(rawE);

  const n = nutrition ?? {};
  const energy_pts = energyPoints(n.energy_kcal ?? null);
  const sugars_pts = sugarsPoints(n.sugars ?? null);
  const satfat_pts = satFatPoints(n.saturated_fat ?? null);
  const sodium_pts = sodiumPoints(n);

  const fiber_pts = fiberPoints(n.fiber ?? null);
  let protein_pts = proteinPoints(n.protein ?? null);
  const fruit_pts = fruitPoints(n.fruit_veg_nuts_pct ?? null);

  const N = energy_pts + sugars_pts + satfat_pts + sodium_pts;

  // Official rule: protein excluded when N >= 11 unless fruit == 5
  let proteinCounted = true;
  if (N >= 11 && fruit_pts < 5) {
    protein_pts = 0;
    proteinCounted = false;
  }
  const P = fiber_pts + protein_pts + fruit_pts;
  const nutriScoreRaw = N - P;

  // Map -15..40 -> 100..0
  const baseScore = Math.round(100 - ((nutriScoreRaw + 15) / 55) * 100);

  const adjustments: ScoreResult["adjustments"] = [];
  const flags: string[] = [];

  const ultraHits = detectUltraMarkers(ingredients);
  const nova_group = estimateNova(ingredients, eNumbers, ultraHits);

  // --- high-risk additives: -8 each, cap -24 ---
  let highRiskCount = 0;
  for (const e of eNumbers) {
    if (HIGH_RISK_E.has(e)) {
      highRiskCount++;
      flags.push(`${e} (high-risk additive)`);
    }
  }
  if (highRiskCount > 0) {
    const delta = -Math.min(highRiskCount * 8, 24);
    adjustments.push({ key: "high_risk_additives", delta, label_en: `${highRiskCount} high-risk additive(s): ${eNumbers.filter((e) => HIGH_RISK_E.has(e)).join(", ")}` });
  }

  // --- other additives: -3 each (medium -2), cap -12 ---
  const otherE = eNumbers.filter((e) => !HIGH_RISK_E.has(e));
  if (otherE.length > 0) {
    let penalty = 0;
    for (const e of otherE) penalty += MEDIUM_RISK_E.has(e) ? 2 : 3;
    penalty = Math.min(penalty, 12);
    adjustments.push({ key: "other_additives", delta: -penalty, label_en: `${otherE.length} other additive(s): ${otherE.join(", ")}` });
    for (const e of otherE) flags.push(`${e} (additive)`);
  }

  // --- trans fat ---
  const joinedIng = ingredients.map(norm).join(" ");
  if (TRANS_FAT_MARKERS.some((m) => joinedIng.includes(m))) {
    adjustments.push({ key: "trans_fat", delta: -10, label_en: "Contains hydrogenated / trans fat" });
    flags.push("trans-fat");
  }

  // --- sugary beverage: sugary drinks score poorly even at low per-100g
  // (a can of cola has ~35g sugar despite "only" 10.6g/100ml)
  const beverage = isBeverage(ingredients);
  const sugars = n.sugars ?? 0;
  if (beverage && hasAddedSugar(ingredients, eNumbers)) {
    if (sugars >= 8) {
      adjustments.push({ key: "sugary_drink", delta: -35, label_en: `Sugary drink (${sugars}g sugar/100ml, ~${Math.round(sugars * 3.3)}g per can)` });
      flags.push("sugary-drink");
    } else if (sugars >= 4) {
      adjustments.push({ key: "sweet_drink", delta: -15, label_en: `Sweetened drink (${sugars}g sugar/100ml)` });
      flags.push("sweetened-drink");
    } else if (sugars > 0) {
      adjustments.push({ key: "sweet_drink_light", delta: -8, label_en: `Sweetened drink (${sugars}g sugar/100ml)` });
      flags.push("sweetened-drink");
    } else {
      // diet soda: no sugar but sweeteners + acids + caramel color
      adjustments.push({ key: "diet_drink", delta: -15, label_en: "Diet soda (sweeteners, acids, colors)" });
      flags.push("diet-drink");
    }
  }

  // --- ultra-processed NOVA 4 ---
  if (nova_group === 4) {
    adjustments.push({ key: "ultra_processed", delta: -12, label_en: `Ultra-processed (NOVA 4${ultraHits.length ? `: ${ultraHits.slice(0, 3).join(", ")}` : ""})` });
    flags.push("ultra-processed (NOVA 4)");
  }

  // --- WHO caps ---
  if ((n.sugars ?? 0) > 22.5) {
    adjustments.push({ key: "excess_sugar", delta: -8, label_en: `Very high sugar (${n.sugars}g/100g)` });
    flags.push("very-high-sugar");
  }
  const saltG = n.salt ?? (n.sodium != null ? n.sodium * 2.5 : null);
  if ((saltG ?? 0) > 1.5) {
    adjustments.push({ key: "excess_salt", delta: -8, label_en: `Very high salt (${saltG}g/100g)` });
    flags.push("very-high-salt");
  }
  if ((n.saturated_fat ?? 0) > 5) {
    adjustments.push({ key: "excess_satfat", delta: -5, label_en: `High saturated fat (${n.saturated_fat}g/100g)` });
    flags.push("high-sat-fat");
  }

  // --- bonuses ---
  if ((n.fiber ?? 0) >= 6) {
    adjustments.push({ key: "high_fiber_bonus", delta: 5, label_en: "High fiber (≥6g/100g)" });
  }
  if (ingredients.length > 0 && ingredients.length <= 5 && nova_group <= 2 && eNumbers.length === 0 && !(beverage && hasAddedSugar(ingredients, eNumbers))) {
    adjustments.push({ key: "short_list_bonus", delta: 5, label_en: "Short, whole-food ingredient list" });
  }

  // missing data warning (not a penalty, but flag)
  const missingCount = [n.energy_kcal, n.fat, n.sugars, n.salt ?? n.sodium, n.protein].filter(
    (v) => v == null
  ).length;
  if (missingCount >= 3) flags.push("incomplete-nutrition-data");

  let score = baseScore + adjustments.reduce((s, a) => s + a.delta, 0);
  score = Math.max(0, Math.min(100, Math.round(score)));

  return {
    score,
    grade: gradeForScore(score),
    nutriScoreRaw,
    baseScore: Math.max(0, Math.min(100, baseScore)),
    adjustments,
    flags,
    nova_group,
    breakdown: {
      n_points: N,
      p_points: P,
      energy_pts,
      sugars_pts,
      satfat_pts,
      sodium_pts,
      fiber_pts,
      protein_pts: proteinCounted ? protein_pts : 0,
      fruit_pts,
    },
  };
}
