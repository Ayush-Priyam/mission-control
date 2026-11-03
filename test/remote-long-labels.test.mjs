// Review finding (run 458): option labels longer than the stored 300 characters must reach Claude Code
// as the original label, and labels that become equal once cut must not be answerable remotely.
import { test } from "node:test"
import assert from "node:assert/strict"
import { sanitizeQuestions, isAnswerableAsk } from "../src/remote/prompts.mjs"
import { outputFor } from "../src/remote/hook-wait.mjs"

const long = (c) => c.repeat(320)

test("a long option label is answered with its full original text", () => {
  const toolInput = { questions: [{ question: "Which plan?", header: "Plan", multiSelect: false, options: [{ label: long("a"), description: "" }, { label: "short", description: "" }] }] }
  const pending = { kind: "ask", questions: sanitizeQuestions(toolInput.questions) }
  assert.equal(pending.questions[0].options[0].label.length, 300)
  const out = JSON.parse(outputFor({ harness: "claude-code", pending, decision: { answers: { "Which plan?": "a".repeat(300) } }, toolInput }))
  assert.equal(out.hookSpecificOutput.updatedInput.answers["Which plan?"], long("a"))
})

test("short labels are unchanged", () => {
  const toolInput = { questions: [{ question: "Q?", header: "", multiSelect: false, options: [{ label: "yes" }, { label: "no" }] }] }
  const pending = { kind: "ask", questions: sanitizeQuestions(toolInput.questions) }
  const out = JSON.parse(outputFor({ harness: "claude-code", pending, decision: { answers: { "Q?": "no" } }, toolInput }))
  assert.equal(out.hookSpecificOutput.updatedInput.answers["Q?"], "no")
})

test("labels equal after cutting make the ask unanswerable remotely (terminal takes it)", () => {
  const qs = sanitizeQuestions([{ question: "Q?", multiSelect: false, options: [{ label: long("b") + "1" }, { label: long("b") + "2" }] }])
  assert.equal(isAnswerableAsk(qs), false)
})
