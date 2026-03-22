import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  normalizeSessions,
  extractMessages,
  extractRepeatedInstructions,
  classifyTask,
  classifyOutcome,
  detectFriction,
  parseJsonLoose,
  formatDateRange,
} from "../scripts/contextos-lib.mjs"

const sessionListFixture = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "session-list.json"), "utf8"),
)
const sessionExportFixture = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "session-export.json"), "utf8"),
)
const sessionExportCurrentFixture = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "session-export-current.json"), "utf8"),
)

test("normalizeSessions reads common session fields", () => {
  const sessions = normalizeSessions(sessionListFixture)
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].id, "sess_1")
  assert.equal(sessions[0].agent, "build")
})

test("extractMessages and heuristics work on fixture export", () => {
  const messages = extractMessages(sessionExportFixture)
  assert.ok(messages.length >= 5)
  assert.equal(classifyTask(messages), "debug")
  assert.equal(classifyOutcome(messages), "achieved")

  const frictions = detectFriction(messages)
  assert.ok(frictions.some((entry) => entry.type === "过度修改"))
})

test("classifyTask includes diagnostics when enabled", () => {
  const messages = extractMessages(sessionExportFixture)
  const result = classifyTask(messages, { includeDiagnostics: true })

  assert.equal(typeof result, "object")
  assert.equal(result.label, "debug")
  assert.equal(result.source, "content-regex")
  assert.equal(result.matchedRule, "debug")
  assert.equal(typeof result.confidence, "number")
  assert.ok(result.evidence)
  assert.ok(result.evidence.matchedPattern)
})

test("classifyOutcome includes diagnostics when enabled", () => {
  const messages = extractMessages(sessionExportFixture)
  const result = classifyOutcome(messages, { includeDiagnostics: true })

  assert.equal(typeof result, "object")
  assert.equal(result.source, "content-regex")
  assert.equal(typeof result.confidence, "number")
  assert.ok(result.evidence)
  assert.ok(result.evidence.matchedPattern)
})

test("detectFriction includes provenance in diagnostics mode", () => {
  const messages = extractMessages(sessionExportFixture)
  const frictions = detectFriction(messages, { includeDiagnostics: true })

  assert.ok(Array.isArray(frictions))
  assert.ok(frictions.length >= 1)
  assert.ok(frictions.every((entry) => entry.source))
  assert.ok(frictions.every((entry) => typeof entry.isNoisy === "boolean"))
})

test("normalizeSessions accepts modern info.time/info.directory shape", () => {
  const modernSessionList = [
    {
      info: {
        id: "sess_modern",
        time: {
          created: 1770953507526,
          updated: 1770953952116,
        },
        directory: "G:\\opencode\\modern",
        agent: "sisyphus",
      },
      title: "Modern export list shape",
    },
  ]

  const [session] = normalizeSessions(modernSessionList)
  assert.equal(session.id, "sess_modern")
  assert.equal(session.project, "G:\\opencode\\modern")
  assert.equal(session.agent, "sisyphus")
  assert.equal(session.createdAt, new Date(1770953507526).toISOString())
  assert.equal(session.updatedAt, new Date(1770953952116).toISOString())
})

test("extractMessages preserves message agent from current export format", () => {
  const messages = extractMessages(sessionExportCurrentFixture)
  assert.ok(messages.length >= 3)
  assert.ok(messages.some((message) => message.agent === "sisyphus"))

  const assistantMessage = messages.find((message) => message.role === "assistant")
  assert.equal(assistantMessage?.agent, "sisyphus")
  assert.ok(typeof assistantMessage?.text === "string")
})

test("parseJsonLoose can ignore prefixed logs", () => {
  const parsed = parseJsonLoose('INFO booting\n[{"ok":true}]')
  assert.deepEqual(parsed, [{ ok: true }])
})

test("formatDateRange ignores invalid timestamps", () => {
  assert.equal(
    formatDateRange([
      { updatedAt: "not-a-time" },
      { createdAt: "2025-01-15T00:00:00.000Z" },
      { updatedAt: null },
      { createdAt: "bad" },
      { updatedAt: "2025-01-20T00:00:00.000Z" },
    ]),
    "2025-01-15 ~ 2025-01-20",
  )
})

test("formatDateRange handles empty or all-invalid inputs", () => {
  assert.equal(formatDateRange([]), "unknown")
  assert.equal(formatDateRange([{ createdAt: null }, { updatedAt: "" }, { createdAt: "bad" }]), "unknown")
})

test("formatDateRange includes diagnostics when enabled", () => {
  const result = formatDateRange(
    [
      { updatedAt: "not-a-time" },
      { createdAt: "2025-01-15T00:00:00.000Z" },
      { updatedAt: "2025-01-20T00:00:00.000Z" },
    ],
    { includeDiagnostics: true },
  )

  assert.equal(typeof result, "object")
  assert.equal(result.value, "2025-01-15 ~ 2025-01-20")
  assert.equal(typeof result.diagnostics.totalInputs, "number")
  assert.equal(typeof result.diagnostics.sourceBreakdown, "object")
})

test("extractRepeatedInstructions reports evidence metadata", () => {
  const analyzedSessions = [
    {
      id: "sess_a",
        messages: [
          { role: "user", text: "请继续这项工作，并把实现方案推进到下一阶段" },
          { role: "user", text: "请继续这项工作，并把实现方案推进到下一阶段" },
          { role: "assistant", text: "明白" },
        ],
      },
      {
        id: "sess_b",
        messages: [
          { role: "user", text: "请继续这项工作，并把实现方案推进到下一阶段" },
          { role: "user", text: "请继续这项工作，并把实现方案推进到下一阶段" },
        ],
      },
  ]

  const repeated = extractRepeatedInstructions(analyzedSessions, 2)
  assert.ok(repeated.length > 0)
  assert.ok(repeated.every((item) => typeof item.evidenceCount === "number"))
  assert.ok(repeated.every((item) => Array.isArray(item.sessionIDs)))
  assert.ok(repeated.every((item) => Array.isArray(item.evidence)))
})
