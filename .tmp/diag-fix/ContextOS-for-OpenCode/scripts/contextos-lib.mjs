import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { spawnSync } from "node:child_process"

export const ROOT = process.cwd()
export const ANALYSIS_DIR = path.join(ROOT, ".contextos", "analysis")
export const RESCUE_DIR = path.join(ROOT, ".contextos", "rescue")
export const GUARD_PATH = path.join(ROOT, ".contextos", "guard", "SESSION_GUARD.md")

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

export function readArgs(argv = process.argv.slice(2)) {
  const result = { _: [] }
  for (let i = 0; i < argv.length; i += 1) {
    const part = argv[i]
    if (part.startsWith("--")) {
      const key = part.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith("--")) {
        result[key] = next
        i += 1
      } else {
        result[key] = true
      }
    } else {
      result._.push(part)
    }
  }
  return result
}

export function isoDaysAgo(days) {
  const date = new Date()
  date.setDate(date.getDate() - days)
  return date.toISOString()
}

export function parseJsonLoose(raw) {
  const text = String(raw ?? "").trim()
  if (!text) {
    throw new Error("Empty JSON output")
  }

  try {
    return JSON.parse(text)
  } catch {}

  const starts = []
  const firstObject = text.indexOf("{")
  const firstArray = text.indexOf("[")
  if (firstObject !== -1) starts.push(firstObject)
  if (firstArray !== -1) starts.push(firstArray)

  for (const start of starts.sort((a, b) => a - b)) {
    const tail = text.slice(start)
    const endCandidates = []
    const lastObject = tail.lastIndexOf("}")
    const lastArray = tail.lastIndexOf("]")
    if (lastObject !== -1) endCandidates.push(lastObject + 1)
    if (lastArray !== -1) endCandidates.push(lastArray + 1)

    for (const end of endCandidates.sort((a, b) => b - a)) {
      const candidate = tail.slice(0, end)
      try {
        return JSON.parse(candidate)
      } catch {}
    }
  }

  throw new Error("Failed to parse JSON output from OpenCode")
}

export function execJsonCommand(args, options = {}) {
  const command = options.command ?? "opencode"
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
  })

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        "Could not find `opencode` in PATH. Install OpenCode first or run these scripts from an environment where the OpenCode CLI is available.",
      )
    }
    throw result.error
  }

  if (result.status !== 0) {
    const stderr = String(result.stderr || "").trim()
    const stdout = String(result.stdout || "").trim()
    throw new Error(
      `OpenCode command failed: ${command} ${args.join(" ")}\n${stderr || stdout || "Unknown error"}`,
    )
  }

  return parseJsonLoose(result.stdout)
}

export function listSessions({ maxCount = 100 } = {}) {
  const data = execJsonCommand(["session", "list", "--format", "json", "--max-count", String(maxCount)])
  return normalizeSessions(data)
}

export function exportSession(sessionID) {
  return execJsonCommand(["export", sessionID])
}

