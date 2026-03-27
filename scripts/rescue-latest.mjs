#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import path from "node:path"

const target = path.join(process.cwd(), "scripts", "rescue-session.mjs")
const result = spawnSync(process.execPath, [target, ...process.argv.slice(2)], {
  stdio: "inherit",
})

if (result.status !== 0) {
  process.exit(result.status || 1)
}
