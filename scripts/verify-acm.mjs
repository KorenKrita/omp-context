#!/usr/bin/env bun
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderGuidance } from "./generate-guidance.mjs";
import { OMP_HOST_PACKAGES, readDeclaredHostVersion } from "./host-version.mjs";

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..");
const metadata = readJson(join(repoRoot, "package.json"), "package metadata");
if (metadata.name !== "omp-context") throw new Error(`Expected omp-context package, found ${String(metadata.name)}`);

const sourcePath = join(repoRoot, "skills", "context-management", "CORE.md");
const outputPath = join(repoRoot, "src", "generated-guidance.ts");
const expectedGuidance = renderGuidance(readFileSync(sourcePath, "utf8"));
if (readFileSync(outputPath, "utf8") !== expectedGuidance) {
  throw new Error(`Generated guidance is stale: ${outputPath}`);
}

const packageVersion = readDeclaredHostVersion(repoRoot);
const fixture = readJson(join(repoRoot, "test", "host-fixture", "package.json"), "host fixture package");
for (const packageName of OMP_HOST_PACKAGES) {
  if (fixture.dependencies?.[packageName] !== packageVersion) {
    throw new Error(`Host fixture ${packageName}=${String(fixture.dependencies?.[packageName])} does not match ${packageVersion}`);
  }
}

process.stdout.write(`Verified canonical guidance and exact tested OMP host ${packageVersion}.\n`);
