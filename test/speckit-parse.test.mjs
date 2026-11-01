import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  STAGES, parseFrontmatter, parseTasks, extractGoal, extractSection,
  parseIntentguard, parsePlanverify, matchSpecDir, computeStates, deriveLane,
} from "../src/adapters/speckit/parse.mjs";

const fx = (p) => readFileSync(new URL(`./fixtures/speckit/${p}`, import.meta.url), "utf8");

test("STAGES order", () => {
  assert.deepEqual(STAGES, ["intent", "expectations", "specify", "plan", "tasks",
    "gapfill", "planverify", "implement", "intentguard", "writeback"]);
});

test("parseFrontmatter reads flat scalars and strips quotes", () => {
  assert.deepEqual(parseFrontmatter(fx("docs/intents/tip-split.md")), { slug: "tip-split", status: "approved" });
  assert.deepEqual(parseFrontmatter("---\nurl: http://x:80\n: nokey\nnocolon\n---\nafter: no"), { url: "http://x:80" });
  assert.deepEqual(parseFrontmatter("# no fence\nslug: a"), {});
  assert.deepEqual(parseFrontmatter("--- \nslug: a\n---"), { slug: "a" });
  assert.deepEqual(parseFrontmatter("---x\nslug: a"), {});
  assert.deepEqual(parseFrontmatter(""), {});
});

test("parseTasks counts checkboxes", () => {
  assert.deepEqual(parseTasks("- [x] a\n- [ ] b\n* [X] c"), { done: 2, total: 3 });
  assert.deepEqual(parseTasks("no boxes\n- [y] bad\n-[x] nospace\n  - [x] nested"), { done: 1, total: 1 });
  assert.deepEqual(parseTasks(""), { done: 0, total: 0 });
  assert.deepEqual(parseTasks(fx("specs/001-tip-split/tasks.md")), { done: 3, total: 5 });
});

test("extractGoal", () => {
  assert.equal(extractGoal(fx("docs/intents/tip-split.md")), "Split a restaurant bill and tip fairly between diners");
  assert.equal(extractGoal("# Intent:   padded   \n"), "padded");
  assert.equal(extractGoal("## Intent: not h1"), "");
  assert.equal(extractGoal(""), "");
});

test("extractSection returns bullets and stops at next ##", () => {
  const t = fx("docs/intents/tip-split.md");
  assert.deepEqual(extractSection(t, "Constraints"),
    ["Amounts are integer cents, never floats", "Rounding remainder goes to the first diner"]);
  assert.deepEqual(extractSection(t, "Failure conditions"),
    ["Shares do not add up to the total", "A diner is charged a negative amount"]);
  assert.deepEqual(extractSection(t, "Out of scope"), ["Currency conversion"]);
  assert.deepEqual(extractSection(t, "Missing"), []);
  assert.deepEqual(extractSection("## A\n- one\n## B\n- two\n", "A"), ["one"]);
  assert.deepEqual(extractSection(fx("docs/intents/tip-split.expectations.md"), "Edge / negative scenarios"),
    ["Zero diners is rejected with an error", "A 1 cent bill across 3 diners gives 1, 0, 0"]);
});

test("parseIntentguard collects drift from L3a/L3b/L3d only", () => {
  const r = parseIntentguard(fx("docs/intents/tip-split.intentguard.md"));
  assert.equal(r.verdict, "BLOCKED");
  assert.deepEqual(r.drift, [
    { level: "L3a", kind: "out-of-scope", text: "REVIEW converter stub added in money.kt", severity: "review" },
    { level: "L3b", kind: "constraint", text: "BLOCKED float used for share maths in split.kt", severity: "blocked" },
  ]);
  assert.deepEqual(parseIntentguard("no frontmatter"), { verdict: null, drift: [] });
});

test("parsePlanverify collects drift from P3a/P3b/P3d", () => {
  const r = parsePlanverify(fx("docs/intents/tip-split.planverify.md"));
  assert.equal(r.verdict, "REPLAN_ALLOWED");
  assert.deepEqual(r.drift, [
    { level: "P3b", kind: "drift-request", text: "REPLAN_ALLOWED plan adds a rounding helper not in the spec", severity: "review" },
    { level: "P3d", kind: "constraint", text: "BLOCKED_DRIFT plan stores amounts as doubles", severity: "blocked" },
  ]);
  assert.deepEqual(parsePlanverify(""), { verdict: null, drift: [] });
});

test("matchSpecDir: exact, numeric prefix, token prefix both ways, no substring", () => {
  assert.equal(matchSpecDir("tip-split", ["001-tip-split", "002-other"]), "001-tip-split");
  assert.equal(matchSpecDir("tip-split-backend", ["12-tip-split", "13-other"]), "12-tip-split");
  assert.equal(matchSpecDir("tip", ["001-tip-split"]), "001-tip-split");
  assert.equal(matchSpecDir("auth", ["001-oauth"]), null);
  assert.equal(matchSpecDir("tip-split", []), null);
  assert.equal(matchSpecDir("Tip-Split", ["001-TIP-split"]), "001-TIP-split");
  assert.equal(matchSpecDir("tip-split", ["tip-split-v2", "001-tip-split"]), "001-tip-split");
});

const mk = (...done) => Object.fromEntries(STAGES.map((s) => [s, { state: done.includes(s) ? "done" : "pending" }]));

test("computeStates marks only the first non-done stage current", () => {
  const s = computeStates(mk("intent", "expectations", "plan"));
  assert.equal(s.specify.state, "current");
  assert.equal(s.tasks.state, "pending");
  assert.equal(s.plan.state, "done");
  assert.ok(STAGES.every((n) => computeStates(mk(...STAGES))[n].state === "done"));
});

test("deriveLane priorities", () => {
  assert.equal(deriveLane(mk()), "backlog");
  assert.equal(deriveLane(computeStates(mk("intent"))), "backlog");
  assert.equal(deriveLane(computeStates(mk("intent", "expectations"))), "wip");
  assert.equal(deriveLane(computeStates(mk("intent", "expectations", "specify"))), "wip");
  assert.equal(deriveLane(mk("implement")), "review");
  const gated = mk(); gated.planverify.verdict = "PASS";
  assert.equal(deriveLane(gated), "review");
  assert.equal(deriveLane(mk("implement", "writeback")), "done");
  const blocked = mk("implement", "writeback"); blocked.intentguard.state = "blocked";
  assert.equal(deriveLane(blocked), "attention");
  const bd = mk(); bd.planverify.verdict = "BLOCKED_DRIFT";
  assert.equal(deriveLane(bd), "attention");
  assert.equal(deriveLane({}), "backlog");
});
