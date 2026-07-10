import { describe, expect, it } from "bun:test";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { z } from "zod";
import registerACMExtension from "./index.js";

const text = (value: string) => [{ type: "text", text: value }];

type Handler = (event: unknown, ctx: unknown) => unknown;

function captureHandlers(): Map<string, Handler[]> {
 const handlers = new Map<string, Handler[]>();
 const pi = {
  zod: z,
  on(name: string, handler: Handler) {
   const existing = handlers.get(name) ?? [];
   existing.push(handler);
   handlers.set(name, existing);
  },
  registerTool() {},
 };
 registerACMExtension(pi as unknown as ExtensionAPI);
 return handlers;
}

describe("restored session context sanitation", () => {
 it("removes a persisted travel tool result after session_start cleared pending state", async () => {
  const handlers = captureHandlers();
  const sessionStart = handlers.get("session_start")?.[0];
  const context = handlers.get("context")?.[0];
  expect(sessionStart).toBeDefined();
  expect(context).toBeDefined();

  const sessionManager = {};
  const ctx = { sessionManager };
  await sessionStart?.({ reason: "resume" }, ctx);

  const messages = [
   {
    role: "branchSummary",
    summary: "Continue from the handoff branch",
   },
   {
    role: "toolResult",
    toolCallId: "call_WuALCbwjVXJ6Z4O8toPpen9a",
    toolName: "acm_travel",
    content: text("Travel complete"),
   },
   { role: "user", content: text("new request after restore") },
  ];

  const result = await context?.({ messages }, ctx);

  expect(result).toEqual({
   messages: [
    {
     role: "branchSummary",
     summary: "Continue from the handoff branch",
    },
    { role: "user", content: text("new request after restore") },
   ],
  });
 });

 it("does not override an unchanged outbound request", async () => {
  const context = captureHandlers().get("context")?.[0];
  const messages = [{ role: "user", content: text("continue") }];

  expect(await context?.({ messages }, { sessionManager: {} })).toBeUndefined();
  expect(messages).toEqual([{ role: "user", content: text("continue") }]);
 });
});
