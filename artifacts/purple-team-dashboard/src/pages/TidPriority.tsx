import { useState, useMemo } from "react";
import { Link } from "wouter";
import data from "@/data.json";
import { useSortTable } from "@/hooks/useSortTable";
import SortableTh from "@/components/SortableTh";
import { useAppData } from "@/context/AppDataContext";
import { dateValToStr, lastOccToCategory } from "@/utils/impactFormulas";
import { useTacticScores } from "@/context/TacticScoresContext";

type TIDRow = {
  tid: string;
  count: number;
  lastObs: number;
  risk: number;
};

const tidPriority: TIDRow[] = (data as any).tidPriority;

function riskBand(risk: number) {
  if (risk >= 1000) return { label: "Critical", cls: "bg-red-500/10 border border-red-500/30 text-red-400" };
  if (risk >= 600)  return { label: "High",     cls: "bg-orange-500/10 border border-orange-500/30 text-orange-400" };
  if (risk >= 300)  return { label: "Medium",   cls: "bg-yellow-500/10 border border-yellow-500/30 text-yellow-400" };
  return                  { label: "Low",       cls: "bg-green-500/10 border border-green-500/30 text-green-400" };
}

export default function TidPriority() {
  const [search, setSearch] = useState("");
  const { liveActorData } = useAppData();
  const { isTidEnabled } = useTacticScores();
  const enabledRows = useMemo(
    () => tidPriority.filter(row => isTidEnabled(row.tid)),
    [isTidEnabled],
  );

  // Compute the most-recent procedure date per TID from live data
  const liveDateByTid = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of liveActorData?.procedures ?? []) {
      if (!isTidEnabled(p.mitreId)) continue;
      if (p.mitreId && p.date && p.date > (m[p.mitreId] ?? 0)) m[p.mitreId] = p.date;
    }
    return m;
  }, [liveActorData, isTidEnabled]);

  // Merge live dates into base rows: use the live date when it is more recent than base
  const enrichedRows = useMemo(() => enabledRows.map(row => {
    const baseMs  = row.lastObs > 1e8 ? row.lastObs : Math.round((row.lastObs - 25569) * 86400 * 1000);
    const liveMs  = liveDateByTid[row.tid] ?? 0;
    const isLive  = liveMs > baseMs;
    return { ...row, lastObs: isLive ? liveMs : row.lastObs, _live: isLive };
  }), [enabledRows, liveDateByTid]);

  const filteredBase = useMemo(() =>
    enrichedRows.filter(r => !search || r.tid.toLowerCase().includes(search.toLowerCase())),
    [enrichedRows, search]
  );
  const { sortKey, sortDir, toggle, sorted: filtered } = useSortTable(filteredBase, "risk", "desc");

  const maxRisk  = Math.max(...enabledRows.map(r => r.risk), 1);
  const critical = enabledRows.filter(r => r.risk >= 1000).length;
  const high     = enabledRows.filter(r => r.risk >= 600 && r.risk < 1000).length;
  const liveCount = Object.keys(liveDateByTid).length;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">TID Priority</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Top {enabledRows.length} technique IDs ranked by risk score and procedure coverage
          {liveCount > 0 && <span className="text-primary"> · {liveCount} TIDs have live last-observed dates</span>}
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-primary">{enabledRows.length}</div>
          <div className="text-sm text-muted-foreground mt-1">Techniques Ranked</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-red-400">{critical}</div>
          <div className="text-sm text-muted-foreground mt-1">Critical (&gt;1000)</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-orange-400">{high}</div>
          <div className="text-sm text-muted-foreground mt-1">High (600–1000)</div>
        </div>
        <div className="bg-card border border-card-border rounded-xl p-4">
          <div className="text-2xl font-bold text-chart-2">{Math.max(...enabledRows.map(r => r.count), 0)}</div>
          <div className="text-sm text-muted-foreground mt-1">Max Procedures</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Top 15 by Risk Score</h2>
          </div>
          <div className="p-4 space-y-3">
            {[...enrichedRows].sort((a, b) => b.risk - a.risk).slice(0, 15).map(row => (
              <div key={row.tid}>
                <div className="flex justify-between text-xs mb-1">
                  <Link href={`/all-procedures?mitre=${encodeURIComponent(row.tid)}`}>
                    <span className="font-mono text-primary hover:underline cursor-pointer" title="View procedures">{row.tid}</span>
                  </Link>
                  <span className="text-muted-foreground">{row.risk.toFixed(0)}</span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${(row.risk / maxRisk) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-card border border-card-border rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border">
            <h2 className="font-semibold">Top 15 by Procedure Count</h2>
          </div>
          <div className="p-4 space-y-3">
            {[...enrichedRows].sort((a, b) => b.count - a.count).slice(0, 15).map(row => {
              const maxCount = Math.max(...enabledRows.map(r => r.count), 1);
              return (
                <div key={row.tid}>
                  <div className="flex justify-between text-xs mb-1">
                    <Link href={`/all-procedures?mitre=${encodeURIComponent(row.tid)}`}>
                      <span className="font-mono text-primary hover:underline cursor-pointer" title="View procedures">{row.tid}</span>
                    </Link>
                    <span className="text-muted-foreground">{row.count} procedures</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-chart-2 rounded-full" style={{ width: `${(row.count / maxCount) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-card border border-card-border rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <h2 className="font-semibold flex-shrink-0">Full TID Priority Table</h2>
          <input
            type="search"
            placeholder="Search TIDs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 bg-input border border-border rounded-lg px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">{filtered.length} result{filtered.length !== 1 ? "s" : ""}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">#</th>
                <SortableTh col="tid"     sortKey={sortKey} sortDir={sortDir} toggle={toggle}>TID</SortableTh>
                <SortableTh col="count"   sortKey={sortKey} sortDir={sortDir} toggle={toggle}>Procedure Count</SortableTh>
                <SortableTh col="lastObs" sortKey={sortKey} sortDir={sortDir} toggle={toggle}>Last Observed</SortableTh>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Occ. Category</th>
                <SortableTh col="risk"    sortKey={sortKey} sortDir={sortDir} toggle={toggle}>Risk Score</SortableTh>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Risk Band</th>
                <th className="text-left px-4 py-2.5 text-xs text-muted-foreground font-medium">Risk Bar</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row, i) => {
                const band = riskBand(row.risk);
                const occCat = lastOccToCategory(row.lastObs);
                const isLive = (row as any)._live;
                return (
                  <tr key={row.tid} className="border-b border-border/40 hover:bg-accent/20 transition-colors">
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-2.5">
                      <Link href={`/all-procedures?mitre=${encodeURIComponent(row.tid)}`}>
                        <span className="font-mono text-xs text-primary bg-primary/10 px-2 py-0.5 rounded hover:bg-primary/20 transition-colors cursor-pointer">
                          {row.tid}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-foreground font-semibold">{row.count}</td>
                    <td className="px-4 py-2.5 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">{dateValToStr(row.lastObs)}</span>
                        {isLive && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium border border-primary/20">live</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-xs text-muted-foreground">{occCat}</td>
                    <td className="px-4 py-2.5 text-xs font-mono font-bold text-foreground">{row.risk.toFixed(1)}</td>
                    <td className="px-4 py-2.5">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${band.cls}`}>{band.label}</span>
                    </td>
                    <td className="px-4 py-2.5 w-32">
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full" style={{ width: `${(row.risk / maxRisk) * 100}%` }} />
                      </div>
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
