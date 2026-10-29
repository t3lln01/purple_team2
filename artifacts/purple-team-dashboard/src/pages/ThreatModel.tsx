import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import threatModelData from "@/threatModelData.json";
import dashboardData from "@/data.json";
import { useSortTable } from "@/hooks/useSortTable";
import SortableTh from "@/components/SortableTh";
import AssessmentReviewPanel from "@/components/AssessmentReviewPanel";
import { useAppData } from "@/context/AppDataContext";
import { useTacticScores } from "@/context/TacticScoresContext";
import { generateQuarterlyAssessments, sourceQuarterForAssessment, type AutoAssessment, type ScoringContext } from "@/utils/quarterlyAutoScoring";
import { useThreatModelQuarter } from "@/context/ThreatModelQuarterContext";
import {
  ChevronDown, ChevronRight, Shield, Target, Zap, Globe, X,
  RefreshCw, Plus, Check, AlertCircle, Search, Eye, EyeOff,
  Loader2, Trash2, Edit2, BookOpen, Pencil, Tag, ListX, ArrowUp,
  History, ChevronDown as ChevronDownSm, Save, ClipboardCheck, Upload, FileSpreadsheet,
} from "lucide-react";

const CS_API = "/api";

// ── Types ──────────────────────────────────────────────────────────────────────

type BaseActor = {
  name: string;
  origins: string;
  aliases: string;
  actorType: string;
  lastSeen: string | null;
  malware: string;
  countries: string[];
  industries: string[];
  intent: string;
  intentScore: number | null;
  willingness: string;
  pptap: number;
  sirt: number;
  willingnessScore: number | null;
  capabilities: string;
  capabilitiesScore: number | null;
  novelty: string;
  noveltyScore: number | null;
  intentFinalScore: number | null;
  capabilityFinalScore: number | null;
  motivation: string;
  adversaryType: string;
  communityIds: string;
  inMonitoringList: boolean;
};

type CustomActor = {
  name: string;
  origins: string;
  aliases: string;
  actorType: string;
  lastSeen: string | null;
  malware: string;
  countries: string[];
  industries: string[];
  intentFinalScore: number | null;
  capabilityFinalScore: number | null;
  willingnessScore: number | null;
  motivation: string;
  adversaryType: string;
  communityIds: string;
  inMonitoringList: boolean;
  isCustom: boolean;
  csEnriched: boolean;
  csLastRefreshed: string | null;
  description: string;
  csRawData?: Record<string, unknown> | null;
} & RubricScores;

type RubricScores = {
  intentRationale?: string;
  willingnessRationale?: string;
  capabilityRationale?: string;
  noveltyRationale?: string;
  intentBaseScore?: number | null;
  willingnessModifier?: number | null;
  capabilityBaseScore?: number | null;
  noveltyModifier?: number | null;
};

type ActorOverride = {
  inMonitoringList?: boolean;
  csEnriched?: boolean;
  csLastRefreshed?: string | null;
  csData?: Partial<CustomActor>;
  intentFinalScore?: number | null;     // derived: intentBaseScore + willingnessModifier
  capabilityFinalScore?: number | null; // derived: capabilityBaseScore + noveltyModifier
} & RubricScores;

type AutoAssessmentMap = Record<string, AutoAssessment>;

type QuarterSnapshot = {
  customActors: CustomActor[];
  actorOverrides: Record<string, ActorOverride>;
  ppTapList: string[];
  sirtList: string[];
  autoAssessments: AutoAssessmentMap;
  monitoringState: Record<string, boolean>;
};

type MergedActor = BaseActor & {
  isCustom: boolean;
  csEnriched: boolean;
  csLastRefreshed: string | null;
  description: string;
  /** monitoring is the resolved value after override */
  monitored: boolean;
  /** Effective scores after applying manual overrides + PP-TAP/SIRT bonuses */
  effectiveIntentScore: number;
  effectiveCapabilityScore: number;
  inPpTap: boolean;
  inSirt: boolean;
  /** Resolved rubric selections (override wins over static data) */
  intentRationale: string;
  willingnessRationale: string;
  capabilityRationale: string;
  noveltyRationale: string;
  intentBaseScore: number | null;
  willingnessModifier: number | null;
  capabilityBaseScore: number | null;
  noveltyModifier: number | null;
};

// ── Static data ────────────────────────────────────────────────────────────────

const staticActors = (threatModelData as any).threatModelActors as BaseActor[];
const scoringFramework = (threatModelData as any).scoringFramework as any[];

// ── Rubric option arrays (derived from scoringFramework) ────────────────────
const INTENT_OPTIONS     = scoringFramework.filter((r: any) => r.intent).map((r: any) => ({ text: r.intent as string, score: r.intentScore as number }));
const WILLINGNESS_OPTIONS = scoringFramework.filter((r: any) => r.willingness).map((r: any) => ({ text: r.willingness as string, score: r.willingnessScore as number }));
const CAPABILITY_OPTIONS  = scoringFramework.filter((r: any) => r.capability).map((r: any) => ({ text: r.capability as string, score: r.capabilityScore as number }));
const NOVELTY_OPTIONS     = scoringFramework.filter((r: any) => r.novelty).map((r: any) => ({ text: r.novelty as string, score: r.noveltyScore as number }));

// Actor names seeded from Excel pptap/sirt fields (used to pre-populate lists)
const SEED_PPTAP: string[] = staticActors
  .filter(a => (a as any).pptap > 0)
  .map(a => a.name);

const SEED_SIRT: string[] = staticActors
  .filter(a => (a as any).sirt > 0)
  .map(a => a.name);

// ── Helpers ────────────────────────────────────────────────────────────────────

function actorTypeShort(type: string | undefined | null) {
  if (!type) return "Unknown";
  if (type.includes("Espionage")) return "Espionage";
  if (type.includes("Destructive")) return "Destructive";
  if (type.includes("Disruptive")) return "Disruptive";
  if (type.includes("Cyber-Crime") || type.includes("eCrime") || type.toLowerCase().includes("crime")) return "eCrime";
  return type || "Unknown";
}

function actorTypeColor(type: string) {
  const s = actorTypeShort(type);
  if (s === "Espionage")   return "text-blue-400 bg-blue-400/10 border border-blue-400/30";
  if (s === "Destructive") return "text-red-400 bg-red-400/10 border border-red-400/30";
  if (s === "Disruptive")  return "text-orange-400 bg-orange-400/10 border border-orange-400/30";
  if (s === "eCrime")      return "text-yellow-400 bg-yellow-400/10 border border-yellow-400/30";
  return "text-muted-foreground bg-muted/30 border border-border";
}

function originFlag(origin: string) {
  if (!origin) return "🌐";
  if (origin.includes("China") || origin.includes("East Asia")) return "🇨🇳";
  if (origin.includes("Russia") || origin.includes("Russian")) return "🇷🇺";
  if (origin.includes("Iran") || origin.includes("Middle East")) return "🇮🇷";
  if (origin.includes("North Korea")) return "🇰🇵";
  if (origin.includes("Pakistan")) return "🇵🇰";
  if (origin.includes("India")) return "🇮🇳";
  if (origin.includes("Israel")) return "🇮🇱";
  if (origin.includes("Brazil") || origin.includes("South America")) return "🇧🇷";
  if (origin.includes("Nigeria")) return "🇳🇬";
  if (origin.includes("Colombia")) return "🇨🇴";
  if (origin.includes("United States")) return "🇺🇸";
  if (origin.includes("United Kingdom")) return "🇬🇧";
  if (origin.includes("Vietnam")) return "🇻🇳";
  if (origin.includes("Turkey")) return "🇹🇷";
  return "🌐";
}

function scoreBar(value: number, max: number = 6, color = "bg-primary") {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-mono font-semibold w-4 text-right">{value}</span>
    </div>
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** Returns the latest published view. Views are created on quarter boundaries. */
function currentQuarterLabel(): string {
  const now = new Date();
  const month = now.getMonth() + 1; // 1–12
  const year  = now.getFullYear();
  let q: number;
  let qYear = year;
  if (month === 1)       { q = 4; qYear = year - 1; }
  else if (month <= 4)   { q = 1; }
  else if (month <= 7)   { q = 2; }
  else if (month <= 10)  { q = 3; }
  else                   { q = 4; }
  return `Q${q} ${qYear}`;
}

const QUARTER_LABEL = currentQuarterLabel();

/** Generate every quarter from Q1 2025 up to (and including) the current quarter */
function generateAllQuarters(): string[] {
  const quarters: string[] = [];
  const match = QUARTER_LABEL.match(/Q(\d) (\d+)/);
  if (!match) return [QUARTER_LABEL];
  const curQ    = parseInt(match[1], 10);
  const curYear = parseInt(match[2], 10);
  let q = 1; let year = 2025;
  while (year < curYear || (year === curYear && q <= curQ)) {
    quarters.push(`Q${q} ${year}`);
    q++;
    if (q > 4) { q = 1; year++; }
  }
  return quarters;
}

const ALL_QUARTERS = generateAllQuarters();

const LS_KEY = "tm-state-v1";
function saveToLocalStorage(state: {
  customActors: CustomActor[];
  actorOverrides: Record<string, ActorOverride>;
  ppTapList: string[];
  sirtList: string[];
  autoAssessments: AutoAssessmentMap;
  monitoringState: Record<string, boolean>;
}) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch { /* quota */ }
}
function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Returns true if the actor's name or malware field matches any item in the list */
function matchesList(actorName: string, malware: string, list: string[]): boolean {
  if (!list.length) return false;
  const nameUpper = actorName.toUpperCase();
  const malwareUpper = (malware ?? "").toUpperCase();
  return list.some(item => {
    const t = item.trim().toUpperCase();
    if (!t) return false;
    return nameUpper === t || malwareUpper.includes(t);
  });
}

function deriveLegacyMonitoringState(
  customActors: CustomActor[],
  actorOverrides: Record<string, ActorOverride>,
): Record<string, boolean> {
  const state: Record<string, boolean> = {};
  for (const actor of staticActors) {
    state[actor.name] = actorOverrides[actor.name]?.inMonitoringList ?? actor.inMonitoringList;
  }
  for (const actor of customActors) {
    state[actor.name] = actor.inMonitoringList;
  }
  return state;
}

function malwareTags(value: string | undefined): string[] {
  return (value ?? "")
    .replace(/Malware developed|Malware used/gi, "")
    .split(/,\s*|;\s*|\n+/)
    .map(item => item.trim())
    .filter(Boolean);
}

