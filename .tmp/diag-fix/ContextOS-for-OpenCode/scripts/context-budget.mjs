#!/usr/bin/env node

import path from "node:path"
import {
  ANALYSIS_DIR,
  exportSession,
  extractMessages,
  extractRepeatedInstructions,
  filterSessionsByDays,
  listSessions,
  normalizeTextForMatch,
  readArgs,
  sampleSessions,
  saveJson,
} from "./contextos-lib.mjs"

function analyzeSessionWeight(session, exportData) {
  const messages = extractMessages(exportData)
  const totalChars = messages.reduce((sum, msg) => sum + msg.text.length, 0)
  const longMessages = messages
    .filter((msg) => msg.text.length > 2500)
    .map((msg) => ({
      role: msg.role,
      name: msg.name,
      chars: msg.text.length,
      preview: msg.text.slice(0, 180),
    }))
    .slice(0, 5)

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
    totalChars,
    longMessages,
    repeatedReadPatterns: repeatedReadPatterns.slice(0, 3),
    messages,
  }
}

function buildRecommendations(report) {
  const actions = []

  if (report.repeatedInstructions.length) {
    actions.push({
      title: "把重复指令移入 AGENTS.md",
      reason: "跨 session 已经出现稳定重复偏好，继续临时口头说明只会增加上下文税。",
    })
  }

  if (report.heaviestSessions.some((session) => session.longMessages.length > 0)) {
    actions.push({
      title: "把长工具输出改成摘要延续",
      reason: "最近 session 里已经出现多段超长文本，应该用摘要保留结论而不是整段沿用。",
    })
  }

  if (report.noisySessions.some((session) => session.repeatedReadPatterns.length > 0)) {
    actions.push({
      title: "把重复流程抽成 skill",
      reason: "你在单个 session 内多次重复相同工作模式，适合做成一条 skill。",
    })
  }

  actions.push({
    title: "长会话前先刷新 SESSION_GUARD.md",
    reason: "在进入复杂任务或大重构前先固化当前任务状态，可以显著降低 compaction 后丢失目标的概率。",
  })

  return actions.slice(0, 4)
}

async function main() {
  const args = readArgs()
  const days = Number(args.days || 14)
  const maxCount = Number(args["max-count"] || 80)

  const sessions = sampleSessions(filterSessionsByDays(listSessions({ maxCount }), days), 20)
  const analyzed = []

  for (const session of sessions) {
    try {
      const exportData = exportSession(session.id)
      analyzed.push(analyzeSessionWeight(session, exportData))
    } catch (error) {
      console.warn(`Skipped session ${session.id}: ${error.message}`)
    }
  }

  if (!analyzed.length) {
    throw new Error("No sessions available for context budget analysis.")
  }

  const repeatedInstructions = extractRepeatedInstructions(analyzed, 2)

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

  const report = {
    generatedAt: new Date().toISOString(),
    days,
    scannedSessions: analyzed.length,
    heaviestSessions,
    noisySessions,
    repeatedInstructions,
    recommendedActions: buildRecommendations({
      repeatedInstructions,
      heaviestSessions,
      noisySessions,
    }),
  }

  const filePath = path.join(ANALYSIS_DIR, "context-budget.json")
  saveJson(filePath, report)

  console.log(`已扫描 ${report.scannedSessions} 个 session`)
  console.log(`最重的 session：${heaviestSessions[0]?.title || heaviestSessions[0]?.id || "unknown"}`)
  console.log(`建议动作：`)
  report.recommendedActions.slice(0, 3).forEach((item, index) => {
    console.log(`${index + 1}. ${item.title} — ${item.reason}`)
  })
  console.log(`输出文件：${filePath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
