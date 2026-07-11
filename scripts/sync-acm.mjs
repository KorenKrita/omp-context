#!/usr/bin/env bun
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const OMP_HOST_PACKAGES = [
  "@oh-my-pi/pi-agent-core",
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-coding-agent",
];
const TEXT_REPLACEMENTS = {
  "omp-test-imports": [
    ['from "./index.js"', 'from "./tools.js"'],
    ['from "./index.ts"', 'from "./tools.ts"'],
    ["new URL('../index.js', import.meta.url)", "new URL('./tools.js', import.meta.url)"],
    ["new URL('./index.js', import.meta.url)", "new URL('./tools.js', import.meta.url)"],
    ["new URL('../skills/context-management", "new URL('../../skills/context-management"],
    ['new URL("../skills/context-management', 'new URL("../../skills/context-management'],
    ["new URL(`../skills/context-management", "new URL(`../../skills/context-management"],
  ],
  "omp-host-test-imports": [
    ['"../../src/index.js"', '"../tools.js"'],
    ['"../../src/lib.js"', '"../lib.js"'],
    ['"../../src/host-bridge.js"', '"../host-bridge.js"'],
    ['"../../src/generated-guidance.js"', '"../generated-guidance.js"'],
    ['"../../src/index.ts"', '"../tools.ts"'],
    ['"../../src/lib.ts"', '"../lib.ts"'],
    ['"../../src/host-bridge.ts"', '"../host-bridge.ts"'],
    ['"../../src/generated-guidance.ts"', '"../generated-guidance.ts"'],
    ['"../../src/label-journal.js"', '"../label-journal.js"'],
    ['"../../src/label-journal.ts"', '"../label-journal.ts"'],
    ['"./.acm-build/index.js"', '"./.acm-build/tools.js"'],
  ],
};

function fail(message) {
  process.stderr.write(`ACM sync error: ${message}\n`);
  process.exitCode = 1;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const result = { verifyOnly: false, manifest: join(scriptDir, "acm-sync-manifest.json") };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--verify-only") {
      result.verifyOnly = true;
      continue;
    }
    if (!["--canonical-root", "--consumer-root", "--manifest"].includes(arg)) throw new Error(`unknown argument: ${arg}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    const key = arg === "--canonical-root" ? "canonicalRoot" : arg === "--consumer-root" ? "consumerRoot" : "manifest";
    result[key] = resolve(value);
    index += 1;
  }
  if (!result.canonicalRoot) throw new Error("--canonical-root is required");
  if (!result.consumerRoot) throw new Error("--consumer-root is required");
  return result;
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function parseJsonObject(source, label) {
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must contain a JSON object`);
  return value;
}

function assertRootPackage(root, expectedName, label) {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) throw new Error(`${label} root missing package.json: ${root}`);
  const metadata = readJson(packagePath, `${label} package`);
  if (metadata.name !== expectedName) {
    throw new Error(`${label} package mismatch: expected ${expectedName}, found ${String(metadata.name)}`);
  }
}

function resolveInside(root, path, label) {
  if (typeof path !== "string" || !path.trim() || isAbsolute(path)) throw new Error(`${label} must be a non-empty relative path`);
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) throw new Error(`${label} escapes its root: ${path}`);
  return resolved;
}

function synchronizeOmpPackageMetadata(source, destination) {
  if (destination === undefined) throw new Error("OMP package metadata transform requires an existing package.json");
  const canonical = parseJsonObject(source, "canonical package metadata");
  const consumer = parseJsonObject(destination, "consumer package metadata");
  for (const field of ["devDependencies", "peerDependencies"]) {
    const canonicalDependencies = canonical[field];
    if (!canonicalDependencies || typeof canonicalDependencies !== "object" || Array.isArray(canonicalDependencies)) {
      throw new Error(`canonical package metadata is missing ${field}`);
    }
    const destinationDependencies = consumer[field];
    if (destinationDependencies !== undefined && (typeof destinationDependencies !== "object" || Array.isArray(destinationDependencies))) {
      throw new Error(`consumer package metadata has invalid ${field}`);
    }
    consumer[field] = destinationDependencies ?? {};
    for (const packageName of OMP_HOST_PACKAGES) {
      const version = canonicalDependencies[packageName];
      if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
        throw new Error(`canonical package metadata is missing exact ${field}.${packageName}`);
      }
      consumer[field][packageName] = version;
    }
    if (typeof consumer[field]["@oh-my-pi/pi-tui"] === "string") {
      consumer[field]["@oh-my-pi/pi-tui"] = canonicalDependencies["@oh-my-pi/pi-coding-agent"];
    }
  }
  return consumer;
}

