#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import {
  ANALYSIS_DIR,
  CURRENT_TASK_MD_PATH,
  CURRENT_TASK_YAML_PATH,
  GUARD_PATH,
  MEMORY_CORE_PATH,
  ROOT,
  SITUATION_MD_PATH,
  appendJournalEntry,
  exportSession,
  extractMessages,
  inferTaskIdentityRouting,
  listSessions,
  parseJsonLoose,
  readArgs,
  readCurrentTaskAnchor,
  renderCurrentTaskMarkdown,
  readTextIfExists,
  saveCurrentTaskAnchor,
  saveText,
} from "./contextos-lib.mjs"

function splitListArg(value) {
  return String(value || "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseGuardSection(text, heading) {
  const lines = String(text || "").split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`)
  if (start === -1) return []

  const items = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^##\s+/.test(line.trim())) break
    const bullet = line.match(/^[-\d]+\.\s+(.*)$/) || line.match(/^\-\s+(.*)$/)
    if (bullet?.[1]) {
      items.push(bullet[1].trim())
    }
  }
  return items
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return parseJsonLoose(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
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
      if (results.size >= 12) {
        return [...results]
      }
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
    const shellCalls = text.match(/\b(node\s+scripts\/[\w.-]+\.mjs(?:\s+--[\w-]+(?:\s+[^\s]+)?)*)/g) || []
    for (const call of shellCalls) {
      results.add(call.trim())
    }
  }
  return [...results].slice(0, 12)
}

function summarizeRequest(args, previousAnchor) {
  if (args.summary) return String(args.summary)
  if (args.request) return String(args.request)
  if (previousAnchor?.summary) return previousAnchor.summary
  return "refresh current task identity routing anchor"
}

function summarizeTitle(args, summary, previousAnchor) {
  if (args.title) return String(args.title)
  if (previousAnchor?.title) return previousAnchor.title
  return summary.slice(0, 72)
}

function resolveRecentSessionMessages(timeoutMs) {
  const sessions = listSessions({ maxCount: 6 })
  const latest = sessions[0]
  if (!latest?.id) return []
  const exportData = exportSession(latest.id, { timeoutMs })
  return extractMessages(exportData)
}

function upsertSection(markdown, heading, blockLines) {
  const lines = String(markdown || "").split(/\r?\n/)
  const title = `## ${heading}`
  const start = lines.findIndex((line) => line.trim() === title)

  if (start === -1) {
    const suffix = lines.length && lines[lines.length - 1] ? [""] : []
    return [...lines, ...suffix, title, ...blockLines, ""].join("\n")
  }

  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index].trim())) {
      end = index
      break
    }
  }

  return [...lines.slice(0, start + 1), ...blockLines, ...lines.slice(end)].join("\n")
}

function syncGuardFromAnchor(anchor, guardPath = GUARD_PATH) {
  const existing = fs.existsSync(guardPath)
    ? fs.readFileSync(guardPath, "utf8")
    : "# Session Guard\n\n"

  const anchorBlock = [
    `- title: ${anchor.title}`,
    `- domain: ${anchor.domain}`,
    `- scope: ${anchor.scope}`,
    `- durability: ${anchor.durability}`,
    `- confidence: ${anchor.confidence}`,
    `- object: ${anchor.object_type} / ${anchor.object_name}`,
  ]

  const activeFilesBlock = anchor.active_files.length
    ? anchor.active_files.map((item) => `- ${item}`)
    : ["- (none)"]
  const constraintsBlock = anchor.constraints.length
    ? anchor.constraints.map((item) => `- ${item}`)
    : ["- (none)"]
  const nextStepsBlock = anchor.next_steps.length
    ? anchor.next_steps.map((item, index) => `${index + 1}. ${item}`)
    : ["1. (none)"]
  const decisionsBlock = parseGuardSection(existing, "Recent decisions").length
    ? parseGuardSection(existing, "Recent decisions")
    : anchor.evidence.slice(0, 5)
  const snapshotBlock = [
    `- generatedAt: ${new Date().toISOString()}`,
    `- task title: ${anchor.title}`,
    `- domain/scope/durability: ${anchor.domain}/${anchor.scope}/${anchor.durability}`,
    `- active files: ${anchor.active_files.length}`,
    `- next steps: ${anchor.next_steps.length}`,
  ]

  let output = existing
  output = upsertSection(output, "Current task", [
    `- ${anchor.title}`,
  ])
  output = upsertSection(output, "Current task anchor", anchorBlock)
  output = upsertSection(output, "State snapshot metadata", snapshotBlock)
  output = upsertSection(output, "Active files", activeFilesBlock)
  output = upsertSection(output, "Recent decisions", decisionsBlock.map((item) => `- ${item}`))
  output = upsertSection(output, "Constraints that must survive compaction", constraintsBlock)
  output = upsertSection(output, "Next 3 steps", nextStepsBlock)
  saveText(guardPath, output.trimEnd() + "\n")
}

