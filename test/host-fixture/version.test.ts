import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const buildRoot = join(fixtureRoot, ".acm-build");
const packages = [
  "@oh-my-pi/pi-agent-core",
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-coding-agent",
] as const;
const fixturePackage = JSON.parse(readFileSync(join(fixtureRoot, "package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const supportedVersion = fixturePackage.dependencies[packages[0]];


interface HostPackageEvidence {
  supportedVersion: string;
  entrypoints: Array<{ source: string; output: string }>;
  resolvedPackages: Array<{
    packageName: string;
    packageJsonPath: string;
    relativePackageJsonPath: string;
    version: string;
  }>;
}

describe("exact OMP host fixture", () => {
  test("records the isolated source build and exact host package graph", () => {
    const evidence = JSON.parse(
      readFileSync(join(buildRoot, "host-packages.json"), "utf8"),
    ) as HostPackageEvidence;

    expect(evidence.supportedVersion).toBe(supportedVersion);
    expect(evidence.entrypoints.map(({ output }) => output).sort()).toEqual([
      "generated-guidance.js",
      "host-bridge.js",
      "index.js",
      "lib.js",
    ]);
    expect(evidence.resolvedPackages.map(({ packageName }) => packageName).sort()).toEqual([...packages].sort());
    for (const entry of evidence.resolvedPackages) {
      expect(entry.packageJsonPath.startsWith(join(fixtureRoot, "node_modules"))).toBe(true);
      expect(entry.relativePackageJsonPath.startsWith("node_modules")).toBe(true);
      expect(entry.version).toBe(supportedVersion);
    }
  });

  test("resolves every supported OMP package from the built ACM module origin", () => {
    const probe = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        `const { createRequire } = require("node:module");
const requireFromBuild = createRequire(process.cwd() + "/index.js");
const packages = ${JSON.stringify(packages)};
console.log(JSON.stringify(packages.map((packageName) => {
  const packageJsonPath = requireFromBuild.resolve(packageName + "/package.json");
  return { packageJsonPath, version: requireFromBuild(packageJsonPath).version };
})));`,
      ],
      cwd: buildRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(probe.exitCode, new TextDecoder().decode(probe.stderr)).toBe(0);
    const resolved = JSON.parse(new TextDecoder().decode(probe.stdout)) as Array<{
      packageJsonPath: string;
      version: string;
    }>;

    expect(resolved).toHaveLength(packages.length);
    for (const entry of resolved) {
      expect(entry.packageJsonPath.startsWith(join(fixtureRoot, "node_modules"))).toBe(true);
      expect(entry.version).toBe(supportedVersion);
    }
  });
});
