import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import {
  normalizeSessions,
  extractMessages,
  classifyTask,
  classifyOutcome,
  detectFriction,
  parseJsonLoose,
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
})

test("extractMessages and heuristics work on fixture export", () => {
  const messages = extractMessages(sessionExportFixture)
  assert.ok(messages.length >= 5)
  assert.equal(classifyTask(messages), "debug")
  assert.equal(classifyOutcome(messages), "achieved")

  const frictions = detectFriction(messages)
  assert.ok(frictions.some((entry) => entry.type === "过度修改"))
})

test("parseJsonLoose can ignore prefixed logs", () => {
  const parsed = parseJsonLoose('INFO booting\n[{"ok":true}]')
  assert.deepEqual(parsed, [{ ok: true }])
})
