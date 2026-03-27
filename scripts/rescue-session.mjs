#!/usr/bin/env node

import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  ANALYSIS_DIR,
  CURRENT_TASK_YAML_PATH,
  GUARD_PATH,
  MEMORY_CORE_PATH,
  RESCUE_DIR,
  RESCUE_LATEST_DIR,
  SITUATION_MD_PATH,
  appendJournalEntry,
  exportSession,
  extractMessages,
  filterSessionsByDays,
  listSessions,
  readCurrentTaskAnchor,
  readTextIfExists,
  readArgs,
  saveJson,
  saveText,
} from "./contextos-lib.mjs"

function summarizeExport(session, exportData) {
  const messages = extractMessages(exportData)
  const userCount = messages.filter((msg) => msg.role === "user").length
  const assistantCount = messages.filter((msg) => msg.role === "assistant").length
  const toolCount = messages.filter((msg) => msg.role === "tool").length
  const preview = messages.slice(0, 4).map((msg) => `${msg.role}: ${msg.text.slice(0, 120)}`).join("\n")

  return {
    id: session.id,
    title: session.title,
    project: session.project,
    updatedAt: session.updatedAt || session.createdAt,
    messageCount: messages.length,
    userCount,
    assistantCount,
    toolCount,
    preview,
  }
}

function buildContinuePrompt(state) {
  const topSnapshot = state.snapshots[0]
  const nextStep = state.currentTaskAnchor?.next_steps?.[0] || "先刷新 current-task 与 guard，再继续主线"
  const topFile = state.currentTaskAnchor?.active_files?.[0] || ".contextos/tasks/current-task.yaml"

  return [
    "# Continue Prompt",
    "",
    "Use this state bundle as the source of truth before reading transcript history.",
    "",
    "## What we are doing now",
    `- ${state.currentTaskAnchor?.title || "(missing current task title)"}`,
    `- ${state.currentTaskAnchor?.summary || "(missing current task summary)"}`,
    "",
    "## What to open first",
    `1. ${topFile}`,
    "2. .contextos/tasks/situation.md",
    "3. .contextos/guard/SESSION_GUARD.md",
    "",
    "## Next action",
    `- ${nextStep}`,
    "",
    "## Must-carry constraints",
    ...(state.mustSurviveConstraints.length
      ? state.mustSurviveConstraints.map((item) => `- ${item}`)
      : ["- Stay local-first", "- Do not add cloud sync"]),
    "",
    "## Rescue pointers",
    `- latest snapshot file: ${topSnapshot ? `.contextos/rescue/${topSnapshot.id}.json` : "(none)"}`,
    "- restore summary: .contextos/rescue/latest/restore-summary.md",
    "- latest state json: .contextos/rescue/latest/latest-snapshot.json",
    "",
  ].join("\n")
}

function buildRestoreSummary(state) {
  const topSnapshot = state.snapshots[0]
  const nextStep = state.currentTaskAnchor?.next_steps?.[0] || "(missing)"
  const topFile = state.currentTaskAnchor?.active_files?.[0] || ".contextos/tasks/current-task.yaml"

  return [
    "# Restore Summary",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## 当前在做什么",
    `- ${state.currentTaskAnchor?.title || "(missing)"}`,
    `- ${state.currentTaskAnchor?.summary || "(missing)"}`,
    "",
    "## 现在最该看哪个文件",
    `- ${topFile}`,
    "- .contextos/tasks/situation.md",
    "- .contextos/guard/SESSION_GUARD.md",
    "",
    "## 下一步做什么",
    `1. ${nextStep}`,
    "",
    "## 必须带着走的约束",
    ...(state.mustSurviveConstraints.length
      ? state.mustSurviveConstraints.map((item) => `- ${item}`)
      : ["- Stay local-first", "- Do not add cloud sync", "- Prefer reviewable patches"]),
    "",
    "## 最近可恢复快照",
    topSnapshot
      ? `- ${topSnapshot.id} (${topSnapshot.updatedAt}, messages=${topSnapshot.messageCount})`
      : "- (none)",
    "",
  ].join("\n")
}

