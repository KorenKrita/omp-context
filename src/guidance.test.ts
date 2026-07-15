import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { z } from "zod";
import registerACMExtension from "./index.js";
import {
  ACM_CORE,
  ACM_CORE_MARKER,
  RECOVERY_GUIDANCE,
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
  test("preserves the base workflow while adding a bounded rebase gate", () => {
    for (const word of ["working set", "boundary", "handoff", "archive", "chain", "burst", "anchor gravity", "rebase", "cold start"]) {
      expect(ACM_CORE.toLowerCase()).toContain(word);
    }
    const slotPositions = ["Goal:", "State:", "Evidence:", "External:", "Exclusions:", "Recover:", "NEXT:"]
      .map((slot) => ACM_CORE.indexOf(slot));
    expect(slotPositions.every((position) => position >= 0)).toBe(true);
    expect([...slotPositions].sort((a, b) => a - b)).toEqual(slotPositions);
    for (const baseBehavior of [
      "New chain starts",
      "Phase, attempt, or batch item starts",
      "Unbounded burst or risky step is next",
      "Findings are distilled",
      "Direction is rejected or superseded",
      "Final answer is next",
    ]) {
      expect(ACM_CORE).toContain(baseBehavior);
    }
    expect(ACM_CORE).toContain("Local fold example");
    expect(ACM_CORE).not.toContain("Failed-direction example");
    expect(ACM_CORE).toContain("Finished-chain rebase example");
    expect(ACM_CORE).toContain("### Rebase gate");
    expect(ACM_CORE).toContain("Structural reset passes only when");
    expect(ACM_CORE).toContain("projected summary depth does not grow");
    expect(ACM_CORE).toContain("Cold start passes only when");
    expect(ACM_CORE).toContain("evaluate candidate bases from earliest to latest");
    expect(ACM_CORE).toContain("Root is ideal when it passes; it is never presumed safe");
    expect(ACM_CORE).toContain("Context pressure triggers a rebase check");
    expect(ACM_CORE).toContain("does not lower the cold start gate or authorize travel");
    expect(ACM_CORE.length).toBeLessThan(7500);
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

describe("generated travel recovery guidance", () => {
  test("matches every canonical CORE recovery marker", async () => {
    const core = await Bun.file(new URL("../skills/context-management/CORE.md", import.meta.url)).text();
    const markers = {
      nameCollision: "RECOVERY_NAME_COLLISION",
      hostCapability: "RECOVERY_HOST_CAPABILITY",
      rollbackFailed: "RECOVERY_ROLLBACK_FAILED",
      branchRolledBack: "RECOVERY_BRANCH_ROLLED_BACK",
      rollbackSkipped: "RECOVERY_ROLLBACK_SKIPPED",
      refreshPending: "RECOVERY_REFRESH_PENDING",
      restoredHistory: "RECOVERY_RESTORED_HISTORY",
      refreshExhausted: "RECOVERY_REFRESH_EXHAUSTED",
    } as const;

    expect(Object.keys(RECOVERY_GUIDANCE).sort()).toEqual(Object.keys(markers).sort());
    for (const [key, marker] of Object.entries(markers)) {
      const start = `<!-- ACM:${marker}:START -->`;
      const end = `<!-- ACM:${marker}:END -->`;
      expect(core.split(start)).toHaveLength(2);
      expect(core.split(end)).toHaveLength(2);
      const canonical = core.slice(core.indexOf(start) + start.length, core.indexOf(end)).trim();
      expect(String(RECOVERY_GUIDANCE[key as keyof typeof RECOVERY_GUIDANCE])).toBe(canonical);
    }
  });
});

describe("advanced context-management routing", () => {
  test("keeps the model-invoked Skill compact and outside the CORE normal path", async () => {
    const skill = await Bun.file(new URL("../skills/context-management/SKILL.md", import.meta.url)).text();

    expect(skill).toContain("CORE owns the normal path");
    expect(skill).not.toContain("## Fold gate");
    expect(skill).not.toContain("Goal: <");
    expect(skill).not.toContain("Local fold example");
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

  test("keeps advanced completion criteria factual and checkable", async () => {
    const target = await Bun.file(new URL("../skills/context-management/references/target-selection.md", import.meta.url)).text();
    const archive = await Bun.file(new URL("../skills/context-management/references/archive-recovery.md", import.meta.url)).text();
    const exceptional = await Bun.file(new URL("../skills/context-management/references/exceptional-recovery.md", import.meta.url)).text();

    expect(target).toContain("tree topology orders them");
    expect(target).toContain("must precede at least one active `branch_summary`");
    expect(target).toContain("projected summary depth must not grow");
    expect(target).toContain("every surviving item has one authoritative home");
    expect(archive).toContain("Pending is scheduled work, not success");
    expect(archive).toContain("return to the Skill router and replace this reference");
    expect(archive).not.toContain("structural effect");
    expect(exceptional).toContain("branch creation was not applied");
    expect(exceptional).toContain("mutation may have landed");
    expect(exceptional).not.toContain("failed travel rollback means branch mutation may be partial");
  });

  test("routes each advanced branch through an independently loadable reference", async () => {
    const skill = await Bun.file(new URL("../skills/context-management/SKILL.md", import.meta.url)).text();
    const references = {
      "target-selection.md": [
        "Interleaved fronts",
        "Older or missing anchors",
        "Rebase base selection",
        "Raw node fallback",
        "Checkpoint-name collisions",
      ],
      "archive-recovery.md": ["Archive recovery round trip", "<front>-resume", "Archive drift"],
      "exceptional-recovery.md": [
        "Travel failure",
        "Backup rollback failure",
        "Indeterminate branch mutation",
        "Context-refresh exhaustion",
        "Restored history",
        "No-saving recovery",
      ],
    } as const;

    expect(skill).toContain("Load one reference at a time");
    expect(skill).toContain("observable condition changes");
    expect(skill).toContain("replace the active reference");

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
      expect(content).not.toContain("structural effect");
    }
  });
});
