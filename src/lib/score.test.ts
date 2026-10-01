import { describe, expect, it } from "vitest";
import { calculateScore } from "./score";

describe("calculateScore", () => {
  it("scores Coca-Cola style soda very low", () => {
    const r = calculateScore({
      nutrition: {
        energy_kcal: 42, fat: 0, saturated_fat: 0, carbs: 10.6, sugars: 10.6,
        fiber: 0, protein: 0, salt: 0.02, sodium: null, fruit_veg_nuts_pct: null,
      },
      ingredients: ["carbonated water", "sugar", "caramel color E150d", "phosphoric acid", "caffeine"],
      additives_e_numbers: ["E150d", "E338"],
    });
    expect(r.score).toBeLessThan(30);
    expect(["D", "E"]).toContain(r.grade);
  });

  it("scores plain oats / lentils style whole food high", () => {
    const r = calculateScore({
      nutrition: {
        energy_kcal: 350, fat: 2, saturated_fat: 0.4, carbs: 60, sugars: 1,
        fiber: 10, protein: 13, salt: 0.01, sodium: null, fruit_veg_nuts_pct: null,
      },
      ingredients: ["whole grain oats"],
      additives_e_numbers: [],
    });
    expect(r.score).toBeGreaterThan(75);
    expect(["A", "B"]).toContain(r.grade);
  });

  it("penalizes nitrite ham", () => {
    const base = calculateScore({
      nutrition: {
        energy_kcal: 120, fat: 4, saturated_fat: 1.5, carbs: 1, sugars: 1,
        fiber: 0, protein: 18, salt: 2.0, sodium: null, fruit_veg_nuts_pct: null,
      },
      ingredients: ["pork", "salt", "sodium nitrite", "ascorbic acid"],
      additives_e_numbers: ["E250"],
    });
    const clean = calculateScore({
      nutrition: {
        energy_kcal: 120, fat: 4, saturated_fat: 1.5, carbs: 1, sugars: 1,
        fiber: 0, protein: 18, salt: 2.0, sodium: null, fruit_veg_nuts_pct: null,
      },
      ingredients: ["pork", "salt"],
      additives_e_numbers: [],
    });
    expect(base.score).toBeLessThan(clean.score);
    expect(base.flags.join(" ")).toMatch(/E250/);
  });

  it("handles missing data without crashing", () => {
    const r = calculateScore({
      nutrition: {
        energy_kcal: null, fat: null, saturated_fat: null, carbs: null, sugars: null,
        fiber: null, protein: null, salt: null, sodium: null, fruit_veg_nuts_pct: null,
      },
      ingredients: [],
      additives_e_numbers: [],
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("clamps score 0..100", () => {
    const r = calculateScore({
      nutrition: {
        energy_kcal: 600, fat: 40, saturated_fat: 20, carbs: 60, sugars: 50,
        fiber: 0, protein: 0, salt: 3, sodium: null, fruit_veg_nuts_pct: null,
      },
      ingredients: ["sugar", "glucose syrup", "hydrogenated palm oil", "whey powder", "maltodextrin", "soy lecithin"],
      additives_e_numbers: ["E250", "E951", "E955", "E102", "E621", "E320"],
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.nova_group).toBe(4);
  });
});
