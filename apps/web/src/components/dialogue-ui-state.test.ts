import { describe, expect, it } from "vitest";

import { parseStoredDialogueUiState } from "./dialogue-ui-state";

describe("dialogue UI state", () => {
  it("restores scroll, rename and interrupted request state", () => {
    const state = {
      editingConversationId: "conversation-1",
      conversationTitleDraft: "新的标题",
      conversationListScrollTop: 120,
      messageScrollTopByConversation: { "conversation-1": 880 },
      pendingConversationIds: ["conversation-1"],
    };

    expect(parseStoredDialogueUiState(JSON.stringify(state))).toEqual(state);
  });

  it("rejects malformed or negative scroll positions", () => {
    expect(parseStoredDialogueUiState("not-json")).toBeUndefined();
    expect(
      parseStoredDialogueUiState(
        JSON.stringify({
          editingConversationId: null,
          conversationTitleDraft: "",
          conversationListScrollTop: -1,
          messageScrollTopByConversation: {},
          pendingConversationIds: [],
        }),
      ),
    ).toBeUndefined();
  });
});
