import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const command = join(repoRoot, "scripts", "sync-acm.mjs");
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "acm-sync-"));
  roots.push(root);
  const canonical = join(root, "canonical");
  const consumer = join(root, "consumer");
  mkdirSync(join(canonical, "src"), { recursive: true });
  mkdirSync(join(consumer, "packages", "omp-plugin", "src", "acm"), { recursive: true });
  writeFileSync(join(canonical, "package.json"), JSON.stringify({ name: "omp-context" }));
  writeFileSync(join(consumer, "package.json"), JSON.stringify({ name: "magic-acm-context" }));
  writeFileSync(join(canonical, "src", "index.ts"), "export const canonical = true;\n");
  writeFileSync(join(canonical, "src", "example.test.ts"), 'import value from "./index.js";\n');
  writeFileSync(join(consumer, "packages", "omp-plugin", "src", "acm", "prompt.ts"), "consumer wrapper\n");
  const manifestPath = join(root, "manifest.json");
  const writeManifest = (value: unknown) => writeFileSync(manifestPath, `${JSON.stringify(value, null, 2)}\n`);
  writeManifest({
    version: 1,
    canonicalPackage: "omp-context",
    consumerPackage: "magic-acm-context",
    requiredConsumerPaths: ["packages/omp-plugin/src/acm"],
    preserve: ["packages/omp-plugin/src/acm/prompt.ts"],
    mappings: [
      { source: "src/index.ts", destination: "packages/omp-plugin/src/acm/tools.ts", transform: "copy" },
    ],
  });
  return { root, canonical, consumer, manifestPath, writeManifest };
}