function toIsoDate(value) {
  if (value == null || value === "") return null
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString()
  }
  if (typeof value === "number") {
    const ms = value > 1e12 ? value : value * 1000
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const text = String(value).trim()
  if (!text) return null
  const numeric = Number(text)
  if (Number.isFinite(numeric) && /^\d{10,13}$/.test(text)) {
    const ms = text.length >= 13 ? numeric : numeric * 1000
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function chooseDateCandidate(candidates = []) {
  for (const candidate of candidates) {
    const iso = toIsoDate(candidate.value)
    if (iso) {
      return {
        value: iso,
        source: candidate.source,
      }
    }
  }
  return { value: null, source: null }
}

export function normalizeSessions(data) {
  const items = Array.isArray(data)
    ? data
    : data?.sessions || data?.items || data?.data || data?.results || []

  return items
    .map((item) => {
      const id =
        item?.id ||
        item?.sessionID ||
        item?.sessionId ||
        item?.session?.id ||
        item?.value?.id ||
        item?.slug ||
        null

      const title =
        item?.title ||
        item?.name ||
        item?.summary ||
        item?.session?.title ||
        item?.value?.title ||
        "Untitled session"

      const created = chooseDateCandidate([
        { value: item?.createdAt, source: "session.createdAt" },
        { value: item?.created_at, source: "session.created_at" },
        { value: item?.startedAt, source: "session.startedAt" },
        { value: item?.timestamp, source: "session.timestamp" },
        { value: item?.session?.createdAt, source: "session.session.createdAt" },
      ])

      const updated = chooseDateCandidate([
        { value: item?.updatedAt, source: "session.updatedAt" },
        { value: item?.updated_at, source: "session.updated_at" },
        { value: item?.lastMessageAt, source: "session.lastMessageAt" },
        { value: item?.endedAt, source: "session.endedAt" },
        { value: item?.session?.updatedAt, source: "session.session.updatedAt" },
        { value: created.value, source: created.source },
      ])

      const messageCount =
        item?.messageCount ||
        item?.messages ||
        item?.stats?.messages ||
        item?.message_count ||
        item?.session?.messageCount ||
        0

      const project =
        item?.project ||
        item?.directory ||
        item?.cwd ||
        item?.worktree ||
        item?.session?.directory ||
        item?.path ||
        "unknown-project"

      const agent = item?.agent || item?.agentName || item?.session?.agent || null
      const agentSource = item?.agent
        ? "session.agent"
        : item?.agentName
          ? "session.agentName"
          : item?.session?.agent
            ? "session.session.agent"
            : null

      return {
        id,
        title,
        createdAt: created.value,
        createdAtSource: created.source,
        updatedAt: updated.value,
        updatedAtSource: updated.source,
        messageCount: Number(messageCount) || 0,
        project,
        agent: agent || "unknown-agent",
        agentSource,
        raw: item,
      }
    })
    .filter((item) => item.id)
}

export function filterSessionsByDays(sessions, days = 30) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  return sessions.filter((session) => {
    const value = session.updatedAt || session.createdAt
    if (!value) return true
    const ts = new Date(value).getTime()
    if (Number.isNaN(ts)) return true
    return ts >= cutoff
  })
}

export function sampleSessions(sessions, limit = 30) {
  const dedup = new Map()

  const heavy = [...sessions]
    .sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0))
    .slice(0, 10)

  const recent = [...sessions]
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))
    .slice(0, 10)

  const rest = [...sessions]
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0))

  for (const item of [...heavy, ...recent, ...rest]) {
    if (!dedup.has(item.id)) {
      dedup.set(item.id, item)
    }
    if (dedup.size >= limit) break
  }

  return [...dedup.values()]
}

export function flattenText(value) {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (Array.isArray(value)) return value.map(flattenText).filter(Boolean).join("\n")
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text
    if (typeof value.content === "string") return value.content
    if (typeof value.value === "string") return value.value
    if (typeof value.message === "string") return value.message
    if (Array.isArray(value.parts)) return value.parts.map(flattenText).filter(Boolean).join("\n")
    if (Array.isArray(value.content)) return value.content.map(flattenText).filter(Boolean).join("\n")
    if (Array.isArray(value.items)) return value.items.map(flattenText).filter(Boolean).join("\n")
    if (Array.isArray(value.messages)) return value.messages.map(flattenText).filter(Boolean).join("\n")
    return Object.values(value)
      .flatMap((entry) => (typeof entry === "string" ? [entry] : []))
      .join("\n")
  }
  return ""
}

function looksLikeMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  if (typeof value.role === "string") return true
  if (typeof value.tool === "string" || typeof value.toolName === "string") return true
  if (typeof value.name === "string" && (value.input || value.output || value.result)) return true
  if (typeof value.content === "string") return true
  if (Array.isArray(value.content) || Array.isArray(value.parts)) return true
  if (typeof value.text === "string" && (value.type || value.timestamp || value.author)) return true
  return false
}

function collectObjects(root, visitor, depth = 0, seen = new Set()) {
  if (depth > 8) return
  if (root == null) return
  if (typeof root !== "object") return
  if (seen.has(root)) return
  seen.add(root)

  if (Array.isArray(root)) {
    for (const item of root) {
      collectObjects(item, visitor, depth + 1, seen)
    }
    return
  }

  visitor(root)

  for (const value of Object.values(root)) {
    collectObjects(value, visitor, depth + 1, seen)
  }
}

