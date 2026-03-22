import test from "node:test"
import assert from "node:assert/strict"

import {
  classifyExportFailure,
  exportSessionWithRetry,
  collectAnalyzedSessions,
} from "../scripts/generate-insights.mjs"

test("exportSessionWithRetry succeeds after one retry", () => {
  let calls = 0
  const exporter = () => {
    calls += 1
    if (calls === 1) {
      throw new Error("spawnSync ETIMEDOUT")
    }
    return { ok: true }
  }

  const result = exportSessionWithRetry({ id: "ses_retry_ok", project: "proj" }, exporter, {
    exportRetries: 2,
    exportRetryDelayMs: 1,
    exportBackoffMultiplier: 2,
    waitFn: () => {},
  })

  assert.equal(result.ok, true)
  assert.equal(result.attemptCount, 2)
  assert.equal(result.retried, true)
})

test("exportSessionWithRetry fails after all retries", () => {
  const exporter = () => {
    throw new Error("OpenCode command failed: opencode export ses_fail")
  }

  const result = exportSessionWithRetry({ id: "ses_retry_fail", project: "proj" }, exporter, {
    exportRetries: 2,
    exportRetryDelayMs: 1,
    exportBackoffMultiplier: 2,
    waitFn: () => {},
  })

  assert.equal(result.ok, false)
  assert.equal(result.failure.finalFailureType, "process_error")
  assert.equal(result.failure.attemptCount, 1)
  assert.equal(result.failure.retried, false)
})

test("classifyExportFailure classifies invalid_json", () => {
  const classified = classifyExportFailure(new Error("Failed to parse JSON output from OpenCode"))
  assert.equal(classified.type, "invalid_json")
})

test("classifyExportFailure classifies timeout", () => {
  const classified = classifyExportFailure(new Error("spawnSync opencode ETIMEDOUT"))
  assert.equal(classified.type, "timeout")
})

test("metadata-only sessions stay out of deep analysis but count toward coverage", () => {
  const sessions = [
    { id: "ses_meta", title: "meta", project: "p1" },
    { id: "ses_full", title: "full", project: "p1" },
  ]

  const exporter = (sessionID) => ({ sessionID })
  const analyzeFn = (session) => {
    if (session.id === "ses_meta") {
      return {
        messages: [{ role: "user", text: "hi" }],
      }
    }
    return {
      messages: [
        { role: "user", text: "a" },
        { role: "assistant", text: "b" },
        { role: "assistant", text: "c" },
      ],
    }
  }

  const result = collectAnalyzedSessions(sessions, analyzeFn, {
    minMessages: 3,
    maxAttempts: 2,
    exportRetries: 1,
    exporter,
    waitFn: () => {},
    shouldLogSkips: false,
  })

  assert.equal(result.analyzed.length, 1)
  assert.equal(result.metadataOnly.length, 1)
  assert.equal(result.metadataOnly[0].id, "ses_meta")
  assert.equal(result.exportDiagnostics.analysisCoverage.coverageRate, "100%")
  assert.equal(result.exportDiagnostics.exportFailed, 0)
})

test("analysis errors do not pollute export failure statistics", () => {
  const sessions = [{ id: "ses_analysis_error", title: "a", project: "p" }]
  const exporter = () => ({ ok: true })
  const analyzeFn = () => {
    throw new Error("analysis exploded")
  }

  const result = collectAnalyzedSessions(sessions, analyzeFn, {
    minMessages: 3,
    maxAttempts: 1,
    exportRetries: 0,
    exporter,
    waitFn: () => {},
    shouldLogSkips: false,
  })

  assert.equal(result.exportDiagnostics.exportFailed, 0)
  assert.equal(result.exportDiagnostics.analysisFailures.count, 1)
  assert.equal(result.exportDiagnostics.analysisFailures.sessions[0].stage, "analysis")
})