function writeSituation(anchor) {
  const lines = [
    "# Current Situation",
    "",
    `Generated at: ${new Date().toISOString()}`,
    "",
    "## What we are doing",
    `- ${anchor.title}`,
    `- ${anchor.summary || "(no summary)"}`,
    "",
    "## Task identity",
    `- domain: ${anchor.domain}`,
    `- scope: ${anchor.scope}`,
    `- durability: ${anchor.durability}`,
    `- object: ${anchor.object_type} / ${anchor.object_name}`,
    "",
    "## Active files",
    ...(anchor.active_files.length ? anchor.active_files.map((item) => `- ${item}`) : ["- (none)"]),
    "",
    "## Recent decisions",
    ...(anchor.evidence.length ? anchor.evidence.slice(0, 5).map((item) => `- ${item}`) : ["- (none)"]),
    "",
    "## Next steps",
    ...(anchor.next_steps.length ? anchor.next_steps.map((item, index) => `${index + 1}. ${item}`) : ["1. (none)"]),
    "",
  ]
  saveText(SITUATION_MD_PATH, `${lines.join("\n")}\n`)
}

function updateMemoryCore(anchor) {
  const existing = readTextIfExists(MEMORY_CORE_PATH, "")
  const marker = `## ${new Date().toISOString()}`
  const block = [
    marker,
    `- task: ${anchor.title}`,
    `- identity: ${anchor.domain}/${anchor.scope}/${anchor.durability}`,
    `- next step: ${anchor.next_steps[0] || "(none)"}`,
    `- constraint: ${anchor.constraints[0] || "(none)"}`,
    "",
  ].join("\n")
  const nextContent = existing.trim()
    ? `${existing.trimEnd()}\n\n${block}`
    : `# Core Discoveries\n\n${block}`
  saveText(MEMORY_CORE_PATH, `${nextContent.trimEnd()}\n`)
}

