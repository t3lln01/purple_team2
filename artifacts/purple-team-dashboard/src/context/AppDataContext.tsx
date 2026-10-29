import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import data from "@/data.json";
import {
  calcCIAScore,
  calcImpactScore,
  calcImpactRate,
  calcTTPExtent,
  calcLikelihoodScore,
  calcLikelihoodRate,
  CONF_SCORES,
  INT_SCORES,
  AVAIL_SCORES,
} from "@/utils/impactFormulas";

// ── base data constants ────────────────────────────────────────────────────────
const _baseImpactIds = new Set<string>(
  ((data as any).impactTable ?? []).map((r: any) => r.id as string)
);
const _baseRiskIds = new Set<string>(
  ((data as any).riskCalc ?? []).map((r: any) => r.TID as string)
);
const _tacticExtentMap: Record<string, number> = Object.fromEntries(
  ((data as any).tactics ?? []).map((t: any) => [t.tactic as string, Number(t.extent) || 1])
);

type TacticDatum = { tactic: string; conf: string; integrity: string; avail: string; extent: number };
const _tacticData: TacticDatum[] = ((data as any).tactics ?? []) as TacticDatum[];

function _bestTacticForTid(tacticNames: string[]): TacticDatum | null {
  const disabled = (() => {
    try {
      const stored = JSON.parse(localStorage.getItem("pt_disabled_tactics") ?? "[]");
      return new Set<string>(Array.isArray(stored) ? stored : []);
    } catch {
      return new Set<string>();
    }
  })();
  let best: TacticDatum | null = null;
  for (const name of tacticNames) {
    if (disabled.has(name)) continue;
    const t = _tacticData.find(td => td.tactic === name);
    if (!t) continue;
    if (!best || calcCIAScore(t.conf, t.integrity, t.avail) > calcCIAScore(best.conf, best.integrity, best.avail)) {
      best = t;
    }
  }
  return best;
}

function _autoPopulateVersionOverrides(v: { id: string; impactRows: Array<{ id: string; tactics: string }> }) {
  const impOvKey = `pt_impact_overrides:${v.id}`;
  const likOvKey = `pt_likelihood_overrides:${v.id}`;
  const existingImp: Record<string, object> =
    JSON.parse(localStorage.getItem(impOvKey) ?? "{}");
  const existingLik: Record<string, object> =
    JSON.parse(localStorage.getItem(likOvKey) ?? "{}");

  let changed = false;
  for (const row of v.impactRows) {
    if (_baseImpactIds.has(row.id)) continue;
    if (existingImp[row.id]) continue;

    const tacticNames = (row.tactics || "").split(", ").filter(Boolean);
    const best = _bestTacticForTid(tacticNames);

    existingImp[row.id] = {
      confidentiality:    best?.conf      ?? "Medium",
      integrity:          best?.integrity ?? "Medium",
      availability:       best?.avail     ?? "Low",
      initialTTPExtent:   best?.extent    ?? 1,
      adScore:            0,
      containerScore:     0,
      cloudScore:         0,
      supportRemoteScore: 0,
      systemReqScore:     0,
      capecSeverityScore: 0,
      permRequiredScore:  0,
      effectivePermsScore:0,
    };
    existingLik[row.id] = { confidence: "high confidence" };
    changed = true;
  }

  if (changed) {
    try { localStorage.setItem(impOvKey, JSON.stringify(existingImp)); } catch {}
    try { localStorage.setItem(likOvKey, JSON.stringify(existingLik)); } catch {}
  }
}

// ── Full 656-technique riskCalc base ──────────────────────────────────────────
// data.json's riskCalc only covers 200 prioritised techniques. For every
// impactTable entry not already present we compute equivalent rows using
// conservative defaults so that Likelihood Table and Risk Calculation show
// all 656 ATT&CK techniques.
const _DEFAULT_LAST_OCC       = "between 1 and 2 yrs";
const _DEFAULT_LAST_OCC_SCORE = 1.1;
const _DEFAULT_CONF           = "medium confidence";
const _DEFAULT_CONF_SCORE     = 1.0;
const _DEFAULT_TID_PRIORITY   = 1;
const _DEFAULT_HVA            = 1;

