import { useState, useMemo, useEffect, useRef } from "react";
import { useSearch } from "wouter";
import data from "@/data.json";
import { useSortTable } from "@/hooks/useSortTable";
import SortableTh from "@/components/SortableTh";
import { Plus, Upload, Trash2, X, Check, FileJson, FileText, AlertCircle, ChevronDown, ChevronUp, Activity, XCircle, Download } from "lucide-react";
import { useAppData, baseFullRiskCalc } from "@/context/AppDataContext";
import { toTitleCase } from "@/context/ViewContext";
import { useTacticScores } from "@/context/TacticScoresContext";
import { useLikelihood } from "@/context/LikelihoodContext";
import { useImpactOverrides } from "@/context/ImpactOverridesContext";
import { useHVAScores } from "@/context/HVAScoresContext";
import { applyOverrides } from "@/utils/riskOverrides";
import { useDateWindow } from "@/context/DateWindowContext";

// ──────────────────────────── types ──────────────────────────────────────────
type Procedure = {
  actor: string;
  mitreId: string;
  externalRef: string;
  procedure: string;
  date: number | null;
  risk: number;
  _id?: string;
  _custom?: true;
};

// ──────────────────────────── static data ────────────────────────────────────
const baseProcedures: Procedure[] = ((data as any).allProcedures as Procedure[])
  .filter(p => { const t = (p.procedure ?? "").trim(); return t !== "" && !/^\[.+\]\s*-\s*$/.test(t); })
  .map(p => ({ ...p, actor: typeof p.actor === "string" ? toTitleCase(p.actor) : p.actor }));
const techTacticMap: Record<string, string[]> = (data as any).techTacticMap ?? {};
const techNameMap: Record<string, string> = (data as any).techNameMap ?? {};

/** Analytical risk scores (Impact × Likelihood) keyed by TID, used to normalise
 *  live procedure risk values that may have been stored with an older formula. */
const riskCalcMap: Record<string, number> = Object.fromEntries(
  ((data as any).riskCalc ?? []).map((r: any) => [r.TID as string, Number(r["Risk Scores"]) || 0])
);

const baseProcedureActors: string[] = Array.from(
  new Set(baseProcedures.map(r => r.actor).filter(Boolean))
).sort();

const allMitreIds: string[] = Array.from(
  new Set(baseProcedures.map(r => r.mitreId).filter(Boolean))
).sort();

const allTactics: string[] = Array.from(
  new Set(allMitreIds.flatMap(id => techTacticMap[id] ?? []))
).sort();

// ──────────────────────────── persistence ────────────────────────────────────
const LS_KEY = "pt_procedures_custom";

function loadCustom(): Procedure[] {
  try { return JSON.parse(localStorage.getItem(LS_KEY) ?? "[]"); } catch { return []; }
}
function saveCustom(c: Procedure[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(c)); } catch {}
}
function uid() { return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

// ──────────────────────────── export helpers ──────────────────────────────────
function escapeCsvField(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv(rows: Procedure[], filename: string) {
  const header = ["actor", "mitreId", "techniqueName", "procedure", "date", "externalRef", "risk"];
  const lines = [
    header.join(","),
    ...rows.map(r => [
      escapeCsvField(r.actor),
      escapeCsvField(r.mitreId),
      escapeCsvField(techNameMap[r.mitreId] ?? ""),
      escapeCsvField(r.procedure),
      escapeCsvField(r.date ? new Date(r.date).toLocaleDateString("en-GB") : ""),
      escapeCsvField(r.externalRef),
      escapeCsvField(r.risk),
    ].join(",")),
  ];
  triggerDownload(lines.join("\r\n"), filename, "text/csv");
}

function exportJson(rows: Procedure[], filename: string) {
  const out = rows.map(r => ({
    actor:         r.actor,
    mitreId:       r.mitreId,
    techniqueName: techNameMap[r.mitreId] ?? "",
    procedure:     r.procedure,
    date:          r.date ? new Date(r.date).toLocaleDateString("en-GB") : null,
    externalRef:   r.externalRef,
    risk:          r.risk,
  }));
  triggerDownload(JSON.stringify(out, null, 2), filename, "application/json");
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ──────────────────────────── helpers ────────────────────────────────────────
function matchActor(name: string): string {
  if (!name) return "";
  const lower = name.toLowerCase();
  return baseProcedureActors.find(a => a.toLowerCase() === lower) ?? "";
}

function mitreIdsForTactic(tactic: string): Set<string> {
  if (!tactic) return new Set(allMitreIds);
  return new Set(allMitreIds.filter(id => (techTacticMap[id] ?? []).includes(tactic)));
}

const PAGE_SIZE = 30;

function formatDate(ms: number | null) {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit" });
}

function parseExternalRef(ref: string): { label: string; url: string | null } {
  if (!ref) return { label: "—", url: null };
  const urlMatch = ref.match(/https?:\/\/\S+/);
  const url = urlMatch ? urlMatch[0] : null;
  const label = url ? ref.replace(url, "").replace(/\s*-\s*$/, "").trim() : ref.trim();
  return { label, url };
}

function riskColor(r: number) {
  if (r >= 1500) return "text-red-400 bg-red-400/10 border border-red-400/30";
  if (r >= 1000) return "text-orange-400 bg-orange-400/10 border border-orange-400/30";
  if (r >= 500)  return "text-yellow-400 bg-yellow-400/10 border border-yellow-400/30";
  return "text-green-400 bg-green-400/10 border border-green-400/30";
}

function parseDate(d: string): number | null {
  if (!d) return null;
  const n = Number(d);
  if (!isNaN(n) && n > 1_000_000_000_000) return n;
  const parsed = new Date(d).getTime();
  return isNaN(parsed) ? null : parsed;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      i++;
      let field = "";
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') { field += '"'; i += 2; }
        else if (line[i] === '"') { i++; break; }
        else field += line[i++];
      }
      if (line[i] === ",") i++;
      result.push(field);
    } else {
      let field = "";
      while (i < line.length && line[i] !== ",") field += line[i++];
      if (line[i] === ",") i++;
      result.push(field.trim());
    }
  }
  return result;
}

