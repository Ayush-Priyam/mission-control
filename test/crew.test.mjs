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
