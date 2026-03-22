#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  ANALYSIS_DIR,
  OUTPUT_ROOT,
  ROOT,
  classifyOutcome,
  classifyTask,
  inferTaskIdentityRouting,
  countBy,
  dailyActivity,
  detectFriction,
  exportSession,
  extractMessages,
  extractRepeatedInstructions,
  extractToolNames,
  filterSessionsByDays,
  formatDateRange,
  formatPct,
  htmlEscape,
  byHourHeatmap,
  listSessions,
  loadTemplate,
  normalizeTextForMatch,
  readArgs,
  renderList,
  sampleSessions,
  satisfactionTrend,
  saveJson,
  saveText,
  summarizeProjects,
  topN,
} from "./contextos-lib.mjs"

function toISOStringSafe(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function inferAgent(messages, fallbackAgent) {
  const candidateLog = []

  const addCandidate = (source, agent, reason) => {
    if (!agent) return
    const value = String(agent).trim()
    if (!value) return
    candidateLog.push({ source, reason, value })
    if (value && value !== "tool") {
      return value
    }
    return null
  }

  const fromSession = addCandidate("session-list", fallbackAgent, "session.agent")
  if (fromSession) {
    return {
      value: fromSession,
      source: "session-list",
      evidence: candidateLog,
    }
  }

  for (const message of messages) {
    const candidates = [
      ["message.agent", message?.agent, "message.agent"],
      ["message.raw.agent", message?.raw?.agent, "message.raw.agent"],
      ["message.raw.info.agent", message?.raw?.info?.agent, "message.raw.info.agent"],
      ["message.mode", message?.raw?.mode, "message.raw.mode"],
      ["message.raw.info.mode", message?.raw?.info?.mode, "message.raw.info.mode"],
    ]

    for (const [source, value, reason] of candidates) {
      const found = addCandidate(source, value, reason)
      if (found) {
        return {
          value: found,
          source,
          evidence: candidateLog,
        }
      }
    }
  }

  return {
    value: "unknown-agent",
    source: "fallback",
    evidence: candidateLog,
  }
}

function inferDate(valueSources, label, options = {}) {
  const diagnostics = {
    label,
    attempts: [],
    parsed: 0,
    invalid: 0,
    sampledValues: [],
    sampleLimit: options.sampleLimit ?? 6,
  }

  for (const candidate of valueSources) {
    const raw = candidate.value
    const parsed = toISOStringSafe(raw)
    const entry = {
      source: candidate.source,
      raw: raw == null ? null : String(raw).slice(0, 200),
      parsed: !!parsed,
      candidate: candidate.label || candidate.source,
    }
    diagnostics.attempts.push(entry)

    if (parsed) {
      diagnostics.parsed += 1
      return {
        value: parsed,
        selectedSource: candidate.source,
        selectedCandidate: candidate.label || candidate.source,
        diagnostics,
      }
    }

    diagnostics.invalid += 1
    if (diagnostics.sampledValues.length < diagnostics.sampleLimit) {
      diagnostics.sampledValues.push(entry)
    }
  }

  return {
    value: null,
    selectedSource: null,
    selectedCandidate: null,
    diagnostics,
  }
}

function analyzeSession(session, exportData) {
  const messages = extractMessages(exportData)
    .map((msg) => ({
      ...msg,
      text: msg.text.replace(/\u0000/g, "").trim(),
    }))
    .filter((msg) => msg.text || msg.name)

  const userRequest = messages.find((msg) => msg.role === "user")?.text || ""
  const activeFiles = [...new Set(
    messages
      .map((msg) => msg.raw?.info?.filePath || msg.raw?.filePath || msg.raw?.path)
      .filter((value) => typeof value === "string" && value.trim()),
  )]
  const recentCommands = [
    ...messages
      .filter((msg) => msg.role === "tool" && msg.name)
      .map((msg) => String(msg.name || "").trim())
      .filter(Boolean),
    ...messages
      .filter((msg) => msg.role === "assistant" && /^\//.test(msg.text))
      .map((msg) => msg.text.split(/\s+/)[0])
      .filter(Boolean),
  ]

  const taskIdentity = inferTaskIdentityRouting({
    userRequest,
    recentMessages: messages,
    activeFiles,
    recentCommands,
    cwd: session.project || ROOT,
  })

  const taskDiagnostics = classifyTask(messages, { includeDiagnostics: true })
  const outcomeDiagnostics = classifyOutcome(messages, { includeDiagnostics: true })
  const task = taskDiagnostics.label
  const outcome = outcomeDiagnostics.label
  const frictions = detectFriction(messages, { includeDiagnostics: true })
  const toolNames = extractToolNames(messages)
  const totalChars = messages.reduce((sum, msg) => sum + msg.text.length, 0)
  const userMessages = messages.filter((msg) => msg.role === "user").length
  const inferredAgent = inferAgent(messages, session.agent)
  const inferredCreatedAt = inferDate(
    [
      { source: "session.createdAt", value: session.createdAt, label: "session.createdAt" },
      { source: "export.info.time.created", value: exportData?.info?.time?.created, label: "export.info.time.created" },
      { source: "export.createdAt", value: exportData?.createdAt, label: "export.createdAt" },
      { source: "export.info.time.created.fallback", value: exportData?.info?.time?.createdAt, label: "export.info.time.createdAt" },
      { source: "session.raw.createdAt", value: exportData?.raw?.createdAt, label: "export.raw.createdAt" },
    ],
    "createdAt",
  )
  const inferredUpdatedAt = inferDate(
    [
      { source: "session.updatedAt", value: session.updatedAt, label: "session.updatedAt" },
      { source: "export.info.time.updated", value: exportData?.info?.time?.updated, label: "export.info.time.updated" },
      { source: "export.info.time.updatedAt", value: exportData?.info?.time?.updatedAt, label: "export.info.time.updatedAt" },
      { source: "export.updatedAt", value: exportData?.updatedAt, label: "export.updatedAt" },
      { source: "session.raw.updatedAt", value: exportData?.raw?.updatedAt, label: "export.raw.updatedAt" },
    ],
    "updatedAt",
  )
  const inferredProject = session.project || exportData?.info?.directory || exportData?.directory || "unknown-project"

  return {
    ...session,
    taskIdentity,
    agent: inferredAgent.value,
    project: inferredProject,
    createdAt: inferredCreatedAt.value,
    updatedAt: inferredUpdatedAt.value,
    createdAtDiagnostics: inferredCreatedAt.diagnostics,
    updatedAtDiagnostics: inferredUpdatedAt.diagnostics,
    createdAtSource: inferredCreatedAt.selectedSource,
    updatedAtSource: inferredUpdatedAt.selectedSource,
    task,
    outcome,
    taskDiagnostics,
    outcomeDiagnostics,
    agentSource: inferredAgent.source,
    agentEvidence: inferredAgent.evidence,
    messages,
    frictions,
    frictionCount: frictions.length,
    noisyFrictionCount: frictions.filter((entry) => entry.isNoisy).length,
    toolNames,
    totalChars,
    userMessages,
  }
}

function parsePositiveInt(raw, fallback) {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function parsePositiveNumber(raw, fallback) {
  const value = Number(raw)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parseNonNegativeInt(raw, fallback) {
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}

function truncateForSummary(value, limit = 240) {
  const text = String(value || "").replace(/\s+/g, " ").trim()
  if (!text) return ""
  return text.length > limit ? `${text.slice(0, limit)}...` : text
}

function classifyExportFailure(error) {
  const message = error instanceof Error ? error.message : String(error)
  const normalized = message.toLowerCase()
  let type = "unknown"

  if (/etimedout|timed out|timeout/.test(normalized)) {
    type = "timeout"
  } else if (/empty json output/.test(normalized)) {
    type = "empty_output"
  } else if (/failed to parse json output/.test(normalized)) {
    type = "invalid_json"
  } else if (/(session|conversation).*(not found|missing|does not exist)|not found.*(session|conversation)|unknown session|no such session/.test(normalized)) {
    type = "missing_session"
  } else if (/opencode command failed|could not find executable|enoent|command failed|permission denied|spawn/.test(normalized)) {
    type = "process_error"
  }

  const lines = String(message || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const summary = truncateForSummary(lines[0] || message, 200)
  const stderrSummary = truncateForSummary(lines.slice(1).join(" | ") || summary, 320)

  return {
    type,
    message,
    summary,
    stderrSummary,
  }
}

function blockSleep(ms) {
  const timeout = Math.max(0, Math.floor(Number(ms) || 0))
  if (timeout <= 0) return
  const array = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(array, 0, 0, timeout)
}

function exportSessionWithRetry(session, exporter, options = {}) {
  const exportRetries = parseNonNegativeInt(options.exportRetries, 2)
  const exportRetryDelayMs = parseNonNegativeInt(options.exportRetryDelayMs, 350)
  const exportBackoffMultiplier = parsePositiveNumber(options.exportBackoffMultiplier, 1.8)
  const exportTimeoutMs = parsePositiveInt(options.exportTimeoutMs, 8000)
  const shouldLogSkips = options.shouldLogSkips !== false
  const waitFn = typeof options.waitFn === "function" ? options.waitFn : blockSleep

  const maxAttempts = exportRetries + 1
  const nonRetryableTypes = new Set(["missing_session", "process_error"])
  let lastFailure = null
  let lastDurationMs = 0
  let totalDurationMs = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const attemptStart = Date.now()
    try {
      const data = exporter(session.id, { timeoutMs: exportTimeoutMs })
      lastDurationMs = Date.now() - attemptStart
      totalDurationMs += lastDurationMs
      return {
        ok: true,
        data,
        attemptCount: attempt,
        retried: attempt > 1,
        lastDurationMs,
        totalDurationMs,
      }
    } catch (error) {
      lastDurationMs = Date.now() - attemptStart
      totalDurationMs += lastDurationMs
      const classified = classifyExportFailure(error)
      lastFailure = {
        sessionID: session.id,
        projectPath: session.project || "unknown-project",
        attemptCount: attempt,
        finalFailureType: classified.type,
        reason: classified.message,
        reasonSummary: classified.summary,
        stderrSummary: classified.stderrSummary,
        lastCommandDurationMs: lastDurationMs,
        retried: attempt > 1,
      }

      if (attempt >= maxAttempts) {
        break
      }

      if (nonRetryableTypes.has(classified.type)) {
        break
      }

      const delayMs = Math.round(exportRetryDelayMs * Math.pow(exportBackoffMultiplier, attempt - 1))
      if (shouldLogSkips) {
        console.warn(
          `Export retry ${attempt}/${maxAttempts - 1} for ${session.id} after ${classified.type}: ${classified.summary}`,
        )
      }
      waitFn(delayMs)
    }
  }

  return {
    ok: false,
    failure: {
      ...lastFailure,
      attemptCount: lastFailure?.attemptCount || maxAttempts,
      retried: (lastFailure?.attemptCount || maxAttempts) > 1,
      totalDurationMs,
    },
  }
}

function buildExportDiagnosticsSummary(details) {
  const failureCountsByType = countBy(details.failedSessions, (entry) => entry.finalFailureType || "unknown")
    .sort((a, b) => b.count - a.count)
  const topFailureTypes = failureCountsByType.slice(0, 3)
  const coveragePct = formatPct(details.analyzedSessions + details.metadataOnlySessions, details.totalSessionsRequested)
  const exportSuccessRate = formatPct(details.exportSucceeded, details.exportAttempted)

  return {
    generatedAt: new Date().toISOString(),
    totalSessionsRequested: details.totalSessionsRequested,
    exportAttempted: details.exportAttempted,
    exportSucceeded: details.exportSucceeded,
    exportFailed: details.exportFailed,
    exportSuccessRate,
    analysisCoverage: {
      analyzedSessions: details.analyzedSessions,
      metadataOnlySessions: details.metadataOnlySessions,
      coverageRate: coveragePct,
    },
    analysisFailures: {
      count: details.analysisFailures.length,
      sessions: details.analysisFailures,
    },
    failureCountsByType,
    topFailureTypes,
    retryStats: {
      sessionsRetried: details.sessionsRetried,
      recoveredAfterRetry: details.recoveredAfterRetry,
      failedAfterRetry: details.failedAfterRetry,
      retryAttempts: details.retryAttempts,
    },
    failedSessions: details.failedSessions,
    metadataOnlySessions: details.metadataOnlySessionDetails,
  }
}

function collectAnalyzedSessions(sessions, analyzeFn, options = {}) {
  const maxAttempts = parsePositiveInt(options.maxAttempts, sessions.length || 0)
  const minMessages = parsePositiveInt(options.minMessages, 3)
  const exportRetries = parseNonNegativeInt(options.exportRetries, 2)
  const exportRetryDelayMs = parseNonNegativeInt(options.exportRetryDelayMs, 350)
  const exportBackoffMultiplier = parsePositiveNumber(options.exportBackoffMultiplier, 1.8)
  const exportTimeoutMs = parsePositiveInt(options.exportTimeoutMs, 8000)
  const shouldLogSkips = options.shouldLogSkips !== false
  const exporter = typeof options.exporter === "function" ? options.exporter : exportSession

  const analyzed = []
  const skipped = []
  const metadataOnly = []
  const failedSessions = []
  const analysisFailures = []

  let retryAttempts = 0
  let sessionsRetried = 0
  let recoveredAfterRetry = 0
  let failedAfterRetry = 0

  let attempts = 0
  for (const session of sessions) {
    if (attempts >= maxAttempts) {
      break
    }

    attempts += 1
    const exportResult = exportSessionWithRetry(session, exporter, {
      exportRetries,
      exportRetryDelayMs,
      exportBackoffMultiplier,
      exportTimeoutMs,
      shouldLogSkips,
      waitFn: options.waitFn,
    })

    const wasRetried = exportResult.ok ? exportResult.retried : Boolean(exportResult.failure?.retried)
    const attemptCount = exportResult.ok ? exportResult.attemptCount : exportResult.failure?.attemptCount || 1

    if (wasRetried) {
      sessionsRetried += 1
      retryAttempts += Math.max(0, attemptCount - 1)
    }

    if (!exportResult.ok) {
      const failure = exportResult.failure
      failedSessions.push(failure)
      skipped.push({
        id: session.id,
        reason: failure.reason,
        type: failure.finalFailureType,
      })
      if (failure.retried) {
        failedAfterRetry += 1
      }
      if (shouldLogSkips) {
        console.warn(`Skipped session ${session.id} [${failure.finalFailureType}]: ${failure.reasonSummary}`)
      }
      continue
    }

    if (exportResult.retried) {
      recoveredAfterRetry += 1
    }

    try {
      const exportData = exportResult.data
      const result = analyzeFn(session, exportData)
      if (result.messages.length >= minMessages) {
        analyzed.push(result)
      } else {
        metadataOnly.push({
          id: session.id,
          title: session.title,
          project: session.project || "unknown-project",
          messageCount: result.messages.length,
          reason: `below_min_messages:${minMessages}`,
          exportAttemptCount: exportResult.attemptCount,
          retried: exportResult.retried,
        })
      }
    } catch (error) {
      const classified = classifyExportFailure(error)
      const reason = classified.message
      const analysisFailure = {
        sessionID: session.id,
        projectPath: session.project || "unknown-project",
        attemptCount: exportResult.attemptCount || 1,
        finalFailureType: "unknown",
        reason,
        reasonSummary: classified.summary,
        stderrSummary: classified.stderrSummary,
        lastCommandDurationMs: exportResult.lastDurationMs || 0,
        retried: exportResult.retried,
        totalDurationMs: exportResult.totalDurationMs || 0,
        stage: "analysis",
      }
      analysisFailures.push(analysisFailure)
      skipped.push({ id: session.id, reason, type: "unknown", stage: "analysis" })
      if (shouldLogSkips) {
        console.warn(`Skipped session ${session.id} [analysis_error]: ${classified.summary}`)
      }
    }
  }

  const exportDiagnostics = buildExportDiagnosticsSummary({
    totalSessionsRequested: sessions.length,
    exportAttempted: attempts,
    exportSucceeded: attempts - failedSessions.length,
    exportFailed: failedSessions.length,
    analyzedSessions: analyzed.length,
    metadataOnlySessions: metadataOnly.length,
    failedSessions,
    metadataOnlySessionDetails: metadataOnly,
    analysisFailures,
    sessionsRetried,
    recoveredAfterRetry,
    failedAfterRetry,
    retryAttempts,
  })

  return { analyzed, skipped, attempts, metadataOnly, exportDiagnostics, analysisFailures }
}

function aggregateInsights(allSessions, analyzedSessions, days, options = {}) {
  const exportDiagnostics = options.exportDiagnostics || null
  const metadataOnlySessions = Array.isArray(options.metadataOnlySessions) ? options.metadataOnlySessions : []
  const totalMessages = analyzedSessions.reduce((sum, session) => sum + session.messages.length, 0)
  const analyzedById = new Map(analyzedSessions.map((session) => [session.id, session]))
  const enrichedSessions = allSessions.map((session) => {
    const analyzed = analyzedById.get(session.id)
    if (!analyzed) return session
    return {
      ...session,
      agent: session.agent || analyzed.agent || "unknown-agent",
      project: session.project || analyzed.project || "unknown-project",
      createdAt: session.createdAt || analyzed.createdAt,
      updatedAt: session.updatedAt || analyzed.updatedAt,
      createdAtSource: session.createdAtSource || analyzed.createdAtSource,
      updatedAtSource: session.updatedAtSource || analyzed.updatedAtSource,
      agentEvidence: analyzed.agentEvidence,
      createdAtDiagnostics: analyzed.createdAtDiagnostics,
      updatedAtDiagnostics: analyzed.updatedAtDiagnostics,
      taskDiagnostics: analyzed.taskDiagnostics,
      outcomeDiagnostics: analyzed.outcomeDiagnostics,
    }
  })

  const dateRange = formatDateRange(allSessions, { includeDiagnostics: true })
  const dateRangeValue = typeof dateRange === "string" ? dateRange : dateRange.value

  const activeDays = new Set(
    enrichedSessions
      .map((session) => new Date(session.updatedAt || session.createdAt || Date.now()).toISOString().slice(0, 10))
      .filter(Boolean),
  ).size

  const frictionEntries = analyzedSessions.flatMap((session) =>
    session.frictions.map((friction) => ({ ...friction, sessionID: session.id, sessionTitle: session.title })),
  )
  const noisyFrictionEntries = frictionEntries.filter((entry) => entry.isNoisy)
  const frictionCounts = countBy(frictionEntries, (entry) => entry.type).sort((a, b) => b.count - a.count)
  const noisyFrictionCounts = countBy(noisyFrictionEntries, (entry) => entry.type).sort((a, b) => b.count - a.count)
  const taskCounts = countBy(analyzedSessions, (session) => session.task).sort((a, b) => b.count - a.count)
  const outcomeCounts = countBy(analyzedSessions, (session) => session.outcome).sort((a, b) => b.count - a.count)
  const taskIdentityDomainCounts = countBy(
    analyzedSessions,
    (session) => session.taskIdentity?.domain || "unknown",
  ).sort((a, b) => b.count - a.count)
  const taskIdentityScopeCounts = countBy(
    analyzedSessions,
    (session) => session.taskIdentity?.scope || "unknown",
  ).sort((a, b) => b.count - a.count)
  const taskIdentityDurabilityCounts = countBy(
    analyzedSessions,
    (session) => session.taskIdentity?.durability || "unknown",
  ).sort((a, b) => b.count - a.count)
  const taskIdentityObjectTypeCounts = countBy(
    analyzedSessions,
    (session) => session.taskIdentity?.object_type || "unknown",
  ).sort((a, b) => b.count - a.count)
  const taskIdentityTopObjectNameCounts = countBy(
    analyzedSessions,
    (session) => session.taskIdentity?.object_name || "unknown",
  ).sort((a, b) => b.count - a.count)
  const agentCounts = countBy(enrichedSessions, (session) => session.agent || "unknown-agent").sort((a, b) => b.count - a.count)
  const taskSourceCounts = countBy(analyzedSessions, (session) => session.taskDiagnostics?.source || "fallback").sort(
    (a, b) => b.count - a.count,
  )
  const outcomeSourceCounts = countBy(analyzedSessions, (session) => session.outcomeDiagnostics?.source || "fallback").sort(
    (a, b) => b.count - a.count,
  )
  const agentSourceCounts = countBy(analyzedSessions, (session) => session.agentSource || "fallback").sort((a, b) => b.count - a.count)
  const createdAtParseSourceCounts = countBy(
    analyzedSessions,
    (session) => session.createdAtSource || session.createdAtDiagnostics?.attempts?.[0]?.source || "unknown",
  ).sort((a, b) => b.count - a.count)
  const updatedAtParseSourceCounts = countBy(
    analyzedSessions,
    (session) => session.updatedAtSource || session.updatedAtDiagnostics?.attempts?.[0]?.source || "unknown",
  ).sort((a, b) => b.count - a.count)

  const toolCounts = countBy(
    analyzedSessions.flatMap((session) => session.toolNames),
    (tool) => tool,
  ).sort((a, b) => b.count - a.count)

  const repeatedInstructions = extractRepeatedInstructions(analyzedSessions, 2)
  const achievedCount = analyzedSessions.filter((session) => session.outcome === "achieved").length
  const frictionSessionCount = analyzedSessions.filter((session) => session.frictions.length > 0).length
  const avgSessionLength = analyzedSessions.length
    ? Math.round(totalMessages / analyzedSessions.length)
    : 0

  const topProjects = summarizeProjects(enrichedSessions)
  const highLeverageRules = repeatedInstructions.slice(0, 5)
  const topFrictions = frictionCounts.slice(0, 3)
  const whatIsWorking = buildWhatWorks(analyzedSessions, taskCounts, outcomeCounts)

  const quickWins = buildQuickWins({
    topFrictions,
    repeatedInstructions,
    topProjects,
    analyzedSessions,
  })

  const patchCandidates = buildPatchSuggestions(highLeverageRules)

  return {
    meta: {
      generatedAt: new Date().toISOString(),
      days,
      analyzedSessions: analyzedSessions.length,
      totalSessions: allSessions.length,
      totalMessages,
      activeDays,
      completionRate: formatPct(achievedCount, analyzedSessions.length),
      averageSessionLength: avgSessionLength,
      frictionRate: formatPct(frictionSessionCount, analyzedSessions.length),
      dateRange: dateRangeValue,
      diagnostics: {
        dateRange,
        taskSources: taskSourceCounts,
        outcomeSources: outcomeSourceCounts,
        agentSources: agentSourceCounts,
        createdAtSources: createdAtParseSourceCounts,
        updatedAtSources: updatedAtParseSourceCounts,
        noisyFrictionRate: formatPct(noisyFrictionEntries.length, analyzedSessions.length),
        export: exportDiagnostics
          ? {
              totalSessionsRequested: exportDiagnostics.totalSessionsRequested,
              exportAttempted: exportDiagnostics.exportAttempted,
              exportSucceeded: exportDiagnostics.exportSucceeded,
              exportFailed: exportDiagnostics.exportFailed,
              exportSuccessRate: exportDiagnostics.exportSuccessRate,
              analysisCoverage: exportDiagnostics.analysisCoverage,
              analysisFailures: exportDiagnostics.analysisFailures,
              topFailureTypes: exportDiagnostics.topFailureTypes,
              retryStats: exportDiagnostics.retryStats,
            }
          : null,
      },
      dailyAverageSessions: activeDays ? (allSessions.length / activeDays).toFixed(1) : "0.0",
      exportCoverage: exportDiagnostics
        ? {
            exportAttempted: exportDiagnostics.exportAttempted,
            exportSucceeded: exportDiagnostics.exportSucceeded,
            exportFailed: exportDiagnostics.exportFailed,
            exportSuccessRate: exportDiagnostics.exportSuccessRate,
            analysisCoverageRate: exportDiagnostics.analysisCoverage.coverageRate,
            metadataOnlySessions: metadataOnlySessions.length,
            topFailureTypes: exportDiagnostics.topFailureTypes,
          }
        : null,
    },
    counts: {
      tasks: taskCounts,
      outcomes: outcomeCounts,
      taskIdentityDomains: taskIdentityDomainCounts,
      taskIdentityScopes: taskIdentityScopeCounts,
      taskIdentityDurabilities: taskIdentityDurabilityCounts,
      taskIdentityObjectTypes: taskIdentityObjectTypeCounts,
      taskIdentityObjectNames: taskIdentityTopObjectNameCounts,
      frictions: frictionCounts,
      agents: agentCounts,
      tools: toolCounts,
      frictionsNoisy: noisyFrictionCounts,
    },
    visuals: {
      heatmap: byHourHeatmap(enrichedSessions),
      dailyActivity: dailyActivity(enrichedSessions),
      satisfactionTrend: satisfactionTrend(analyzedSessions),
    },
    repeatedInstructions,
    examples: {
      frictions: frictionEntries.slice(0, 12),
      whatIsWorking,
      quickWins,
      patchCandidates,
      frictionNoisyEntries: noisyFrictionEntries.slice(0, 12),
    },
    sessions: analyzedSessions.map((session) => ({
      id: session.id,
      title: session.title,
      task: session.task,
      taskIdentity: {
        domain: session.taskIdentity?.domain,
        object_type: session.taskIdentity?.object_type,
        object_name: session.taskIdentity?.object_name,
        scope: session.taskIdentity?.scope,
        durability: session.taskIdentity?.durability,
        confidence: session.taskIdentity?.confidence,
        evidence: session.taskIdentity?.evidence,
      },
      outcome: session.outcome,
      frictionCount: session.frictionCount,
      noisyFrictionCount: session.noisyFrictionCount,
      messageCount: session.messages.length,
      totalChars: session.totalChars,
      project: session.project,
      updatedAt: session.updatedAt || session.createdAt,
      agent: session.agent,
      agentSource: session.agentSource,
      taskDiagnostics: session.taskDiagnostics,
      outcomeDiagnostics: session.outcomeDiagnostics,
      createdAtDiagnostics: session.createdAtDiagnostics,
      updatedAtDiagnostics: session.updatedAtDiagnostics,
    })),
    metadataOnlySessions,
  }
}

function buildWhatWorks(analyzedSessions, taskCounts, outcomeCounts) {
  const implemented = taskCounts.find((item) => item.key === "implement")?.count || 0
  const debugged = taskCounts.find((item) => item.key === "debug")?.count || 0
  const achieved = outcomeCounts.find((item) => item.key === "achieved")?.count || 0

  const items = []
  if (achieved > 0) {
    items.push(`有 ${achieved} 个采样 session 呈现出明确完成信号，说明你已经形成了可复用的完成闭环。`)
  }
  if (implemented > 0) {
    items.push(`实现型任务占比不低，说明 OpenCode 已经不只是陪聊，而是在真实参与产出。`)
  }
  if (debugged > 0) {
    items.push(`调试类任务出现频繁，说明最值得优化的不是灵感，而是纠错与约束传递。`)
  }
  if (!items.length) {
    items.push("你已经积累了足够多的会话样本，可以开始把重复行为固化为规则和 skills。")
  }
  return items
}

function buildQuickWins({ topFrictions, repeatedInstructions, topProjects, analyzedSessions }) {
  const wins = []

  if (repeatedInstructions.length) {
    wins.push({
      title: "把高频重复指令固化到 AGENTS.md",
      body: `至少有 ${repeatedInstructions[0].count} 个 session 反复出现同一类指令，适合立刻沉淀为规则。`,
    })
  }

  if (topFrictions.some((item) => item.key === "上下文丢失")) {
    wins.push({
      title: "长会话前刷新 SESSION_GUARD.md",
      body: "上下文连续性已经成为主要摩擦点，先保住任务状态比继续堆上下文更值。",
    })
  }

  if (topFrictions.some((item) => item.key === "重复指令")) {
    wins.push({
      title: "把重复流程拆成 skill",
      body: "单个 session 内部已出现重复讲解或重复纠偏，说明这个流程适合 skill 化。",
    })
  }

  if (analyzedSessions.some((session) => session.totalChars > 12000)) {
    wins.push({
      title: "对长输出做摘要，不再整段背着走",
      body: "部分 session 的文本体量已经明显偏大，后续尽量改为摘要式延续。",
    })
  }

  if (topProjects.length > 1) {
    wins.push({
      title: "区分项目级规则和个人级规则",
      body: "你已经跨多个项目使用 OpenCode，应该把项目约束与个人偏好分开管理。",
    })
  }

  return wins.slice(0, 5)
}

function buildPatchSuggestions(repeatedInstructions) {
  return repeatedInstructions.slice(0, 5).map((item, index) => {
    const text = item.text.replace(/\s+/g, " ").trim()
    return `- Rule ${index + 1}: ${text}`
  })
}

function renderExecutiveSummary(report) {
  const friction = report.counts.frictions.slice(0, 3).map((item) => `${item.key} ${item.count} 次`).join("、")
  const repeated = report.repeatedInstructions.slice(0, 2).map((item) => htmlEscape(item.text)).join("；")
  return [
    `<p>最近 ${report.meta.days} 天内共分析 <strong>${report.meta.analyzedSessions}</strong> 个采样 session，覆盖 <strong>${report.meta.totalSessions}</strong> 个近期 session。任务完成率约为 <strong>${report.meta.completionRate}</strong>，摩擦率约为 <strong>${report.meta.frictionRate}</strong>。</p>`,
    `<p>最明显的摩擦集中在：<strong>${htmlEscape(friction || "暂无高频摩擦")}</strong>。</p>`,
    `<p>最值得立刻做的事不是继续堆 prompt，而是把重复表达固化成规则或 skill。高频候选包括：<strong>${repeated || "当前样本还不足以形成稳定候选"}</strong>。</p>`,
  ].join("\n")
}

function renderFrictionAnalysis(report) {
  const topCounts = report.counts.frictions.slice(0, 6)
  const examples = report.examples.frictions.slice(0, 8)

  const summary = topCounts.length
    ? `<ul>${topCounts
        .map((item) => `<li><strong>${htmlEscape(item.key)}</strong>：${item.count} 次</li>`)
        .join("")}</ul>`
    : "<p>没有识别到明显高频摩擦。</p>"

  const cases = examples.length
    ? renderList(
        examples,
        (item) => `
          <details class="case-card">
            <summary>${htmlEscape(item.type)} — ${htmlEscape(item.sessionTitle || item.sessionID)}</summary>
            <p>${htmlEscape(item.description)}</p>
            <pre><code>${htmlEscape(item.snippet || "")}</code></pre>
          </details>
        `,
      )
    : "<p>暂无典型案例。</p>"

  return `<div>${summary}</div><div class="stack">${cases}</div>`
}

function renderWhatWorks(report) {
  return `<ul>${report.examples.whatIsWorking.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>`
}

function renderQuickWins(report) {
  return report.examples.quickWins.length
    ? `<ul>${report.examples.quickWins
        .map((item) => `<li><strong>${htmlEscape(item.title)}</strong>：${htmlEscape(item.body)}</li>`)
        .join("")}</ul>`
    : "<p>还没有形成足够稳定的 quick wins。</p>"
}

function renderPatchBlock(report) {
  if (!report.examples.patchCandidates.length) {
    return "<p>暂时没有足够稳定的规则候选。</p>"
  }

  const block = [
    "# ContextOS suggested patch",
    "",
    "## Repeated instructions to promote",
    ...report.examples.patchCandidates,
  ].join("\n")

  return `<pre><code>${htmlEscape(block)}</code></pre>`
}

function renderDiagnosticsSourceCounts(entries) {
  const total = entries.reduce((sum, item) => sum + item.count, 0)
  if (!entries.length || !total) {
    return "<p>暂无可计算的来源诊断统计。</p>"
  }

  return `<ul>${entries
    .slice(0, 8)
    .map(
      (item) =>
        `<li><strong>${htmlEscape(item.key)}</strong>：${item.count} 次 (${Math.round(
          (item.count / total) * 100,
        )}%)</li>`,
    )
    .join("")}</ul>`
}

function renderSessionDiagnostics(report) {
  const sessions = report.sessions
    .filter(
      (session) =>
        session.taskDiagnostics ||
        session.outcomeDiagnostics ||
        session.createdAtDiagnostics ||
        session.updatedAtDiagnostics ||
        session.agentEvidence?.length,
    )
    .slice(0, 8)

  if (!sessions.length) {
    return "<p>当前样本未附带可回放的诊断字段。</p>"
  }

  return sessions
    .map((session) => {
      const taskRule = session.taskDiagnostics?.matchedRule || "-"
      const outcomeRule = session.outcomeDiagnostics?.matchedRule || "-"
      const taskSnippet = session.taskDiagnostics?.evidence?.matchedSnippet || session.taskDiagnostics?.evidence?.rawText || ""
      const outcomeSnippet =
        session.outcomeDiagnostics?.evidence?.matchedSnippet || session.outcomeDiagnostics?.evidence?.rawText || ""
      const taskSource = session.taskDiagnostics?.source || "fallback"
      const outcomeSource = session.outcomeDiagnostics?.source || "fallback"
      const agentLine = `${htmlEscape(session.agent)} · source=${htmlEscape(session.agentSource || "fallback")}`
      const dateLine = `created=${htmlEscape(session.createdAtSource || "unknown")}, updated=${htmlEscape(session.updatedAtSource || "unknown")}`

      return `
        <details class="case-card">
          <summary>${htmlEscape(session.title || "Session")}</summary>
          <p>任务：${htmlEscape(session.task)}（规则=${htmlEscape(taskRule)} / 来源=${htmlEscape(taskSource)}）</p>
          <p>结果：${htmlEscape(session.outcome)}（规则=${htmlEscape(outcomeRule)} / 来源=${htmlEscape(outcomeSource)}）</p>
          <p>Agent：${agentLine}</p>
          <p>时间来源：${dateLine}</p>
          <p>任务证据：<code>${htmlEscape(taskSnippet.slice(0, 200))}</code></p>
          <p>结果证据：<code>${htmlEscape(outcomeSnippet.slice(0, 200))}</code></p>
        </details>
      `
    })
    .join("")
}

function renderDiagnosticsPanel(report) {
  const meta = report.meta.diagnostics || {}
  const dateRangeDiagnostics =
    typeof meta.dateRange === "object" && meta.dateRange
      ? `样本输入 ${meta.dateRange.totalInputs || 0} 条，有效 ${meta.dateRange.parsed || 0} 条，失败 ${
          meta.dateRange.invalid || 0
        } 条。`
      : "时间范围解析来自历史兼容路径，未开启详细诊断。"
  const noisyFrictionRate = meta.noisyFrictionRate || "0%"

  return `
    <div class="stack">
      <p>无噪声摩擦比例：${htmlEscape(noisyFrictionRate)}</p>
      <p>${htmlEscape(dateRangeDiagnostics)}</p>
      <div>
        <h3>任务归类来源</h3>
        ${renderDiagnosticsSourceCounts(meta.taskSources || [])}
      </div>
      <div>
        <h3>结果归类来源</h3>
        ${renderDiagnosticsSourceCounts(meta.outcomeSources || [])}
      </div>
      <div>
        <h3>Agent 来源</h3>
        ${renderDiagnosticsSourceCounts(meta.agentSources || [])}
      </div>
      <div>
        <h3>createdAt 解析来源</h3>
        ${renderDiagnosticsSourceCounts(meta.createdAtSources || [])}
      </div>
      <div>
        <h3>updatedAt 解析来源</h3>
        ${renderDiagnosticsSourceCounts(meta.updatedAtSources || [])}
      </div>
    </div>
  `
}

function renderDeepSuggestions(report) {
  const items = [
    "为高频重复工作流补一条专门 skill，而不是每次重新解释。",
    "把调试类与实现类任务的规则拆开，避免同一套约束彼此干扰。",
    "把 SESSION_GUARD.md 变成每次长会话前的固定动作。",
  ]
  return `<ul>${items.map((item) => `<li>${htmlEscape(item)}</li>`).join("")}</ul>`
}

function withPct(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.count, 0)
  return entries.map((entry) => ({
    ...entry,
    pct: total ? Math.round((entry.count / total) * 100) : 0,
  }))
}

function fillTemplate(template, report) {
  const taskIdentityDomainDistribution = withPct(report.counts.taskIdentityDomains).slice(0, 8).map((item) => ({
    domain: item.key,
    count: item.count,
    pct: item.pct,
  }))

  const taskIdentityScopeDistribution = withPct(report.counts.taskIdentityScopes).slice(0, 8).map((item) => ({
    scope: item.key,
    count: item.count,
    pct: item.pct,
  }))

  const taskIdentityDurabilityDistribution = withPct(report.counts.taskIdentityDurabilities).slice(0, 8).map((item) => ({
    durability: item.key,
    count: item.count,
    pct: item.pct,
  }))

  const taskIdentityObjectTypeDistribution = withPct(report.counts.taskIdentityObjectTypes).slice(0, 8).map((item) => ({
    objectType: item.key,
    count: item.count,
    pct: item.pct,
  }))

  const taskIdentityObjectNameDistribution = withPct(report.counts.taskIdentityObjectNames).slice(0, 8).map((item) => ({
    objectName: item.key,
    count: item.count,
    pct: item.pct,
  }))

  const replacements = {
    "__EXECUTIVE_SUMMARY__": renderExecutiveSummary(report),
    "__TOTAL_SESSIONS__": String(report.meta.totalSessions),
    "__TOTAL_MESSAGES__": String(report.meta.totalMessages),
    "__ACTIVE_DAYS__": String(report.meta.activeDays),
    "__COMPLETION_RATE__": report.meta.completionRate,
    "__AVG_SESSION_LENGTH__": String(report.meta.averageSessionLength),
    "__FRICTION_RATE__": report.meta.frictionRate,
    "__DATE_RANGE__": report.meta.dateRange,
    "__DAILY_AVG_SESSIONS__": String(report.meta.dailyAverageSessions),
    "__HEATMAP_DATA__": JSON.stringify(report.visuals.heatmap),
    "__DAILY_ACTIVITY_DATA__": JSON.stringify(report.visuals.dailyActivity),
    "__SATISFACTION_TREND_DATA__": JSON.stringify(report.visuals.satisfactionTrend),
    "__TOOL_USAGE_DATA__": JSON.stringify(withPct(report.counts.tools.slice(0, 10)).map((item) => ({ tool: item.key, count: item.count, pct: item.pct }))),
    "__TASK_DISTRIBUTION_DATA__": JSON.stringify(withPct(report.counts.tasks).map((item) => ({ type: item.key, count: item.count, pct: item.pct }))),
    "__TASK_IDENTITY_DOMAIN_DISTRIBUTION_DATA__": JSON.stringify(taskIdentityDomainDistribution),
    "__TASK_IDENTITY_SCOPE_DISTRIBUTION_DATA__": JSON.stringify(taskIdentityScopeDistribution),
    "__TASK_IDENTITY_DURABILITY_DISTRIBUTION_DATA__": JSON.stringify(taskIdentityDurabilityDistribution),
    "__TASK_IDENTITY_OBJECT_TYPE_DISTRIBUTION_DATA__": JSON.stringify(taskIdentityObjectTypeDistribution),
    "__TASK_IDENTITY_OBJECT_NAME_DISTRIBUTION_DATA__": JSON.stringify(taskIdentityObjectNameDistribution),
    "__AGENT_DISTRIBUTION_DATA__": JSON.stringify(withPct(report.counts.agents.slice(0, 10)).map((item) => ({ agent: item.key, count: item.count, pct: item.pct }))),
    "__FRICTION_ANALYSIS__": renderFrictionAnalysis(report),
    "__WHATS_WORKING__": renderWhatWorks(report),
    "__QUICK_WINS__": renderQuickWins(report),
    "__AGENTS_MD_SUGGESTIONS__": renderPatchBlock(report),
    "__DEEP_SUGGESTIONS__": renderDeepSuggestions(report),
    "__DIAGNOSTICS_PANEL__": renderDiagnosticsPanel(report),
    "__DIAGNOSTIC_SESSIONS__": renderSessionDiagnostics(report),
    "__GENERATED_AT__": new Date().toLocaleString(),
  }

  const output = Object.entries(replacements).reduce(
    (output, [needle, value]) => output.replaceAll(needle, value),
    template,
  )

  const leftovers = output.match(/__[A-Z0-9_]+__/g)
  if (leftovers?.length) {
    const uniqueLeftovers = [...new Set(leftovers)]
    throw new Error(`Template contains unresolved placeholders: ${uniqueLeftovers.join(", ")}`)
  }

  return output
}

function printSummary(report, outputPath, diagnosticsPath) {
  const topFrictions = report.counts.frictions.slice(0, 3).map((item) => `${item.key}(${item.count})`).join(", ") || "none"
  const quickWins = report.examples.quickWins.slice(0, 3).map((item) => item.title).join("; ") || "none"
  const exportDiag = report.meta?.diagnostics?.export
  const failureTypes = exportDiag?.topFailureTypes?.length
    ? exportDiag.topFailureTypes.map((item) => `${item.key}(${item.count})`).join(", ")
    : "none"

  console.log(`分析 session：${report.meta.analyzedSessions}/${report.meta.totalSessions}`)
  if (exportDiag) {
    const coverage = exportDiag.analysisCoverage?.coverageRate || "0%"
    const analysisFailures = exportDiag.analysisFailures?.count || 0
    console.log(`导出请求/尝试：${exportDiag.totalSessionsRequested}/${exportDiag.exportAttempted}`)
    console.log(`导出成功/失败：${exportDiag.exportSucceeded}/${exportDiag.exportFailed}`)
    console.log(`导出成功率：${exportDiag.exportSuccessRate}`)
    console.log(`分析覆盖率（含 metadata-only）：${coverage}`)
    console.log(`分析阶段失败：${analysisFailures}`)
    console.log(`Top 失败类型：${failureTypes}`)
    console.log(`导出诊断文件：${diagnosticsPath}`)
  }
  console.log(`时间范围：${report.meta.dateRange}`)
  console.log(`任务完成率：${report.meta.completionRate}`)
  console.log(`平均 session 长度：${report.meta.averageSessionLength}`)
  console.log(`摩擦率：${report.meta.frictionRate}`)
  console.log(`Top 3 摩擦：${topFrictions}`)
  console.log(`Top 3 Quick Wins：${quickWins}`)
  console.log(`报告文件：${outputPath}`)
}

async function main() {
  const args = readArgs()
  const days = Number(args.days || 30)
  const maxCount = Number(args["max-count"] || 120)
  const maxExportAttempts = parsePositiveInt(args["max-export-attempts"], 24)
  const exportTimeoutMs = parsePositiveInt(args["export-timeout-ms"], 8000)
  const exportRetries = parseNonNegativeInt(args["export-retries"], 2)
  const exportRetryDelayMs = parseNonNegativeInt(args["export-retry-delay-ms"], 350)
  const exportBackoffMultiplier = parsePositiveNumber(args["export-backoff-multiplier"], 1.8)
  const outputPath = path.isAbsolute(args.output || "")
    ? args.output
    : path.join(OUTPUT_ROOT, args.output || "insights-report.html")
  const templatePath = path.join(ROOT, "templates", "report-template.html")
  const exportDiagnosticsPath = path.join(ANALYSIS_DIR, "insights-export-diagnostics.json")

  const allRecentSessions = filterSessionsByDays(listSessions({ maxCount }), days)
  const sampledSessions = sampleSessions(allRecentSessions, 30)

  const { analyzed, skipped, attempts, metadataOnly, exportDiagnostics } = collectAnalyzedSessions(sampledSessions, analyzeSession, {
    maxAttempts: maxExportAttempts,
    minMessages: 3,
    exportTimeoutMs,
    exportRetries,
    exportRetryDelayMs,
    exportBackoffMultiplier,
  })

  saveJson(exportDiagnosticsPath, exportDiagnostics)

  if (!allRecentSessions.length) {
    throw new Error("No sessions found in the selected time window. Try a larger --days value or check local session history.")
  }

  if (!analyzed.length && !metadataOnly.length && skipped.length) {
    const summary = skipped
      .slice(0, 4)
      .map((item) => `${item.id}: ${item.reason.split("\n")[0]}`)
      .join(" | ")
    throw new Error(
      `No recent sessions could be analyzed after ${attempts} export attempts; ${skipped.length} sessions were skipped. ${summary ? `Examples: ${summary}` : ""}`,
    )
  }

  const report = aggregateInsights(allRecentSessions, analyzed, days, {
    exportDiagnostics,
    metadataOnlySessions: metadataOnly,
  })
  const template = loadTemplate(templatePath)
  const html = fillTemplate(template, report)

  saveJson(path.join(ANALYSIS_DIR, "insights.json"), report)
  saveText(outputPath, html)
  printSummary(report, outputPath, exportDiagnosticsPath)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}

export {
  inferDate,
  inferAgent,
  analyzeSession,
  aggregateInsights,
  renderDiagnosticsPanel,
  renderSessionDiagnostics,
  fillTemplate,
  classifyExportFailure,
  exportSessionWithRetry,
  collectAnalyzedSessions,
}
