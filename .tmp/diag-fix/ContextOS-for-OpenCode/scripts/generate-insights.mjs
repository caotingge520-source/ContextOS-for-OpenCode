#!/usr/bin/env node

import path from "node:path"
import {
  ANALYSIS_DIR,
  ROOT,
  classifyOutcome,
  classifyTaskDetailed,
  countBy,
  dailyActivity,
  detectFrictionDetailed,
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
  readArgs,
  renderList,
  resolveSessionAgent,
  resolveSessionTimeline,
  sampleSessions,
  satisfactionTrend,
  saveJson,
  saveText,
  summarizeProjects,
} from "./contextos-lib.mjs"

function analyzeSession(session, exportData) {
  const messages = extractMessages(exportData)
    .map((msg) => ({
      ...msg,
      text: msg.text.replace(/\u0000/g, "").trim(),
    }))
    .filter((msg) => msg.text || msg.name)

  const timeline = resolveSessionTimeline(session, messages)
  const agentInfo = resolveSessionAgent(session, exportData)
  const taskInfo = classifyTaskDetailed(messages, { session })
  const outcome = classifyOutcome(messages)
  const frictionInfo = detectFrictionDetailed(messages)
  const toolNames = extractToolNames(messages)
  const totalChars = messages.reduce((sum, msg) => sum + msg.text.length, 0)
  const userMessages = messages.filter((msg) => msg.role === "user").length

  return {
    ...session,
    ...timeline,
    ...agentInfo,
    activityAt: timeline.activityAt,
    activityAtSource: timeline.activityAtSource,
    messages,
    task: taskInfo.task,
    taskConfidence: taskInfo.confidence,
    taskReason: taskInfo.reason,
    taskSignals: taskInfo.topSignals,
    outcome,
    frictions: frictionInfo.frictions,
    frictionEvidenceDiagnostics: frictionInfo.diagnostics,
    toolNames,
    totalChars,
    userMessages,
  }
}

function safeIsoDate(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10)
}

function buildTimeParsingDiagnostics(sessions) {
  const counts = {
    totalSessions: sessions.length,
    parsedFromUpdatedAt: 0,
    parsedFromCreatedAt: 0,
    parsedFromMessages: 0,
    fallbackCount: 0,
  }

  for (const session of sessions) {
    const source = session.activityAtSource || session.updatedAtSource || session.createdAtSource || "fallback:none"
    if (String(source).startsWith("messages:")) {
      counts.parsedFromMessages += 1
    } else if (String(source).includes("updatedAt") || String(source).includes("lastMessageAt") || source === "session.endedAt") {
      counts.parsedFromUpdatedAt += 1
    } else if (String(source).includes("createdAt") || String(source).includes("startedAt") || String(source).includes("timestamp")) {
      counts.parsedFromCreatedAt += 1
    } else {
      counts.fallbackCount += 1
    }
  }

  return counts
}

function buildAgentDiagnostics(analyzedSessions) {
  return analyzedSessions.map((session) => ({
    sessionID: session.id,
    agent: session.agent,
    source: session.agentSource || "fallback:none",
    evidence: session.agentEvidence || "",
  }))
}

function buildClassificationDiagnostics(analyzedSessions) {
  return {
    perSessionClassificationReason: analyzedSessions.map((session) => ({
      sessionID: session.id,
      title: session.title,
      task: session.task,
      confidence: session.taskConfidence,
      reason: session.taskReason,
      topSignals: session.taskSignals,
    })),
    topSignals: countBy(
      analyzedSessions.flatMap((session) => session.taskSignals || []),
      (item) => item,
    )
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
  }
}

function buildPatchSuggestions(repeatedInstructions) {
  return repeatedInstructions.slice(0, 6).map((item) => ({
    type: item.type,
    normalizedInstruction: item.normalizedInstruction,
    evidenceCount: item.evidenceCount,
    sourceSessions: item.sourceSessions,
    recommendation: item.recommendation,
    confidence: item.confidence,
  }))
}

