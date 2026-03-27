import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { execSync, spawnSync } from "node:child_process"

export const ROOT = process.cwd()
export const OUTPUT_ROOT = process.env.CONTEXTOS_OUTPUT_DIR
  ? path.resolve(process.env.CONTEXTOS_OUTPUT_DIR)
  : ROOT
export const ANALYSIS_DIR = path.join(OUTPUT_ROOT, ".contextos", "analysis")
export const RESCUE_DIR = path.join(OUTPUT_ROOT, ".contextos", "rescue")
export const RUNTIME_DIR = path.join(OUTPUT_ROOT, ".contextos", "runtime")
export const GUARD_PATH = path.join(OUTPUT_ROOT, ".contextos", "guard", "SESSION_GUARD.md")
export const TASKS_DIR = path.join(OUTPUT_ROOT, ".contextos", "tasks")
export const CURRENT_TASK_YAML_PATH = path.join(TASKS_DIR, "current-task.yaml")
export const CURRENT_TASK_MD_PATH = path.join(TASKS_DIR, "current-task.md")
export const INTAKE_DECISION_PATH = path.join(RUNTIME_DIR, "intake-decision.json")
export const SELECTED_CONTEXT_MD_PATH = path.join(RUNTIME_DIR, "selected-context.md")
export const SELECTED_CONTEXT_JSON_PATH = path.join(RUNTIME_DIR, "selected-context.json")
export const SITUATION_MD_PATH = path.join(TASKS_DIR, "situation.md")
export const RESCUE_LATEST_DIR = path.join(RESCUE_DIR, "latest")
export const JOURNAL_DIR = path.join(OUTPUT_ROOT, ".contextos", "journal")
export const MEMORY_DIR = path.join(OUTPUT_ROOT, ".contextos", "memory")
export const MEMORY_CORE_PATH = path.join(MEMORY_DIR, "core.md")

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

const CLI_PATH_CACHE = new Map()

function resolveCommand(command) {
  const raw = String(command || "opencode").trim()
  if (raw.includes(path.sep)) {
    return raw
  }

  if (CLI_PATH_CACHE.has(raw)) {
    return CLI_PATH_CACHE.get(raw)
  }

  const probeCommand = process.platform === "win32"
    ? `where ${JSON.stringify(raw)}`
    : `command -v ${JSON.stringify(raw)}`

  try {
    const probeOutput = String(
      execSync(probeCommand, {
        encoding: "utf8",
        env: { ...process.env },
        shell: true,
        stdio: ["ignore", "pipe", "pipe"],
      }),
    ).trim()

    const firstLine = probeOutput.split(/\r?\n/)[0]
    if (firstLine) {
      CLI_PATH_CACHE.set(raw, firstLine)
      return firstLine
    }
  } catch {}

  CLI_PATH_CACHE.set(raw, raw)
  return raw
}