function renderJson(value, destination) {
  const indentation = destination?.match(/\n([\t ]+)"/)?.[1] ?? "  ";
  return `${JSON.stringify(value, null, indentation)}\n`;
}

function replaceAllRequired(source, replacements, transformName) {
  let output = source;
  let replacementCount = 0;
  for (const [from, to] of replacements) {
    const count = output.split(from).length - 1;
    if (count === 0) continue;
    output = output.replaceAll(from, to);
    replacementCount += count;
  }
  if (replacementCount === 0) throw new Error(`${transformName} expected at least one declared source fragment`);
  return output;
}

function transformSource(transformName, source, destination) {
  if (transformName === "copy") return source;
  if (transformName in TEXT_REPLACEMENTS) return replaceAllRequired(source, TEXT_REPLACEMENTS[transformName], transformName);
  if (transformName === "omp-guidance-generator") {
    return replaceAllRequired(source, [
      ['const defaultOutputPath = join(repoRoot, "src", "generated-guidance.ts");', 'const defaultOutputPath = join(repoRoot, "src", "acm", "generated-guidance.ts");'],
    ], transformName);
  }
  if (transformName === "omp-guidance-generator-test") {
    return replaceAllRequired(source, [
      ['const outputPath = join(repoRoot, "src", "generated-guidance.ts");', 'const outputPath = join(repoRoot, "src", "acm", "generated-guidance.ts");'],
      ['from "../src/generated-guidance.ts"', 'from "../src/acm/generated-guidance.ts"'],
    ], transformName);
  }
  if (transformName === "omp-package-metadata") {
    return renderJson(synchronizeOmpPackageMetadata(source, destination), destination);
  }
  if (transformName === "omp-plugin-package-metadata") {
    const consumer = synchronizeOmpPackageMetadata(source, destination);
    const scripts = consumer.scripts;
    if (scripts !== undefined && (typeof scripts !== "object" || scripts === null || Array.isArray(scripts))) {
      throw new Error("consumer plugin package metadata has invalid scripts");
    }
    consumer.scripts = scripts ?? {};
    consumer.scripts["generate:guidance"] = "bun scripts/generate-guidance.mjs";
    consumer.scripts["test:guidance"] = "bun test scripts/generate-guidance.test.mjs";
    consumer.scripts["test:host"] = "bun run --cwd src/acm/host-fixture verify";
    consumer.scripts["verify:acm"] = "bun scripts/verify-acm.mjs && bun scripts/generate-guidance.mjs --check && bun run test:guidance && bun run test:host";
    return renderJson(consumer, destination);
  }
  throw new Error(`unsupported transform '${transformName}'`);
}

function validateTransformedOutput(output, actual) {
  if (actual !== output.expected) throw new Error(`verification mismatch: ${output.destination}`);
  if (output.transform === "copy") return;
  if (output.transform in TEXT_REPLACEMENTS) {
    for (const [from] of TEXT_REPLACEMENTS[output.transform]) {
      if (actual.includes(from)) throw new Error(`verification retained forbidden source fragment in ${output.destination}: ${from}`);
    }
    return;
  }
  if (output.transform === "omp-guidance-generator") {
    if (!actual.includes('join(repoRoot, "src", "acm", "generated-guidance.ts")')) {
      throw new Error(`verification missing consumer guidance output path: ${output.destination}`);
    }
    return;
  }
  if (output.transform === "omp-guidance-generator-test") {
    if (!actual.includes('from "../src/acm/generated-guidance.ts"')) {
      throw new Error(`verification missing consumer guidance test import: ${output.destination}`);
    }
    return;
  }
  if (output.transform === "provenance") {
    const provenance = parseJsonObject(actual, "ACM provenance");
    if (provenance.schemaVersion !== 1 || typeof provenance.artifactHashes !== "object" || provenance.artifactHashes === null) {
      throw new Error(`verification found invalid provenance: ${output.destination}`);
    }
    return;
  }
  if (output.transform === "omp-package-metadata" || output.transform === "omp-plugin-package-metadata") {
    const canonical = parseJsonObject(output.sourceBytes, "canonical package metadata");
    const consumer = parseJsonObject(actual, "synchronized package metadata");
    for (const field of ["devDependencies", "peerDependencies"]) {
      for (const packageName of OMP_HOST_PACKAGES) {
        if (consumer[field]?.[packageName] !== canonical[field]?.[packageName]) {
          throw new Error(`verification mismatch: ${output.destination} ${field}.${packageName}`);
        }
      }
    }
    if (output.transform === "omp-plugin-package-metadata" && typeof consumer.scripts?.["verify:acm"] !== "string") {
      throw new Error(`verification missing verify:acm command: ${output.destination}`);
    }
  }
}

function createProvenanceOutput(options, manifest, outputs, destinations, preservedDestinations) {
  if (typeof manifest.provenanceDestination !== "string") return undefined;
  const destination = manifest.provenanceDestination;
  if (destinations.has(destination) || preservedDestinations.has(destination)) {
    throw new Error(`provenance destination conflicts with another artifact: ${destination}`);
  }
  const canonicalPackage = readJson(join(options.canonicalRoot, "package.json"), "canonical package");
  const hostVersions = OMP_HOST_PACKAGES.map((packageName) => canonicalPackage.peerDependencies?.[packageName]);
  if (hostVersions.some((version) => typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) || !hostVersions.every((version) => version === hostVersions[0])) {
    throw new Error("canonical peer dependency host versions must be exact and identical");
  }
  const provenance = {
    schemaVersion: 1,
    canonicalPackage: manifest.canonicalPackage,
    canonicalVersion: canonicalPackage.version,
    hostVersion: hostVersions[0],
    manifestSha256: sha256(readFileSync(options.manifest)),
    artifactHashes: Object.fromEntries(outputs.map((output) => [output.destination, sha256(output.expected)])),
  };
  return {
    source: options.manifest,
    sourceBytes: readFileSync(options.manifest, "utf8"),
    destination,
    destinationPath: resolveInside(options.consumerRoot, destination, "provenance destination"),
    transform: "provenance",
    expected: `${JSON.stringify(provenance, null, 2)}\n`,
  };
}

function preflight(options, manifest) {
  if (manifest.version !== 1) throw new Error("manifest version must be 1");
  if (!Array.isArray(manifest.mappings) || manifest.mappings.length === 0) throw new Error("manifest mappings must be non-empty");
  if (!Array.isArray(manifest.requiredConsumerPaths)) throw new Error("manifest requiredConsumerPaths must be an array");
  if (!Array.isArray(manifest.preserve)) throw new Error("manifest preserve must be an array");
  assertRootPackage(options.canonicalRoot, manifest.canonicalPackage, "canonical");
  assertRootPackage(options.consumerRoot, manifest.consumerPackage, "consumer");

  for (const requiredPath of manifest.requiredConsumerPaths) {
    const resolved = resolveInside(options.consumerRoot, requiredPath, "required consumer path");
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) throw new Error(`incompatible consumer layout: missing directory ${requiredPath}`);
  }

  const preserved = new Map();
  const preservedDestinations = new Set();
  for (const path of manifest.preserve) {
    const resolved = resolveInside(options.consumerRoot, path, "preserve path");
    if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error(`missing preserved consumer artifact: ${path}`);
    preserved.set(path, readFileSync(resolved));
    preservedDestinations.add(path);
  }

  const destinations = new Set();
  const outputs = [];
  for (const mapping of manifest.mappings) {
    if (!mapping || typeof mapping !== "object") throw new Error("every mapping must be an object");
    const sourcePath = resolveInside(options.canonicalRoot, mapping.source, "mapping source");
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error(`missing required source: ${mapping.source}`);
    const destinationPath = resolveInside(options.consumerRoot, mapping.destination, "mapping destination");
    if (destinations.has(mapping.destination)) throw new Error(`duplicate mapping destination: ${mapping.destination}`);
    if (preservedDestinations.has(mapping.destination)) throw new Error(`mapping conflicts with preserved artifact: ${mapping.destination}`);
    destinations.add(mapping.destination);
    const destinationBytes = existsSync(destinationPath) && statSync(destinationPath).isFile()
      ? readFileSync(destinationPath, "utf8")
      : undefined;
    const sourceBytes = readFileSync(sourcePath, "utf8");
    outputs.push({
      source: mapping.source,
      sourceBytes,
      destination: mapping.destination,
      destinationPath,
      transform: mapping.transform,
      expected: transformSource(mapping.transform, sourceBytes, destinationBytes),
    });
  }
  const provenanceOutput = createProvenanceOutput(options, manifest, outputs, destinations, preservedDestinations);
  if (provenanceOutput) outputs.push(provenanceOutput);
  return { outputs, preserved };
}

