// Pure spec-kit parsers (string in, data out). Ported from the behaviour of
// spec-kit-compound's dashboard.py. No node: imports; filesystem probing
// (is spec.md present? does the guard file exist?) belongs to the adapter.

export const STAGES = [
  "intent", "expectations", "specify", "plan",
  "tasks", "gapfill", "planverify", "implement", "intentguard", "writeback",
];

const TASK_RE = /^\s*[-*]\s+\[( |x|X)\]\s/;
const GOAL_RE = /^#\s*Intent:\s*(.+?)\s*$/m;
const BULLET_RE = /^\s*[-*]\s+(.*\S)\s*$/;

const lines = (text) => String(text ?? "").split(/\r\n|\r|\n/);

export function parseFrontmatter(text) {
  text = String(text ?? "");
  if (!text.startsWith("---")) return {};
  const ls = lines(text);
  if (ls[0].trim() !== "---") return {};
  const out = {};
  for (const line of ls.slice(1)) {
    if (line.trim() === "---") break;
    const i = line.indexOf(":");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const val = line.slice(i + 1).trim().replace(/^"+|"+$/g, "").replace(/^'+|'+$/g, "");
    if (key) out[key] = val;
  }
  return out;
}

export function parseTasks(text) {
  let done = 0, total = 0;
  for (const line of lines(text)) {
    const m = TASK_RE.exec(line);
    if (m) {
      total++;
      if (m[1] === "x" || m[1] === "X") done++;
    }
  }
  return { done, total };
}

export function extractGoal(text) {
  const m = GOAL_RE.exec(String(text ?? ""));
  return m ? m[1].trim() : "";
}

export function extractSection(text, header) {
  const out = [];
  let inSection = false;
  for (const line of lines(text)) {
    if (line.startsWith("## ")) {
      if (inSection) break;
      inSection = line.slice(3).trim() === header;
      continue;
    }
    if (inSection) {
      const m = BULLET_RE.exec(line);
      if (m) out.push(m[1].trim());
    }
  }
  return out;
}

function parseGate(text, kinds, severityOf) {
  const verdict = parseFrontmatter(text).verdict ?? null;
  const drift = [];
  let current = null;
  for (const line of lines(text)) {
    if (line.startsWith("## ")) {
      const head = line.slice(3).trim();
      current = Object.keys(kinds).find((level) => head.startsWith(level)) ?? null;
      continue;
    }
    if (!current) continue;
    const m = BULLET_RE.exec(line);
    if (!m) continue;
    const body = m[1].trim();
    const severity = severityOf(body.toUpperCase());
    if (!severity) continue; // PASS / clean line is not drift
    drift.push({ level: current, kind: kinds[current], text: body, severity });
  }
  return { verdict, drift };
}

const L3_KINDS = { L3a: "out-of-scope", L3b: "constraint", L3d: "expectation" };
const PV_KINDS = { P3a: "surface", P3b: "drift-request", P3d: "constraint" };

export function parseIntentguard(text) {
  return parseGate(text, L3_KINDS, (u) =>
    u.includes("BLOCKED") ? "blocked" : u.includes("REVIEW") ? "review" : null);
}

export function parsePlanverify(text) {
  return parseGate(text, PV_KINDS, (u) =>
    u.includes("BLOCKED") ? "blocked"
      : u.includes("REPLAN") || u.includes("REVIEW") ? "review" : null);
}

// Lowercase, drop any directory part, strip a leading NNN- numeric prefix.
function normalize(name) {
  const base = String(name).split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
  return base.replace(/^\d+-/, "");
}

function isTokenPrefix(short, long) {
  const a = short.split("-"), b = long.split("-");
  return a.length <= b.length && a.every((t, i) => t === b[i]);
}

/** Resolve the spec dir (one of specDirs, as given) for an intent slug, or null. */
export function matchSpecDir(slug, specDirs) {
  const nslug = normalize(slug);
  const dirs = [...specDirs];
  const exact = dirs.find((d) => normalize(d) === nslug);
  if (exact !== undefined) return exact;
  for (const d of dirs) {
    const key = normalize(d);
    if (isTokenPrefix(key, nslug) || isTokenPrefix(nslug, key)) return d;
  }
  return null;
}

/** Mark the first non-done stage "current" (mutates and returns stages). */
export function computeStates(stages) {
  let seenPending = false;
  for (const name of STAGES) {
    const st = stages[name];
    if (st.state === "done") continue;
    if (!seenPending) {
      st.state = "current";
      seenPending = true;
    }
  }
  return stages;
}

/** Swimlane for a feature, a pure function of stage state. First match wins. */
export function deriveLane(stages) {
  const ig = stages.intentguard ?? {};
  const pv = stages.planverify ?? {};
  if (ig.verdict === "BLOCKED" || ig.state === "blocked"
    || pv.verdict === "BLOCKED_DRIFT" || pv.state === "blocked") return "attention";
  if (stages.writeback?.state === "done") return "done";
  if (stages.implement?.state === "done") return "review";
  if (pv.verdict || ig.verdict) return "review";
  for (const name of ["specify", "plan", "tasks", "implement"]) {
    if (["done", "current"].includes(stages[name]?.state)) return "wip";
  }
  return "backlog";
}
