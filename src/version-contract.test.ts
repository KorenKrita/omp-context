import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ompPackages = [
  "@oh-my-pi/pi-agent-core",
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-coding-agent",
] as const;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface PackageManifest {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

describe("exact OMP host support contract", () => {
  test("pins peer, development, installed, fixture, adapter, and lock metadata to one exact release", async () => {
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json() as PackageManifest;
    const supportedVersion = manifest.peerDependencies?.["@oh-my-pi/pi-coding-agent"];
    expect(supportedVersion).toMatch(/^\d+\.\d+\.\d+$/);
    if (!supportedVersion) throw new Error("Missing exact OMP host version");

    for (const packageName of ompPackages) {
      expect(manifest.peerDependencies?.[packageName]).toBe(supportedVersion);
      expect(manifest.devDependencies?.[packageName]).toBe(supportedVersion);

      const installed = JSON.parse(
        await readFile(join(repoRoot, "node_modules", packageName, "package.json"), "utf8"),
      ) as { version?: string };
      expect(installed.version).toBe(supportedVersion);
    }

    const fixture = await Bun.file(new URL("../test/host-fixture/package.json", import.meta.url)).json() as {
      dependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    for (const packageName of ompPackages) expect(fixture.dependencies?.[packageName]).toBe(supportedVersion);
    expect(fixture.scripts?.verify).toStartWith("bun install --frozen-lockfile && bun ./build-source.mjs &&");

    const adapter = await Bun.file(new URL("./live-agent-session-adapter.ts", import.meta.url)).text();
    expect(adapter).toContain(`SUPPORTED_AGENT_SESSION_HOST_VERSION = "${supportedVersion}"`);

    const lock = await Bun.file(new URL("../bun.lock", import.meta.url)).text();
    const workspaceSection = lock.split("\n  \"packages\":")[0] ?? "";
    for (const packageName of ompPackages) {
      expect(workspaceSection).toContain(`\"${packageName}\": \"${supportedVersion}\"`);
      expect(lock).toContain(`\"${packageName}\": [\"${packageName}@${supportedVersion}\"`);
    }

    const lockedOmpVersions = new Set(
      [...lock.matchAll(/"@oh-my-pi\/[^"]+@([0-9]+\.[0-9]+\.[0-9]+)"/g)]
        .map((match) => match[1]),
    );
    expect([...lockedOmpVersions]).toEqual([supportedVersion]);
  });

  test("installs a repository-local pre-commit host contract gate", async () => {
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json() as PackageManifest;
    const hook = await Bun.file(new URL("../.githooks/pre-commit", import.meta.url)).text();
    const agents = await Bun.file(new URL("../AGENTS.md", import.meta.url)).text();

    expect(manifest.scripts?.prepare).toContain("install-git-hooks.mjs");
    expect(manifest.scripts?.["host:check-local"]).toContain("--check-only");
    expect(manifest.scripts?.["host:promote-local"]).toContain("precommit-host-contract.mjs");
    expect(hook).toContain("precommit-host-contract.mjs");
    expect(agents).toContain("每次 commit");
    expect(agents).toContain("host:promote-local");
    expect(agents).toContain("cold candidate");
  });
});
