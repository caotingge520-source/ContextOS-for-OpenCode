import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

export const ContextOSGuard = async ({ directory }) => {
  const guardPath = join(directory, ".contextos", "guard", "SESSION_GUARD.md")
  const taskAnchorPath = join(directory, ".contextos", "tasks", "current-task.md")

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
    },
  }
}