export function execJsonCommand(args, options = {}) {
  const command = resolveCommand(options.command ?? "opencode")
  const shell = process.platform === "win32"
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    shell,
    maxBuffer: options.maxBuffer ?? 32 * 1024 * 1024,
    timeout: options.timeout,
  })

  if (result.error) {
    if (result.error.code === "ENOENT") {
      throw new Error(
        `Could not find executable command "${command}" in PATH. Install OpenCode first or run these scripts from an environment where the OpenCode CLI is available.`,
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

export function exportSession(sessionID, options = {}) {
  return execJsonCommand(["export", sessionID], {
    timeout: parseTimeoutOption(options),
  })
}

function parseTimeoutOption(options = {}) {
  if (options.timeoutMs == null && options.timeout == null) {
    return undefined
  }

  const timeoutMs = Number(options.timeoutMs ?? options.timeout)
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return undefined
  }

  return timeoutMs
}

export function normalizeSessions(data) {
  const items = Array.isArray(data)
    ? data
    : data?.sessions || data?.items || data?.data || data?.results || []

  return items
    .map((item) => {
      const id =
        item?.id ||
        item?.info?.id ||
        item?.sessionID ||
        item?.sessionId ||
        item?.session?.id ||
        item?.value?.id ||
        item?.slug ||
        null

      const title =
        item?.info?.title ||
        item?.title ||
        item?.name ||
        item?.summary ||
        item?.session?.title ||
        item?.value?.title ||
        "Untitled session"

      const createdAt =
        item?.info?.time?.created ||
        item?.info?.created ||
        item?.created ||
        item?.createdAt ||
        item?.created_at ||
        item?.startedAt ||
        item?.timestamp ||
        item?.session?.createdAt ||
        null

      const updatedAt =
        item?.info?.time?.updated ||
        item?.info?.updated ||
        item?.updated ||
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
        item?.info?.directory ||
        item?.info?.projectID ||
        item?.project ||
        item?.projectId ||
        item?.directory ||
        item?.projectID ||
        item?.cwd ||
        item?.worktree ||
        item?.session?.directory ||
        item?.path ||
        "unknown-project"

      const agent =
        item?.info?.agent ||
        item?.agent ||
        item?.agentName ||
        item?.session?.agent ||
        item?.session?.info?.agent ||
        "unknown-agent"

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
    if (value.state?.output && typeof value.state.output === "string") return value.state.output
    if (value.state?.error && typeof value.state.error === "string") return value.state.error
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
  if (typeof value.type === "string" && (typeof value.messageID === "string" || typeof value.callID === "string")) {
    return false
  }
  if (typeof value.type === "string" && typeof value.state === "object" && value.state !== null) {
    return false
  }
  if (typeof value.role === "string") return true
  if (typeof value.info?.role === "string") return true
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
  const info = obj.info || {}

  const roleCandidate =
    info.role ||
    obj.role ||
    obj.author?.role ||
    obj.type ||
    obj.kind ||
    (obj.tool || obj.toolName ? "tool" : null)

  const role = normalizeRole(roleCandidate)
  let name = obj.tool || obj.toolName || obj.name || obj.functionName || info.tool || null
  if (!name && Array.isArray(obj.parts)) {
    const toolPart = obj.parts.find((item) => typeof item?.tool === "string")
    if (toolPart?.tool) {
      name = toolPart.tool
    }
  }

  const timestamp =
    info.time?.created ||
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
    timestamp: toISOStringSafe(timestamp),
    agent: info.agent || obj.agent || obj.mode || null,
    text,
    raw: obj,
  }
}

function toISOStringSafe(value) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
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

const TASK_IDENTITY_ENUMS = {
  domain: new Set(["project", "capability", "platform", "preference"]),
  scope: new Set(["L1", "L2", "L3"]),
  durability: new Set(["session", "candidate", "durable"]),
}

const CAPABILITY_UNIT_KEYWORDS = [
  "insights",
  "context-budget",
  "router-lite",
  "router",
  "rescue-session",
  "rescue",
  "session-guard",
  "guard",
  "friction-detector",
  "task-identity-routing",
]

function asMessageText(entry) {
  if (!entry) return ""
  if (typeof entry === "string") return entry
  if (typeof entry.text === "string") return entry.text
  return ""
}

function clampConfidence(value) {
  if (!Number.isFinite(value)) return 0.5
  if (value < 0) return 0
  if (value > 1) return 1
  return Number(value.toFixed(2))
}

function detectCapabilityUnit(text, activeFiles = []) {
  const byKeyword = CAPABILITY_UNIT_KEYWORDS.find((keyword) => text.includes(keyword))
  if (byKeyword) return byKeyword

  const byPath = activeFiles
    .map((item) => String(item || "").toLowerCase())
    .find((file) =>
      [
        ["generate-insights", "insights"],
        ["context-budget", "context-budget"],
        ["rescue-session", "rescue-session"],
        ["contextos-guard", "session-guard"],
        ["session-guard", "session-guard"],
      ].some(([needle]) => file.includes(needle)),
    )

  if (!byPath) return null
  if (byPath.includes("generate-insights")) return "insights"
  if (byPath.includes("context-budget")) return "context-budget"
  if (byPath.includes("rescue-session")) return "rescue-session"
  return "session-guard"
}

export function inferTaskIdentityRouting(context = {}) {
  const userRequest = String(context.userRequest || "")
  const recentMessages = Array.isArray(context.recentMessages) ? context.recentMessages : []
  const activeFiles = Array.isArray(context.activeFiles) ? context.activeFiles.filter(Boolean) : []
  const recentCommands = Array.isArray(context.recentCommands) ? context.recentCommands.filter(Boolean) : []
  const cwd = String(context.cwd || context.projectPath || ROOT)

  const evidence = []
  const mergedText = normalizeTextForMatch([
    userRequest,
    ...recentMessages.slice(-12).map(asMessageText),
    ...recentCommands,
    ...activeFiles,
  ].join("\n"))

  const scores = {
    project: 0,
    capability: 0,
    platform: 0,
    preference: 0,
  }

  if (/(当前项目|本项目|repo|repository|业务|feature|模块|代码库|project)/.test(mergedText)) {
    scores.project += 2
    evidence.push("请求/上下文直接指向当前项目或仓库")
  }

  const capabilityUnit = detectCapabilityUnit(mergedText, activeFiles)
  if (capabilityUnit) {
    scores.capability += 3
    evidence.push(`识别到稳定能力单元: ${capabilityUnit}`)
  }

  if (/(opencode|cli|plugin|mcp|agent|平台|工具链|command|skill)/.test(mergedText)) {
    scores.platform += 2
    evidence.push("包含平台/工具链信号（CLI/Plugin/Agent）")
  }

  if (/(偏好|风格|方法|workflow|习惯|规则沉淀|约束|method|preference)/.test(mergedText)) {
    scores.preference += 2
    evidence.push("包含偏好/方法论信号")
  }

  if (activeFiles.some((item) => String(item).includes("scripts/"))) {
    scores.project += 1
    evidence.push("活跃文件位于项目脚本目录")
  }

  if (recentCommands.some((item) => /insights|context-budget|rescue-session|guard-refresh|task-refresh/i.test(String(item)))) {
    scores.capability += 1
    evidence.push("最近命令命中 ContextOS 能力入口")
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1])
  let domain = ranked[0]?.[0] || "project"
  const topScore = ranked[0]?.[1] || 0
  const secondScore = ranked[1]?.[1] || 0
  if (!TASK_IDENTITY_ENUMS.domain.has(domain)) {
    domain = "project"
  }

  let objectType = "current project"
  let objectName = path.basename(cwd || ROOT) || "current-project"

  if (domain === "capability") {
    objectType = "named capability unit"
    objectName = capabilityUnit || "contextos-capability"
  } else if (domain === "platform") {
    objectType = "platform/global user method"
    objectName = "opencode-platform"
  } else if (domain === "preference") {
    objectType = "platform/global user method"
    objectName = "user-method"
  }

  let scope = "L1"
  if (domain === "capability" && capabilityUnit) {
    scope = "L2"
  } else if (domain === "platform" || domain === "preference") {
    scope = "L3"
  }
  if (!TASK_IDENTITY_ENUMS.scope.has(scope)) {
    scope = "L1"
  }

  const durableSignals = Number(Boolean(context.repeatedInstructionCount))
    + Number(/沉淀|durable|长期|跨项目复用|规则/.test(mergedText))
    + Number(domain === "platform" || domain === "preference")
  const sessionSignals = Number(/临时|本轮|当前会话|just this session/.test(mergedText))
    + Number(scope === "L1")

  let durability = "candidate"
  if (durableSignals >= 2 && topScore >= 2) {
    durability = "durable"
    evidence.push("存在跨会话/跨项目沉淀信号，判定 durable")
  } else if (sessionSignals >= 2 && topScore <= 2) {
    durability = "session"
    evidence.push("主要是当前会话上下文，判定 session")
  } else {
    evidence.push("证据不足以直接 durable，按 candidate 处理")
  }
  if (!TASK_IDENTITY_ENUMS.durability.has(durability)) {
    durability = "candidate"
  }

  const confidence = clampConfidence(
    0.45
      + Math.min(0.35, topScore * 0.12)
      + Math.min(0.1, (topScore - secondScore) * 0.05)
      + Math.min(0.1, evidence.length * 0.015),
  )

  return {
    domain,
    object_type: objectType,
    object_name: objectName,
    scope,
    durability,
    confidence,
    evidence: evidence.slice(0, 8),
  }
}

function yamlScalar(value) {
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "0"
  if (typeof value === "boolean") return value ? "true" : "false"
  return JSON.stringify(String(value ?? ""))
}

export function renderCurrentTaskYaml(anchor = {}) {
  const normalized = normalizeCurrentTaskAnchor(anchor)
  const lines = [
    `task_id: ${yamlScalar(normalized.task_id)}`,
    `title: ${yamlScalar(normalized.title)}`,
    `summary: ${yamlScalar(normalized.summary)}`,
    `domain: ${yamlScalar(normalized.domain)}`,
    `object_type: ${yamlScalar(normalized.object_type)}`,
    `object_name: ${yamlScalar(normalized.object_name)}`,
    `scope: ${yamlScalar(normalized.scope)}`,
    `durability: ${yamlScalar(normalized.durability)}`,
    `confidence: ${yamlScalar(normalized.confidence)}`,
    "active_files:",
    ...normalized.active_files.map((item) => `  - ${yamlScalar(item)}`),
    "recent_commands:",
    ...normalized.recent_commands.map((item) => `  - ${yamlScalar(item)}`),
    "constraints:",
    ...normalized.constraints.map((item) => `  - ${yamlScalar(item)}`),
    "next_steps:",
    ...normalized.next_steps.map((item) => `  - ${yamlScalar(item)}`),
    `updated_at: ${yamlScalar(normalized.updated_at)}`,
    "evidence:",
    ...normalized.evidence.map((item) => `  - ${yamlScalar(item)}`),
  ]
  return `${lines.join("\n")}\n`
}

export function parseCurrentTaskYaml(raw) {
  const text = String(raw || "")
  if (!text.trim()) return null

  const result = {}
  let currentArrayKey = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue

    const arrayMatch = line.match(/^\s*-\s*(.+)$/)
    if (arrayMatch && currentArrayKey) {
      if (!Array.isArray(result[currentArrayKey])) result[currentArrayKey] = []
      result[currentArrayKey].push(parseYamlScalar(arrayMatch[1]))
      continue
    }

    const keyMatch = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!keyMatch) continue
    const [, key, valueRaw] = keyMatch
    if (!valueRaw) {
      result[key] = []
      currentArrayKey = key
      continue
    }
    result[key] = parseYamlScalar(valueRaw)
    currentArrayKey = null
  }

  return normalizeCurrentTaskAnchor(result)
}

