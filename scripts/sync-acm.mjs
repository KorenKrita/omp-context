#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));

function fail(message) {
  process.stderr.write(`ACM sync error: ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const result = { verifyOnly: false, manifest: join(scriptDir, "acm-sync-manifest.json") };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--verify-only") {
      result.verifyOnly = true;
      continue;
    }
    if (["--canonical-root", "--consumer-root", "--manifest"].includes(arg)) {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      const key = arg === "--canonical-root" ? "canonicalRoot" : arg === "--consumer-root" ? "consumerRoot" : "manifest";
      result[key] = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
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

function assertRootPackage(root, expectedName, label) {
  const packagePath = join(root, "package.json");
  if (!existsSync(packagePath)) throw new Error(`${label} root missing package.json: ${root}`);
  const metadata = readJson(packagePath, `${label} package`);
  if (metadata.name !== expectedName) {
    throw new Error(`${label} package mismatch: expected ${expectedName}, found ${String(metadata.name)}`);
  }
}

function resolveInside(root, path, label) {
  if (typeof path !== "string" || path.trim() === "" || isAbsolute(path)) {
    throw new Error(`${label} must be a non-empty relative path`);
  }
  const resolved = resolve(root, path);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) throw new Error(`${label} escapes its root: ${path}`);
  return resolved;
}

const OMP_HOST_PACKAGES = [
  "@oh-my-pi/pi-agent-core",
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-coding-agent",
];

function parseJsonObject(source, label) {
  const value = JSON.parse(source);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value;
}

const transforms = {
  copy(source) {
    return source;
  },
  "omp-test-imports"(source) {
    return source
      .replaceAll('from "./index.js"', 'from "./tools.js"')
      .replaceAll("from './index.js'", "from './tools.js'")
      .replaceAll('new URL("./index.ts", import.meta.url)', 'new URL("./tools.ts", import.meta.url)')
      .replaceAll("new URL('./index.ts', import.meta.url)", "new URL('./tools.ts', import.meta.url)")
      .replaceAll("../skills/context-management", "../../skills/context-management");
  },
  "omp-host-test-imports"(source) {
    return source
      .replaceAll("../../src/index.js", "../tools.js")
      .replaceAll("../../src/lib.js", "../lib.js")
      .replaceAll("../../src/host-bridge.js", "../host-bridge.js")
      .replaceAll("../../src/generated-guidance.js", "../generated-guidance.js");
  },
  "omp-package-metadata"(source, destination) {
    if (destination === undefined) throw new Error("omp-package-metadata requires an existing destination package.json");
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
        if (typeof version !== "string" || version.length === 0) {
          throw new Error(`canonical package metadata is missing exact ${field}.${packageName}`);
        }
        consumer[field][packageName] = version;
      }
      if (typeof consumer[field]["@oh-my-pi/pi-tui"] === "string") {
        consumer[field]["@oh-my-pi/pi-tui"] = canonicalDependencies["@oh-my-pi/pi-coding-agent"];
      }
    }
    const indentation = destination.match(/\n([\t ]+)"/)?.[1] ?? "  ";
    return `${JSON.stringify(consumer, null, indentation)}\n`;
  },
};

function preflight(options, manifest) {
  if (manifest.version !== 1) throw new Error(`unsupported manifest version: ${String(manifest.version)}`);
  if (!Array.isArray(manifest.mappings) || manifest.mappings.length === 0) throw new Error("manifest mappings must be non-empty");
  if (!Array.isArray(manifest.requiredConsumerPaths)) throw new Error("manifest requiredConsumerPaths must be an array");
  if (!Array.isArray(manifest.preserve)) throw new Error("manifest preserve must be an array");

  assertRootPackage(options.canonicalRoot, manifest.canonicalPackage, "canonical");
  assertRootPackage(options.consumerRoot, manifest.consumerPackage, "consumer");

  for (const requiredPath of manifest.requiredConsumerPaths) {
    const resolved = resolveInside(options.consumerRoot, requiredPath, "required consumer path");
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new Error(`incompatible consumer layout: missing directory ${requiredPath}`);
    }
  }

  const preserved = new Map();
  const preservedDestinations = new Set();
  for (const path of manifest.preserve) {
    const resolved = resolveInside(options.consumerRoot, path, "preserved path");
    if (!existsSync(resolved) || !statSync(resolved).isFile()) throw new Error(`missing preserved consumer artifact: ${path}`);
    preserved.set(path, readFileSync(resolved));
    preservedDestinations.add(path);
  }

  const destinations = new Set();
  const outputs = [];
  for (const mapping of manifest.mappings) {
    if (!mapping || typeof mapping !== "object") throw new Error("every mapping must be an object");
    const sourcePath = resolveInside(options.canonicalRoot, mapping.source, "mapping source");
    const destinationPath = resolveInside(options.consumerRoot, mapping.destination, "mapping destination");
    if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) throw new Error(`missing required source: ${mapping.source}`);
    if (destinations.has(mapping.destination)) throw new Error(`duplicate mapping destination: ${mapping.destination}`);
    if (preservedDestinations.has(mapping.destination)) throw new Error(`mapping conflicts with preserved artifact: ${mapping.destination}`);
    destinations.add(mapping.destination);
    const transform = transforms[mapping.transform];
    if (!transform) throw new Error(`unsupported transform '${String(mapping.transform)}' for ${mapping.source}`);
    const source = readFileSync(sourcePath, "utf8");
    const destination = existsSync(destinationPath) ? readFileSync(destinationPath, "utf8") : undefined;
    outputs.push({
      source: mapping.source,
      destination: mapping.destination,
      destinationPath,
      expected: transform(source, destination),
    });
  }
  return { outputs, preserved };
}

function verify(outputs, consumerRoot) {
  for (const output of outputs) {
    if (!existsSync(output.destinationPath)) throw new Error(`verification mismatch: ${output.destination} is missing`);
    const actual = readFileSync(output.destinationPath, "utf8");
    if (actual !== output.expected) throw new Error(`verification mismatch: ${output.destination}`);
  }
  for (const output of outputs) {
    const relativePath = relative(consumerRoot, output.destinationPath);
    if (relativePath.startsWith("..")) throw new Error(`verification escaped consumer root: ${output.destination}`);
  }
}

function writeOutputs(outputs) {
  const changed = [];
  for (const output of outputs) {
    const current = existsSync(output.destinationPath) ? readFileSync(output.destinationPath, "utf8") : undefined;
    if (current === output.expected) continue;
    mkdirSync(dirname(output.destinationPath), { recursive: true });
    const temporary = `${output.destinationPath}.acm-sync-${process.pid}`;
    writeFileSync(temporary, output.expected);
    renameSync(temporary, output.destinationPath);
    changed.push(output.destination);
  }
  return changed;
}

function verifyPreserved(preserved, consumerRoot) {
  for (const [path, bytes] of preserved) {
    const actual = readFileSync(resolveInside(consumerRoot, path, "preserved path"));
    if (!actual.equals(bytes)) throw new Error(`preserved artifact changed: ${path}`);
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const manifest = readJson(options.manifest, "sync manifest");
  const plan = preflight(options, manifest);
  if (options.verifyOnly) {
    verify(plan.outputs, options.consumerRoot);
    verifyPreserved(plan.preserved, options.consumerRoot);
    process.stdout.write(`ACM sync verified ${plan.outputs.length} mapped artifact(s); no writes performed.\n`);
  } else {
    const changed = writeOutputs(plan.outputs);
    verify(plan.outputs, options.consumerRoot);
    verifyPreserved(plan.preserved, options.consumerRoot);
    if (changed.length === 0) process.stdout.write("ACM sync complete: no changes.\n");
    else for (const path of changed.sort()) process.stdout.write(`changed ${path}\n`);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
