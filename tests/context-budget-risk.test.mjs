import test from "node:test"
import assert from "node:assert/strict"

import {
  computeRiskAssessment,
  computeRiskCategories,
  buildRuntimeRecommendations,
  buildReportPayload,
} from "../scripts/context-budget.mjs"

function makeInput(overrides = {}) {
  return {
    sessionLoad: {
      sessionCount: 8,
      totalMessages: 320,
      totalChars: 180000,
      averageMessages: 40,
      averageChars: 22500,
      maxMessages: 60,
      maxChars: 210000,
      averageToolDensity: 0.28,
      longOutputEvents: 3,
      noisyToolSessions: 0,
      uniqueActiveFiles: ["scripts/context-budget.mjs"],
      uniqueActiveFilesCount: 1,
    },
    analyzed: [
      {
        activeFilesCount: 1,
        repeatedReadPatterns: [],
      },
    ],
    repeatedInstructions: [],
    insightsSummary: {
      evidence: ["insights repeated instruction groups=0"],
    },
    guardStatus: {
      exists: true,
      fresh: true,
      hasCurrentTask: true,
      hasNextSteps: true,
      ageHours: 1,
      status: "fresh",
      evidence: ["guard_age=<1h", "contains current task section", "contains next steps"],
    },
    taskAnchorSummary: {
      exists: true,
      fresh: true,
      driftDetected: false,
      ageHours: 1,
      driftEvidence: ["task anchor aligns with recent session context"],
    },
    rescueReadiness: {
      ready: true,
    },
    ...overrides,
  }
}

test("green risk scenario", () => {
  const result = computeRiskAssessment(makeInput())
  assert.equal(result.riskLevel, "green")
  assert.ok(result.score < 40)
})

test("yellow risk scenario", () => {
  const result = computeRiskAssessment(makeInput({
    sessionLoad: {
      ...makeInput().sessionLoad,
      maxMessages: 120,
      maxChars: 560000,
      longOutputEvents: 18,
      averageToolDensity: 0.62,
      noisyToolSessions: 2,
      uniqueActiveFilesCount: 18,
    },
    analyzed: [
      { activeFilesCount: 10, repeatedReadPatterns: [{ text: "x", count: 2 }] },
      { activeFilesCount: 8, repeatedReadPatterns: [{ text: "y", count: 2 }] },
    ],
    repeatedInstructions: [{ count: 3 }, { count: 2 }],
  }))
  assert.equal(result.riskLevel, "yellow")
  assert.ok(result.score >= 40 && result.score < 70)
})

test("red risk scenario", () => {
  const result = computeRiskAssessment(makeInput({
    sessionLoad: {
      ...makeInput().sessionLoad,
      maxMessages: 220,
      maxChars: 1200000,
      longOutputEvents: 36,
      averageToolDensity: 0.82,
      noisyToolSessions: 5,
      uniqueActiveFilesCount: 36,
    },
    analyzed: [
      { activeFilesCount: 14, repeatedReadPatterns: [{ text: "x", count: 3 }] },
      { activeFilesCount: 12, repeatedReadPatterns: [{ text: "y", count: 2 }] },
      { activeFilesCount: 10, repeatedReadPatterns: [{ text: "z", count: 2 }] },
      { activeFilesCount: 3, repeatedReadPatterns: [] },
    ],
    repeatedInstructions: [{ count: 5 }, { count: 3 }, { count: 2 }, { count: 2 }],
    guardStatus: {
      exists: false,
      fresh: false,
      hasCurrentTask: false,
      hasNextSteps: false,
      ageHours: null,
      status: "missing",
      evidence: ["SESSION_GUARD.md not found"],
    },
    taskAnchorSummary: {
      exists: false,
      fresh: false,
      driftDetected: true,
      ageHours: null,
      driftEvidence: ["current-task.yaml missing"],
    },
    rescueReadiness: { ready: false },
  }))
  assert.equal(result.riskLevel, "red")
  assert.ok(result.score >= 70)
})

test("missing guard raises risk", () => {
  const base = computeRiskAssessment(makeInput())
  const missingGuard = computeRiskAssessment(makeInput({
    guardStatus: {
      exists: false,
      fresh: false,
      hasCurrentTask: false,
      hasNextSteps: false,
      ageHours: null,
      status: "missing",
      evidence: ["SESSION_GUARD.md not found"],
    },
  }))

  assert.ok(missingGuard.score > base.score)
})

