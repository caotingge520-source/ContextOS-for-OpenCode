#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  ANALYSIS_DIR,
  GUARD_PATH,
  JOURNAL_DIR,
  MEMORY_CORE_PATH,
  RESCUE_DIR,
  RESCUE_LATEST_DIR,
  SITUATION_MD_PATH,
  exportSession,
  extractMessages,
  extractRepeatedInstructions,
  filterSessionsByDays,
  htmlEscape,
  listSessions,
  loadTemplate,
  normalizeTextForMatch,
  readCurrentTaskAnchor,
  readTextIfExists,
  readArgs,
  sampleSessions,
  saveJson,
  saveText,
} from "./contextos-lib.mjs"

function parsePositiveInt(raw, fallback) {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

function parseDate(value) {
  const stamp = new Date(value)
  if (Number.isNaN(stamp.getTime())) return null
  return stamp
}

function hoursSince(value) {
  const stamp = parseDate(value)
  if (!stamp) return null
  return Math.round(((Date.now() - stamp.getTime()) / 3600000) * 10) / 10
}

function formatHours(value) {
  if (value == null) return "unknown"
  if (value < 1) return "<1h"
  if (value < 24) return `${Math.round(value)}h`
  return `${Math.round(value / 24)}d`
}

function normalizeRiskLevel(score) {
  if (score >= 70) return "red"
  if (score >= 40) return "yellow"
  return "green"
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function collectSessionWeights(sessions, options = {}) {
  const maxAttempts = parsePositiveInt(options.maxAttempts, sessions.length || 0)
  const exportTimeoutMs = parsePositiveInt(options.exportTimeoutMs, 8000)
  const shouldLogSkips = options.shouldLogSkips !== false

  const analyzed = []
  const skipped = []
  let attempts = 0

  for (const session of sessions) {
    if (attempts >= maxAttempts) {
      break
    }

    attempts += 1
    try {
      const exportData = exportSession(session.id, { timeoutMs: exportTimeoutMs })
      analyzed.push(analyzeSessionWeight(session, exportData))
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      skipped.push({ id: session.id, reason })
      if (shouldLogSkips) {
        const reasonPreview = reason ? reason.split("\n")[0].slice(0, 160) : "unknown"
        console.warn(`Skipped session ${session.id}: ${reasonPreview}`)
      }
    }
  }

  return { analyzed, skipped, attempts }
}

function analyzeSessionWeight(session, exportData) {
  const messages = extractMessages(exportData)
  const totalChars = messages.reduce((sum, msg) => sum + msg.text.length, 0)
  const userMessages = messages.filter((msg) => msg.role === "user").length
  const toolMessages = messages.filter((msg) => msg.role === "tool").length
  const assistantMessages = messages.filter((msg) => msg.role === "assistant").length

  const longMessages = messages
    .filter((msg) => msg.text.length > 2500)
    .map((msg) => ({
      role: msg.role,
      name: msg.name,
      chars: msg.text.length,
      preview: msg.text.slice(0, 180),
    }))
    .slice(0, 5)

  const activeFiles = new Set(
    messages
      .map((msg) => msg.raw?.info?.filePath || msg.raw?.filePath || msg.raw?.path)
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim()),
  )

  const repeatedReadPatterns = []
  const counts = new Map()
  for (const msg of messages) {
    const normalized = normalizeTextForMatch(msg.text)
    if (normalized.length < 50) continue
    const key = normalized.slice(0, 160)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  for (const [text, count] of counts.entries()) {
    if (count >= 2) {
      repeatedReadPatterns.push({ text, count })
    }
  }

  return {
    id: session.id,
    title: session.title,
    project: session.project,
    updatedAt: session.updatedAt || session.createdAt,
    messageCount: messages.length,
    userMessages,
    assistantMessages,
    toolMessages,
    totalChars,
    maxMessageChars: messages.reduce((max, msg) => Math.max(max, msg.text.length), 0),
    activeFiles: [...activeFiles].slice(0, 30),
    activeFilesCount: activeFiles.size,
    longMessages,
    repeatedReadPatterns: repeatedReadPatterns.slice(0, 3),
    messages,
  }
}

function summarizeSessionLoad(analyzed) {
  if (!analyzed.length) {
    return {
      sessionCount: 0,
      totalMessages: 0,
      totalChars: 0,
      averageMessages: 0,
      averageChars: 0,
      maxMessages: 0,
      maxChars: 0,
      averageToolDensity: 0,
      longOutputEvents: 0,
      noisyToolSessions: 0,
      uniqueActiveFiles: [],
      uniqueActiveFilesCount: 0,
    }
  }

  const totalMessages = analyzed.reduce((sum, session) => sum + session.messageCount, 0)
  const totalChars = analyzed.reduce((sum, session) => sum + session.totalChars, 0)
  const maxMessages = Math.max(...analyzed.map((session) => session.messageCount))
  const maxChars = Math.max(...analyzed.map((session) => session.totalChars))
  const longOutputEvents = analyzed.reduce((sum, session) => sum + session.longMessages.length, 0)
  const averageToolDensity = analyzed.reduce((sum, session) => {
    const density = session.messageCount ? session.toolMessages / session.messageCount : 0
    return sum + density
  }, 0) / analyzed.length
  const noisyToolSessions = analyzed.filter(
    (session) => session.messageCount >= 25 && session.toolMessages / Math.max(session.messageCount, 1) > 0.6,
  ).length
  const uniqueActiveFiles = [...new Set(analyzed.flatMap((session) => session.activeFiles))]

  return {
    sessionCount: analyzed.length,
    totalMessages,
    totalChars,
    averageMessages: Math.round(totalMessages / analyzed.length),
    averageChars: Math.round(totalChars / analyzed.length),
    maxMessages,
    maxChars,
    averageToolDensity: Number(averageToolDensity.toFixed(2)),
    longOutputEvents,
    noisyToolSessions,
    uniqueActiveFiles: uniqueActiveFiles.slice(0, 40),
    uniqueActiveFilesCount: uniqueActiveFiles.length,
  }
}

function getGuardStatus() {
  if (!fs.existsSync(GUARD_PATH)) {
    return {
      path: GUARD_PATH,
      exists: false,
      fresh: false,
      ageHours: null,
      updatedAt: null,
      status: "missing",
      hasCurrentTask: false,
      hasNextSteps: false,
      evidence: ["SESSION_GUARD.md not found"],
    }
  }

  const raw = fs.readFileSync(GUARD_PATH, "utf8")
  const stat = fs.statSync(GUARD_PATH)
  const updatedAt = stat.mtime.toISOString()
  const ageHours = hoursSince(updatedAt)
  const fresh = ageHours != null && ageHours <= 12
  const hasCurrentTask = /##\s*Current task/i.test(raw)
  const hasNextSteps = /##\s*Next 3 steps/i.test(raw) || /next steps/i.test(raw)

  return {
    path: GUARD_PATH,
    exists: true,
    fresh,
    ageHours,
    updatedAt,
    status: fresh ? "fresh" : "stale",
    hasCurrentTask,
    hasNextSteps,
    evidence: [
      `guard_age=${formatHours(ageHours)}`,
      hasCurrentTask ? "contains current task section" : "missing current task section",
      hasNextSteps ? "contains next steps" : "missing next steps",
    ],
  }
}

function getTaskAnchorSummary(analyzed) {
  const anchor = readCurrentTaskAnchor()
  if (!anchor) {
    return {
      path: path.join(process.cwd(), ".contextos", "tasks", "current-task.yaml"),
      exists: false,
      fresh: false,
      ageHours: null,
      driftDetected: true,
      driftEvidence: ["current-task.yaml missing"],
      domain: null,
      scope: null,
      durability: null,
      summary: "",
      updatedAt: null,
      activeFiles: [],
    }
  }

  const ageHours = hoursSince(anchor.updated_at)
  const fresh = ageHours != null && ageHours <= 24
  const anchorFiles = Array.isArray(anchor.active_files) ? anchor.active_files.filter(Boolean) : []
  const recentFiles = new Set(analyzed.flatMap((session) => session.activeFiles))
  const overlapCount = anchorFiles.filter((file) => recentFiles.has(file)).length
  const driftDetected = !fresh || (anchorFiles.length > 0 && overlapCount === 0)

  const driftEvidence = []
  if (!fresh) {
    driftEvidence.push(`task_anchor_age=${formatHours(ageHours)}`)
  }
  if (!anchor.summary || String(anchor.summary).trim().length < 8) {
    driftEvidence.push("task anchor summary too short")
  }
  if (anchorFiles.length > 0 && overlapCount === 0) {
    driftEvidence.push("anchor active_files do not match recent session files")
  }
  if (!driftEvidence.length) {
    driftEvidence.push("task anchor aligns with recent session context")
  }

  return {
    path: path.join(process.cwd(), ".contextos", "tasks", "current-task.yaml"),
    exists: true,
    fresh,
    ageHours,
    driftDetected,
    driftEvidence,
    domain: anchor.domain,
    scope: anchor.scope,
    durability: anchor.durability,
    summary: anchor.summary || "",
    updatedAt: anchor.updated_at || null,
    activeFiles: anchorFiles,
  }
}

function getRescueReadiness() {
  const indexPath = path.join(RESCUE_DIR, "index.md")
  const latestSnapshotPath = path.join(RESCUE_LATEST_DIR, "latest-snapshot.json")
  const restoreSummaryPath = path.join(RESCUE_LATEST_DIR, "restore-summary.md")
  const continuePromptPath = path.join(RESCUE_LATEST_DIR, "continue-prompt.md")
  if (!fs.existsSync(RESCUE_DIR)) {
    return {
      path: RESCUE_DIR,
      ready: false,
      snapshotCount: 0,
      latestSnapshotAgeHours: null,
      latestSnapshotId: null,
      hasIndex: false,
      hasLatestBundle: false,
      evidence: ["rescue directory missing"],
    }
  }

  const files = fs.readdirSync(RESCUE_DIR)
  const snapshotFiles = files.filter((name) => name.endsWith(".json"))
  const snapshots = snapshotFiles
    .map((name) => {
      const filePath = path.join(RESCUE_DIR, name)
      const stat = fs.statSync(filePath)
      return {
        name,
        mtime: stat.mtime,
      }
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

  const latest = snapshots[0] || null
  const latestSnapshotJson = readJsonIfExists(latestSnapshotPath)
  const latestAgeHours = latestSnapshotJson?.generatedAt
    ? hoursSince(latestSnapshotJson.generatedAt)
    : latest
      ? hoursSince(latest.mtime.toISOString())
      : null
  const hasLatestBundle = fs.existsSync(latestSnapshotPath)
    && fs.existsSync(restoreSummaryPath)
    && fs.existsSync(continuePromptPath)
  const ready = snapshotFiles.length > 0 && hasLatestBundle && latestAgeHours != null && latestAgeHours <= 72

  return {
    path: RESCUE_DIR,
    ready,
    snapshotCount: snapshotFiles.length,
    latestSnapshotAgeHours: latestAgeHours,
    latestSnapshotId: latest?.name || null,
    hasIndex: fs.existsSync(indexPath),
    hasLatestBundle,
    evidence: [
      `snapshot_count=${snapshotFiles.length}`,
      `latest_snapshot_age=${formatHours(latestAgeHours)}`,
      hasLatestBundle ? "rescue latest helper bundle exists" : "rescue latest helper bundle missing",
      fs.existsSync(indexPath) ? "rescue index exists" : "rescue index missing",
    ],
  }
}

function extractInsightsSummary() {
  const insightsPath = path.join(ANALYSIS_DIR, "insights.json")
  const insights = readJsonIfExists(insightsPath)
  if (!insights) {
    return {
      exists: false,
      path: insightsPath,
      repeatedInstructionCount: 0,
      topRepeatedInstructionCount: 0,
      frictionRate: null,
      evidence: ["insights.json not found"],
    }
  }

  const repeatedInstructions = Array.isArray(insights.repeatedInstructions) ? insights.repeatedInstructions : []
  const topRepeatedInstructionCount = repeatedInstructions[0]?.count || 0

  return {
    exists: true,
    path: insightsPath,
    repeatedInstructionCount: repeatedInstructions.length,
    topRepeatedInstructionCount,
    frictionRate: insights.meta?.frictionRate || null,
    evidence: [
      `insights repeated instruction groups=${repeatedInstructions.length}`,
      `top repeated instruction count=${topRepeatedInstructionCount}`,
      `insights friction rate=${insights.meta?.frictionRate || "unknown"}`,
    ],
  }
}

function getSituationStatus() {
  const text = readTextIfExists(SITUATION_MD_PATH, "")
  const nonEmpty = text.trim().length > 0
  return {
    path: SITUATION_MD_PATH,
    exists: nonEmpty,
    length: text.trim().length,
    preview: text.split(/\r?\n/).filter(Boolean).slice(0, 12),
  }
}

function getMemoryStatus() {
  const text = readTextIfExists(MEMORY_CORE_PATH, "")
  const nonEmpty = text.trim().length > 0
  const insightBullets = text.split(/\r?\n/).filter((line) => /^[-*]\s+/.test(line.trim()))
  return {
    path: MEMORY_CORE_PATH,
    exists: nonEmpty,
    insightCount: insightBullets.length,
    preview: text.split(/\r?\n/).filter(Boolean).slice(0, 12),
  }
}

function getJournalStatus() {
  if (!fs.existsSync(JOURNAL_DIR)) {
    return {
      path: JOURNAL_DIR,
      exists: false,
      fileCount: 0,
      latestAt: null,
      latestAgeHours: null,
    }
  }

  const files = fs.readdirSync(JOURNAL_DIR).filter((name) => name.endsWith(".json"))
  if (!files.length) {
    return {
      path: JOURNAL_DIR,
      exists: true,
      fileCount: 0,
      latestAt: null,
      latestAgeHours: null,
    }
  }

  const latest = files
    .map((name) => {
      const stat = fs.statSync(path.join(JOURNAL_DIR, name))
      return { name, mtime: stat.mtime.toISOString() }
    })
    .sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime())[0]

  return {
    path: JOURNAL_DIR,
    exists: true,
    fileCount: files.length,
    latestAt: latest.mtime,
    latestAgeHours: hoursSince(latest.mtime),
  }
}

function buildSignal(id, label, maxScore, rawScore, evidence, metrics = {}) {
  const contribution = clamp(Math.round(rawScore), 0, maxScore)
  const normalized = Math.round((contribution / maxScore) * 100)
  return {
    id,
    label,
    score: contribution,
    maxScore,
    normalized,
    level: normalizeRiskLevel(normalized),
    evidence,
    metrics,
  }
}

function computeRiskAssessment(input) {
  const {
    sessionLoad,
    analyzed,
    repeatedInstructions,
    insightsSummary,
    guardStatus,
    taskAnchorSummary,
    rescueReadiness,
  } = input

  const topRepeatedCount = repeatedInstructions[0]?.count || 0
  const repeatedGroups = repeatedInstructions.length
  const repeatedWithinSession = analyzed.filter((session) => session.repeatedReadPatterns.length > 0).length

  const workloadRaw =
    (sessionLoad.maxMessages >= 180 ? 10 : sessionLoad.maxMessages >= 120 ? 7 : sessionLoad.maxMessages >= 80 ? 4 : 1)
    + (sessionLoad.maxChars >= 900000 ? 10 : sessionLoad.maxChars >= 500000 ? 7 : sessionLoad.maxChars >= 250000 ? 4 : 1)

  const longOutputRaw =
    (sessionLoad.longOutputEvents >= 30 ? 8 : sessionLoad.longOutputEvents >= 15 ? 5 : sessionLoad.longOutputEvents >= 6 ? 3 : 1)
    + (sessionLoad.maxChars >= 700000 ? 6 : sessionLoad.maxChars >= 350000 ? 4 : 2)

  const repeatedRaw =
    (topRepeatedCount >= 5 ? 7 : topRepeatedCount >= 3 ? 5 : topRepeatedCount >= 2 ? 3 : 1)
    + (repeatedGroups >= 4 ? 5 : repeatedGroups >= 2 ? 3 : 1)
    + (repeatedWithinSession >= 4 ? 2 : repeatedWithinSession >= 2 ? 1 : 0)

  const guardRaw = !guardStatus.exists
    ? 14
    : !guardStatus.fresh
      ? 9
      : guardStatus.hasCurrentTask && guardStatus.hasNextSteps
        ? 2
        : 5

  const taskDriftRaw = !taskAnchorSummary.exists
    ? 12
    : taskAnchorSummary.driftDetected
      ? 8
      : taskAnchorSummary.fresh
        ? 2
        : 5

  const activeFileRaw =
    (sessionLoad.uniqueActiveFilesCount >= 30 ? 6 : sessionLoad.uniqueActiveFilesCount >= 18 ? 4 : sessionLoad.uniqueActiveFilesCount >= 10 ? 2 : 1)
    + (analyzed.some((session) => session.activeFilesCount >= 12) ? 4 : analyzed.some((session) => session.activeFilesCount >= 7) ? 2 : 0)

  const toolNoiseRaw =
    (sessionLoad.averageToolDensity >= 0.7 ? 6 : sessionLoad.averageToolDensity >= 0.5 ? 4 : sessionLoad.averageToolDensity >= 0.35 ? 2 : 1)
    + (sessionLoad.noisyToolSessions >= 4 ? 4 : sessionLoad.noisyToolSessions >= 2 ? 2 : 0)

  const compactionRaw =
    (workloadRaw >= 14 ? 4 : workloadRaw >= 10 ? 3 : 1)
    + (guardRaw >= 9 ? 2 : 0)
    + (taskDriftRaw >= 8 ? 1 : 0)
    + (!rescueReadiness.ready ? 1 : 0)

  const signals = [
    buildSignal(
      "session_load",
      "Session 负载压力",
      20,
      workloadRaw,
      [
        `max_messages=${sessionLoad.maxMessages}`,
        `max_chars=${sessionLoad.maxChars}`,
        `avg_messages=${sessionLoad.averageMessages}`,
      ],
      {
        maxMessages: sessionLoad.maxMessages,
        maxChars: sessionLoad.maxChars,
        averageMessages: sessionLoad.averageMessages,
      },
    ),
    buildSignal(
      "long_output",
      "长文本/大工具输出",
      14,
      longOutputRaw,
      [
        `long_output_events=${sessionLoad.longOutputEvents}`,
        `max_session_chars=${sessionLoad.maxChars}`,
      ],
      {
        longOutputEvents: sessionLoad.longOutputEvents,
        maxChars: sessionLoad.maxChars,
      },
    ),
    buildSignal(
      "repeated_instructions",
      "重复指令堆叠",
      12,
      repeatedRaw,
      [
        `repeated_groups=${repeatedGroups}`,
        `top_repeated_count=${topRepeatedCount}`,
        `within_session_repeats=${repeatedWithinSession}`,
        ...insightsSummary.evidence,
      ],
      {
        repeatedGroups,
        topRepeatedCount,
      },
    ),
    buildSignal(
      "guard_freshness",
      "Guard 快照新鲜度",
      14,
      guardRaw,
      guardStatus.evidence,
      {
        exists: guardStatus.exists,
        fresh: guardStatus.fresh,
        ageHours: guardStatus.ageHours,
      },
    ),
    buildSignal(
      "task_anchor_alignment",
      "当前任务锚点对齐度",
      12,
      taskDriftRaw,
      taskAnchorSummary.driftEvidence,
      {
        exists: taskAnchorSummary.exists,
        fresh: taskAnchorSummary.fresh,
        driftDetected: taskAnchorSummary.driftDetected,
      },
    ),
    buildSignal(
      "active_files_sprawl",
      "活跃文件扩张",
      10,
      activeFileRaw,
      [
        `unique_active_files=${sessionLoad.uniqueActiveFilesCount}`,
        `max_active_files_in_session=${Math.max(0, ...analyzed.map((session) => session.activeFilesCount || 0))}`,
      ],
      {
        uniqueActiveFilesCount: sessionLoad.uniqueActiveFilesCount,
      },
    ),
    buildSignal(
      "tool_noise_density",
      "工具调用噪声密度",
      10,
      toolNoiseRaw,
      [
        `average_tool_density=${sessionLoad.averageToolDensity}`,
        `noisy_tool_sessions=${sessionLoad.noisyToolSessions}`,
      ],
      {
        averageToolDensity: sessionLoad.averageToolDensity,
        noisyToolSessions: sessionLoad.noisyToolSessions,
      },
    ),
    buildSignal(
      "compaction_proximity",
      "Compaction 临近风险",
      8,
      compactionRaw,
      [
        `workload_component=${workloadRaw}`,
        `guard_component=${guardRaw}`,
        `task_component=${taskDriftRaw}`,
        rescueReadiness.ready ? "rescue_ready=true" : "rescue_ready=false",
      ],
      {
        rescueReady: rescueReadiness.ready,
      },
    ),
  ]

  const score = clamp(signals.reduce((sum, signal) => sum + signal.score, 0), 0, 100)
  const riskLevel = normalizeRiskLevel(score)
  const topRiskSources = [...signals].sort((a, b) => b.score - a.score).slice(0, 3)

  return {
    riskLevel,
    score,
    signals,
    topRiskSources,
  }
}

function pickSignal(signals, id) {
  return signals.find((signal) => signal.id === id) || { score: 0, maxScore: 1, evidence: [] }
}

function buildCategoryRisk(category, score, evidence, recommendedAction) {
  const normalized = clamp(Math.round(score), 0, 100)
  return {
    riskCategory: category,
    riskLevel: normalizeRiskLevel(normalized),
    score: normalized,
    evidence: evidence.filter(Boolean).slice(0, 5),
    recommendedAction,
  }
}

function computeRiskCategories(input) {
  const {
    assessment,
    guardStatus,
    taskAnchorSummary,
    rescueReadiness,
    situationStatus,
    memoryStatus,
    journalStatus,
    repeatedInstructions,
  } = input

  const sessionLoad = pickSignal(assessment.signals, "session_load")
  const longOutput = pickSignal(assessment.signals, "long_output")
  const repeated = pickSignal(assessment.signals, "repeated_instructions")
  const guard = pickSignal(assessment.signals, "guard_freshness")
  const task = pickSignal(assessment.signals, "task_anchor_alignment")
  const activeFiles = pickSignal(assessment.signals, "active_files_sprawl")
  const toolNoise = pickSignal(assessment.signals, "tool_noise_density")
  const compaction = pickSignal(assessment.signals, "compaction_proximity")

  const contextFade = buildCategoryRisk(
    "context_fade",
    guard.normalized * 0.45 + task.normalized * 0.35 + compaction.normalized * 0.2,
    [
      ...guard.evidence,
      ...task.evidence,
      rescueReadiness.ready ? "rescue latest is ready" : "rescue latest missing or stale",
    ],
    !guardStatus.exists || !guardStatus.fresh
      ? "先刷新 guard"
      : !rescueReadiness.ready
        ? "先生成 rescue snapshot"
        : "先收束当前任务范围",
  )

  const contextPollution = buildCategoryRisk(
    "context_pollution",
    repeated.normalized * 0.45 + toolNoise.normalized * 0.35 + longOutput.normalized * 0.2,
    [
      ...repeated.evidence,
      ...toolNoise.evidence,
      repeatedInstructions.length ? `repeatedInstructionGroups=${repeatedInstructions.length}` : "repeatedInstructionGroups=0",
    ],
    repeated.score >= toolNoise.score ? "先把重复约束沉淀成规则" : "先摘要长输出",
  )

  const knowledgeBottleneck = buildCategoryRisk(
    "knowledge_bottleneck",
    (memoryStatus.exists ? 20 : 70)
      + (memoryStatus.insightCount >= 3 ? 0 : 15)
      + (situationStatus.exists ? 10 : 30)
      + (!taskAnchorSummary.summary || taskAnchorSummary.summary.length < 24 ? 15 : 0)
      + (journalStatus.exists && journalStatus.fileCount > 0 ? 5 : 20),
    [
      memoryStatus.exists ? `memory_core_insights=${memoryStatus.insightCount}` : "memory core missing",
      situationStatus.exists ? `situation_length=${situationStatus.length}` : "situation.md missing",
      journalStatus.exists ? `journal_entries=${journalStatus.fileCount}` : "journal missing",
      taskAnchorSummary.summary ? `task_summary_length=${taskAnchorSummary.summary.length}` : "task summary missing",
    ],
    !memoryStatus.exists ? "先补齐 memory/core.md 核心发现" : "先更新 situation.md 并收敛任务上下文",
  )

  const contextOverload = buildCategoryRisk(
    "context_overload",
    sessionLoad.normalized * 0.45 + longOutput.normalized * 0.25 + activeFiles.normalized * 0.2 + toolNoise.normalized * 0.1,
    [
      ...sessionLoad.evidence,
      ...longOutput.evidence,
      ...activeFiles.evidence,
    ],
    "先暂停继续扩张上下文",
  )

  return [contextFade, contextPollution, knowledgeBottleneck, contextOverload]
}

function buildRuntimeRecommendations(context) {
  const {
    assessment,
    guardStatus,
    rescueReadiness,
    repeatedInstructions,
  } = context

  const top = assessment.topRiskSources[0]
  const topIDs = new Set(assessment.topRiskSources.map((signal) => signal.id))

  const immediate = {
    priority: "immediate",
    title: "先收束当前任务范围",
    reason: "最高风险来源表明会话已进入高负载，先降复杂度才能保住上下文连续性。",
    when: `risk=${assessment.riskLevel}`,
  }

  if (!guardStatus.exists || !guardStatus.fresh) {
    immediate.title = "先刷新 guard"
    immediate.reason = "SESSION_GUARD 不存在或已过期，继续扩张上下文会显著增加 compaction 后失真风险。"
    immediate.when = `guard_status=${guardStatus.status}`
  } else if (!rescueReadiness.ready) {
    immediate.title = "先生成 rescue snapshot"
    immediate.reason = "当前 rescue 准备不足，先补救援快照再继续推进可以降低恢复成本。"
    immediate.when = "rescue_ready=false"
  } else if (top?.id === "long_output") {
    immediate.title = "先摘要长输出"
    immediate.reason = "长文本堆积正在拉高上下文税，先将超长输出提炼为结论与决策。"
    immediate.when = "long_output_pressure_high"
  } else if (top?.id === "repeated_instructions") {
    immediate.title = "先把重复约束沉淀成规则"
    immediate.reason = "重复指令持续出现，继续口头重复会让会话噪声持续放大。"
    immediate.when = "repeated_instruction_stack"
  }

  const followups = []
  followups.push({
    priority: "follow_up",
    title: "先暂停继续扩张上下文",
    reason: "在风险恢复到 yellow/green 前，避免新增并行支线与大段原文搬运。",
  })

  if (topIDs.has("task_anchor_alignment")) {
    followups.push({
      priority: "follow_up",
      title: "先收束当前任务范围",
      reason: "current-task 锚点与最近会话可能脱节，先统一目标/边界/下一步。",
    })
  }

  if (topIDs.has("repeated_instructions") || repeatedInstructions.length > 0) {
    followups.push({
      priority: "follow_up",
      title: "先把重复约束沉淀成规则",
      reason: "将高频重复指令固定到 AGENTS 或 skill，减少上下文反复解释成本。",
    })
  }

  if (topIDs.has("long_output") || topIDs.has("session_load")) {
    followups.push({
      priority: "follow_up",
      title: "先摘要长输出",
      reason: "把长工具输出改为结论+决策摘要，避免下一轮继续携带历史负担。",
    })
  }

  if (!rescueReadiness.ready) {
    followups.push({
      priority: "follow_up",
      title: "先生成 rescue snapshot",
      reason: "建立恢复锚点，防止发生 compaction 或导出异常时无法回溯。",
    })
  }

  if (!guardStatus.exists || !guardStatus.fresh) {
    followups.push({
      priority: "follow_up",
      title: "先刷新 guard",
      reason: "更新 SESSION_GUARD 让关键目标跨压缩可持续。",
    })
  }

  const dedup = new Map()
  for (const item of [immediate, ...followups]) {
    if (!dedup.has(item.title)) {
      dedup.set(item.title, item)
    }
  }

  const ordered = [...dedup.values()]
  return {
    immediateAction: ordered[0],
    followUpActions: ordered.slice(1, 4),
    recommendations: ordered.slice(0, 4),
  }
}

function renderSignalList(signals) {
  return signals
    .map((signal) => {
      const evidence = signal.evidence.slice(0, 3).map((item) => `<li>${htmlEscape(item)}</li>`).join("")
      return `<div class="signal ${signal.level}"><h4>${htmlEscape(signal.label)} <span>${signal.score}/${signal.maxScore}</span></h4><ul>${evidence}</ul></div>`
    })
    .join("\n")
}

function renderRecommendationsBlock(recommendations) {
  return recommendations
    .map((item, index) => `<li><strong>${index + 1}. ${htmlEscape(item.title)}</strong> - ${htmlEscape(item.reason)}</li>`)
    .join("\n")
}

function renderTopRiskBlock(topRiskSources) {
  return topRiskSources
    .map((signal) => `<li><strong>${htmlEscape(signal.label)}</strong> (${signal.score}/${signal.maxScore}) - ${htmlEscape(signal.evidence[0] || "")}</li>`)
    .join("\n")
}

function renderCategoryBlock(categories) {
  return categories
    .map((item) => {
      const evidence = item.evidence.slice(0, 3).map((line) => `<li>${htmlEscape(line)}</li>`).join("")
      return `<li><strong>${htmlEscape(item.riskCategory)}</strong> · ${item.riskLevel.toUpperCase()} (${item.score})<br/><span>${htmlEscape(item.recommendedAction)}</span><ul>${evidence}</ul></li>`
    })
    .join("\n")
}

function fillReportTemplate(template, report) {
  const replacements = {
    "__GENERATED_AT__": report.generatedAt,
    "__RISK_LEVEL__": report.riskLevel.toUpperCase(),
    "__RISK_LEVEL_CLASS__": report.riskLevel,
    "__RISK_SCORE__": String(report.score),
    "__RISK_CATEGORY__": report.riskCategory,
    "__SCANNED_SESSIONS__": String(report.scannedSessions),
    "__TOTAL_MESSAGES__": String(report.sessionLoad.totalMessages),
    "__TOTAL_CHARS__": String(report.sessionLoad.totalChars),
    "__MAX_MESSAGES__": String(report.sessionLoad.maxMessages),
    "__MAX_CHARS__": String(report.sessionLoad.maxChars),
    "__TOP_RISK_SOURCES__": renderTopRiskBlock(report.topRiskSources),
    "__RISK_CATEGORIES__": renderCategoryBlock(report.riskCategories),
    "__IMMEDIATE_ACTION__": `${htmlEscape(report.recommendations[0]?.title || "none")} - ${htmlEscape(report.recommendations[0]?.reason || "")}`,
    "__FOLLOW_UP_ACTIONS__": renderRecommendationsBlock(report.recommendations.slice(1, 4)),
    "__SIGNALS__": renderSignalList(report.signals),
    "__GUARD_STATUS__": `${report.guardStatus.status} (${report.guardStatus.exists ? formatHours(report.guardStatus.ageHours) : "missing"})`,
    "__TASK_STATUS__": report.taskAnchorSummary.exists
      ? `${report.taskAnchorSummary.driftDetected ? "drifting" : "aligned"} (${formatHours(report.taskAnchorSummary.ageHours)})`
      : "missing",
    "__RESCUE_STATUS__": report.rescueReadiness.ready
      ? `ready (${report.rescueReadiness.snapshotCount} snapshots)`
      : `not-ready (${report.rescueReadiness.snapshotCount} snapshots)`,
    "__MEMORY_STATUS__": report.memoryStatus.exists
      ? `ready (insights=${report.memoryStatus.insightCount})`
      : "missing",
    "__JOURNAL_STATUS__": report.journalStatus.exists
      ? `entries=${report.journalStatus.fileCount}, latest=${formatHours(report.journalStatus.latestAgeHours)}`
      : "missing",
  }

  let output = template
  for (const [needle, value] of Object.entries(replacements)) {
    output = output.replaceAll(needle, String(value))
  }
  const leftovers = output.match(/__[A-Z0-9_]+__/g)
  if (leftovers?.length) {
    throw new Error(`Context budget template placeholders unresolved: ${[...new Set(leftovers)].join(", ")}`)
  }
  return output
}

function buildReportPayload(data) {
  const {
    days,
    analyzed,
    repeatedInstructions,
    heaviestSessions,
    noisySessions,
    skipped,
    attempts,
    insightsSummary,
    guardStatus,
    taskAnchorSummary,
    rescueReadiness,
    situationStatus,
    memoryStatus,
    journalStatus,
  } = data

  const sessionLoad = summarizeSessionLoad(analyzed)
  const assessment = computeRiskAssessment({
    sessionLoad,
    analyzed,
    repeatedInstructions,
    insightsSummary,
    guardStatus,
    taskAnchorSummary,
    rescueReadiness,
  })
  const recommendationBundle = buildRuntimeRecommendations({
    assessment,
    guardStatus,
    rescueReadiness,
    repeatedInstructions,
  })
  const categoryRisks = computeRiskCategories({
    assessment,
    guardStatus,
    taskAnchorSummary,
    rescueReadiness,
    situationStatus,
    memoryStatus,
    journalStatus,
    repeatedInstructions,
  })
  const topCategoryRisk = [...categoryRisks].sort((a, b) => b.score - a.score)[0]

  return {
    generatedAt: new Date().toISOString(),
    days,
    scannedSessions: analyzed.length,
    attemptedExports: attempts,
    skippedSessions: skipped.length,
    riskLevel: assessment.riskLevel,
    score: assessment.score,
    riskCategory: topCategoryRisk.riskCategory,
    riskCategories: categoryRisks,
    signals: assessment.signals,
    topRiskSources: assessment.topRiskSources,
    recommendations: recommendationBundle.recommendations,
    immediateAction: recommendationBundle.immediateAction,
    followUpActions: recommendationBundle.followUpActions,
    sessionLoad,
    heaviestSessions,
    noisySessions,
    repeatedInstructions,
    taskAnchorSummary,
    situationStatus,
    guardStatus,
    rescueReadiness,
    journalStatus,
    memoryStatus,
    insightsSummary,
  }
}

async function main() {
  const args = readArgs()
  const days = Number(args.days || 14)
  const maxCount = Number(args["max-count"] || 80)
  const maxExportAttempts = parsePositiveInt(args["max-export-attempts"], 24)
  const exportTimeoutMs = parsePositiveInt(args["export-timeout-ms"], 8000)

  const sessions = sampleSessions(filterSessionsByDays(listSessions({ maxCount }), days), 20)
  const { analyzed, skipped, attempts } = collectSessionWeights(sessions, {
    maxAttempts: maxExportAttempts,
    exportTimeoutMs,
  })

  if (!skipped.length && !analyzed.length) {
    throw new Error("No sessions available for context budget analysis.")
  }

  if (!analyzed.length) {
    const summary = skipped
      .slice(0, 4)
      .map((item) => `${item.id}: ${item.reason.split("\n")[0]}`)
      .join(" | ")
    throw new Error(`No sessions could be analyzed after ${attempts} export attempts; ${skipped.length} sessions were skipped. ${summary ? `Examples: ${summary}` : ""}`)
  }

  const repeatedInstructions = extractRepeatedInstructions(analyzed, 2)
  const guardStatus = getGuardStatus()
  const taskAnchorSummary = getTaskAnchorSummary(analyzed)
  const rescueReadiness = getRescueReadiness()
  const insightsSummary = extractInsightsSummary()
  const situationStatus = getSituationStatus()
  const memoryStatus = getMemoryStatus()
  const journalStatus = getJournalStatus()

  const heaviestSessions = [...analyzed]
    .sort((a, b) => b.totalChars - a.totalChars)
    .slice(0, 5)
    .map((session) => ({
      ...session,
      messages: undefined,
    }))

  const noisySessions = analyzed
    .filter((session) => session.repeatedReadPatterns.length > 0 || session.longMessages.length > 0)
    .slice(0, 10)
    .map((session) => ({
      ...session,
      messages: undefined,
    }))

  const report = buildReportPayload({
    days,
    analyzed,
    repeatedInstructions,
    heaviestSessions,
    noisySessions,
    skipped,
    attempts,
    insightsSummary,
    guardStatus,
    taskAnchorSummary,
    rescueReadiness,
    situationStatus,
    memoryStatus,
    journalStatus,
  })

  const jsonPath = path.join(ANALYSIS_DIR, "context-budget.json")
  const htmlPath = path.join(ANALYSIS_DIR, "context-budget-report.html")
  const templatePath = path.join(process.cwd(), "templates", "context-budget-report.html")

  saveJson(jsonPath, report)
  const template = loadTemplate(templatePath)
  saveText(htmlPath, fillReportTemplate(template, report))

  console.log(`当前风险等级：${report.riskLevel.toUpperCase()} (${report.score}/100)`)
  console.log(`最高风险类别：${report.riskCategory}`)
  console.log(`最高风险来源：${report.topRiskSources[0]?.label || "none"}`)
  console.log(`最推荐动作：${report.immediateAction?.title || "none"}`)
  console.log("建议动作：")
  report.recommendations.slice(0, 3).forEach((item, index) => {
    console.log(`${index + 1}. ${item.title} — ${item.reason}`)
  })
  console.log(`输出文件：${jsonPath}`)
  console.log(`HTML 报告：${htmlPath}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

export {
  analyzeSessionWeight,
  summarizeSessionLoad,
  computeRiskAssessment,
  computeRiskCategories,
  buildRuntimeRecommendations,
  buildReportPayload,
  normalizeRiskLevel,
}