function parseCSVImport(text: string): Procedure[] {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("CSV must have a header row + at least one data row.");
  const raw = lines[0].split(",").map(h => h.trim().replace(/"/g, "").toLowerCase().replace(/[\s_-]+/g, ""));
  const col = (names: string[]) => raw.findIndex(h => names.includes(h));
  const actorCol    = col(["actor", "actorgroup", "group"]);
  const mitreCol    = col(["mitreid", "technique", "techniqueid"]);
  const procCol     = col(["procedure", "description", "detail"]);
  const dateCol     = col(["date"]);
  const refCol      = col(["externalref", "externalreference", "reference", "ref"]);
  const riskCol     = col(["risk", "riskscore", "score"]);
  if (actorCol < 0) throw new Error("CSV is missing an 'actor' column.");
  if (mitreCol < 0) throw new Error("CSV is missing a 'mitreId' column.");

  return lines.slice(1).map(line => {
    const v = parseCSVLine(line);
    return {
      actor:       v[actorCol]  ?? "",
      mitreId:     v[mitreCol]  ?? "",
      procedure:   procCol >= 0 ? (v[procCol] ?? "") : "",
      date:        dateCol >= 0 ? parseDate(v[dateCol] ?? "") : null,
      externalRef: refCol  >= 0 ? (v[refCol]  ?? "") : "",
      risk:        riskCol >= 0 ? (parseFloat(v[riskCol] ?? "") || 0) : 0,
      _id: uid(),
      _custom: true,
    };
  });
}

function parseJSONImport(text: string): Procedure[] {
  const arr = JSON.parse(text);
  if (!Array.isArray(arr)) throw new Error("JSON must be an array of procedure objects.");
  return arr.map((r: any) => ({
    actor:       String(r.actor ?? r.Actor ?? ""),
    mitreId:     String(r.mitreId ?? r.mitre_id ?? r.technique ?? ""),
    procedure:   String(r.procedure ?? r.description ?? r.detail ?? ""),
    date:        r.date !== undefined ? parseDate(String(r.date)) : null,
    externalRef: String(r.externalRef ?? r.external_ref ?? r.reference ?? ""),
    risk:        parseFloat(r.risk ?? r.riskscore ?? r.score ?? "0") || 0,
    _id: uid(),
    _custom: true,
  }));
}

// ──────────────────────────── sub-components ─────────────────────────────────
function ActorMultiSelect({ selected, onChange, allActors }: {
  selected: Set<string>; onChange: (next: Set<string>) => void; allActors: string[];
}) {
  const [open, setOpen] = useState(false);
  const [chipSearch, setChipSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  function toggle(actor: string) {
    const next = new Set(selected); next.has(actor) ? next.delete(actor) : next.add(actor); onChange(next);
  }

  const visible = chipSearch ? allActors.filter(a => a.toLowerCase().includes(chipSearch.toLowerCase())) : allActors;
  const label = selected.size === 0 ? "All actors" : selected.size === 1 ? [...selected][0] : `${selected.size} actors`;

  return (
    <div className="flex flex-col gap-1 relative" ref={ref}>
      <label className="text-xs text-muted-foreground font-medium">Actor / Group</label>
      <button type="button" onClick={() => setOpen(v => !v)}
        className={`flex items-center justify-between gap-2 bg-input border rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${open ? "border-ring" : "border-border"} ${selected.size > 0 ? "text-primary" : "text-foreground"}`}>
        <span className="truncate">{label}</span>
        <span className="text-muted-foreground flex-shrink-0">{open ? "▲" : "▼"}</span>
      </button>
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {[...selected].map(a => (
            <span key={a} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary">
              {a}<button onClick={() => toggle(a)} className="hover:text-red-400 transition-colors leading-none" title="Remove">×</button>
            </span>
          ))}
          <button onClick={() => onChange(new Set())} className="text-[10px] text-muted-foreground hover:text-foreground underline transition-colors">Clear</button>
        </div>
      )}
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-64 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <input type="search" autoFocus placeholder="Search actors…" value={chipSearch} onChange={e => setChipSearch(e.target.value)}
              className="w-full bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="max-h-56 overflow-y-auto p-2 flex flex-col gap-0.5">
            {visible.length === 0 ? (
              <span className="text-xs text-muted-foreground px-2 py-1">No actors found.</span>
            ) : visible.map(actor => {
              const active = selected.has(actor);
              return (
                <button key={actor} onClick={() => toggle(actor)}
                  className={`flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${active ? "bg-primary/15 text-primary" : "text-foreground hover:bg-accent"}`}>
                  <span className={`w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center text-[9px] transition-colors ${active ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>{active ? "✓" : ""}</span>
                  <span className="truncate">{actor}</span>
                </button>
              );
            })}
          </div>
          {selected.size > 0 && (
            <div className="border-t border-border p-2">
              <button onClick={() => onChange(new Set())} className="w-full text-xs text-muted-foreground hover:text-foreground text-center underline transition-colors">Clear all ({selected.size})</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MitreMultiSelect({ selected, onChange }: {
  selected: Set<string>; onChange: (next: Set<string>) => void;
}) {
  const { isTacticEnabled, isTidEnabled } = useTacticScores();
  const [open, setOpen] = useState(false);
  const [tacticFilter, setTacticFilter] = useState("");
  const [idSearch, setIdSearch] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  const enabledMitreIds = useMemo(() => allMitreIds.filter(isTidEnabled), [isTidEnabled]);
  const enabledTactics = useMemo(() => allTactics.filter(isTacticEnabled), [isTacticEnabled]);
  const tacticIds = useMemo(
    () => new Set(enabledMitreIds.filter(id => !tacticFilter || (techTacticMap[id] ?? []).includes(tacticFilter))),
    [enabledMitreIds, tacticFilter],
  );
  const visible = useMemo(() => {
    let ids = [...tacticIds];
    if (idSearch) ids = ids.filter(id => id.toLowerCase().includes(idSearch.toLowerCase()));
    return ids;
  }, [tacticIds, idSearch]);

  function toggle(id: string) { const next = new Set(selected); next.has(id) ? next.delete(id) : next.add(id); onChange(next); }
  function selectAllVisible() { const next = new Set(selected); visible.forEach(id => next.add(id)); onChange(next); }
  function clearVisible() { const next = new Set(selected); visible.forEach(id => next.delete(id)); onChange(next); }

  const label = selected.size === 0 ? "All IDs" : selected.size === 1 ? [...selected][0] : `${selected.size} techniques`;

  return (
    <div className="flex flex-col gap-1 relative" ref={ref}>
      <label className="text-xs text-muted-foreground font-medium">MITRE ID / Tactic</label>
      <button type="button" onClick={() => setOpen(v => !v)}
        className={`flex items-center justify-between gap-2 bg-input border rounded-lg px-2.5 py-1.5 text-xs text-left transition-colors focus:outline-none focus:ring-2 focus:ring-ring ${open ? "border-ring" : "border-border"} ${selected.size > 0 ? "text-primary" : "text-foreground"}`}>
        <span className="truncate">{label}</span>
        <span className="text-muted-foreground flex-shrink-0">{open ? "▲" : "▼"}</span>
      </button>
      {selected.size > 0 && (
        <div className="flex flex-wrap gap-1 mt-0.5">
          {[...selected].slice(0, 8).map(id => (
            <span key={id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-primary font-mono">
              {id}<button onClick={() => toggle(id)} className="hover:text-red-400 transition-colors leading-none" title="Remove">×</button>
            </span>
          ))}
          {selected.size > 8 && <span className="text-[10px] text-muted-foreground">+{selected.size - 8} more</span>}
          <button onClick={() => onChange(new Set())} className="text-[10px] text-muted-foreground hover:text-foreground underline transition-colors">Clear</button>
        </div>
      )}
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-72 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border space-y-2">
            <select value={tacticFilter} onChange={e => setTacticFilter(e.target.value)}
              className="w-full bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
              <option value="">All tactics ({enabledMitreIds.length} IDs)</option>
              {enabledTactics.map(t => <option key={t} value={t}>{t} ({enabledMitreIds.filter(id => (techTacticMap[id] ?? []).includes(t)).length} IDs)</option>)}
            </select>
            <input type="search" autoFocus placeholder="Search technique ID…" value={idSearch} onChange={e => setIdSearch(e.target.value)}
              className="w-full bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
            <div className="flex gap-2">
              <button onClick={selectAllVisible} className="flex-1 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 hover:bg-accent transition-colors">Select all ({visible.length})</button>
              <button onClick={clearVisible} className="flex-1 text-[10px] text-muted-foreground hover:text-foreground border border-border rounded px-1.5 py-0.5 hover:bg-accent transition-colors">Clear visible</button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-2 flex flex-col gap-0.5">
            {visible.length === 0 ? (
              <span className="text-xs text-muted-foreground px-2 py-1">No techniques found.</span>
            ) : visible.map(id => {
              const active = selected.has(id);
              return (
                <button key={id} onClick={() => toggle(id)}
                  className={`flex items-start gap-2 w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors ${active ? "bg-primary/15 text-primary" : "text-foreground hover:bg-accent"}`}>
                  <span className={`mt-0.5 w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center text-[9px] transition-colors ${active ? "bg-primary border-primary text-primary-foreground" : "border-border"}`}>{active ? "✓" : ""}</span>
                  <span className="flex flex-col min-w-0">
                    <span className="font-mono font-semibold">{id}</span>
                    {(techTacticMap[id] ?? []).length > 0 && <span className="text-[10px] text-muted-foreground truncate">{(techTacticMap[id] ?? []).join(", ")}</span>}
                  </span>
                </button>
              );
            })}
          </div>
          {selected.size > 0 && (
            <div className="border-t border-border p-2">
              <button onClick={() => onChange(new Set())} className="w-full text-xs text-muted-foreground hover:text-foreground text-center underline transition-colors">Clear all ({selected.size})</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ──────────────────────────── import modal ───────────────────────────────────
function ImportModal({ onImport, onClose }: {
  onImport: (rows: Procedure[]) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"csv" | "json">("csv");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<Procedure[] | null>(null);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function parse(raw: string, fmt: "csv" | "json"): Procedure[] {
    return fmt === "csv" ? parseCSVImport(raw) : parseJSONImport(raw);
  }

  function handleText(v: string) {
    setText(v);
    setPreview(null);
    setError("");
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const raw = ev.target?.result as string;
      const detectedTab = f.name.endsWith(".json") ? "json" : "csv";
      setTab(detectedTab);
      setText(raw);
      setPreview(null);
      setError("");
    };
    reader.readAsText(f);
  }

  function handlePreview() {
    try {
      const rows = parse(text, tab);
      if (!rows.length) { setError("No valid rows found."); return; }
      setPreview(rows);
      setError("");
    } catch (e: any) { setError(e.message ?? "Parse error"); setPreview(null); }
  }

  function handleImport() {
    try {
      const rows = preview ?? parse(text, tab);
      onImport(rows);
    } catch (e: any) { setError(e.message ?? "Import failed"); }
  }

  const csvTemplate = `actor,mitreId,procedure,date,externalRef,risk\nFamous Chollima,T1190,Exploited public-facing application,2025-01-15,Reference - https://example.com,1500`;
  const jsonTemplate = `[\n  {\n    "actor": "Famous Chollima",\n    "mitreId": "T1190",\n    "procedure": "Exploited public-facing application",\n    "date": "2025-01-15",\n    "externalRef": "Reference - https://example.com",\n    "risk": 1500\n  }\n]`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl mx-4 overflow-hidden flex flex-col max-h-[90vh]">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div>
            <h3 className="font-semibold text-foreground">Import Procedures</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Upload a CSV or JSON file, or paste content directly</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
        </div>

        {/* tabs */}
        <div className="flex gap-1 px-5 pt-4 flex-shrink-0">
          {(["csv", "json"] as const).map(t => (
            <button key={t} onClick={() => { setTab(t); setPreview(null); setError(""); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${tab === t ? "bg-primary/15 text-primary border-primary/40" : "border-border text-muted-foreground hover:bg-accent"}`}>
              {t === "csv" ? <FileText className="w-3.5 h-3.5" /> : <FileJson className="w-3.5 h-3.5" />}
              {t.toUpperCase()}
            </button>
          ))}
          <div className="flex-1" />
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border border-dashed border-border text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
            <Upload className="w-3.5 h-3.5" /> Choose file
          </button>
          <input ref={fileRef} type="file" accept=".csv,.json,.txt" className="hidden" onChange={handleFile} />
        </div>

        {/* editor */}
        <div className="px-5 pt-3 flex-1 overflow-hidden flex flex-col min-h-0">
          <div className="text-[10px] text-muted-foreground mb-1 flex items-center justify-between">
            <span>Paste {tab.toUpperCase()} content below — required columns: <span className="font-mono text-foreground">actor, mitreId</span></span>
            <button onClick={() => { setText(tab === "csv" ? csvTemplate : jsonTemplate); setPreview(null); setError(""); }}
              className="text-primary hover:underline">Use template</button>
          </div>
          <textarea
            value={text}
            onChange={e => handleText(e.target.value)}
            placeholder={tab === "csv" ? csvTemplate : jsonTemplate}
            spellCheck={false}
            className="flex-1 min-h-[180px] max-h-[260px] w-full bg-input border border-border rounded-lg px-3 py-2 text-xs font-mono text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
        </div>

        {/* error */}
        {error && (
          <div className="mx-5 mt-3 flex items-center gap-2 text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />{error}
          </div>
        )}

        {/* preview */}
        {preview && (
          <div className="mx-5 mt-3 rounded-lg border border-border overflow-hidden flex-shrink-0">
            <div className="px-3 py-2 bg-muted/30 border-b border-border text-xs font-medium text-foreground">
              Preview — {preview.length} row{preview.length !== 1 ? "s" : ""} parsed
            </div>
            <div className="overflow-x-auto max-h-40">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  {["Actor", "MITRE ID", "Procedure", "Date", "Risk"].map(h => (
                    <th key={h} className="px-3 py-1.5 text-left text-muted-foreground font-medium">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {preview.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-b border-border/40 hover:bg-accent/20">
                      <td className="px-3 py-1.5 font-medium max-w-[100px] truncate">{r.actor || "—"}</td>
                      <td className="px-3 py-1.5 font-mono text-primary">{r.mitreId || "—"}</td>
                      <td className="px-3 py-1.5 max-w-[200px] truncate text-muted-foreground">{r.procedure || "—"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{formatDate(r.date)}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{r.risk || 0}</td>
                    </tr>
                  ))}
                  {preview.length > 5 && (
                    <tr><td colSpan={5} className="px-3 py-1.5 text-muted-foreground/60 italic">… and {preview.length - 5} more rows</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border flex-shrink-0 mt-3">
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-accent transition-colors">Cancel</button>
          {!preview ? (
            <button onClick={handlePreview} disabled={!text.trim()}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary/15 text-primary border border-primary/40 hover:bg-primary/25 transition-colors disabled:opacity-40 font-medium">
              Preview
            </button>
          ) : (
            <button onClick={handleImport}
              className="px-4 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium">
              Import {preview.length} row{preview.length !== 1 ? "s" : ""}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────── add procedure form ─────────────────────────────
const BLANK_FORM = { actor: "", mitreId: "", procedure: "", date: "", externalRef: "", risk: "" };

function AddForm({ allActors, onSave, onCancel }: {
  allActors: string[];
  onSave: (p: Procedure) => void;
  onCancel: () => void;
}) {
  const { isTidEnabled } = useTacticScores();
  const [form, setForm] = useState(BLANK_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function validate() {
    const errs: Record<string, string> = {};
    if (!form.actor.trim())   errs.actor   = "Required";
    if (!form.mitreId.trim()) errs.mitreId = "Required";
    else if (!isTidEnabled(form.mitreId.trim().toUpperCase())) errs.mitreId = "This TID belongs to a disabled tactic";
    return errs;
  }

  function handleSave() {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    onSave({
      actor:       toTitleCase(form.actor.trim()),
      mitreId:     form.mitreId.trim().toUpperCase(),
      procedure:   form.procedure.trim(),
      date:        form.date ? parseDate(form.date) : null,
      externalRef: form.externalRef.trim(),
      risk:        parseFloat(form.risk) || 0,
      _id: uid(),
      _custom: true,
    });
  }

  const f = (field: keyof typeof form) => ({
    value: form[field],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      setForm(prev => ({ ...prev, [field]: e.target.value }));
      if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
    },
  });

  const inputCls = (err?: string) =>
    `bg-input border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-full ${err ? "border-red-500" : "border-border"}`;

  return (
    <tr className="border-b border-border/50 bg-primary/5">
      <td className="px-4 py-3 text-muted-foreground font-mono text-xs">+</td>
      <td className="px-2 py-3">
        <div>
          <input list="actor-list" placeholder="Actor name" {...f("actor")} className={inputCls(errors.actor)} />
          <datalist id="actor-list">{allActors.map(a => <option key={a} value={a} />)}</datalist>
          {errors.actor && <p className="text-[10px] text-red-400 mt-0.5">{errors.actor}</p>}
        </div>
      </td>
      <td className="px-2 py-3">
        <div>
          <input list="mitre-list" placeholder="T1190" {...f("mitreId")} className={inputCls(errors.mitreId)} />
          <datalist id="mitre-list">{allMitreIds.filter(isTidEnabled).map(id => <option key={id} value={id} />)}</datalist>
          {errors.mitreId && <p className="text-[10px] text-red-400 mt-0.5">{errors.mitreId}</p>}
        </div>
      </td>
      <td className="px-2 py-3" colSpan={1}>
        <textarea placeholder="Procedure description…" {...f("procedure")} rows={2}
          className="bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring w-full resize-none" />
      </td>
      <td className="px-2 py-3">
        <input type="date" {...f("date")} className={`${inputCls()} [color-scheme:dark]`} />
      </td>
      <td className="px-2 py-3">
        <input placeholder="Title - https://..." {...f("externalRef")} className={inputCls()} />
      </td>
      <td className="px-2 py-3">
        <input type="number" placeholder="0" {...f("risk")} className={inputCls()} />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1">
          <button onClick={handleSave} className="p-1 rounded text-green-400 hover:bg-green-400/10 transition-colors" title="Save"><Check className="w-3.5 h-3.5" /></button>
          <button onClick={onCancel} className="p-1 rounded text-muted-foreground hover:bg-accent transition-colors" title="Cancel"><X className="w-3.5 h-3.5" /></button>
        </div>
      </td>
    </tr>
  );
}

// ──────────────────────────── main component ─────────────────────────────────
export default function AllProcedures() {
  const search = useSearch();
  const { liveActorData, clearLiveActorData } = useAppData();
  const { overrides: tacticOverrides, isTidEnabled } = useTacticScores();
  const { overrides: likelihoodOverrides } = useLikelihood();
  const { overrides: impactOverrides }     = useImpactOverrides();
  const { hvaScoreMap }                    = useHVAScores();
  const { dateRange, fromMs: winFromMs, toMs: winToMs } = useDateWindow();

  // Dynamic risk score map — same computation as Risk Calculation page so that
  // any TID shows the same risk score across all pages after CIA/HVA overrides.
  const riskScoreMap = useMemo(() => {
    const computed = applyOverrides(
      (baseFullRiskCalc as any[]).filter(row => isTidEnabled(row.TID)),
      tacticOverrides, likelihoodOverrides, impactOverrides, hvaScoreMap
    );
    const map: Record<string, number> = {};
    for (const r of computed) map[r.TID] = r["Risk Scores"] ?? 0;
    return map;
  }, [tacticOverrides, likelihoodOverrides, impactOverrides, hvaScoreMap, isTidEnabled]);

  const [customProcs, setCustomProcs] = useState<Procedure[]>(loadCustom);

  // Live procedures from CrowdStrike sync — mapped to the local Procedure type.
  // Risk is normalised to the analytical model (Impact × Likelihood) to keep it
  // consistent with Risk Calculation and TID Priority, regardless of which formula
  // was used when the data was originally pushed.
  const liveProcs = useMemo<Procedure[]>(() => {
    if (!liveActorData || liveActorData.procedures.length === 0) return [];
    return liveActorData.procedures.map((p, i) => ({
      actor:       p.actor,
      mitreId:     p.mitreId,
      externalRef: p.externalRef ?? "",
      procedure:   p.procedure ?? "",
      date:        p.date,
      risk:        riskScoreMap[p.mitreId] ?? p.risk,
      _id:         `live_${i}`,
    }));
  }, [liveActorData, riskScoreMap]);

  // All procedures: base data.json + manually added custom + live CrowdStrike procedures
  const allProcedures = useMemo(
    () => [...baseProcedures, ...customProcs, ...liveProcs].filter(procedure => isTidEnabled(procedure.mitreId)),
    [customProcs, liveProcs, isTidEnabled]
  );

  const allActors = useMemo(() => Array.from(
    new Set(allProcedures.map(r => r.actor).filter(Boolean))
  ).sort(), [allProcedures]);

  // Set of actor names present in the Actor Prioritisation table (base − deleted + custom)
  const prioritisedActorSet = useMemo<Set<string>>(() => {
    const base: string[] = ((data as any).actors ?? []).map((a: any) => toTitleCase(a.name));
    const ovRaw: Record<string, { deleted?: boolean }> = (() => {
      try { return JSON.parse(localStorage.getItem("pt_actor_overrides") ?? "{}"); } catch { return {}; }
    })();
    const deleted = new Set(
      Object.entries(ovRaw).filter(([, v]) => v.deleted).map(([k]) => toTitleCase(k))
    );
    const custom: string[] = (() => {
      try { return (JSON.parse(localStorage.getItem("pt_actor_custom") ?? "[]") as any[]).map((a: any) => toTitleCase(a.name)); }
      catch { return []; }
    })();
    return new Set([...base.filter(n => !deleted.has(n)), ...custom]);
  }, []);

  const [selectedActors, setSelectedActors] = useState<Set<string>>(() => {
    const params = new URLSearchParams(search);
    const actor = matchActor(params.get("actor") ?? "");
    return actor ? new Set([actor]) : new Set();
  });

  const [selectedMitreIds, setSelectedMitreIds] = useState<Set<string>>(() => {
    const params = new URLSearchParams(search);
    const mitre = params.get("mitre") ?? "";
    if (mitre && allMitreIds.includes(mitre) && isTidEnabled(mitre)) return new Set([mitre]);
    const tactic = params.get("tactic") ?? "";
    if (tactic) return new Set([...mitreIdsForTactic(tactic)].filter(isTidEnabled));
    return new Set();
  });

  const [procedureSearch, setProcedureSearch] = useState("");
  const [minRisk, setMinRisk] = useState("");
  const [maxRisk, setMaxRisk] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);

  const [showAddForm, setShowAddForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showCustomOnly, setShowCustomOnly] = useState(false);
  const [showPrioritisedOnly, setShowPrioritisedOnly] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node))
        setShowExportMenu(false);
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const actor = matchActor(params.get("actor") ?? "");
    setSelectedActors(actor ? new Set([actor]) : new Set());
    const mitre = params.get("mitre") ?? "";
    const tactic = params.get("tactic") ?? "";
    if (mitre && allMitreIds.includes(mitre) && isTidEnabled(mitre)) setSelectedMitreIds(new Set([mitre]));
    else if (tactic) setSelectedMitreIds(new Set([...mitreIdsForTactic(tactic)].filter(isTidEnabled)));
    else setSelectedMitreIds(new Set());
    setPage(1);
  }, [search, isTidEnabled]);

  function addCustom(p: Procedure) {
    const next = [...customProcs, p];
    setCustomProcs(next);
    saveCustom(next);
    setShowAddForm(false);
  }

  function importRows(rows: Procedure[]) {
    const next = [...customProcs, ...rows];
    setCustomProcs(next);
    saveCustom(next);
    setShowImport(false);
  }

  function deleteCustom(id: string) {
    const next = customProcs.filter(p => p._id !== id);
    setCustomProcs(next);
    saveCustom(next);
  }

  function clearAllCustom() {
    setCustomProcs([]);
    saveCustom([]);
  }

  // Normalise all procedure risk scores to the dynamically-computed values so
  // the same TID shows the same risk in All Procedures and in Risk Calculation.
  const normalizedAllProcedures = useMemo(
    () => allProcedures.map(p => ({ ...p, risk: riskScoreMap[p.mitreId] ?? p.risk })),
    [allProcedures, riskScoreMap]
  );

  const filtered = useMemo(() => {
    const lo = minRisk !== "" ? Number(minRisk) : -Infinity;
    const hi = maxRisk !== "" ? Number(maxRisk) : Infinity;
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : -Infinity;
    const toMs   = dateTo   ? new Date(dateTo).getTime() + 86400000 - 1 : Infinity;
    return normalizedAllProcedures.filter(row => {
      // Global date window (set from sidebar) — applied on top of local date filter
      if (dateRange !== "all" && (row.date === null || row.date < winFromMs || row.date > winToMs)) return false;
      if (showCustomOnly && !row._custom) return false;
      if (showPrioritisedOnly && !prioritisedActorSet.has(row.actor)) return false;
      if (selectedActors.size > 0 && !selectedActors.has(row.actor)) return false;
      if (selectedMitreIds.size > 0 && !selectedMitreIds.has(row.mitreId)) return false;
      if (procedureSearch && !row.procedure.toLowerCase().includes(procedureSearch.toLowerCase())) return false;
      if (row.risk < lo || row.risk > hi) return false;
      if (row.date !== null && (row.date < fromMs || row.date > toMs)) return false;
      return true;
    });
  }, [normalizedAllProcedures, showCustomOnly, showPrioritisedOnly, prioritisedActorSet, selectedActors, selectedMitreIds, procedureSearch, minRisk, maxRisk, dateFrom, dateTo, dateRange, winFromMs, winToMs]);

  const { sortKey, sortDir, toggle, sorted: sortedFiltered } = useSortTable(filtered);

  const totalPages = Math.max(1, Math.ceil(sortedFiltered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const pageRows   = sortedFiltered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function handleFilterChange(fn: () => void) { fn(); setPage(1); }
  function clearAll() {
    setSelectedActors(new Set()); setSelectedMitreIds(new Set());
    setProcedureSearch(""); setMinRisk(""); setMaxRisk("");
    setDateFrom(""); setDateTo(""); setShowCustomOnly(false); setShowPrioritisedOnly(false); setPage(1);
  }

  const hasFilters = selectedActors.size > 0 || selectedMitreIds.size > 0 || procedureSearch || minRisk || maxRisk || dateFrom || dateTo || showCustomOnly || showPrioritisedOnly;

  return (
    <div className="p-6 space-y-5">
      {showImport && <ImportModal onImport={importRows} onClose={() => setShowImport(false)} />}

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">All Procedures</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Full procedure list from MITRE ATT&amp;CK —{" "}
            <span className="text-foreground font-medium">{baseProcedures.length.toLocaleString()}</span> base
            {customProcs.length > 0 && (
              <span className="text-chart-2"> + {customProcs.length.toLocaleString()} custom</span>
            )}
            {liveProcs.length > 0 && (
              <span className="text-chart-4"> + {liveProcs.length.toLocaleString()} live</span>
            )}
            {" "}= <span className="text-foreground font-medium">{allProcedures.length.toLocaleString()}</span> entries
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => { setShowAddForm(v => !v); setShowImport(false); }}
            className={`flex items-center gap-1.5 text-xs font-medium border rounded-lg px-3 py-1.5 transition-colors ${showAddForm ? "bg-primary text-primary-foreground border-primary" : "text-primary border-primary/40 bg-primary/10 hover:bg-primary/20"}`}
          >
            {showAddForm ? <ChevronUp className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            Add Procedure
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg px-3 py-1.5 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" /> Import CSV / JSON
          </button>
          <div className="relative" ref={exportMenuRef}>
            <button
              onClick={() => setShowExportMenu(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium border border-border text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg px-3 py-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" /> Export
              <ChevronDown className={`w-3 h-3 transition-transform ${showExportMenu ? "rotate-180" : ""}`} />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 top-full mt-1 z-50 w-52 bg-card border border-border rounded-xl shadow-xl overflow-hidden">
                <div className="px-3 py-2 border-b border-border">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">
                    Export {sortedFiltered.length.toLocaleString()} filtered row{sortedFiltered.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <div className="p-1.5 flex flex-col gap-0.5">
                  <button
                    onClick={() => { exportCsv(sortedFiltered, "procedures.csv"); setShowExportMenu(false); }}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-xs text-foreground hover:bg-accent transition-colors"
                  >
                    <FileText className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <div className="font-medium">Download CSV</div>
                      <div className="text-[10px] text-muted-foreground">Spreadsheet-compatible</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { exportJson(sortedFiltered, "procedures.json"); setShowExportMenu(false); }}
                    className="flex items-center gap-2 w-full text-left px-3 py-2 rounded-lg text-xs text-foreground hover:bg-accent transition-colors"
                  >
                    <FileJson className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <div>
                      <div className="font-medium">Download JSON</div>
                      <div className="text-[10px] text-muted-foreground">Machine-readable array</div>
                    </div>
                  </button>
                </div>
              </div>
            )}
          </div>
          {customProcs.length > 0 && (
            <button onClick={clearAllCustom}
              className="flex items-center gap-1.5 text-xs text-red-400/70 hover:text-red-400 border border-red-400/20 hover:border-red-400/40 rounded-lg px-2.5 py-1.5 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Clear custom ({customProcs.length})
            </button>
          )}
        </div>
      </div>

      {/* ── Live data indicator ──────────────────────────────────────────── */}
      {liveActorData && liveProcs.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-chart-4/10 border border-chart-4/30 rounded-xl">
          <Activity className="w-4 h-4 text-chart-4 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <span className="text-xs font-semibold text-chart-4">Live Procedures Merged</span>
            <span className="text-xs text-muted-foreground ml-2">{liveActorData.label}</span>
            <span className="text-xs text-muted-foreground ml-2">·</span>
            <span className="text-xs text-muted-foreground ml-2">
              +{liveProcs.length.toLocaleString()} procedures from CrowdStrike sync
            </span>
          </div>
          <button
            onClick={clearLiveActorData}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-red-400 transition-colors flex-shrink-0"
            title="Clear live procedures"
          >
            <XCircle className="w-3.5 h-3.5" />Clear
          </button>
        </div>
      )}

      {/* filters */}
      <div className="bg-card border border-card-border rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Filters</span>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
              <input type="checkbox" checked={showPrioritisedOnly} onChange={e => { setShowPrioritisedOnly(e.target.checked); setPage(1); }}
                className="w-3 h-3 rounded border-border accent-primary" />
              Prioritised actors only
            </label>
            {customProcs.length > 0 && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                <input type="checkbox" checked={showCustomOnly} onChange={e => { setShowCustomOnly(e.target.checked); setPage(1); }}
                  className="w-3 h-3 rounded border-border accent-primary" />
                Custom only
              </label>
            )}
            {hasFilters && <button onClick={clearAll} className="text-xs text-muted-foreground hover:text-foreground underline transition-colors">Clear all</button>}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 items-start">
          <ActorMultiSelect selected={selectedActors} onChange={next => { setSelectedActors(next); setPage(1); }} allActors={allActors} />
          <MitreMultiSelect selected={selectedMitreIds} onChange={next => { setSelectedMitreIds(next); setPage(1); }} />
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Procedure Search</label>
            <input type="search" placeholder="Search text…" value={procedureSearch}
              onChange={e => handleFilterChange(() => setProcedureSearch(e.target.value))}
              className="bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Risk Min</label>
            <input type="number" placeholder="e.g. 500" value={minRisk}
              onChange={e => handleFilterChange(() => setMinRisk(e.target.value))}
              className="bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">Risk Max</label>
            <input type="number" placeholder="e.g. 1800" value={maxRisk}
              onChange={e => handleFilterChange(() => setMaxRisk(e.target.value))}
              className="bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground font-medium">Date From</label>
              <input type="date" value={dateFrom} onChange={e => handleFilterChange(() => setDateFrom(e.target.value))}
                className="bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:dark]" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground font-medium">Date To</label>
              <input type="date" value={dateTo} onChange={e => handleFilterChange(() => setDateTo(e.target.value))}
                className="bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:dark]" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <span className="text-xs text-muted-foreground">
            Showing <span className="text-foreground font-semibold">{filtered.length.toLocaleString()}</span> of {allProcedures.length.toLocaleString()} procedures
          </span>
        </div>
      </div>

      {/* table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <SortableTh col="actor"   sortKey={sortKey} sortDir={sortDir} toggle={toggle}>Actor / Group</SortableTh>
                <SortableTh col="mitreId" sortKey={sortKey} sortDir={sortDir} toggle={toggle}>MITRE ID</SortableTh>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium whitespace-nowrap">Technique Name</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Procedure</th>
                <SortableTh col="date" sortKey={sortKey} sortDir={sortDir} toggle={toggle}>Date</SortableTh>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">External Reference</th>
                <SortableTh col="risk" sortKey={sortKey} sortDir={sortDir} toggle={toggle} align="left">Risk Score</SortableTh>
                <th className="w-10 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {/* inline add form */}
              {showAddForm && (
                <AddForm
                  allActors={allActors}
                  onSave={addCustom}
                  onCancel={() => setShowAddForm(false)}
                />
              )}

              {pageRows.length === 0 && !showAddForm ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-sm text-muted-foreground">
                    No procedures match the current filters.
                  </td>
                </tr>
              ) : pageRows.map((row, i) => (
                <tr key={row._id ?? i}
                  className={`border-b border-border/50 transition-colors ${row._custom ? "bg-chart-2/5 hover:bg-chart-2/10" : "hover:bg-accent/30"}`}>
                  <td className="px-4 py-2.5 text-xs font-medium text-foreground">
                    <div className="flex items-center gap-1.5">
                      {row.actor}
                      {row._custom && <span className="text-[9px] px-1 py-0.5 rounded bg-chart-2/20 text-chart-2 border border-chart-2/30 font-medium flex-shrink-0">custom</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 whitespace-nowrap">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs font-mono bg-primary/10 text-primary px-2 py-0.5 rounded border border-primary/20 w-fit">{row.mitreId}</span>
                      {(techTacticMap[row.mitreId] ?? []).length > 0 && (
                        <span className="text-[10px] text-muted-foreground leading-tight">{(techTacticMap[row.mitreId] ?? []).join(", ")}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-foreground">
                    {techNameMap[row.mitreId] ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    <p>{row.procedure}</p>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground whitespace-nowrap">{formatDate(row.date)}</td>
                  <td className="px-4 py-2.5 text-xs">
                    {(() => {
                      const { label, url } = parseExternalRef(row.externalRef);
                      return (
                        <div className="space-y-0.5">
                          <p className="text-muted-foreground">{label || "—"}</p>
                          {url && (
                            <a href={url} target="_blank" rel="noopener noreferrer"
                              className="text-primary hover:underline block text-[10px]" title={url}>
                              ↗ {url}
                            </a>
                          )}
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskColor(row.risk)}`}>
                      {row.risk.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {row._custom && (
                      <button onClick={() => deleteCustom(row._id!)}
                        className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors" title="Delete this procedure">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
            <span className="text-xs text-muted-foreground">Page {safePage} of {totalPages}</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setPage(1)} disabled={safePage === 1}
                className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors">«</button>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={safePage === 1}
                className="px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors">‹ Prev</button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                const start = Math.max(1, Math.min(safePage - 3, totalPages - 6));
                return start + i;
              }).map(n => (
                <button key={n} onClick={() => setPage(n)}
                  className={`px-2.5 py-1 text-xs rounded border transition-colors ${n === safePage ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-accent"}`}>
                  {n}
                </button>
              ))}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={safePage === totalPages}
                className="px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next ›</button>
              <button onClick={() => setPage(totalPages)} disabled={safePage === totalPages}
                className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors">»</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
