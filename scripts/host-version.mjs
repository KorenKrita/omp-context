import { accessSync, constants, existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, parse } from "node:path";

export const OMP_HOST_PACKAGES = [
  "@oh-my-pi/pi-agent-core",
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-coding-agent",
];

const EXACT_VERSION = /^\d+\.\d+\.\d+$/;

function readJson(path, label) {
  if (!existsSync(path)) throw new Error(`${label} is missing: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`Failed to parse ${label} at ${path}`, { cause });
  }
}

function findPackageRoot(start, expectedName) {
  let current = start;
  const filesystemRoot = parse(current).root;
  while (true) {
    const packagePath = join(current, "package.json");
    if (existsSync(packagePath)) {
      const metadata = readJson(packagePath, expectedName);
      if (metadata.name === expectedName) return { root: current, metadata };
    }
    if (current === filesystemRoot) break;
    current = dirname(current);
  }
  throw new Error(`Could not find ${expectedName} above ${start}`);
}

export function readLocalOmpInstallation() {
  const override = process.env.OMP_EXECUTABLE;
  if (override) {
    try {
      accessSync(override, constants.X_OK);
    } catch {
      throw new Error(`OMP_EXECUTABLE must point to an executable file: ${override}`);
    }
  }
  const candidates = override
    ? [override]
    : (process.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)
      .map((directory) => join(directory, "omp"))
      .filter((candidate) => {
        try {
          accessSync(candidate, constants.X_OK);
          return true;
        } catch {
          return false;
        }
      });
  const executable = override
    ?? candidates.find((candidate) => !candidate.replaceAll("\\", "/").includes("/node_modules/.bin/"))
    ?? candidates[0];
  if (!executable) throw new Error("Local OMP executable was not found on PATH");

  const resolvedExecutable = realpathSync(executable);
  const codingAgent = findPackageRoot(dirname(resolvedExecutable), "@oh-my-pi/pi-coding-agent");
  const scopeRoot = dirname(codingAgent.root);
  const versions = new Map();
  const packageRoots = new Map();
  for (const packageName of OMP_HOST_PACKAGES) {
    const shortName = packageName.slice("@oh-my-pi/".length);
    const packageRoot = join(scopeRoot, shortName);
    const metadata = readJson(join(packageRoot, "package.json"), packageName);
    if (metadata.name !== packageName) throw new Error(`Local package mismatch at ${packageRoot}`);
    if (typeof metadata.version !== "string" || !EXACT_VERSION.test(metadata.version)) {
      throw new Error(`Local ${packageName} has invalid version ${String(metadata.version)}`);
    }
    versions.set(packageName, metadata.version);
    packageRoots.set(packageName, packageRoot);
  }

  const uniqueVersions = new Set(versions.values());
  if (uniqueVersions.size !== 1) {
    throw new Error(`Local OMP host packages disagree: ${[...versions].map(([name, version]) => `${name}=${version}`).join(", ")}`);
  }
  const version = versions.get("@oh-my-pi/pi-coding-agent");
  return { executable, resolvedExecutable, version, versions, packageRoots };
}

export function readDeclaredHostVersion(repoRoot) {
  const metadata = readJson(join(repoRoot, "package.json"), "omp-context package");
  const versions = [];
  for (const field of ["devDependencies", "peerDependencies"]) {
    for (const packageName of OMP_HOST_PACKAGES) {
      const version = metadata[field]?.[packageName];
      if (typeof version !== "string" || !EXACT_VERSION.test(version)) {
        throw new Error(`package.json must declare exact ${field}.${packageName}`);
      }
      versions.push(version);
    }
  }
  if (!versions.every((version) => version === versions[0])) {
    throw new Error(`Declared OMP host versions disagree: ${versions.join(", ")}`);
  }
  return versions[0];
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function updateExactHostVersion(repoRoot, version) {
  if (!EXACT_VERSION.test(version)) throw new Error(`Invalid exact host version: ${version}`);

  const packagePath = join(repoRoot, "package.json");
  const fixturePath = join(repoRoot, "test", "host-fixture", "package.json");
  const adapterPath = join(repoRoot, "src", "live-agent-session-adapter.ts");
  const metadata = readJson(packagePath, "omp-context package");
  const fixture = readJson(fixturePath, "host fixture package");
  const adapter = readFileSync(adapterPath, "utf8");
  const pattern = /export const SUPPORTED_AGENT_SESSION_HOST_VERSION = "\d+\.\d+\.\d+";/;

  for (const field of ["devDependencies", "peerDependencies"]) {
    if (!metadata[field] || typeof metadata[field] !== "object" || Array.isArray(metadata[field])) {
      throw new Error(`package.json is missing required object ${field}`);
    }
  }
  if (!fixture.dependencies || typeof fixture.dependencies !== "object" || Array.isArray(fixture.dependencies)) {
    throw new Error("host fixture package is missing required object dependencies");
  }
  if (!pattern.test(adapter)) throw new Error("Could not locate SUPPORTED_AGENT_SESSION_HOST_VERSION");

  for (const field of ["devDependencies", "peerDependencies"]) {
    for (const packageName of OMP_HOST_PACKAGES) metadata[field][packageName] = version;
  }
  for (const packageName of OMP_HOST_PACKAGES) fixture.dependencies[packageName] = version;

  writeJson(packagePath, metadata);
  writeJson(fixturePath, fixture);
  writeFileSync(adapterPath, adapter.replace(pattern, `export const SUPPORTED_AGENT_SESSION_HOST_VERSION = "${version}";`));
}