test("repeated instructions increase risk", () => {
  const base = computeRiskAssessment(makeInput())
  const stacked = computeRiskAssessment(makeInput({
    repeatedInstructions: [{ count: 4 }, { count: 3 }, { count: 2 }],
    analyzed: [
      { activeFilesCount: 1, repeatedReadPatterns: [{ text: "repeat", count: 3 }] },
      { activeFilesCount: 1, repeatedReadPatterns: [{ text: "repeat2", count: 2 }] },
    ],
  }))

  assert.ok(stacked.score > base.score)
})

test("fresh guard and aligned task lower risk", () => {
  const risky = computeRiskAssessment(makeInput({
    guardStatus: {
      exists: true,
      fresh: false,
      hasCurrentTask: false,
      hasNextSteps: false,
      ageHours: 72,
      status: "stale",
      evidence: ["guard_age=3d"],
    },
    taskAnchorSummary: {
      exists: true,
      fresh: false,
      driftDetected: true,
      ageHours: 72,
      driftEvidence: ["task anchor age too old"],
    },
  }))

  const stabilized = computeRiskAssessment(makeInput())
  assert.ok(stabilized.score < risky.score)

  const recommendations = buildRuntimeRecommendations({
    assessment: risky,
    guardStatus: {
      exists: true,
      fresh: false,
      status: "stale",
    },
    rescueReadiness: { ready: true },
    repeatedInstructions: [],
  })
  assert.equal(recommendations.immediateAction.title, "先刷新 guard")
})

test("risk categories include four typed gates with evidence and actions", () => {
  const assessment = computeRiskAssessment(makeInput({
    repeatedInstructions: [{ count: 3 }, { count: 2 }],
  }))

  const categories = computeRiskCategories({
    assessment,
    guardStatus: makeInput().guardStatus,
    taskAnchorSummary: makeInput().taskAnchorSummary,
    rescueReadiness: { ready: true },
    situationStatus: { exists: true, length: 180 },
    memoryStatus: { exists: true, insightCount: 4 },
    journalStatus: { exists: true, fileCount: 3 },
    repeatedInstructions: [{ count: 3 }, { count: 2 }],
  })

  const names = categories.map((item) => item.riskCategory).sort()
  assert.deepEqual(names, ["context_fade", "context_overload", "context_pollution", "knowledge_bottleneck"])
  assert.ok(categories.every((item) => ["red", "yellow", "green"].includes(item.riskLevel)))
  assert.ok(categories.every((item) => Array.isArray(item.evidence) && item.evidence.length > 0))
  assert.ok(categories.every((item) => typeof item.recommendedAction === "string" && item.recommendedAction.length > 0))
})

test("buildReportPayload includes required optimize-context risk fields", () => {
  const input = makeInput()
  const report = buildReportPayload({
    days: 14,
    analyzed: [
      {
        id: "s1",
        title: "t1",
        project: "p",
        updatedAt: "2026-01-01T00:00:00.000Z",
        messageCount: 10,
        userMessages: 3,
        assistantMessages: 6,
        toolMessages: 1,
        totalChars: 1200,
        maxMessageChars: 300,
        activeFiles: ["scripts/context-budget.mjs"],
        activeFilesCount: 1,
        longMessages: [],
        repeatedReadPatterns: [],
      },
    ],
    repeatedInstructions: [],
    heaviestSessions: [],
    noisySessions: [],
    skipped: [],
    attempts: 1,
    insightsSummary: { evidence: ["x"] },
    guardStatus: input.guardStatus,
    taskAnchorSummary: {
      ...input.taskAnchorSummary,
      summary: "working on context runtime risk gate",
    },
    rescueReadiness: { ready: true, snapshotCount: 2 },
    situationStatus: { exists: true, length: 100 },
    memoryStatus: { exists: true, insightCount: 3 },
    journalStatus: { exists: true, fileCount: 2, latestAgeHours: 1 },
  })

  assert.ok(["red", "yellow", "green"].includes(report.riskLevel))
  assert.equal(typeof report.score, "number")
  assert.equal(typeof report.riskCategory, "string")
  assert.ok(Array.isArray(report.riskCategories) && report.riskCategories.length === 4)
  assert.ok(Array.isArray(report.signals) && report.signals.length > 0)
  assert.ok(Array.isArray(report.recommendations) && report.recommendations.length > 0)
  assert.ok(report.taskAnchorSummary)
  assert.ok(report.guardStatus)
  assert.ok(report.rescueReadiness)
  assert.ok(report.generatedAt)
})
