#!/usr/bin/env bun
import { spawnSync } from "node:child_process";

if (process.env.OMP_CONTEXT_SKIP_HOOK_INSTALL === "1") process.exit(0);

const inside = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
  encoding: "utf8",
  timeout: 10_000,
});
if (inside.error) {
  process.stderr.write(`Could not inspect Git repository: ${inside.error.message}\n`);
  process.exit(1);
}
if (inside.status !== 0 || inside.stdout.trim() !== "true") process.exit(0);

const configured = spawnSync("git", ["config", "--local", "core.hooksPath", ".githooks"], {
  stdio: "inherit",
  timeout: 10_000,
});
if (configured.error) {
  process.stderr.write(`Failed to configure Git hooks: ${configured.error.message}\n`);
  process.exit(1);
}
if (configured.status !== 0) process.exit(configured.status ?? 1);
process.stdout.write("Configured repository-local Git hooks from .githooks.\n");
