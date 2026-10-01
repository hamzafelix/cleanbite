import type { ProductParse, ScoreResult } from "@/lib/schema";

export interface HistoryEntry {
  id: string;
  savedAt: string;
  product: ProductParse;
  score: ScoreResult;
  explanation: string;
  favorite: boolean;
  thumbnail?: string;
}

const KEY = "cleanbite-history-v1";

export function loadHistory(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]");
  } catch {
    return [];
  }
}

export function saveEntry(e: Omit<HistoryEntry, "id" | "savedAt">): HistoryEntry[] {
  const entry: HistoryEntry = {
    ...e,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: new Date().toISOString(),
  };
  const all = [entry, ...loadHistory()].slice(0, 100);
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}

export function updateEntry(id: string, patch: Partial<HistoryEntry>): HistoryEntry[] {
  const all = loadHistory().map((e) => (e.id === id ? { ...e, ...patch } : e));
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}

export function deleteEntry(id: string): HistoryEntry[] {
  const all = loadHistory().filter((e) => e.id !== id);
  localStorage.setItem(KEY, JSON.stringify(all));
  return all;
}

export function gradeColor(grade: string): string {
  switch (grade) {
    case "A": return "#16a34a";
    case "B": return "#65a30d";
    case "C": return "#ca8a04";
    case "D": return "#ea580c";
    default: return "#dc2626";
  }
}
