import { z } from "zod";

const dialogueUiStateSchema = z.object({
  editingConversationId: z.string().nullable(),
  conversationTitleDraft: z.string(),
  conversationListScrollTop: z.number().nonnegative(),
  messageScrollTopByConversation: z.record(
    z.string(),
    z.number().nonnegative(),
  ),
  pendingConversationIds: z.array(z.string()),
});

export type DialogueUiState = z.infer<typeof dialogueUiStateSchema>;

export const dialogueUiStateStorageKey = "stickmotion:dialogue-ui-state:v1";

export const emptyDialogueUiState: DialogueUiState = {
  editingConversationId: null,
  conversationTitleDraft: "",
  conversationListScrollTop: 0,
  messageScrollTopByConversation: {},
  pendingConversationIds: [],
};

export function parseStoredDialogueUiState(value: string | null) {
  if (!value) return undefined;
  try {
    const parsed = dialogueUiStateSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
