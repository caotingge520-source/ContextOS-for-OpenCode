#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  ANALYSIS_DIR,
  CURRENT_TASK_YAML_PATH,
  GUARD_PATH,
  INTAKE_DECISION_PATH,
  MEMORY_CORE_PATH,
  RESCUE_LATEST_DIR,
  ROOT,
  SELECTED_CONTEXT_JSON_PATH,
  SELECTED_CONTEXT_MD_PATH,
  SITUATION_MD_PATH,
  exportSession,
  extractMessages,
  htmlEscape,
  inferTaskIdentityRouting,
  listSessions,
  normalizeTextForMatch,
  readArgs,
  readCurrentTaskAnchor,
  saveCurrentTaskAnchor,
  saveJson,
  saveText,
} from "./contextos-lib.mjs"

const GUARD_SNAPSHOT_LATEST_PATH = path.join(path.dirname(GUARD_PATH), "snapshots", "latest.json")

function parsePositiveInt(raw, fallback) {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function readTextIfExists(filePath, fallback = "") {
  if (!fs.existsSync(filePath)) return fallback
  return fs.readFileSync(filePath, "utf8")
}

function parseDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

function hoursSince(value) {
  const date = parseDate(value)
  if (!date) return null
  return Math.round(((Date.now() - date.getTime()) / 3600000) * 10) / 10
}

function getPrompt(args) {
  if (typeof args.prompt === "string" && args.prompt.trim()) return args.prompt.trim()
  const joined = Array.isArray(args._) ? args._.join(" ").trim() : ""
  return joined
}

function detectContinuationCue(promptNorm) {
  return /(continue|继续|接着|延续|上次|刚才那个|as before|same task|继续这个)/.test(promptNorm)
}

function detectNewTaskCue(promptNorm) {
  return /(new task|新任务|重新开始|另起|from scratch|start new|新开一个)/.test(promptNorm)
}

function detectPivotCue(promptNorm) {
  return /(pivot|转向|切换|换成|改成|instead|别做.*改做|不要.*改为)/.test(promptNorm)
}

function detectAmbiguousCue(promptNorm) {
  if (!promptNorm) return true
  if (promptNorm.length < 6) return true
  return /^(看看|看下|怎么做|咋办|help|[?？]+)$/.test(promptNorm)
}

function discoverCapabilities(baseDir = ROOT) {
  const results = []
  const capabilityDir = path.join(baseDir, "capabilities")
  if (fs.existsSync(capabilityDir)) {
    const entries = fs.readdirSync(capabilityDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.name || entry.name.startsWith(".")) continue
      const name = entry.name.replace(/\.[^.]+$/, "")
      const fullPath = path.join(capabilityDir, entry.name)
      const note = entry.isFile() ? readTextIfExists(fullPath, "").split(/\r?\n/).slice(0, 6).join("\n") : ""
      results.push({
        name,
        path: fullPath,
        note,
      })
    }
  }
  return results
}

function discoverGlobalPreferences(baseDir = ROOT) {
  const targets = [path.join(baseDir, "rules"), path.join(baseDir, "learning")]
  const results = []
  for (const dir of targets) {
    if (!fs.existsSync(dir)) continue
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const fullPath = path.join(dir, entry.name)
      const content = readTextIfExists(fullPath, "")
      if (!content.trim()) continue
      results.push({
        name: entry.name,
        path: fullPath,
        note: content.split(/\r?\n/).slice(0, 8).join("\n"),
      })
    }
  }
  return results
}

function inferRecommendedCapability(promptNorm, identity, capabilities) {
  if (!capabilities.length) return null

  const byObject = capabilities.find((cap) => normalizeTextForMatch(cap.name) === normalizeTextForMatch(identity.object_name || ""))
  if (byObject) return byObject

  const byPrompt = capabilities.find((cap) => promptNorm.includes(normalizeTextForMatch(cap.name)))
  if (byPrompt) return byPrompt

  const domainHint = identity.domain === "capability"
  if (domainHint && capabilities.length) {
    return capabilities[0]
  }
  return null
}