function extractConstraints(guardText = "") {
  const lines = String(guardText || "").split(/\r?\n/)
  const start = lines.findIndex((line) => /##\s*Constraints that must survive compaction/i.test(line.trim()))
  if (start === -1) return []
  const result = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (/^##\s+/.test(line)) break
    const match = line.match(/^[-*]\s+(.*)$/)
    if (match?.[1]) result.push(match[1].trim())
  }
  return result
}

async function main() {
  const args = readArgs()
  const maxCount = Number(args["max-count"] || 20)
  const days = Number(args.days || 30)

  const sessions = filterSessionsByDays(listSessions({ maxCount }), days).slice(0, maxCount)
  if (!sessions.length) {
    throw new Error("No recent sessions found to rescue.")
  }

  const summaries = []
  const currentTaskAnchor = readCurrentTaskAnchor(CURRENT_TASK_YAML_PATH)

  for (const session of sessions) {
    try {
      const exportData = exportSession(session.id)
      saveJson(path.join(RESCUE_DIR, `${session.id}.json`), exportData)
      summaries.push(summarizeExport(session, exportData))
    } catch (error) {
      console.warn(`Skipped session ${session.id}: ${error.message}`)
    }
  }

  if (!summaries.length) {
    throw new Error("No rescue snapshots were created.")
  }

  summaries.sort((a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime())

  const guardText = readTextIfExists(GUARD_PATH, "")
  const situation = readTextIfExists(SITUATION_MD_PATH, "")
  const memoryCore = readTextIfExists(MEMORY_CORE_PATH, "")
  const mustSurviveConstraints = extractConstraints(guardText)

  const stateBundle = {
    generatedAt: new Date().toISOString(),
    sourceOfTruth: {
      currentTask: CURRENT_TASK_YAML_PATH,
      situation: SITUATION_MD_PATH,
      guard: GUARD_PATH,
      memory: MEMORY_CORE_PATH,
    },
    currentTaskAnchor,
    situationPreview: situation.split(/\r?\n/).filter(Boolean).slice(0, 20),
    memoryPreview: memoryCore.split(/\r?\n/).filter(Boolean).slice(0, 20),
    mustSurviveConstraints,
    snapshots: summaries,
    recommendedOpenFile: currentTaskAnchor?.active_files?.[0] || ".contextos/tasks/current-task.yaml",
    nextAction: currentTaskAnchor?.next_steps?.[0] || "先刷新 task/guard，再继续主线",
  }

  saveJson(path.join(RESCUE_LATEST_DIR, "latest-snapshot.json"), stateBundle)
  saveText(path.join(RESCUE_LATEST_DIR, "restore-summary.md"), `${buildRestoreSummary(stateBundle)}\n`)
  saveText(path.join(RESCUE_LATEST_DIR, "continue-prompt.md"), `${buildContinuePrompt(stateBundle)}\n`)

  const markdown = [
    "# ContextOS rescue index",
    "",
    `Generated at: ${stateBundle.generatedAt}`,
    "",
    "## Source of truth",
    `- task: ${CURRENT_TASK_YAML_PATH}`,
    `- situation: ${SITUATION_MD_PATH}`,
    `- guard: ${GUARD_PATH}`,
    `- memory: ${MEMORY_CORE_PATH}`,
    "",
    "## Recovery helper files",
    "- .contextos/rescue/latest/restore-summary.md",
    "- .contextos/rescue/latest/latest-snapshot.json",
    "- .contextos/rescue/latest/continue-prompt.md",
    "",
    ...summaries.map((item) => [
      `## ${item.title || item.id}`,
      `- id: \`${item.id}\``,
      `- project: \`${item.project}\``,
      `- updatedAt: ${item.updatedAt}`,
      `- messages: ${item.messageCount}`,
      `- snapshot: \`.contextos/rescue/${item.id}.json\``,
      "",
      "```text",
      item.preview || "(no preview)",
      "```",
      "",
    ].join("\n")),
  ].join("\n")

  saveText(path.join(RESCUE_DIR, "index.md"), markdown)

  appendJournalEntry({
    type: "rescue_latest",
    title: currentTaskAnchor?.title || "rescue-latest",
    summary: "rescue latest helper bundle generated",
    files: [
      ".contextos/rescue/latest/restore-summary.md",
      ".contextos/rescue/latest/latest-snapshot.json",
      ".contextos/rescue/latest/continue-prompt.md",
    ],
    next_steps: currentTaskAnchor?.next_steps || [],
    constraints: mustSurviveConstraints,
  })

  console.log(`已镜像 ${summaries.length} 个 session`)
  console.log(`最新快照：.contextos/rescue/${summaries[0].id}.json`)
  console.log(`恢复摘要：.contextos/rescue/latest/restore-summary.md`)
  console.log(`继续提示：.contextos/rescue/latest/continue-prompt.md`)
  if (currentTaskAnchor) {
    console.log(`当前任务：${currentTaskAnchor.title} (${currentTaskAnchor.domain}/${currentTaskAnchor.scope}/${currentTaskAnchor.durability})`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
