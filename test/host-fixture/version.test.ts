import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtureRoot = dirname(fileURLToPath(import.meta.url));
const requireFromFixture = createRequire(join(fixtureRoot, "package.json"));
const packages = [
  "@oh-my-pi/pi-agent-core",
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-coding-agent",
] as const;

describe("OMP 16.4.2 host fixture", () => {
  test("resolves every supported OMP package from the isolated fixture", () => {
    for (const packageName of packages) {
      const packageJsonPath = requireFromFixture.resolve(`${packageName}/package.json`);
      expect(packageJsonPath.startsWith(join(fixtureRoot, "node_modules"))).toBe(true);
      const metadata = requireFromFixture(packageJsonPath) as { version?: string };
      expect(metadata.version).toBe("16.4.2");
    }
  });
});
