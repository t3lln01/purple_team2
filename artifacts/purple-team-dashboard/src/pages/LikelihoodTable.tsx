import { useState, useMemo, useCallback, Fragment } from "react";
import { useDateWindow } from "@/context/DateWindowContext";
import { Link } from "wouter";
import { useLikelihood } from "@/context/LikelihoodContext";
import { useTacticScores } from "@/context/TacticScoresContext";
import { useAppData, baseFullRiskCalc } from "@/context/AppDataContext";
import { useHVAScores } from "@/context/HVAScoresContext";
import {
  LAST_OCC_OPTIONS,
  CONFIDENCE_LIK_OPTIONS,
  calcLikelihoodScore,
  calcLikelihoodRate,
  lastOccToCategory,
} from "@/utils/impactFormulas";
import { RotateCcw, Edit3 } from "lucide-react";

// ── types ─────────────────────────────────────────────────────────────────────
type RiskRow = {
  TID: string;
  "Technique Name": string;
  Tactic: string;
  "TID  Priority": number;
  "Last Occurrence": string;
  "Last occurrence Score": number;
  Confidence: string;
  "Confidence Score": number;
  "Likelihood Score": number;
  "Likelihood Rate": string;
};

// ── base data ─────────────────────────────────────────────────────────────────
const rawRiskCalc: RiskRow[] = baseFullRiskCalc as RiskRow[];

// ── style helpers ──────────────────────────────────────────────────────────────
function rateStyle(rate: string) {
  const r = (rate || "").toLowerCase();
  if (r.includes("very high")) return "bg-red-500/10 border border-red-500/30 text-red-400";
  if (r.includes("high"))      return "bg-orange-500/10 border border-orange-500/30 text-orange-400";
  if (r.includes("medium"))    return "bg-yellow-500/10 border border-yellow-500/30 text-yellow-400";
  if (r.includes("very low"))  return "bg-blue-500/10 border border-blue-500/30 text-blue-400";
  if (r.includes("low"))       return "bg-green-500/10 border border-green-500/30 text-green-400";
  return "bg-muted/30 text-muted-foreground border border-border";
}

function rateOrder(rate: string) {
  const r = (rate || "").toLowerCase();
  if (r.includes("very high")) return 5;
  if (r.includes("high"))      return 4;
  if (r.includes("medium"))    return 3;
  if (r.includes("low") && !r.includes("very")) return 2;
  if (r.includes("very low"))  return 1;
  return 0;
}

type SortKey = "TID" | "Technique Name" | "Tactic" | "tidPriority" | "likScore" | "likRate";

type ComputedRow = RiskRow & {
  _lastOcc: string;
  _lastOccScore: number;
  _conf: string;
  _confScore: number;
  _hvaFactor: number;
  _hvaFromMatrix: boolean;
  _tidPriority: number;
  _likScore: number;
  _likRate: string;
  _hasOverride: boolean;
};

