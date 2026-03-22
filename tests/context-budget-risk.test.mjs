import test from "node:test"
import assert from "node:assert/strict"

import {
  computeRiskAssessment,
  buildRuntimeRecommendations,
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
