import path from "node:path";

import { z } from "zod";

const retainedProfileAssetSchema = z
  .object({
    ownerId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    assetId: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    kind: z.enum(["VOICE", "CHARACTER_REFERENCE"]),
    objectKey: z.string().min(1).max(500),
  })
  .strict();

export function retainedProfileAssetObjectKey(rawInput: {
  ownerId: string;
  assetId: string;
  kind: "VOICE" | "CHARACTER_REFERENCE";
  objectKey: string;
}): string {
  const input = retainedProfileAssetSchema.parse(rawInput);
  const sourceExtension = path.posix
    .extname(input.objectKey.replaceAll("\\", "/"))
    .slice(1)
    .toLowerCase();
  const extension = /^[a-z0-9]{2,5}$/u.test(sourceExtension)
    ? sourceExtension
    : input.kind === "VOICE"
      ? "wav"
      : "png";
  const folder =
    input.kind === "VOICE" ? "voice-profiles" : "character-profiles";
  return `users/${input.ownerId}/${folder}/${input.assetId}.${extension}`;
}
