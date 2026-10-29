import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { Link } from "wouter";
import data from "@/data.json";
import { useAppData } from "@/context/AppDataContext";
import { Plus, Pencil, Trash2, Check, X, RotateCcw, Info } from "lucide-react";
import { useSortTable } from "@/hooks/useSortTable";
import { useHVAScores } from "@/context/HVAScoresContext";
import { useTacticScores } from "@/context/TacticScoresContext";
import SortableTh from "@/components/SortableTh";

type HVRow = {
  target: string;
  tid: string;
  tidName: string;
  risk: string;
  likelihood: string;
  impact: string;
  riskScore: number;
  likelihoodScore: number;
};

type HVScore = {
  tid: string;
  avgRisk: number;
  avgLikelihood: number;
};

// ── Constants ──────────────────────────────────────────────────────────────────

const RISK_OPTIONS    = ["", "Unknown", "Low", "Medium", "High", "Critical"];
const LIKE_OPTIONS    = ["", "Unknown", "Low", "Medium", "High", "Very High"];

/** Score mapping for new / edited entries — mirrors the Excel patterns */
const RISK_SCORE_MAP: Record<string, number>  = { "": 1, Unknown: 1, Low: 1, Medium: 2, High: 3, Critical: 5 };
const LIKE_SCORE_MAP: Record<string, number>  = { "": 1, Unknown: 1, Low: 1, Medium: 2, High: 3, "Very High": 5 };

function calcRiskScore(risk: string): number  { return RISK_SCORE_MAP[risk]  ?? 1; }
function calcLikeScore(lik: string):  number  { return LIKE_SCORE_MAP[lik]   ?? 1; }

// ── Data ───────────────────────────────────────────────────────────────────────

// Baseline rows from Excel that have a TID (active mappings)
const baselineWithTID: HVRow[] = ((data as any).highvalue as HVRow[]).filter(r => r.tid);

// All known asset names (including assets not yet mapped to any TID)
const knownAssets: string[] = Array.from(
  new Set(((data as any).highvalue as HVRow[]).map(r => r.target).filter(Boolean))
).sort();

// All known technique names from techNameMap
const techNameMap: Record<string, string> = (data as any).techNameMap ?? {};

// ── localStorage ───────────────────────────────────────────────────────────────

const LS_CUSTOM_BASE    = "pt_hva_custom";
const LS_OVERRIDES_BASE = "pt_hva_overrides";

function loadCustomFromKey(key: string): HVRow[]                      { try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; } }
function loadOverridesFromKey(key: string): Record<string, Partial<HVRow>> { try { return JSON.parse(localStorage.getItem(key) ?? "{}"); } catch { return {}; } }
function saveCustom(key: string, rows: HVRow[])                      { try { localStorage.setItem(key, JSON.stringify(rows)); }    catch {} }
function saveOverrides(key: string, ov: Record<string, Partial<HVRow>>) { try { localStorage.setItem(key, JSON.stringify(ov)); } catch {} }

function migrateHVA() {
  if (!localStorage.getItem(`${LS_CUSTOM_BASE}:base`)    && localStorage.getItem(LS_CUSTOM_BASE))    localStorage.setItem(`${LS_CUSTOM_BASE}:base`,    localStorage.getItem(LS_CUSTOM_BASE)!);
  if (!localStorage.getItem(`${LS_OVERRIDES_BASE}:base`) && localStorage.getItem(LS_OVERRIDES_BASE)) localStorage.setItem(`${LS_OVERRIDES_BASE}:base`, localStorage.getItem(LS_OVERRIDES_BASE)!);
}

/** Recompute HVScores from all rows (pure function — caller handles persistence) */
function recomputeHVScores(all: HVRow[]) {
  const byTid: Record<string, number[][]> = {};
  for (const r of all) {
    if (!r.tid) continue;
    const rs = Number(r.riskScore) || 1;
    const ls = Number(r.likelihoodScore) || 1;
    (byTid[r.tid] ??= []).push([rs, ls]);
  }
  return Object.entries(byTid).map(([tid, pairs]) => ({
    tid,
    avgRisk: pairs.reduce((s, p) => s + p[0], 0) / pairs.length,
    avgLikelihood: pairs.reduce((s, p) => s + p[1], 0) / pairs.length,
  }));
}

// ── Styles ─────────────────────────────────────────────────────────────────────