export default function LikelihoodTable() {
  const { overrides, setOverride, resetOverride, resetAll } = useLikelihood();
  const { areTacticsEnabled, isTidEnabled } = useTacticScores();
  const { activeNewRiskRows, liveActorData } = useAppData();
  const { hvaScoreMap: hvaScores } = useHVAScores();
  const { tidsInWindow } = useDateWindow();

  const [search, setSearch] = useState("");
  const [tacticFilter, setTacticFilter] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("likRate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  // Max date per TID from live procedures (for auto last-occurrence detection)
  const liveDateByTid = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of liveActorData?.procedures ?? []) {
      if (!isTidEnabled(p.mitreId)) continue;
      if (p.mitreId && p.date && p.date > (m[p.mitreId] ?? 0)) m[p.mitreId] = p.date;
    }
    return m;
  }, [liveActorData, isTidEnabled]);

  const allSourceRows = useMemo(
    () => [...rawRiskCalc, ...(activeNewRiskRows as RiskRow[])]
      .filter(row => isTidEnabled(row.TID) && areTacticsEnabled(row.Tactic ?? "")),
    [activeNewRiskRows, areTacticsEnabled, isTidEnabled]
  );

  const allTactics = useMemo(
    () => ["All", ...Array.from(new Set(allSourceRows.flatMap(r => r.Tactic?.split(", ").map(t => t.trim()) || []))).sort()],
    [allSourceRows]
  );

  const computed: ComputedRow[] = useMemo(() => allSourceRows.map(row => {
    const ov = overrides[row.TID] ?? {};
    const liveDate = liveDateByTid[row.TID];

    // Last Occurrence: explicit override → live date auto-category → base data
    const _lastOcc = ov.lastOccurrence
      ?? (liveDate ? lastOccToCategory(liveDate) : row["Last Occurrence"]);
    const _lastOccScore = LAST_OCC_OPTIONS.find(o => o.label === _lastOcc)?.score
      ?? row["Last occurrence Score"];

    // Confidence: explicit override → base data
    const _conf = ov.confidence ?? row.Confidence;
    const _confScore = CONFIDENCE_LIK_OPTIONS.find(o => o.label === _conf)?.score
      ?? row["Confidence Score"];

    const _tidPriority = row["TID  Priority"] ?? 1;

    // HVA likelihood factor: from matrix if available, else back-compute from base data
    const hvaEntry = hvaScores[row.TID];
    const baseNoHVA = _tidPriority * row["Last occurrence Score"] * row["Confidence Score"];
    const baseHVAFactor = baseNoHVA > 0 ? (row["Likelihood Score"] ?? 1) / baseNoHVA : 1;
    const _hvaFactor = hvaEntry ? hvaEntry.avgLikelihood : baseHVAFactor;
    const _hvaFromMatrix = !!hvaEntry;

    const _likScore = calcLikelihoodScore(_tidPriority, _lastOccScore, _confScore, _hvaFactor);
    const _likRate  = calcLikelihoodRate(_likScore);

    const _hasOverride = Object.keys(ov).length > 0;

    return {
      ...row,
      _lastOcc, _lastOccScore, _conf, _confScore,
      _hvaFactor, _hvaFromMatrix,
      _tidPriority, _likScore, _likRate, _hasOverride,
    };
  }), [allSourceRows, overrides, hvaScores, liveDateByTid]);

  const filtered = useMemo(() => computed.filter(r => {
    if (tidsInWindow && !tidsInWindow.has(r.TID)) return false;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      r.TID.toLowerCase().includes(q) ||
      r["Technique Name"].toLowerCase().includes(q) ||
      r.Tactic?.toLowerCase().includes(q);
    const matchTactic = tacticFilter === "All" || r.Tactic?.includes(tacticFilter);
    return matchSearch && matchTactic;
  }), [computed, search, tacticFilter, tidsInWindow]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "TID":           return dir * a.TID.localeCompare(b.TID);
        case "Technique Name":return dir * a["Technique Name"].localeCompare(b["Technique Name"]);
        case "Tactic":        return dir * (a.Tactic ?? "").localeCompare(b.Tactic ?? "");
        case "tidPriority":   return dir * (a._tidPriority - b._tidPriority);
        case "likScore":      return dir * (a._likScore - b._likScore);
        case "likRate":       return dir * (rateOrder(a._likRate) - rateOrder(b._likRate));
        default: return 0;
      }
    });
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
    setPage(0);
  }

  function SortIcon({ col }: { col: SortKey }) {
    if (sortKey !== col) return <span className="ml-1 opacity-30">↕</span>;
    return <span className="ml-1 text-primary">{sortDir === "asc" ? "↑" : "↓"}</span>;
  }

  const setField = useCallback((tid: string, key: keyof typeof overrides[string], value: string) => {
    setOverride(tid, { [key]: value });
  }, [setOverride]);

  const overrideCount = Object.keys(overrides).length;
  const vhCount = computed.filter(r => r._likRate === "Very High").length;
  const avgLik  = computed.reduce((s, r) => s + r._likScore, 0) / (computed.length || 1);
  const maxLik  = Math.max(...computed.map(r => r._likScore), 0);
  const liveDateCount = Object.keys(liveDateByTid).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Likelihood Table</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Per-technique likelihood scoring — Last Occurrence × Confidence × TID Priority × HVA Factor.
            Editable values feed into Risk Calculation.
          </p>
        </div>
        {overrideCount > 0 && (
          <button
            onClick={() => { if (confirm(`Reset all ${overrideCount} manual override(s)?`)) resetAll(); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Reset all ({overrideCount})
          </button>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-primary">{computed.length}</div>
          <div className="text-sm text-muted-foreground mt-1">Techniques</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-red-400">{vhCount}</div>
          <div className="text-sm text-muted-foreground mt-1">Very High Likelihood</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-chart-2">{avgLik.toFixed(1)}</div>
          <div className="text-sm text-muted-foreground mt-1">Avg Likelihood Score</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-chart-4">{liveDateCount > 0 ? liveDateCount : overrideCount}</div>
          <div className="text-sm text-muted-foreground mt-1">
            {liveDateCount > 0 ? "Live Date Overrides" : "Manual Overrides"}
          </div>
        </div>
      </div>

      {liveDateCount > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-primary/80">
          <span className="font-semibold">Live data active:</span> Last Occurrence for {liveDateCount} technique(s) automatically updated from pushed procedure dates.
          Manual overrides take precedence.
        </div>
      )}

      {overrideCount > 0 && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
          <Edit3 className="inline w-3 h-3 mr-1" />
          {overrideCount} technique(s) have manually edited values. These override the baseline and also affect the Risk Calculation page.
        </div>
      )}

      {/* ── scoring reference ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-4 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Occurrence Scores</div>
          {LAST_OCC_OPTIONS.map(o => (
            <div key={o.label} className="flex justify-between text-xs">
              <span className="text-foreground">{o.label}</span>
              <span className="font-mono text-chart-2 font-semibold">{o.score}</span>
            </div>
          ))}
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Confidence Scores</div>
          {CONFIDENCE_LIK_OPTIONS.map(o => (
            <div key={o.label} className="flex justify-between text-xs">
              <span className="text-foreground capitalize">{o.label}</span>
              <span className="font-mono text-chart-2 font-semibold">{o.score}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <input
            type="search"
            placeholder="Search by TID, technique, tactic…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0); }}
            className="flex-1 min-w-48 bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <select
            value={tacticFilter}
            onChange={e => { setTacticFilter(e.target.value); setPage(0); }}
            className="bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {allTactics.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{filtered.length} results</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("TID")} className="flex items-center hover:text-foreground">
                    ID <SortIcon col="TID" />
                  </button>
                </th>
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("Technique Name")} className="flex items-center hover:text-foreground">
                    Name <SortIcon col="Technique Name" />
                  </button>
                </th>
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("Tactic")} className="flex items-center hover:text-foreground">
                    Tactic <SortIcon col="Tactic" />
                  </button>
                </th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("tidPriority")} className="flex items-center hover:text-foreground mx-auto">
                    TID Priority <SortIcon col="tidPriority" />
                  </button>
                </th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium w-52">Last Occurrence</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Occ. Score</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium w-44">Confidence</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Conf. Score</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">HVA Factor</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("likScore")} className="flex items-center hover:text-foreground mx-auto">
                    Lik. Score <SortIcon col="likScore" />
                  </button>
                </th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("likRate")} className="flex items-center hover:text-foreground mx-auto">
                    Lik. Rate <SortIcon col="likRate" />
                  </button>
                </th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(row => (
                <Fragment key={row.TID}>
                  <tr className={`border-b border-border/40 hover:bg-accent/20 transition-colors ${row._hasOverride ? "bg-yellow-500/5" : ""}`}>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        {row._hasOverride && (
                          <button onClick={() => resetOverride(row.TID)} title="Reset to baseline" className="text-yellow-500 hover:text-yellow-400">
                            <RotateCcw className="w-3 h-3" />
                          </button>
                        )}
                        <Link href={`/all-procedures?mitre=${encodeURIComponent(row.TID)}`}>
                          <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded hover:bg-primary/20 transition-colors cursor-pointer">
                            {row.TID}
                          </span>
                        </Link>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-foreground max-w-[180px]">
                      <Link href={`/all-procedures?mitre=${encodeURIComponent(row.TID)}`}>
                        <div className="truncate hover:text-primary cursor-pointer transition-colors" title={row["Technique Name"]}>
                          {row["Technique Name"]}
                        </div>
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground max-w-[140px]">
                      <div className="truncate" title={row.Tactic}>{row.Tactic}</div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="font-mono text-xs font-semibold text-foreground">{row._tidPriority}</span>
                    </td>

                    {/* Last Occurrence — editable dropdown */}
                    <td className="px-3 py-2 text-center">
                      <div className="relative">
                        <select
                          value={row._lastOcc}
                          onChange={e => setField(row.TID, "lastOccurrence", e.target.value)}
                          className={`w-full bg-input border rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring appearance-none pr-5 ${
                            overrides[row.TID]?.lastOccurrence ? "border-yellow-500/50" : "border-border"
                          }`}
                        >
                          {LAST_OCC_OPTIONS.map(o => (
                            <option key={o.label} value={o.label}>{o.label}</option>
                          ))}
                        </select>
                        {liveDateByTid[row.TID] && !overrides[row.TID]?.lastOccurrence && (
                          <span className="absolute -top-1.5 -right-1.5 w-2 h-2 rounded-full bg-primary" title="Auto-set from live data" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="font-mono text-xs font-semibold text-chart-2">{row._lastOccScore.toFixed(2)}</span>
                    </td>

                    {/* Confidence — editable dropdown */}
                    <td className="px-3 py-2 text-center">
                      <select
                        value={row._conf}
                        onChange={e => setField(row.TID, "confidence", e.target.value)}
                        className={`w-full bg-input border rounded px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring appearance-none ${
                          overrides[row.TID]?.confidence ? "border-yellow-500/50" : "border-border"
                        }`}
                      >
                        {CONFIDENCE_LIK_OPTIONS.map(o => (
                          <option key={o.label} value={o.label}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="font-mono text-xs font-semibold text-chart-2">{row._confScore.toFixed(2)}</span>
                    </td>

                    {/* HVA Factor — read-only */}
                    <td className="px-3 py-2 text-center">
                      <span className={`font-mono text-xs font-semibold ${row._hvaFromMatrix ? "text-chart-3" : "text-muted-foreground"}`}
                            title={row._hvaFromMatrix ? "From HVA matrix" : "Back-computed from base data"}>
                        {row._hvaFactor.toFixed(2)}
                      </span>
                    </td>

                    <td className="px-3 py-2 text-center">
                      <div className="flex items-center gap-1 justify-center">
                        <div className="w-10 h-1 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, (row._likScore / maxLik) * 100)}%` }} />
                        </div>
                        <span className="font-mono text-xs font-semibold">{row._likScore.toFixed(1)}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rateStyle(row._likRate)}`}>
                        {row._likRate}
                      </span>
                    </td>
                    <td></td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-3 flex items-center justify-between border-t border-border text-xs text-muted-foreground">
            <span>{sorted.length} results</span>
            <div className="flex items-center gap-2">
              <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                className="px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed">
                ←
              </button>
              <span>Page {page + 1} of {totalPages}</span>
              <button disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}
                className="px-2 py-1 rounded border border-border hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed">
                →
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
