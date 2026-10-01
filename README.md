# CleanBite 🍎

Scan a food label with your camera and get an instant health score — **0–100 with an A–E grade**, plus ingredient analysis, additive risk flags, and allergen detection.

CleanBite reads photos of product labels (ingredients list + nutrition table) using a vision LLM, normalizes everything to **per 100g**, then scores the product with a **Nutri-Score 2023** implementation enhanced with NOVA processing-group estimation and additive-risk penalties.

Built with **Next.js 16 + TypeScript + Tailwind CSS 4**.

## ✨ Features

- **📷 Vision OCR** — snap up to 4 photos (ingredients + nutrition panel); a vision model extracts ingredients, nutrients, E-numbers, allergens, and language. Auto-retries per-photo with merged results if a multi-photo request fails.
- **🔢 Nutri-Score 2023 scoring** — official point tables for energy, sugars, saturated fat, sodium (negative) and fiber, protein, fruit/veg/nuts (positive), mapped to a 0–100 score and A–E grade.
- **🧪 Additive & processing penalties**
  - High-risk E-numbers (nitrites, aspartame, azo dyes, sulfites): **−8 each** (cap −24)
  - Other additives: **−2 to −3 each** (cap −12)
  - Ultra-processed (NOVA 4) markers: **−12**
  - Trans fats: **−10**
  - Sugary drinks: **−8 to −35** depending on sugar per 100ml
- **🌍 Barcode fast-path** — enter a barcode and CleanBite pulls the product from **Open Food Facts** instantly, no photo needed. Photos + barcode also enrich OCR results.
- **🌐 Multilingual** — UI and score explanations in English, Arabic (RTL), French, German. Labels in those languages are translated by the vision model.
- **💾 Local history** — past scans saved in your browser.

## 🚀 Getting Started

```bash
npm install
npm run dev          # http://localhost:3000
```

### Configuration

Copy `.env.example` to `.env.local` and set your key:

```bash
CMD_API_KEY=your_command_code_key
# optional overrides:
# CMD_MODEL=deepseek/deepseek-v4-flash-vision-exp
# CMD_BASE_URL=https://api.commandcode.ai/provider/v1
# CMD_MAX_TOKENS=16000
```

> ⚠️ The API key needs a **GOAT plan or higher** on Command Code (the Go plan has no API access). The model must support image input (`image_url`). Alternatives: `Qwen/Qwen3.8-Omni-Flash`, `google/gemini-3.8-flash`.

**No key configured?** The app runs in demo mode — you can try the sample products (cola, whole oats) without any API calls.

## 📡 API

### `POST /api/parse`

```json
{
  "images": ["data:image/jpeg;base64,..."],
  "mimeTypes": ["image/jpeg"],
  "barcode": "7622210510751",
  "localeHint": "en",
  "debug": false
}
```

Up to 4 images (data URLs), an optional barcode, and a locale hint (`en | ar | fr | de`). Set `debug: true` to include raw OCR responses.

**Response (vision path):**

```json
{
  "source": "vision",
  "provider": "commandcode",
  "product": {
    "product_name": "...",
    "language_detected": "en",
    "ingredients": ["..."],
    "allergens": ["..."],
    "additives_e_numbers": ["E250"],
    "nutrition_per_100g": { "energy_kcal": 42, "sugars": 10.6 },
    "confidence": 0.92,
    "warnings": ["..."]
  },
  "score": {
    "score": 42,
    "grade": "C",
    "nova_group": 4,
    "adjustments": [{ "key": "high_risk_additives", "delta": -8, "label_en": "..." }],
    "flags": ["ultra-processed (NOVA 4)"],
    "breakdown": { "n_points": 12, "p_points": 3 }
  },
  "explanation": "Score 42/100 (grade C). Key factors: ..."
}
```

**Response (barcode-only path):** same shape, `source: "openfoodfacts"`.

**Errors:** `400` invalid request, `404` barcode not found, `501` demo mode (no key), `502` vision parse failed.

## 🧮 How scoring works

1. **Nutri-Score points** — negative points (N) from energy, sugars, saturated fat, sodium; positive points (P) from fiber, protein, fruit/veg/nuts. (Official rule: protein doesn't count when N ≥ 11 unless fruit points = 5.)
2. **Base score** — raw N−P mapped from −15…40 → 100…0.
3. **Adjustments** — additive penalties, NOVA 4, trans fats, sugary drinks, WHO excess-sugar/salt/sat-fat caps; bonuses for high fiber and short whole-food ingredient lists.
4. **Final** — clamped to 0–100 and graded: **A ≥ 80, B ≥ 60, C ≥ 40, D ≥ 20, E < 20**.

The engine is deterministic — no extra LLM call for the score — and unit-tested (`src/lib/score.test.ts`).

## 🗂 Project Structure

```
src/
├── app/
│   ├── api/parse/route.ts    # main endpoint: OCR → enrich → score
│   ├── api/score/route.ts    # score-only endpoint
│   ├── page.tsx / layout.tsx
├── components/
│   ├── scanner-app.tsx         # camera/upload UI, history, demo samples
│   └── result-card.tsx         # score display
└── lib/
    ├── ai-vision.ts            # vision LLM client (combined + per-photo fallback)
    ├── score.ts                # Nutri-Score 2023 + NOVA + additive rules
    ├── schema.ts               # Zod schemas (tolerant of LLM output quirks)
    ├── openfoodfacts.ts        # barcode lookup
    ├── i18n.ts                 # en / ar / fr / de strings
    ├── history.ts              # localStorage scan history
    └── jokes.ts                # yes, really
```

## 📄 License

Private — all rights reserved.
