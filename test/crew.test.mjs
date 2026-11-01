import { test } from "node:test"
import assert from "node:assert/strict"
import { crewStats } from "../src/crew.mjs"

test("counts sessions, rounds, stops and bounces across runs", () => {
  const runs = [
    {
      id: "A",
      state: { stages: { backend: { status: "done" }, qa: { status: "blocked" } } },
      events: [
        { type: "stage.start", stage: "backend" },
        { type: "stage.start", stage: "backend" },
        { type: "session", stage: "backend", model: "m", cost: 0.5, tokens: { input_tokens: 10, cache_creation_input_tokens: 20, output_tokens: 5 } },
        { type: "issue", stage: "qa", decision: { owner: "backend", blocks: true } },
        { type: "stop", stage: "qa" },
      ],
    },
    { id: "B", state: {}, events: [{ type: "stage.start", stage: "backend" }] },
  ]
  const { crew, bounces, grid } = crewStats(runs)
  assert.equal(crew.backend.rounds, 3)
  assert.equal(crew.backend.tokens, 35)
  assert.equal(crew.backend.cost, 0.5)
  assert.deepEqual(crew.backend.models, ["m"])
  assert.equal(crew.qa.stops, 1)
  assert.equal(bounces["qa>backend"], 1)
  assert.equal(grid.A.qa.sent, 1)
})

test("M1: a stage named __proto__ is counted like any other, without touching prototypes", () => {
  const runs = [{
    id: "__proto__",
    state: null,
    events: [
      { type: "stage.start", stage: "__proto__" },
      { type: "session", stage: "__proto__", cost: 1, tokens: { output_tokens: 3 } },
      { type: "issue", stage: "__proto__", decision: { owner: "constructor", blocks: true } },
    ],
  }]
  // state.stages from JSON.parse keeps "__proto__" as an own key.
  runs[0].state = JSON.parse('{"stages":{"__proto__":{"status":"done"}}}')
  const { crew, bounces, grid } = crewStats(runs)
  assert.ok(Object.hasOwn(crew, "__proto__"))
  assert.equal(crew["__proto__"].rounds, 1)
  assert.equal(crew["__proto__"].sessions, 1)
  assert.ok(Object.hasOwn(grid, "__proto__"))
  assert.equal(grid["__proto__"]["__proto__"].rounds, 1)
  assert.equal(grid["__proto__"]["__proto__"].status, "done")
  assert.equal(bounces["__proto__>constructor"], 1)
  assert.equal(({}).rounds, undefined)
  const round = JSON.parse(JSON.stringify({ crew, grid }))
  assert.equal(round.crew["__proto__"].rounds, 1)
})