function summarizeDiagnostics(report) {
  const lines = [
    `<ul>`,
    `<li><strong>时间来源</strong>：updatedAt ${report.diagnostics.timeParsingDiagnostics.parsedFromUpdatedAt}，createdAt ${report.diagnostics.timeParsingDiagnostics.parsedFromCreatedAt}，messages ${report.diagnostics.timeParsingDiagnostics.parsedFromMessages}，fallback ${report.diagnostics.timeParsingDiagnostics.fallbackCount}</li>`,
    `<li><strong>任务分类</strong>：${report.counts.tasks.map((item) => `${htmlEscape(item.key)} ${item.count}`).join("、") || "暂无"}</li>`,
    `<li><strong>Agent 抽取</strong>：${report.counts.agents.map((item) => `${htmlEscape(item.key)} ${item.count}`).join("、") || "暂无"}</li>`,
    `<li><strong>Patch 候选</strong>：${report.examples.patchCandidates.length} 条</li>`,
    `</ul>`,
  ]
  return lines.join("\n")
}

function renderSessionDiagnostics(report) {
  const rows = report.sessions.slice(0, 12).map((session) => `
    <tr>
      <td>${htmlEscape(session.title)}</td>
      <td>${htmlEscape(session.task)}</td>
      <td>${htmlEscape(session.updatedAtSource || session.createdAtSource || "fallback:none")}</td>
      <td>${htmlEscape(session.agent)}</td>
      <td>${htmlEscape(session.agentSource || "fallback:none")}</td>
      <td>${htmlEscape(session.taskReason || "")}</td>
    </tr>
  `)

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Session</th>
            <th>Task</th>
            <th>时间来源</th>
            <th>Agent</th>
            <th>Agent 来源</th>
            <th>分类依据</th>
          </tr>
        </thead>
        <tbody>
          ${rows.join("\n")}
        </tbody>
      </table>
    </div>
  `
}

function aggregateInsights(allSessions, analyzedSessions, days) {
  const totalMessages = analyzedSessions.reduce((sum, session) => sum + session.messages.length, 0)
  const activeDays = new Set(allSessions.map((session) => safeIsoDate(session.activityAt || session.updatedAt || session.createdAt)).filter(Boolean)).size

  const frictionEntries = analyzedSessions.flatMap((session) =>
    session.frictions.map((friction) => ({
      ...friction,
      sessionID: session.id,
      sessionTitle: session.title,
      task: session.task,
    })),
  )

  const frictionCounts = countBy(frictionEntries, (entry) => entry.type).sort((a, b) => b.count - a.count)
  const taskCounts = countBy(analyzedSessions, (session) => session.task).sort((a, b) => b.count - a.count)
  const outcomeCounts = countBy(analyzedSessions, (session) => session.outcome).sort((a, b) => b.count - a.count)
  const agentCounts = countBy(allSessions, (session) => session.agent || "unknown-agent").sort((a, b) => b.count - a.count)
  const toolCounts = countBy(
    analyzedSessions.flatMap((session) => session.toolNames),
    (tool) => tool,
  ).sort((a, b) => b.count - a.count)

  const repeatedInstructions = extractRepeatedInstructions(analyzedSessions, 2)
  const patchCandidates = buildPatchSuggestions(repeatedInstructions)
  const achievedCount = analyzedSessions.filter((session) => session.outcome === "achieved").length
  const frictionSessionCount = analyzedSessions.filter((session) => session.frictions.length > 0).length
  const avgSessionLength = analyzedSessions.length ? Math.round(totalMessages / analyzedSessions.length) : 0
  const topProjects = summarizeProjects(allSessions)
  const topFrictions = frictionCounts.slice(0, 3)

  const frictionEvidenceDiagnostics = analyzedSessions.flatMap((session) =>
    session.frictionEvidenceDiagnostics.map((diag) => ({
      ...diag,
      sessionID: session.id,
      sessionTitle: session.title,
    })),
  )

  const whatIsWorking = buildWhatWorks(analyzedSessions, taskCounts, outcomeCounts)
  const quickWins = buildQuickWins({ topFrictions, repeatedInstructions, topProjects, analyzedSessions })

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
      dateRange: formatDateRange(allSessions),
      dailyAverageSessions: activeDays ? (allSessions.length / activeDays).toFixed(1) : "0.0",
    },
    diagnostics: {
      timeParsingDiagnostics: buildTimeParsingDiagnostics(allSessions),
      classificationDiagnostics: buildClassificationDiagnostics(analyzedSessions),
      agentParsingDiagnostics: buildAgentDiagnostics(analyzedSessions),
      frictionEvidenceDiagnostics,
    },
    counts: {
      tasks: taskCounts,
      outcomes: outcomeCounts,
      frictions: frictionCounts,
      agents: agentCounts,
      tools: toolCounts,
    },
    visuals: {
      heatmap: byHourHeatmap(allSessions),
      dailyActivity: dailyActivity(allSessions),
      satisfactionTrend: satisfactionTrend(analyzedSessions),
    },
    repeatedInstructions,
    examples: {
      frictions: frictionEntries.slice(0, 12),
      whatIsWorking,
      quickWins,
      patchCandidates,
    },
    sessions: analyzedSessions.map((session) => ({
      id: session.id,
      title: session.title,
      task: session.task,
      taskReason: session.taskReason,
      taskSignals: session.taskSignals,
      taskConfidence: session.taskConfidence,
      outcome: session.outcome,
      frictionCount: session.frictions.length,
      messageCount: session.messages.length,
      totalChars: session.totalChars,
      project: session.project,
      createdAt: session.createdAt,
      createdAtSource: session.createdAtSource,
      updatedAt: session.updatedAt,
      updatedAtSource: session.updatedAtSource,
      activityAt: session.activityAt,
      activityAtSource: session.activityAtSource,
      agent: session.agent,
      agentSource: session.agentSource,
      agentEvidence: session.agentEvidence,
    })),
  }
}

function buildWhatWorks(analyzedSessions, taskCounts, outcomeCounts) {
  const implemented = taskCounts.find((item) => item.key === "implement")?.count || 0
  const debugged = taskCounts.find((item) => item.key === "debug")?.count || 0
  const docs = taskCounts.find((item) => item.key === "docs")?.count || 0
  const achieved = outcomeCounts.find((item) => item.key === "achieved")?.count || 0

  const items = []
  if (achieved > 0) {
    items.push(`有 ${achieved} 个采样 session 呈现出明确完成信号，说明你已经形成了可复用的完成闭环。`)
  }
  if (implemented > 0) {
    items.push(`实现型任务达到 ${implemented} 个，OpenCode 已经不只是陪聊，而是在真实参与产出。`)
  }
  if (debugged > 0) {
    items.push(`调试类任务达到 ${debugged} 个，最值得优化的是纠错与约束传递链路。`)
  }
  if (docs > 0) {
    items.push(`文档/表达类任务也占了一部分，说明规则沉淀和风格固化会有立竿见影的价值。`)
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
      title: "把高频重复指令固化为规则补丁",
      body: `最高频候选跨 ${repeatedInstructions[0].count} 个 session 出现，已经足够写入规则文件。`,
    })
  }

  if (topFrictions.some((item) => item.key === "上下文丢失")) {
    wins.push({
      title: "长会话前刷新 SESSION_GUARD.md",
      body: "上下文连续性已经成为主要摩擦点，先保住任务状态比继续堆上下文更值。",
    })
  }

  if (topFrictions.some((item) => item.key === "工具失败")) {
    wins.push({
      title: "把工具失败与事件噪声分层处理",
      body: "先识别真实失败，再决定是否写入摩擦统计，避免被事件流碎片误导。",
    })
  }

  if (analyzedSessions.some((session) => session.totalChars > 12000)) {
    wins.push({
      title: "对长输出做摘要，不再整段背着走",
      body: "部分 session 文本体量明显偏大，后续尽量改为摘要式延续。",
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

function renderExecutiveSummary(report) {
  const friction = report.counts.frictions.slice(0, 3).map((item) => `${item.key} ${item.count} 次`).join("、")
  const repeated = report.repeatedInstructions.slice(0, 2).map((item) => htmlEscape(item.text)).join("；")
  return [
    `<p>最近 ${report.meta.days} 天内共分析 <strong>${report.meta.analyzedSessions}</strong> 个采样 session，覆盖 <strong>${report.meta.totalSessions}</strong> 个近期 session。任务完成率约为 <strong>${report.meta.completionRate}</strong>，摩擦率约为 <strong>${report.meta.frictionRate}</strong>。</p>`,
    `<p>时间分布已使用真实 session 时间源重算，当前覆盖 <strong>${report.meta.activeDays}</strong> 个活跃日，范围为 <strong>${htmlEscape(report.meta.dateRange)}</strong>。</p>`,
    `<p>最明显的摩擦集中在：<strong>${htmlEscape(friction || "暂无高频摩擦")}</strong>。</p>`,
    `<p>最值得立刻做的事不是继续堆 prompt，而是把重复表达固化成规则或 skill。高频候选包括：<strong>${repeated || "当前样本还不足以形成稳定候选"}</strong>。</p>`,
  ].join("\n")
}

function renderFrictionAnalysis(report) {
  const topCounts = report.counts.frictions.slice(0, 6)
  const examples = report.examples.frictions.slice(0, 8)

  const summary = topCounts.length
    ? `<ul>${topCounts.map((item) => `<li><strong>${htmlEscape(item.key)}</strong>：${item.count} 次</li>`).join("")}</ul>`
    : "<p>没有识别到明显高频摩擦。</p>"

  const cases = examples.length
    ? renderList(
        examples,
        (item) => `
          <details class="case-card">
            <summary>${htmlEscape(item.type)} — ${htmlEscape(item.sessionTitle || item.sessionID)}</summary>
            <p>${htmlEscape(item.description)}</p>
            ${item.evidence ? `<p><strong>判定依据：</strong>${htmlEscape(item.evidence)}</p>` : ""}
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
    ? `<ul>${report.examples.quickWins.map((item) => `<li><strong>${htmlEscape(item.title)}</strong>：${htmlEscape(item.body)}</li>`).join("")}</ul>`
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
    ...report.examples.patchCandidates.map((item, index) => `- Rule ${index + 1} [${item.type}] (${item.confidence}): ${item.recommendation}`),
  ].join("\n")

  return `<pre><code>${htmlEscape(block)}</code></pre>`
}