function parseYamlScalar(raw) {
  const text = String(raw || "").trim()
  if (!text) return ""
  if ((text.startsWith("\"") && text.endsWith("\"")) || (text.startsWith("'") && text.endsWith("'"))) {
    try {
      return JSON.parse(text)
    } catch {
      return text.slice(1, -1)
    }
  }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) {
    const number = Number(text)
    return Number.isFinite(number) ? number : text
  }
  if (text === "true") return true
  if (text === "false") return false
  return text
}

function normalizeArray(value, fallback = []) {
  if (!Array.isArray(value)) return [...fallback]
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
}

function normalizeCurrentTaskAnchor(anchor = {}) {
  const domain = TASK_IDENTITY_ENUMS.domain.has(anchor.domain) ? anchor.domain : "project"
  const scope = TASK_IDENTITY_ENUMS.scope.has(anchor.scope) ? anchor.scope : "L1"
  const durability = TASK_IDENTITY_ENUMS.durability.has(anchor.durability) ? anchor.durability : "candidate"
  return {
    task_id: String(anchor.task_id || `task-${Date.now()}`),
    title: String(anchor.title || "Current task"),
    summary: String(anchor.summary || ""),
    domain,
    object_type: String(anchor.object_type || "current project"),
    object_name: String(anchor.object_name || path.basename(ROOT)),
    scope,
    durability,
    confidence: clampConfidence(Number(anchor.confidence ?? 0.5)),
    active_files: normalizeArray(anchor.active_files),
    recent_commands: normalizeArray(anchor.recent_commands),
    constraints: normalizeArray(anchor.constraints),
    next_steps: normalizeArray(anchor.next_steps),
    updated_at: String(anchor.updated_at || new Date().toISOString()),
    evidence: normalizeArray(anchor.evidence, ["No explicit evidence recorded"]),
  }
}

