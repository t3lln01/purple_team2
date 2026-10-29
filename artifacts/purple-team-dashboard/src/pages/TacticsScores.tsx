import { useState, useMemo } from "react";
import { Link } from "wouter";
import { Pencil, Check, X, RotateCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { CONF_SCORES, INT_SCORES, AVAIL_SCORES } from "@/utils/impactFormulas";
import {
  useTacticScores,
  baseTactics,
  type Tactic,
  type TacticField,
} from "@/context/TacticScoresContext";

// ── score helpers ─────────────────────────────────────────────────────────────
function confScore(v: string):  number { return CONF_SCORES[v]  ?? 0; }
function intScore(v: string):   number { return INT_SCORES[v]   ?? 0; }
function availScore(v: string): number { return AVAIL_SCORES[v] ?? 0; }
function ciaTotal(t: Tactic):   number { return confScore(t.conf) + intScore(t.integrity) + availScore(t.avail); }

// ── sub-components ────────────────────────────────────────────────────────────
function ScoreBar({ value, max, color }: { value: number; max: number; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${max > 0 ? Math.min(100, (value / max) * 100) : 0}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-10 text-right font-mono">{value.toFixed(2)}</span>
    </div>
  );
}

const TACTIC_COLORS: Record<string, string> = {
  "Initial Access":         "bg-red-500",
  "Execution":              "bg-orange-500",
  "Persistence":            "bg-yellow-500",
  "Privilege Escalation":   "bg-amber-500",
  "Defense Evasion":        "bg-green-500",
  "Credential Access":      "bg-teal-500",
  "Discovery":              "bg-cyan-500",
  "Lateral Movement":       "bg-blue-500",
  "Collection":             "bg-indigo-500",
  "Command and Control":    "bg-violet-500",
  "Exfiltration":           "bg-purple-500",
  "Impact":                 "bg-pink-500",
  "Reconnaissance":         "bg-rose-500",
  "Resource Development":   "bg-slate-500",
};

const RATING_BADGE: Record<string, string> = {
  High:   "text-red-400 bg-red-400/10 border border-red-400/30",
  Medium: "text-yellow-400 bg-yellow-400/10 border border-yellow-400/30",
  Low:    "text-green-400 bg-green-400/10 border border-green-400/30",
};

const CIA_OPTIONS = ["Low", "Medium", "High"] as const;

function RatingBadge({ label }: { label: string }) {
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${RATING_BADGE[label] ?? "text-muted-foreground"}`}>
      {label || "—"}
    </span>
  );
}

// ── rating selector used in edit mode ─────────────────────────────────────────
function RatingSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className="text-[11px] px-1.5 py-0.5 rounded border border-border bg-card text-foreground focus:outline-none focus:border-primary"
    >
      {CIA_OPTIONS.map(o => (
        <option key={o} value={o}>{o}</option>
      ))}
    </select>
  );
}

// ── single tactic card ────────────────────────────────────────────────────────
function TacticCard({
  tactic,
  isEdited,
  enabled,
  canDisable,
  maxConf, maxInt, maxAvail, maxExtent, maxCIA,
  onSave,
  onReset,
  onEnabledChange,
}: {
  tactic: Tactic;
  isEdited: boolean;
  enabled: boolean;
  canDisable: boolean;
  maxConf: number; maxInt: number; maxAvail: number; maxExtent: number; maxCIA: number;
  onSave: (field: TacticField, value: string | number) => void;
  onReset: () => void;
  onEnabledChange: (enabled: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Tactic>(tactic);

  const color  = TACTIC_COLORS[tactic.tactic] || "bg-primary";
  const c      = confScore(tactic.conf);
  const i      = intScore(tactic.integrity);
  const a      = availScore(tactic.avail);
  const total  = c + i + a;

  function startEdit() {
    setDraft({ ...tactic });
    setEditing(true);
  }

  function save() {
    if (draft.conf      !== tactic.conf)      onSave("conf", draft.conf);
    if (draft.integrity !== tactic.integrity)  onSave("integrity", draft.integrity);
    if (draft.avail     !== tactic.avail)      onSave("avail", draft.avail);
    if (draft.extent    !== tactic.extent)     onSave("extent", Number(draft.extent));
    setEditing(false);
  }

  function cancel() { setEditing(false); }

  const draftC     = confScore(draft.conf);
  const draftI     = intScore(draft.integrity);
  const draftA     = availScore(draft.avail);
  const draftTotal = draftC + draftI + draftA;
  const live = editing ? { c: draftC, i: draftI, a: draftA, total: draftTotal, ext: Number(draft.extent) }
                       : { c, i, a, total, ext: Number(tactic.extent) };

  return (
    <div className={`bg-card border rounded-xl overflow-hidden transition-opacity ${
      enabled ? "border-card-border" : "border-muted opacity-60"
    }`}>
      <div className={`h-1 ${color}`} />
      <div className="p-4">
        {/* header row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Link href={`/all-procedures?tactic=${encodeURIComponent(tactic.tactic)}`}>
                <h3 className="font-semibold text-foreground hover:text-primary hover:underline cursor-pointer transition-colors">
                  {tactic.tactic}
                </h3>
              </Link>
              {isEdited && !editing && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">
                  edited
                </span>
              )}
            </div>
            {tactic.desc && (
              <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed line-clamp-2">{tactic.desc}</p>
            )}
          </div>

          {/* action buttons */}
          <div className="flex-shrink-0 ml-3 flex items-center gap-1">
            <label className="mr-2 flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={enabled}
                onCheckedChange={onEnabledChange}
                disabled={enabled && !canDisable}
                aria-label={`${enabled ? "Disable" : "Enable"} ${tactic.tactic}`}
              />
              {enabled ? "Enabled" : "Disabled"}
            </label>
            {editing ? (
              <>
                <button onClick={save} title="Save" className="p-1 rounded hover:bg-green-500/10 text-green-400 hover:text-green-300 transition-colors">
                  <Check className="w-3.5 h-3.5" />
                </button>
                <button onClick={cancel} title="Cancel" className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-400 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </>
            ) : (
              <>
                {isEdited && (
                  <button onClick={onReset} title="Reset to defaults" className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-orange-400 transition-colors">
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                )}
                <button onClick={startEdit} title="Edit scores" className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-primary transition-colors">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </>
            )}
            {!editing && (
              <div className="text-right">
                <div className="text-xs text-muted-foreground">CIA Total</div>
                <div className="text-xl font-bold text-foreground">{live.total.toFixed(2)}</div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          {/* Confidentiality */}
          <div>
            <div className="flex justify-between text-xs mb-1 items-center">
              <span className="text-muted-foreground">Confidentiality</span>
              <div className="flex items-center gap-2">
                {editing
                  ? <RatingSelect value={draft.conf} onChange={v => setDraft(d => ({ ...d, conf: v }))} />
                  : <RatingBadge label={tactic.conf} />
                }
                <span className="text-blue-400 font-semibold font-mono">{live.c.toFixed(2)}</span>
              </div>
            </div>
            <ScoreBar value={live.c} max={maxConf} color="bg-blue-500" />
          </div>

          {/* Integrity */}
          <div>
            <div className="flex justify-between text-xs mb-1 items-center">
              <span className="text-muted-foreground">Integrity</span>
              <div className="flex items-center gap-2">
                {editing
                  ? <RatingSelect value={draft.integrity} onChange={v => setDraft(d => ({ ...d, integrity: v }))} />
                  : <RatingBadge label={tactic.integrity} />
                }
                <span className="text-green-400 font-semibold font-mono">{live.i.toFixed(2)}</span>
              </div>
            </div>
            <ScoreBar value={live.i} max={maxInt} color="bg-green-500" />
          </div>

          {/* Availability */}
          <div>
            <div className="flex justify-between text-xs mb-1 items-center">
              <span className="text-muted-foreground">Availability</span>
              <div className="flex items-center gap-2">
                {editing
                  ? <RatingSelect value={draft.avail} onChange={v => setDraft(d => ({ ...d, avail: v }))} />
                  : <RatingBadge label={tactic.avail} />
                }
                <span className="text-yellow-400 font-semibold font-mono">{live.a.toFixed(2)}</span>
              </div>
            </div>
            <ScoreBar value={live.a} max={maxAvail} color="bg-yellow-500" />
          </div>

          {/* CIA Total bar */}
          <div className="pt-1 border-t border-border/40">
            <div className="flex justify-between text-xs mb-1 items-center">
              <span className="text-muted-foreground font-medium">CIA Total (C+I+A)</span>
              <span className="text-foreground font-bold font-mono">{live.total.toFixed(2)}</span>
            </div>
            <ScoreBar value={live.total} max={maxCIA} color="bg-primary" />
          </div>

          {/* TTP Extent */}
          <div>
            <div className="flex justify-between text-xs mb-1 items-center">
              <span className="text-muted-foreground">TTP Extent Score</span>
              {editing
                ? (
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={draft.extent}
                    onChange={e => setDraft(d => ({ ...d, extent: parseFloat(e.target.value) || 0 }))}
                    className="w-20 text-right text-xs px-1.5 py-0.5 rounded border border-border bg-card text-primary font-mono focus:outline-none focus:border-primary"
                  />
                )
                : <span className="text-primary font-semibold font-mono">{live.ext}</span>
              }
            </div>
            <ScoreBar value={live.ext} max={maxExtent} color="bg-violet-500" />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function TacticsScores() {
  const {
    liveTactics,
    overrides,
    disabledTactics,
    setOverride,
    resetOverride,
    resetAll,
    setTacticEnabled,
    enableAllTactics,
  } = useTacticScores();

  const editedCount = Object.keys(overrides).length;

  const maxConf   = useMemo(() => Math.max(...liveTactics.map(t => confScore(t.conf))),       [liveTactics]);
  const maxInt    = useMemo(() => Math.max(...liveTactics.map(t => intScore(t.integrity))),    [liveTactics]);
  const maxAvail  = useMemo(() => Math.max(...liveTactics.map(t => availScore(t.avail))),      [liveTactics]);
  const maxExtent = useMemo(() => Math.max(...liveTactics.map(t => Number(t.extent) || 0)),   [liveTactics]);
  const maxCIA    = useMemo(() => Math.max(...liveTactics.map(t => ciaTotal(t))),              [liveTactics]);

  const sortedForTable = useMemo(() => [...liveTactics].sort((a, b) => ciaTotal(b) - ciaTotal(a)), [liveTactics]);

  return (
    <div className="p-6 space-y-6">
      {/* header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tactic Default Scores</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Baseline CIA and extent scores per MITRE ATT&CK tactic. Disabled tactics and their TIDs are excluded throughout the app and from calculations.
            <br />CIA Total = C + I + A using formula weights (Conf: L=1/M=2/H=3 · Int: L=1/M=2.25/H=3.5 · Avail: L=1/M=2.5/H=4).
          </p>
          <p className="mt-2 text-xs font-medium text-primary">
            {liveTactics.length - disabledTactics.size} of {liveTactics.length} tactics enabled
          </p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {disabledTactics.size > 0 && (
            <button onClick={enableAllTactics} className="text-sm px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10 transition-colors">
              Enable all
            </button>
          )}
          {editedCount > 0 && (
            <button
              onClick={resetAll}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-border text-muted-foreground hover:text-orange-400 hover:border-orange-400/40 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reset scores ({editedCount})
            </button>
          )}
        </div>
      </div>

      {/* weight reference legend */}
      <div className="grid grid-cols-3 gap-4 text-xs">
        {[
          { label: "Confidentiality", scores: CONF_SCORES,  color: "text-blue-400" },
          { label: "Integrity",       scores: INT_SCORES,   color: "text-green-400" },
          { label: "Availability",    scores: AVAIL_SCORES, color: "text-yellow-400" },
        ].map(({ label, scores, color }) => (
          <div key={label} className="bg-card border border-card-border rounded-xl p-3">
            <div className={`font-semibold mb-2 ${color}`}>{label}</div>
            {Object.entries(scores).map(([rating, val]) => (
              <div key={rating} className="flex justify-between py-0.5">
                <RatingBadge label={rating} />
                <span className="font-mono font-semibold text-foreground">{val}</span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* tactic cards grid */}
      <div className="grid grid-cols-2 gap-6">
        {liveTactics.map(tactic => {
          const base = baseTactics.find(b => b.tactic === tactic.tactic);
          const isEdited = overrides[tactic.tactic] !== undefined;
          return (
            <TacticCard
              key={tactic.tactic}
              tactic={tactic}
              isEdited={isEdited}
              enabled={!disabledTactics.has(tactic.tactic)}
              canDisable={liveTactics.length - disabledTactics.size > 1}
              maxConf={maxConf}
              maxInt={maxInt}
              maxAvail={maxAvail}
              maxExtent={maxExtent}
              maxCIA={maxCIA}
              onSave={(field, value) => setOverride(tactic.tactic, field, value)}
              onReset={() => resetOverride(tactic.tactic)}
              onEnabledChange={enabled => setTacticEnabled(tactic.tactic, enabled)}
            />
          );
        })}
      </div>

      {/* comparison table */}
      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Tactic Comparison Table</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Sorted by CIA Total (descending) · overrides highlighted</p>
          </div>
          {editedCount > 0 && (
            <span className="text-xs text-primary bg-primary/10 border border-primary/30 px-2 py-0.5 rounded">
              {editedCount} tactic{editedCount !== 1 ? "s" : ""} edited
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Tactic</th>
                <th className="text-center px-4 py-2.5 text-xs text-muted-foreground font-medium">Status</th>
                <th className="text-center px-4 py-2.5 text-xs text-muted-foreground font-medium">Rating</th>
                <th className="text-right px-4 py-2.5 text-xs text-blue-400 font-medium">Conf.</th>
                <th className="text-center px-4 py-2.5 text-xs text-muted-foreground font-medium">Rating</th>
                <th className="text-right px-4 py-2.5 text-xs text-green-400 font-medium">Int.</th>
                <th className="text-center px-4 py-2.5 text-xs text-muted-foreground font-medium">Rating</th>
                <th className="text-right px-4 py-2.5 text-xs text-yellow-400 font-medium">Avail.</th>
                <th className="text-right px-4 py-2.5 text-xs text-foreground font-medium">CIA Total</th>
                <th className="text-right px-4 py-2.5 text-xs text-violet-400 font-medium">TTP Extent</th>
              </tr>
            </thead>
            <tbody>
              {sortedForTable.map(tactic => {
                const color = TACTIC_COLORS[tactic.tactic] || "bg-primary";
                const c = confScore(tactic.conf);
                const i = intScore(tactic.integrity);
                const a = availScore(tactic.avail);
                const total = c + i + a;
                const isEdited = overrides[tactic.tactic] !== undefined;
                const enabled = !disabledTactics.has(tactic.tactic);
                return (
                  <tr key={tactic.tactic} className={`border-b border-border/40 hover:bg-accent/20 transition-colors ${isEdited ? "bg-primary/5" : ""} ${enabled ? "" : "opacity-55"}`}>
                    <td className="px-4 py-3">
                      <Link href={`/all-procedures?tactic=${encodeURIComponent(tactic.tactic)}`}>
                        <div className="flex items-center gap-2 group cursor-pointer">
                          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${color}`} />
                          <span className="text-sm font-medium text-foreground group-hover:text-primary group-hover:underline transition-colors">
                            {tactic.tactic}
                          </span>
                          {isEdited && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/30 font-semibold">edited</span>
                          )}
                        </div>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-[10px] rounded-full border px-2 py-0.5 font-semibold ${
                        enabled
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border-muted bg-muted/30 text-muted-foreground"
                      }`}>
                        {enabled ? "Enabled" : "Disabled"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center"><RatingBadge label={tactic.conf} /></td>
                    <td className="px-4 py-3 text-right text-xs text-blue-400 font-semibold font-mono">{c.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center"><RatingBadge label={tactic.integrity} /></td>
                    <td className="px-4 py-3 text-right text-xs text-green-400 font-semibold font-mono">{i.toFixed(2)}</td>
                    <td className="px-4 py-3 text-center"><RatingBadge label={tactic.avail} /></td>
                    <td className="px-4 py-3 text-right text-xs text-yellow-400 font-semibold font-mono">{a.toFixed(2)}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-sm font-bold text-foreground">{total.toFixed(2)}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-violet-400 font-semibold font-mono">
                      {Number(tactic.extent) || 0}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