async function runSync(fixture: ReturnType<typeof createFixture>, ...extra: string[]) {
  const process = Bun.spawn([
    "bun",
    command,
    "--canonical-root",
    fixture.canonical,
    "--consumer-root",
    fixture.consumer,
    "--manifest",
    fixture.manifestPath,
    ...extra,
  ], { stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

function snapshotConsumer(consumer: string) {
  const tool = join(consumer, "packages", "omp-plugin", "src", "acm", "tools.ts");
  const prompt = join(consumer, "packages", "omp-plugin", "src", "acm", "prompt.ts");
  return {
    tool: Bun.file(tool).size > 0 ? readFileSync(tool, "utf8") : null,
    prompt: readFileSync(prompt, "utf8"),
  };
}

describe("manual ACM sync command", () => {
  test("copies declared artifacts, preserves wrappers, and is idempotent", async () => {
    const fixture = createFixture();
    const first = await runSync(fixture);
    expect(first.exitCode).toBe(0);
    expect(first.stdout).toContain("changed packages/omp-plugin/src/acm/tools.ts");
    expect(readFileSync(join(fixture.consumer, "packages/omp-plugin/src/acm/tools.ts"), "utf8")).toBe("export const canonical = true;\n");
    expect(readFileSync(join(fixture.consumer, "packages/omp-plugin/src/acm/prompt.ts"), "utf8")).toBe("consumer wrapper\n");

    const second = await runSync(fixture);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("no changes");

    writeFileSync(join(fixture.canonical, "src", "index.ts"), "export const canonical = 'updated';\n");
    const changed = await runSync(fixture);
    expect(changed.exitCode).toBe(0);
    expect(changed.stdout).toContain("changed packages/omp-plugin/src/acm/tools.ts");
    expect(readFileSync(join(fixture.consumer, "packages/omp-plugin/src/acm/tools.ts"), "utf8")).toContain("updated");
  });

  test("preflight failures leave the consumer byte-for-byte unchanged", async () => {
    const fixture = createFixture();
    const before = snapshotConsumer(fixture.consumer);
    fixture.writeManifest({
      version: 1,
      canonicalPackage: "omp-context",
      consumerPackage: "magic-acm-context",

      requiredConsumerPaths: ["packages/omp-plugin/src/acm"],
      preserve: ["packages/omp-plugin/src/acm/prompt.ts"],
      mappings: [
        { source: "src/missing.ts", destination: "packages/omp-plugin/src/acm/tools.ts", transform: "copy" },
      ],
    });

    const result = await runSync(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("missing required source: src/missing.ts");
    expect(snapshotConsumer(fixture.consumer)).toEqual(before);
  });

  test("rejects duplicate destinations and unsupported transforms before writing", async () => {
    for (const invalidMappings of [
      [
        { source: "src/index.ts", destination: "packages/omp-plugin/src/acm/tools.ts", transform: "copy" },
        { source: "src/example.test.ts", destination: "packages/omp-plugin/src/acm/tools.ts", transform: "copy" },
      ],
      [
        { source: "src/index.ts", destination: "packages/omp-plugin/src/acm/tools.ts", transform: "unknown" },
      ],
    ]) {
      const fixture = createFixture();
      const before = snapshotConsumer(fixture.consumer);
      fixture.writeManifest({
        version: 1,
        canonicalPackage: "omp-context",
        consumerPackage: "magic-acm-context",
        requiredConsumerPaths: ["packages/omp-plugin/src/acm"],
        preserve: ["packages/omp-plugin/src/acm/prompt.ts"],
        mappings: invalidMappings,
      });
      const result = await runSync(fixture);
      expect(result.exitCode).not.toBe(0);
      expect(snapshotConsumer(fixture.consumer)).toEqual(before);
    }
  });

  test("applies declared import transforms and verify-only names corrupted destinations", async () => {
    const fixture = createFixture();
    fixture.writeManifest({
      version: 1,
      canonicalPackage: "omp-context",
      consumerPackage: "magic-acm-context",
      requiredConsumerPaths: ["packages/omp-plugin/src/acm"],
      preserve: ["packages/omp-plugin/src/acm/prompt.ts"],
      mappings: [
        {
          source: "src/example.test.ts",
          destination: "packages/omp-plugin/src/acm/example.test.ts",
          transform: "omp-test-imports",
        },
      ],
    });
    const synced = await runSync(fixture);
    expect(synced.exitCode).toBe(0);
    const destination = join(fixture.consumer, "packages", "omp-plugin", "src", "acm", "example.test.ts");
    expect(readFileSync(destination, "utf8")).toContain('from "./tools.js"');

    writeFileSync(destination, "corrupted\n");
    const verified = await runSync(fixture, "--verify-only");
    expect(verified.exitCode).not.toBe(0);
    expect(verified.stderr).toContain("verification mismatch: packages/omp-plugin/src/acm/example.test.ts");
  });

  test("rejects an incompatible destination root", async () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.consumer, "package.json"), JSON.stringify({ name: "wrong-consumer" }));
    const result = await runSync(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("consumer package mismatch");
  });
});

test("declares the complete canonical guidance surface for the integrated plugin", () => {
  const parsed: unknown = JSON.parse(
    readFileSync(join(repoRoot, "scripts", "acm-sync-manifest.json"), "utf8"),
  );
  const manifest = z.object({
    preserve: z.array(z.string()),
    mappings: z.array(z.object({ source: z.string(), destination: z.string(), transform: z.string() })),
  }).parse(parsed);

  expect(manifest.preserve).toContain("packages/omp-plugin/src/acm/prompt.ts");
  expect(manifest.mappings.map((mapping) => mapping.source).sort()).toEqual([
    "skills/context-management/CORE.md",
    "skills/context-management/SKILL.md",
    "skills/context-management/references/archive-recovery.md",
    "skills/context-management/references/exceptional-recovery.md",
    "skills/context-management/references/target-selection.md",
    "src/generated-guidance.ts",
    "src/index.ts",
    "src/lib.ts",
  ]);
  expect(new Set(manifest.mappings.map((mapping) => mapping.destination)).size).toBe(
    manifest.mappings.length,
  );
});
