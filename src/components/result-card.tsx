"use client";
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { NUTRIENT_LABELS, getStrings } from "@/lib/i18n";
import type { ProductParse, ScoreResult } from "@/lib/schema";
import { gradeColor } from "@/lib/history";
import { getJoke, type Spice } from "@/lib/jokes";

const NUTRIENT_KEYS = ["energy_kcal", "fat", "saturated_fat", "carbs", "sugars", "fiber", "protein", "salt", "sodium"] as const;

export function ScoreDial({ score, grade }: { score: number; grade: string }) {
  const color = gradeColor(grade);
  const r = 54;
  const circ = 2 * Math.PI * r;
  const frac = score / 100;
  return (
    <div className="flex items-center gap-5">
      <svg width="140" height="140" viewBox="0 0 140 140" role="img" aria-label={`Score ${score}`}>
        <circle cx="70" cy="70" r={r} fill="none" stroke="#e5e7eb" strokeWidth="14" />
        <circle
          cx="70" cy="70" r={r} fill="none" stroke={color} strokeWidth="14"
          strokeLinecap="round" strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
        <text x="70" y="66" textAnchor="middle" fontSize="30" fontWeight="800" fill="currentColor">{score}</text>
        <text x="70" y="88" textAnchor="middle" fontSize="13" fill="#6b7280">/ 100 · {grade}</text>
      </svg>
      <div>
        <div className="text-lg font-bold" style={{ color }}>{gradeLabel(grade)}</div>
        <div className="text-sm text-gray-500 max-w-55">{gradeHint(grade)}</div>
      </div>
    </div>
  );
}

function gradeLabel(g: string) {
  return { A: "Excellent", B: "Good", C: "Average", D: "Poor", E: "Very unhealthy" }[g] ?? g;
}
function gradeHint(g: string) {
  return {
    A: "Whole-food-like profile, enjoy freely.",
    B: "Mostly fine, check sugar/salt.",
    C: "Okay occasionally, not daily.",
    D: "High in sugar, salt or additives — limit.",
    E: "Avoid or eat rarely, small portions.",
  }[g] ?? "";
}

export function ResultCard({
  locale, product, score, explanation, onEdit,
}: {
  locale: Locale; product: ProductParse; score: ScoreResult; explanation: string;
  onEdit: (p: ProductParse) => void;
}) {
  const t = getStrings(locale);
  const labels = NUTRIENT_LABELS[locale];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ProductParse>(product);
  const [spice, setSpice] = useState<Spice>("clean");
  const [jokeSeed, setJokeSeed] = useState(0);
  const joke = getJoke(score.score, score.grade, spice, jokeSeed);

  const setNut = (k: string, v: string) => {
    const n = v === "" ? null : Number(v);
    setDraft({ ...draft, nutrition_per_100g: { ...draft.nutrition_per_100g, [k]: Number.isFinite(n) ? n : null } });
  };

  return (
    <div className="space-y-5">
      <ScoreDial score={score.score} grade={score.grade} />

      {/* Score verdict — deterministic from grade + seed, so SSR and client agree. */}
      <div className="rounded-xl border p-4 border-l-4" style={{ borderLeftColor: gradeColor(score.grade) }}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold uppercase tracking-wide text-gray-500">{t.verdict}</h3>
          <div className="flex overflow-hidden rounded-lg border text-xs dark:border-zinc-700">
            {(["clean", "spicy"] as Spice[]).map((s) => (
              <button
                key={s}
                onClick={() => setSpice(s)}
                className={`px-2 py-1 font-semibold ${spice === s ? "bg-black text-white dark:bg-white dark:text-black" : "bg-white dark:bg-zinc-900"}`}
              >
                {s === "clean" ? t.clean : t.spicy}
              </button>
            ))}
          </div>
        </div>
        <p className={`text-base leading-7 ${spice === "spicy" ? "font-semibold" : ""}`}>
          {joke}
        </p>
        <button
          onClick={() => setJokeSeed((s) => s + 1)}
          className="mt-2 text-xs font-semibold underline underline-offset-2"
        >
          {t.another}
        </button>
      </div>

      <div className="rounded-xl border p-4 bg-gray-50 dark:bg-zinc-900 dark:border-zinc-800">
        <h3 className="font-semibold mb-1">{t.explanation}</h3>
        <p className="text-sm leading-6">{explanation}</p>
        {score.adjustments.length > 0 && (
          <ul className="mt-2 space-y-1 text-sm">
            {score.adjustments.map((a) => (
              <li key={a.key} className="flex justify-between gap-3">
                <span>{a.label_en}</span>
                <span className={`font-mono font-bold ${a.delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                  {a.delta > 0 ? "+" : ""}{a.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="rounded-xl border p-4 dark:border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">{t.nutrients}</h3>
          <button
            className="text-sm underline"
            onClick={() => { if (editing) onEdit(draft); setEditing(!editing); }}
          >
            {editing ? t.rescore : t.editValues}
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {NUTRIENT_KEYS.map((k) => {
            const v = (draft.nutrition_per_100g as Record<string, number | null>)[k];
            return (
              <div key={k} className="rounded-lg bg-gray-50 dark:bg-zinc-900 px-3 py-2">
                <div className="text-xs text-gray-500">{labels[k]}</div>
                {editing ? (
                  <input
                    type="number" step="any" value={v ?? ""}
                    onChange={(e) => setNut(k, e.target.value)}
                    className="w-full bg-transparent font-semibold outline-none border-b"
                  />
                ) : (
                  <div className="font-semibold">{v ?? "—"}</div>
                )}
              </div>
            );
          })}
        </div>
        {editing && (
          <textarea
            className="mt-3 w-full rounded-lg border p-2 text-sm dark:bg-zinc-900 dark:border-zinc-700"
            rows={3}
            value={draft.ingredients.join(", ")}
            onChange={(e) => setDraft({ ...draft, ingredients: e.target.value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean) })}
          />
        )}
      </div>

      {score.flags.length > 0 && (
        <div className="rounded-xl border p-4 dark:border-zinc-800">
          <h3 className="font-semibold mb-2">{t.additives}</h3>
          <div className="flex flex-wrap gap-2">
            {score.flags.map((f) => (
              <span key={f} className="text-xs rounded-full bg-red-50 text-red-700 border border-red-200 px-2.5 py-1 dark:bg-red-950 dark:text-red-300 dark:border-red-800">{f}</span>
            ))}
          </div>
        </div>
      )}

      {product.ingredients.length > 0 && !editing && (
        <div className="rounded-xl border p-4 dark:border-zinc-800">
          <h3 className="font-semibold mb-2">{t.ingredients}</h3>
          <p className="text-sm text-gray-600 dark:text-gray-300">{product.ingredients.join(", ")}</p>
        </div>
      )}
    </div>
  );
}
