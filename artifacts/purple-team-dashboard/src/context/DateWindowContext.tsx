import { createContext, useContext, useState, useMemo, ReactNode } from "react";
import { useAppData } from "./AppDataContext";
import { useTacticScores } from "./TacticScoresContext";
import data from "@/data.json";

export type DateRange = "all" | "3m" | "6m" | "9m" | "1y" | "custom";

export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all: "All time",
  "3m": "Last 3 months",
  "6m": "Last 6 months",
  "9m": "Last 9 months",
  "1y": "Last year",
  custom: "Custom",
};

const DAY = 86_400_000;

const allProceduresData: Array<{ mitreId: string; date: number | null }> =
  (data as any).allProcedures ?? [];

// Anchor time-window filters to the latest date in the dataset.
// Using Date.now() causes all relative filters to return zero results
// when the data is a historical snapshot older than the chosen window.
const DATA_LATEST_MS: number = allProceduresData.reduce(
  (max, p) => (p.date != null ? Math.max(max, p.date as number) : max),
  0
) || Date.now(); // fallback: real clock if the dataset has no dated records

type DateWindowCtx = {
  dateRange: DateRange;
  setDateRange: (r: DateRange) => void;
  customFrom: string;
  customTo: string;
  setCustomFrom: (s: string) => void;
  setCustomTo: (s: string) => void;
  fromMs: number;
  toMs: number;
  tidsInWindow: Set<string> | null;
};

const Ctx = createContext<DateWindowCtx | null>(null);

export function useDateWindow(): DateWindowCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDateWindow must be used inside DateWindowProvider");
  return c;
}

export function DateWindowProvider({ children }: { children: ReactNode }) {
  const { liveActorData } = useAppData();
  const { isTidEnabled } = useTacticScores();

  const [dateRange, setDateRange]   = useState<DateRange>("all");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");

  const { fromMs, toMs } = useMemo(() => {
    // Anchor relative windows to the dataset's latest date, not the real clock.
    // This ensures "Last 3 months" returns data even for historical snapshots.
    const ref = DATA_LATEST_MS;
    if (dateRange === "3m") return { fromMs: ref - 90  * DAY, toMs: ref };
    if (dateRange === "6m") return { fromMs: ref - 180 * DAY, toMs: ref };
    if (dateRange === "9m") return { fromMs: ref - 270 * DAY, toMs: ref };
    if (dateRange === "1y") return { fromMs: ref - 365 * DAY, toMs: ref };
    if (dateRange === "custom") return {
      fromMs: customFrom ? new Date(customFrom).getTime()           : -Infinity,
      toMs:   customTo   ? new Date(customTo).getTime() + DAY - 1  :  Infinity,
    };
    return { fromMs: -Infinity, toMs: Infinity };
  }, [dateRange, customFrom, customTo]);

  const tidsInWindow = useMemo<Set<string> | null>(() => {
    if (dateRange === "all") return null;
    const set = new Set<string>();
    const inWindow = (date: number | null) => date !== null && date >= fromMs && date <= toMs;
    for (const p of allProceduresData) {
      if (p.mitreId && isTidEnabled(p.mitreId) && inWindow(p.date)) set.add(p.mitreId);
    }
    for (const p of liveActorData?.procedures ?? []) {
      if (p.mitreId && isTidEnabled(p.mitreId) && inWindow(p.date)) set.add(p.mitreId);
    }
    return set;
  }, [dateRange, fromMs, toMs, liveActorData, isTidEnabled]);

  return (
    <Ctx.Provider value={{
      dateRange, setDateRange,
      customFrom, setCustomFrom,
      customTo,   setCustomTo,
      fromMs, toMs,
      tidsInWindow,
    }}>
      {children}
    </Ctx.Provider>
  );
}