export function renderCurrentTaskMarkdown(anchor = {}) {
  const normalized = normalizeCurrentTaskAnchor(anchor)
  const rows = [
    "# Current Task Anchor",
    "",
    `- task_id: \`${normalized.task_id}\``,
    `- title: ${normalized.title}`,
    `- summary: ${normalized.summary || "(empty)"}`,
    `- domain: **${normalized.domain}**`,
    `- object: ${normalized.object_type} / ${normalized.object_name}`,
    `- scope: **${normalized.scope}**`,
    `- durability: **${normalized.durability}**`,
    `- confidence: ${normalized.confidence}`,
    `- updated_at: ${normalized.updated_at}`,
    "",
    "## Active files",
    ...toBulletLines(normalized.active_files),
    "",
    "## Recent commands",
    ...toBulletLines(normalized.recent_commands),
    "",
    "## Constraints",
    ...toBulletLines(normalized.constraints),
    "",
    "## Next steps",
    ...toNumberedLines(normalized.next_steps),
    "",
    "## Evidence",
    ...toBulletLines(normalized.evidence),
    "",
  ]
  return rows.join("\n")
}

function toBulletLines(items) {
  if (!items.length) return ["- (none)"]
  return items.map((item) => `- ${item}`)
}

function toNumberedLines(items) {
  if (!items.length) return ["1. (none)"]
  return items.map((item, index) => `${index + 1}. ${item}`)
}

