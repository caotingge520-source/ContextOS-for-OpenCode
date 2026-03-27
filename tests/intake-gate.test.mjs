import test from "node:test"
import assert from "node:assert/strict"

import {
  classifyIntakeMode,
  inferRecommendedCapability,
  maybeApplyTaskAnchor,
  selectSources,
} from "../scripts/intake-gate.mjs"

function baseSourceInput(overrides = {}) {
  return {
    intakeMode: "continue_task",
    promptNorm: "continue current insights task",
    riskLevel: "yellow",
    taskIdentity: {
      domain: "capability",
      object_type: "named capability unit",
      object_name: "insights",
      scope: "L2",
      durability: "candidate",
      confidence: 0.82,
      evidence: ["aligned"],
    },
    currentTask: {
      title: "insights improvement",
      summary: "continue insights pipeline",
      domain: "capability",
      object_type: "named capability unit",
      object_name: "insights",
      scope: "L2",
      durability: "candidate",
      constraints: ["Stay local-first"],
      next_steps: ["run intake"],
    },
    situation: "# Current Situation\n- continuing insights",
    guardSnapshot: {
      generatedAt: new Date().toISOString(),
      taskTitle: "insights",
      domain: "capability",
      scope: "L2",
      durability: "candidate",
      mustSurviveConstraints: ["Stay local-first"],
      nextSteps: ["run intake"],
    },
    rescueLatest: {
      generatedAt: new Date().toISOString(),
      recommendedOpenFile: "scripts/generate-insights.mjs",
      nextAction: "continue",
    },
    memoryCore: "# Core\n- insight",
    preferences: [],
    recommendedCapability: null,
    contextBudget: {
      riskLevel: "yellow",
      immediateAction: { title: "narrow scope" },
    },
    maxSections: 8,
    maxChars: 3600,
    ...overrides,
  }
}

test("new_task mode detection", () => {
  const result = classifyIntakeMode({
    explicitMode: "auto",
    promptNorm: "start new task to audit auth config",
    currentTask: { object_name: "insights" },
    inferredIdentity: { object_name: "auth", confidence: 0.8 },
    riskLevel: "green",
  })
  assert.equal(result.intakeMode, "new_task")
})

test("continue_task mode detection", () => {
  const result = classifyIntakeMode({
    explicitMode: "auto",
    promptNorm: "continue this insights task",
    currentTask: { object_name: "insights" },
    inferredIdentity: { object_name: "insights", confidence: 0.9 },
    riskLevel: "green",
  })
  assert.equal(result.intakeMode, "continue_task")
})

test("pivot_task mode detection", () => {
  const result = classifyIntakeMode({
    explicitMode: "auto",
    promptNorm: "switch to rescue workflow now",
    currentTask: { object_name: "insights" },
    inferredIdentity: { object_name: "rescue", confidence: 0.82 },
    riskLevel: "green",
  })
  assert.equal(result.intakeMode, "pivot_task")
})

test("ambiguous mode detection", () => {
  const result = classifyIntakeMode({
    explicitMode: "auto",
    promptNorm: "看看",
    currentTask: { object_name: "insights" },
    inferredIdentity: { object_name: "unknown", confidence: 0.2 },
    riskLevel: "green",
  })
  assert.equal(result.intakeMode, "ambiguous")
})

test("fresh guard leads to richer selected context", () => {
  const withFreshGuard = selectSources(baseSourceInput())
  const withoutGuard = selectSources(baseSourceInput({ guardSnapshot: null }))

  assert.ok(withFreshGuard.selectedSources.some((item) => item.key === "fresh_guard_snapshot"))
  assert.ok(!withoutGuard.selectedSources.some((item) => item.key === "fresh_guard_snapshot"))
})

test("red risk makes selected context conservative", () => {
  const result = selectSources(baseSourceInput({
    riskLevel: "red",
    maxSections: 8,
    maxChars: 5000,
  }))
  assert.ok(result.selectedSources.length <= 5)
  assert.ok(result.budget.maxChars <= 2200)
})