function resolveRecentMessages(timeoutMs = 7000) {
  try {
    const sessions = listSessions({ maxCount: 5 })
    const latest = sessions[0]
    if (!latest?.id) return []
    const exportData = exportSession(latest.id, { timeoutMs })
    return extractMessages(exportData).slice(-20)
  } catch {
    return []
  }
}

function extractFileHints(messages = []) {
  const results = new Set()
  const filePattern = /([A-Za-z]:\\[^\s"'`]+|(?:\.\/|\.\.\/|[A-Za-z0-9_.-]+\/)[^\s"'`]+)/g
  for (const message of messages) {
    const text = String(message?.text || "")
    for (const match of text.matchAll(filePattern)) {
      const value = String(match[1] || "").trim()
      if (!value) continue
      if (value.length < 3) continue
      if (value.includes("node_modules")) continue
      results.add(value)
      if (results.size >= 16) return [...results]
    }
  }
  return [...results]
}

function extractCommandHints(messages = []) {
  const results = new Set()
  for (const message of messages) {
    if (message.role === "tool" && message.name) {
      results.add(String(message.name))
    }
    const text = String(message.text || "")
    const calls = text.match(/\b(node\s+scripts\/[\w.-]+\.mjs(?:\s+--[\w-]+(?:\s+[^\s]+)?)*)/g) || []
    for (const call of calls) {
      results.add(call.trim())
    }
  }
  return [...results].slice(0, 12)
}

function classifyIntakeMode({
  explicitMode,
  promptNorm,
  currentTask,
  inferredIdentity,
  riskLevel,
}) {
  if (["new_task", "continue_task", "pivot_task", "ambiguous"].includes(explicitMode)) {
    return {
      intakeMode: explicitMode,
      reason: `explicit_mode=${explicitMode}`,
    }
  }

  const continuationCue = detectContinuationCue(promptNorm)
  const newCue = detectNewTaskCue(promptNorm)
  const pivotCue = detectPivotCue(promptNorm)
  const ambiguousCue = detectAmbiguousCue(promptNorm)

  if (!currentTask) {
    return {
      intakeMode: ambiguousCue ? "ambiguous" : "new_task",
      reason: ambiguousCue ? "no_current_task_and_prompt_too_ambiguous" : "no_current_task_anchor",
    }
  }

  if (newCue) {
    return {
      intakeMode: "new_task",
      reason: "new_task_language_detected",
    }
  }

  const sameObject = normalizeTextForMatch(currentTask.object_name || "") === normalizeTextForMatch(inferredIdentity.object_name || "")
  const promptMentionsCurrentObject = promptNorm.includes(normalizeTextForMatch(currentTask.object_name || ""))
  const confidence = Number(inferredIdentity.confidence || 0)

  if ((pivotCue || (!sameObject && !promptMentionsCurrentObject && confidence >= 0.62)) && !continuationCue) {
    return {
      intakeMode: "pivot_task",
      reason: pivotCue ? "pivot_language_detected" : "object_shift_detected",
    }
  }

  if (continuationCue || sameObject || promptMentionsCurrentObject || !promptNorm) {
    return {
      intakeMode: "continue_task",
      reason: continuationCue ? "continuation_language_detected" : "task_object_alignment",
    }
  }

  if (ambiguousCue || confidence < 0.45 || riskLevel === "red") {
    return {
      intakeMode: "ambiguous",
      reason: ambiguousCue ? "prompt_ambiguous" : confidence < 0.45 ? "low_identity_confidence" : "high_risk_requires_conservative_intake",
    }
  }

  return {
    intakeMode: "new_task",
    reason: "fallback_new_task",
  }
}

function buildTaskIdentity(currentTask, inferredIdentity, intakeMode) {
  if (!currentTask) return inferredIdentity
  if (intakeMode === "continue_task") {
    return {
      ...inferredIdentity,
      domain: currentTask.domain || inferredIdentity.domain,
      object_type: currentTask.object_type || inferredIdentity.object_type,
      object_name: currentTask.object_name || inferredIdentity.object_name,
      scope: currentTask.scope || inferredIdentity.scope,
      durability: currentTask.durability || inferredIdentity.durability,
      confidence: Math.max(Number(inferredIdentity.confidence || 0), 0.65),
      evidence: [
        ...(inferredIdentity.evidence || []),
        "continue_task mode keeps current task anchor as primary identity",
      ],
    }
  }
  if (intakeMode === "pivot_task") {
    return {
      ...inferredIdentity,
      confidence: Math.max(Number(inferredIdentity.confidence || 0), 0.62),
      durability: inferredIdentity.durability === "durable" ? "candidate" : inferredIdentity.durability,
      evidence: [
        ...(inferredIdentity.evidence || []),
        `pivot from ${currentTask.object_name || "unknown"} to ${inferredIdentity.object_name || "unknown"}`,
      ],
    }
  }
  return inferredIdentity
}

function summarizeGuardSnapshot(guardSnapshot) {
  if (!guardSnapshot) return "(missing)"
  return [
    `generatedAt=${guardSnapshot.generatedAt || "unknown"}`,
    `task=${guardSnapshot.taskTitle || "unknown"}`,
    `identity=${guardSnapshot.domain || "?"}/${guardSnapshot.scope || "?"}/${guardSnapshot.durability || "?"}`,
    `nextStep=${guardSnapshot.nextSteps?.[0] || "(none)"}`,
  ].join("\n")
}

function selectSources({
  intakeMode,
  promptNorm,
  riskLevel,
  taskIdentity,
  currentTask,
  situation,
  guardSnapshot,
  rescueLatest,
  memoryCore,
  preferences,
  recommendedCapability,
  contextBudget,
  maxSections,
  maxChars,
}) {
  const sourceCandidates = []

  const addSource = (key, score, reason, content, meta = {}) => {
    sourceCandidates.push({ key, score, reason, content, meta })
  }

  if (currentTask) {
    addSource(
      "current_task_anchor",
      10,
      "primary anchor for task identity and next steps",
      {
        title: currentTask.title,
        summary: currentTask.summary,
        domain: currentTask.domain,
        object: `${currentTask.object_type} / ${currentTask.object_name}`,
        scope: currentTask.scope,
        durability: currentTask.durability,
      },
      { path: CURRENT_TASK_YAML_PATH },
    )
  }

  if (situation.trim()) {
    addSource(
      "situation_summary",
      intakeMode === "new_task" ? 3 : 7,
      intakeMode === "new_task" ? "kept as minimal situational context" : "continuation/pivot requires current situation context",
      {
        preview: situation.split(/\r?\n/).filter(Boolean).slice(0, 14),
      },
      { path: SITUATION_MD_PATH },
    )
  }

  if (currentTask?.constraints?.length || guardSnapshot?.mustSurviveConstraints?.length) {
    addSource(
      "must_survive_constraints",
      9,
      "constraints must survive regardless of task mode",
      {
        constraints: (guardSnapshot?.mustSurviveConstraints?.length
          ? guardSnapshot.mustSurviveConstraints
          : currentTask?.constraints || []).slice(0, 8),
      },
      { path: GUARD_PATH },
    )
  }

  const guardFresh = guardSnapshot?.generatedAt && (hoursSince(guardSnapshot.generatedAt) ?? 999) <= 12
  if (guardSnapshot && guardFresh) {
    addSource(
      "fresh_guard_snapshot",
      8,
      "latest guard snapshot is fresh and safe to reuse",
      {
        summary: summarizeGuardSnapshot(guardSnapshot),
      },
      { path: GUARD_SNAPSHOT_LATEST_PATH },
    )
  }

  if (rescueLatest?.generatedAt && (intakeMode === "continue_task" || intakeMode === "pivot_task" || riskLevel === "red")) {
    addSource(
      "relevant_rescue_readiness",
      riskLevel === "red" ? 7 : 5,
      riskLevel === "red" ? "high risk mode loads rescue helper for recoverability" : "continuation path benefits from rescue helper pointers",
      {
        generatedAt: rescueLatest.generatedAt,
        recommendedOpenFile: rescueLatest.recommendedOpenFile,
        nextAction: rescueLatest.nextAction,
      },
      { path: path.join(RESCUE_LATEST_DIR, "latest-snapshot.json") },
    )
  }

  if (recommendedCapability) {
    addSource(
      "relevant_capability_notes",
      6,
      "task identity aligns with capability unit",
      {
        capability: recommendedCapability.name,
        note: String(recommendedCapability.note || "").split(/\r?\n/).slice(0, 8),
      },
      { path: recommendedCapability.path },
    )
  }

  const preferenceCue = /(风格|偏好|口气|表达|规则|preference|style)/.test(promptNorm)
  if (preferences.length && (taskIdentity.domain === "preference" || preferenceCue)) {
    addSource(
      "global_preferences",
      4,
      "preference-oriented request needs global preference context",
      {
        notes: preferences.slice(0, 3).map((item) => ({
          name: item.name,
          path: item.path,
          note: item.note,
        })),
      },
      { paths: preferences.slice(0, 3).map((item) => item.path) },
    )
  }

  if (contextBudget) {
    addSource(
      "risk_gate_signal",
      5,
      "intake should respect latest risk gate output",
      {
        riskLevel: contextBudget.riskLevel,
        riskCategory: contextBudget.riskCategory,
        recommendedAction: contextBudget.immediateAction?.title || contextBudget.recommendations?.[0]?.title || "(none)",
      },
      { path: path.join(ANALYSIS_DIR, "context-budget.json") },
    )
  }

  const sectionCap = riskLevel === "red" ? Math.min(maxSections, 5) : maxSections
  const charCap = riskLevel === "red" ? Math.min(maxChars, 2200) : maxChars

  const selectedSources = []
  const excludedSources = []
  let currentChars = 0

  for (const source of [...sourceCandidates].sort((a, b) => b.score - a.score)) {
    const serialized = JSON.stringify(source.content)
    const projected = currentChars + serialized.length
    if (selectedSources.length >= sectionCap) {
      excludedSources.push({
        source: source.key,
        reason: `section limit reached (${sectionCap})`,
      })
      continue
    }
    if (projected > charCap) {
      excludedSources.push({
        source: source.key,
        reason: `character budget exceeded (${charCap})`,
      })
      continue
    }

    selectedSources.push(source)
    currentChars = projected
  }

  const allSelectedKeys = new Set(selectedSources.map((item) => item.key))
  for (const source of sourceCandidates) {
    if (!allSelectedKeys.has(source.key) && !excludedSources.some((item) => item.source === source.key)) {
      excludedSources.push({
        source: source.key,
        reason: "lower relevance than selected slices",
      })
    }
  }

  return {
    selectedSources,
    excludedSources,
    budget: {
      maxSections: sectionCap,
      maxChars: charCap,
      usedChars: currentChars,
    },
  }
}

function chooseRecommendedAction({ intakeMode, riskLevel, guardFresh, taskIdentity, selection, contextBudget }) {
  if (!guardFresh) {
    return "先 refresh guard，再进入本轮任务"
  }
  if (riskLevel === "red") {
    return contextBudget?.immediateAction?.title || "先收束当前任务范围并减少上下文加载"
  }
  if (intakeMode === "ambiguous") {
    return "先澄清任务对象与目标，再扩展上下文"
  }
  if (intakeMode === "pivot_task") {
    return `确认任务已转向 ${taskIdentity.object_name}，并按新对象收敛上下文`
  }
  if (selection.excludedSources.length > 0) {
    return "按 selected-context 切片继续，不要回灌全部历史状态"
  }
  return "继续当前任务并保持最小上下文加载"
}

function buildSelectedContextJson({
  intakeMode,
  taskIdentity,
  selected,
  recommendedAction,
  recommendedCapability,
}) {
  const sectionByKey = new Map(selected.selectedSources.map((item) => [item.key, item]))
  return {
    intakeMode,
    taskIdentity,
    sections: {
      currentTaskAnchor: sectionByKey.get("current_task_anchor")?.content || null,
      situationSummary: sectionByKey.get("situation_summary")?.content || null,
      mustSurviveConstraints: sectionByKey.get("must_survive_constraints")?.content || null,
      freshGuardSnapshotSummary: sectionByKey.get("fresh_guard_snapshot")?.content || null,
      relevantRescueReadiness: sectionByKey.get("relevant_rescue_readiness")?.content || null,
      relevantCapabilityNotes: sectionByKey.get("relevant_capability_notes")?.content || null,
      globalPreferences: sectionByKey.get("global_preferences")?.content || null,
      riskGateSignal: sectionByKey.get("risk_gate_signal")?.content || null,
      recommendedNextStep: {
        action: recommendedAction,
        recommendedCapability: recommendedCapability?.name || null,
      },
    },
    selectedSources: selected.selectedSources.map((item) => ({
      source: item.key,
      reason: item.reason,
      path: item.meta.path || item.meta.paths || null,
    })),
    excludedSources: selected.excludedSources,
    budget: selected.budget,
    generatedAt: new Date().toISOString(),
  }
}

function sectionToMarkdown(title, value) {
  if (!value) return `## ${title}\n- (not selected)`
  if (Array.isArray(value)) {
    return `## ${title}\n${value.length ? value.map((item) => `- ${htmlEscape(String(item))}`).join("\n") : "- (empty)"}`
  }
  if (typeof value === "object") {
    const rows = []
    for (const [key, entry] of Object.entries(value)) {
      if (entry == null) continue
      if (Array.isArray(entry)) {
        rows.push(`- ${key}:`)
        rows.push(...entry.map((item) => `  - ${htmlEscape(typeof item === "string" ? item : JSON.stringify(item))}`))
      } else if (typeof entry === "object") {
        rows.push(`- ${key}: ${htmlEscape(JSON.stringify(entry))}`)
      } else {
        rows.push(`- ${key}: ${htmlEscape(String(entry))}`)
      }
    }
    return `## ${title}\n${rows.length ? rows.join("\n") : "- (empty)"}`
  }
  return `## ${title}\n- ${htmlEscape(String(value))}`
}

function buildSelectedContextMarkdown(payload) {
  const s = payload.sections
  return [
    "# Selected Context Slice",
    "",
    `Generated at: ${payload.generatedAt}`,
    `Intake mode: ${payload.intakeMode}`,
    `Task identity: ${payload.taskIdentity.domain} / ${payload.taskIdentity.object_name} / ${payload.taskIdentity.scope} / ${payload.taskIdentity.durability}`,
    `Confidence: ${payload.taskIdentity.confidence}`,
    "",
    sectionToMarkdown("Current Task Anchor", s.currentTaskAnchor),
    "",
    sectionToMarkdown("Situation Summary", s.situationSummary),
    "",
    sectionToMarkdown("Must-Survive Constraints", s.mustSurviveConstraints),
    "",
    sectionToMarkdown("Fresh Guard Snapshot Summary", s.freshGuardSnapshotSummary),
    "",
    sectionToMarkdown("Relevant Rescue Readiness", s.relevantRescueReadiness),
    "",
    sectionToMarkdown("Relevant Capability Notes", s.relevantCapabilityNotes),
    "",
    sectionToMarkdown("Global Preferences (only if relevant)", s.globalPreferences),
    "",
    sectionToMarkdown("Recommended Next Step", s.recommendedNextStep),
    "",
    "## Selected Sources",
    ...payload.selectedSources.map((item) => `- ${item.source}: ${item.reason}`),
    "",
    "## Excluded Sources",
    ...(payload.excludedSources.length
      ? payload.excludedSources.map((item) => `- ${item.source}: ${item.reason}`)
      : ["- (none)"]),
    "",
  ].join("\n")
}

function maybeApplyTaskAnchor({ apply, intakeMode, confidence, currentTask, taskIdentity, prompt, selected }, hooks = {}) {
  const saver = hooks.saveCurrentTaskAnchor || saveCurrentTaskAnchor
  if (!apply) {
    return {
      applied: false,
      reason: "apply disabled",
    }
  }

  if (!["continue_task", "pivot_task"].includes(intakeMode)) {
    return {
      applied: false,
      reason: `apply skipped for intakeMode=${intakeMode}`,
    }
  }

  if (confidence < 0.66) {
    return {
      applied: false,
      reason: `confidence too low for apply (${confidence})`,
    }
  }

  const nextSteps = currentTask?.next_steps?.length
    ? currentTask.next_steps
    : ["Use selected-context.md as primary context for this round"]

  const anchor = {
    task_id: currentTask?.task_id || `task-${Date.now()}`,
    title: intakeMode === "pivot_task" ? `pivot to ${taskIdentity.object_name}` : currentTask?.title || "continue task",
    summary: prompt || currentTask?.summary || "task intake apply update",
    domain: taskIdentity.domain,
    object_type: taskIdentity.object_type,
    object_name: taskIdentity.object_name,
    scope: taskIdentity.scope,
    durability: taskIdentity.durability,
    confidence,
    active_files: currentTask?.active_files || [],
    recent_commands: currentTask?.recent_commands || [],
    constraints: currentTask?.constraints || [],
    next_steps: nextSteps,
    evidence: [
      ...(taskIdentity.evidence || []),
      `apply_mode=true`,
      `intakeMode=${intakeMode}`,
      `selectedSources=${selected.selectedSources.length}`,
    ],
  }

  const saved = saver(anchor)
  return {
    applied: true,
    reason: `applied to ${saved.yamlPath}`,
    updatedTask: {
      path: saved.yamlPath,
      task_id: saved.anchor.task_id,
      title: saved.anchor.title,
      domain: saved.anchor.domain,
      object_name: saved.anchor.object_name,
      scope: saved.anchor.scope,
      durability: saved.anchor.durability,
    },
  }
}

async function runIntakeGate(options = {}) {
  const args = options.args || readArgs()
  const prompt = getPrompt(args)
  const promptNorm = normalizeTextForMatch(prompt)
  const explicitMode = String(args.mode || "auto")
  const maxSections = parsePositiveInt(args["max-sections"], 8)
  const maxChars = parsePositiveInt(args["max-chars"], 3600)
  const apply = args.apply === true

  const currentTask = readCurrentTaskAnchor(CURRENT_TASK_YAML_PATH)
  const situation = readTextIfExists(SITUATION_MD_PATH, "")
  const guardSnapshot = readJsonIfExists(GUARD_SNAPSHOT_LATEST_PATH)
  const rescueLatest = readJsonIfExists(path.join(RESCUE_LATEST_DIR, "latest-snapshot.json"))
  const contextBudget = readJsonIfExists(path.join(ANALYSIS_DIR, "context-budget.json"))
  const memoryCore = readTextIfExists(MEMORY_CORE_PATH, "")
  const recentMessages = resolveRecentMessages(parsePositiveInt(args["export-timeout-ms"], 7000))
  const capabilities = discoverCapabilities(ROOT)
  const preferences = discoverGlobalPreferences(ROOT)

  const inferredIdentity = inferTaskIdentityRouting({
    userRequest: prompt,
    recentMessages,
    activeFiles: [
      ...(currentTask?.active_files || []),
      ...extractFileHints(recentMessages),
    ].slice(0, 14),
    recentCommands: [
      ...(currentTask?.recent_commands || []),
      ...extractCommandHints(recentMessages),
    ].slice(0, 14),
    cwd: ROOT,
    repeatedInstructionCount: Number(contextBudget?.repeatedInstructions?.[0]?.count || 0),
  })

  const riskLevel = String(contextBudget?.riskLevel || "green")
  const modeResult = classifyIntakeMode({
    explicitMode,
    promptNorm,
    currentTask,
    inferredIdentity,
    riskLevel,
  })
  const taskIdentity = buildTaskIdentity(currentTask, inferredIdentity, modeResult.intakeMode)

  const recommendedCapability = inferRecommendedCapability(promptNorm, taskIdentity, capabilities)

  const selection = selectSources({
    intakeMode: modeResult.intakeMode,
    promptNorm,
    riskLevel,
    taskIdentity,
    currentTask,
    situation,
    guardSnapshot,
    rescueLatest,
    memoryCore,
    preferences,
    recommendedCapability,
    contextBudget,
    maxSections,
    maxChars,
  })

  const guardFresh = Boolean(guardSnapshot?.generatedAt && (hoursSince(guardSnapshot.generatedAt) ?? 999) <= 12)
  const recommendedAction = chooseRecommendedAction({
    intakeMode: modeResult.intakeMode,
    riskLevel,
    guardFresh,
    taskIdentity,
    selection,
    contextBudget,
  })

  const applyResult = maybeApplyTaskAnchor({
    apply,
    intakeMode: modeResult.intakeMode,
    confidence: Number(taskIdentity.confidence || 0),
    currentTask,
    taskIdentity,
    prompt,
    selected: selection,
  })

  const selectedContextJson = buildSelectedContextJson({
    intakeMode: modeResult.intakeMode,
    taskIdentity,
    selected: selection,
    recommendedAction,
    recommendedCapability,
  })

  const selectedContextMarkdown = buildSelectedContextMarkdown(selectedContextJson)

  const decision = {
    intakeMode: modeResult.intakeMode,
    taskIdentity: {
      domain: taskIdentity.domain,
      object_type: taskIdentity.object_type,
      object_name: taskIdentity.object_name,
      scope: taskIdentity.scope,
      durability: taskIdentity.durability,
      confidence: Number(taskIdentity.confidence || 0),
      evidence: (taskIdentity.evidence || []).slice(0, 10),
    },
    confidence: Number(taskIdentity.confidence || 0),
    evidence: [
      ...(taskIdentity.evidence || []).slice(0, 10),
      `mode_reason=${modeResult.reason}`,
      `risk_level=${riskLevel}`,
    ],
    selectedSources: selection.selectedSources.map((item) => ({
      source: item.key,
      reason: item.reason,
      path: item.meta.path || item.meta.paths || null,
    })),
    excludedSources: selection.excludedSources,
    recommendedAction,
    recommendedCapability: recommendedCapability
      ? {
          name: recommendedCapability.name,
          path: recommendedCapability.path,
        }
      : null,
    generatedAt: new Date().toISOString(),
    applyResult,
  }

  saveJson(INTAKE_DECISION_PATH, decision)
  saveJson(SELECTED_CONTEXT_JSON_PATH, selectedContextJson)
  saveText(SELECTED_CONTEXT_MD_PATH, `${selectedContextMarkdown.trimEnd()}\n`)

  return {
    decision,
    selectedContextJson,
    selectedContextMarkdown,
  }
}

async function main() {
  const result = await runIntakeGate()
  const { decision } = result
  console.log(`intake mode: ${decision.intakeMode}`)
  console.log(`identity: ${decision.taskIdentity.domain} / ${decision.taskIdentity.scope} / ${decision.taskIdentity.durability}`)
  console.log(`confidence: ${decision.confidence}`)
  console.log(`selected source count: ${decision.selectedSources.length}`)
  console.log(`recommended action: ${decision.recommendedAction}`)
  console.log(`recommended capability: ${decision.recommendedCapability?.name || "none"}`)
  console.log(`runtime decision: ${INTAKE_DECISION_PATH}`)
  console.log(`selected context (md): ${SELECTED_CONTEXT_MD_PATH}`)
  console.log(`selected context (json): ${SELECTED_CONTEXT_JSON_PATH}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

export {
  classifyIntakeMode,
  buildTaskIdentity,
  inferRecommendedCapability,
  selectSources,
  buildSelectedContextJson,
  buildSelectedContextMarkdown,
  maybeApplyTaskAnchor,
  runIntakeGate,
}