export const baseFullRiskCalc: object[] = (() => {
  const result: object[] = [...((data as any).riskCalc ?? [])];
  const riskIds = new Set(((data as any).riskCalc ?? []).map((r: any) => r.TID as string));

  for (const row of ((data as any).impactTable ?? [])) {
    if (riskIds.has(row.id)) continue;

    const conf  = row.confidentiality ?? "Medium";
    const int_  = row.integrity       ?? "Medium";
    const avail = row.availability    ?? "Low";
    const ciaScore  = calcCIAScore(conf, int_, avail);
    const ttpExtent = Number(row.finalTTPExtent) || 1;
    const impactScore = calcImpactScore(ciaScore, ttpExtent, _DEFAULT_HVA);
    const impactRate  = calcImpactRate(impactScore);
    const likScore    = calcLikelihoodScore(_DEFAULT_TID_PRIORITY, _DEFAULT_LAST_OCC_SCORE, _DEFAULT_CONF_SCORE, _DEFAULT_HVA);
    const likRate     = calcLikelihoodRate(likScore);

    result.push({
      TID:                       row.id,
      "Technique Name":          row.name,
      Platforms:                 row.platforms ?? "",
      Tactic:                    row.tactics   ?? "",
      Confidentiality:           conf,
      "Confidentiality Score":   CONF_SCORES[conf]  ?? 0,
      Integrity:                 int_,
      "Integrity Score":         INT_SCORES[int_]   ?? 0,
      Availability:              avail,
      "Availability Score":      AVAIL_SCORES[avail] ?? 0,
      "CIA Score":               ciaScore,
      "TTP Extent Score":        ttpExtent,
      "HIGH VALUE ASSSET RISK":  _DEFAULT_HVA,
      "Impact Score":            impactScore,
      "Impact Rate":             impactRate,
      "TID  Priority":           _DEFAULT_TID_PRIORITY,
      "Last Occurrence":         _DEFAULT_LAST_OCC,
      "Last occurrence Score":   _DEFAULT_LAST_OCC_SCORE,
      Confidence:                _DEFAULT_CONF,
      "Confidence Score":        _DEFAULT_CONF_SCORE,
      "Likelihood Score":        likScore,
      "Likelihood Rate":         likRate,
      "Risk Rate":               0,
      "Risk Scores":             impactScore * likScore,
    });
  }
  return result;
})();

// ── public types ───────────────────────────────────────────────────────────────
export type LiveActorData = {
  procedures: Array<{
    actor: string;
    mitreId: string;
    tacticName: string;
    techniqueName: string;
    procedure: string;
    date: number | null;
    externalRef: string;
    risk: number;
    reportRefs: string[];
  }>;
  actorRanking: Array<{
    actor: string;
    score: number;
    techniqueCount: number;
    tacticCount: number;
    reportCount: number;
  }>;
  label: string;
  loadedAt: string;
};

export type NewImpactRow = {
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
  _isNew: true;
};

export type NewRiskRow = {
  TID: string;
  "Technique Name": string;
  Platforms: string;
  Tactic: string;
  Confidentiality: string;
  "Confidentiality Score": number;
  Integrity: string;
  "Integrity Score": number;
  Availability: string;
  "Availability Score": number;
  "CIA Score": number;
  "TTP Extent Score": number;
  "HIGH VALUE ASSSET RISK": number;
  "Impact Score": number;
  "Impact Rate": string;
  "TID  Priority": number;
  "Last Occurrence": string;
  "Last occurrence Score": number;
  Confidence: string;
  "Confidence Score": number;
  "Likelihood Score": number;
  "Likelihood Rate": string;
  "Risk Rate": number;
  "Risk Scores": number;
  _isNew: true;
};

export type MitreVersion = {
  id: string;
  label: string;
  specVersion: string;
  loadedAt: string;
  totalTechniques: number;
  newTechniqueCount: number;
  impactRows: NewImpactRow[];
  riskRows: NewRiskRow[];
};

