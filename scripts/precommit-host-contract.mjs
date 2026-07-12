#!/usr/bin/env bun
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  readDeclaredHostVersion,
  readLocalOmpInstallation,
  updateExactHostVersion,
} from "./host-version.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check-only");
// Exit 0: verified. Exit 1: failed. Exit 2: compatible version promoted; review generated changes before committing.
const deadline = Date.now() + 15 * 60_000;
const promotionTargets = [
  "package.json",
  "bun.lock",
  "test/host-fixture/package.json",
  "test/host-fixture/bun.lock",
];

function remainingTime() {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Host contract exceeded the 15-minute overall deadline");
  return remaining;
}

function run(command, args, cwd, options = {}) {
  const remaining = remainingTime();
  process.stdout.write(`→ ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: { ...process.env, ...options.env },
    timeout: Math.min(options.timeout ?? 300_000, remaining),
  });
  if (result.error) throw new Error(`${command} ${args.join(" ")} failed to run: ${result.error.message}`);
  if (result.signal) throw new Error(`${command} ${args.join(" ")} was killed by signal ${result.signal}`);
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${String(result.status)}`);
}

function assertPromotionTargetsClean() {
  const status = spawnSync("git", ["status", "--porcelain=v1", "--", ...promotionTargets], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (status.error) throw new Error(`Could not inspect promotion targets: ${status.error.message}`);
  if (status.status !== 0) throw new Error(`git status failed with exit code ${String(status.status)}`);
  if (status.stdout.trim()) {
    throw new Error(`Local OMP promotion would overwrite existing work in:\n${status.stdout.trim()}\nCommit or restore those files, then retry.`);
  }
}

function capturePromotionTargets() {
  return new Map(promotionTargets.map((path) => {
    try {
      return [path, readFileSync(join(repoRoot, path))];
    } catch (cause) {
      throw new Error(`Could not snapshot promotion target ${path}; install dependencies so tracked lockfiles exist, then retry`, { cause });
    }
  }));
}

function restorePromotionTargets(snapshot) {
  const failures = [];
  for (const [path, bytes] of snapshot) {
    try {
      writeFileSync(join(repoRoot, path), bytes);
    } catch (error) {
      failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (failures.length > 0) throw new Error(failures.join("; "));
}

function copyWorkingTree(destination) {
  cpSync(repoRoot, destination, {
    recursive: true,
    dereference: false,
    filter(source) {
      remainingTime();
      const path = relative(repoRoot, source);
      if (!path) return true;
      const segments = path.split(/[\\/]/);
      return !segments.some((segment) => [
        ".git",
        "node_modules",
        ".acm-build",
        "dist",
        "coverage",
        ".cache",
        ".memsearch",
        ".codegraph",
      ].includes(segment));
    },
  });
}

function installAndVerify(root) {
  run("bun", ["install"], root, { env: { OMP_CONTEXT_SKIP_HOOK_INSTALL: "1" } });
  run("bun", ["install"], join(root, "test", "host-fixture"));
  run("bun", ["run", "typecheck"], root);
  run("bun", ["run", "test:host"], root);
  run("bun", ["test", "src/version-contract.test.ts"], root);
}

function verifyDeclaredHost() {
  run("bun", ["run", "typecheck"], repoRoot);
  run("bun", ["run", "test:host"], repoRoot);
  run("bun", ["test", "src/version-contract.test.ts"], repoRoot);
}

try {
  const local = readLocalOmpInstallation();
  const declared = readDeclaredHostVersion(repoRoot);
  process.stdout.write(`Local OMP ${local.version}; repository host ${declared}.\n`);

  if (local.version === declared) {
    verifyDeclaredHost();
    process.stdout.write(`✓ Local OMP ${local.version} host contract is valid.\n`);
    process.exit(0);
  }

  if (!checkOnly) assertPromotionTargetsClean();
  process.stdout.write("Host version changed; validating an isolated candidate. This may take several minutes.\n");

  const tempRoot = mkdtempSync(join(tmpdir(), "omp-context-host-candidate-"));
  const candidateRoot = join(tempRoot, "repo");
  try {
    remainingTime();
    copyWorkingTree(candidateRoot);
    remainingTime();
    updateExactHostVersion(candidateRoot, local.version);
    installAndVerify(candidateRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  if (checkOnly) {
    process.stderr.write(`Local OMP ${local.version} is compatible, but repository metadata still declares ${declared}. Run bun run host:promote-local.\n`);
    process.exit(1);
  }

  assertPromotionTargetsClean();
  const rollback = capturePromotionTargets();
  try {
    updateExactHostVersion(repoRoot, local.version);
    run("bun", ["install"], repoRoot, { env: { OMP_CONTEXT_SKIP_HOOK_INSTALL: "1" } });
    run("bun", ["install"], join(repoRoot, "test", "host-fixture"));
    verifyDeclaredHost();
  } catch (promotionError) {
    try {
      restorePromotionTargets(rollback);
    } catch (restoreError) {
      throw new Error(
        `Local OMP promotion failed: ${promotionError instanceof Error ? promotionError.message : String(promotionError)}; snapshot restoration also failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}. Repository files may be inconsistent and require manual recovery.`,
      );
    }
    let recovery = "tracked promotion targets were restored";
    try {
      run("bun", ["install", "--frozen-lockfile"], repoRoot, { env: { OMP_CONTEXT_SKIP_HOOK_INSTALL: "1" } });
      run("bun", ["install", "--frozen-lockfile"], join(repoRoot, "test", "host-fixture"));
      recovery += " and installed dependencies were reconciled";
    } catch (recoveryError) {
      recovery += `; dependency reconciliation also failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`;
    }
    throw new Error(`Local OMP promotion failed after candidate validation: ${promotionError instanceof Error ? promotionError.message : String(promotionError)}; ${recovery}`);
  }
  process.stderr.write(
    `Local OMP ${local.version} passed the isolated host contract. Repository dependency fields and locks were updated from ${declared}; review and stage them, then commit again.\n`,
  );
  process.exit(2);
} catch (error) {
  process.stderr.write(`Host contract check failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
