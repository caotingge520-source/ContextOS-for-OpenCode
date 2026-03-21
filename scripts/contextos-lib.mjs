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

      const createdAt =
        item?.createdAt ||
        item?.created_at ||
        item?.startedAt ||
        item?.timestamp ||
        item?.session?.createdAt ||
        null

      const updatedAt =
        item?.updatedAt ||
        item?.updated_at ||
        item?.lastMessageAt ||
        item?.endedAt ||
        item?.session?.updatedAt ||
        createdAt

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

      const agent = item?.agent || item?.agentName || item?.session?.agent || "unknown-agent"

      return {
        id,
        title,
        createdAt: createdAt ? new Date(createdAt).toISOString() : null,
        updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
        messageCount: Number(messageCount) || 0,
        project,
        agent,
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
    return new Date(value).getTime() >= cutoff
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
    timestamp: timestamp ? new Date(timestamp).toISOString() : null,
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
    .replace(/\s+/g, " ")
    .replace(/[“”"'`]/g, "")
    .trim()
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

export function classifyTask(messages) {
  const text = normalizeTextForMatch(messages.filter((m) => m.role === "user").slice(0, 5).map((m) => m.text).join("\n"))

  const rules = [
    ["debug", /(debug|bug|fix|failing|broken|error|报错|修复|调试|失败)/],
    ["refactor", /(refactor|cleanup|clean up|simplify|restructure|重构|整理)/],
    ["config", /(config|configure|setup|install|mcp|plugin|auth|json|配置|安装|环境)/],
    ["docs", /(docs|documentation|readme|writeup|article|blog|文档|写作)/],
    ["design", /(design|architecture|system|spec|plan|设计|架构|方案)/],
    ["review", /(review|audit|check this code|代码审查|review this)/],
    ["data", /(data|csv|sql|metrics|analyze dataset|数据|分析表格)/],
    ["devops", /(deploy|docker|ci|cd|workflow|release|k8s|部署)/],
    ["research", /(research|explore|investigate|compare|why|调研|研究|探索|查找)/],
    ["implement", /(implement|build|create|add|make|feature|实现|新功能|做一个)/],
  ]

  for (const [label, regex] of rules) {
    if (regex.test(text)) return label
  }

  return "other"
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

export function detectFriction(messages) {
  const events = []
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
      })
      break
    }
  }

  if (/(forgot|you already|as i said|lost context|前面说过|你忘了|上下文丢失|刚才说过)/.test(tailText)) {
    events.push({
      type: "上下文丢失",
      description: "对话中出现了明显的记忆或连续性问题",
      snippet: pickSnippet(fullText, /(forgot|you already|as i said|lost context|前面说过|你忘了|上下文丢失|刚才说过)/i),
    })
  }

  if (/(enoent|exception|traceback|tool failed|command not found|permission denied|api error|421|tool error|执行失败|工具失败)/.test(tailText)) {
    events.push({
      type: "工具失败",
      description: "工具或外部命令在执行时出现失败信号",
      snippet: pickSnippet(fullText, /(enoent|exception|traceback|tool failed|command not found|permission denied|api error|421|tool error|执行失败|工具失败)/i),
    })
  }

  if (/(that.?s not what i meant|wrong direction|不是这个|方向不对|理解错了|误解)/.test(tailText)) {
    events.push({
      type: "误解意图",
      description: "模型对用户目标的理解方向出现偏差",
      snippet: pickSnippet(fullText, /(that.?s not what i meant|wrong direction|不是这个|方向不对|理解错了|误解)/i),
    })
  }

  if (/(too much|dont change so much|don't change so much|over-modified|改太多了|别改这么多|范围太大)/.test(tailText)) {
    events.push({
      type: "过度修改",
      description: "模型改动范围超过了用户预期",
      snippet: pickSnippet(fullText, /(too much|dont change so much|don't change so much|over-modified|改太多了|别改这么多|范围太大)/i),
    })
  }

  if (/(test failed|compile error|broke the build|generated bug|新 bug|编译不过|测试没过|bug)/.test(tailText)) {
    events.push({
      type: "生成 bug",
      description: "生成内容引发或延续了可见错误",
      snippet: pickSnippet(fullText, /(test failed|compile error|broke the build|generated bug|新 bug|编译不过|测试没过|bug)/i),
    })
  }

  const correctiveMessages = messages.filter(
    (m) => m.role === "user" && /^(no|not that|still|again|不是|还是|再|不对|错了)/i.test(m.text.trim()),
  )
  if (correctiveMessages.length >= 2) {
    events.push({
      type: "反复修正",
      description: "用户多次对同一方向进行纠偏",
      snippet: correctiveMessages.slice(0, 2).map((m) => m.text.trim()).join(" | "),
    })
  }

  return events
}

export function extractRepeatedInstructions(analyzedSessions, minFrequency = 3) {
  const map = new Map()
  for (const session of analyzedSessions) {
    const seenInSession = new Set()
    for (const message of session.messages.filter((m) => m.role === "user")) {
      const normalized = normalizeTextForMatch(message.text)
      if (normalized.length < 24 || normalized.length > 220) continue
      if (/^(thanks|ok|okay|继续|继续吧|好的)$/.test(normalized)) continue
      if (seenInSession.has(normalized)) continue
      seenInSession.add(normalized)

      if (!map.has(normalized)) {
        map.set(normalized, { text: message.text.trim(), count: 0, sessions: [] })
      }
      const entry = map.get(normalized)
      entry.count += 1
      entry.sessions.push(session.id)
    }
  }

  return [...map.values()]
    .filter((item) => item.count >= minFrequency)
    .sort((a, b) => b.count - a.count)
}

export function extractToolNames(messages) {
  const names = []
  for (const message of messages) {
    if (message.role === "tool" && message.name) {
      names.push(String(message.name))
      continue
    }
    const match = message.text.match(/\b(read|write|edit|bash|glob|grep|ls|session_list|session_read|session_search|mcp|skill)\b/gi)
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

export function formatDateRange(sessions) {
  const dates = sessions
    .map((s) => s.updatedAt || s.createdAt)
    .filter(Boolean)
    .map((value) => new Date(value))
    .sort((a, b) => a - b)

  if (!dates.length) return "unknown"
  const start = dates[0].toISOString().slice(0, 10)
  const end = dates[dates.length - 1].toISOString().slice(0, 10)
  return `${start} ~ ${end}`
}

export function byHourHeatmap(sessions) {
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0))
  for (const session of sessions) {
    const date = new Date(session.updatedAt || session.createdAt || Date.now())
    const day = date.getDay()
    const hour = date.getHours()
    matrix[day][hour] += 1
  }
  return matrix
}

export function dailyActivity(sessions) {
  const map = new Map()
  for (const session of sessions) {
    const date = new Date(session.updatedAt || session.createdAt || Date.now()).toISOString().slice(5, 10)
    map.set(date, (map.get(date) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }))
}

export function satisfactionTrend(analyzedSessions) {
  const groups = new Map()
  for (const session of analyzedSessions) {
    const stamp = new Date(session.updatedAt || session.createdAt || Date.now())
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
