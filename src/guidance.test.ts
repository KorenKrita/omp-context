import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { z } from "zod";
import registerACMExtension from "./index.js";
import {
  ACM_CORE,
  ACM_CORE_MARKER,
  TOOL_DESCRIPTIONS,
} from "./generated-guidance.js";

interface CapturedHandler {
  name: string;
  handler: (event: any, ctx: any) => any;
}

function captureBeforeAgentStart() {
  const handlers: CapturedHandler[] = [];
  const pi = {
    zod: z,
    on(name: string, handler: CapturedHandler["handler"]) {
      handlers.push({ name, handler });
    },
    registerTool() {},
  };
  registerACMExtension(pi as unknown as ExtensionAPI);
  const handler = handlers.find((candidate) => candidate.name === "before_agent_start")?.handler;
  expect(handler).toBeDefined();
  return handler!;
}

describe("canonical ACM CORE", () => {
  test("contains the fixed vocabulary, fold gate, handoff order, and representative examples", () => {
    for (const word of ["working set", "boundary", "handoff", "archive", "chain", "burst", "anchor gravity"]) {
      expect(ACM_CORE.toLowerCase()).toContain(word);
    }
    const slotPositions = ["Goal:", "State:", "Evidence:", "External:", "Exclusions:", "Recover:", "NEXT:"]
      .map((slot) => ACM_CORE.indexOf(slot));
    expect(slotPositions.every((position) => position >= 0)).toBe(true);
    expect([...slotPositions].sort((a, b) => a - b)).toEqual(slotPositions);
    expect(ACM_CORE).toContain("Burst example");
    expect(ACM_CORE).toContain("Failed-direction example");
    expect(ACM_CORE).toContain("Finished-chain example");
    expect(ACM_CORE).toContain("High context pressure triggers a boundary check");
    expect(ACM_CORE).toContain("does not authorize travel");
  });

  test("appends CORE once while preserving existing system segments in order", async () => {
    const handler = captureBeforeAgentStart();
    const existing = ["first extension", "second extension"];
    const first = await handler({ type: "before_agent_start", prompt: "go", systemPrompt: existing }, {});
    expect(first.systemPrompt.slice(0, 2)).toEqual(existing);
    expect(first.systemPrompt.at(-1)).toContain(ACM_CORE_MARKER);
    expect(first.systemPrompt.at(-1)).toContain(ACM_CORE);

    const second = await handler({ type: "before_agent_start", prompt: "go", systemPrompt: first.systemPrompt }, {});
    expect(second).toBeUndefined();
    expect(first.systemPrompt.join("\n").split(ACM_CORE_MARKER)).toHaveLength(2);
  });

  test("derives concise descriptions for all three tools", () => {
    expect(Object.keys(TOOL_DESCRIPTIONS).sort()).toEqual(["checkpoint", "timeline", "travel"]);
    for (const description of Object.values(TOOL_DESCRIPTIONS)) {
      expect(description.length).toBeLessThan(900);
      expect(description).not.toContain("Goal:");
    }
    expect(TOOL_DESCRIPTIONS.timeline).toContain("view");
  });
});
