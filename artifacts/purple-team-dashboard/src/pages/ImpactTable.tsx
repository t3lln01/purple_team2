import { useState, useMemo, useCallback, Fragment } from "react";
import { Link } from "wouter";
import data from "@/data.json";
import { useImpactOverrides, ImpactOverride } from "@/context/ImpactOverridesContext";
import { useTacticScores } from "@/context/TacticScoresContext";
import { useHVAScores } from "@/context/HVAScoresContext";
import { useAppData } from "@/context/AppDataContext";
import { useDateWindow } from "@/context/DateWindowContext";
import {
  calcCIAScore,
  calcImpactScore,
  calcImpactRate,
  calcTTPExtent,
} from "@/utils/impactFormulas";
import { RotateCcw, Edit3, ChevronDown, ChevronUp } from "lucide-react";

type ImpactRow = {
  id: string;
  name: string;
  platforms: string;
  tactics: string;
  confidentiality: string;
  integrity: string;
  availability: string;
  capecSeverity: string;
  dataSources: string;
  initialTTPExtent: number;
  adScore: number;
  containerScore: number;
  cloudScore: number;
  supportRemoteScore: number;
  systemReqScore: number;
  capecSeverityScore: number;
  permRequiredScore: number;
  effectivePermsScore: number;
  finalTTPExtent: number;
};

const rawRows: ImpactRow[] = (data as any).impactTable ?? [];

const CIA_OPTIONS = ["Low", "Medium", "High"];
const CIA_LABELS = ["Low", "Medium", "High", "NA", "N/A", ""];

function isValidCIA(v: string) {
  return ["Low", "Medium", "High"].includes(v);
}

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

type SortKey = "id" | "name" | "tactics" | "ciaScore" | "ttpExtent" | "impactScore" | "impactRate";

const TTP_FACTOR_LABELS: { key: keyof ImpactOverride & string; label: string }[] = [
  { key: "initialTTPExtent",    label: "Initial TTP Extent" },
  { key: "adScore",             label: "Active Directory" },
  { key: "containerScore",      label: "Container" },
  { key: "cloudScore",          label: "Cloud" },
  { key: "supportRemoteScore",  label: "Remote Support" },
  { key: "systemReqScore",      label: "System Requirements" },
  { key: "capecSeverityScore",  label: "CAPEC Severity" },
  { key: "permRequiredScore",   label: "Permission Required" },
  { key: "effectivePermsScore", label: "Effective Permissions" },
];

type ComputedRow = ImpactRow & {
  _conf: string;
  _int: string;
  _avail: string;
  _ttpExtent: number;
  _ciaScore: number;
  _impactScore: number;
  _impactRate: string;
  _hasOverride: boolean;
};

