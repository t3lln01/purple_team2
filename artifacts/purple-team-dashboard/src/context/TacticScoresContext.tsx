import { createContext, useContext, useState, useMemo, useCallback, useEffect, useRef, ReactNode } from "react";
import data from "@/data.json";
import { useAppData } from "@/context/AppDataContext";
import { tacticsAreEnabled } from "@/utils/tacticSelection";

// ── types ─────────────────────────────────────────────────────────────────────
export type Tactic = {
  tactic: string;
  desc: string;
  conf: string;
  integrity: string;
  avail: string;
  extent: number;
};

export type TacticField = "conf" | "integrity" | "avail" | "extent";
export type TacticOverride = { conf?: string; integrity?: string; avail?: string; extent?: number };
export type TacticOverrides = Record<string, TacticOverride>;

// ── base data (immutable) ─────────────────────────────────────────────────────
export const baseTactics: Tactic[] = (data as any).tactics;

// ── persistence ───────────────────────────────────────────────────────────────
const LS_BASE = "pt_tactic_overrides";
const LS_DISABLED = "pt_disabled_tactics";

function fromStorage(key: string): TacticOverrides {
  try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; }
}
function toStorage(key: string, o: TacticOverrides) {
  try { localStorage.setItem(key, JSON.stringify(o)); } catch {}
}
function migrate() {
  const baseKey = `${LS_BASE}:base`;
  if (!localStorage.getItem(baseKey) && localStorage.getItem(LS_BASE)) {
    localStorage.setItem(baseKey, localStorage.getItem(LS_BASE)!);
  }
}

// ── context type ──────────────────────────────────────────────────────────────
type Ctx = {
  liveTactics: Tactic[];
  overrides: TacticOverrides;
  disabledTactics: Set<string>;
  setOverride: (name: string, field: TacticField, value: string | number) => void;
  resetOverride: (name: string) => void;
  resetAll: () => void;
  getEffective: (name: string) => Tactic | undefined;
  setTacticEnabled: (name: string, enabled: boolean) => void;
  enableAllTactics: () => void;
  isTacticEnabled: (name: string) => boolean;
  areTacticsEnabled: (tactics: string | string[]) => boolean;
  isTidEnabled: (tid: string) => boolean;
};

const TacticScoresCtx = createContext<Ctx>(null!);

