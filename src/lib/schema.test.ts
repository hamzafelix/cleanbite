import { describe, expect, it } from "vitest";
import { ProductParseSchema } from "./schema";

describe("ProductParseSchema loose coercion", () => {
  it("accepts unit-suffixed + comma-decimal strings", () => {
    const r = ProductParseSchema.safeParse({
      nutrition_per_100g: {
        energy_kcal: "42 kcal",
        sugars: "10,6 g",
        salt: "0.02g",
        fiber: "n/a",
        protein: "",
      },
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.nutrition_per_100g.energy_kcal).toBe(42);
      expect(r.data.nutrition_per_100g.sugars).toBe(10.6);
      expect(r.data.nutrition_per_100g.salt).toBe(0.02);
      expect(r.data.nutrition_per_100g.fiber).toBeNull();
      expect(r.data.nutrition_per_100g.protein).toBeNull();
    }
  });

  it("accepts string ingredients and clamps confidence percent", () => {
    const r = ProductParseSchema.safeParse({
      ingredients: "sugar, water; salt",
      confidence: 85,
      language_detected: "EN",
      nutrition_per_100g: {},
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ingredients).toEqual(["sugar", "water", "salt"]);
      expect(r.data.confidence).toBeCloseTo(0.85);
      expect(r.data.language_detected).toBe("en");
    }
  });

  it("tolerates missing/partial objects", () => {
    const r = ProductParseSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.ingredients).toEqual([]);
      expect(r.data.nutrition_per_100g.sugars).toBeNull();
    }
  });

  it("strips unknown nutrition keys", () => {
    const r = ProductParseSchema.safeParse({
      nutrition_per_100g: { sugars: 5, trans_fat: 2, whatever: "x" },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.nutrition_per_100g.sugars).toBe(5);
  });
});
