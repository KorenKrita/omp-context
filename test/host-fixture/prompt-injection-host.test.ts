import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import {
  loadExtensions,
  ExtensionRunner,
  SessionManager,
} from "@oh-my-pi/pi-coding-agent";
import { wrapRegisteredTools } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/wrapper";
import { isMountableUnderXdev } from "@oh-my-pi/pi-coding-agent/tools/xdev";
import { cleanupHostTempDirs, createHostTempDir, createModelRegistry } from "./host-temp.ts";
import * as generated from "../../src/generated-guidance.ts";
import { z } from "zod/v4";

afterEach(cleanupHostTempDirs);

test("ACM CORE injects once through the exact Pi before_agent_start hook", async () => {
  const tempDir = createHostTempDir("pi-context-prompt-host-");
  const loaded = await loadExtensions(
    [join(import.meta.dir, ".acm-build/index.js")],
    import.meta.dir,
  );
  expect(loaded.errors).toEqual([]);

  const sessionManager = SessionManager.inMemory(join(tempDir, "session.jsonl"));
  const runner = new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    tempDir,
    sessionManager,
    createModelRegistry(tempDir),
  );
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
  expect(injected?.join("\n")).toContain("The fold test");
  expect(injected?.join("\n").split(generated.ACM_CORE_MARKER)).toHaveLength(2);

  const second = await runner.emitBeforeAgentStart("again", undefined, injected!);
  expect(second?.systemPrompt ?? injected).toBe(injected!);
});

test("ACM tools register generated prompt metadata on the exact Pi host", async () => {
  const tempDir = createHostTempDir("pi-context-tool-host-");
  const loaded = await loadExtensions(
    [join(import.meta.dir, ".acm-build/index.js")],
    import.meta.dir,
  );
  expect(loaded.errors).toEqual([]);

  const sessionManager = SessionManager.inMemory(join(tempDir, "session.jsonl"));
  const runner = new ExtensionRunner(
    loaded.extensions,
    loaded.runtime,
    tempDir,
    sessionManager,
    createModelRegistry(tempDir),
  );

  const registered = runner.getAllRegisteredTools();
  const tools = new Map(registered.map((tool) => [tool.definition.name, tool.definition]));
  const wrapped = new Map(wrapRegisteredTools(registered, runner).map((tool) => [tool.name, tool]));
  expect([...tools.keys()].sort()).toEqual(["acm_checkpoint", "acm_timeline", "acm_travel"]);
  for (const tool of wrapped.values()) {
    expect(tool.strict).not.toBe(true);
    expect(tool.loadMode).toBe("essential");
    expect(isMountableUnderXdev(tool)).toBe(false);
  }
  expect(wrapped.get("acm_checkpoint")?.approval).toBe("write");
  expect(wrapped.get("acm_timeline")?.approval).toBe("read");
  expect(wrapped.get("acm_travel")?.approval).toBe("write");
  expect(wrapped.get("acm_travel")?.concurrency).toBe("exclusive");
  expect(tools.get("acm_checkpoint")?.promptSnippet).toBeUndefined();
  expect(tools.get("acm_timeline")?.promptSnippet).toBeUndefined();
  expect(tools.get("acm_travel")?.promptSnippet).toBeUndefined();
  expect(tools.get("acm_travel")?.promptGuidelines).toBeUndefined();
  expect(tools.get("acm_travel")?.description).toContain("alone in its tool batch");
  const travelParameters = z.toJSONSchema(tools.get("acm_travel")?.parameters as z.ZodType) as {
    required?: string[];
    properties?: Record<string, { anyOf?: Array<{ type?: string; required?: string[] }> }>;
  };
  expect(travelParameters.required).toContain("handoff");
  expect(travelParameters.properties?.summary).toBeUndefined();
  const handoffVariants = travelParameters.properties?.handoff?.anyOf ?? [];
  const structuredHandoff = handoffVariants.find((variant) => variant.type === "object");
  const serializedHandoff = handoffVariants.find((variant) => variant.type === "string");
  // Three-required/four-optional wire shape: the schema the host actually
  // serves must not regress to seven-required.
  expect(structuredHandoff?.required?.sort()).toEqual(["goal", "next", "state"]);
  expect(serializedHandoff).toBeDefined();
});