function renderDeepSuggestions() {
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
    "__AGENT_DISTRIBUTION_DATA__": JSON.stringify(withPct(report.counts.agents.slice(0, 10)).map((item) => ({ agent: item.key, count: item.count, pct: item.pct }))),
    "__FRICTION_ANALYSIS__": renderFrictionAnalysis(report),
    "__WHATS_WORKING__": renderWhatWorks(report),
    "__QUICK_WINS__": renderQuickWins(report),
    "__AGENTS_MD_SUGGESTIONS__": renderPatchBlock(report),
    "__DEEP_SUGGESTIONS__": renderDeepSuggestions(report),
    "__DIAGNOSTICS_SUMMARY__": summarizeDiagnostics(report),
    "__SESSION_DIAGNOSTICS__": renderSessionDiagnostics(report),
    "__GENERATED_AT__": new Date().toLocaleString(),
  }

  const output = Object.entries(replacements).reduce(
    (current, [needle, value]) => current.replaceAll(needle, value),
    template,
  )

  const leftover = output.match(/__[A-Z0-9_]+__/g)
  if (leftover?.length) {
    throw new Error(`Report template still contains unreplaced placeholders: ${[...new Set(leftover)].join(", ")}`)
  }

  return output
}

function printSummary(report, outputPath) {
  const topFrictions = report.counts.frictions.slice(0, 3).map((item) => `${item.key}(${item.count})`).join(", ") || "none"
  const quickWins = report.examples.quickWins.slice(0, 3).map((item) => item.title).join("; ") || "none"

  console.log(`分析 session：${report.meta.analyzedSessions}/${report.meta.totalSessions}`)
  console.log(`时间范围：${report.meta.dateRange}`)
  console.log(`活跃天数：${report.meta.activeDays}`)
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
  const outputPath = path.join(ROOT, args.output || "insights-report.html")
  const templatePath = path.join(ROOT, "templates", "report-template.html")

  const allRecentSessions = filterSessionsByDays(listSessions({ maxCount }), days)
  const sampledSessions = sampleSessions(allRecentSessions, 30)

  const analyzed = []
  for (const session of sampledSessions) {
    try {
      const exportData = exportSession(session.id)
      const analyzedSession = analyzeSession(session, exportData)
      if (analyzedSession.messages.length >= 3) {
        analyzed.push(analyzedSession)
      }
    } catch (error) {
      console.warn(`Skipped session ${session.id}: ${error.message}`)
    }
  }

  if (!allRecentSessions.length || !analyzed.length) {
    throw new Error("No recent sessions could be analyzed. Make sure OpenCode has local session history and that `opencode export <sessionID>` works.")
  }

  const mergedSessions = allRecentSessions.map((session) => analyzed.find((entry) => entry.id === session.id) || session)
  const report = aggregateInsights(mergedSessions, analyzed, days)
  const template = loadTemplate(templatePath)
  const html = fillTemplate(template, report)

  saveJson(path.join(ANALYSIS_DIR, "insights.json"), report)
  saveText(outputPath, html)
  printSummary(report, outputPath)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
