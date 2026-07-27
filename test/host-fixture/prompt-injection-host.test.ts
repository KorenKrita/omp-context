import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadExtensions,
  ExtensionRunner,
  SessionManager,
} from "@oh-my-pi/pi-coding-agent";
import { createModelRegistry } from "./model-registry.ts";
import * as generated from "../../src/generated-guidance.ts";
import { z } from "zod/v4";

test("ACM CORE injects once through the exact Pi before_agent_start hook", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-context-prompt-host-"));
  try {
    const loaded = await loadExtensions(
      [join(import.meta.dir, ".acm-build/index.js")],
      import.meta.dir,
    );
    expect(loaded.errors).toEqual([]);

    const sessionManager = SessionManager.inMemory(join(tempDir, "session.jsonl"));
    const modelRegistry = await createModelRegistry(tempDir);
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, tempDir, sessionManager, modelRegistry);
    runner.initialize({
      sendMessage: async () => {},
      sendUserMessage: async () => {},
      appendEntry: () => {},
      setSessionName: () => {},
      getSessionName: () => undefined,
      setLabel: () => {},
      getActiveTools: () => [],
      getAllTools: () => [],
      setActiveTools: () => {},
      getCommands: () => [],
      setModel: async () => {},
      getThinkingLevel: () => "off",
      setThinkingLevel: () => {},
    }, {
      getModel: () => undefined,
      isIdle: () => true,
      abort: () => {},
      hasPendingMessages: () => false,
      shutdown: () => {},
      getSystemPrompt: () => ["base prompt"],
    });

    const first = await runner.emitBeforeAgentStart("hello", undefined, ["base prompt"]);
    const injected = first?.systemPrompt;
    expect(injected).toBeDefined();
    expect(injected?.[0]).toBe("base prompt");
    expect(injected?.join("\n")).toContain(generated.ACM_CORE_MARKER);
    expect(injected?.join("\n")).toContain("Compression is intelligence");
    expect(injected?.join("\n").split(generated.ACM_CORE_MARKER)).toHaveLength(2);

    const second = await runner.emitBeforeAgentStart("again", undefined, injected!);
    expect(second?.systemPrompt ?? injected).toBe(injected!);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("ACM tools register generated prompt metadata on the exact Pi host", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "pi-context-tool-host-"));
  try {
    const loaded = await loadExtensions(
      [join(import.meta.dir, ".acm-build/index.js")],
      import.meta.dir,
    );
    expect(loaded.errors).toEqual([]);

    const sessionManager = SessionManager.inMemory(join(tempDir, "session.jsonl"));
    const modelRegistry = await createModelRegistry(tempDir);
    const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, tempDir, sessionManager, modelRegistry);

    const tools = new Map(runner.getAllRegisteredTools().map((tool) => [tool.definition.name, tool.definition]));
    expect([...tools.keys()].sort()).toEqual(["acm_checkpoint", "acm_timeline", "acm_travel"]);
    expect(tools.get("acm_checkpoint")?.promptSnippet).toBeUndefined();
    expect(tools.get("acm_timeline")?.promptSnippet).toBeUndefined();
    expect(tools.get("acm_travel")?.promptSnippet).toBeUndefined();
    expect(tools.get("acm_travel")?.promptGuidelines).toBeUndefined();
    expect(tools.get("acm_travel")?.executionMode).toBe("sequential");
    expect(tools.get("acm_travel")?.description).toContain("alone in its assistant tool batch");
    const travelParameters = z.toJSONSchema(tools.get("acm_travel")?.parameters as z.ZodType) as {
      required?: string[];
      properties?: Record<string, { anyOf?: Array<{ type?: string; required?: string[] }> }>;
    };
    expect(travelParameters.required).toContain("handoff");
    expect(travelParameters.properties?.summary).toBeUndefined();
    const handoffVariants = travelParameters.properties?.handoff?.anyOf ?? [];
    const structuredHandoff = handoffVariants.find((variant) => variant.type === "object");
    const serializedHandoff = handoffVariants.find((variant) => variant.type === "string");
    expect(structuredHandoff?.required?.sort()).toEqual([
      "evidence",
      "exclusions",
      "external",
      "goal",
      "next",
      "recover",
      "state",
    ]);
    expect(serializedHandoff).toBeDefined();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

