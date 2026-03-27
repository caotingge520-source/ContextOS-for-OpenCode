#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  CURRENT_TASK_YAML_PATH,
  GUARD_PATH,
  JOURNAL_DIR,
  SITUATION_MD_PATH,
  appendJournalEntry,
  readCurrentTaskAnchor,
  readTextIfExists,
  saveJson,
  saveText,
} from "./contextos-lib.mjs"

const GUARD_SNAPSHOT_DIR = path.join(path.dirname(GUARD_PATH), "snapshots")

function parseSection(text, heading) {
  const lines = String(text || "").split(/\r?\n/)
  const title = `## ${heading}`
  const start = lines.findIndex((line) => line.trim() === title)
  if (start === -1) return []
  const items = []
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (/^##\s+/.test(line)) break
    const match = line.match(/^[-\d]+\.\s+(.*)$/) || line.match(/^[-*]\s+(.*)$/)
    if (match?.[1]) items.push(match[1].trim())
  }
  return items
}

function upsertGuardSnapshotMeta(guardText, snapshot) {
  const lines = String(guardText || "# Session Guard\n\n").split(/\r?\n/)
  const heading = "## Last write-ahead snapshot"
  const block = [
    heading,
    `- generatedAt: ${snapshot.generatedAt}`,
    `- snapshot: .contextos/guard/snapshots/${snapshot.fileName}`,
    `- task: ${snapshot.taskTitle}`,
    `- identity: ${snapshot.domain}/${snapshot.scope}/${snapshot.durability}`,
    "",
  ]

  const start = lines.findIndex((line) => line.trim() === heading)
  if (start === -1) {
    return `${lines.join("\n").trimEnd()}\n\n${block.join("\n")}`
  }

  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i].trim())) {
      end = i
      break
    }
  }

  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join("\n")
}

function buildSnapshot() {
  const anchor = readCurrentTaskAnchor(CURRENT_TASK_YAML_PATH)
  if (!anchor) {
    throw new Error("Cannot snapshot guard: current-task.yaml missing")
  }

  const guardText = readTextIfExists(GUARD_PATH, "# Session Guard\n\n")
  const situationText = readTextIfExists(SITUATION_MD_PATH, "")
  const recentDecisions = parseSection(guardText, "Recent decisions")
  const constraints = parseSection(guardText, "Constraints that must survive compaction")
  const nextSteps = parseSection(guardText, "Next 3 steps")

  const generatedAt = new Date().toISOString()
  const fileName = `${generatedAt.replace(/[:.]/g, "-")}.json`

  return {
    generatedAt,
    fileName,
    taskTitle: anchor.title,
    domain: anchor.domain,
    scope: anchor.scope,
    durability: anchor.durability,
    activeFiles: anchor.active_files,
    recentDecisions: recentDecisions.length ? recentDecisions : anchor.evidence.slice(0, 5),
    nextSteps: nextSteps.length ? nextSteps : anchor.next_steps,
    mustSurviveConstraints: constraints.length ? constraints : anchor.constraints,
    situationSummary: situationText.split(/\r?\n/).filter(Boolean).slice(0, 14).join("\n"),
    sourceOfTruth: {
      currentTask: CURRENT_TASK_YAML_PATH,
      situation: SITUATION_MD_PATH,
      guard: GUARD_PATH,
    },
  }
}

async function main() {
  const snapshot = buildSnapshot()
  const snapshotPath = path.join(GUARD_SNAPSHOT_DIR, snapshot.fileName)
  const latestPath = path.join(GUARD_SNAPSHOT_DIR, "latest.json")

  saveJson(snapshotPath, snapshot)
  saveJson(latestPath, snapshot)

  const guardText = readTextIfExists(GUARD_PATH, "# Session Guard\n\n")
  saveText(GUARD_PATH, `${upsertGuardSnapshotMeta(guardText, snapshot).trimEnd()}\n`)

  appendJournalEntry({
    type: "guard_snapshot",
    title: snapshot.taskTitle,
    summary: "write-ahead guard snapshot created",
    files: snapshot.activeFiles,
    next_steps: snapshot.nextSteps,
    constraints: snapshot.mustSurviveConstraints,
    metadata: {
      snapshotPath,
      latestPath,
      journalDir: JOURNAL_DIR,
      generatedAt: snapshot.generatedAt,
    },
  })

  console.log(`Guard snapshot written: ${snapshotPath}`)
  console.log(`Guard latest snapshot: ${latestPath}`)
  console.log(`Guard updated: ${GUARD_PATH}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