export function extractMessages(exportData) {
  const found = []
  collectObjects(exportData, (obj) => {
    if (!looksLikeMessage(obj)) return
    found.push(normalizeMessage(obj))
  })

  const dedup = []
  const seen = new Set()

  for (const msg of found) {
    const key = `${msg.role}|${msg.name || ""}|${msg.timestamp || ""}|${msg.text.slice(0, 120)}`
    if (seen.has(key)) continue
    seen.add(key)
    dedup.push(msg)
  }

  return dedup.filter((msg) => msg.text || msg.name)
}

export function normalizeMessage(obj) {
  const roleCandidate =
    obj.role ||
    obj.author?.role ||
    obj.type ||
    obj.kind ||
    (obj.tool || obj.toolName ? "tool" : null)

  const role = normalizeRole(roleCandidate)
  const name = obj.tool || obj.toolName || obj.name || obj.functionName || null
  const timestamp =
    obj.timestamp ||
    obj.createdAt ||
    obj.updatedAt ||
    obj.time ||
    obj.date ||
    null

  const text = flattenText(
    obj.content ??
      obj.parts ??
      obj.text ??
      obj.message ??
      obj.result ??
      obj.output ??
      obj.input ??
      obj.value ??
      obj.arguments,
  ).trim()

  return {
    role,
    name,
    timestamp: toIsoDate(timestamp),
    text,
    raw: obj,
  }
}

export function normalizeRole(value) {
  const text = String(value || "").toLowerCase()
  if (["user", "human"].includes(text)) return "user"
  if (["assistant", "ai", "model"].includes(text)) return "assistant"
  if (["tool", "function"].includes(text)) return "tool"
  if (["system"].includes(text)) return "system"
  return "other"
}

export function chars(value) {
  return String(value || "").length
}

export function normalizeTextForMatch(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[a-z]:\\[^\s]+/gi, " <path> ")
    .replace(/\/[\w./-]+/g, (m) => (m.length > 3 ? " <path> " : m))
    .replace(/ses_[a-z0-9]+/gi, " <session> ")
    .replace(/bg_[a-z0-9]+/gi, " <task> ")
    .replace(/\b\d{2,}\b/g, " <num> ")
    .replace(/\s+/g, " ")
    .replace(/[“”"'`]/g, "")
    .trim()
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))]
}

export function topN(entries, count = 5) {
  return [...entries].sort((a, b) => b.count - a.count).slice(0, count)
}

export function countBy(items, selector) {
  const map = new Map()
  for (const item of items) {
    const key = selector(item)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()].map(([key, count]) => ({ key, count }))
}

function tokensForSimilarity(text) {
  const normalized = normalizeTextForMatch(text)
  const english = normalized.match(/[a-z][a-z0-9_-]{2,}/g) || []
  const cjkSegments = normalized.match(/[\u4e00-\u9fff]{2,}/g) || []
  const cjkBigrams = cjkSegments.flatMap((segment) => {
    if (segment.length <= 2) return [segment]
    const out = []
    for (let i = 0; i < segment.length - 1; i += 1) {
      out.push(segment.slice(i, i + 2))
    }
    return out
  })
  return uniqueStrings([...english, ...cjkBigrams])
}

function jaccard(a, b) {
  const left = new Set(a)
  const right = new Set(b)
  if (!left.size || !right.size) return 0
  let intersection = 0
  for (const item of left) {
    if (right.has(item)) intersection += 1
  }
  return intersection / (left.size + right.size - intersection)
}

