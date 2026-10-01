"use client";
import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n";
import { LOCALES, RTL_LOCALES, getStrings } from "@/lib/i18n";
import type { ProductParse, ScoreResult } from "@/lib/schema";
import { ResultCard } from "@/components/result-card";
import { deleteEntry, gradeColor, loadHistory, saveEntry, updateEntry, type HistoryEntry } from "@/lib/history";
import { Camera, History, ScanLine, Star, Trash2, Upload, X } from "lucide-react";

type Phase = "scan" | "loading" | "result" | "history";

const SAMPLES: Record<string, ProductParse> = {
  cola: {
    product_name: "Cola (sample)", language_detected: "en",
    raw_text_ingredients: "", raw_text_nutrition: "",
    ingredients: ["carbonated water", "sugar", "caramel color", "phosphoric acid", "caffeine"],
    allergens: [], additives_e_numbers: ["E150d", "E338"],
    nutrition_per_100g: { energy_kcal: 42, fat: 0, saturated_fat: 0, carbs: 10.6, sugars: 10.6, fiber: 0, protein: 0, salt: 0.02, sodium: null, fruit_veg_nuts_pct: null },
    serving_size: "330ml", confidence: 1, warnings: ["Sample data"],
  },
  oats: {
    product_name: "Whole Oats (sample)", language_detected: "en",
    raw_text_ingredients: "", raw_text_nutrition: "",
    ingredients: ["whole grain oats"],
    allergens: ["gluten"], additives_e_numbers: [],
    nutrition_per_100g: { energy_kcal: 389, fat: 6.9, saturated_fat: 1.2, carbs: 66, sugars: 0.9, fiber: 10.6, protein: 16.9, salt: 0.01, sodium: null, fruit_veg_nuts_pct: null },
    serving_size: "100g", confidence: 1, warnings: ["Sample data"],
  },
};

function fileToDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(f);
  });
}

