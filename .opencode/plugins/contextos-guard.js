import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const ContextOSGuard = async ({ directory }) => {
  const guardPath = join(directory, ".contextos", "guard", "SESSION_GUARD.md")
  const taskAnchorPath = join(directory, ".contextos", "tasks", "current-task.md")
  const situationPath = join(directory, ".contextos", "tasks", "situation.md")
  const memoryCorePath = join(directory, ".contextos", "memory", "core.md")

  return {
    "experimental.session.compacting": async (_input, output) => {
      if (!existsSync(guardPath)) {
        return
      }

      const content = readFileSync(guardPath, "utf8").trim()
      if (!content) {
        return
      }

      output.context.push([
        "## ContextOS Session Guard",
        "Use the following durable state when producing the compaction summary.",
        "Preserve the task, decisions, constraints, and next steps unless the conversation clearly supersedes them.",
        "",
        content,
      ].join("\n"))

      if (existsSync(taskAnchorPath)) {
        const taskAnchor = readFileSync(taskAnchorPath, "utf8").trim()
        if (taskAnchor) {
          output.context.push([
            "## ContextOS Current Task Anchor",
            "Use this structured task identity for domain/object/scope/durability routing.",
            "",
            taskAnchor,
          ].join("\n"))
        }
      }

      if (existsSync(situationPath)) {
        const situation = readFileSync(situationPath, "utf8").trim()
        if (situation) {
          output.context.push([
            "## ContextOS Situation Snapshot",
            "Prefer this current situation summary before reconstructing from transcript.",
            "",
            situation,
          ].join("\n"))
        }
      }

      if (existsSync(memoryCorePath)) {
        const memory = readFileSync(memoryCorePath, "utf8").trim()
        if (memory) {
          output.context.push([
            "## ContextOS Core Memory",
            "Use these durable findings as constraints and prior decisions.",
            "",
            memory,
          ].join("\n"))
        }
      }
    },
  }
}
