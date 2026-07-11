import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { z } from "zod";
import registerACMExtension from "./index.js";
import {
  ACM_CORE,
  ACM_CORE_MARKER,
  TOOL_DESCRIPTIONS,
} from "./generated-guidance.js";

interface BeforeAgentStartEvent {
  type: "before_agent_start";
  prompt: string;
  systemPrompt: string[];
}

type BeforeAgentStartHandler = (
  event: BeforeAgentStartEvent,
  ctx: unknown,
) => Promise<{ systemPrompt: string[] } | undefined> | { systemPrompt: string[] } | undefined;

interface RegisteredTool {
  name: string;
  description: string;
}

function captureBeforeAgentStart(): BeforeAgentStartHandler {
  const handlers: Array<{ name: string; handler: BeforeAgentStartHandler }> = [];
  const pi = {
    zod: z,
    on(name: string, handler: BeforeAgentStartHandler) {
      handlers.push({ name, handler });
    },
    registerTool() {},
  };
  registerACMExtension(pi as unknown as ExtensionAPI);
  const handler = handlers.find((candidate) => candidate.name === "before_agent_start")?.handler;
  expect(handler).toBeDefined();
  return handler!;
}

function captureRegisteredTools(): RegisteredTool[] {
  const tools: RegisteredTool[] = [];
  const pi = {
    zod: z,
    on() {},
    registerTool(tool: unknown) {
      if (
        typeof tool === "object" &&
        tool !== null &&
        "name" in tool &&
        typeof tool.name === "string" &&
        "description" in tool &&
        typeof tool.description === "string"
      ) {
        tools.push({ name: tool.name, description: tool.description });
      }
    },
  };
  registerACMExtension(pi as unknown as ExtensionAPI);
  return tools;
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
    if (!first) throw new Error("ACM handler did not append CORE");
    expect(first.systemPrompt.slice(0, 2)).toEqual(existing);
    expect(first.systemPrompt.at(-1)).toContain(ACM_CORE_MARKER);
    expect(first.systemPrompt.at(-1)).toContain(ACM_CORE);

    const second = await handler({ type: "before_agent_start", prompt: "go", systemPrompt: first.systemPrompt }, {});
    expect(second).toBeUndefined();
    expect(first.systemPrompt.join("\n").split(ACM_CORE_MARKER)).toHaveLength(2);
  });

  test("registers concise generated descriptions for all three tools", () => {
    const registered = Object.fromEntries(
      captureRegisteredTools().map((tool) => [tool.name, tool.description]),
    );
    expect(registered).toEqual({
      acm_checkpoint: TOOL_DESCRIPTIONS.checkpoint,
      acm_timeline: TOOL_DESCRIPTIONS.timeline,
      acm_travel: TOOL_DESCRIPTIONS.travel,
    });
    for (const description of Object.values(TOOL_DESCRIPTIONS)) {
      expect(description.length).toBeLessThan(900);
      expect(description).not.toContain("Goal:");
    }
  });
});

describe("advanced context-management routing", () => {
  test("keeps the model-invoked Skill compact and outside the CORE normal path", async () => {
    const skill = await Bun.file(new URL("../skills/context-management/SKILL.md", import.meta.url)).text();

    expect(skill).toContain("CORE owns the normal path");
    expect(skill).not.toContain("## Fold gate");
    expect(skill).not.toContain("Goal: <");
    expect(skill).not.toContain("Burst example");
    expect(skill).not.toContain("Use continuously");
    for (const ordinaryCase of [
      "ordinary checkpointing",
      "clear phase folds",
      "clear burst folds",
      "pressure checks",
      "task-end handling",
    ]) {
      expect(skill.toLowerCase()).toContain(ordinaryCase);
    }
  });

  test("routes each advanced branch through an independently loadable reference", async () => {
    const skill = await Bun.file(new URL("../skills/context-management/SKILL.md", import.meta.url)).text();
    const references = {
      "target-selection.md": [
        "Interleaved fronts",
        "Older or missing anchors",
        "Raw node fallback",
        "Checkpoint-name collisions",
      ],
      "archive-recovery.md": ["Archive recovery round trip", "<front>-resume", "Archive drift"],
      "exceptional-recovery.md": [
        "Travel failure",
        "Rollback failure",
        "Context-refresh exhaustion",
        "Restored history",
        "No-saving recovery",
      ],
    } as const;

    for (const [file, branchHeadings] of Object.entries(references)) {
      expect(skill).toContain(`references/${file}`);
      expect(skill).toMatch(new RegExp(`Load \\[[^\\]]+\\]\\(references/${file.replace(".", "\\.")}\\) when `));

      const content = await Bun.file(new URL(`../skills/context-management/references/${file}`, import.meta.url)).text();
      for (const heading of branchHeadings) expect(content).toContain(heading);
      for (const otherFile of Object.keys(references)) {
        if (otherFile !== file) expect(content).not.toContain(otherFile);
      }
      expect(content).not.toContain("## Fold gate");
      expect(content).not.toContain("Goal: <");
    }
  });
});