/** Downscale to max 1568px, JPEG q0.82 — keeps multi-photo payloads small. */
function compressImage(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const MAX = 1568;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < 900_000) return resolve(dataUrl);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export default function ScannerApp() {
  const [locale, setLocale] = useState<Locale>("en");
  const [phase, setPhase] = useState<Phase>("scan");
  const [photos, setPhotos] = useState<string[]>([]);
  const [barcode, setBarcode] = useState("");
  const [error, setError] = useState("");
  const [demoMode, setDemoMode] = useState(false);
  const [product, setProduct] = useState<ProductParse | null>(null);
  const [score, setScore] = useState<ScoreResult | null>(null);
  const [explanation, setExplanation] = useState("");
  // Starts empty on both server and client so the first render matches, then
  // fills in from localStorage after hydration. Reading localStorage in a
  // useState initializer would make the client render a different history
  // count than the server-rendered HTML.
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [ocrDebug, setOcrDebug] = useState<string>("");

  const t = getStrings(locale);
  const rtl = RTL_LOCALES.includes(locale);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = rtl ? "rtl" : "ltr";
  }, [locale, rtl]);

  // Read persisted history only after hydration, so SSR and first client render agree.
  useEffect(() => {
    setHistory(loadHistory());
    setHistoryLoaded(true);
  }, []);

  // Keep multiple tabs in sync.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === "cleanbite-history-v1") setHistory(loadHistory());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    const urls: string[] = [];
    for (const f of Array.from(files).slice(0, 4 - photos.length)) {
      urls.push(await compressImage(await fileToDataUrl(f)));
    }
    setPhotos((p) => [...p, ...urls].slice(0, 4));
  };

  const analyze = async (sampleKey?: string) => {
    setError(""); setDemoMode(false); setOcrDebug("");
    let body: Record<string, unknown>;
    if (sampleKey) {
      body = { sample: sampleKey, locale };
    } else {
      if (photos.length === 0 && !barcode.trim()) { setError(t.needPhoto); return; }
      body = { images: photos, localeHint: locale, barcode: barcode.trim() || undefined, debug: true };
    }
    setPhase("loading");
    try {
      let data: { product: ProductParse; score: ScoreResult; explanation: string; debug?: unknown };
      if (sampleKey) {
        // local rescore of built-in sample (no network)
        const r = await fetch("/api/score", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product: SAMPLES[sampleKey], locale }),
        });
        data = await r.json();
        data.product = SAMPLES[sampleKey];
      } else {
        const r = await fetch("/api/parse", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        data = await r.json();
        if (data?.debug) {
          setOcrDebug(JSON.stringify(data.debug, null, 2));
          console.log("[cleanbite][ocr-debug]", data.debug);
        }
        if (!r.ok) {
          if (data && (data as { error?: string }).error === "DEMO_MODE") {
            setDemoMode(true);
            setProduct(SAMPLES.cola);
            const s = await (await fetch("/api/score", {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ product: SAMPLES.cola, locale }),
            })).json();
            setScore(s.score); setExplanation(s.explanation);
            setPhase("result");
            return;
          }
          throw new Error((data as { message?: string; error?: string }).message ?? (data as { error?: string }).error ?? "Failed");
        }
      }
      setProduct(data.product); setScore(data.score); setExplanation(data.explanation);
      if ((data.product.confidence ?? 1) < 0.5) setError(t.lowConfidence);
      setPhase("result");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
      setPhase("scan");
    }
  };

  const rescoreEdited = async (p: ProductParse) => {
    const r = await fetch("/api/score", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product: p, locale }),
    });
    const data = await r.json();
    setProduct(p); setScore(data.score); setExplanation(data.explanation);
  };

  const doSave = () => {
    if (!product || !score) return;
    setHistory(saveEntry({ product, score, explanation, favorite: false, thumbnail: photos[0] }));
    setSavedTick(true);
    setTimeout(() => setSavedTick(false), 2000);
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-6">
      {/* header */}
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">🥗 {t.appName}</h1>
          <p className="text-sm text-gray-500">{t.tagline}</p>
        </div>
        <select
          value={locale} onChange={(e) => setLocale(e.target.value as Locale)}
          className="rounded-lg border px-2 py-1.5 text-sm dark:bg-zinc-900 dark:border-zinc-700"
          aria-label={t.language}
        >
          {LOCALES.map((l) => <option key={l} value={l}>{l.toUpperCase()}</option>)}
        </select>
      </header>

      {/* tabs */}
      <nav className="mt-4 grid grid-cols-2 gap-2">
        <button onClick={() => setPhase("scan")}
          className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold ${phase !== "history" ? "bg-black text-white dark:bg-white dark:text-black" : "bg-white dark:bg-zinc-900 dark:border-zinc-800"}`}>
          <ScanLine size={16} /> {t.scan}
        </button>
        <button onClick={() => { setHistory(loadHistory()); setPhase("history"); }}
          className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold ${phase === "history" ? "bg-black text-white dark:bg-white dark:text-black" : "bg-white dark:bg-zinc-900 dark:border-zinc-800"}`}>
          <History size={16} /> {t.history}
          {/* Count is only rendered once localStorage has been read, avoiding a
              stale 0 and keeping SSR/first-client markup identical. */}
          {historyLoaded && <> ({history.length})</>}
        </button>
      </nav>

      {phase === "scan" && (
        <section className="mt-5 space-y-4">
          <div className="rounded-2xl border p-4 dark:border-zinc-800">
            <h2 className="font-semibold mb-3">{t.addPhotos}</h2>
            {photos.length > 0 && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                {photos.map((p, i) => (
                  <div key={i} className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p} alt={`label ${i + 1}`} className="h-36 w-full rounded-xl object-cover border" />
                    <button onClick={() => setPhotos(photos.filter((_, j) => j !== i))}
                      className="absolute top-1 end-1 rounded-full bg-black/60 p-1 text-white" aria-label="remove">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-xl bg-black px-4 py-2.5 text-sm font-semibold text-white dark:bg-white dark:text-black">
                <Camera size={16} /> {t.takePhoto}
                <input type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
              </label>
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold">
                <Upload size={16} /> {t.upload}
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
              </label>
            </div>
          </div>

          <div className="rounded-2xl border p-4 dark:border-zinc-800">
            <label className="text-sm font-semibold">{t.barcode}</label>
            <input
              value={barcode} onChange={(e) => setBarcode(e.target.value)}
              placeholder={t.barcodePlaceholder} inputMode="numeric"
              className="mt-1 w-full rounded-xl border px-3 py-2.5 text-sm dark:bg-zinc-900 dark:border-zinc-700"
            />
          </div>

          {error && <p className="rounded-xl bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300 dark:border-red-800">{error}</p>}

          <button onClick={() => analyze()}
            className="w-full rounded-2xl bg-green-600 px-4 py-3.5 font-bold text-white hover:bg-green-700 disabled:opacity-50">
            {t.analyze}
          </button>

          <div className="rounded-2xl border border-dashed p-4 text-sm dark:border-zinc-700">
            <span className="text-gray-500">{t.trySample} </span>
            <button className="underline font-semibold" onClick={() => analyze("cola")}>{t.cola}</button>
            {" · "}
            <button className="underline font-semibold" onClick={() => analyze("oats")}>{t.oats}</button>
          </div>
        </section>
      )}

      {phase === "loading" && (
        <section className="mt-10 flex flex-col items-center gap-3 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-gray-200 border-t-green-600" />
          <p className="text-sm text-gray-500">{t.analyzing}</p>
        </section>
      )}

      {phase === "result" && product && score && (
        <section className="mt-5 space-y-4">
          {demoMode && (
            <p className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800">{t.demoMode}</p>
          )}
          {product.product_name && <h2 className="text-xl font-bold">{product.product_name}</h2>}
          <ResultCard locale={locale} product={product} score={score} explanation={explanation} onEdit={rescoreEdited} />
          {ocrDebug && (
            <details className="rounded-xl border p-3 text-xs dark:border-zinc-800">
              <summary className="cursor-pointer font-semibold">OCR debug log</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">{ocrDebug}</pre>
            </details>
          )}
          <div className="flex gap-2">
            <button onClick={doSave} className="flex-1 rounded-2xl bg-black px-4 py-3 font-bold text-white dark:bg-white dark:text-black">
              {savedTick ? t.saved : t.save}
            </button>
            <button onClick={() => { setPhotos([]); setBarcode(""); setPhase("scan"); }}
              className="flex-1 rounded-2xl border px-4 py-3 font-bold">
              {t.newScan}
            </button>
          </div>
        </section>
      )}

      {phase === "history" && (
        <section className="mt-5 space-y-3">
          {history.length === 0 && <p className="text-center text-sm text-gray-500 py-10">{t.emptyHistory}</p>}
          {history.map((h) => (
            <div key={h.id} className="rounded-2xl border p-3 flex items-center gap-3 dark:border-zinc-800">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl font-extrabold text-white" style={{ background: gradeColor(h.score.grade) }}>
                {h.score.score}
              </div>
              <button
                className="flex-1 text-start"
                onClick={() => { setProduct(h.product); setScore(h.score); setExplanation(h.explanation); setPhase("result"); }}
              >
                <div className="font-semibold text-sm line-clamp-1">{h.product.product_name ?? h.product.ingredients.slice(0, 3).join(", ") ?? "—"}</div>
                <div className="text-xs text-gray-500">{new Date(h.savedAt).toLocaleString()} · {h.score.grade}</div>
              </button>
              <button onClick={() => setHistory(updateEntry(h.id, { favorite: !h.favorite }))} aria-label={t.favorite}>
                <Star size={18} className={h.favorite ? "fill-amber-400 text-amber-400" : "text-gray-400"} />
              </button>
              <button onClick={() => setHistory(deleteEntry(h.id))} aria-label={t.delete}>
                <Trash2 size={18} className="text-gray-400" />
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