function riskBadge(v: string) {
  const r = (v || "").toLowerCase();
  if (r === "critical")  return "text-purple-400 bg-purple-400/10 border border-purple-400/30";
  if (r === "high")      return "text-red-400 bg-red-400/10 border border-red-400/30";
  if (r === "medium")    return "text-yellow-400 bg-yellow-400/10 border border-yellow-400/30";
  if (r === "low")       return "text-green-400 bg-green-400/10 border border-green-400/30";
  if (r === "unknown")   return "text-muted-foreground bg-muted/30 border border-border";
  return "text-muted-foreground bg-muted/20 border border-border/50";
}

// ── Blank form state ────────────────────────────────────────────────────────────

function blankForm(): HVRow {
  return { target: "", tid: "", tidName: "", risk: "", likelihood: "", impact: "", riskScore: 1, likelihoodScore: 1 };
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function HighValueAssets() {
  const { setHVAScores } = useHVAScores();
  const { isTidEnabled } = useTacticScores();
  const { activeMitreVersionId } = useAppData();
  const versionKey    = activeMitreVersionId ?? "base";
  const lsCustomKey   = `${LS_CUSTOM_BASE}:${versionKey}`;
  const lsOverrideKey = `${LS_OVERRIDES_BASE}:${versionKey}`;
  const lsCustomRef   = useRef(lsCustomKey);
  const lsOvRef       = useRef(lsOverrideKey);

  const [custom, setCustom]       = useState<HVRow[]>(() => { migrateHVA(); return loadCustomFromKey(`${LS_CUSTOM_BASE}:base`); });
  const [overrides, setOverrides] = useState<Record<string, Partial<HVRow>>>(() => loadOverridesFromKey(`${LS_OVERRIDES_BASE}:base`));

  useEffect(() => {
    migrateHVA();
    lsCustomRef.current = lsCustomKey;
    lsOvRef.current     = lsOverrideKey;
    setCustom(loadCustomFromKey(lsCustomKey));
    setOverrides(loadOverridesFromKey(lsOverrideKey));
  }, [lsCustomKey, lsOverrideKey]);

  const [search, setSearch]           = useState("");
  const [targetFilter, setTargetFilter] = useState("All");

  // Add-row form
  const [showAdd, setShowAdd]   = useState(false);
  const [addForm, setAddForm]   = useState<HVRow>(blankForm);

  // Edit state: "b-{index}" for baseline, "c-{index}" for custom
  const [editId, setEditId]   = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<HVRow>>({});

  // ── Merged rows ──────────────────────────────────────────────────────────────

  const merged: Array<HVRow & { _key: string; _isCustom: boolean; _isEdited: boolean }> = useMemo(() => {
    const baseline = baselineWithTID.map((r, i) => {
      const ov = overrides[`b-${i}`] ?? {};
      return {
        ...r,
        ...ov,
        _key: `b-${i}`,
        _isCustom: false,
        _isEdited: Object.keys(ov).length > 0,
      };
    });
    const cust = custom.map((r, i) => ({
      ...r,
      _key: `c-${i}`,
      _isCustom: true,
      _isEdited: false,
    }));
    return [...baseline, ...cust].filter(row => isTidEnabled(row.tid));
  }, [custom, overrides, isTidEnabled]);

  // Keep HVScores in sync — recompute locally and push to shared context so
  // Risk Calculation and Likelihood Table react immediately.
  const hvscores: HVScore[] = useMemo(() => recomputeHVScores(merged), [merged]);
  useEffect(() => { setHVAScores(hvscores); }, [hvscores, setHVAScores]);

  // ── Filters ──────────────────────────────────────────────────────────────────

  const allTargets = useMemo(() =>
    ["All", ...Array.from(new Set(merged.map(r => r.target))).sort()],
    [merged]
  );

  const filtered = useMemo(() => merged.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q ||
      r.target?.toLowerCase().includes(q) ||
      r.tid?.toLowerCase().includes(q) ||
      r.tidName?.toLowerCase().includes(q) ||
      r.impact?.toLowerCase().includes(q);
    const matchTarget = targetFilter === "All" || r.target === targetFilter;
    return matchSearch && matchTarget;
  }), [merged, search, targetFilter]);

  // ── Sort hooks ───────────────────────────────────────────────────────────────

  const { sortKey: hvSk, sortDir: hvSd, toggle: hvToggle, sorted: sortedHVScores } = useSortTable(hvscores, "avgRisk", "desc");
  const { sortKey: mainSk, sortDir: mainSd, toggle: mainToggle, sorted: sortedFiltered } = useSortTable(filtered);

  // ── Stats ────────────────────────────────────────────────────────────────────

  const highCount     = merged.filter(r => r.risk === "High" || r.risk === "Critical").length;
  const uniqueTargets = new Set(merged.map(r => r.target)).size;
  const uniqueTids    = new Set(merged.filter(r => r.tid).map(r => r.tid)).size;
  const customCount   = custom.length + Object.keys(overrides).length;

  // ── Add row handlers ─────────────────────────────────────────────────────────

  function onAddFormChange(field: keyof HVRow, value: string | number) {
    setAddForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === "tid" && typeof value === "string") {
        next.tidName = techNameMap[value] ?? next.tidName;
      }
      if (field === "risk" || field === "likelihood") {
        next.riskScore       = calcRiskScore(typeof field === "string" && field === "risk" ? String(value) : next.risk);
        next.likelihoodScore = calcLikeScore(typeof field === "string" && field === "likelihood" ? String(value) : next.likelihood);
      }
      return next;
    });
  }

  function commitAdd() {
    if (!addForm.target || !addForm.tid || !isTidEnabled(addForm.tid)) return;
    const newEntry: HVRow = {
      ...addForm,
      riskScore:       Number(addForm.riskScore)       || calcRiskScore(addForm.risk),
      likelihoodScore: Number(addForm.likelihoodScore) || calcLikeScore(addForm.likelihood),
    };
    const next = [...custom, newEntry];
    setCustom(next);
    saveCustom(lsCustomRef.current, next);
    setAddForm(blankForm());
    setShowAdd(false);
  }

  function deleteRow(key: string) {
    if (key.startsWith("c-")) {
      const idx = parseInt(key.slice(2));
      const next = custom.filter((_, i) => i !== idx);
      setCustom(next);
      saveCustom(lsCustomRef.current, next);
    } else {
      // Baseline rows can't be deleted, but overrides can be reset
      const nextOv = { ...overrides };
      delete nextOv[key];
      setOverrides(nextOv);
      saveOverrides(lsOvRef.current, nextOv);
    }
  }

  function startEdit(key: string) {
    const row = merged.find(r => r._key === key);
    if (!row) return;
    setEditId(key);
    setEditForm({
      target: row.target,
      tid: row.tid,
      tidName: row.tidName,
      risk: row.risk,
      likelihood: row.likelihood,
      impact: row.impact,
      riskScore: row.riskScore,
      likelihoodScore: row.likelihoodScore,
    });
  }

  function onEditChange(field: keyof HVRow, value: string | number) {
    setEditForm(prev => {
      const next = { ...prev, [field]: value };
      if (field === "tid" && typeof value === "string") {
        next.tidName = techNameMap[value] ?? prev.tidName ?? "";
      }
      if (field === "risk") {
        next.riskScore = calcRiskScore(String(value));
      }
      if (field === "likelihood") {
        next.likelihoodScore = calcLikeScore(String(value));
      }
      return next;
    });
  }

  function commitEdit() {
    if (!editId) return;
    if (editForm.tid && !isTidEnabled(editForm.tid)) return;
    if (editId.startsWith("c-")) {
      const idx = parseInt(editId.slice(2));
      const next = custom.map((r, i) => i === idx ? { ...r, ...editForm } as HVRow : r);
      setCustom(next);
      saveCustom(lsCustomRef.current, next);
    } else {
      const nextOv = { ...overrides, [editId]: editForm };
      setOverrides(nextOv);
      saveOverrides(lsOvRef.current, nextOv);
    }
    setEditId(null);
    setEditForm({});
  }

  function cancelEdit() {
    setEditId(null);
    setEditForm({});
  }

  function resetBaseline(key: string) {
    const nextOv = { ...overrides };
    delete nextOv[key];
    setOverrides(nextOv);
    saveOverrides(lsOvRef.current, nextOv);
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">High Value Asset Risk</h1>
          <p className="text-muted-foreground text-sm mt-1">
            TTP risks mapped to critical business assets. Add and edit entries to update HVSCORES used in Risk Calculation.
          </p>
        </div>
        {customCount > 0 && (
          <div className="text-xs text-yellow-400 border border-yellow-500/30 bg-yellow-500/5 rounded-lg px-3 py-1.5">
            {customCount} custom change(s) active
          </div>
        )}
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-primary">{merged.length}</div>
          <div className="text-sm text-muted-foreground mt-1">Total Mappings</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-chart-2">{uniqueTargets}</div>
          <div className="text-sm text-muted-foreground mt-1">Unique Targets</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-chart-3">{uniqueTids}</div>
          <div className="text-sm text-muted-foreground mt-1">Unique TTPs</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-red-400">{highCount}</div>
          <div className="text-sm text-muted-foreground mt-1">High / Critical Risks</div>
        </div>
      </div>

      {/* ── Average Scores + Risk by Target ── */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Average Scores by TID</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Aggregated HVA risk & likelihood — fed into Risk Calculation</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <SortableTh col="tid" sortKey={hvSk} sortDir={hvSd} toggle={hvToggle}>TID</SortableTh>
                  <SortableTh col="avgRisk" sortKey={hvSk} sortDir={hvSd} toggle={hvToggle}>Avg Risk</SortableTh>
                  <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Risk Bar</th>
                  <SortableTh col="avgLikelihood" sortKey={hvSk} sortDir={hvSd} toggle={hvToggle}>Avg Likelihood</SortableTh>
                </tr>
              </thead>
              <tbody>
                {sortedHVScores.map(row => (
                  <tr key={row.tid} className="border-b border-border/40 hover:bg-accent/20 transition-colors">
                    <td className="px-4 py-3">
                      <Link href={`/all-procedures?mitre=${encodeURIComponent(row.tid)}`}>
                        <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded hover:bg-primary/20 transition-colors cursor-pointer">
                          {row.tid}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-semibold text-foreground">{row.avgRisk.toFixed(2)}</td>
                    <td className="px-4 py-3 w-32">
                      <div className="h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, (row.avgRisk / 5) * 100)}%` }} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.avgLikelihood.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold text-foreground">Risk by Target</h2>
            <p className="text-xs text-muted-foreground mt-0.5">High/Critical entries per target asset</p>
          </div>
          <div className="p-4 space-y-3 max-h-72 overflow-y-auto">
            {Array.from(new Set(merged.map(r => r.target))).sort().map(target => {
              const entries = merged.filter(r => r.target === target);
              const highC   = entries.filter(r => r.risk === "High" || r.risk === "Critical").length;
              return (
                <div key={target}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-foreground font-medium">{target}</span>
                    <span className="text-muted-foreground flex-shrink-0 ml-2">{highC}/{entries.length} High/Crit</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-red-400 rounded-full" style={{ width: `${entries.length > 0 ? (highC / entries.length) * 100 : 0}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Asset Risk Matrix ── */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3 flex-wrap">
          <h2 className="font-semibold text-foreground flex-shrink-0">Asset Risk Matrix</h2>
          <input
            type="search"
            placeholder="Search targets, TIDs, impact…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-36 bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <select
            value={targetFilter}
            onChange={e => setTargetFilter(e.target.value)}
            className="bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {allTargets.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-xs text-muted-foreground whitespace-nowrap">{filtered.length} results</span>
          <button
            onClick={() => { setShowAdd(v => !v); setAddForm(blankForm()); }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary/10 text-primary border border-primary/30 rounded-lg hover:bg-primary/20 transition-colors whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Row
          </button>
        </div>

        {/* ── Add-row form ── */}
        {showAdd && (
          <div className="p-4 border-b border-border bg-muted/10 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">New Asset-TID Mapping</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Target Asset *</label>
                <input
                  list="known-assets"
                  placeholder="Asset name…"
                  value={addForm.target}
                  onChange={e => onAddFormChange("target", e.target.value)}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <datalist id="known-assets">
                  {knownAssets.map(a => <option key={a} value={a} />)}
                </datalist>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">TID *</label>
                <input
                  placeholder="e.g. T1190"
                  value={addForm.tid}
                  onChange={e => onAddFormChange("tid", e.target.value.trim())}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Technique Name</label>
                <input
                  placeholder="Auto-filled from TID…"
                  value={addForm.tidName}
                  onChange={e => onAddFormChange("tidName", e.target.value)}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Impact Description</label>
                <input
                  placeholder="Describe the impact…"
                  value={addForm.impact}
                  onChange={e => onAddFormChange("impact", e.target.value)}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Risk Level</label>
                <select
                  value={addForm.risk}
                  onChange={e => onAddFormChange("risk", e.target.value)}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {RISK_OPTIONS.map(o => <option key={o} value={o}>{o || "—"}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Likelihood Level</label>
                <select
                  value={addForm.likelihood}
                  onChange={e => onAddFormChange("likelihood", e.target.value)}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                >
                  {LIKE_OPTIONS.map(o => <option key={o} value={o}>{o || "—"}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  Risk Score
                  <span title="Auto-computed from Risk level. You can override." className="text-muted-foreground/60"><Info className="w-3 h-3" /></span>
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  value={addForm.riskScore}
                  onChange={e => setAddForm(p => ({ ...p, riskScore: parseFloat(e.target.value) || 1 }))}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                  Likelihood Score
                  <span title="Auto-computed from Likelihood level. You can override." className="text-muted-foreground/60"><Info className="w-3 h-3" /></span>
                </label>
                <input
                  type="number"
                  step="0.25"
                  min="0"
                  value={addForm.likelihoodScore}
                  onChange={e => setAddForm(p => ({ ...p, likelihoodScore: parseFloat(e.target.value) || 1 }))}
                  className="w-full bg-input border border-border rounded px-2.5 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={commitAdd}
                disabled={!addForm.target || !addForm.tid || !isTidEnabled(addForm.tid)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Check className="w-3.5 h-3.5" /> Save Row
              </button>
              {addForm.tid && !isTidEnabled(addForm.tid) && (
                <span className="text-xs text-amber-400">This TID belongs to a disabled tactic.</span>
              )}
              <button
                onClick={() => setShowAdd(false)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-border rounded-lg hover:bg-accent/20 transition-colors text-muted-foreground"
              >
                <X className="w-3.5 h-3.5" /> Cancel
              </button>
              <span className="text-xs text-muted-foreground ml-2">
                Score formula: Risk(Low=1, Med=2, High=3, Critical=5) · Likelihood(Low=1, Med=2, High=3, VH=5)
              </span>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <SortableTh col="target" sortKey={mainSk} sortDir={mainSd} toggle={mainToggle}>Target Asset</SortableTh>
                <SortableTh col="tid" sortKey={mainSk} sortDir={mainSd} toggle={mainToggle}>TID</SortableTh>
                <SortableTh col="tidName" sortKey={mainSk} sortDir={mainSd} toggle={mainToggle}>Technique</SortableTh>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Risk</th>
                <th className="text-center px-3 py-2.5 text-xs text-muted-foreground font-medium">Likelihood</th>
                <SortableTh col="riskScore" sortKey={mainSk} sortDir={mainSd} toggle={mainToggle} align="center" className="px-3">Risk Score</SortableTh>
                <SortableTh col="likelihoodScore" sortKey={mainSk} sortDir={mainSd} toggle={mainToggle} align="center" className="px-3">Lik. Score</SortableTh>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Impact</th>
                <th className="w-24 px-3 py-2.5 text-xs text-muted-foreground font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {sortedFiltered.map(row => {
                const isEditing = editId === row._key;
                return (
                  <Fragment key={row._key}>
                    {isEditing ? (
                      <tr className="border-b border-border bg-yellow-500/5">
                        <td className="px-2 py-1.5">
                          <input
                            list="known-assets-edit"
                            value={editForm.target ?? ""}
                            onChange={e => onEditChange("target", e.target.value)}
                            className="w-full bg-input border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                          <datalist id="known-assets-edit">
                            {knownAssets.map(a => <option key={a} value={a} />)}
                          </datalist>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={editForm.tid ?? ""}
                            onChange={e => onEditChange("tid", e.target.value.trim())}
                            className="w-24 bg-input border border-border rounded px-2 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={editForm.tidName ?? ""}
                            onChange={e => onEditChange("tidName", e.target.value)}
                            className="w-full bg-input border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            placeholder="Technique name…"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={editForm.risk ?? ""}
                            onChange={e => onEditChange("risk", e.target.value)}
                            className="bg-input border border-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            {RISK_OPTIONS.map(o => <option key={o} value={o}>{o || "—"}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            value={editForm.likelihood ?? ""}
                            onChange={e => onEditChange("likelihood", e.target.value)}
                            className="bg-input border border-border rounded px-1.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          >
                            {LIKE_OPTIONS.map(o => <option key={o} value={o}>{o || "—"}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="0.25"
                            value={editForm.riskScore ?? 1}
                            onChange={e => setEditForm(p => ({ ...p, riskScore: parseFloat(e.target.value) || 1 }))}
                            className="w-16 bg-input border border-border rounded px-1.5 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            step="0.25"
                            value={editForm.likelihoodScore ?? 1}
                            onChange={e => setEditForm(p => ({ ...p, likelihoodScore: parseFloat(e.target.value) || 1 }))}
                            className="w-16 bg-input border border-border rounded px-1.5 py-1 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            value={editForm.impact ?? ""}
                            onChange={e => onEditChange("impact", e.target.value)}
                            className="w-full bg-input border border-border rounded px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                            placeholder="Impact description…"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex items-center gap-1">
                            <button
                              onClick={commitEdit}
                              disabled={Boolean(editForm.tid && !isTidEnabled(editForm.tid))}
                              className="p-1 text-green-400 hover:bg-green-400/10 rounded disabled:cursor-not-allowed disabled:opacity-40"
                              title={editForm.tid && !isTidEnabled(editForm.tid) ? "This TID belongs to a disabled tactic" : "Save"}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={cancelEdit} className="p-1 text-muted-foreground hover:bg-accent/20 rounded" title="Cancel">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr className={`border-b border-border/40 hover:bg-accent/20 transition-colors ${
                        row._isCustom ? "bg-blue-500/5" : row._isEdited ? "bg-yellow-500/5" : ""
                      }`}>
                        <td className="px-4 py-2.5 text-xs font-medium text-foreground">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {row._isCustom && <span className="text-[10px] text-blue-400 border border-blue-400/30 bg-blue-400/10 px-1 rounded flex-shrink-0">NEW</span>}
                            {row._isEdited && <span className="text-[10px] text-yellow-400 border border-yellow-400/30 bg-yellow-400/10 px-1 rounded flex-shrink-0">EDITED</span>}
                            <span>{row.target}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <Link href={`/all-procedures?mitre=${encodeURIComponent(row.tid)}`}>
                            <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded hover:bg-primary/20 cursor-pointer">
                              {row.tid}
                            </span>
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          <Link href={`/all-procedures?mitre=${encodeURIComponent(row.tid)}`}>
                            <div className="hover:text-primary cursor-pointer transition-colors">{row.tidName}</div>
                          </Link>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskBadge(row.risk)}`}>
                            {row.risk || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskBadge(row.likelihood)}`}>
                            {row.likelihood || "—"}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs font-mono font-semibold text-foreground">
                          {Number(row.riskScore).toFixed(2)}
                        </td>
                        <td className="px-3 py-2.5 text-center text-xs font-mono text-muted-foreground">
                          {Number(row.likelihoodScore).toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-muted-foreground">
                          <div>{row.impact || "—"}</div>
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-1 justify-end">
                            {row._isEdited && (
                              <button
                                onClick={() => resetBaseline(row._key)}
                                title="Reset to baseline"
                                className="p-1 text-muted-foreground hover:text-yellow-400 rounded"
                              >
                                <RotateCcw className="w-3 h-3" />
                              </button>
                            )}
                            <button
                              onClick={() => startEdit(row._key)}
                              className="p-1 text-muted-foreground hover:text-primary rounded"
                              title="Edit"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {row._isCustom ? (
                              <button
                                onClick={() => deleteRow(row._key)}
                                className="p-1 text-muted-foreground hover:text-red-400 rounded"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="p-8 text-center text-muted-foreground text-sm">No entries match your filters.</div>
          )}
        </div>

        <div className="p-3 border-t border-border">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Info className="w-3 h-3" />
            HVA scores (per-TID averages) are re-computed live and stored for use in Risk Calculation.
            Score formula: Risk(Low=1, Med=2, High=3, Critical=5) · Likelihood(Low=1, Med=2, High=3, VH=5).
            Baseline rows from Excel can be edited but not deleted — use Reset to restore originals.
          </div>
        </div>
      </div>
    </div>
  );
}
