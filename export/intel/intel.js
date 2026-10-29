/* Synced from the purple team priorities repo by bin/build_80_intel.py. Edit export/intel there. */
const VIEWS = [
    { id: "actors", label: "Actor Prioritisation" },
    { id: "threat-model", label: "Threat Model" },
    { id: "risk", label: "Risk Calculation" },
    { id: "impact", label: "Impact" },
    { id: "likelihood", label: "Likelihood" },
    { id: "hva", label: "High Value Assets" },
    { id: "tid", label: "TID Priority" },
    { id: "tactics", label: "Tactic Scores" },
    { id: "risk-rate", label: "Risk Rate" },
    { id: "procedures", label: "All Procedures" },
];

const PAGE_SIZE = 40;
const state = {
    search: "",
    level: "All",
    tactic: "All",
    monitored: "yes",
    sortKey: null,
    sortDir: "desc",
    page: 0,
};

let data = null;
let threatModel = null;
let ranked = [];
let priorityCeiling = 0;
let actorChart = null;

const viewEl = document.getElementById("view");
const subnavEl = document.getElementById("subnav");

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

function num(value, digits = 2) {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function parseHash() {
    const raw = (location.hash || "#actors").replace(/^#/, "");
    const [id, query] = raw.split("?");
    const known = VIEWS.some((view) => view.id === id) ? id : "actors";
    return { id: known, params: new URLSearchParams(query || "") };
}

function actorKey(name) {
    return String(name || "").trim().toUpperCase();
}

function actorTidRisks(procedures, riskScores) {
    const byActor = new Map();
    for (const procedure of procedures) {
        const tid = String(procedure.mitreId || "").trim().toUpperCase();
        const text = String(procedure.procedure || "").trim();
        const name = actorKey(procedure.actor);
        if (!name || !/^T\d{4}(?:\.\d{3})?$/.test(tid) || !text || /^\[.+\]\s*-\s*$/.test(text)) continue;
        const tids = byActor.get(name) || new Map();
        const risk = riskScores[tid] ?? procedure.risk;
        const valid = typeof risk === "number" && Number.isFinite(risk) && risk >= 0 ? risk : null;
        const previous = tids.get(tid);
        tids.set(tid, valid === null ? (previous ?? null) : Math.max(previous ?? 0, valid));
        byActor.set(name, tids);
    }
    return byActor;
}

function calculateActorPriority(intent, capability, tids = new Map()) {
    const tidCount = tids.size;
    const values = [...tids.values()];
    const missingRiskCount = values.filter((risk) => risk === null).length;
    const riskSum = values.reduce((sum, risk) => sum + (risk ?? 0), 0);
    const averageRisk = missingRiskCount ? null : tidCount ? riskSum / tidCount : 0;
    return {
        tidCount,
        missingRiskCount,
        riskSum,
        averageRisk,
        priority: averageRisk === null ? null : intent * capability * averageRisk,
    };
}

function levelFor(priorityPct) {
    if (priorityPct >= 0.8) return "Critical";
    if (priorityPct >= 0.55) return "High";
    if (priorityPct >= 0.3) return "Medium";
    return "Low";
}

function buildRanking() {
    const riskScores = {};
    for (const row of data.riskCalc || []) riskScores[row.TID] = Number(row["Risk Scores"]) || 0;
    const tidRisks = actorTidRisks(data.allProcedures || [], riskScores);
    const observed = [...tidRisks.values()].flatMap((tids) => [...tids.values()].map((risk) => risk ?? 0));
    const maxRisk = Math.max(0, ...Object.values(riskScores), ...observed);
    priorityCeiling = 49 * maxRisk;
    ranked = (threatModel.threatModelActors || [])
        .filter((actor) => actor.inMonitoringList)
        .map((actor) => {
            const intent = Math.min(7, (Number(actor.intentFinalScore) || 0) + (Number(actor.pptap) || 0) + (Number(actor.sirt) || 0));
            const capability = Number(actor.capabilityFinalScore) || 0;
            const calculation = calculateActorPriority(intent, capability, tidRisks.get(actorKey(actor.name)));
            const priorityPct = priorityCeiling > 0 ? (calculation.priority ?? 0) / priorityCeiling : 0;
            return {
                name: actor.name,
                intent,
                capability,
                inPpTap: Number(actor.pptap) > 0,
                inSirt: Number(actor.sirt) > 0,
                ...calculation,
                priorityPct,
                level: calculation.priority === null ? "Unscored" : levelFor(priorityPct),
            };
        })
        .sort((a, b) => (b.priority ?? -1) - (a.priority ?? -1) || b.intent - a.intent || a.name.localeCompare(b.name));
}

function rateClass(rate) {
    const value = String(rate || "").toLowerCase();
    if (value.includes("very high")) return "rate-very-high";
    if (value.includes("very low")) return "rate-very-low";
    if (value.includes("high")) return "rate-high";
    if (value.includes("medium")) return "rate-medium";
    if (value.includes("low")) return "rate-low";
    return "rate-none";
}

function rateRank(rate) {
    const value = String(rate || "").toLowerCase();
    if (value.includes("very high")) return 5;
    if (value.includes("high")) return 4;
    if (value.includes("medium")) return 3;
    if (value.includes("low") && !value.includes("very")) return 2;
    if (value.includes("very low")) return 1;
    return 0;
}

function dots(score, kind) {
    const n = Math.max(0, Math.min(7, Math.round(Number(score) || 0)));
    let html = '<span class="dots">';
    for (let i = 0; i < 7; i += 1) html += `<i class="${i < n ? kind : ""}"></i>`;
    return `${html}</span><span class="dot-n">${n}</span>`;
}

function formatDate(value) {
    if (!value) return "—";
    const ms = value > 1e8 ? value : Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(ms);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function procLink(label, query) {
    return `<a class="tid" href="#procedures?q=${encodeURIComponent(query)}">${esc(label)}</a>`;
}

function sortRows(rows, getters, fallbackKey) {
    const key = state.sortKey || fallbackKey;
    const get = getters[key];
    if (!get) return rows;
    const mul = state.sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
        const av = get(a);
        const bv = get(b);
        if (typeof av === "number" && typeof bv === "number") {
            return mul * ((Number.isFinite(av) ? av : -Infinity) - (Number.isFinite(bv) ? bv : -Infinity));
        }
        return mul * String(av ?? "").localeCompare(String(bv ?? ""));
    });
}

function header(label, key, className = "") {
    const active = (state.sortKey || "") === key;
    const arrow = active ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
    return `<th class="${className}" data-sort="${esc(key)}">${esc(label)}${arrow}</th>`;
}

function pager(total) {
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    if (state.page < 0) state.page = 0;
    const start = state.page * PAGE_SIZE;
    const end = Math.min(total, start + PAGE_SIZE);
    const html = total <= PAGE_SIZE ? "" : `
        <div class="pager">
            <button type="button" data-page="prev" ${state.page === 0 ? "disabled" : ""}>Previous</button>
            <span>${start + 1}–${end} of ${total}</span>
            <button type="button" data-page="next" ${state.page >= pages - 1 ? "disabled" : ""}>Next</button>
        </div>`;
    return { start, end, html };
}

function matches(query, parts) {
    if (!query) return true;
    const q = query.toLowerCase();
    return parts.some((part) => String(part ?? "").toLowerCase().includes(q));
}

function renderSubnav(active) {
    subnavEl.innerHTML = VIEWS.map((view) => {
        const href = view.id === "actors" ? "#actors" : `#${view.id}`;
        return `<a href="${href}" class="${view.id === active ? "active" : ""}">${esc(view.label)}</a>`;
    }).join("");
}

function toolbar(placeholder, extra = "") {
    return `
        <div class="toolbar">
            <input id="search" type="search" placeholder="${esc(placeholder)}" value="${esc(state.search)}">
            ${extra}
        </div>`;
}

function tacticOptions(rows, field) {
    const tactics = new Set();
    for (const row of rows) {
        String(row[field] || "").split(",").map((part) => part.trim()).filter(Boolean).forEach((tactic) => tactics.add(tactic));
    }
    const options = ["All", ...[...tactics].sort()];
    return `<select id="tactic">${options.map((tactic) => `<option ${tactic === state.tactic ? "selected" : ""}>${esc(tactic)}</option>`).join("")}</select>`;
}

function mountActors() {
    return `
        <div class="view-head">
            <h1>Actor priority rankings</h1>
            <p class="lede">Monitored threat-model actors, scored as intent × capability × average distinct TID risk. Intent includes the published PP-TAP (+1) and SIRT (+2) adjustments, capped at 7. All procedure dates are included, and a repeated TID counts once.</p>
        </div>
        <div class="stats" id="stats"></div>
        <div class="panel"><canvas id="actorChart" height="90"></canvas></div>
        ${toolbar("Search actors")}
        <div class="chips" id="levels"></div>
        <div id="results"></div>
        <p class="footnote" id="footnote"></p>`;
}

function paintActors() {
    const levels = ["All", "Critical", "High", "Medium", "Low", "Unscored"];
    document.getElementById("levels").innerHTML = levels.map((level) =>
        `<button type="button" data-level="${level}" class="${state.level === level ? "active" : ""}">${level}</button>`
    ).join("");
    const filtered = sortRows(
        ranked.filter((actor) => matches(state.search, [actor.name]) && (state.level === "All" || actor.level === state.level)),
        {
            name: (row) => row.name,
            intent: (row) => row.intent,
            capability: (row) => row.capability,
            tidCount: (row) => row.tidCount,
            averageRisk: (row) => row.averageRisk ?? -1,
            priority: (row) => row.priority ?? -1,
            level: (row) => ["Unscored", "Low", "Medium", "High", "Critical"].indexOf(row.level),
        },
        "priority",
    );
    const critical = ranked.filter((actor) => actor.level === "Critical").length;
    const high = ranked.filter((actor) => actor.level === "High").length;
    document.getElementById("stats").innerHTML = `
        <div class="stat"><b>${ranked.length}</b><span>Monitored actors</span></div>
        <div class="stat"><b>${critical}</b><span>Critical priority</span></div>
        <div class="stat"><b>${high}</b><span>High priority</span></div>`;
    const page = pager(filtered.length);
    const body = filtered.slice(page.start, page.end).map((actor, index) => `
        <tr>
            <td class="mono">${page.start + index + 1}</td>
            <td>${procLink(actor.name, actor.name)}</td>
            <td>${dots(actor.intent, "on-intent")}</td>
            <td>${dots(actor.capability, "on-cap")}</td>
            <td class="num">${actor.tidCount}</td>
            <td class="num">${actor.averageRisk === null ? "Missing risk" : num(actor.averageRisk)}</td>
            <td>
                <div class="bar" title="${num(actor.priorityPct * 100, 1)}% of ceiling"><span style="width:${Math.min(100, actor.priorityPct * 100)}%"></span></div>
                <div class="mono">${actor.priority === null ? "—" : num(actor.priority)}</div>
            </td>
            <td>${actor.inPpTap ? '<span class="tag tag-pp">PP-TAP +1</span>' : ""}${actor.inSirt ? '<span class="tag tag-sirt">SIRT +2</span>' : ""}${!actor.inPpTap && !actor.inSirt ? '<span class="muted">—</span>' : ""}</td>
            <td><span class="badge level-${actor.level.toLowerCase()}">${actor.level}</span></td>
        </tr>`).join("");
    document.getElementById("results").innerHTML = `
        <div class="table-wrap"><table>
            <thead><tr>
                <th>Rank</th>
                ${header("Actor", "name")}
                ${header("Intent", "intent")}
                ${header("Capability", "capability")}
                ${header("Known TIDs", "tidCount", "num")}
                ${header("Average TID risk", "averageRisk", "num")}
                ${header("Priority", "priority")}
                <th>Lists</th>
                ${header("Level", "level")}
            </tr></thead>
            <tbody>${body || '<tr><td colspan="9" class="empty">No actors match the current filters.</td></tr>'}</tbody>
        </table></div>${page.html}`;
    document.getElementById("footnote").textContent =
        `Priority = intent × capability × (sum of distinct observed TID risk ÷ known TID count). Bars use a ceiling of 49 × the highest TID risk (${num(priorityCeiling)}).`;
    if (!actorChart) paintActorChart();
}

function paintActorChart() {
    const canvas = document.getElementById("actorChart");
    if (!canvas || typeof Chart === "undefined") return;
    const top = ranked.filter((actor) => actor.priority !== null).slice(0, 12);
    if (actorChart) actorChart.destroy();
    actorChart = new Chart(canvas, {
        type: "bar",
        data: {
            labels: top.map((actor) => actor.name),
            datasets: [{ label: "Priority", data: top.map((actor) => actor.priority), backgroundColor: "#4f46e5" }],
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { x: { ticks: { maxRotation: 40, minRotation: 0 } }, y: { beginAtZero: true } },
        },
    });
}

function mountThreat() {
    return `
        <div class="view-head">
            <h1>Threat model</h1>
            <p class="lede">Published actor assessments. Monitoring, intent, capability, PP-TAP, and SIRT come from the threat-model snapshot.</p>
        </div>
        <div id="framework"></div>
        <div class="toolbar">
            <input id="search" type="search" placeholder="Search actors, malware, type" value="${esc(state.search)}">
            <div class="chips">
                <button type="button" data-monitored="yes" class="${state.monitored === "yes" ? "active" : ""}">Monitored</button>
                <button type="button" data-monitored="all" class="${state.monitored === "all" ? "active" : ""}">All actors</button>
            </div>
        </div>
        <div id="results"></div>`;
}

function paintThreat() {
    document.querySelectorAll("[data-monitored]").forEach((button) => {
        button.classList.toggle("active", button.getAttribute("data-monitored") === state.monitored);
    });
    const framework = threatModel.scoringFramework || [];
    document.getElementById("framework").innerHTML = framework.length ? `
        <div class="table-wrap" style="margin:14px 0">
            <table>
                <thead><tr><th>Category</th><th>Intent</th><th>Willingness</th><th>Capability</th><th>Novelty</th></tr></thead>
                <tbody>${framework.map((row) => `<tr>
                    <td>${esc(row.category)}</td>
                    <td>${esc(row.intent)} <span class="mono">(${esc(row.intentScore)})</span></td>
                    <td>${esc(row.willingness)} <span class="mono">(${esc(row.willingnessScore)})</span></td>
                    <td>${esc(row.capability)} <span class="mono">(${esc(row.capabilityScore)})</span></td>
                    <td>${esc(row.novelty)} <span class="mono">(${esc(row.noveltyScore)})</span></td>
                </tr>`).join("")}</tbody>
            </table>
        </div>` : "";
    let rows = threatModel.threatModelActors || [];
    if (state.monitored === "yes") rows = rows.filter((actor) => actor.inMonitoringList);
    rows = rows.filter((actor) => matches(state.search, [actor.name, actor.actorType, actor.malware, actor.aliases, actor.origins]));
    rows = sortRows(rows, {
        name: (row) => row.name,
        intent: (row) => Number(row.intentFinalScore) || 0,
        capability: (row) => Number(row.capabilityFinalScore) || 0,
        lastSeen: (row) => row.lastSeen || "",
    }, "name");
    if (!state.sortKey) rows.sort((a, b) => a.name.localeCompare(b.name));
    const page = pager(rows.length);
    const body = rows.slice(page.start, page.end).map((actor) => `
        <tr>
            <td>${procLink(actor.name, actor.name)}</td>
            <td title="${esc(actor.actorType)}">${esc(String(actor.actorType || "").split("—")[0].trim())}</td>
            <td class="num">${esc(actor.intentFinalScore)}</td>
            <td class="num">${esc(actor.capabilityFinalScore)}</td>
            <td>${Number(actor.pptap) ? '<span class="tag tag-pp">PP-TAP</span>' : '<span class="muted">—</span>'}</td>
            <td>${Number(actor.sirt) ? '<span class="tag tag-sirt">SIRT</span>' : '<span class="muted">—</span>'}</td>
            <td>${actor.inMonitoringList ? "Yes" : "No"}</td>
            <td class="mono">${esc(actor.lastSeen || "—")}</td>
            <td>${esc(actor.malware || "—")}</td>
        </tr>`).join("");
    document.getElementById("results").innerHTML = `
        <div class="table-wrap"><table>
            <thead><tr>
                ${header("Actor", "name")}
                <th>Type</th>
                ${header("Intent", "intent", "num")}
                ${header("Capability", "capability", "num")}
                <th>PP-TAP</th><th>SIRT</th><th>Monitored</th>
                ${header("Last seen", "lastSeen")}
                <th>Malware</th>
            </tr></thead>
            <tbody>${body || '<tr><td colspan="9" class="empty">No actors match.</td></tr>'}</tbody>
        </table></div>${page.html}`;
}

function mountRisk() {
    return `
        <div class="view-head">
            <h1>Risk calculation</h1>
            <p class="lede">Technique risk from the published model. Risk score = impact score × likelihood score. This view is all-time and does not apply a date window.</p>
        </div>
        ${toolbar("Search TID, technique, or tactic", tacticOptions(data.riskCalc || [], "Tactic"))}
        <div id="results"></div>`;
}

function paintRisk() {
    let rows = (data.riskCalc || []).filter((row) => {
        const tacticOk = state.tactic === "All" || String(row.Tactic || "").includes(state.tactic);
        return tacticOk && matches(state.search, [row.TID, row["Technique Name"], row.Tactic]);
    });
    rows = sortRows(rows, {
        TID: (row) => row.TID,
        name: (row) => row["Technique Name"],
        tactic: (row) => row.Tactic,
        cia: (row) => Number(row["CIA Score"]) || 0,
        impact: (row) => rateRank(row["Impact Rate"]),
        likelihood: (row) => rateRank(row["Likelihood Rate"]),
        risk: (row) => Number(row["Risk Scores"]) || 0,
    }, "risk");
    const page = pager(rows.length);
    const body = rows.slice(page.start, page.end).map((row) => `
        <tr>
            <td class="mono">${procLink(row.TID, row.TID)}</td>
            <td>${esc(row["Technique Name"])}</td>
            <td>${esc(row.Tactic)}</td>
            <td class="num">${num(row["CIA Score"])}</td>
            <td><span class="badge ${rateClass(row["Impact Rate"])}">${esc(row["Impact Rate"])}</span></td>
            <td><span class="badge ${rateClass(row["Likelihood Rate"])}">${esc(row["Likelihood Rate"])}</span></td>
            <td class="num">${num(row["Risk Scores"])}</td>
        </tr>`).join("");
    document.getElementById("results").innerHTML = `
        <div class="table-wrap"><table>
            <thead><tr>
                ${header("TID", "TID")}
                ${header("Technique", "name")}
                ${header("Tactic", "tactic")}
                ${header("CIA", "cia", "num")}
                ${header("Impact", "impact")}
                ${header("Likelihood", "likelihood")}
                ${header("Risk score", "risk", "num")}
            </tr></thead>
            <tbody>${body || '<tr><td colspan="7" class="empty">No techniques match.</td></tr>'}</tbody>
        </table></div>${page.html}`;
}

function mountImpact() {
    return `
        <div class="view-head">
            <h1>Impact table</h1>
            <p class="lede">Confidentiality, integrity, availability, and TTP extent for each technique in the impact model.</p>
        </div>
        ${toolbar("Search TID, name, or tactic", tacticOptions(data.impactTable || [], "tactics"))}
        <div id="results"></div>`;
}

function paintImpact() {
    let rows = (data.impactTable || []).filter((row) => {
        const tacticOk = state.tactic === "All" || String(row.tactics || "").includes(state.tactic);
        return tacticOk && matches(state.search, [row.id, row.name, row.tactics, row.platforms]);
    });
    rows = sortRows(rows, {
        id: (row) => row.id,
        name: (row) => row.name,
        tactics: (row) => row.tactics,
        extent: (row) => Number(row.finalTTPExtent) || 0,
    }, "extent");
    const page = pager(rows.length);
    const body = rows.slice(page.start, page.end).map((row) => `
        <tr>
            <td class="mono">${procLink(row.id, row.id)}</td>
            <td>${esc(row.name)}</td>
            <td>${esc(row.tactics)}</td>
            <td>${esc(row.confidentiality)}</td>
            <td>${esc(row.integrity)}</td>
            <td>${esc(row.availability)}</td>
            <td class="num">${num(row.finalTTPExtent)}</td>
        </tr>`).join("");
    document.getElementById("results").innerHTML = `
        <div class="table-wrap"><table>
            <thead><tr>
                ${header("TID", "id")}
                ${header("Technique", "name")}
                ${header("Tactics", "tactics")}
                <th>Confidentiality</th><th>Integrity</th><th>Availability</th>
                ${header("TTP extent", "extent", "num")}
            </tr></thead>
            <tbody>${body || '<tr><td colspan="7" class="empty">No techniques match.</td></tr>'}</tbody>
        </table></div>${page.html}`;
}

function mountLikelihood() {
    return `
        <div class="view-head">
            <h1>Likelihood</h1>
            <p class="lede">Likelihood = TID priority × last occurrence × confidence × high-value-asset likelihood factor, using the published risk-calculation rows.</p>
        </div>
        ${toolbar("Search TID, technique, or tactic", tacticOptions(data.riskCalc || [], "Tactic"))}
        <div id="results"></div>`;
}

function paintLikelihood() {
    let rows = (data.riskCalc || []).filter((row) => {
        const tacticOk = state.tactic === "All" || String(row.Tactic || "").includes(state.tactic);
        return tacticOk && matches(state.search, [row.TID, row["Technique Name"], row.Tactic]);
    });
    rows = sortRows(rows, {
        TID: (row) => row.TID,
        name: (row) => row["Technique Name"],
        priority: (row) => Number(row["TID  Priority"]) || 0,
        score: (row) => Number(row["Likelihood Score"]) || 0,
        rate: (row) => rateRank(row["Likelihood Rate"]),
    }, "rate");
    const page = pager(rows.length);
    const body = rows.slice(page.start, page.end).map((row) => `
        <tr>
            <td class="mono">${procLink(row.TID, row.TID)}</td>
            <td>${esc(row["Technique Name"])}</td>
            <td>${esc(row.Tactic)}</td>
            <td class="num">${num(row["TID  Priority"], 0)}</td>
            <td>${esc(row["Last Occurrence"])}</td>
            <td>${esc(row.Confidence)}</td>
            <td class="num">${num(row["Likelihood Score"])}</td>
            <td><span class="badge ${rateClass(row["Likelihood Rate"])}">${esc(row["Likelihood Rate"])}</span></td>
        </tr>`).join("");
    document.getElementById("results").innerHTML = `
        <div class="table-wrap"><table>
            <thead><tr>
                ${header("TID", "TID")}
                ${header("Technique", "name")}
                <th>Tactic</th>
                ${header("TID priority", "priority", "num")}
                <th>Last occurrence</th>
                <th>Confidence</th>
                ${header("Score", "score", "num")}
                ${header("Rate", "rate")}
            </tr></thead>
            <tbody>${body || '<tr><td colspan="8" class="empty">No techniques match.</td></tr>'}</tbody>
        </table></div>${page.html}`;
}

function mountHva() {
    return `
        <div class="view-head">
            <h1>High value assets</h1>
            <p class="lede">Asset targets mapped to techniques, with the risk and likelihood factors used by the impact and likelihood formulas.</p>
        </div>
        <div id="summary"></div>
        ${toolbar("Search target, TID, or impact")}
        <div id="results"></div>`;
}

function paintHva() {
    const scores = (data.hvscores || []).filter((row) => row.tid !== "Grand Total");
    const total = (data.hvscores || []).find((row) => row.tid === "Grand Total");
    document.getElementById("summary").innerHTML = `
        <div class="stats">${scores.map((row) => `<div class="stat"><b>${esc(row.tid)}</b><span>Risk ${num(row.avgRisk)} · likelihood ${num(row.avgLikelihood)}</span></div>`).join("")}
        ${total ? `<p class="footnote">Grand total risk ${num(total.avgRisk)}, likelihood ${num(total.avgLikelihood)}.</p>` : ""}</div>`;
    let rows = (data.highvalue || []).filter((row) => matches(state.search, [row.target, row.tid, row.tidName, row.impact, row.risk]));
    rows = sortRows(rows, {
        target: (row) => row.target,
        tid: (row) => row.tid,
        riskScore: (row) => Number(row.riskScore) || 0,
    }, "riskScore");
    const page = pager(rows.length);
    const body = rows.slice(page.start, page.end).map((row) => `
        <tr>
            <td>${esc(row.target)}</td>
            <td class="mono">${procLink(row.tid, row.tid)}</td>
            <td>${esc(row.tidName)}</td>
            <td><span class="badge ${rateClass(row.risk)}">${esc(row.risk || "—")}</span></td>
            <td class="num">${num(row.riskScore)}</td>
            <td class="num">${num(row.likelihoodScore)}</td>
            <td>${esc(row.impact || "—")}</td>
        </tr>`).join("");
    document.getElementById("results").innerHTML = `
        <div class="table-wrap"><table>
            <thead><tr>
                ${header("Target", "target")}
                ${header("TID", "tid")}
                <th>Technique</th><th>Risk</th>
                ${header("Risk factor", "riskScore", "num")}
                <th class="num">Likelihood factor</th>
                <th>Impact</th>
            </tr></thead>
            <tbody>${body || '<tr><td colspan="7" class="empty">No assets match.</td></tr>'}</tbody>
        </table></div>${page.html}`;
}

function mountTid() {
    return `
        <div class="view-head">
            <h1>TID priority</h1>
            <p class="lede">Techniques ranked by published risk score and procedure coverage.</p>
        </div>
        <div class="stats" id="stats"></div>
        <div class="two" id="bars"></div>
        ${toolbar("Search TID")}
        <div id="results"></div>`;
}

function barList(title, rows, value, max) {
    return `<div class="panel"><h2 style="font-size:15px;margin-bottom:8px">${esc(title)}</h2>
        ${rows.map((row) => `<div class="bar-row"><span class="mono">${procLink(row.tid, row.tid)}</span><div class="bar"><span style="width:${(value(row) / max) * 100}%"></span></div><span class="num">${num(value(row), 0)}</span></div>`).join("")}
    </div>`;
}

function paintTid() {
    const rows = data.tidPriority || [];
    const critical = rows.filter((row) => row.risk >= 1000).length;
    const high = rows.filter((row) => row.risk >= 600 && row.risk < 1000).length;
    const maxCount = Math.max(...rows.map((row) => row.count), 0);
    document.getElementById("stats").innerHTML = `
        <div class="stat"><b>${rows.length}</b><span>Techniques ranked</span></div>
        <div class="stat"><b>${critical}</b><span>Critical (≥ 1000)</span></div>
        <div class="stat"><b>${high}</b><span>High (600–1000)</span></div>
        <div class="stat"><b>${maxCount}</b><span>Max procedures</span></div>`;
    const maxRisk = Math.max(...rows.map((row) => row.risk), 1);
    document.getElementById("bars").innerHTML =
        barList("Top 15 by risk", [...rows].sort((a, b) => b.risk - a.risk).slice(0, 15), (row) => row.risk, maxRisk) +
        barList("Top 15 by procedure count", [...rows].sort((a, b) => b.count - a.count).slice(0, 15), (row) => row.count, Math.max(maxCount, 1));
    let filtered = rows.filter((row) => matches(state.search, [row.tid]));
    filtered = sortRows(filtered, {
        tid: (row) => row.tid,
        count: (row) => row.count,
        lastObs: (row) => row.lastObs,
        risk: (row) => row.risk,
    }, "risk");
    const page = pager(filtered.length);
    const body = filtered.slice(page.start, page.end).map((row) => {
        let band = "Low";
        if (row.risk >= 1000) band = "Critical";
        else if (row.risk >= 600) band = "High";
        else if (row.risk >= 300) band = "Medium";
        return `<tr>
            <td class="mono">${procLink(row.tid, row.tid)}</td>
            <td class="num">${row.count}</td>
            <td class="mono">${formatDate(row.lastObs)}</td>
            <td class="num">${num(row.risk, 0)}</td>
            <td><span class="badge level-${band.toLowerCase()}">${band}</span></td>
        </tr>`;
    }).join("");
    document.getElementById("results").innerHTML = `
        <div class="table-wrap"><table>
            <thead><tr>
                ${header("TID", "tid")}
                ${header("Procedures", "count", "num")}
                ${header("Last observed", "lastObs")}
                ${header("Risk", "risk", "num")}
                <th>Band</th>
            </tr></thead>
            <tbody>${body || '<tr><td colspan="5" class="empty">No TIDs match.</td></tr>'}</tbody>
        </table></div>${page.html}`;
}

function ciaTotal(tactic) {
    const conf = { Low: 1, Medium: 2, High: 3 }[tactic.conf] ?? 0;
    const integrity = { Low: 1, Medium: 2.25, High: 3.5 }[tactic.integrity] ?? 0;
    const avail = { Low: 1, Medium: 2.5, High: 4 }[tactic.avail] ?? 0;
    return conf + integrity + avail;
}

function mountTactics() {
    return `
        <div class="view-head">
            <h1>Tactic scores</h1>
            <p class="lede">Default confidentiality, integrity, availability, and extent for each MITRE tactic. CIA uses confidentiality 1/2/3, integrity 1/2.25/3.5, and availability 1/2.5/4.</p>
        </div>
        <div id="results"></div>`;
}

function paintTactics() {
    const rows = sortRows(data.tactics || [], {
        tactic: (row) => row.tactic,
        extent: (row) => Number(row.extent) || 0,
        cia: (row) => ciaTotal(row),
    }, "tactic");
    if (!state.sortKey) rows.sort((a, b) => a.tactic.localeCompare(b.tactic));
    document.getElementById("results").innerHTML = `
        <div class="table-wrap"><table>
            <thead><tr>
                ${header("Tactic", "tactic")}
                <th>Confidentiality</th><th>Integrity</th><th>Availability</th>
                ${header("Extent", "extent", "num")}
                ${header("CIA total", "cia", "num")}
            </tr></thead>
            <tbody>${rows.map((row) => `<tr>
                <td>${esc(row.tactic)}</td>
                <td><span class="badge ${rateClass(row.conf)}">${esc(row.conf)}</span></td>
                <td><span class="badge ${rateClass(row.integrity)}">${esc(row.integrity)}</span></td>
                <td><span class="badge ${rateClass(row.avail)}">${esc(row.avail)}</span></td>
                <td class="num">${num(row.extent, 2)}</td>
                <td class="num">${num(ciaTotal(row))}</td>
            </tr>`).join("")}</tbody>
        </table></div>`;
}

function mountRiskRate() {
    const matrix = [
        ["5 = Very high", [5, 10, 15, 20, 25]],
        ["4 = High", [4, 8, 12, 16, 20]],
        ["3 = Medium", [3, 6, 9, 12, 15]],
        ["2 = Low", [2, 4, 6, 8, 10]],
        ["1 = Very low", [1, 2, 3, 4, 5]],
    ];
    const heat = (score) => {
        if (score >= 20) return "heat-5";
        if (score >= 12) return "heat-4";
        if (score >= 6) return "heat-3";
        if (score >= 3) return "heat-2";
        return "heat-1";
    };
    return `
        <div class="view-head">
            <h1>Risk rate and scoring</h1>
            <p class="lede">Weights used by the published risk model.</p>
        </div>
        <div class="method">
            <section>
                <h2>Formulas</h2>
                <ul>
                    <li>Actor priority = intent × capability × average distinct TID risk</li>
                    <li>Technique risk = impact score × likelihood score</li>
                    <li>Impact = (confidentiality + integrity + availability) × TTP extent × high-value-asset risk</li>
                    <li>Likelihood = TID priority × last occurrence × confidence × high-value-asset likelihood</li>
                </ul>
            </section>
            <section>
                <h2>Likelihood × impact matrix</h2>
                <table class="matrix">
                    <thead><tr><th>Likelihood</th><th>Very low</th><th>Low</th><th>Medium</th><th>High</th><th>Very high</th></tr></thead>
                    <tbody>${matrix.map(([label, scores]) => `<tr><th>${label}</th>${scores.map((score) => `<td class="${heat(score)}">${score}</td>`).join("")}</tr>`).join("")}</tbody>
                </table>
            </section>
            <section>
                <h2>CIA and extent weights</h2>
                <div class="table-wrap"><table>
                    <thead><tr><th>Rate</th><th>Confidentiality</th><th>Integrity</th><th>Availability</th></tr></thead>
                    <tbody>
                        <tr><td>Low</td><td>1</td><td>1</td><td>1</td></tr>
                        <tr><td>Medium</td><td>2</td><td>2.25</td><td>2.5</td></tr>
                        <tr><td>High</td><td>3</td><td>3.5</td><td>4</td></tr>
                    </tbody>
                </table></div>
            </section>
            <section>
                <h2>Last occurrence and confidence</h2>
                <ul>
                    <li>&lt; 3 months = 1.7</li>
                    <li>Between 3 months and 1 year = 1.3</li>
                    <li>Between 1 and 2 years = 1.1</li>
                    <li>&gt; 2 years = 0.8</li>
                    <li>High confidence = 1.25, medium = 1.0, low = 0.75</li>
                </ul>
            </section>
        </div>`;
}

function externalRef(value) {
    const text = String(value || "");
    const url = text.match(/https?:\/\/\S+/)?.[0];
    if (!url) return esc(text || "—");
    const label = text.replace(url, "").replace(/\s+-\s*$/, "").trim();
    return `<a class="tid" href="${esc(url)}" target="_blank" rel="noopener">${esc(label || url)}</a>`;
}

function mountProcedures() {
    return `
        <div class="view-head">
            <h1>All procedures</h1>
            <p class="lede">${(data.allProcedures || []).length.toLocaleString()} procedures from the intel snapshot. Search by actor, technique, or procedure text.</p>
        </div>
        ${toolbar("Search actor, TID, or procedure")}
        <div id="results"></div>`;
}

function paintProcedures() {
    let rows = (data.allProcedures || []).filter((row) => matches(state.search, [row.actor, row.mitreId, row.procedure, row.externalRef]));
    rows = sortRows(rows, {
        actor: (row) => row.actor,
        mitreId: (row) => row.mitreId,
        date: (row) => Number(row.date) || 0,
        risk: (row) => Number(row.risk) || 0,
    }, "risk");
    const page = pager(rows.length);
    const body = rows.slice(page.start, page.end).map((row) => `
        <tr>
            <td>${esc(row.actor)}</td>
            <td class="mono">${procLink(row.mitreId, row.mitreId)}</td>
            <td class="mono">${formatDate(row.date)}</td>
            <td class="num">${num(row.risk)}</td>
            <td>${esc(row.procedure)}</td>
            <td>${externalRef(row.externalRef)}</td>
        </tr>`).join("");
    document.getElementById("results").innerHTML = `
        <div class="table-wrap"><table>
            <thead><tr>
                ${header("Actor", "actor")}
                ${header("TID", "mitreId")}
                ${header("Date", "date")}
                ${header("Risk", "risk", "num")}
                <th>Procedure</th>
                <th>Report</th>
            </tr></thead>
            <tbody>${body || '<tr><td colspan="6" class="empty">No procedures match.</td></tr>'}</tbody>
        </table></div>${page.html}`;
}

const mounts = {
    actors: mountActors,
    "threat-model": mountThreat,
    risk: mountRisk,
    impact: mountImpact,
    likelihood: mountLikelihood,
    hva: mountHva,
    tid: mountTid,
    tactics: mountTactics,
    "risk-rate": mountRiskRate,
    procedures: mountProcedures,
};

const paints = {
    actors: paintActors,
    "threat-model": paintThreat,
    risk: paintRisk,
    impact: paintImpact,
    likelihood: paintLikelihood,
    hva: paintHva,
    tid: paintTid,
    tactics: paintTactics,
    "risk-rate": () => {},
    procedures: paintProcedures,
};

function bind() {
    const search = document.getElementById("search");
    if (search) {
        search.addEventListener("input", (event) => {
            state.search = event.target.value;
            state.page = 0;
            paintCurrent();
            const again = document.getElementById("search");
            if (again) {
                again.focus();
                const pos = again.value.length;
                again.setSelectionRange(pos, pos);
            }
        });
    }
    const tactic = document.getElementById("tactic");
    if (tactic) {
        tactic.addEventListener("change", () => {
            state.tactic = tactic.value;
            state.page = 0;
            paintCurrent();
        });
    }
    viewEl.addEventListener("click", onViewClick);
}

function onViewClick(event) {
    const sort = event.target.closest("[data-sort]");
    const pageBtn = event.target.closest("[data-page]");
    const level = event.target.closest("[data-level]");
    const monitored = event.target.closest("[data-monitored]");
    if (sort) {
        const key = sort.getAttribute("data-sort");
        state.sortDir = state.sortKey === key && state.sortDir === "desc" ? "asc" : "desc";
        state.sortKey = key;
        state.page = 0;
        paintCurrent();
    } else if (pageBtn) {
        state.page += pageBtn.getAttribute("data-page") === "next" ? 1 : -1;
        paintCurrent();
    } else if (level) {
        state.level = level.getAttribute("data-level");
        state.page = 0;
        paintCurrent();
    } else if (monitored) {
        state.monitored = monitored.getAttribute("data-monitored");
        state.page = 0;
        paintCurrent();
    }
}

let currentId = "";

function paintCurrent() {
    if (paints[currentId]) paints[currentId]();
}

function render() {
    const { id, params } = parseHash();
    renderSubnav(id);
    const query = params.get("q") || "";
    if (id !== currentId) {
        if (actorChart) {
            actorChart.destroy();
            actorChart = null;
        }
        viewEl.removeEventListener("click", onViewClick);
        currentId = id;
        state.search = query;
        state.level = "All";
        state.tactic = "All";
        state.monitored = "yes";
        state.sortKey = null;
        state.sortDir = "desc";
        state.page = 0;
        viewEl.innerHTML = mounts[id]();
        bind();
    } else if (query && query !== state.search) {
        state.search = query;
        state.page = 0;
        const search = document.getElementById("search");
        if (search) search.value = state.search;
    }
    paintCurrent();
}

async function init() {
    try {
        const [intel, model] = await Promise.all([
            fetch("../data/intel.json").then((response) => {
                if (!response.ok) throw new Error(`intel.json ${response.status}`);
                return response.json();
            }),
            fetch("../data/intel-threat-model.json").then((response) => {
                if (!response.ok) throw new Error(`intel-threat-model.json ${response.status}`);
                return response.json();
            }),
        ]);
        data = intel;
        threatModel = model;
        buildRanking();
        render();
        window.addEventListener("hashchange", render);
    } catch (error) {
        viewEl.innerHTML = `<p class="status">Could not load the intel snapshot. ${esc(error.message)}</p>`;
    }
}

init();
