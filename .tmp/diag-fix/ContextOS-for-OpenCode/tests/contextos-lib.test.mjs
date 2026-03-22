import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  normalizeSessions,
  extractMessages,
  classifyTask,
  classifyTaskDetailed,
  classifyOutcome,
  detectFrictionDetailed,
  extractRepeatedInstructions,
  parseJsonLoose,
  resolveSessionTimeline,
  resolveSessionAgent,
} from "../scripts/contextos-lib.mjs"

const sessionListFixture = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "session-list.json"), "utf8"),
)
const sessionExportFixture = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "session-export.json"), "utf8"),
)

test("normalizeSessions reads common session fields", () => {
  const sessions = normalizeSessions(sessionListFixture)
  assert.equal(sessions.length, 2)
  assert.equal(sessions[0].id, "sess_1")
  assert.equal(sessions[0].agent, "build")
  assert.equal(sessions[0].createdAtSource, "session.createdAt")
  assert.equal(sessions[0].updatedAtSource, "session.updatedAt")
})

test("extractMessages and heuristics work on fixture export", () => {
  const messages = extractMessages(sessionExportFixture)
  assert.ok(messages.length >= 5)
  assert.equal(classifyTask(messages), "config")
  assert.equal(classifyOutcome(messages), "achieved")

  const detailed = classifyTaskDetailed(messages, { session: { title: "Fix MCP config", project: "/repo/a" } })
  assert.equal(detailed.task, "config")
  assert.ok(detailed.confidence > 0.3)
  assert.ok(detailed.topSignals.length >= 1)

  const friction = detectFrictionDetailed(messages)
  assert.ok(friction.frictions.some((entry) => entry.type === "过度修改"))
})

test("parseJsonLoose can ignore prefixed logs", () => {
  const parsed = parseJsonLoose('INFO booting\n[{"ok":true}]')
  assert.deepEqual(parsed, [{ ok: true }])
})

test("resolveSessionTimeline can fall back to message timestamps", () => {
  const messages = [
    { timestamp: "2026-03-18T09:00:00.000Z", text: "a" },
    { timestamp: "2026-03-18T10:00:00.000Z", text: "b" },
  ]
  const timeline = resolveSessionTimeline({ createdAt: null, updatedAt: null }, messages)
  assert.equal(timeline.createdAtSource, "messages:firstTimestamp")
  assert.equal(timeline.updatedAtSource, "messages:lastTimestamp")
})

test("resolveSessionAgent can recover agent from export payload", () => {
  const info = resolveSessionAgent(
    { agent: "unknown-agent", agentSource: null },
    { session: { metadata: { agent: "oracle" } } },
  )
  assert.equal(info.agent, "oracle")
  assert.match(info.agentSource, /export\.session\.metadata\.agent/)
})

test("extractRepeatedInstructions clusters similar cross-session instructions", () => {
  const analyzedSessions = [
    {
      id: "a",
      project: "/repo/a",
      messages: [{ role: "user", text: "默认使用简体中文回复，不要切英文。" }],
    },
    {
      id: "b",
      project: "/repo/b",
      messages: [{ role: "user", text: "请默认用简体中文回复，别突然切到英文。" }],
    },
    {
      id: "c",
      project: "/repo/c",
      messages: [{ role: "user", text: "以后都用简体中文回复，不要切英文。" }],
    },
  ]

  const repeated = extractRepeatedInstructions(analyzedSessions, 2)
  assert.ok(repeated.length >= 1)
  assert.equal(repeated[0].type, "global-preference")
  assert.ok(repeated[0].count >= 2)
})

test("tool noise is diagnosed but not counted as a true friction event", () => {
  const detail = detectFrictionDetailed([
    {
      role: "tool",
      name: "session_read",
      text: "step-start tool-calls msg_123 prt_456",
      raw: { status: "streaming" },
    },
  ])
  assert.equal(detail.frictions.length, 0)
  assert.ok(detail.diagnostics.some((item) => item.subtype === "noisy_event_only"))
})