// ── utility: build version data from raw STIX JSON ────────────────────────────
export function buildMitreVersionData(json: any): {
  version: MitreVersion;
  stixMap: Record<string, { name: string; platforms: string; tactics: string; description: string }>;
} {
  const objects: any[] = json.objects ?? [];

  // Extract version label
  let versionStr = "";
  for (const o of objects) {
    if ((o.type === "x-mitre-collection" || o.type === "x-mitre-matrix") && o.x_mitre_version) {
      versionStr = String(o.x_mitre_version);
      break;
    }
  }
  const label = versionStr
    ? `MITRE ATT&CK v${versionStr}`
    : `MITRE ATT&CK (${new Date().toLocaleDateString()})`;
  const specVersion = versionStr || new Date().toISOString();

  // Parse all attack-patterns
  const techs = objects
    .filter((o) => o.type === "attack-pattern" && !o.revoked && !o.x_mitre_deprecated)
    .map((o) => {
      const id =
        (o.external_references ?? []).find((r: any) => r.source_name === "mitre-attack")
          ?.external_id ?? "";
      const name: string = o.name ?? "";
      const platforms: string = (o.x_mitre_platforms ?? []).join(", ");
      const tacticNames: string[] = (o.kill_chain_phases ?? []).map((p: any) =>
        (p.phase_name as string)
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c: string) => c.toUpperCase())
      );
      const description: string = (o.description ?? "")
        .replace(/\[.*?\]\(https?:\/\/[^)]+\)/g, (m: string) =>
          m.replace(/\[([^\]]+)\].*/, "$1")
        )
        .slice(0, 800);
      const impactTypes: string[] = o.x_mitre_impact_type ?? [];
      return { id, name, platforms, tacticNames, description, impactTypes };
    })
    .filter((t) => t.id);

  // Build stixMap (all techniques)
  const stixMap: Record<string, { name: string; platforms: string; tactics: string; description: string }> =
    {};
  for (const t of techs) {
    stixMap[t.id] = {
      name: t.name,
      platforms: t.platforms,
      tactics: t.tacticNames.join(", "),
      description: t.description,
    };
  }

  // Build delta rows for NEW techniques only
  const impactRows: NewImpactRow[] = [];
  const riskRows: NewRiskRow[] = [];

  for (const t of techs) {
    if (_baseImpactIds.has(t.id)) continue;

    const hasCIA = t.impactTypes.length > 0;
    const conf = hasCIA
      ? t.impactTypes.includes("Confidentiality")
        ? "High"
        : "Low"
      : "Medium";
    const integrity = hasCIA
      ? t.impactTypes.includes("Integrity")
        ? "High"
        : "Low"
      : "Medium";
    const avail = hasCIA
      ? t.impactTypes.includes("Availability")
        ? "High"
        : "Low"
      : "Medium";

    const primaryTactic = t.tacticNames[0] ?? "";
    const initExtent = _tacticExtentMap[primaryTactic] ?? 1;

    const ttpFactors = {
      initialTTPExtent: initExtent,
      adScore: 0,
      containerScore: 0,
      cloudScore: 0,
      supportRemoteScore: 0,
      systemReqScore: 0,
      capecSeverityScore: 0,
      permRequiredScore: 0,
      effectivePermsScore: 0,
    };
    const finalTTPExtent = calcTTPExtent(ttpFactors);

    const impactRow: NewImpactRow = {
      id: t.id,
      name: t.name,
      platforms: t.platforms,
      tactics: t.tacticNames.join(", "),
      confidentiality: conf,
      integrity,
      availability: avail,
      capecSeverity: "",
      dataSources: "",
      ...ttpFactors,
      finalTTPExtent,
      _isNew: true,
    };
    impactRows.push(impactRow);

    if (!_baseRiskIds.has(t.id)) {
      const ciaScore = calcCIAScore(conf, integrity, avail);
      const impactScore = calcImpactScore(ciaScore, finalTTPExtent, 1);
      const impactRate = calcImpactRate(impactScore);
      const confidenceScore = 1.0;
      const tidPriority = 1;
      const lastOccScore = 1.0;
      const likScore = tidPriority * lastOccScore * confidenceScore;
      const riskScore = impactScore * likScore;

      riskRows.push({
        TID: t.id,
        "Technique Name": t.name,
        Platforms: t.platforms,
        Tactic: t.tacticNames.join(", "),
        Confidentiality: conf,
        "Confidentiality Score": CONF_SCORES[conf] ?? 0,
        Integrity: integrity,
        "Integrity Score": INT_SCORES[integrity] ?? 0,
        Availability: avail,
        "Availability Score": AVAIL_SCORES[avail] ?? 0,
        "CIA Score": ciaScore,
        "TTP Extent Score": finalTTPExtent,
        "HIGH VALUE ASSSET RISK": 1,
        "Impact Score": impactScore,
        "Impact Rate": impactRate,
        "TID  Priority": tidPriority,
        "Last Occurrence": "1-3 years",
        "Last occurrence Score": lastOccScore,
        Confidence: "Medium",
        "Confidence Score": confidenceScore,
        "Likelihood Score": likScore,
        "Likelihood Rate": calcLikelihoodRate(likScore),
        "Risk Rate": riskScore,
        "Risk Scores": riskScore,
        _isNew: true,
      });
    }
  }

  const version: MitreVersion = {
    id: `mitre_${Date.now()}`,
    label,
    specVersion,
    loadedAt: new Date().toISOString(),
    totalTechniques: techs.length,
    newTechniqueCount: impactRows.length,
    impactRows,
    riskRows,
  };

  return { version, stixMap };
}

