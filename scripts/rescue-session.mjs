#!/usr/bin/env node

import path from "node:path"
import {
  RESCUE_DIR,
  exportSession,
  extractMessages,
  filterSessionsByDays,
  listSessions,
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

async function main() {
  const args = readArgs()
  const maxCount = Number(args["max-count"] || 20)
  const days = Number(args.days || 30)

  const sessions = filterSessionsByDays(listSessions({ maxCount }), days).slice(0, maxCount)
  if (!sessions.length) {
    throw new Error("No recent sessions found to rescue.")
  }

  const summaries = []

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

  const markdown = [
    "# ContextOS rescue index",
    "",
    `Generated at: ${new Date().toISOString()}`,
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

  console.log(`已镜像 ${summaries.length} 个 session`)
  console.log(`最新快照：.contextos/rescue/${summaries[0].id}.json`)
  console.log(`索引文件：.contextos/rescue/index.md`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