function verify(outputs, consumerRoot) {
  for (const output of outputs) {
    if (!existsSync(output.destinationPath) || !statSync(output.destinationPath).isFile()) {
      throw new Error(`verification mismatch: ${output.destination} is missing`);
    }
    validateTransformedOutput(output, readFileSync(output.destinationPath, "utf8"));
    if (relative(consumerRoot, output.destinationPath).startsWith("..")) {
      throw new Error(`verification escaped consumer root: ${output.destination}`);
    }
  }
}

function verifyPreserved(preserved, consumerRoot) {
  for (const [path, bytes] of preserved) {
    const actual = readFileSync(resolveInside(consumerRoot, path, "preserved path"));
    if (!actual.equals(bytes)) throw new Error(`preserved artifact changed: ${path}`);
  }
}

function publishTransactionally(outputs, consumerRoot) {
  const changed = outputs.filter((output) => {
    if (!existsSync(output.destinationPath) || !statSync(output.destinationPath).isFile()) return true;
    return readFileSync(output.destinationPath, "utf8") !== output.expected;
  });
  if (changed.length === 0) return [];

  const stagingRoot = mkdtempSync(join(consumerRoot, ".acm-sync-stage-"));
  const stagedRoot = join(stagingRoot, "new");
  const backupRoot = join(stagingRoot, "backup");
  const committed = [];
  try {
    for (const output of changed) {
      const stagedPath = resolveInside(stagedRoot, output.destination, "staged destination");
      mkdirSync(dirname(stagedPath), { recursive: true });
      writeFileSync(stagedPath, output.expected);
      validateTransformedOutput(output, readFileSync(stagedPath, "utf8"));
    }

    for (const output of changed) {
      const stagedPath = resolveInside(stagedRoot, output.destination, "staged destination");
      const backupPath = resolveInside(backupRoot, output.destination, "backup destination");
      mkdirSync(dirname(output.destinationPath), { recursive: true });
      let hadOriginal = false;
      if (existsSync(output.destinationPath)) {
        if (!statSync(output.destinationPath).isFile()) throw new Error(`destination is not a file: ${output.destination}`);
        mkdirSync(dirname(backupPath), { recursive: true });
        renameSync(output.destinationPath, backupPath);
        hadOriginal = true;
      }
      try {
        renameSync(stagedPath, output.destinationPath);
      } catch (error) {
        if (hadOriginal && existsSync(backupPath)) renameSync(backupPath, output.destinationPath);
        throw error;
      }
      committed.push({ output, backupPath, hadOriginal });
    }
    verify(outputs, consumerRoot);
    return changed.map((output) => output.destination);
  } catch (error) {
    for (const entry of committed.reverse()) {
      rmSync(entry.output.destinationPath, { force: true });
      if (entry.hadOriginal && existsSync(entry.backupPath)) {
        mkdirSync(dirname(entry.output.destinationPath), { recursive: true });
        renameSync(entry.backupPath, entry.output.destinationPath);
      }
    }
    throw error;
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readJson(options.manifest, "manifest");
  const plan = preflight(options, manifest);
  if (options.verifyOnly) {
    verify(plan.outputs, options.consumerRoot);
    verifyPreserved(plan.preserved, options.consumerRoot);
    process.stdout.write(`ACM sync verified ${plan.outputs.length} mapped artifact(s); no writes performed.\n`);
  } else {
    const changed = publishTransactionally(plan.outputs, options.consumerRoot);
    verifyPreserved(plan.preserved, options.consumerRoot);
    if (changed.length === 0) process.stdout.write("ACM sync complete: no changes.\n");
    else for (const destination of changed.sort()) process.stdout.write(`changed ${destination}\n`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