/** Parse one-column Excel pastes and simple CSV/TSV/TXT uploads into unique entries. */
function parseBulkEntries(value: string): string[] {
  const entries: string[] = [];
  const seen = new Set<string>();
  for (const row of value.split(/\r?\n/)) {
    for (const cell of row.split(/[\t,;]/)) {
      const entry = cell.trim().replace(/^["']|["']$/g, "").trim();
      if (!entry) continue;
      const key = entry.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(key);
    }
  }
  return entries;
}

// ── Per-actor row ──────────────────────────────────────────────────────────────

function ActorRow({
  actor,
  onRefresh,
  onToggleMonitor,
  onDelete,
  onSaveScores,
  refreshing,
}: {
  actor: MergedActor;
  onRefresh: (name: string) => void;
  onToggleMonitor: (name: string) => void;
  onDelete?: (name: string) => void;
  onSaveScores: (name: string, scores: {
    intentFinalScore: number | null;
    capabilityFinalScore: number | null;
  } & RubricScores) => void;
  refreshing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editIntentText, setEditIntentText]         = useState<string>("");
  const [editWillingnessText, setEditWillingnessText] = useState<string>("");
  const [editCapabilityText, setEditCapabilityText] = useState<string>("");
  const [editNoveltyText, setEditNoveltyText]       = useState<string>("");

  const typeShort = actorTypeShort(actor.actorType);
  const typeColor = actorTypeColor(actor.actorType);
  const flag = originFlag(actor.origins);
  const combined = actor.effectiveIntentScore + actor.effectiveCapabilityScore;
  const riskPct = combined / 13;

  // Live rubric selections while editing
  const selIntent   = INTENT_OPTIONS.find(o => o.text === editIntentText) ?? null;
  const selWill     = WILLINGNESS_OPTIONS.find(o => o.text === editWillingnessText) ?? null;
  const selCap      = CAPABILITY_OPTIONS.find(o => o.text === editCapabilityText) ?? null;
  const selNovelty  = NOVELTY_OPTIONS.find(o => o.text === editNoveltyText) ?? null;
  const previewIntent = selIntent ? selIntent.score + (selWill?.score ?? 0) : null;
  const previewCap    = selCap ? selCap.score + (selNovelty?.score ?? 0) : null;

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    // Pre-populate from stored rubric selections or try to match static text
    setEditIntentText(actor.intentRationale ?? "");
    setEditWillingnessText(actor.willingnessRationale ?? "");
    setEditCapabilityText(actor.capabilityRationale ?? "");
    setEditNoveltyText(actor.noveltyRationale ?? "");
    setEditing(true);
    setExpanded(true);
  }

  function saveEdit(e: React.MouseEvent) {
    e.stopPropagation();
    const intentFinal = selIntent ? selIntent.score + (selWill?.score ?? 0) : null;
    const capFinal    = selCap    ? selCap.score    + (selNovelty?.score ?? 0) : null;
    onSaveScores(actor.name, {
      intentFinalScore: intentFinal,
      capabilityFinalScore: capFinal,
      intentRationale: editIntentText || undefined,
      willingnessRationale: editWillingnessText || undefined,
      capabilityRationale: editCapabilityText || undefined,
      noveltyRationale: editNoveltyText || undefined,
      intentBaseScore: selIntent?.score ?? null,
      willingnessModifier: selWill?.score ?? null,
      capabilityBaseScore: selCap?.score ?? null,
      noveltyModifier: selNovelty?.score ?? null,
    });
    setEditing(false);
  }

  function cancelEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setEditing(false);
  }

  const bonusIntent = (actor.inPpTap ? 1 : 0) + (actor.inSirt ? 2 : 0);
  const actorDescription = actor.description?.trim()
    || [
      `${actor.name} is a ${actorTypeShort(actor.actorType).toLowerCase()} threat actor${actor.origins ? ` associated with ${actor.origins}` : ""}.`,
      actor.motivation ? `Its reported motivation is ${actor.motivation}.` : "",
      actor.industries?.length ? `Reported target industries include ${actor.industries.slice(0, 5).join(", ")}.` : "",
      actor.malware ? `Associated malware and tools include ${malwareTags(actor.malware).slice(0, 8).join(", ")}.` : "",
    ].filter(Boolean).join(" ");

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-accent/20 transition-colors"
        onClick={() => !editing && setExpanded(v => !v)}
      >
        <td className="px-3 py-3 w-8 cursor-pointer">
          <span className="text-muted-foreground">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        </td>
        <td className="px-3 py-3 cursor-pointer">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-sm text-foreground font-mono">{actor.name}</span>
            {actor.monitored && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-primary/20 text-primary border border-primary/30">MONITORED</span>
            )}
            {actor.isCustom && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-400/30">CUSTOM</span>
            )}
            {actor.csEnriched && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-cyan-500/15 text-cyan-400 border border-cyan-400/30">CS LIVE</span>
            )}
            {actor.inPpTap && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 border border-amber-400/30">PP-TAP +1</span>
            )}
            {actor.inSirt && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/15 text-red-400 border border-red-400/30">SIRT +2</span>
            )}
          </div>
          {actor.aliases && (
            <div className="text-[11px] text-muted-foreground mt-0.5 max-w-xs truncate">{actor.aliases}</div>
          )}
        </td>
        <td className="px-3 py-3 cursor-pointer">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>{flag}</span>
            <span className="truncate max-w-[120px]">{actor.origins || "Unknown"}</span>
          </div>
        </td>
        <td className="px-3 py-3 cursor-pointer">
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${typeColor}`}>
            {typeShort}
          </span>
        </td>
        <td className="px-3 py-3 text-xs text-muted-foreground font-mono cursor-pointer">
          {fmtDate(actor.lastSeen)}
          {actor.csEnriched && actor.csLastRefreshed && (
            <div className="text-[10px] text-cyan-400/70 mt-0.5">↺ {fmtDate(actor.csLastRefreshed)}</div>
          )}
        </td>
        {/* Intent cell */}
        <td className="px-3 py-3 min-w-[140px]">
          <div>
            {scoreBar(editing && previewIntent !== null ? Math.min(7, previewIntent + bonusIntent) : actor.effectiveIntentScore, 7, "bg-amber-500")}
            {editing && previewIntent !== null && (
              <div className="text-[10px] text-amber-400/70 mt-0.5 font-mono">
                preview: {previewIntent}{bonusIntent > 0 ? ` +${bonusIntent}` : ""} = {Math.min(7, previewIntent + bonusIntent)}/7
              </div>
            )}
            {!editing && bonusIntent > 0 && (
              <div className="flex items-center gap-0.5 mt-0.5">
                <ArrowUp className="w-2.5 h-2.5 text-amber-400" />
                <span className="text-[10px] text-amber-400/70">+{bonusIntent} bonus</span>
              </div>
            )}
          </div>
        </td>
        {/* Capability cell */}
        <td className="px-3 py-3 min-w-[120px]">
          <div>
            {scoreBar(editing && previewCap !== null ? previewCap : actor.effectiveCapabilityScore, 6, "bg-primary")}
            {editing && previewCap !== null && (
              <div className="text-[10px] text-primary/70 mt-0.5 font-mono">
                preview: {previewCap}/6
              </div>
            )}
          </div>
        </td>
        <td className="px-3 py-3 min-w-[110px] cursor-pointer">
          {scoreBar(combined, 13, riskPct >= 0.7 ? "bg-red-400" : riskPct >= 0.5 ? "bg-orange-400" : "bg-yellow-400")}
        </td>
        {/* Actions */}
        <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1">
            {editing ? (
              <button title="Cancel edit" onClick={cancelEdit} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <>
                <button title="Edit scores via rubric" onClick={startEdit} className="p-1.5 rounded-lg text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10 transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  title={actor.monitored ? "Remove from monitoring" : "Add to monitoring"}
                  onClick={() => onToggleMonitor(actor.name)}
                  className={`p-1.5 rounded-lg transition-colors ${
                    actor.monitored
                      ? "text-primary bg-primary/10 hover:bg-primary/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                >
                  {actor.monitored ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>
                <button
                  title="Refresh from CrowdStrike"
                  onClick={() => onRefresh(actor.name)}
                  disabled={refreshing}
                  className="p-1.5 rounded-lg text-muted-foreground hover:text-cyan-400 hover:bg-cyan-400/10 transition-colors disabled:opacity-40"
                >
                  {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                </button>
                {actor.isCustom && onDelete && (
                  <button
                    title="Remove actor"
                    onClick={() => onDelete(actor.name)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border">
          <td colSpan={9} className="bg-card/50 px-6 py-5">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
              <section className="col-span-full rounded-lg border border-border/60 bg-muted/15 p-3">
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Threat actor description</div>
                <p className="text-xs leading-relaxed text-foreground">
                  {actorDescription || "No description is available for this threat actor."}
                </p>
              </section>
              {/* Scores */}
              {editing ? (
                /* ── Rubric Score Editor ─────────────────────────── */
                <div className="space-y-4 col-span-full">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Edit2 className="w-3 h-3" /> Score Rubric
                    <span className="text-[10px] font-normal normal-case text-muted-foreground/60 ml-1">— select options to compute scores automatically</span>
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Intent Rationale */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide">Intent Rationale</label>
                        {selIntent && (
                          <span className="text-[10px] font-mono font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded">
                            {selIntent.score}/5
                          </span>
                        )}
                      </div>
                      <select
                        value={editIntentText}
                        onChange={e => setEditIntentText(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50"
                      >
                        <option value="">— Select intent rationale —</option>
                        {INTENT_OPTIONS.map(o => (
                          <option key={o.text} value={o.text}>[{o.score}] {o.text}</option>
                        ))}
                      </select>
                      {selIntent && <p className="text-[10px] text-muted-foreground leading-relaxed">{selIntent.text}</p>}
                    </div>

                    {/* Willingness */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-semibold text-purple-400 uppercase tracking-wide">Willingness</label>
                        {selWill && (
                          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${selWill.score < 0 ? "text-red-400 bg-red-400/10 border border-red-400/20" : "text-muted-foreground bg-muted/30 border border-border"}`}>
                            {selWill.score >= 0 ? "+" : ""}{selWill.score}
                          </span>
                        )}
                      </div>
                      <select
                        value={editWillingnessText}
                        onChange={e => setEditWillingnessText(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/50"
                      >
                        <option value="">— Select willingness —</option>
                        {WILLINGNESS_OPTIONS.map(o => (
                          <option key={o.text} value={o.text}>[{o.score >= 0 ? "+" : ""}{o.score}] {o.text}</option>
                        ))}
                      </select>
                      {selWill && <p className="text-[10px] text-muted-foreground leading-relaxed">{selWill.text}</p>}
                    </div>

                    {/* Capability Rationale */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-semibold text-primary uppercase tracking-wide">Capability Rationale</label>
                        {selCap && (
                          <span className="text-[10px] font-mono font-bold text-primary bg-primary/10 border border-primary/20 px-1.5 py-0.5 rounded">
                            {selCap.score}/5
                          </span>
                        )}
                      </div>
                      <select
                        value={editCapabilityText}
                        onChange={e => setEditCapabilityText(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50"
                      >
                        <option value="">— Select capability rationale —</option>
                        {CAPABILITY_OPTIONS.map(o => (
                          <option key={o.text} value={o.text}>[{o.score}] {o.text}</option>
                        ))}
                      </select>
                      {selCap && <p className="text-[10px] text-muted-foreground leading-relaxed">{selCap.text}</p>}
                    </div>

                    {/* Novelty */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wide">Novelty</label>
                        {selNovelty && (
                          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${selNovelty.score < 0 ? "text-red-400 bg-red-400/10 border border-red-400/20" : "text-muted-foreground bg-muted/30 border border-border"}`}>
                            {selNovelty.score >= 0 ? "+" : ""}{selNovelty.score}
                          </span>
                        )}
                      </div>
                      <select
                        value={editNoveltyText}
                        onChange={e => setEditNoveltyText(e.target.value)}
                        onClick={e => e.stopPropagation()}
                        className="w-full bg-input border border-border rounded-lg px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500/50 focus:border-cyan-500/50"
                      >
                        <option value="">— Select novelty —</option>
                        {NOVELTY_OPTIONS.map(o => (
                          <option key={o.text} value={o.text}>[{o.score >= 0 ? "+" : ""}{o.score}] {o.text}</option>
                        ))}
                      </select>
                      {selNovelty && <p className="text-[10px] text-muted-foreground leading-relaxed">{selNovelty.text}</p>}
                    </div>
                  </div>

                  {/* Computed preview */}
                  {(previewIntent !== null || previewCap !== null) && (
                    <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-border/50">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wide font-semibold">Computed:</span>
                      {previewIntent !== null && (
                        <span className="text-xs text-amber-400 font-mono">
                          Intent = {selIntent!.score}{selWill ? ` + (${selWill.score >= 0 ? "+" : ""}${selWill.score})` : ""}
                          {" = "}<strong>{previewIntent}</strong>
                          {bonusIntent > 0 && <span className="text-amber-400/60"> + {bonusIntent} PP-TAP/SIRT → {Math.min(7, previewIntent + bonusIntent)}</span>}
                          <span className="text-muted-foreground">/7</span>
                        </span>
                      )}
                      {previewCap !== null && (
                        <span className="text-xs text-primary font-mono">
                          Capability = {selCap!.score}{selNovelty ? ` + (${selNovelty.score >= 0 ? "+" : ""}${selNovelty.score})` : ""}
                          {" = "}<strong>{previewCap}</strong>
                          <span className="text-muted-foreground">/6</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Save / Cancel */}
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <button onClick={cancelEdit} className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors">
                      Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={previewIntent === null && previewCap === null}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      <Check className="w-3 h-3" /> Apply Scores
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Score Breakdown</h4>
                  <div className="flex gap-2 flex-wrap">
                    {[
                      { label: "Intent base", value: actor.intentBaseScore ?? actor.intentFinalScore, color: "text-amber-400/70 border-amber-400/20 bg-amber-400/5" },
                      { label: "Willingness", value: actor.willingnessModifier ?? actor.willingnessScore, color: "text-purple-400 border-purple-400/30 bg-purple-400/5" },
                      { label: "Intent (effective)", value: actor.effectiveIntentScore, color: "text-amber-400 border-amber-400/30 bg-amber-400/10" },
                      { label: "Cap. base", value: actor.capabilityBaseScore ?? actor.capabilityFinalScore, color: "text-primary/70 border-primary/20 bg-primary/5" },
                      { label: "Novelty", value: actor.noveltyModifier ?? actor.noveltyScore, color: "text-cyan-400 border-cyan-400/30 bg-cyan-400/5" },
                      { label: "Capability", value: actor.effectiveCapabilityScore, color: "text-primary border-primary/30 bg-primary/10" },
                    ].map(({ label, value, color }) => value !== null && value !== undefined && (
                      <div key={label} className={`flex flex-col items-center px-3 py-2 rounded-lg border ${color} min-w-[60px]`}>
                        <span className="text-lg font-bold font-mono">{typeof value === "number" && value > 0 && label.includes("illingnes") ? `+${value}` : value}</span>
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide mt-0.5 text-center leading-tight">{label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                    {[
                      { label: "Malware / Tools", values: malwareTags(actor.malware), color: "text-primary border-primary/20 bg-primary/5" },
                      { label: "Targeted Industries", values: actor.industries ?? [], color: "text-amber-400 border-amber-400/20 bg-amber-400/5" },
                      { label: "Targeted Countries", values: actor.countries ?? [], color: "text-cyan-400 border-cyan-400/20 bg-cyan-400/5" },
                    ].map(({ label, values, color }) => (
                      <div key={label} className={`rounded-lg border p-2.5 ${color}`}>
                        <div className="text-[10px] font-semibold uppercase tracking-wide mb-1.5">{label}</div>
                        {values.length ? (
                          <div className="flex flex-wrap gap-1">
                            {values.slice(0, 30).map((value, index) => (
                              <span key={`${value}-${index}`} className="px-1.5 py-0.5 rounded bg-background/40 text-[10px] text-foreground border border-border/40">
                                {value}
                              </span>
                            ))}
                            {values.length > 30 && <span className="text-[10px] text-muted-foreground">+{values.length - 30} more</span>}
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Not available</span>
                        )}
                      </div>
                    ))}
                  </div>
                  {bonusIntent > 0 && (
                    <div className="text-[11px] text-amber-400/80 flex items-center gap-1">
                      <ArrowUp className="w-3 h-3" />
                      Intent boosted by +{bonusIntent}
                      {actor.inPpTap && " (PP-TAP +1)"}
                      {actor.inSirt && " (SIRT +2)"}
                    </div>
                  )}
                  {actor.intentRationale && (
                    <div>
                      <div className="text-[10px] text-amber-400/70 font-semibold uppercase tracking-wide mb-0.5">Intent Rationale</div>
                      <p className="text-xs text-foreground leading-relaxed">{actor.intentRationale}</p>
                    </div>
                  )}
                  {actor.willingnessRationale && (
                    <div>
                      <div className="text-[10px] text-purple-400/70 font-semibold uppercase tracking-wide mb-0.5">Willingness</div>
                      <p className="text-xs text-foreground leading-relaxed">{actor.willingnessRationale}</p>
                    </div>
                  )}
                  {actor.capabilityRationale && (
                    <div>
                      <div className="text-[10px] text-primary/70 font-semibold uppercase tracking-wide mb-0.5">Capability Rationale</div>
                      <p className="text-xs text-foreground leading-relaxed">{actor.capabilityRationale}</p>
                    </div>
                  )}
                  {actor.noveltyRationale && (
                    <div>
                      <div className="text-[10px] text-cyan-400/70 font-semibold uppercase tracking-wide mb-0.5">Novelty</div>
                      <p className="text-xs text-foreground leading-relaxed">{actor.noveltyRationale}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Profile */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actor Profile</h4>
                {actor.aliases && (
                  <div>
                    <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">Also Known As</div>
                    <p className="text-xs text-foreground leading-relaxed">{actor.aliases}</p>
                  </div>
                )}
                {actor.communityIds && actor.communityIds !== actor.aliases && (
                  <div>
                    <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">Community Identifiers</div>
                    <p className="text-xs text-foreground leading-relaxed">{actor.communityIds}</p>
                  </div>
                )}
                {actor.motivation && (
                  <div>
                    <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">Motivation</div>
                    <p className="text-xs text-foreground">{actor.motivation}</p>
                  </div>
                )}
                {actor.malware && (
                  <div>
                    <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">Malware / Tools</div>
                    <div className="flex flex-wrap gap-1">
                      {actor.malware
                        .replace(/Malware developed|Malware used/gi, "")
                        .trim()
                        .split(/\s+/)
                        .filter(Boolean)
                        .slice(0, 25)
                        .map((m, i) => (
                          <span key={i} className="px-1.5 py-0.5 bg-muted/50 rounded text-[10px] text-foreground font-mono border border-border/50">{m}</span>
                        ))}
                    </div>
                  </div>
                )}
                {actor.csLastRefreshed && (
                  <div className="text-[10px] text-cyan-400/70">
                    CS data refreshed: {new Date(actor.csLastRefreshed).toLocaleString("en-GB")}
                  </div>
                )}
              </div>

              {/* Geography & Industries */}
              <div className="space-y-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Targeting</h4>
                {actor.countries.length > 0 && (
                  <div>
                    <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1 flex items-center gap-1">
                      <Globe className="w-3 h-3" /> Countries ({actor.countries.length})
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {actor.countries.map((c, i) => (
                        <span key={i} className="px-1.5 py-0.5 bg-muted/30 rounded text-[10px] text-foreground border border-border/40">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                {actor.industries.length > 0 && (
                  <div>
                    <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide mb-1">Industries ({actor.industries.length})</div>
                    <div className="flex flex-wrap gap-1">
                      {actor.industries.map((ind, i) => (
                        <span key={i} className="px-1.5 py-0.5 bg-primary/5 rounded text-[10px] text-primary border border-primary/20">{ind}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── PP-TAP / SIRT list management page ────────────────────────────────────────

function ListPage({
  title,
  tagLabel,
  tagColor,
  bonus,
  list,
  allActors,
  onAdd,
  onImport,
  onRemove,
}: {
  title: string;
  tagLabel: string;
  tagColor: string;
  bonus: number;
  list: string[];
  allActors: MergedActor[];
  onAdd: (item: string) => void;
  onImport: (items: string[]) => void;
  onRemove: (item: string) => void;
}) {
  const [input, setInput] = useState("");
  const [bulkText, setBulkText] = useState("");
  const [bulkError, setBulkError] = useState("");
  const [fileName, setFileName] = useState("");

  function handleAdd() {
    const v = input.trim().toUpperCase();
    if (!v) return;
    if (list.some(l => l.toUpperCase() === v)) return;
    onAdd(v);
    setInput("");
  }

  function handleBulkImport() {
    const entries = parseBulkEntries(bulkText);
    if (entries.length === 0) {
      setBulkError("Paste or upload at least one entry.");
      return;
    }
    onImport(entries);
    setBulkText("");
    setBulkError("");
    setFileName("");
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      setBulkText(await file.text());
      setFileName(file.name);
      setBulkError("");
    } catch {
      setBulkError("Unable to read that file.");
    }
  }

  // Which actors each list item matches
  const matchMap = useMemo(() => {
    const m: Record<string, MergedActor[]> = {};
    list.forEach(item => {
      m[item] = allActors.filter(a =>
        matchesList(a.name, a.malware ?? "", [item])
      );
    });
    return m;
  }, [list, allActors]);

  // All actors currently affected (union of all matches)
  const affectedActors = useMemo(() => {
    const seen = new Set<string>();
    const result: MergedActor[] = [];
    list.forEach(item => {
      (matchMap[item] ?? []).forEach(a => {
        if (!seen.has(a.name)) { seen.add(a.name); result.push(a); }
      });
    });
    return result.sort((a, b) => b.effectiveIntentScore - a.effectiveIntentScore);
  }, [matchMap, list]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Tag className="w-5 h-5" />
            {title}
          </h2>
          <p className="text-muted-foreground text-sm mt-1">
            Actors or malware names in this list cause matching threat actor groups to receive
            <span className={`font-bold mx-1 ${tagColor.includes("amber") ? "text-amber-400" : "text-red-400"}`}>
              +{bonus} intent
            </span>
            and the
            <span className={`inline-flex items-center mx-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${tagColor}`}>{tagLabel}</span>
            tag.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{list.length} entries</span>
          <span className="text-border">·</span>
          <span className="text-muted-foreground">{affectedActors.length} actors affected</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* List management */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
            <Tag className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Entries</span>
            <span className="ml-auto text-xs text-muted-foreground">{list.length} items</span>
          </div>

          {/* Add input */}
          <div className="p-3 border-b border-border">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAdd()}
                placeholder="Enter malware name or actor name…"
                className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
              />
              <button
                onClick={handleAdd}
                disabled={!input.trim()}
                className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Bulk paste/upload */}
          <div className="border-b border-border bg-muted/10 p-3">
            <div className="mb-2 flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-emerald-400" />
              <span className="text-xs font-semibold text-foreground">Bulk import</span>
              <span className="text-[10px] text-muted-foreground">Excel column, CSV, TSV, or TXT</span>
            </div>
            <textarea
              value={bulkText}
              onChange={e => { setBulkText(e.target.value); setBulkError(""); }}
              rows={4}
              placeholder={"Paste one actor or malware name per row from Excel…"}
              className="w-full resize-y rounded-lg border border-border bg-input px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <Upload className="h-3.5 w-3.5" />
                Choose file
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
              <button
                type="button"
                onClick={handleBulkImport}
                disabled={!bulkText.trim()}
                className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                Add entries
              </button>
              {fileName && <span className="max-w-[180px] truncate text-[10px] text-muted-foreground">{fileName}</span>}
            </div>
            {bulkError && <p className="mt-2 text-xs text-red-400">{bulkError}</p>}
            <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
              Duplicate entries are ignored. Imports add to this quarter&apos;s existing list; they do not replace another quarter.
            </p>
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {list.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                <ListX className="w-6 h-6 mx-auto mb-2 opacity-40" />
                No entries yet. Add malware or actor names above.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {list.map(item => {
                  const matches = matchMap[item] ?? [];
                  return (
                    <div key={item} className="flex items-center gap-3 px-4 py-2.5 hover:bg-accent/20 transition-colors group">
                      <div className="flex-1 min-w-0">
                        <span className="text-xs font-mono font-semibold text-foreground">{item}</span>
                        <span className="ml-2 text-[10px] text-muted-foreground">
                          {matches.length > 0
                            ? `→ ${matches.length} actor${matches.length !== 1 ? "s" : ""}`
                            : "no matches yet"}
                        </span>
                      </div>
                      <button
                        onClick={() => onRemove(item)}
                        className="p-1 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-red-400 hover:bg-red-400/10 transition-all"
                        title="Remove"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Affected actors */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border bg-muted/20 flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Affected Actors</span>
            <span className="ml-auto text-xs text-muted-foreground">{affectedActors.length} groups</span>
          </div>
          <div className="max-h-[460px] overflow-y-auto">
            {affectedActors.length === 0 ? (
              <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                No actors match any entry yet.
              </div>
            ) : (
              <div className="divide-y divide-border/50">
                {affectedActors.map(a => {
                  const baseIntent = a.intentFinalScore ?? 0;
                  const ppBonus = a.inPpTap ? 1 : 0;
                  const sirtBonus = a.inSirt ? 2 : 0;
                  const thisBonus = bonus === 1 ? (a.inPpTap ? 1 : 0) : (a.inSirt ? 2 : 0);
                  return (
                    <div key={a.name} className="flex items-center gap-3 px-4 py-2.5">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-mono font-semibold text-foreground">{a.name}</span>
                          <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium ${actorTypeColor(a.actorType)}`}>
                            {actorTypeShort(a.actorType)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 text-xs font-mono shrink-0">
                        <span className="text-muted-foreground">{baseIntent}</span>
                        <ArrowUp className="w-3 h-3 text-amber-400" />
                        <span className="font-bold text-amber-400">{a.effectiveIntentScore}</span>
                        {(ppBonus > 0 || sirtBonus > 0) && (
                          <span className="text-[10px] text-amber-400/60">
                            (+{ppBonus + sirtBonus})
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Add Actor Modal ────────────────────────────────────────────────────────────

type AddActorMode = "manual" | "cs";

const ACTOR_TYPES = [
  "Espionage — attacks impacting the Confidentiality of data or systems",
  "Destructive — attacks impacting the Integrity of data or systems",
  "Disruptive — attacks impacting the Availability of data or systems",
  "Cyber-Crime — attacks intended for near-term financial profit",
];

const blankForm = (): CustomActor => ({
  name: "",
  origins: "",
  aliases: "",
  actorType: ACTOR_TYPES[0],
  lastSeen: "",
  malware: "",
  countries: [],
  industries: [],
  intentFinalScore: null,
  capabilityFinalScore: null,
  willingnessScore: null,
  motivation: "",
  adversaryType: "",
  communityIds: "",
  inMonitoringList: false,
  isCustom: true,
  csEnriched: false,
  csLastRefreshed: null,
  description: "",
});

function AddActorModal({
  onClose,
  onSave,
  existingNames,
}: {
  onClose: () => void;
  onSave: (actor: CustomActor) => void;
  existingNames: Set<string>;
}) {
  const [mode, setMode] = useState<AddActorMode>("cs");
  const [form, setForm] = useState<CustomActor>(blankForm());
  const [csQuery, setCsQuery] = useState("");
  const [csResults, setCsResults] = useState<CustomActor[]>([]);
  const [csSearching, setCsSearching] = useState(false);
  const [csError, setCsError] = useState("");
  const [error, setError] = useState("");

  const overlayRef = useRef<HTMLDivElement>(null);

  async function searchCS() {
    if (!csQuery.trim()) return;
    setCsSearching(true);
    setCsError("");
    setCsResults([]);
    try {
      const res = await fetch(`${CS_API}/cs/actor?q=${encodeURIComponent(csQuery.trim())}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "CS search failed");
      setCsResults(data.actors ?? []);
      if ((data.actors ?? []).length === 0) setCsError("No actors found in CrowdStrike for that query.");
    } catch (e: any) {
      setCsError(e.message);
    } finally {
      setCsSearching(false);
    }
  }

  function selectCSResult(actor: CustomActor) {
    setForm({ ...actor, isCustom: true, inMonitoringList: form.inMonitoringList });
    setCsResults([]);
  }

  function setField<K extends keyof CustomActor>(k: K, v: CustomActor[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function save() {
    if (!form.name.trim()) { setError("Actor name is required."); return; }
    const upper = form.name.trim().toUpperCase();
    if (existingNames.has(upper)) { setError(`Actor "${upper}" already exists.`); return; }
    onSave({ ...form, name: upper });
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={e => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <h2 className="text-base font-semibold text-foreground">Add Threat Actor</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Search CrowdStrike or enter details manually</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-1 p-4 border-b border-border">
          {(["cs", "manual"] as AddActorMode[]).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {m === "cs" ? "🔍 Search CrowdStrike" : "✏️ Manual Entry"}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-5">
          {/* CS search mode */}
          {mode === "cs" && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={csQuery}
                  onChange={e => setCsQuery(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && searchCS()}
                  placeholder="e.g. SCATTERED SPIDER, VOODOO BEAR…"
                  className="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  onClick={searchCS}
                  disabled={csSearching || !csQuery.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {csSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  Search
                </button>
              </div>
              {csError && (
                <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {csError}
                </div>
              )}
              {csResults.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{csResults.length} result{csResults.length !== 1 ? "s" : ""} — click to pre-fill:</p>
                  {csResults.map((a, i) => (
                    <button
                      key={i}
                      onClick={() => { selectCSResult(a); setMode("manual"); }}
                      className="w-full text-left p-3 rounded-xl border border-border hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-sm text-foreground">{a.name}</span>
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${actorTypeColor(a.actorType)}`}>
                          {actorTypeShort(a.actorType)}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-400/30">CS LIVE</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {originFlag(a.origins)} {a.origins || "Unknown"} · Last active: {fmtDate(a.lastSeen)}
                      </div>
                      {a.aliases && <div className="text-[11px] text-muted-foreground/70 mt-0.5 truncate">{a.aliases}</div>}
                    </button>
                  ))}
                </div>
              )}
              {form.name && (
                <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-400/10 border border-emerald-400/20 rounded-lg px-3 py-2">
                  <Check className="w-4 h-4" /> Pre-filled from CS: <strong>{form.name}</strong> — review in Manual Entry tab
                </div>
              )}
            </div>
          )}

          {/* Manual form */}
          {mode === "manual" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Actor Name *</label>
                  <input
                    value={form.name}
                    onChange={e => setField("name", e.target.value)}
                    placeholder="e.g. SCATTERED SPIDER"
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Origin / Region</label>
                  <input
                    value={form.origins}
                    onChange={e => setField("origins", e.target.value)}
                    placeholder="e.g. Russian Federation"
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Last Active</label>
                  <input
                    type="date"
                    value={form.lastSeen ?? ""}
                    onChange={e => setField("lastSeen", e.target.value || null)}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:dark]"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Actor Type</label>
                  <select
                    value={form.actorType}
                    onChange={e => setField("actorType", e.target.value)}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    {ACTOR_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Intent Score (1–7)</label>
                  <input
                    type="number" min={1} max={7}
                    value={form.intentFinalScore ?? ""}
                    onChange={e => setField("intentFinalScore", e.target.value ? Number(e.target.value) : null)}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Capability Score (1–6)</label>
                  <input
                    type="number" min={1} max={6}
                    value={form.capabilityFinalScore ?? ""}
                    onChange={e => setField("capabilityFinalScore", e.target.value ? Number(e.target.value) : null)}
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Aliases / AKA</label>
                  <input
                    value={form.aliases}
                    onChange={e => setField("aliases", e.target.value)}
                    placeholder="e.g. UNC3944, Muddled Libra, Oktapus"
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Motivation</label>
                  <input
                    value={form.motivation}
                    onChange={e => setField("motivation", e.target.value)}
                    placeholder="e.g. Financial, Espionage, Hacktivist"
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Malware / Tools</label>
                  <input
                    value={form.malware}
                    onChange={e => setField("malware", e.target.value)}
                    placeholder="e.g. CobaltStrike Mimikatz RClone"
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div className="col-span-2">
                  <label className="text-xs font-medium text-muted-foreground mb-1 block">Description</label>
                  <textarea
                    value={form.description}
                    onChange={e => setField("description", e.target.value)}
                    rows={2}
                    placeholder="Brief description of the actor…"
                    className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                  />
                </div>
                <div className="col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.inMonitoringList}
                      onChange={e => setField("inMonitoringList", e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm text-foreground">Add to Monitoring List</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors">
              Cancel
            </button>
            <button
              onClick={save}
              disabled={!form.name.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              <Plus className="w-4 h-4" /> Add Actor
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

type TabId = "actors" | "pptap" | "sirt";

export default function ThreatModel() {
  const { liveActorData } = useAppData();
  const { isTidEnabled } = useTacticScores();
  const procedureSource = useMemo(() => {
    if (liveActorData?.procedures?.length) {
      return {
        ...liveActorData,
        procedures: liveActorData.procedures.filter(procedure => isTidEnabled(procedure.mitreId)),
      };
    }
    const source = dashboardData as any;
    return {
      procedures: (source.allProcedures ?? [])
        .filter((procedure: any) => isTidEnabled(String(procedure.mitreId ?? "")))
        .map((procedure: any) => ({
        actor: String(procedure.actor ?? ""),
        mitreId: String(procedure.mitreId ?? ""),
        tacticName: (source.techTacticMap?.[procedure.mitreId] ?? []).join(", "),
        techniqueName: String(source.techNameMap?.[procedure.mitreId] ?? ""),
        procedure: String(procedure.procedure ?? ""),
        date: typeof procedure.date === "number" ? procedure.date : null,
        externalRef: String(procedure.externalRef ?? ""),
        risk: Number(procedure.risk) || 0,
        reportRefs: procedure.externalRef ? [String(procedure.externalRef)] : [],
      })),
      actorRanking: [],
      label: "Bundled procedure dataset",
      loadedAt: new Date(0).toISOString(),
    };
  }, [liveActorData, isTidEnabled]);
  // Quarter versioning
  const { selectedQuarter, setSelectedQuarter } = useThreatModelQuarter();
  const [savedVersions, setSavedVersions]     = useState<Array<{
    quarter: string; savedAt: string | null; seededFrom: string | null;
    actorCount: number; overrideCount: number;
  }>>([]);
  const [quarterOpen, setQuarterOpen] = useState(false);
  const quarterRef = useRef<HTMLDivElement>(null);

  // Server-persisted state
  const [customActors, setCustomActors]     = useState<CustomActor[]>([]);
  const [actorOverrides, setActorOverrides] = useState<Record<string, ActorOverride>>({});
  const [ppTapList, setPpTapList]           = useState<string[]>([]);
  const [sirtList, setSirtList]             = useState<string[]>([]);
  const [autoAssessments, setAutoAssessments] = useState<AutoAssessmentMap>({});
  const [monitoringState, setMonitoringState] = useState<Record<string, boolean>>({});
  const [liveLastActive, setLiveLastActive] = useState<Record<string, string>>({});
  const [serverLoading, setServerLoading]   = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveRevision, setSaveRevision] = useState(0);
  const savedSnapshotRef = useRef("");

  // UI state
  const [activeTab, setActiveTab]         = useState<TabId>("actors");
  const [search, setSearch]               = useState("");
  const [originFilter, setOriginFilter]   = useState("all");
  const [typeFilter, setTypeFilter]       = useState("all");
  const [monitoredOnly, setMonitoredOnly] = useState(false);
  const [showFramework, setShowFramework] = useState(false);
  const [showAdd, setShowAdd]             = useState(false);
  const [showAssessmentReview, setShowAssessmentReview] = useState(false);
  const [scoringContext, setScoringContext] = useState<ScoringContext>({
    industries: [],
    technologies: [],
    countries: [],
  });
  const [refreshingNames, setRefreshingNames] = useState<Set<string>>(new Set());
  const [refreshAllRunning, setRefreshAllRunning] = useState(false);
  const [refreshMsg, setRefreshMsg]       = useState<{ text: string; type: "ok" | "err" } | null>(null);
  const msgTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showMsg(text: string, type: "ok" | "err" = "ok") {
    if (msgTimer.current) clearTimeout(msgTimer.current);
    setRefreshMsg({ text, type });
    msgTimer.current = setTimeout(() => setRefreshMsg(null), 4000);
  }

  // ── Close quarter dropdown on outside click ───────────────────────────────
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (quarterRef.current && !quarterRef.current.contains(e.target as Node)) {
        setQuarterOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // ── Load state from server for the selected quarter ───────────────────────
  useEffect(() => {
    setServerLoading(true);
    savedSnapshotRef.current = "";
    (async () => {
      let loaded = false;
      try {
        const [versionsRes, stateRes] = await Promise.all([
          fetch(`${CS_API}/cs/threat-model-versions`),
          fetch(`${CS_API}/cs/threat-model-state?quarter=${encodeURIComponent(selectedQuarter)}`),
        ]);
        const versionsData = await versionsRes.json();
        if (versionsData.ok) setSavedVersions(versionsData.versions ?? []);

        const data = await stateRes.json();
        if (data.ok) {
          const loadedCustomActors: CustomActor[] = data.customActors ?? [];
          const loadedActorOverrides: Record<string, ActorOverride> = data.actorOverrides ?? {};
          const loadedMonitoringState: Record<string, boolean> = data.monitoringState
            ?? deriveLegacyMonitoringState(loadedCustomActors, loadedActorOverrides);
          setCustomActors(loadedCustomActors);
          setActorOverrides(loadedActorOverrides);
          setMonitoringState(loadedMonitoringState);
          setAutoAssessments(data.autoAssessments ?? {});
           const loadedPpTap: string[] = data.ppTapList ?? [];
           const loadedSirt: string[]  = data.sirtList ?? [];
           // Seed the legacy current-quarter baseline only when this quarter has
           // never been saved. An intentionally empty saved list must stay empty.
          const isCurrent = selectedQuarter === QUARTER_LABEL;
           const useLegacySeed = isCurrent && !data.hasSnapshot;
           const resolvedPpTap = useLegacySeed ? SEED_PPTAP : loadedPpTap;
           const resolvedSirt = useLegacySeed ? SEED_SIRT : loadedSirt;
           setPpTapList(resolvedPpTap);
           setSirtList(resolvedSirt);
           savedSnapshotRef.current = JSON.stringify({
             customActors: loadedCustomActors,
             actorOverrides: loadedActorOverrides,
             ppTapList: resolvedPpTap,
             sirtList: resolvedSirt,
             autoAssessments: data.autoAssessments ?? {},
             monitoringState: loadedMonitoringState,
           } satisfies QuarterSnapshot);
          // Mirror current quarter to localStorage for offline fallback
          if (isCurrent) {
            saveToLocalStorage({
              customActors: loadedCustomActors,
              actorOverrides: loadedActorOverrides,
               ppTapList: useLegacySeed ? SEED_PPTAP : loadedPpTap,
               sirtList:  useLegacySeed ? SEED_SIRT : loadedSirt,
              autoAssessments: data.autoAssessments ?? {},
              monitoringState: loadedMonitoringState,
            });
          }
          loaded = true;
        }
      } catch { /* offline — fall through */ }

      if (!loaded && selectedQuarter === QUARTER_LABEL) {
        // API unavailable: restore last-known current state from localStorage
        const ls = loadFromLocalStorage();
        if (ls) {
          setCustomActors(ls.customActors ?? []);
          setActorOverrides(ls.actorOverrides ?? {});
          setAutoAssessments(ls.autoAssessments ?? {});
          setMonitoringState(
            ls.monitoringState
              ?? deriveLegacyMonitoringState(ls.customActors ?? [], ls.actorOverrides ?? {}),
          );
          const lsPpTap: string[] = ls.ppTapList ?? [];
          const lsSirt: string[]  = ls.sirtList ?? [];
          const resolvedPpTap = lsPpTap.length > 0 ? lsPpTap : SEED_PPTAP;
          const resolvedSirt = lsSirt.length > 0 ? lsSirt : SEED_SIRT;
          const resolvedMonitoring = ls.monitoringState
            ?? deriveLegacyMonitoringState(ls.customActors ?? [], ls.actorOverrides ?? {});
          setPpTapList(resolvedPpTap);
          setSirtList(resolvedSirt);
          savedSnapshotRef.current = JSON.stringify({
            customActors: ls.customActors ?? [],
            actorOverrides: ls.actorOverrides ?? {},
            ppTapList: resolvedPpTap,
            sirtList: resolvedSirt,
            autoAssessments: ls.autoAssessments ?? {},
            monitoringState: resolvedMonitoring,
          } satisfies QuarterSnapshot);
        }
      } else if (!loaded) {
        // Historical quarter + offline → show empty
        setCustomActors([]);
        setActorOverrides({});
        setPpTapList([]);
        setSirtList([]);
        setAutoAssessments({});
        setMonitoringState({});
        savedSnapshotRef.current = JSON.stringify({
          customActors: [],
          actorOverrides: {},
          ppTapList: [],
          sirtList: [],
          autoAssessments: {},
          monitoringState: {},
        } satisfies QuarterSnapshot);
      }
      setServerLoading(false);
    })();
  }, [selectedQuarter]);

  // Current-quarter Last Active dates always come from the live CrowdStrike
  // actor directory. Historical quarters retain the values saved in snapshots.
  useEffect(() => {
    if (selectedQuarter !== QUARTER_LABEL) {
      setLiveLastActive({});
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${CS_API}/cs/actors/last-active`);
        const data = await res.json();
        if (!data.ok || cancelled) return;

        const directory: Record<string, string> = {};
        for (const actor of data.actors ?? []) {
          if (!actor.lastActive) continue;
          directory[String(actor.name).toUpperCase()] = actor.lastActive;
          for (const alias of actor.aliases ?? []) {
            directory[String(alias).toUpperCase()] = actor.lastActive;
          }
        }
        setLiveLastActive(directory);
      } catch {
        // Keep the saved snapshot value if CrowdStrike is unavailable.
      }
    })();

    return () => { cancelled = true; };
  }, [selectedQuarter]);

  const currentSnapshot = useMemo<QuarterSnapshot>(() => ({
    customActors,
    actorOverrides,
    ppTapList,
    sirtList,
    autoAssessments,
    monitoringState,
  }), [customActors, actorOverrides, ppTapList, sirtList, autoAssessments, monitoringState]);

  const serializedSnapshot = useMemo(() => JSON.stringify(currentSnapshot), [currentSnapshot, saveRevision]);
  const hasUnsavedChanges = !serverLoading
    && savedSnapshotRef.current !== ""
    && serializedSnapshot !== savedSnapshotRef.current;

  // ── Persist the complete selected-quarter snapshot ────────────────────────
  const persistState = useCallback(async (
    next: {
      customActors?: CustomActor[];
      actorOverrides?: Record<string, ActorOverride>;
      ppTapList?: string[];
      sirtList?: string[];
      autoAssessments?: AutoAssessmentMap;
      monitoringState?: Record<string, boolean>;
    }
  ) => {
    const ca    = next.customActors   ?? customActors;
    const ovr   = next.actorOverrides ?? actorOverrides;
    const pptap = next.ppTapList      ?? ppTapList;
    const sirt  = next.sirtList       ?? sirtList;
    const assessments = next.autoAssessments ?? autoAssessments;
    const monitoring = next.monitoringState ?? monitoringState;
    const res = await fetch(`${CS_API}/cs/threat-model-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customActors: ca, actorOverrides: ovr, ppTapList: pptap, sirtList: sirt, autoAssessments: assessments, monitoringState: monitoring, quarter: selectedQuarter }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || `Unable to save ${selectedQuarter}`);
    }
    const savedAt = new Date().toISOString();
    setSavedVersions(prev => {
      const exists = prev.find(v => v.quarter === selectedQuarter);
      const entry = { quarter: selectedQuarter, savedAt, seededFrom: exists?.seededFrom ?? null, actorCount: ca.length, overrideCount: Object.keys(ovr).length };
      return exists ? prev.map(v => v.quarter === selectedQuarter ? entry : v) : [...prev, entry];
    });
    const savedSnapshot: QuarterSnapshot = {
      customActors: ca,
      actorOverrides: ovr,
      ppTapList: pptap,
      sirtList: sirt,
      autoAssessments: assessments,
      monitoringState: monitoring,
    };
    savedSnapshotRef.current = JSON.stringify(savedSnapshot);
    setSaveRevision(value => value + 1);
    if (selectedQuarter === QUARTER_LABEL) saveToLocalStorage(savedSnapshot);
  }, [customActors, actorOverrides, ppTapList, sirtList, autoAssessments, monitoringState, selectedQuarter]);

  async function saveQuarter() {
    setSaving(true);
    try {
      await persistState(currentSnapshot);
      showMsg(`${selectedQuarter} threat model saved`);
    } catch (error) {
      showMsg(error instanceof Error ? error.message : `Unable to save ${selectedQuarter}`, "err");
    } finally {
      setSaving(false);
    }
  }

  function changeQuarter(quarter: string) {
    if (saving) return;
    if (quarter === selectedQuarter) {
      setQuarterOpen(false);
      return;
    }
    if (hasUnsavedChanges && !window.confirm(`Discard unsaved changes to ${selectedQuarter}?`)) return;
    setSelectedQuarter(quarter);
    setQuarterOpen(false);
  }

  // ── Merge static + custom actors, compute effective scores ────────────────
  const mergedActors = useMemo((): MergedActor[] => {
    const staticMerged: MergedActor[] = staticActors.map(a => {
      const ovr = actorOverrides[a.name] ?? {};
      const csData = ovr.csData ?? {};
      const auto = autoAssessments[a.name];
      const approvedAuto = auto?.status === "approved" ? auto : null;

      // Base intent/capability: manual override → csData → static
      const baseIntent = ovr.intentFinalScore !== undefined && ovr.intentFinalScore !== null
        ? ovr.intentFinalScore
        : (csData.intentFinalScore !== undefined && csData.intentFinalScore !== null
          ? csData.intentFinalScore
          : (approvedAuto?.intentFinalScore ?? a.intentFinalScore));
      const baseCap = ovr.capabilityFinalScore !== undefined && ovr.capabilityFinalScore !== null
        ? ovr.capabilityFinalScore
        : (csData.capabilityFinalScore !== undefined && csData.capabilityFinalScore !== null
          ? csData.capabilityFinalScore
          : (approvedAuto?.capabilityFinalScore ?? a.capabilityFinalScore));

      const mergedMalware = (csData as any).malware ?? a.malware;
      const inPpTap = matchesList(a.name, mergedMalware ?? "", ppTapList);
      const inSirt  = matchesList(a.name, mergedMalware ?? "", sirtList);

      const effectiveIntentScore = Math.min(7, (baseIntent ?? 0) + (inPpTap ? 1 : 0) + (inSirt ? 2 : 0));
      const effectiveCapabilityScore = baseCap ?? 0;

      return {
        ...a,
        ...csData,
        // preserve name and malware from CS if available
        malware: mergedMalware,
        lastSeen: liveLastActive[a.name.toUpperCase()] ?? csData.lastSeen ?? a.lastSeen,
        intentFinalScore: baseIntent,
        capabilityFinalScore: baseCap,
        isCustom: false,
        csEnriched: ovr.csEnriched ?? false,
        csLastRefreshed: ovr.csLastRefreshed ?? null,
        description: (csData as any).description ?? "",
        monitored: monitoringState[a.name]
          ?? (ovr.inMonitoringList !== undefined ? ovr.inMonitoringList : a.inMonitoringList),
        effectiveIntentScore,
        effectiveCapabilityScore,
        inPpTap,
        inSirt,
        // Rubric selections: override wins over static Excel data
        intentRationale:      ovr.intentRationale      ?? approvedAuto?.intentRationale ?? a.intent      ?? "",
        willingnessRationale: ovr.willingnessRationale ?? approvedAuto?.willingnessRationale ?? a.willingness  ?? "",
        capabilityRationale:  ovr.capabilityRationale  ?? approvedAuto?.capabilityRationale ?? a.capabilities ?? "",
        noveltyRationale:     ovr.noveltyRationale     ?? approvedAuto?.noveltyRationale ?? a.novelty      ?? "",
        intentBaseScore:      ovr.intentBaseScore      !== undefined ? ovr.intentBaseScore      : (approvedAuto?.intentBaseScore ?? a.intentScore),
        willingnessModifier:  ovr.willingnessModifier  !== undefined ? ovr.willingnessModifier  : (approvedAuto?.willingnessModifier ?? a.willingnessScore),
        capabilityBaseScore:  ovr.capabilityBaseScore  !== undefined ? ovr.capabilityBaseScore  : (approvedAuto?.capabilityBaseScore ?? a.capabilitiesScore),
        noveltyModifier:      ovr.noveltyModifier      !== undefined ? ovr.noveltyModifier      : (approvedAuto?.noveltyModifier ?? a.noveltyScore),
      };
    });

    const customMerged: MergedActor[] = customActors.map(a => {
      const inPpTap = matchesList(a.name, a.malware ?? "", ppTapList);
      const inSirt  = matchesList(a.name, a.malware ?? "", sirtList);
      const effectiveIntentScore    = Math.min(7, (a.intentFinalScore ?? 0) + (inPpTap ? 1 : 0) + (inSirt ? 2 : 0));
      const effectiveCapabilityScore = a.capabilityFinalScore ?? 0;
      return {
        ...(a as any),
        lastSeen: liveLastActive[a.name.toUpperCase()] ?? a.lastSeen,
        intent: "",
        intentScore: null,
        willingness: "",
        pptap: 0,
        sirt: 0,
        capabilitiesScore: null,
        novelty: "",
        noveltyScore: null,
        isCustom: true,
        monitored: monitoringState[a.name] ?? a.inMonitoringList,
        effectiveIntentScore,
        effectiveCapabilityScore,
        inPpTap,
        inSirt,
        intentRationale:      a.intentRationale      ?? "",
        willingnessRationale: a.willingnessRationale ?? "",
        capabilityRationale:  a.capabilityRationale  ?? "",
        noveltyRationale:     a.noveltyRationale     ?? "",
        intentBaseScore:      a.intentBaseScore      ?? null,
        willingnessModifier:  a.willingnessModifier  ?? null,
        capabilityBaseScore:  a.capabilityBaseScore  ?? null,
        noveltyModifier:      a.noveltyModifier      ?? null,
      };
    });

    return [...staticMerged, ...customMerged];
  }, [staticActors, customActors, actorOverrides, ppTapList, sirtList, liveLastActive, autoAssessments, monitoringState]);

  function generateAssessments(context: ScoringContext = scoringContext) {
    const generated = generateQuarterlyAssessments(selectedQuarter, mergedActors, procedureSource, context);
    const next = Object.fromEntries(generated.map(item => [item.actorName, item]));
    setAutoAssessments(next);
    setShowAssessmentReview(true);
    const contextCount = context.industries.length + context.technologies.length + context.countries.length;
    showMsg(`Generated ${generated.length} suggestions for ${selectedQuarter}${contextCount ? ` with ${contextCount} context filters` : ""}`);
  }

  async function decideAssessments(names: string[], status: "approved" | "rejected") {
    const reviewedAt = new Date().toISOString();
    const next = { ...autoAssessments };
    for (const name of names) {
      if (next[name]) next[name] = { ...next[name], status, reviewedAt };
    }
    setAutoAssessments(next);
    showMsg(`${status === "approved" ? "Approved" : "Rejected"} ${names.length} suggestions — save ${selectedQuarter} to persist`);
  }

  // ── Save intent/capability scores for an actor ────────────────────────────
  async function saveScores(name: string, scores: {
    intentFinalScore: number | null;
    capabilityFinalScore: number | null;
  } & RubricScores) {
    const { intentFinalScore, capabilityFinalScore, ...rubric } = scores;
    const customIdx = customActors.findIndex(a => a.name.toUpperCase() === name.toUpperCase());
    if (customIdx !== -1) {
      const updated = [...customActors];
      updated[customIdx] = { ...updated[customIdx], intentFinalScore, capabilityFinalScore, ...rubric };
      setCustomActors(updated);
      showMsg(`${name} scores updated — save ${selectedQuarter} to persist`);
      return;
    }
    const newOverrides = {
      ...actorOverrides,
      [name]: { ...actorOverrides[name], intentFinalScore, capabilityFinalScore, ...rubric },
    };
    setActorOverrides(newOverrides);
    showMsg(`${name} scores updated — save ${selectedQuarter} to persist`);
  }

  // ── CS refresh for a single actor ─────────────────────────────────────────
  async function refreshActor(name: string) {
    setRefreshingNames(s => new Set(s).add(name));
    try {
      const res = await fetch(`${CS_API}/cs/actor?q=${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "CS lookup failed");
      const actors: CustomActor[] = data.actors ?? [];
      const match = actors.find(a => a.name.toUpperCase() === name.toUpperCase()) ?? actors[0];
      if (!match) throw new Error("Actor not found in CrowdStrike");

      const newOverrides = {
        ...actorOverrides,
        [name]: {
          ...actorOverrides[name],
          csEnriched: true,
          csLastRefreshed: new Date().toISOString(),
          csData: {
            origins: match.origins,
            aliases: match.aliases,
            actorType: match.actorType || actorOverrides[name]?.csData?.actorType,
            lastSeen: match.lastSeen,
            malware: match.malware,
            countries: match.countries,
            industries: match.industries,
            motivation: match.motivation,
            adversaryType: match.adversaryType,
            communityIds: match.communityIds,
            description: match.description,
            csRawData: match.csRawData,
            capabilityFinalScore: match.capabilityFinalScore,
          },
        },
      };
      setActorOverrides(newOverrides);

      setCustomActors(prev => {
        const idx = prev.findIndex(a => a.name.toUpperCase() === name.toUpperCase());
        if (idx === -1) return prev;
        const updated = [...prev];
        updated[idx] = {
          ...updated[idx],
          origins: match.origins || updated[idx].origins,
          aliases: match.aliases || updated[idx].aliases,
          actorType: match.actorType || updated[idx].actorType,
          lastSeen: match.lastSeen || updated[idx].lastSeen,
          malware: match.malware || updated[idx].malware,
          countries: match.countries.length ? match.countries : updated[idx].countries,
          industries: match.industries.length ? match.industries : updated[idx].industries,
          motivation: match.motivation || updated[idx].motivation,
          communityIds: match.communityIds || updated[idx].communityIds,
          description: match.description || updated[idx].description,
          csEnriched: true,
          csLastRefreshed: new Date().toISOString(),
          capabilityFinalScore: match.capabilityFinalScore ?? updated[idx].capabilityFinalScore,
        };
        return updated;
      });

      showMsg(`${name} refreshed from CrowdStrike — save ${selectedQuarter} to persist`);
    } catch (e: any) {
      showMsg(`${name}: ${e.message}`, "err");
    } finally {
      setRefreshingNames(s => { const n = new Set(s); n.delete(name); return n; });
    }
  }

  // ── Bulk refresh all monitored actors ─────────────────────────────────────
  async function refreshAll() {
    setRefreshAllRunning(true);
    const targets = mergedActors.filter(a => a.monitored).map(a => a.name);
    setRefreshMsg({ text: `Refreshing ${targets.length} monitored actors from CS…`, type: "ok" });
    let ok = 0; let fail = 0;
    for (const name of targets) {
      try { await refreshActor(name); ok++; } catch { fail++; }
      await new Promise(r => setTimeout(r, 200));
    }
    setRefreshAllRunning(false);
    showMsg(`Refresh complete — ${ok} updated${fail ? `, ${fail} failed` : ""}`, fail ? "err" : "ok");
  }

  // ── Toggle monitoring ─────────────────────────────────────────────────────
  async function toggleMonitor(name: string) {
    const actor = mergedActors.find(item => item.name.toUpperCase() === name.toUpperCase());
    const next = { ...monitoringState, [name]: !(actor?.monitored ?? false) };
    setMonitoringState(next);
    showMsg(`${name} ${next[name] ? "monitored" : "not monitored"} in ${selectedQuarter} — save to persist`);
  }

  // ── Delete custom actor ───────────────────────────────────────────────────
  async function deleteActor(name: string) {
    const updated = customActors.filter(a => a.name.toUpperCase() !== name.toUpperCase());
    const nextMonitoring = { ...monitoringState };
    delete nextMonitoring[name];
    setCustomActors(updated);
    setMonitoringState(nextMonitoring);
    showMsg(`${name} removed — save ${selectedQuarter} to persist`);
  }

  // ── Add actor ─────────────────────────────────────────────────────────────
  async function addActor(actor: CustomActor) {
    const updated = [...customActors, actor];
    const nextMonitoring = { ...monitoringState, [actor.name]: actor.inMonitoringList };
    setCustomActors(updated);
    setMonitoringState(nextMonitoring);
    setShowAdd(false);
    showMsg(`${actor.name} added — save ${selectedQuarter} to persist`);
  }

  // ── PP-TAP / SIRT list management ─────────────────────────────────────────
  async function addToPpTap(item: string) {
    const next = [...ppTapList, item];
    setPpTapList(next);
  }
  async function removeFromPpTap(item: string) {
    const next = ppTapList.filter(i => i !== item);
    setPpTapList(next);
  }
  async function addToSirt(item: string) {
    const next = [...sirtList, item];
    setSirtList(next);
  }
  async function removeFromSirt(item: string) {
    const next = sirtList.filter(i => i !== item);
    setSirtList(next);
  }

  function mergeList(existing: string[], incoming: string[]) {
    const seen = new Set(existing.map(item => item.trim().toUpperCase()));
    const next = [...existing];
    for (const item of incoming) {
      const normalized = item.trim().toUpperCase();
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        next.push(normalized);
      }
    }
    return next;
  }

  async function importToPpTap(items: string[]) {
    const next = mergeList(ppTapList, items);
    const added = next.length - ppTapList.length;
    setPpTapList(next);
    showMsg(added > 0 ? `${added} PP-TAP entr${added === 1 ? "y" : "ies"} added — save ${selectedQuarter} to persist` : "All PP-TAP entries were already present");
  }

  async function importToSirt(items: string[]) {
    const next = mergeList(sirtList, items);
    const added = next.length - sirtList.length;
    setSirtList(next);
    showMsg(added > 0 ? `${added} SIRT entr${added === 1 ? "y" : "ies"} added — save ${selectedQuarter} to persist` : "All SIRT entries were already present");
  }

  // ── Filtered + sorted table ───────────────────────────────────────────────
  const { sortKey, sortDir, toggle, sorted } = useSortTable(
    useMemo(() => {
      const q = search.toLowerCase();
      return mergedActors.filter(a => {
        if (monitoredOnly && !a.monitored) return false;
        if (originFilter !== "all") {
          const norm = (() => {
            const o = a.origins || "Unknown";
            if (o.includes("China") || o.includes("East Asia")) return "China";
            if (o.includes("Russian Federation") || o.includes("Eastern Europe")) return "Russia";
            if (o.includes("Iran") || o.includes("Middle East")) return "Iran";
            if (o.includes("North Korea")) return "North Korea";
            if (!o || o === "Unknown") return "Unknown";
            return o.split(",")[0].trim();
          })();
          if (norm !== originFilter) return false;
        }
        if (typeFilter !== "all" && actorTypeShort(a.actorType) !== typeFilter) return false;
        if (q &&
          !a.name.toLowerCase().includes(q) &&
          !a.aliases.toLowerCase().includes(q) &&
          !(a.origins || "").toLowerCase().includes(q) &&
          !(a.malware || "").toLowerCase().includes(q) &&
          !(a.industries || []).join(" ").toLowerCase().includes(q)) return false;
        return true;
      });
    }, [mergedActors, search, originFilter, typeFilter, monitoredOnly])
  );

  const existingNames = useMemo(
    () => new Set(mergedActors.map(a => a.name.toUpperCase())),
    [mergedActors]
  );

  // Stats
  const monitored   = mergedActors.filter(a => a.monitored).length;
  const csEnriched  = mergedActors.filter(a => a.csEnriched).length;
  const highIntent  = mergedActors.filter(a => a.effectiveIntentScore >= 5).length;
  const highCap     = mergedActors.filter(a => a.effectiveCapabilityScore >= 5).length;
  const ppTapCount  = mergedActors.filter(a => a.inPpTap).length;
  const sirtCount   = mergedActors.filter(a => a.inSirt).length;

  const allOrigins = useMemo(() => {
    const set = new Set<string>();
    mergedActors.forEach(a => {
      const o = a.origins || "Unknown";
      if (o.includes("China") || o.includes("East Asia")) set.add("China");
      else if (o.includes("Russian Federation") || o.includes("Eastern Europe")) set.add("Russia");
      else if (o.includes("Iran") || o.includes("Middle East")) set.add("Iran");
      else if (o.includes("North Korea")) set.add("North Korea");
      else if (!o || o === "Unknown") set.add("Unknown");
      else set.add(o.split(",")[0].trim());
    });
    return Array.from(set).sort();
  }, [mergedActors]);

  // ── Tab definitions ────────────────────────────────────────────────────────
  const tabs: { id: TabId; label: string; badge?: number; badgeColor?: string }[] = [
    { id: "actors", label: "Actors", badge: mergedActors.length },
    { id: "pptap",  label: "PP-TAP",  badge: ppTapCount, badgeColor: "bg-amber-400/20 text-amber-400" },
    { id: "sirt",   label: "SIRT",    badge: sirtCount,  badgeColor: "bg-red-400/20 text-red-400" },
  ];

  const isCurrentQuarter = selectedQuarter === QUARTER_LABEL;
  const selectedVersionMeta = savedVersions.find(v => v.quarter === selectedQuarter);
  const seededFrom = selectedVersionMeta?.seededFrom ?? null;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold text-foreground">Threat Model</h1>

            {/* Quarter selector */}
            <div className="relative" ref={quarterRef}>
              <button
                onClick={() => setQuarterOpen(v => !v)}
                disabled={saving}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-semibold transition-colors ${
                  isCurrentQuarter
                    ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/20"
                    : "border-amber-400/40 bg-amber-400/10 text-amber-400 hover:bg-amber-400/15"
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <History className="w-3.5 h-3.5" />
                {selectedQuarter}
                {isCurrentQuarter && <span className="text-[10px] font-normal opacity-70">(current)</span>}
                <ChevronDownSm className={`w-3 h-3 opacity-60 transition-transform ${quarterOpen ? "rotate-180" : ""}`} />
              </button>

              {quarterOpen && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-card border border-border rounded-xl shadow-2xl min-w-[200px] py-1 overflow-hidden">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border mb-1">
                    Select quarter
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {[...ALL_QUARTERS].reverse().map(q => {
                      const isCur   = q === QUARTER_LABEL;
                      const isSel   = q === selectedQuarter;
                      const meta    = savedVersions.find(v => v.quarter === q);
                      const hasSave = !!meta?.savedAt;
                      const fromQ   = meta?.seededFrom ?? null;
                      return (
                        <button
                          key={q}
                           onClick={() => changeQuarter(q)}
                          className={`w-full flex items-start justify-between gap-3 px-3 py-2 text-sm text-left transition-colors ${
                            isSel
                              ? "bg-primary/15 text-foreground"
                              : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
                          }`}
                        >
                          <span className="flex flex-col">
                            <span className="font-medium">
                              {q}
                              {isCur && <span className="ml-1.5 text-[10px] text-primary opacity-80">current</span>}
                            </span>
                            {fromQ && (
                              <span className="text-[10px] text-amber-400/60 italic">copied from {fromQ}</span>
                            )}
                          </span>
                          {hasSave
                            ? <span className="flex items-center gap-1 text-[10px] text-emerald-400/80 mt-0.5 flex-shrink-0"><Save className="w-2.5 h-2.5" />saved</span>
                            : <span className="text-[10px] text-muted-foreground/50 mt-0.5 flex-shrink-0">unsaved</span>
                          }
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {!isCurrentQuarter && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/10 border border-amber-400/20 text-amber-400 text-[11px] font-medium">
                <History className="w-3 h-3" /> Historical view
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            {mergedActors.length} actors assessed · {csEnriched} enriched from CrowdStrike · {customActors.length} custom
            {selectedVersionMeta?.savedAt && (
              <span className="ml-2 text-[11px] text-muted-foreground/60">
                · saved {new Date(selectedVersionMeta.savedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </span>
            )}
            {seededFrom && (
              <span className="ml-2 text-[11px] text-amber-400/70 italic">
                · copied from {seededFrom}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={saveQuarter}
            disabled={saving || serverLoading || !hasUnsavedChanges}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
              hasUnsavedChanges
                ? "bg-emerald-500 text-white hover:bg-emerald-400"
                : "border border-border bg-secondary text-muted-foreground disabled:opacity-60"
            }`}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            {saving ? `Saving ${selectedQuarter}…` : hasUnsavedChanges ? `Save ${selectedQuarter}` : `${selectedQuarter} saved`}
          </button>
          {activeTab === "actors" && (
            <>
              <button
                onClick={() => setShowFramework(v => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <BookOpen className="w-3.5 h-3.5" />
                {showFramework ? "Hide" : "Show"} Scoring Framework
              </button>
              <button
                onClick={() => generateAssessments()}
                disabled={!procedureSource.procedures.length}
                title={`Generate ${selectedQuarter} score suggestions from ${sourceQuarterForAssessment(selectedQuarter)} procedures`}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-violet-400/30 bg-violet-400/10 text-xs text-violet-300 hover:bg-violet-400/20 transition-colors disabled:opacity-40"
              >
                <ClipboardCheck className="w-3.5 h-3.5" />
                Review Suggested Scores
              </button>
              <button
                onClick={refreshAll}
                disabled={refreshAllRunning || monitored === 0}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-xs text-cyan-400 hover:bg-cyan-400/20 transition-colors disabled:opacity-40"
              >
                {refreshAllRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Refresh Monitored ({monitored}) from CS
              </button>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Add Actor
              </button>
            </>
          )}
        </div>
      </div>

      {/* Flash message */}
      {refreshMsg && (
        <div className={`flex items-center gap-2 text-sm px-4 py-2.5 rounded-lg border ${
          refreshMsg.type === "ok"
            ? "bg-emerald-400/10 text-emerald-400 border-emerald-400/20"
            : "bg-red-400/10 text-red-400 border-red-400/20"
        }`}>
          {refreshMsg.type === "ok" ? <Check className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
          {refreshMsg.text}
        </div>
      )}

      {/* Summary cards */}
      {showAssessmentReview && activeTab === "actors" && (
        <AssessmentReviewPanel
          quarter={selectedQuarter}
          assessments={Object.values(autoAssessments).sort((a, b) => a.actorName.localeCompare(b.actorName))}
          onClose={() => setShowAssessmentReview(false)}
          onDecide={decideAssessments}
          scoringContext={scoringContext}
          onScoringContextChange={setScoringContext}
          onRegenerate={generateAssessments}
        />
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Total Actors",        value: mergedActors.length, icon: Target,    color: "text-primary" },
          { label: "Monitored",           value: monitored,           icon: Shield,    color: "text-primary" },
          { label: "High Intent (≥5)",    value: highIntent,          icon: Zap,       color: "text-amber-400" },
          { label: "High Capability (≥5)", value: highCap,            icon: AlertCircle, color: "text-red-400" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4 flex items-center gap-3">
            <Icon className={`w-5 h-5 ${color}`} />
            <div>
              <div className="text-2xl font-bold text-foreground">{value}</div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab.id
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
            }`}
          >
            {tab.label}
            {tab.badge !== undefined && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${
                tab.badgeColor ?? "bg-muted text-muted-foreground"
              }`}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Actors tab ────────────────────────────────────────────────────────── */}
      {activeTab === "actors" && (
        <>
          {/* Scoring framework */}
          {showFramework && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Scoring Framework Reference</h3>
                <button onClick={() => setShowFramework(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {scoringFramework.filter(r => r.category).map((row, i) => (
                  <div key={i} className="p-3 bg-muted/20 rounded-lg border border-border/50 space-y-2">
                    <div className="text-xs font-semibold text-foreground">{row.category}</div>
                    {row.intent && <div className="text-[11px] text-muted-foreground"><span className="text-amber-400 font-medium">Intent:</span> {row.intent} <span className="font-mono text-amber-400">[{row.intentScore}]</span></div>}
                    {row.willingness && <div className="text-[11px] text-muted-foreground"><span className="text-purple-400 font-medium">Willingness:</span> {row.willingness} <span className="font-mono text-purple-400">[{row.willingnessScore}]</span></div>}
                    {row.capability && <div className="text-[11px] text-muted-foreground"><span className="text-primary font-medium">Capability:</span> {row.capability} <span className="font-mono text-primary">[{row.capabilityScore}]</span></div>}
                    {row.novelty && <div className="text-[11px] text-muted-foreground"><span className="text-green-400 font-medium">Novelty:</span> {row.novelty} <span className="font-mono text-green-400">[{row.noveltyScore}]</span></div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Filters */}
          <div className="flex flex-wrap gap-3 items-center">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search actors, aliases, malware, industry…"
              className="bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring min-w-[250px]"
            />
            <select
              value={originFilter}
              onChange={e => setOriginFilter(e.target.value)}
              className="bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All Origins</option>
              {allOrigins.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="bg-input border border-border rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">All Types</option>
              {["Espionage", "eCrime", "Destructive", "Disruptive"].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={monitoredOnly} onChange={e => setMonitoredOnly(e.target.checked)} className="rounded" />
              <span className="text-sm text-foreground">Monitored only</span>
            </label>
            {serverLoading && <span className="text-xs text-muted-foreground flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</span>}
            <span className="text-xs text-muted-foreground ml-auto">{sorted.length} actors</span>
          </div>

          {/* Table */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="w-8 px-3 py-3" />
                    <SortableTh col="name" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Actor</SortableTh>
                    <SortableTh col="origins" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Origin</SortableTh>
                    <SortableTh col="actorType" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</SortableTh>
                    <SortableTh col="lastSeen" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">Last Active</SortableTh>
                    <SortableTh col="effectiveIntentScore" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[140px]">Intent</SortableTh>
                    <SortableTh col="effectiveCapabilityScore" sortKey={sortKey} sortDir={sortDir} toggle={toggle} className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[120px]">Capability</SortableTh>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider min-w-[120px]">Combined</th>
                    <th className="px-3 py-3 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider w-28">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((actor: MergedActor) => (
                    <ActorRow
                      key={actor.name}
                      actor={actor}
                      onRefresh={refreshActor}
                      onToggleMonitor={toggleMonitor}
                      onDelete={actor.isCustom ? deleteActor : undefined}
                      onSaveScores={saveScores}
                      refreshing={refreshingNames.has(actor.name)}
                    />
                  ))}
                  {sorted.length === 0 && !serverLoading && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-muted-foreground text-sm">
                        No actors match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Source: APT Groups &amp; Operations — Threat Model Update {QUARTER_LABEL} · CrowdStrike Falcon Intel API.
            Combined score = Effective Intent + Capability (max 13). Click the pencil icon to manually edit scores.
          </p>
        </>
      )}

      {/* ── PP-TAP tab ────────────────────────────────────────────────────────── */}
      {activeTab === "pptap" && (
        <ListPage
          title="PP-TAP Priority List"
          tagLabel="PP-TAP +1"
          tagColor="bg-amber-500/15 text-amber-400 border border-amber-400/30"
          bonus={1}
          list={ppTapList}
          allActors={mergedActors}
          onAdd={addToPpTap}
           onImport={importToPpTap}
          onRemove={removeFromPpTap}
        />
      )}

      {/* ── SIRT tab ──────────────────────────────────────────────────────────── */}
      {activeTab === "sirt" && (
        <ListPage
          title="SIRT Priority List"
          tagLabel="SIRT +2"
          tagColor="bg-red-500/15 text-red-400 border border-red-400/30"
          bonus={2}
          list={sirtList}
          allActors={mergedActors}
          onAdd={addToSirt}
           onImport={importToSirt}
          onRemove={removeFromSirt}
        />
      )}

      {showAdd && (
        <AddActorModal
          onClose={() => setShowAdd(false)}
          onSave={addActor}
          existingNames={existingNames}
        />
      )}
    </div>
  );
}
