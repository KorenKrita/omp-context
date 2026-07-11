import { describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const packages = [
  "@oh-my-pi/pi-agent-core",
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-coding-agent",
] as const;

describe("OMP 16.4.2 host fixture", () => {
  test("resolves every supported OMP package from the isolated fixture", () => {
    const probe = Bun.spawnSync({
      cmd: [
        process.execPath,
        "-e",
        `const { createRequire } = require("node:module");
const requireFromFixture = createRequire(process.cwd() + "/package.json");
const packages = ${JSON.stringify(packages)};
console.log(JSON.stringify(packages.map((packageName) => {
  const packageJsonPath = requireFromFixture.resolve(packageName + "/package.json");
  return { packageJsonPath, version: requireFromFixture(packageJsonPath).version };
})));`,
      ],
      cwd: fixtureRoot,
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
      expect(entry.version).toBe("16.4.2");
    }
  });
});