// ── localStorage ───────────────────────────────────────────────────────────────
const LS_LIVE_ACTORS = "pt_live_actor_data";
const LS_MITRE_VERSIONS = "pt_mitre_versions_meta";
const LS_ACTIVE_MITRE = "pt_active_mitre_version";

function loadLiveActorData(): LiveActorData | null {
  try {
    return JSON.parse(localStorage.getItem(LS_LIVE_ACTORS) ?? "null");
  } catch {
    return null;
  }
}
function saveLiveActorData(d: LiveActorData | null) {
  if (d) {
    try {
      localStorage.setItem(LS_LIVE_ACTORS, JSON.stringify(d));
    } catch {}
  } else {
    localStorage.removeItem(LS_LIVE_ACTORS);
  }
}
function loadMitreVersions(): MitreVersion[] {
  try {
    return JSON.parse(localStorage.getItem(LS_MITRE_VERSIONS) ?? "[]");
  } catch {
    return [];
  }
}
function saveMitreVersions(v: MitreVersion[]) {
  try {
    localStorage.setItem(LS_MITRE_VERSIONS, JSON.stringify(v));
  } catch {}
}
function loadActiveMitreVersionId(): string | null {
  return localStorage.getItem(LS_ACTIVE_MITRE) ?? null;
}
function saveActiveMitreVersionId(id: string | null) {
  if (id) localStorage.setItem(LS_ACTIVE_MITRE, id);
  else localStorage.removeItem(LS_ACTIVE_MITRE);
}

// ── context ───────────────────────────────────────────────────────────────────
type AppDataCtx = {
  liveActorData: LiveActorData | null;
  setLiveActorData: (d: LiveActorData | null) => void;
  clearLiveActorData: () => void;
  mitreVersions: MitreVersion[];
  activeMitreVersionId: string | null;
  setActiveMitreVersionId: (id: string | null) => void;
  addMitreVersion: (v: MitreVersion) => void;
  removeMitreVersion: (id: string) => void;
  activeNewImpactRows: NewImpactRow[];
  activeNewRiskRows: NewRiskRow[];
  versionKey: string;
};

const AppDataCtx = createContext<AppDataCtx>(null!);

export function AppDataProvider({ children }: { children: ReactNode }) {
  const [liveActorData, setLiveActorDataState] = useState<LiveActorData | null>(loadLiveActorData);
  const [mitreVersions, setMitreVersionsState] = useState<MitreVersion[]>(loadMitreVersions);
  const [activeMitreVersionId, setActiveMitreVersionIdState] = useState<string | null>(
    loadActiveMitreVersionId
  );

  const setLiveActorData = useCallback((d: LiveActorData | null) => {
    setLiveActorDataState(d);
    saveLiveActorData(d);
  }, []);

  const clearLiveActorData = useCallback(() => {
    setLiveActorDataState(null);
    saveLiveActorData(null);
  }, []);

  const setActiveMitreVersionId = useCallback((id: string | null) => {
    setActiveMitreVersionIdState(id);
    saveActiveMitreVersionId(id);
  }, []);

  const addMitreVersion = useCallback((v: MitreVersion) => {
    _autoPopulateVersionOverrides(v);
    setMitreVersionsState((prev) => {
      const next = [...prev.filter((x) => x.specVersion !== v.specVersion), v];
      saveMitreVersions(next);
      return next;
    });
  }, []);

  const removeMitreVersion = useCallback(
    (id: string) => {
      setMitreVersionsState((prev) => {
        const next = prev.filter((x) => x.id !== id);
        saveMitreVersions(next);
        return next;
      });
      if (activeMitreVersionId === id) {
        setActiveMitreVersionIdState(null);
        saveActiveMitreVersionId(null);
      }
    },
    [activeMitreVersionId]
  );

  const activeVersion = activeMitreVersionId
    ? mitreVersions.find((v) => v.id === activeMitreVersionId) ?? null
    : null;

  const activeNewImpactRows = activeVersion?.impactRows ?? [];
  const activeNewRiskRows = activeVersion?.riskRows ?? [];
  const versionKey = activeMitreVersionId ?? "base";

  return (
    <AppDataCtx.Provider
      value={{
        liveActorData,
        setLiveActorData,
        clearLiveActorData,
        mitreVersions,
        activeMitreVersionId,
        setActiveMitreVersionId,
        addMitreVersion,
        removeMitreVersion,
        activeNewImpactRows,
        activeNewRiskRows,
        versionKey,
      }}
    >
      {children}
    </AppDataCtx.Provider>
  );
}

export function useAppData() {
  return useContext(AppDataCtx);
}
