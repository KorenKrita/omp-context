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

interface SyncFixture {
  root: string;
  canonical: string;
  consumer: string;
  manifestPath: string;
  writeManifest(value: unknown): void;
}

interface ConsumerSnapshot {
  tool: string | null;
  prompt: string;
}

function createFixture(): SyncFixture {
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

async function runSync(fixture: SyncFixture, ...extra: string[]) {
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

function snapshotConsumer(consumer: string): ConsumerSnapshot {
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

  test("transforms exact OMP metadata without replacing consumer-owned package fields", async () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.canonical, "package.json"), JSON.stringify({
      name: "omp-context",
      devDependencies: {
        "@oh-my-pi/pi-agent-core": "16.4.5",
        "@oh-my-pi/pi-ai": "16.4.5",
        "@oh-my-pi/pi-coding-agent": "16.4.5",
      },
      peerDependencies: {
        "@oh-my-pi/pi-agent-core": "16.4.5",
        "@oh-my-pi/pi-ai": "16.4.5",
        "@oh-my-pi/pi-coding-agent": "16.4.5",
      },
    }, null, 2));
    writeFileSync(join(fixture.consumer, "package.json"), JSON.stringify({
      name: "magic-acm-context",
      private: true,
      devDependencies: { unrelated: "1.0.0", "@oh-my-pi/pi-tui": "^16.0.0" },
      peerDependencies: {
        "@oh-my-pi/pi-coding-agent": "^16.0.0",
        "@oh-my-pi/pi-tui": "^16.0.0",
      },
    }, null, 4));
    fixture.writeManifest({
      version: 1,
      canonicalPackage: "omp-context",
      consumerPackage: "magic-acm-context",
      requiredConsumerPaths: ["packages/omp-plugin/src/acm"],
      preserve: ["packages/omp-plugin/src/acm/prompt.ts"],
      mappings: [
        { source: "package.json", destination: "package.json", transform: "omp-package-metadata" },
      ],
    });

    const result = await runSync(fixture);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(fixture.consumer, "package.json"), "utf8")).toContain('\n    "name"');
    const consumer = JSON.parse(readFileSync(join(fixture.consumer, "package.json"), "utf8"));
    expect(consumer.name).toBe("magic-acm-context");
    expect(consumer.private).toBe(true);
    expect(consumer.devDependencies.unrelated).toBe("1.0.0");
    for (const packageName of [
      "@oh-my-pi/pi-agent-core",
      "@oh-my-pi/pi-ai",
      "@oh-my-pi/pi-coding-agent",
    ]) {
      expect(consumer.devDependencies[packageName]).toBe("16.4.5");
      expect(consumer.peerDependencies[packageName]).toBe("16.4.5");
    }
    expect(consumer.devDependencies["@oh-my-pi/pi-tui"]).toBe("16.4.5");
    expect(consumer.peerDependencies["@oh-my-pi/pi-tui"]).toBe("16.4.5");
  });

  test("installs reproducible guidance and isolated host commands in the consumer plugin", async () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.canonical, "package.json"), JSON.stringify({
      name: "omp-context",
      devDependencies: {
        "@oh-my-pi/pi-agent-core": "16.4.5",
        "@oh-my-pi/pi-ai": "16.4.5",
        "@oh-my-pi/pi-coding-agent": "16.4.5",
      },
      peerDependencies: {
        "@oh-my-pi/pi-agent-core": "16.4.5",
        "@oh-my-pi/pi-ai": "16.4.5",
        "@oh-my-pi/pi-coding-agent": "16.4.5",
      },
    }, null, 2));
    const pluginPackage = join(fixture.consumer, "packages", "omp-plugin", "package.json");
    writeFileSync(pluginPackage, JSON.stringify({
      name: "@cortexkit/omp-magic-context",
      scripts: { build: "bun build src/index.ts" },
    }, null, 2));
    fixture.writeManifest({
      version: 1,
      canonicalPackage: "omp-context",
      consumerPackage: "magic-acm-context",
      requiredConsumerPaths: ["packages/omp-plugin/src/acm"],
      preserve: ["packages/omp-plugin/src/acm/prompt.ts"],
      mappings: [
        {
          source: "package.json",
          destination: "packages/omp-plugin/package.json",
          transform: "omp-plugin-package-metadata",
        },
      ],
    });

    const result = await runSync(fixture);
    expect(result.exitCode).toBe(0);
    const plugin = JSON.parse(readFileSync(pluginPackage, "utf8"));
    expect(plugin.scripts.build).toBe("bun build src/index.ts");
    expect(plugin.scripts["generate:guidance"]).toBe("bun scripts/generate-guidance.mjs");
    expect(plugin.scripts["test:guidance"]).toBe("bun test scripts/generate-guidance.test.mjs");
    expect(plugin.scripts["test:host"]).toBe("bun run --cwd src/acm/host-fixture verify");
  });

  test("rewrites standalone real-host imports through a declared transform", async () => {
    const fixture = createFixture();
    mkdirSync(join(fixture.canonical, "test", "host-fixture"), { recursive: true });
    writeFileSync(
      join(fixture.canonical, "test", "host-fixture", "travel.test.ts"),
      [
        'import register from "../../src/index.js";',
        'import { helper } from "../../src/lib.js";',
        'import { bridge } from "../../src/host-bridge.js";',
        'import { GUIDANCE_CUES } from "../../src/generated-guidance.js";',
        'const source = "../../src/index.ts";',
        'const bridge = "../../src/host-bridge.ts";',
      ].join("\n"),
    );
    fixture.writeManifest({
      version: 1,
      canonicalPackage: "omp-context",
      consumerPackage: "magic-acm-context",
      requiredConsumerPaths: ["packages/omp-plugin/src/acm"],
      preserve: ["packages/omp-plugin/src/acm/prompt.ts"],
      mappings: [
        {
          source: "test/host-fixture/travel.test.ts",
          destination: "packages/omp-plugin/src/acm/host-fixture/travel.test.ts",
          transform: "omp-host-test-imports",
        },
      ],
    });

    const result = await runSync(fixture);
    expect(result.exitCode).toBe(0);
    const destination = readFileSync(
      join(fixture.consumer, "packages", "omp-plugin", "src", "acm", "host-fixture", "travel.test.ts"),
      "utf8",
    );
    expect(destination).toContain('from "../tools.js"');
    expect(destination).toContain('from "../lib.js"');
    expect(destination).toContain('from "../host-bridge.js"');
    expect(destination).toContain('from "../generated-guidance.js"');
    expect(destination).toContain('const source = "../tools.ts";');
    expect(destination).toContain('const bridge = "../host-bridge.ts";');
  });

  test("rejects a drifted text transform instead of silently validating a no-op", async () => {
    const fixture = createFixture();
    writeFileSync(join(fixture.canonical, "src", "example.test.ts"), "export const noImport = true;\n");
    fixture.writeManifest({
      version: 1,
      canonicalPackage: "omp-context",
      consumerPackage: "magic-acm-context",
      requiredConsumerPaths: ["packages/omp-plugin/src/acm"],
      preserve: ["packages/omp-plugin/src/acm/prompt.ts"],
      mappings: [
        { source: "src/example.test.ts", destination: "packages/omp-plugin/src/acm/example.test.ts", transform: "omp-test-imports" },
      ],
    });

    const result = await runSync(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("expected at least one declared source fragment");
    expect(Bun.file(join(fixture.consumer, "packages/omp-plugin/src/acm/example.test.ts")).size).toBe(0);
  });

  test("rolls back every committed destination when publication fails midway", async () => {
    const fixture = createFixture();
    const before = snapshotConsumer(fixture.consumer);
    writeFileSync(join(fixture.canonical, "src", "second.ts"), "export const second = true;\n");
    writeFileSync(join(fixture.consumer, "blocked"), "not a directory\n");
    fixture.writeManifest({
      version: 1,
      canonicalPackage: "omp-context",
      consumerPackage: "magic-acm-context",
      requiredConsumerPaths: ["packages/omp-plugin/src/acm"],
      preserve: ["packages/omp-plugin/src/acm/prompt.ts"],
      mappings: [
        { source: "src/index.ts", destination: "packages/omp-plugin/src/acm/tools.ts", transform: "copy" },
        { source: "src/second.ts", destination: "blocked/second.ts", transform: "copy" },
      ],
    });

    const result = await runSync(fixture);
    expect(result.exitCode).not.toBe(0);
    expect(snapshotConsumer(fixture.consumer)).toEqual(before);
    expect(readFileSync(join(fixture.consumer, "blocked"), "utf8")).toBe("not a directory\n");
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
    provenanceDestination: z.string(),
    preserve: z.array(z.string()),
    mappings: z.array(z.object({ source: z.string(), destination: z.string(), transform: z.string() })),
  }).parse(parsed);

  expect(manifest.preserve.sort()).toEqual([
    "packages/omp-plugin/src/acm/prompt.test.ts",
    "packages/omp-plugin/src/acm/prompt.ts",
    "packages/omp-plugin/src/index.ts",
  ]);
  expect(manifest.provenanceDestination).toBe("packages/omp-plugin/src/acm/acm-provenance.json");
  expect(manifest.mappings.map((mapping) => `${mapping.source}=>${mapping.destination}:${mapping.transform}`).sort()).toEqual([
    "package.json=>package.json:omp-package-metadata",
    "package.json=>packages/omp-plugin/package.json:omp-plugin-package-metadata",
    "scripts/generate-guidance.mjs=>packages/omp-plugin/scripts/generate-guidance.mjs:omp-guidance-generator",
    "scripts/generate-guidance.test.mjs=>packages/omp-plugin/scripts/generate-guidance.test.mjs:omp-guidance-generator-test",
    "scripts/verify-acm.mjs=>packages/omp-plugin/scripts/verify-acm.mjs:copy",
    "skills/context-management/CORE.md=>packages/omp-plugin/skills/context-management/CORE.md:copy",
    "skills/context-management/SKILL.md=>packages/omp-plugin/skills/context-management/SKILL.md:copy",
    "skills/context-management/references/archive-recovery.md=>packages/omp-plugin/skills/context-management/references/archive-recovery.md:copy",
    "skills/context-management/references/exceptional-recovery.md=>packages/omp-plugin/skills/context-management/references/exceptional-recovery.md:copy",
    "skills/context-management/references/target-selection.md=>packages/omp-plugin/skills/context-management/references/target-selection.md:copy",
    "src/checkpoint-tool.ts=>packages/omp-plugin/src/acm/checkpoint-tool.ts:copy",
    "src/checkpoint.test.ts=>packages/omp-plugin/src/acm/checkpoint.test.ts:omp-test-imports",
    "src/context-restore.test.ts=>packages/omp-plugin/src/acm/context-restore.test.ts:omp-test-imports",
    "src/entry-resolution.ts=>packages/omp-plugin/src/acm/entry-resolution.ts:copy",
    "src/generated-guidance.ts=>packages/omp-plugin/src/acm/generated-guidance.ts:copy",
    "src/guidance.test.ts=>packages/omp-plugin/src/acm/guidance.test.ts:omp-test-imports",
    "src/host-bridge.test.ts=>packages/omp-plugin/src/acm/host-bridge.test.ts:copy",
    "src/host-bridge.ts=>packages/omp-plugin/src/acm/host-bridge.ts:copy",
    "src/index.ts=>packages/omp-plugin/src/acm/tools.ts:copy",
    "src/label-journal.ts=>packages/omp-plugin/src/acm/label-journal.ts:copy",
    "src/lib.test.ts=>packages/omp-plugin/src/acm/lib.test.ts:omp-test-imports",
    "src/lib.ts=>packages/omp-plugin/src/acm/lib.ts:copy",
    "src/message-sanitizer.ts=>packages/omp-plugin/src/acm/message-sanitizer.ts:copy",
    "src/prompt-registration.ts=>packages/omp-plugin/src/acm/prompt-registration.ts:copy",
    "src/runtime-lifecycle.ts=>packages/omp-plugin/src/acm/runtime-lifecycle.ts:copy",
    "src/runtime.ts=>packages/omp-plugin/src/acm/runtime.ts:copy",
    "src/timeline-tool.ts=>packages/omp-plugin/src/acm/timeline-tool.ts:copy",
    "src/timeline.test.ts=>packages/omp-plugin/src/acm/timeline.test.ts:omp-test-imports",
    "src/tool-descriptions.test.ts=>packages/omp-plugin/src/acm/tool-descriptions.test.ts:omp-test-imports",
    "src/travel-coordinator.ts=>packages/omp-plugin/src/acm/travel-coordinator.ts:copy",
    "src/travel-tool.ts=>packages/omp-plugin/src/acm/travel-tool.ts:copy",
    "test/host-fixture/.gitignore=>packages/omp-plugin/src/acm/host-fixture/.gitignore:copy",
    "test/host-fixture/build-source.mjs=>packages/omp-plugin/src/acm/host-fixture/build-source.mjs:omp-host-test-imports",
    "test/host-fixture/bun.lock=>packages/omp-plugin/src/acm/host-fixture/bun.lock:copy",
    "test/host-fixture/compaction-lifecycle.test.ts=>packages/omp-plugin/src/acm/host-fixture/compaction-lifecycle.test.ts:omp-host-test-imports",
    "test/host-fixture/context-rebuild.test.ts=>packages/omp-plugin/src/acm/host-fixture/context-rebuild.test.ts:omp-host-test-imports",
    "test/host-fixture/harness.ts=>packages/omp-plugin/src/acm/host-fixture/harness.ts:omp-host-test-imports",
    "test/host-fixture/host-bridge.test.ts=>packages/omp-plugin/src/acm/host-fixture/host-bridge.test.ts:copy",
    "test/host-fixture/session-manager.test.ts=>packages/omp-plugin/src/acm/host-fixture/session-manager.test.ts:copy",
    "test/host-fixture/package.json=>packages/omp-plugin/src/acm/host-fixture/package.json:copy",
    "test/host-fixture/travel.test.ts=>packages/omp-plugin/src/acm/host-fixture/travel.test.ts:omp-host-test-imports",
    "test/host-fixture/version.test.ts=>packages/omp-plugin/src/acm/host-fixture/version.test.ts:copy",
  ].sort());
  expect(new Set(manifest.mappings.map((mapping) => mapping.destination)).size).toBe(
    manifest.mappings.length,
  );
});
