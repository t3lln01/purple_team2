import { useState, useRef, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Link, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import ActorPrioritisation from "@/pages/ActorPrioritisation";
import RiskCalculation from "@/pages/RiskCalculation";
import HighValueAssets from "@/pages/HighValueAssets";
import TidPriority from "@/pages/TidPriority";
import TacticsScores from "@/pages/TacticsScores";
import RiskRate from "@/pages/RiskRate";
import AllProcedures from "@/pages/AllProcedures";
import DataSources from "@/pages/DataSources";
import { TacticScoresProvider }    from "@/context/TacticScoresContext";
import { LikelihoodProvider }       from "@/context/LikelihoodContext";
import { AppDataProvider, useAppData } from "@/context/AppDataContext";
import { ImpactOverridesProvider }  from "@/context/ImpactOverridesContext";
import { HVAScoresProvider }        from "@/context/HVAScoresContext";
import { DateWindowProvider, useDateWindow, DATE_RANGE_LABELS, type DateRange } from "@/context/DateWindowContext";
import { Shield, Users, Activity, Target, ChartBar, AlertTriangle, List, Database, Table2, TrendingUp, CalendarRange, ChevronDown, Crosshair, BookOpen } from "lucide-react";
import ImpactTable       from "@/pages/ImpactTable";
import LikelihoodTable   from "@/pages/LikelihoodTable";
import ThreatModel       from "@/pages/ThreatModel";
import ApiDocs           from "@/pages/ApiDocs";
import { ThreatModelQuarterProvider, useThreatModelQuarter } from "@/context/ThreatModelQuarterContext";

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

const navItems = [
  { path: "/dashboard", label: "Actor Prioritisation", icon: Users },
  { path: "/threat-model", label: "Threat Model", icon: Crosshair },
  { path: "/risk-calculation", label: "Risk Calculation", icon: Activity },
  { path: "/impact-table",      label: "Impact Table",      icon: Table2 },
  { path: "/likelihood-table",  label: "Likelihood Table",  icon: TrendingUp },
  { path: "/high-value-assets", label: "High Value Assets", icon: Target },
  { path: "/tid-priority", label: "TID Priority", icon: ChartBar },
  { path: "/tactics-scores", label: "Tactic Scores", icon: AlertTriangle },
  { path: "/risk-rate", label: "Risk Rate", icon: Shield },
  { path: "/all-procedures", label: "All Procedures", icon: List },
  { path: "/data-sources", label: "Data Sources", icon: Database },
  { path: "/api-docs",     label: "API",          icon: BookOpen },
];

function DatePickerWidget() {
  const { dateRange, setDateRange, customFrom, customTo, setCustomFrom, setCustomTo } = useDateWindow();
  const { selectedQuarter } = useThreatModelQuarter();
  const [location] = useLocation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const quarterControlsRisk = stripBase(location) === "/risk-calculation";

  useEffect(() => {
    function onOut(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onOut);
    return () => document.removeEventListener("mousedown", onOut);
  }, []);

  if (quarterControlsRisk) {
    return (
      <Link href="/threat-model">
        <span className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-primary/40 bg-primary/15 px-3 py-2 text-xs font-medium text-primary transition-colors hover:bg-primary/20">
          <CalendarRange className="h-3.5 w-3.5 flex-shrink-0" />
          <span className="flex-1 truncate text-left">{selectedQuarter} procedures</span>
          <Crosshair className="h-3 w-3 flex-shrink-0" />
        </span>
      </Link>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-medium transition-colors ${
          dateRange !== "all"
            ? "bg-primary/15 text-primary border-primary/40"
            : "bg-sidebar-accent/30 border-sidebar-border text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
        }`}
      >
        <CalendarRange className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate flex-1 text-left">{DATE_RANGE_LABELS[dateRange]}</span>
        {dateRange === "custom" && customFrom && customTo && (
          <span className="text-muted-foreground font-normal truncate">
            {new Date(customFrom).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}–{new Date(customTo).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 bottom-full mb-1.5 z-50 w-64 bg-card border border-border rounded-xl shadow-2xl overflow-hidden">
          <div className="p-3 border-b border-border">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Calculation date window</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Filters procedure-based views that use the global date window</p>
          </div>
          <div className="p-2 space-y-0.5">
            {(["all", "3m", "6m", "9m", "1y", "custom"] as DateRange[]).map(opt => (
              <button
                key={opt}
                onClick={() => { setDateRange(opt); if (opt !== "custom") setOpen(false); }}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-colors text-left ${
                  dateRange === opt ? "bg-primary/15 text-primary font-medium" : "text-foreground hover:bg-accent"
                }`}
              >
                <span>{DATE_RANGE_LABELS[opt]}</span>
                {dateRange === opt && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
              </button>
            ))}
          </div>
          {dateRange === "custom" && (
            <div className="px-3 pb-3 pt-2 border-t border-border space-y-2">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-muted-foreground font-medium">From</label>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)}
                  className="bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:dark]" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-muted-foreground font-medium">To</label>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)}
                  className="bg-input border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring [color-scheme:dark]" />
              </div>
              {(customFrom || customTo) && (
                <button onClick={() => setOpen(false)}
                  className="w-full py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors font-medium">
                  Apply
                </button>
              )}
            </div>
          )}
          {dateRange !== "all" && (
            <div className="px-3 pb-3">
              <button
                onClick={() => { setDateRange("all"); setCustomFrom(""); setCustomTo(""); setOpen(false); }}
                className="w-full text-xs text-muted-foreground hover:text-foreground underline transition-colors text-center"
              >
                Reset to all time
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Sidebar() {
  const [location] = useLocation();
  const { mitreVersions, activeMitreVersionId } = useAppData();
  const activeVersion = activeMitreVersionId
    ? mitreVersions.find(v => v.id === activeMitreVersionId)
    : null;
  const mitreLabel = activeVersion?.label ?? "MITRE ATT&CK v16";

  return (
    <aside className="w-64 min-h-screen bg-sidebar border-r border-sidebar-border flex flex-col">
      <div className="p-6 border-b border-sidebar-border">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Shield className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-bold text-sm text-sidebar-foreground">Purple Team</div>
            <div className="text-xs text-muted-foreground">Adversary Prioritisation</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 overflow-y-auto flex flex-col gap-0.5">
        {navItems.map(({ path, label, icon: Icon }) => {
          const isActive = location === path;
          return (
            <Link key={path} href={path}>
              <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              }`}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm">{label}</span>
              </div>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-sidebar-border space-y-3">
        <DatePickerWidget />
        <div>
          <div className="text-xs text-muted-foreground">{mitreLabel}</div>
          <div className="text-xs text-muted-foreground">Purple Team Framework</div>
        </div>
      </div>
    </aside>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}

function DashboardRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/dashboard" component={ActorPrioritisation} />
        <Route path="/threat-model" component={ThreatModel} />
        <Route path="/risk-calculation" component={RiskCalculation} />
        <Route path="/impact-table"     component={ImpactTable} />
        <Route path="/likelihood-table" component={LikelihoodTable} />
        <Route path="/high-value-assets" component={HighValueAssets} />
        <Route path="/tid-priority" component={TidPriority} />
        <Route path="/tactics-scores" component={TacticsScores} />
        <Route path="/risk-rate" component={RiskRate} />
        <Route path="/all-procedures" component={AllProcedures} />
        <Route path="/data-sources" component={DataSources} />
        <Route path="/api-docs"     component={ApiDocs} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function AppProvidersAndRoutes() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThreatModelQuarterProvider>
          <AppDataProvider>
            <TacticScoresProvider>
              <DateWindowProvider>
                <LikelihoodProvider>
                  <ImpactOverridesProvider>
                    <HVAScoresProvider>
                      <Switch>
                        <Route path="/"><Redirect to="/dashboard" /></Route>
                        <Route path="/dashboard" component={DashboardRouter} />
                        <Route path="/threat-model" component={DashboardRouter} />
                        <Route path="/risk-calculation" component={DashboardRouter} />
                        <Route path="/impact-table" component={DashboardRouter} />
                        <Route path="/likelihood-table" component={DashboardRouter} />
                        <Route path="/high-value-assets" component={DashboardRouter} />
                        <Route path="/tid-priority" component={DashboardRouter} />
                        <Route path="/tactics-scores" component={DashboardRouter} />
                        <Route path="/risk-rate" component={DashboardRouter} />
                        <Route path="/all-procedures" component={DashboardRouter} />
                        <Route path="/data-sources" component={DashboardRouter} />
                        <Route path="/api-docs" component={DashboardRouter} />
                        <Route><Redirect to="/dashboard" /></Route>
                      </Switch>
                    </HVAScoresProvider>
                  </ImpactOverridesProvider>
                </LikelihoodProvider>
              </DateWindowProvider>
            </TacticScoresProvider>
          </AppDataProvider>
        </ThreatModelQuarterProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <AppProvidersAndRoutes />
    </WouterRouter>
  );
}

export default App;
