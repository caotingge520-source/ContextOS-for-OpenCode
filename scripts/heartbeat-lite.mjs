#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import {
  ANALYSIS_DIR,
  CURRENT_TASK_YAML_PATH,
  GUARD_PATH,
  JOURNAL_DIR,
  readCurrentTaskAnchor,
} from "./contextos-lib.mjs"

const GUARD_SNAPSHOT_LATEST = path.join(path.dirname(GUARD_PATH), "snapshots", "latest.json")

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

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function collectIssues() {
  const issues = []

  const currentTask = readCurrentTaskAnchor(CURRENT_TASK_YAML_PATH)
  if (!currentTask || !String(currentTask.title || "").trim() || !String(currentTask.summary || "").trim()) {
    issues.push({
      id: "missing_current_task",
      level: "red",
      evidence: "current-task.yaml missing or empty",
      action: "Run: node scripts/refresh-current-task.mjs",
    })
  }

  if (!fs.existsSync(GUARD_PATH)) {
    issues.push({
      id: "guard_file_missing",
      level: "red",
      evidence: "SESSION_GUARD.md missing",
      action: "Run: node scripts/refresh-current-task.mjs && node scripts/snapshot-guard.mjs",
    })
  }

  const guardSnapshot = readJsonIfExists(GUARD_SNAPSHOT_LATEST)
  const guardAge = hoursSince(guardSnapshot?.generatedAt)
  if (!guardSnapshot) {
    issues.push({
      id: "guard_snapshot_missing",
      level: "yellow",
      evidence: "guard write-ahead snapshot missing",
      action: "Run: node scripts/snapshot-guard.mjs",
    })
  } else if (guardAge == null || guardAge > 12) {
    issues.push({
      id: "guard_snapshot_stale",
      level: "yellow",
      evidence: `guard snapshot age=${guardAge == null ? "unknown" : `${guardAge}h`}`,
      action: "Run: node scripts/snapshot-guard.mjs",
    })
  }

  const journalFiles = fs.existsSync(JOURNAL_DIR)
    ? fs.readdirSync(JOURNAL_DIR).filter((name) => name.endsWith(".json"))
    : []
  if (journalFiles.length > 0 && guardSnapshot?.generatedAt) {
    const latestJournal = journalFiles
      .map((name) => {
        const stat = fs.statSync(path.join(JOURNAL_DIR, name))
        return { name, mtime: stat.mtime, path: path.join(JOURNAL_DIR, name) }
      })
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())[0]
    const latestJournalAt = latestJournal?.mtime?.toISOString()
    const latestJournalPayload = readJsonIfExists(latestJournal?.path)
    const sameCycleSnapshot = latestJournalPayload?.type === "guard_snapshot"
      && latestJournalPayload?.metadata?.generatedAt
      && new Date(latestJournalPayload.metadata.generatedAt).getTime() >= new Date(guardSnapshot.generatedAt).getTime()

    if (!sameCycleSnapshot && latestJournalAt && new Date(latestJournalAt).getTime() > new Date(guardSnapshot.generatedAt).getTime()) {
      issues.push({
        id: "journal_unflushed",
        level: "yellow",
        evidence: `journal newer than guard snapshot (${latestJournal.name})`,
        action: "Run: node scripts/snapshot-guard.mjs",
      })
    }
  }

  const budget = readJsonIfExists(path.join(ANALYSIS_DIR, "context-budget.json"))
  if (budget?.riskLevel === "red") {
    const top = budget.topRiskSources?.[0]?.label || "unknown"
    issues.push({
      id: "context_risk_high",
      level: "red",
      evidence: `context budget red, top=${top}`,
      action: budget.immediateAction?.title || "Run: node scripts/context-budget.mjs",
    })
  }

  return issues
}

async function main() {
  const issues = collectIssues()
  if (!issues.length) {
    console.log("HEARTBEAT_OK")
    return
  }

  const top = issues.sort((a, b) => (a.level === "red" ? -1 : 1))[0]
  console.log(`HEARTBEAT_WARN ${top.level.toUpperCase()} ${top.id}`)
  console.log(`evidence: ${top.evidence}`)
  console.log(`action: ${top.action}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
