import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..");
const packageMetadata = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const marketplace = JSON.parse(readFileSync(join(repoRoot, ".omp-plugin", "marketplace.json"), "utf8"));

function packageName(specifier) {
  if (specifier.startsWith("@")) return specifier.split("/").slice(0, 2).join("/");
  return specifier.split("/", 1)[0];
}

function runtimeImports(path) {
  const source = readFileSync(join(repoRoot, path), "utf8");
  return [...source.matchAll(/^import\s+(?!type\b)[\s\S]*?\sfrom\s+["']([^"']+)["'];?$/gm)]
    .map((match) => match[1])
    .filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:"));
}

describe("marketplace production package contract", () => {
  test("declares every extension runtime import as a dependency or host peer", () => {
    const declared = new Set([
      ...Object.keys(packageMetadata.dependencies ?? {}),
      ...Object.keys(packageMetadata.peerDependencies ?? {}),
    ]);
    const runtimeSpecifiers = [
      ...runtimeImports("src/checkpoint-tool.ts"),
      ...runtimeImports("src/handoff.ts"),
      ...runtimeImports("src/live-agent-session-adapter.ts"),
      ...runtimeImports("src/timeline-tool.ts"),
      ...runtimeImports("src/travel-tool.ts"),
    ];
    const missing = [...new Set(runtimeSpecifiers.map(packageName).filter((name) => !declared.has(name)))];
    expect(missing).toEqual([]);
    expect(packageMetadata.dependencies?.zod).toBe("^3.25.0");
  });

  test("keeps package and marketplace release versions identical", () => {
    expect(marketplace.metadata.version).toBe(packageMetadata.version);
    expect(marketplace.plugins.map((plugin) => plugin.version)).toEqual([packageMetadata.version]);
  });
});
