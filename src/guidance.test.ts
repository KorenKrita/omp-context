import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { z } from "zod";
import registerACMExtension from "./index.js";
import {
  ACM_CORE,
  ACM_CORE_MARKER,
  GUIDANCE_CUES,
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

const skillFile = (path: string) => Bun.file(new URL(`../skills/context-management/${path}`, import.meta.url)).text();

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

describe("ACM guidance quality", () => {
  test("grounds the doctrine in compression-as-intelligence and agent autonomy", () => {
    expect(ACM_CORE).toContain("Compression is intelligence");
    expect(ACM_CORE).toContain("**working set**, not a transcript");
    expect(ACM_CORE).toContain("as ordinary as reading a file");
    expect(ACM_CORE).toContain("only an explicit user request to hold travel");
    expect(ACM_CORE).toContain("**hot set**");
    expect(ACM_CORE).toContain("Honest uncertainty");
    expect(ACM_CORE).toContain("Removing it deletes nothing");
  });

  test("offers the full move set including forward travel", () => {
    for (const move of ["**Save**", "**Orient**", "**Fold**", "**Rebase**", "**Rehydrate**", "**Fork**"]) {
      expect(ACM_CORE).toContain(move);
    }
    expect(ACM_CORE).toContain("cold start");
    expect(ACM_CORE).toContain("anchor gravity");
    expect(ACM_CORE).toContain("Folding mid-investigation is fine");
    expect(ACM_CORE).toContain("Root is a candidate, never a default");
    expect(ACM_CORE).toContain("travel back carrying the extract");
  });

  test("frames cadence as a band between sediment and thrash with a cruise preference", () => {
    expect(ACM_CORE).toContain("Compress continuously");
    expect(ACM_CORE).toContain("Fold in batches");
    expect(ACM_CORE).toContain("**Sediment**");
    expect(ACM_CORE).toContain("**Thrash**");
    expect(ACM_CORE).toContain("around a third of the working budget");
    expect(ACM_CORE).toContain("That is a preference, never an override");
    expect(ACM_CORE).toContain("the weighing, not the fold");
    expect(ACM_CORE).toContain("different models legitimately choose different batch sizes");
  });

  test("keeps one cold-start handoff example carrying live cognition", () => {
    for (const slot of ["Goal:", "State:", "Evidence:", "External:", "Exclusions:", "Recover:", "NEXT:"]) {
      expect(ACM_CORE).toContain(slot);
    }
    expect(ACM_CORE).toContain("each starting its own line");
    expect(ACM_CORE).toContain("one concrete action a fresh agent could execute immediately");
    expect(ACM_CORE).toContain("Two hypotheses");
    expect(ACM_CORE).toContain("Hot:");
    expect(ACM_CORE.split("```text").length - 1).toBe(1);
  });

  test("each result cue points at the concrete next move", () => {
    expect(GUIDANCE_CUES.checkpoint).toContain("acm_travel");
    expect(GUIDANCE_CUES.travel).toContain("execute NEXT");
    expect(GUIDANCE_CUES.rebaseCheck).toContain("the next fold would stack another");
  });

  test("never reintroduces mandatory workflow machinery", () => {
    expect(ACM_CORE).not.toContain("preflight");
    expect(ACM_CORE).not.toContain("Normal state transitions");
    expect(ACM_CORE).not.toContain("Required transition");
    expect(ACM_CORE).not.toContain("Fold gate");
    expect(ACM_CORE).not.toContain("-paused");
    expect(ACM_CORE).not.toContain("`<chain>-start`");
    expect(ACM_CORE).not.toContain("first action");
    expect(ACM_CORE.length).toBeLessThan(6000);
  });

  test("keeps receipt discipline and external-state honesty", () => {
    expect(ACM_CORE).toContain("only its matching result is fact");
    expect(ACM_CORE).toContain("applied, not applied, or indeterminate");
    expect(ACM_CORE).toContain("Travel rewrites conversation context only");
    expect(TOOL_DESCRIPTIONS.travel).toContain("alone in its assistant tool batch");
    expect(TOOL_DESCRIPTIONS.travel).toContain("The result is the only fact");
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
  test("matches every canonical TOOL-CONTRACTS recovery marker", async () => {
    const contracts = await skillFile("TOOL-CONTRACTS.md");
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
      expect(contracts.split(start)).toHaveLength(2);
      expect(contracts.split(end)).toHaveLength(2);
      const canonical = contracts.slice(contracts.indexOf(start) + start.length, contracts.indexOf(end)).trim();
      expect(String(RECOVERY_GUIDANCE[key as keyof typeof RECOVERY_GUIDANCE])).toBe(canonical);
    }
  });
});

describe("advanced context-management routing", () => {
  test("routes one advanced condition at a time and reroutes on state change", async () => {
    const skill = await skillFile("SKILL.md");
    expect(skill).toContain("CORE owns the normal path");
    expect(skill).toContain("Advanced Target Selection");
    expect(skill).toContain("Archive Recovery");
    expect(skill).toContain("Exceptional Recovery");
    expect(skill).toContain("Load one reference at a time");
    expect(skill).toContain("observable condition changes");
    expect(skill).toContain("replace the active reference");
  });

  test("keeps target and recovery criteria factual and checkable", async () => {
    const target = await skillFile("references/target-selection.md");
    const archive = await skillFile("references/archive-recovery.md");
    const exceptional = await skillFile("references/exceptional-recovery.md");

    expect(target).toContain("tree topology orders them");
    expect(target).toContain("must precede at least one active `branch_summary`");
    expect(target).toContain("projected summary depth must not grow");
    expect(target).toContain("every surviving item has one authoritative home");
    expect(archive).toContain("Rehydration round trip");
    expect(archive).toContain("Pending is scheduled work, not success");
    expect(archive).toContain("return to the Skill router and replace this reference");
    expect(exceptional).toContain("Backup rollback failure");
    expect(exceptional).toContain("branch creation was not applied");
    expect(exceptional).toContain("Indeterminate branch mutation");
    expect(exceptional).toContain("mutation may have landed");
    expect(exceptional).toContain("Low-yield fold");
    expect(exceptional).toContain("travel is never required merely to record completion");
  });

  test("routes each advanced branch through an independently loadable reference", async () => {
    const skill = await skillFile("SKILL.md");
    const references = {
      "target-selection.md": [
        "Interleaved fronts",
        "Older or missing anchors",
        "Rebase base selection",
        "Raw node fallback",
        "Checkpoint-name collisions",
      ],
      "archive-recovery.md": ["Rehydration round trip", "Archive drift"],
      "exceptional-recovery.md": [
        "Travel failure",
        "Backup rollback failure",
        "Indeterminate branch mutation",
        "Context-refresh exhaustion",
        "Restored history",
        "Low-yield fold",
      ],
    } as const;

    expect(skill).toContain("Load one reference at a time");
    expect(skill).toContain("observable condition changes");
    expect(skill).toContain("replace the active reference");

    for (const [file, branchHeadings] of Object.entries(references)) {
      expect(skill).toContain(`references/${file}`);
      expect(skill).toMatch(new RegExp(`Load \\[[^\\]]+\\]\\(references/${file.replace(".", "\\.")}\\) when `));

      const content = await skillFile(`references/${file}`);
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
