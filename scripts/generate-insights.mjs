#!/usr/bin/env node

import path from "node:path"
import {
  ANALYSIS_DIR,
  ROOT,
  classifyOutcome,
  classifyTask,
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

function analyzeSession(session, exportData) {
  const messages = extractMessages(exportData)
    .map((msg) => ({
      ...msg,
      text: msg.text.replace(/\u0000/g, "").trim(),
    }))
    .filter((msg) => msg.text || msg.name)

  const task = classifyTask(messages)
  const outcome = classifyOutcome(messages)
  const frictions = detectFriction(messages)
  const toolNames = extractToolNames(messages)
  const totalChars = messages.reduce((sum, msg) => sum + msg.text.length, 0)
  const userMessages = messages.filter((msg) => msg.role === "user").length

  return {
    ...session,
    messages,
    task,
    outcome,
    frictions,
    toolNames,
    totalChars,
    userMessages,
  }
}

function aggregateInsights(allSessions, analyzedSessions, days) {
  const totalMessages = analyzedSessions.reduce((sum, session) => sum + session.messages.length, 0)
  const activeDays = new Set(
    allSessions
      .map((session) => new Date(session.updatedAt || session.createdAt || Date.now()).toISOString().slice(0, 10))
      .filter(Boolean),
  ).size

  const frictionEntries = analyzedSessions.flatMap((session) =>
    session.frictions.map((friction) => ({ ...friction, sessionID: session.id, sessionTitle: session.title })),
  )
  const frictionCounts = countBy(frictionEntries, (entry) => entry.type).sort((a, b) => b.count - a.count)
  const taskCounts = countBy(analyzedSessions, (session) => session.task).sort((a, b) => b.count - a.count)
  const outcomeCounts = countBy(analyzedSessions, (session) => session.outcome).sort((a, b) => b.count - a.count)
  const agentCounts = countBy(allSessions, (session) => session.agent || "unknown-agent").sort((a, b) => b.count - a.count)

  const toolCounts = countBy(
    analyzedSessions.flatMap((session) => session.toolNames),
    (tool) => tool,
  ).sort((a, b) => b.count - a.count)

  const repeatedInstructions = extractRepeatedInstructions(analyzedSessions, 3)
  const achievedCount = analyzedSessions.filter((session) => session.outcome === "achieved").length
  const frictionSessionCount = analyzedSessions.filter((session) => session.frictions.length > 0).length
  const avgSessionLength = analyzedSessions.length
    ? Math.round(totalMessages / analyzedSessions.length)
    : 0

  const topProjects = summarizeProjects(allSessions)
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
      dateRange: formatDateRange(allSessions),
      dailyAverageSessions: activeDays ? (allSessions.length / activeDays).toFixed(1) : "0.0",
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
      outcome: session.outcome,
      frictionCount: session.frictions.length,
      messageCount: session.messages.length,
      totalChars: session.totalChars,
      project: session.project,
      updatedAt: session.updatedAt || session.createdAt,
    })),
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
    "__GENERATED_AT__": new Date().toLocaleString(),
  }

  return Object.entries(replacements).reduce(
    (output, [needle, value]) => output.replaceAll(needle, value),
    template,
  )
}

function printSummary(report, outputPath) {
  const topFrictions = report.counts.frictions.slice(0, 3).map((item) => `${item.key}(${item.count})`).join(", ") || "none"
  const quickWins = report.examples.quickWins.slice(0, 3).map((item) => item.title).join("; ") || "none"

  console.log(`分析 session：${report.meta.analyzedSessions}/${report.meta.totalSessions}`)
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

  const report = aggregateInsights(allRecentSessions, analyzed, days)
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