export default function ImpactTable() {
  const { overrides, setOverride, resetOverride, resetAll } = useImpactOverrides();
  const { overrides: tacticOverrides, areTacticsEnabled, isTidEnabled } = useTacticScores();
  const { hvaScoreMap } = useHVAScores();
  const { activeNewImpactRows } = useAppData();
  const { tidsInWindow } = useDateWindow();
  const [search, setSearch] = useState("");
  const [tacticFilter, setTacticFilter] = useState("All");
  const [sortKey, setSortKey] = useState<SortKey>("impactRate");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const stixOverrides: Record<string, { name?: string; platforms?: string; tactics?: string }> = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("pt_stix_techniques") ?? "{}"); } catch { return {}; }
  }, []);

  const allSourceRows = useMemo(
    () => [...(rawRows as ImpactRow[]), ...(activeNewImpactRows as ImpactRow[])]
      .filter(row => isTidEnabled(row.id) && areTacticsEnabled(stixOverrides[row.id]?.tactics ?? row.tactics)),
    [activeNewImpactRows, areTacticsEnabled, isTidEnabled, stixOverrides]
  );

  const allTactics = useMemo(
    () => ["All", ...Array.from(new Set(allSourceRows.flatMap(r => r.tactics?.split(", ").map(t => t.trim()) || []))).sort()],
    [allSourceRows]
  );

  const computed: ComputedRow[] = useMemo(() => allSourceRows.map(row => {
    const ov = overrides[row.id] ?? {};
    const stix = stixOverrides[row.id] ?? {};

    // CIA precedence: per-technique override > tactic-level override > base data.json
    const primaryTactic = (row.tactics ?? "").split(",")[0].trim();
    const tacticOv = tacticOverrides[primaryTactic] ?? {};

    const conf  = ov.confidentiality !== undefined ? ov.confidentiality
                : tacticOv.conf      !== undefined ? tacticOv.conf
                : row.confidentiality;
    const int_  = ov.integrity       !== undefined ? ov.integrity
                : tacticOv.integrity !== undefined ? tacticOv.integrity
                : row.integrity;
    const avail = ov.availability    !== undefined ? ov.availability
                : tacticOv.avail     !== undefined ? tacticOv.avail
                : row.availability;

    const ttpRow = {
      initialTTPExtent:    ov.initialTTPExtent    !== undefined ? ov.initialTTPExtent    : row.initialTTPExtent,
      adScore:             ov.adScore             !== undefined ? ov.adScore             : row.adScore,
      containerScore:      ov.containerScore      !== undefined ? ov.containerScore      : row.containerScore,
      cloudScore:          ov.cloudScore          !== undefined ? ov.cloudScore          : row.cloudScore,
      supportRemoteScore:  ov.supportRemoteScore  !== undefined ? ov.supportRemoteScore  : row.supportRemoteScore,
      systemReqScore:      ov.systemReqScore      !== undefined ? ov.systemReqScore      : row.systemReqScore,
      capecSeverityScore:  ov.capecSeverityScore  !== undefined ? ov.capecSeverityScore  : row.capecSeverityScore,
      permRequiredScore:   ov.permRequiredScore   !== undefined ? ov.permRequiredScore   : row.permRequiredScore,
      effectivePermsScore: ov.effectivePermsScore !== undefined ? ov.effectivePermsScore : row.effectivePermsScore,
    };

    const ttpExtent  = calcTTPExtent(ttpRow);
    const ciaScore   = isValidCIA(conf) && isValidCIA(int_) && isValidCIA(avail)
      ? calcCIAScore(conf, int_, avail)
      : 0;
    const hvaFactor   = hvaScoreMap[row.id]?.avgRisk ?? 1;
    const impactScore = calcImpactScore(ciaScore, ttpExtent, hvaFactor);
    const impactRate  = calcImpactRate(impactScore);

    return {
      ...row,
      name:      stix.name      ?? row.name,
      platforms: stix.platforms ?? row.platforms,
      tactics:   stix.tactics   ?? row.tactics,
      _conf:  conf,
      _int:   int_,
      _avail: avail,
      _ttpExtent:   ttpExtent,
      _ciaScore:    ciaScore,
      _impactScore: impactScore,
      _impactRate:  impactRate,
      _hasOverride: Object.keys(ov).length > 0 || Object.keys(tacticOv).length > 0,
    };
  }), [allSourceRows, overrides, stixOverrides, tacticOverrides, hvaScoreMap]);

  const filtered = useMemo(() => computed.filter(r => {
    if (tidsInWindow && !tidsInWindow.has(r.id)) return false;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      r.id.toLowerCase().includes(q) ||
      r.name.toLowerCase().includes(q) ||
      r.tactics.toLowerCase().includes(q) ||
      r.platforms.toLowerCase().includes(q);
    const matchTactic = tacticFilter === "All" || r.tactics.includes(tacticFilter);
    return matchSearch && matchTactic;
  }), [computed, search, tacticFilter, tidsInWindow]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case "id":   return dir * a.id.localeCompare(b.id);
        case "name": return dir * a.name.localeCompare(b.name);
        case "tactics": return dir * a.tactics.localeCompare(b.tactics);
        case "ciaScore":    return dir * (a._ciaScore - b._ciaScore);
        case "ttpExtent":   return dir * (a._ttpExtent - b._ttpExtent);
        case "impactScore": return dir * (a._impactScore - b._impactScore);
        case "impactRate":  return dir * (rateOrder(a._impactRate) - rateOrder(b._impactRate));
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

  const setField = useCallback((id: string, key: keyof ImpactOverride, value: string | number) => {
    setOverride(id, { [key]: value } as Partial<ImpactOverride>);
  }, [setOverride]);

  const overrideCount = Object.keys(overrides).length;
  const vhCount = computed.filter(r => r._impactRate === "Very High").length;
  const avgImpact = computed.reduce((s, r) => s + r._impactScore, 0) / (computed.length || 1);
  const maxImpact = Math.max(...computed.map(r => r._impactScore), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Impact Table</h1>
          <p className="text-muted-foreground text-sm mt-1">
            CIA scores, TTP extent factors and computed impact for {rawRows.length} ATT&CK techniques.
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
          <div className="text-2xl font-bold text-primary">{rawRows.length}</div>
          <div className="text-sm text-muted-foreground mt-1">Techniques</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-red-400">{vhCount}</div>
          <div className="text-sm text-muted-foreground mt-1">Very High Impact</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-chart-2">{avgImpact.toFixed(1)}</div>
          <div className="text-sm text-muted-foreground mt-1">Avg Impact Score</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-chart-4">{overrideCount}</div>
          <div className="text-sm text-muted-foreground mt-1">Manual Overrides</div>
        </div>
      </div>

      {overrideCount > 0 && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-lg p-3 text-xs text-yellow-400">
          <Edit3 className="inline w-3 h-3 mr-1" />
          {overrideCount} technique(s) have manually edited values. These override the Excel baseline and also affect the Risk Calculation page.
        </div>
      )}

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <input
            type="search"
            placeholder="Search by ID, name, tactic, platform…"
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
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("id")} className="flex items-center hover:text-foreground">
                    ID <SortIcon col="id" />
                  </button>
                </th>
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("name")} className="flex items-center hover:text-foreground">
                    Name <SortIcon col="name" />
                  </button>
                </th>
                <th className="text-left px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("tactics")} className="flex items-center hover:text-foreground">
                    Tactics <SortIcon col="tactics" />
                  </button>
                </th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Conf.</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Int.</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Avail.</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("ciaScore")} className="flex items-center hover:text-foreground mx-auto">
                    CIA Score <SortIcon col="ciaScore" />
                  </button>
                </th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("ttpExtent")} className="flex items-center hover:text-foreground mx-auto">
                    TTP Extent <SortIcon col="ttpExtent" />
                  </button>
                </th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("impactScore")} className="flex items-center hover:text-foreground mx-auto">
                    Impact Score <SortIcon col="impactScore" />
                  </button>
                </th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">
                  <button onClick={() => handleSort("impactRate")} className="flex items-center hover:text-foreground mx-auto">
                    Impact Rate <SortIcon col="impactRate" />
                  </button>
                </th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map(row => {
                const isExpanded = expandedId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr
                      className={`border-b border-border/40 hover:bg-accent/20 transition-colors ${row._hasOverride ? "bg-yellow-500/5" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {row._hasOverride && (
                            <button
                              onClick={() => resetOverride(row.id)}
                              title="Reset to baseline"
                              className="text-yellow-500 hover:text-yellow-400 flex-shrink-0"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                          <Link href={`/all-procedures?mitre=${encodeURIComponent(row.id)}`}>
                            <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded hover:bg-primary/20 transition-colors cursor-pointer">
                              {row.id}
                            </span>
                          </Link>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-foreground max-w-[200px]">
                        <Link href={`/all-procedures?mitre=${encodeURIComponent(row.id)}`}>
                          <div className="truncate hover:text-primary cursor-pointer transition-colors" title={row.name}>
                            {row.name}
                          </div>
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-[160px]">
                        <div className="truncate" title={row.tactics}>{row.tactics}</div>
                      </td>

                      <td className="px-3 py-2 text-center">
                        <CIASelect
                          value={row._conf}
                          baseline={row.confidentiality}
                          onChange={v => setField(row.id, "confidentiality", v)}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <CIASelect
                          value={row._int}
                          baseline={row.integrity}
                          onChange={v => setField(row.id, "integrity", v)}
                        />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <CIASelect
                          value={row._avail}
                          baseline={row.availability}
                          onChange={v => setField(row.id, "availability", v)}
                        />
                      </td>

                      <td className="px-3 py-2 text-center">
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {row._ciaScore.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className="font-mono text-xs font-semibold text-foreground">
                          {row._ttpExtent.toFixed(2)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <div className="flex items-center gap-1 justify-center">
                          <div className="w-12 h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className="h-full bg-primary rounded-full"
                              style={{ width: `${Math.min(100, (row._impactScore / maxImpact) * 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs font-semibold">{row._impactScore.toFixed(2)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rateStyle(row._impactRate)}`}>
                          {row._impactRate}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : row.id)}
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title={isExpanded ? "Collapse TTP factors" : "Expand TTP factors"}
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="border-b border-border bg-muted/10">
                        <td colSpan={11} className="px-4 py-4">
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                              TTP Extent Factor Scores — Total: {row._ttpExtent.toFixed(2)}
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              {TTP_FACTOR_LABELS.map(({ key, label }) => {
                                const ov = overrides[row.id] ?? {};
                                const cur = ov[key] !== undefined
                                  ? (ov[key] as number)
                                  : (row[key as keyof ImpactRow] as number);
                                const baseline = row[key as keyof ImpactRow] as number;
                                const isChanged = ov[key] !== undefined && ov[key] !== baseline;
                                return (
                                  <div key={key} className="flex items-center gap-2">
                                    <span className={`text-xs min-w-[140px] ${isChanged ? "text-yellow-400" : "text-muted-foreground"}`}>
                                      {label}
                                    </span>
                                    <input
                                      type="number"
                                      step="0.05"
                                      min="0"
                                      max="5"
                                      value={cur}
                                      onChange={e => setField(row.id, key as keyof ImpactOverride, parseFloat(e.target.value) || 0)}
                                      className={`w-20 bg-input border rounded px-2 py-0.5 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
                                        isChanged ? "border-yellow-500/50" : "border-border"
                                      }`}
                                    />
                                    {isChanged && (
                                      <span className="text-[10px] text-muted-foreground">
                                        (was {baseline})
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
                              <span className="font-medium text-foreground">Data Sources:</span> {row.dataSources || "—"} &nbsp;|&nbsp;
                              <span className="font-medium text-foreground">Platforms:</span> {row.platforms || "—"}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="p-3 border-t border-border flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages} &bull; {filtered.length} results
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(0)}
                disabled={page === 0}
                className="px-2 py-1 text-xs rounded border border-border disabled:opacity-40 hover:bg-accent/20 transition-colors"
              >«</button>
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-2 py-1 text-xs rounded border border-border disabled:opacity-40 hover:bg-accent/20 transition-colors"
              >‹</button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const start = Math.max(0, Math.min(page - 2, totalPages - 5));
                const pg = start + i;
                return (
                  <button
                    key={pg}
                    onClick={() => setPage(pg)}
                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                      pg === page
                        ? "border-primary bg-primary/20 text-primary"
                        : "border-border hover:bg-accent/20"
                    }`}
                  >{pg + 1}</button>
                );
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="px-2 py-1 text-xs rounded border border-border disabled:opacity-40 hover:bg-accent/20 transition-colors"
              >›</button>
              <button
                onClick={() => setPage(totalPages - 1)}
                disabled={page === totalPages - 1}
                className="px-2 py-1 text-xs rounded border border-border disabled:opacity-40 hover:bg-accent/20 transition-colors"
              >»</button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-card border border-card-border rounded-xl p-4 text-xs text-muted-foreground space-y-1">
        <div className="font-semibold text-foreground text-sm mb-2">Formula Reference</div>
        <div><span className="text-foreground font-medium">CIA Score</span> = Confidentiality + Integrity + Availability</div>
        <div className="pl-4 text-[11px]">
          Conf: Low=1, Medium=2, High=3 &nbsp;|&nbsp;
          Int: Low=1, Medium=2.25, High=3.5 &nbsp;|&nbsp;
          Avail: Low=1, Medium=2.5, High=4
        </div>
        <div><span className="text-foreground font-medium">TTP Extent</span> = Sum of all factor scores</div>
        <div><span className="text-foreground font-medium">Impact Score</span> = CIA Score × TTP Extent × HVA Risk factor</div>
        <div>
          <span className="text-foreground font-medium">Impact Rate</span>: ≤10 Very Low → ≤12 Low → ≤14 Medium → ≤16 High → &gt;16 Very High
        </div>
      </div>
    </div>
  );
}

function CIASelect({
  value,
  baseline,
  onChange,
}: {
  value: string;
  baseline: string;
  onChange: (v: string) => void;
}) {
  const isChanged = value !== baseline;
  if (!CIA_OPTIONS.includes(value) && !CIA_OPTIONS.includes(baseline)) {
    return <span className="text-xs text-muted-foreground">{value || "—"}</span>;
  }
  return (
    <select
      value={CIA_OPTIONS.includes(value) ? value : (CIA_OPTIONS.includes(baseline) ? baseline : "")}
      onChange={e => onChange(e.target.value)}
      className={`bg-input border rounded px-1.5 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring ${
        isChanged ? "border-yellow-500/50 text-yellow-400" : "border-border"
      }`}
    >
      {CIA_OPTIONS.map(o => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}