// ── provider ──────────────────────────────────────────────────────────────────
export function TacticScoresProvider({ children }: { children: ReactNode }) {
  const { activeMitreVersionId, activeNewImpactRows, activeNewRiskRows } = useAppData();
  const versionKey = activeMitreVersionId ?? "base";
  const lsKey = `${LS_BASE}:${versionKey}`;
  const lsKeyRef = useRef(lsKey);

  const [overrides, setOverrides] = useState<TacticOverrides>(() => {
    migrate();
    return fromStorage(`${LS_BASE}:base`);
  });
  const [disabledTactics, setDisabledTactics] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(LS_DISABLED) ?? "[]");
      const validNames = new Set(baseTactics.map(tactic => tactic.tactic));
      const next = new Set<string>(
        (Array.isArray(stored) ? stored : []).filter(name => validNames.has(name)),
      );
      if (next.size >= baseTactics.length) {
        localStorage.setItem(LS_DISABLED, "[]");
        return new Set();
      }
      return next;
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    const syncDisabledTactics = (event: StorageEvent) => {
      if (event.key !== LS_DISABLED) return;
      try {
        const stored = JSON.parse(event.newValue ?? "[]");
        const validNames = new Set(baseTactics.map(tactic => tactic.tactic));
        const next = new Set<string>(
          (Array.isArray(stored) ? stored : []).filter(name => validNames.has(name)),
        );
        setDisabledTactics(next.size >= baseTactics.length ? new Set() : next);
      } catch {
        setDisabledTactics(new Set());
      }
    };
    window.addEventListener("storage", syncDisabledTactics);
    return () => window.removeEventListener("storage", syncDisabledTactics);
  }, []);

  useEffect(() => {
    migrate();
    lsKeyRef.current = lsKey;
    setOverrides(fromStorage(lsKey));
  }, [lsKey]);

  const liveTactics = useMemo(() =>
    baseTactics.map(t => {
      const ov = overrides[t.tactic] ?? {};
      return {
        ...t,
        conf:      ov.conf      !== undefined ? ov.conf      : t.conf,
        integrity: ov.integrity !== undefined ? ov.integrity : t.integrity,
        avail:     ov.avail     !== undefined ? ov.avail     : t.avail,
        extent:    ov.extent    !== undefined ? ov.extent    : t.extent,
      };
    }),
    [overrides]
  );

  const getEffective = useCallback((name: string) =>
    liveTactics.find(t => t.tactic === name),
    [liveTactics]
  );

  const persistDisabled = useCallback((next: Set<string>) => {
    try { localStorage.setItem(LS_DISABLED, JSON.stringify([...next].sort())); } catch {}
  }, []);

  const setTacticEnabled = useCallback((name: string, enabled: boolean) => {
    setDisabledTactics(previous => {
      const next = new Set(previous);
      if (enabled) next.delete(name);
      else if (previous.size < baseTactics.length - 1) next.add(name);
      persistDisabled(next);
      return next;
    });
  }, [persistDisabled]);

  const enableAllTactics = useCallback(() => {
    const next = new Set<string>();
    setDisabledTactics(next);
    persistDisabled(next);
  }, [persistDisabled]);

  useEffect(() => {
    if (disabledTactics.size >= baseTactics.length) enableAllTactics();
  }, [disabledTactics, enableAllTactics]);

  const isTacticEnabled = useCallback(
    (name: string) => !disabledTactics.has(name.trim()),
    [disabledTactics],
  );

  const areTacticsEnabled = useCallback((tactics: string | string[]) => {
    return tacticsAreEnabled(tactics, disabledTactics);
  }, [disabledTactics]);

  const tacticMap = useMemo(() => {
    const result: Record<string, string[]> = Object.fromEntries(
      Object.entries((data as any).techTacticMap ?? {}).map(([tid, tactics]) => [
        tid.toUpperCase(),
        Array.isArray(tactics) ? tactics as string[] : [],
      ]),
    );
    for (const row of [...activeNewImpactRows, ...activeNewRiskRows] as Array<{ id?: string; TID?: string; tactics?: string; Tactic?: string }>) {
      const tid = row.id ?? row.TID;
      if (!tid) continue;
      result[tid.toUpperCase()] = (row.tactics ?? row.Tactic ?? "")
        .split(",")
        .map(name => name.trim())
        .filter(Boolean);
    }
    return result;
  }, [activeNewImpactRows, activeNewRiskRows]);

  const isTidEnabled = useCallback(
    (tid: string) => areTacticsEnabled(tacticMap[tid.trim().toUpperCase()] ?? []),
    [areTacticsEnabled, tacticMap],
  );

  const setOverride = useCallback((name: string, field: TacticField, value: string | number) => {
    setOverrides(prev => {
      const next = { ...prev, [name]: { ...(prev[name] ?? {}), [field]: value } };
      toStorage(lsKeyRef.current, next);
      return next;
    });
  }, []);

  const resetOverride = useCallback((name: string) => {
    setOverrides(prev => {
      const next = { ...prev };
      delete next[name];
      toStorage(lsKeyRef.current, next);
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    setOverrides({});
    toStorage(lsKeyRef.current, {});
  }, []);

  return (
    <TacticScoresCtx.Provider value={{
      liveTactics,
      overrides,
      disabledTactics,
      setOverride,
      resetOverride,
      resetAll,
      getEffective,
      setTacticEnabled,
      enableAllTactics,
      isTacticEnabled,
      areTacticsEnabled,
      isTidEnabled,
    }}>
      {children}
    </TacticScoresCtx.Provider>
  );
}

export function useTacticScores() {
  return useContext(TacticScoresCtx);
}
