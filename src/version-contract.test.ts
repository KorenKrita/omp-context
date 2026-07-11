import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const supportedVersion = "16.4.5";
const ompPackages = [
  "@oh-my-pi/pi-agent-core",
  "@oh-my-pi/pi-ai",
  "@oh-my-pi/pi-coding-agent",
] as const;
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

interface PackageManifest {
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

describe("exact OMP host support contract", () => {
  test("pins peer, development, installed, and lock metadata to one exact release", async () => {
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json() as PackageManifest;

    for (const packageName of ompPackages) {
      expect(manifest.peerDependencies?.[packageName]).toBe(supportedVersion);
      expect(manifest.devDependencies?.[packageName]).toBe(supportedVersion);

      const installed = JSON.parse(
        await readFile(join(repoRoot, "node_modules", packageName, "package.json"), "utf8"),
      ) as { version?: string };
      expect(installed.version).toBe(supportedVersion);
    }

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

  test("bootstraps the isolated fixture from its lock before building ACM source", async () => {
    const fixture = await Bun.file(new URL("../test/host-fixture/package.json", import.meta.url)).json() as {
      scripts?: Record<string, string>;
    };

    expect(fixture.scripts?.verify).toStartWith("bun install --frozen-lockfile && bun ./build-source.mjs &&");
  });

  test("documents the exact release and the complete promotion checklist", async () => {
    const readme = await Bun.file(new URL("../README.md", import.meta.url)).text();
    const agents = await Bun.file(new URL("../AGENTS.md", import.meta.url)).text();
    expect(agents).toContain(`精确版本 \`${supportedVersion}\``);
    expect(agents).not.toContain("16.3.15");
    expect(readme).toContain(`支持的 OMP 版本：\`${supportedVersion}\``);
    for (const item of [
      "extension events",
      "public context APIs",
      "Host Bridge capabilities",
      "session-context construction",
      "tool registration",
      "token estimation",
      "compaction events",
      "changelog review",
    ]) {
      expect(readme).toContain(item);
    }
    expect(readme).toContain("isolated candidate");
    expect(readme).toContain("atomically replace every exact OMP version");
  });
});
