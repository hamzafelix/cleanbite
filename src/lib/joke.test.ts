import { describe, it, expect } from "vitest";
import { getJoke, jokeBank, type Spice } from "./jokes";

const grades = ["A", "B", "C", "D", "E", "F", "?", ""];
const spices = ["clean", "spicy"] as const;

describe("getJoke", () => {
  it("never returns empty for any grade/spice/seed", () => {
    for (const g of grades) for (const s of spices) for (let seed = 0; seed < 9; seed++) {
      expect(getJoke(50, g, s, seed), `${g}/${s}/${seed}`).not.toBe("");
    }
  });

  it("is deterministic for a given seed", () => {
    expect(getJoke(30, "D", "spicy", 3)).toBe(getJoke(30, "D", "spicy", 3));
  });

  it("cycles through the whole bank as seed increments", () => {
    const bank = jokeBank("spicy").E;
    const seen = new Set(Array.from({ length: bank.length }, (_, i) => getJoke(10, "E", "spicy", i)));
    expect(seen.size).toBe(bank.length);
  });

  it("keeps clean and spicy banks distinct", () => {
    for (const g of grades) {
      for (let seed = 0; seed < 9; seed++) {
        expect(getJoke(50, g, "clean", seed)).not.toBe(getJoke(50, g, "spicy", seed));
      }
    }
  });

  it("returns different banks per grade", () => {
    expect(getJoke(90, "A", "spicy", 0)).not.toBe(getJoke(20, "D", "spicy", 0));
  });

  it("falls back to a score-derived bucket for unknown grades", () => {
    expect(getJoke(95, "Z")).toBe(getJoke(95, "A"));
    expect(getJoke(5, "Z")).toBe(getJoke(5, "E"));
  });

  it("has no duplicate lines within a bucket", () => {
    for (const s of spices) {
      for (const [grade, lines] of Object.entries(jokeBank(s))) {
        expect(new Set(lines).size, `${s}/${grade}`).toBe(lines.length);
      }
    }
  });

  it("defaults to clean when spice is omitted", () => {
    expect(getJoke(10, "E", undefined, 0)).toBe(getJoke(10, "E", "clean", 0));
  });

  it("sample output", () => {
    const rows = grades.slice(0, 5).map((g) => `${g} | ${getJoke(50, g, "spicy", 1)}`);
    console.log(rows.join("\n"));
  });
});
