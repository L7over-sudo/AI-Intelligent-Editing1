import { describe, expect, it } from "vitest";

import {
  dialogueCompletionInputSchema,
  parseStoredDialogueState,
  storedDialogueStateSchema,
} from "./dialogue";

describe("dialogue completion input", () => {
  it("accepts a validated multi-turn conversation", () => {
    const parsed = dialogueCompletionInputSchema.parse({
      messages: [
        { role: "system", content: "你是短视频创作助手" },
        { role: "user", content: "帮我修改开头" },
        { role: "assistant", content: "可以，请发来原文" },
      ],
      temperature: 0.7,
    });

    expect(parsed.messages).toHaveLength(3);
  });

  it("rejects client attempts to override stream or model", () => {
    expect(() =>
      dialogueCompletionInputSchema.parse({
        model: "untrusted-model",
        messages: [{ role: "user", content: "你好" }],
        stream: "false",
      }),
    ).toThrow();
  });

  it("restores only validated local dialogue records", () => {
    const state = storedDialogueStateSchema.parse({
      version: 1,
      activeConversationId: "conversation-1",
      conversations: [
        {
          id: "conversation-1",
          title: "封面讨论",
          titleCustomized: true,
          draft: "还没发送的草稿",
          messages: [
            { id: "message-1", role: "user", content: "保留这条消息" },
          ],
        },
      ],
    });

    expect(parseStoredDialogueState(JSON.stringify(state))).toEqual(state);
    expect(
      parseStoredDialogueState(
        JSON.stringify({ ...state, activeConversationId: "missing" }),
      ),
    ).toBeUndefined();
  });

  it("allows an empty dialogue list after the last conversation is deleted", () => {
    const state = {
      version: 1 as const,
      activeConversationId: "",
      conversations: [],
    };

    expect(parseStoredDialogueState(JSON.stringify(state))).toEqual(state);
    expect(
      parseStoredDialogueState(
        JSON.stringify({ ...state, activeConversationId: "missing" }),
      ),
    ).toBeUndefined();
  });
});