export function saveCurrentTaskAnchor(anchor = {}, options = {}) {
  const yamlPath = options.yamlPath || CURRENT_TASK_YAML_PATH
  const mdPath = options.mdPath || CURRENT_TASK_MD_PATH
  const normalized = normalizeCurrentTaskAnchor(anchor)
  saveText(yamlPath, renderCurrentTaskYaml(normalized))
  saveText(mdPath, renderCurrentTaskMarkdown(normalized))
  return {
    yamlPath,
    mdPath,
    anchor: normalized,
  }
}

export function readCurrentTaskAnchor(yamlPath = CURRENT_TASK_YAML_PATH) {
  if (!fs.existsSync(yamlPath)) return null
  const raw = fs.readFileSync(yamlPath, "utf8")
  return parseCurrentTaskYaml(raw)
}

export function classifyTask(messages) {
  const options = arguments[1] || {}
  const rawText = messages
    .filter((m) => m.role === "user")
    .slice(0, 5)
    .map((m) => m.text)
    .join("\n")
  const text = normalizeTextForMatch(rawText)

  const base = {
    label: "other",
    source: "fallback",
    matchedRule: "other",
    confidence: messages.length > 0 ? 0.3 : 0.1,
    evidence: {
      rawText: rawText.slice(0, 500),
      matchedPattern: null,
      matchedSnippet: text.slice(0, 240),
    },
  }

  const rules = [
    ["debug", /(debug|bug|fix|failing|broken|error|报错|修复|调试|失败)/, "content"],
    ["refactor", /(refactor|cleanup|clean up|simplify|restructure|重构|整理)/],
    ["config", /(config|configure|setup|install|mcp|plugin|auth|json|配置|安装|环境)/],
    ["docs", /(docs|documentation|readme|writeup|article|blog|文档|写作)/],
    ["design", /(design|architecture|system|spec|plan|设计|架构|方案)/],
    ["review", /(review|audit|check this code|代码审查|review this)/],
    ["data", /(data|csv|sql|metrics|analyze dataset|数据|分析表格)/],
    ["devops", /(deploy|docker|ci|cd|workflow|release|k8s|部署)/],
    ["research", /(research|explore|investigate|compare|why|调研|研究|探索|查找|如何|怎么样|什么|评价|是否|要不要|怎么)/],
    ["implement", /(implement|build|create|add|make|feature|实现|新功能|做一个)/],
  ]

  for (const [label, regex] of rules) {
    if (regex.test(text)) {
      base.label = label
      base.source = "content-regex"
      base.matchedRule = label
      base.confidence = 0.95
      base.evidence.matchedPattern = regex.source
      base.evidence.matchedSnippet = pickSnippet(text, regex)
      return options.includeDiagnostics ? base : base.label
    }
  }

  return options.includeDiagnostics ? base : base.label
}

