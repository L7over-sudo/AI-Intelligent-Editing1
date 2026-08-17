import { z } from "zod";

export const dialogueRoleSchema = z.enum(["system", "user", "assistant"]);

export const dialogueMessageSchema = z
  .object({
    role: dialogueRoleSchema,
    content: z.string().trim().min(1).max(32_000),
  })
  .strict();

export const dialogueCompletionInputSchema = z
  .object({
    messages: z.array(dialogueMessageSchema).min(1).max(100),
    temperature: z.number().min(0).max(2).default(0.7),
  })
  .strict()
  .superRefine((input, context) => {
    const characterCount = input.messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    if (characterCount > 400_000) {
      context.addIssue({
        code: "custom",
        path: ["messages"],
        message: "对话上下文过长，请新建对话或删减较早的消息",
      });
    }
  });

export const dialogueCompletionResponseSchema = z
  .object({
    message: dialogueMessageSchema.extend({ role: z.literal("assistant") }),
    model: z.string().trim().min(1).max(120),
  })
  .strict();

export const storedDialogueMessageSchema = dialogueMessageSchema.extend({
  id: z.string().trim().min(1).max(100),
});

export const storedDialogueConversationSchema = z
  .object({
    id: z.string().trim().min(1).max(100),
    title: z.string().trim().min(1).max(40),
    titleCustomized: z.boolean(),
    draft: z.string().max(32_000),
    messages: z.array(storedDialogueMessageSchema).min(1),
  })
  .strict();

export const storedDialogueStateSchema = z
  .object({
    version: z.literal(1),
    activeConversationId: z.string().trim().max(100),
    conversations: z
      .array(storedDialogueConversationSchema)
      .max(50),
  })
  .strict()
  .superRefine((state, context) => {
    if (state.conversations.length === 0) {
      if (state.activeConversationId !== "") {
        context.addIssue({
          code: "custom",
          path: ["activeConversationId"],
          message: "没有对话时当前对话必须为空",
        });
      }
      return;
    }
    if (
      !state.conversations.some(
        (conversation) => conversation.id === state.activeConversationId,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["activeConversationId"],
        message: "当前对话不存在",
      });
    }
  });

export const dialogueConversationStorageKey =
  "stickmotion.dialogue-conversations.v1";

export function parseStoredDialogueState(source: string | null) {
  if (!source) return undefined;
  try {
    const parsed: unknown = JSON.parse(source);
    const result = storedDialogueStateSchema.safeParse(parsed);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export type DialogueMessage = z.infer<typeof dialogueMessageSchema>;
export type DialogueCompletionInput = z.infer<
  typeof dialogueCompletionInputSchema
>;
export type DialogueCompletionResponse = z.infer<
  typeof dialogueCompletionResponseSchema
>;
export type StoredDialogueConversation = z.infer<
  typeof storedDialogueConversationSchema
>;
export type StoredDialogueState = z.infer<typeof storedDialogueStateSchema>;