test("capability tasks select capability clues", () => {
  const capabilities = [
    { name: "insights", path: "capabilities/insights.md", note: "insights note" },
    { name: "rescue", path: "capabilities/rescue.md", note: "rescue note" },
  ]
  const cap = inferRecommendedCapability("improve insights report", {
    domain: "capability",
    object_name: "insights",
  }, capabilities)
  assert.equal(cap?.name, "insights")

  const selected = selectSources(baseSourceInput({
    recommendedCapability: cap,
  }))
  assert.ok(selected.selectedSources.some((item) => item.key === "relevant_capability_notes"))
})

test("preference tasks are not misclassified as capability slice", () => {
  const selected = selectSources(baseSourceInput({
    taskIdentity: {
      domain: "preference",
      object_type: "platform/global user method",
      object_name: "user-method",
      scope: "L3",
      durability: "candidate",
      confidence: 0.7,
      evidence: ["preference cue"],
    },
    promptNorm: "保持我的表达风格和偏好",
    recommendedCapability: null,
    preferences: [{ name: "style.md", path: "rules/style.md", note: "keep style" }],
  }))

  assert.ok(selected.selectedSources.some((item) => item.key === "global_preferences"))
  assert.ok(!selected.selectedSources.some((item) => item.key === "relevant_capability_notes"))
  assert.ok(Array.isArray(selected.excludedSources))
})

test("maybeApplyTaskAnchor skips apply when mode is not continue or pivot", () => {
  const called = { count: 0 }
  const result = maybeApplyTaskAnchor(
    {
      apply: true,
      intakeMode: "ambiguous",
      confidence: 0.9,
      currentTask: { object_name: "insights" },
      taskIdentity: {
        domain: "capability",
        object_type: "named capability unit",
        object_name: "insights",
        scope: "L2",
        durability: "candidate",
        confidence: 0.9,
        evidence: ["x"],
      },
      prompt: "continue?",
      selected: { selectedSources: [{ key: "k" }], excludedSources: [] },
    },
    {
      saveCurrentTaskAnchor() {
        called.count += 1
      },
    },
  )

  assert.equal(result.applied, false)
  assert.equal(called.count, 0)
  assert.equal(result.reason.includes("apply skipped"), true)
})

test("maybeApplyTaskAnchor skips apply when confidence too low", () => {
  const called = { count: 0 }
  const result = maybeApplyTaskAnchor(
    {
      apply: true,
      intakeMode: "continue_task",
      confidence: 0.65,
      currentTask: { object_name: "insights" },
      taskIdentity: {
        domain: "capability",
        object_type: "named capability unit",
        object_name: "insights",
        scope: "L2",
        durability: "candidate",
        confidence: 0.65,
        evidence: ["x"],
      },
      prompt: "continue?",
      selected: { selectedSources: [{ key: "k" }], excludedSources: [] },
    },
    {
      saveCurrentTaskAnchor() {
        called.count += 1
      },
    },
  )

  assert.equal(result.applied, false)
  assert.equal(called.count, 0)
  assert.equal(result.reason.includes("confidence too low"), true)
})

test("maybeApplyTaskAnchor applies on confident continue with injected saver", () => {
  const saved = []
  const result = maybeApplyTaskAnchor(
    {
      apply: true,
      intakeMode: "continue_task",
      confidence: 0.9,
      currentTask: {
        task_id: "task-abc",
        title: "insights run",
        summary: "run",
        domain: "capability",
        object_type: "named capability unit",
        object_name: "insights",
        scope: "L2",
        durability: "candidate",
        active_files: ["a.md"],
        recent_commands: ["cmd"],
        constraints: ["local-first"],
        next_steps: ["read docs"],
      },
      taskIdentity: {
        domain: "capability",
        object_type: "named capability unit",
        object_name: "insights",
        scope: "L2",
        durability: "candidate",
        confidence: 0.9,
        evidence: ["x", "y"],
      },
      prompt: "continue insights task",
      selected: { selectedSources: [{ key: "k" }], excludedSources: [] },
    },
    {
      saveCurrentTaskAnchor(anchor) {
        saved.push(anchor)
        return {
          yamlPath: "fake/current-task.yaml",
          anchor,
        }
      },
    },
  )

  assert.equal(result.applied, true)
  assert.equal(saved.length, 1)
  assert.equal(result.updatedTask.task_id, "task-abc")
})