export function classifyOutcome(messages) {
  const options = arguments[1] || {}
  const tail = normalizeTextForMatch(messages.slice(-8).map((m) => m.text).join("\n"))
  const base = {
    label: "other",
    source: "fallback",
    matchedRule: "other",
    confidence: messages.length > 0 ? 0.4 : 0.1,
    evidence: {
      rawText: messages.slice(-8).map((m) => m.text).join("\n").slice(0, 500),
      matchedPattern: null,
      matchedSnippet: tail.slice(0, 240),
    },
  }

  if (/(didnt work|didn't work|still broken|still failing|failed|cannot fix|没成功|失败|还是不行)/.test(tail)) {
    base.label = "failed"
    base.source = "content-regex"
    base.matchedRule = "failed"
    base.confidence = 0.94
    base.evidence.matchedPattern = /(didnt work|didn't work|still broken|still failing|failed|cannot fix|没成功|失败|还是不行)/.source
    base.evidence.matchedSnippet = pickSnippet(tail, /(didnt work|didn't work|still broken|still failing|failed|cannot fix|没成功|失败|还是不行)/i)
    return options.includeDiagnostics ? base : base.label
  }
  if (/(done|resolved|works now|fixed|implemented|all set|搞定|完成|可以了|好了)/.test(tail)) {
    base.label = "achieved"
    base.source = "content-regex"
    base.matchedRule = "achieved"
    base.confidence = 0.92
    base.evidence.matchedPattern = /(done|resolved|works now|fixed|implemented|all set|搞定|完成|可以了|好了)/.source
    base.evidence.matchedSnippet = pickSnippet(tail, /(done|resolved|works now|fixed|implemented|all set|搞定|完成|可以了|好了)/i)
    return options.includeDiagnostics ? base : base.label
  }
  if (/(later|next step|remaining|still need|先这样|还需要|下一步)/.test(tail)) {
    base.label = "partial"
    base.source = "content-regex"
    base.matchedRule = "partial"
    base.confidence = 0.93
    base.evidence.matchedPattern = /(later|next step|remaining|still need|先这样|还需要|下一步)/.source
    base.evidence.matchedSnippet = pickSnippet(tail, /(later|next step|remaining|still need|先这样|还需要|下一步)/i)
    return options.includeDiagnostics ? base : base.label
  }
  if (/(stop|ignore this|never mind|算了|不用了)/.test(tail)) {
    base.label = "abandoned"
    base.source = "content-regex"
    base.matchedRule = "abandoned"
    base.confidence = 0.91
    base.evidence.matchedPattern = /(stop|ignore this|never mind|算了|不用了)/.source
    base.evidence.matchedSnippet = pickSnippet(tail, /(stop|ignore this|never mind|算了|不用了)/i)
    return options.includeDiagnostics ? base : base.label
  }
  if (messages.length <= 3) {
    base.label = "abandoned"
    base.source = "heuristic"
    base.matchedRule = "session-length"
    base.confidence = 0.6
    return options.includeDiagnostics ? base : base.label
  }
  base.label = "partial"
  base.source = "heuristic"
  base.matchedRule = "default-tail"
  base.confidence = 0.55
  base.evidence.matchedSnippet = tail.slice(0, 220)
  return options.includeDiagnostics ? base : base.label
}

export function detectFriction(messages, options = {}) {
  const events = []
  const fullText = messages.map((m) => m.text).join("\n")
  const tailText = normalizeTextForMatch(fullText)

  function addEvent(type, description, regexOrSnippet, isNoisy = false, matchedPattern) {
    const evidencePattern = typeof regexOrSnippet === "string" ? null : regexOrSnippet
    const matchedText =
      typeof regexOrSnippet === "string" ? regexOrSnippet : pickSnippet(fullText, regexOrSnippet)
    events.push({
      type,
      category: type,
      description,
      snippet: matchedText,
      isNoisy,
      source: regexOrSnippet ? "content-regex" : "heuristic",
      matchedPattern: evidencePattern ? evidencePattern.source : null,
      evidence: {
        searchWindow: "full-session",
        matchedText: matchedText,
      },
    })
  }

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
        category: "重复指令",
        description: "同一条用户指令在单个 session 中重复出现",
        snippet: text.slice(0, 200),
        isNoisy: false,
        source: "message-duplicate",
        matchedPattern: "duplicate-user-text",
        evidence: {
          sessions: count,
        },
      })
      break
    }
  }

  if (/(forgot|you already|as i said|lost context|前面说过|你忘了|上下文丢失|刚才说过)/.test(tailText)) {
    addEvent(
      "上下文丢失",
      "对话中出现了明显的记忆或连续性问题",
      /(forgot|you already|as i said|lost context|前面说过|你忘了|上下文丢失|刚才说过)/i,
      true,
    )
  }

  if (/(enoent|exception|traceback|tool failed|command not found|permission denied|api error|421|tool error|执行失败|工具失败)/.test(tailText)) {
    addEvent(
      "工具失败",
      "工具或外部命令在执行时出现失败信号",
      /(enoent|exception|traceback|tool failed|command not found|permission denied|api error|421|tool error|执行失败|工具失败)/i,
      true,
    )
  }

  if (/(that.?s not what i meant|wrong direction|不是这个|方向不对|理解错了|误解)/.test(tailText)) {
    addEvent(
      "误解意图",
      "模型对用户目标的理解方向出现偏差",
      /(that.?s not what i meant|wrong direction|不是这个|方向不对|理解错了|误解)/i,
      true,
    )
  }

  if (/(too much|dont change so much|don't change so much|over-modified|改太多了|别改这么多|范围太大)/.test(tailText)) {
    addEvent(
      "过度修改",
      "模型改动范围超过了用户预期",
      /(too much|dont change so much|don't change so much|over-modified|改太多了|别改这么多|范围太大)/i,
      true,
    )
  }

  if (/(test failed|compile error|broke the build|generated bug|新 bug|编译不过|测试没过|bug)/.test(tailText)) {
    addEvent(
      "生成 bug",
      "生成内容引发或延续了可见错误",
      /(test failed|compile error|broke the build|generated bug|新 bug|编译不过|测试没过|bug)/i,
      true,
    )
  }

  const correctiveMessages = messages.filter(
    (m) => m.role === "user" && /^(no|not that|still|again|不是|还是|再|不对|错了)/i.test(m.text.trim()),
  )
  if (correctiveMessages.length >= 2) {
    addEvent(
      "反复修正",
      "用户多次对同一方向进行纠偏",
      correctiveMessages.slice(0, 2).map((m) => m.text.trim()).join(" | "),
      true,
    )
  }

  if (options.includeDiagnostics) {
    return events
  }

  return events.map((event) => {
    const simplified = {
      type: event.type,
      description: event.description,
      snippet: event.snippet,
    }
    return simplified
  })
}

export function extractRepeatedInstructions(analyzedSessions, minFrequency = 3) {
  const map = new Map()
  for (const session of analyzedSessions) {
    const seenInSession = new Set()
    for (const message of session.messages.filter((m) => m.role === "user")) {
      const normalized = normalizeTextForMatch(message.text)
      if (normalized.length < 12 || normalized.length > 220) continue
      if (/^(thanks|ok|okay|继续|继续吧|好的)$/.test(normalized)) continue
      if (seenInSession.has(normalized)) continue
      seenInSession.add(normalized)

      if (!map.has(normalized)) {
        map.set(normalized, {
          text: message.text.trim(),
          count: 0,
          sessions: [],
          evidence: [],
          evidenceCount: 0,
        })
      }
      const entry = map.get(normalized)
      entry.count += 1
      entry.sessions.push(session.id)
      entry.evidence.push({
        sessionId: session.id,
        text: message.text.trim(),
      })
      entry.evidenceCount += 1
    }
  }

  return [...map.values()]
    .filter((item) => item.count >= minFrequency)
    .map((item) => ({
      ...item,
      sessionIDs: Array.from(new Set(item.sessions)),
      evidence: item.evidence.slice(0, 5),
      evidenceCount: item.evidence.length,
    }))
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
  const options = arguments[1] || {}
  const diagnostics = {
    totalInputs: 0,
    parsed: 0,
    invalid: 0,
    invalidExamples: [],
    sourceBreakdown: {},
  }

  if (!Array.isArray(sessions)) return "unknown"

  const dates = sessions.flatMap((s) => {
    const candidates = [
      { source: "updatedAt", value: s.updatedAt },
      { source: "createdAt", value: s.createdAt },
    ]

    const selected = []
    for (const candidate of candidates) {
      diagnostics.totalInputs += 1
      diagnostics.sourceBreakdown[candidate.source] = {
        parsed: (diagnostics.sourceBreakdown[candidate.source]?.parsed || 0) + 0,
        invalid: (diagnostics.sourceBreakdown[candidate.source]?.invalid || 0) + 0,
      }

      const value = candidate.value
      const date = new Date(value)
      if (value && !Number.isNaN(date.getTime())) {
        diagnostics.parsed += 1
        diagnostics.sourceBreakdown[candidate.source].parsed += 1
        selected.push(date)
      } else {
        diagnostics.invalid += 1
        diagnostics.sourceBreakdown[candidate.source].invalid += 1
        if (diagnostics.invalidExamples.length < 5) {
          diagnostics.invalidExamples.push({
            source: candidate.source,
            raw: String(value ?? "").slice(0, 80),
          })
        }
      }
    }
    return selected
  })
    .sort((a, b) => a - b)

  if (!dates.length) return "unknown"
  const start = dates[0].toISOString().slice(0, 10)
  const end = dates[dates.length - 1].toISOString().slice(0, 10)
  const range = `${start} ~ ${end}`
  if (!options.includeDiagnostics) return range

  return {
    value: range,
    diagnostics: {
      ...diagnostics,
      sampleSize: sessions.length,
    },
  }
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

export function readTextIfExists(filePath, fallback = "") {
  if (!fs.existsSync(filePath)) return fallback
  return fs.readFileSync(filePath, "utf8")
}

export function appendJournalEntry(entry = {}, options = {}) {
  const now = new Date().toISOString()
  const journalDir = options.journalDir || JOURNAL_DIR
  ensureDir(journalDir)

  const payload = {
    timestamp: now,
    type: String(entry.type || "state_update"),
    title: String(entry.title || "ContextOS state update"),
    summary: String(entry.summary || ""),
    files: Array.isArray(entry.files) ? entry.files : [],
    next_steps: Array.isArray(entry.next_steps) ? entry.next_steps : [],
    constraints: Array.isArray(entry.constraints) ? entry.constraints : [],
    metadata: entry.metadata && typeof entry.metadata === "object" ? entry.metadata : {},
  }

  const stamp = now.replace(/[:.]/g, "-")
  const filePath = path.join(journalDir, `${stamp}-${slugify(payload.type) || "entry"}.json`)
  saveJson(filePath, payload)
  return filePath
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