function splitInstructionCandidates(text) {
  return String(text || "")
    .split(/[\n。！？!?；;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 10 && item.length <= 220)
}

function detectInstructionType(text, sessionProjects = []) {
  const normalized = normalizeTextForMatch(text)
  if (/(简体中文|中文回复|english|英文|先给结论|不要翻译|称呼|boss|选项|clickable|本地优先|完全免费|不要云|不做跨设备)/.test(normalized)) {
    return "global-preference"
  }
  if (sessionProjects.length === 1) {
    return "project-rule"
  }
  if (/(agents\.md|claude\.md|skill|session_guard|session guard|mcp|plugin|opencode|template|report)/.test(normalized)) {
    return "project-rule"
  }
  return sessionProjects.length > 1 ? "global-preference" : "project-rule"
}

function instructionRecommendation(type, text) {
  if (type === "project-rule") {
    return `建议写入项目级 AGENTS.md：${text}`
  }
  return `建议写入个人级规则或 CLAUDE.md：${text}`
}

function normalizeInstructionCandidate(text) {
  return normalizeTextForMatch(text)
    .replace(/^(please|请|帮我|麻烦|可以|现在|然后)\s*/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

export function classifyTask(messages, context = {}) {
  return classifyTaskDetailed(messages, context).task
}

export function classifyTaskDetailed(messages, context = {}) {
  const title = normalizeTextForMatch(context.session?.title || context.title || "")
  const firstUserText = normalizeTextForMatch(
    messages.filter((m) => m.role === "user").slice(0, 4).map((m) => m.text).join("\n"),
  )
  const toolText = extractToolNames(messages).join(" ").toLowerCase()
  const pathText = normalizeTextForMatch(String(context.session?.project || context.project || ""))
  const composite = [title, firstUserText, toolText, pathText].filter(Boolean).join("\n")

  const rules = [
    ["debug", [/\b(debug|bug|fix|failing|broken|traceback|error|报错|修复|调试|失败|定位)\b/, /\b(lsp|diagnostic|test|bash|stderr|stack)\b/]],
    ["refactor", [/\b(refactor|cleanup|clean up|simplify|restructure|tidy|重构|整理|收敛)\b/, /\b(edit|write|patch)\b/]],
    ["config", [/\b(config|configure|setup|install|mcp|plugin|auth|json|yaml|toml|配置|安装|环境|接入)\b/, /\b(read|write|bash)\b/]],
    ["docs", [/\b(docs|documentation|readme|writeup|article|blog|文档|写作|介绍|README)\b/, /\b(write|read)\b/]],
    ["design", [/\b(design|architecture|system|spec|plan|方案|设计|架构|规划)\b/, /\b(skill|agent|router|template)\b/]],
    ["review", [/\b(review|audit|check this code|代码审查|审计|复查)\b/, /\b(read|grep)\b/]],
    ["data", [/\b(data|csv|sql|metrics|dataset|json|table|数据|分析表格|报表)\b/, /\b(read|write|session_read)\b/]],
    ["devops", [/\b(deploy|docker|ci|cd|workflow|release|k8s|部署|构建流水线)\b/, /\b(bash|write)\b/]],
    ["research", [/\b(research|explore|investigate|compare|why|调研|研究|探索|查找|盘点|评价)\b/, /\b(read|grep|session_read|session_search)\b/]],
    ["implement", [/\b(implement|build|create|add|make|feature|实现|新功能|做一个|生成|构建)\b/, /\b(write|edit|bash)\b/]],
  ]

  const scoreEntries = rules.map(([label, patterns]) => {
    const signals = []
    let score = 0
    for (const pattern of patterns) {
      if (pattern.test(composite)) {
        score += 2
        signals.push(pattern.source)
      }
    }
    if (title && patterns[0].test(title)) {
      score += 2
      signals.push(`title:${patterns[0].source}`)
    }
    if (firstUserText && patterns[0].test(firstUserText)) {
      score += 2
      signals.push(`user:${patterns[0].source}`)
    }
    if (toolText && patterns[1] && patterns[1].test(toolText)) {
      score += 1
      signals.push(`tools:${patterns[1].source}`)
    }
    return { label, score, signals }
  })

  scoreEntries.sort((a, b) => b.score - a.score)
  const winner = scoreEntries[0]
  const confidence = winner && winner.score > 0 ? Math.min(1, winner.score / 6) : 0.1

  if (!winner || winner.score < 2) {
    return {
      task: "other",
      confidence,
      topSignals: [],
      reason: "No classification rule passed the minimum threshold.",
    }
  }

  return {
    task: winner.label,
    confidence,
    topSignals: winner.signals.slice(0, 4),
    reason: `Top score ${winner.score} from ${winner.signals.slice(0, 3).join(", ") || "pattern match"}`,
  }
}

export function classifyOutcome(messages) {
  const tail = normalizeTextForMatch(messages.slice(-8).map((m) => m.text).join("\n"))
  if (/(didnt work|didn't work|still broken|still failing|failed|cannot fix|没成功|失败|还是不行)/.test(tail)) {
    return "failed"
  }
  if (/(done|resolved|works now|fixed|implemented|all set|搞定|完成|可以了|好了)/.test(tail)) {
    return "achieved"
  }
  if (/(later|next step|remaining|still need|先这样|还需要|下一步)/.test(tail)) {
    return "partial"
  }
  if (/(stop|ignore this|never mind|算了|不用了)/.test(tail)) {
    return "abandoned"
  }
  if (messages.length <= 3) {
    return "abandoned"
  }
  return "partial"
}

function explicitToolFailure(message) {
  const raw = message.raw || {}
  const statusCandidates = [
    raw.status,
    raw.state,
    raw.result?.status,
    raw.error?.status,
    raw.outcome,
    raw.phase,
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase())

  const exitCode = raw.exitCode ?? raw.exit_code ?? raw.code ?? raw.result?.exitCode ?? null
  const stderr = flattenText(raw.stderr || raw.error || raw.result?.stderr || raw.result?.error || raw.details)
  const stdout = flattenText(raw.output || raw.result?.output)
  const text = `${message.text}\n${stderr}\n${stdout}`
  const normalizedText = normalizeTextForMatch(text)

  if (statusCandidates.some((value) => /(invalid|bad_request|schema)/.test(value))) {
    return {
      subtype: "invalid_call",
      evidence: `status=${statusCandidates.find((value) => /(invalid|bad_request|schema)/.test(value))}`,
      snippet: pickSnippet(text, /(invalid|schema|bad request|bad_request)/i),
    }
  }

  if (statusCandidates.some((value) => /(cancel|abort|interrupted)/.test(value)) || /(cancelled|canceled|aborted|interrupted)/.test(normalizedText)) {
    return {
      subtype: "cancelled",
      evidence: `status=${statusCandidates.find((value) => /(cancel|abort|interrupted)/.test(value)) || "text"}`,
      snippet: pickSnippet(text, /(cancelled|canceled|aborted|interrupted)/i),
    }
  }

  if (
    statusCandidates.some((value) => /(error|failed|timeout)/.test(value)) ||
    (exitCode != null && Number(exitCode) !== 0) ||
    /(enoent|traceback|command not found|permission denied|api error|timeout|tool failed|执行失败|工具失败|exception)/.test(normalizedText)
  ) {
    return {
      subtype: "failed",
      evidence: [
        statusCandidates.length ? `status=${statusCandidates[0]}` : null,
        exitCode != null ? `exitCode=${exitCode}` : null,
        stderr ? "stderr" : null,
      ].filter(Boolean).join(", "),
      snippet: pickSnippet(text, /(enoent|traceback|command not found|permission denied|api error|timeout|tool failed|执行失败|工具失败|exception|error|failed)/i),
    }
  }

  if (/(step-start|tool-calls|msg_[a-z0-9]+|prt_[a-z0-9]+|part[_ -]?id)/.test(normalizedText)) {
    return {
      subtype: "noisy_event_only",
      evidence: "event-fragment-only",
      snippet: pickSnippet(text, /(step-start|tool-calls|msg_[a-z0-9]+|prt_[a-z0-9]+|part[_ -]?id)/i),
    }
  }

  return null
}

export function detectFriction(messages) {
  return detectFrictionDetailed(messages).frictions
}

export function detectFrictionDetailed(messages) {
  const events = []
  const diagnostics = []
  const fullText = messages.map((m) => m.text).join("\n")
  const tailText = normalizeTextForMatch(fullText)

  const repeatedUserMap = new Map()
  for (const message of messages.filter((m) => m.role === "user")) {
    const key = normalizeTextForMatch(message.text)
    if (key.length < 18) continue
    repeatedUserMap.set(key, (repeatedUserMap.get(key) || 0) + 1)
  }

  for (const [text, count] of repeatedUserMap.entries()) {
    if (count >= 2) {
      events.push({
        type: "重复指令",
        description: "同一条用户指令在单个 session 中重复出现",
        snippet: text.slice(0, 200),
        subtype: "repeated_instruction",
      })
      diagnostics.push({ type: "重复指令", subtype: "repeated_instruction", evidence: `repeatCount=${count}` })
      break
    }
  }

  if (/(forgot|you already|as i said|lost context|前面说过|你忘了|上下文丢失|刚才说过)/.test(tailText)) {
    const snippet = pickSnippet(fullText, /(forgot|you already|as i said|lost context|前面说过|你忘了|上下文丢失|刚才说过)/i)
    events.push({
      type: "上下文丢失",
      description: "对话中出现了明显的记忆或连续性问题",
      snippet,
      subtype: "context_loss",
    })
    diagnostics.push({ type: "上下文丢失", subtype: "context_loss", evidence: "tail-text-match", snippet })
  }

  const toolMessages = messages.filter((m) => m.role === "tool")
  for (const message of toolMessages) {
    const detail = explicitToolFailure(message)
    if (!detail) continue
    diagnostics.push({
      type: "工具失败",
      subtype: detail.subtype,
      evidence: detail.evidence,
      tool: message.name || null,
      snippet: detail.snippet,
    })
    if (detail.subtype === "noisy_event_only") continue
    events.push({
      type: "工具失败",
      description: `工具调用出现 ${detail.subtype} 信号${message.name ? `：${message.name}` : ""}`,
      snippet: detail.snippet,
      subtype: detail.subtype,
      evidence: detail.evidence,
      tool: message.name || null,
    })
  }

  if (/(that.?s not what i meant|wrong direction|不是这个|方向不对|理解错了|误解)/.test(tailText)) {
    const snippet = pickSnippet(fullText, /(that.?s not what i meant|wrong direction|不是这个|方向不对|理解错了|误解)/i)
    events.push({
      type: "误解意图",
      description: "模型对用户目标的理解方向出现偏差",
      snippet,
      subtype: "intent_mismatch",
    })
    diagnostics.push({ type: "误解意图", subtype: "intent_mismatch", evidence: "tail-text-match", snippet })
  }

  if (/(too much|dont change so much|don't change so much|over-modified|改太多了|别改这么多|范围太大)/.test(tailText)) {
    const snippet = pickSnippet(fullText, /(too much|dont change so much|don't change so much|over-modified|改太多了|别改这么多|范围太大)/i)
    events.push({
      type: "过度修改",
      description: "模型改动范围超过了用户预期",
      snippet,
      subtype: "over_modified",
    })
    diagnostics.push({ type: "过度修改", subtype: "over_modified", evidence: "tail-text-match", snippet })
  }

  if (/(test failed|compile error|broke the build|generated bug|新 bug|编译不过|测试没过)/.test(tailText)) {
    const snippet = pickSnippet(fullText, /(test failed|compile error|broke the build|generated bug|新 bug|编译不过|测试没过)/i)
    events.push({
      type: "生成 bug",
      description: "生成内容引发或延续了可见错误",
      snippet,
      subtype: "generated_bug",
    })
    diagnostics.push({ type: "生成 bug", subtype: "generated_bug", evidence: "tail-text-match", snippet })
  }

  const correctiveMessages = messages.filter(
    (m) => m.role === "user" && /^(no|not that|still|again|不是|还是|再|不对|错了)/i.test(m.text.trim()),
  )
  if (correctiveMessages.length >= 2) {
    const snippet = correctiveMessages.slice(0, 2).map((m) => m.text.trim()).join(" | ")
    events.push({
      type: "反复修正",
      description: "用户多次对同一方向进行纠偏",
      snippet,
      subtype: "multi_correction",
    })
    diagnostics.push({ type: "反复修正", subtype: "multi_correction", evidence: `count=${correctiveMessages.length}`, snippet })
  }

  return { frictions: dedupeFrictionEvents(events), diagnostics }
}

function dedupeFrictionEvents(events) {
  const seen = new Set()
  const out = []
  for (const event of events) {
    const key = `${event.type}|${event.subtype || ""}|${event.tool || ""}|${(event.snippet || "").slice(0, 80)}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(event)
  }
  return out
}

export function extractRepeatedInstructions(analyzedSessions, minFrequency = 3) {
  const clusters = []

  for (const session of analyzedSessions) {
    const sessionProjects = [session.project].filter(Boolean)
    const seenInSession = new Set()
    const userClauses = session.messages
      .filter((m) => m.role === "user")
      .flatMap((m) => splitInstructionCandidates(m.text).map((clause) => ({ clause, source: m.text })))

    for (const item of userClauses) {
      const normalized = normalizeInstructionCandidate(item.clause)
      if (normalized.length < 12 || normalized.length > 220) continue
      if (/^(thanks|ok|okay|继续|继续吧|好的|收到|明白了)$/.test(normalized)) continue
      if (seenInSession.has(normalized)) continue
      seenInSession.add(normalized)

      const tokens = tokensForSimilarity(normalized)
      let cluster = clusters.find((entry) => jaccard(entry.tokens, tokens) >= 0.52 || normalized.includes(entry.normalizedInstruction) || entry.normalizedInstruction.includes(normalized))
      if (!cluster) {
        cluster = {
          normalizedInstruction: normalized,
          representativeText: item.clause.trim(),
          evidenceCount: 0,
          sourceSessions: [],
          projects: [],
          tokens,
          samples: [],
        }
        clusters.push(cluster)
      }
      cluster.evidenceCount += 1
      if (!cluster.sourceSessions.includes(session.id)) cluster.sourceSessions.push(session.id)
      if (!cluster.projects.includes(session.project)) cluster.projects.push(session.project)
      cluster.samples.push(item.clause.trim())
      if (item.clause.length < cluster.representativeText.length) {
        cluster.representativeText = item.clause.trim()
      }
    }
  }

  return clusters
    .map((cluster) => {
      const type = detectInstructionType(cluster.representativeText, cluster.projects)
      const confidence = Math.min(0.98, 0.35 + cluster.sourceSessions.length * 0.12 + Math.min(cluster.samples.length, 5) * 0.05)
      return {
        text: cluster.representativeText,
        normalizedInstruction: cluster.normalizedInstruction,
        evidenceCount: cluster.evidenceCount,
        count: cluster.sourceSessions.length,
        sourceSessions: cluster.sourceSessions,
        projects: cluster.projects,
        recommendation: instructionRecommendation(type, cluster.representativeText),
        type,
        confidence: Number(confidence.toFixed(2)),
      }
    })
    .filter((item) => item.count >= minFrequency)
    .sort((a, b) => (b.count - a.count) || (b.evidenceCount - a.evidenceCount))
}

export function extractToolNames(messages) {
  const names = []
  for (const message of messages) {
    if (message.role === "tool" && message.name) {
      names.push(String(message.name).toLowerCase())
      continue
    }
    const match = message.text.match(/\b(read|write|edit|bash|glob|grep|ls|session_list|session_read|session_search|mcp|skill|lsp_diagnostics|fetch|task)\b/gi)
    if (match) names.push(...match.map((value) => value.toLowerCase()))
  }
  return names
}

export function pickSnippet(text, regex) {
  const match = text.match(regex)
  if (!match) return text.slice(0, 180)
  const index = match.index || 0
  const start = Math.max(0, index - 80)
  const end = Math.min(text.length, index + 120)
  return text.slice(start, end).replace(/\s+/g, " ").trim()
}

export function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

export function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function renderList(items, renderer) {
  return items.map(renderer).join("\n")
}

export function formatPct(numerator, denominator) {
  if (!denominator) return "0%"
  return `${Math.round((numerator / denominator) * 100)}%`
}

export function resolveSessionTimeline(session, messages = []) {
  const messageTimes = messages.map((msg) => toIsoDate(msg.timestamp)).filter(Boolean).sort()
  const latestMessage = messageTimes.at(-1) || null
  const earliestMessage = messageTimes[0] || null

  const created = chooseDateCandidate([
    { value: session?.createdAt, source: session?.createdAtSource || "session.createdAt" },
    { value: earliestMessage, source: "messages:firstTimestamp" },
  ])

  const updated = chooseDateCandidate([
    { value: session?.updatedAt, source: session?.updatedAtSource || "session.updatedAt" },
    { value: latestMessage, source: "messages:lastTimestamp" },
    { value: created.value, source: created.source },
  ])

  const activityAt = updated.value || created.value || null
  const activityAtSource = updated.value
    ? updated.source
    : created.value
      ? created.source
      : "fallback:none"

  return {
    createdAt: created.value,
    createdAtSource: created.source || null,
    updatedAt: updated.value,
    updatedAtSource: updated.source || null,
    activityAt,
    activityAtSource,
  }
}

function flattenPathMatches(root, matcher, currentPath = "root", results = [], seen = new Set()) {
  if (root == null || typeof root !== "object") return results
  if (seen.has(root)) return results
  seen.add(root)

  if (Array.isArray(root)) {
    root.forEach((item, index) => flattenPathMatches(item, matcher, `${currentPath}[${index}]`, results, seen))
    return results
  }

  for (const [key, value] of Object.entries(root)) {
    const nextPath = `${currentPath}.${key}`
    if (matcher(key, value, nextPath)) {
      results.push({ key, value, path: nextPath })
    }
    if (value && typeof value === "object") {
      flattenPathMatches(value, matcher, nextPath, results, seen)
    }
  }
  return results
}

export function resolveSessionAgent(session, exportData) {
  const direct = [
    { value: session?.agent, source: session?.agentSource || "session.agent" },
    { value: exportData?.session?.agent, source: "export.session.agent" },
    { value: exportData?.agent, source: "export.agent" },
    { value: exportData?.metadata?.agent, source: "export.metadata.agent" },
    { value: exportData?.session?.metadata?.agent, source: "export.session.metadata.agent" },
    { value: exportData?.context?.agent, source: "export.context.agent" },
  ]

  for (const candidate of direct) {
    if (candidate.value && String(candidate.value).trim() && String(candidate.value) !== "unknown-agent") {
      return {
        agent: String(candidate.value),
        agentSource: candidate.source,
        agentEvidence: `from ${candidate.source}`,
      }
    }
  }

  const paths = flattenPathMatches(
    exportData,
    (key, value, pathName) => {
      if (!["agent", "agentName", "selectedAgent", "activeAgent"].includes(key)) return false
      if (typeof value !== "string" || !value.trim()) return false
      return /session|meta|context|agent/i.test(pathName)
    },
    "export",
  )

  if (paths.length) {
    return {
      agent: String(paths[0].value),
      agentSource: paths[0].path,
      agentEvidence: `from ${paths[0].path}`,
    }
  }

  return {
    agent: "unknown-agent",
    agentSource: "fallback:none",
    agentEvidence: "No agent field found in session list or export payload.",
  }
}

export function formatDateRange(sessions) {
  const dates = sessions
    .map((s) => s.activityAt || s.updatedAt || s.createdAt)
    .filter(Boolean)
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a - b)

  if (!dates.length) return "unknown"
  const start = dates[0].toISOString().slice(0, 10)
  const end = dates[dates.length - 1].toISOString().slice(0, 10)
  return `${start} ~ ${end}`
}

export function byHourHeatmap(sessions) {
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const session of sessions) {
    const source = session.activityAt || session.updatedAt || session.createdAt
    const date = source ? new Date(source) : null
    if (!date || Number.isNaN(date.getTime())) continue
    const day = date.getUTCDay()
    const hour = date.getUTCHours()
    matrix[day][hour] += 1
  }
  return matrix
}

export function dailyActivity(sessions) {
  const map = new Map()
  for (const session of sessions) {
    const source = session.activityAt || session.updatedAt || session.createdAt
    if (!source) continue
    const date = new Date(source)
    if (Number.isNaN(date.getTime())) continue
    const key = date.toISOString().slice(5, 10)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }))
}

export function satisfactionTrend(analyzedSessions) {
  const groups = new Map()
  for (const session of analyzedSessions) {
    const source = session.activityAt || session.updatedAt || session.createdAt
    const stamp = source ? new Date(source) : null
    if (!stamp || Number.isNaN(stamp.getTime())) continue
    const bucket = `${stamp.getUTCFullYear()}-W${weekOfYear(stamp)}`
    if (!groups.has(bucket)) {
      groups.set(bucket, { total: 0, achieved: 0 })
    }
    const entry = groups.get(bucket)
    entry.total += 1
    if (session.outcome === "achieved") entry.achieved += 1
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([week, value]) => ({
      week,
      rate: value.total ? Math.round((value.achieved / value.total) * 100) : 0,
    }))
}

function weekOfYear(date) {
  const firstDay = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  const diff = Math.floor((date - firstDay) / (24 * 60 * 60 * 1000))
  return Math.ceil((diff + firstDay.getUTCDay() + 1) / 7)
}

export function loadTemplate(templatePath) {
  return fs.readFileSync(templatePath, "utf8")
}

export function saveJson(filePath, data) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
}

export function saveText(filePath, value) {
  ensureDir(path.dirname(filePath))
  fs.writeFileSync(filePath, value, "utf8")
}

export function summarizeProjects(sessions) {
  return countBy(sessions, (session) => String(session.project || "unknown-project"))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
}

export function storagePathHint() {
  const home = os.homedir()
  if (process.platform === "win32") {
    return path.join(home, ".local", "share", "opencode")
  }
  return path.join(home, ".local", "share", "opencode")
}
