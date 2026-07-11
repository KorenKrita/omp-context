#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { renderGuidance } from "./generate-guidance.mjs";

const HOST_PACKAGES = [
  "@oh-my-pi/pi-agent-core",
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-coding-agent",
];

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function findPackageRoot(start, packageNames) {
  let current = start;
  const filesystemRoot = parse(current).root;
  while (true) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      const metadata = readJson(packagePath, "package metadata");
      if (packageNames.includes(metadata.name)) return { root: current, metadata };
    }
    if (current === filesystemRoot) break;
    current = dirname(current);
  }
  throw new Error(`Could not find package ${packageNames.join(" or ")} above ${start}`);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactHostVersion(metadata, label, field) {
  const dependencies = metadata[field];
  if (!dependencies || typeof dependencies !== "object" || Array.isArray(dependencies)) {
    throw new Error(`${label} is missing ${field}`);
  }
  const versions = HOST_PACKAGES.map((packageName) => dependencies[packageName]);
  if (versions.some((version) => typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version))) {
    throw new Error(`${label} must declare exact ${field} versions for every OMP host package`);
  }
  if (!versions.every((version) => version === versions[0])) {
    throw new Error(`${label} OMP host versions disagree: ${versions.join(", ")}`);
  }
  return versions[0];
}

function verifyGuidance(packageRoot, consumerPlugin) {
  const sourcePath = join(packageRoot, "skills", "context-management", "CORE.md");
  const outputPath = consumerPlugin
    ? join(packageRoot, "src", "acm", "generated-guidance.ts")
    : join(packageRoot, "src", "generated-guidance.ts");
  const expected = renderGuidance(readFileSync(sourcePath, "utf8"));
  const actual = readFileSync(outputPath, "utf8");
  if (actual !== expected) throw new Error(`Generated guidance is stale: ${outputPath}`);
}

function verifyProvenance(repositoryRoot, pluginRoot) {
  const provenancePath = join(pluginRoot, "src", "acm", "acm-provenance.json");
  const provenance = readJson(provenancePath, "ACM provenance");
  if (provenance.schemaVersion !== 1 || typeof provenance.artifactHashes !== "object" || provenance.artifactHashes === null) {
    throw new Error("ACM provenance has an unsupported shape");
  }
  for (const [relativePath, expectedHash] of Object.entries(provenance.artifactHashes)) {
    const artifactPath = join(repositoryRoot, relativePath);
    if (!existsSync(artifactPath)) throw new Error(`Provenance artifact is missing: ${relativePath}`);
    const actualHash = sha256(readFileSync(artifactPath));
    if (actualHash !== expectedHash) throw new Error(`Provenance mismatch: ${relativePath}`);
  }
  return provenance.hostVersion;
}

const scriptDir = dirname(fileURLToPath(import.meta.url));
const nearest = findPackageRoot(scriptDir, ["omp-context", "@cortexkit/omp-magic-context"]);
const isConsumerPlugin = nearest.metadata.name === "@cortexkit/omp-magic-context";
const repository = isConsumerPlugin
  ? findPackageRoot(nearest.root, ["magic-acm-context"])
  : nearest;

verifyGuidance(nearest.root, isConsumerPlugin);

const packageVersion = exactHostVersion(nearest.metadata, nearest.metadata.name, "devDependencies");
const peerVersion = exactHostVersion(nearest.metadata, nearest.metadata.name, "peerDependencies");
if (packageVersion !== peerVersion) throw new Error(`Package host versions disagree: ${packageVersion} vs ${peerVersion}`);

const fixturePath = isConsumerPlugin
  ? join(nearest.root, "src", "acm", "host-fixture", "package.json")
  : join(nearest.root, "test", "host-fixture", "package.json");
const fixtureVersion = exactHostVersion(readJson(fixturePath, "host fixture package"), "host fixture", "dependencies");
if (fixtureVersion !== packageVersion) {
  throw new Error(`Host fixture version ${fixtureVersion} does not match package version ${packageVersion}`);
}

if (isConsumerPlugin) {
  const provenanceVersion = verifyProvenance(repository.root, nearest.root);
  if (provenanceVersion !== packageVersion) {
    throw new Error(`Provenance host version ${String(provenanceVersion)} does not match package version ${packageVersion}`);
  }
}

process.stdout.write(`Verified ACM guidance, exact host ${packageVersion}, and ${isConsumerPlugin ? "consumer provenance" : "canonical contracts"}.\n`);