async function main() {
  const args = readArgs()
  const timeoutMs = Number(args["export-timeout-ms"] || 8000)
  const previousAnchor = readCurrentTaskAnchor(CURRENT_TASK_YAML_PATH)
  const guardText = fs.existsSync(GUARD_PATH) ? fs.readFileSync(GUARD_PATH, "utf8") : ""

  let recentMessages = []
  try {
    recentMessages = resolveRecentSessionMessages(timeoutMs)
  } catch {
    recentMessages = []
  }

  const inferredActiveFiles = extractFileHints(recentMessages)
  const inferredCommands = extractCommandHints(recentMessages)
  const guardActiveFiles = parseGuardSection(guardText, "Active files")
  const guardConstraints = parseGuardSection(guardText, "Constraints that must survive compaction")
  const guardNextSteps = parseGuardSection(guardText, "Next 3 steps")

  const insightsData = readJsonIfExists(path.join(ANALYSIS_DIR, "insights.json"))
  const contextBudgetData = readJsonIfExists(path.join(ANALYSIS_DIR, "context-budget.json"))
  const repeatedInstructionCount = Math.max(
    Number(insightsData?.repeatedInstructions?.[0]?.count || 0),
    Number(contextBudgetData?.repeatedInstructions?.[0]?.count || 0),
  )

  const summary = summarizeRequest(args, previousAnchor)
  const title = summarizeTitle(args, summary, previousAnchor)
  const identity = inferTaskIdentityRouting({
    userRequest: summary,
    recentMessages,
    activeFiles: splitListArg(args["active-files"]).length
      ? splitListArg(args["active-files"])
      : [...inferredActiveFiles, ...guardActiveFiles].slice(0, 12),
    recentCommands: splitListArg(args["recent-commands"]).length
      ? splitListArg(args["recent-commands"])
      : inferredCommands,
    cwd: args.cwd || ROOT,
    repeatedInstructionCount,
  })

  const anchor = {
    task_id: args["task-id"] || previousAnchor?.task_id || `task-${Date.now()}`,
    title,
    summary,
    domain: args.domain || identity.domain,
    object_type: args["object-type"] || identity.object_type,
    object_name: args["object-name"] || identity.object_name,
    scope: args.scope || identity.scope,
    durability: args.durability || identity.durability,
    confidence: args.confidence ? Number(args.confidence) : identity.confidence,
    active_files: splitListArg(args["active-files"]).length
      ? splitListArg(args["active-files"])
      : [...inferredActiveFiles, ...guardActiveFiles].slice(0, 12),
    recent_commands: splitListArg(args["recent-commands"]).length
      ? splitListArg(args["recent-commands"])
      : inferredCommands,
    constraints: splitListArg(args.constraints).length
      ? splitListArg(args.constraints)
      : guardConstraints,
    next_steps: splitListArg(args["next-steps"]).length
      ? splitListArg(args["next-steps"])
      : guardNextSteps,
    updated_at: new Date().toISOString(),
    evidence: [
      ...identity.evidence,
      recentMessages.length ? `recentMessages=${recentMessages.length}` : "recentMessages=0 (fallback)",
      repeatedInstructionCount ? `repeatedInstructionCount=${repeatedInstructionCount}` : "repeatedInstructionCount=0",
    ],
  }

  const saved = saveCurrentTaskAnchor(anchor, {
    yamlPath: CURRENT_TASK_YAML_PATH,
    mdPath: CURRENT_TASK_MD_PATH,
  })

  if (args["no-guard-sync"] !== true) {
    syncGuardFromAnchor(saved.anchor)
  }

  writeSituation(saved.anchor)
  updateMemoryCore(saved.anchor)
  appendJournalEntry({
    type: "task_refresh",
    title: saved.anchor.title,
    summary: saved.anchor.summary,
    files: saved.anchor.active_files,
    next_steps: saved.anchor.next_steps,
    constraints: saved.anchor.constraints,
    metadata: {
      domain: saved.anchor.domain,
      scope: saved.anchor.scope,
      durability: saved.anchor.durability,
      confidence: saved.anchor.confidence,
    },
  })

  const latest = renderCurrentTaskMarkdown(saved.anchor)
  if (args.stdout === true) {
    process.stdout.write(`${latest}\n`)
  }

  console.log(`Task anchor written: ${saved.yamlPath}`)
  console.log(`Task summary written: ${saved.mdPath}`)
  console.log(`Situation written: ${SITUATION_MD_PATH}`)
  console.log(`Memory core updated: ${MEMORY_CORE_PATH}`)
  console.log(`domain=${saved.anchor.domain} scope=${saved.anchor.scope} durability=${saved.anchor.durability} confidence=${saved.anchor.confidence}`)
  console.log(`Guard synced: ${args["no-guard-sync"] === true ? "no" : GUARD_PATH}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
