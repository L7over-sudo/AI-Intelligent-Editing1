import { z } from "zod";

export const videoTemplateSchema = z.enum(["FULL_BLEED", "KNOWLEDGE_BOARD"]);

export type VideoTemplate = z.infer<typeof videoTemplateSchema>;

export interface KnowledgeBoardLayout {
  header: { top: number; height: number; fontSize: number };
  image: { left: number; top: number; width: number; height: number };
  dividerY: number;
  subtitle: { top: number; height: number; maxWidth: number };
}

export function getKnowledgeBoardLayout(
  width: number,
  height: number,
): KnowledgeBoardLayout {
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    throw new Error("VIDEO_TEMPLATE_DIMENSIONS_MUST_BE_INTEGERS");
  }
  if (width < 320 || height < 320) {
    throw new Error("VIDEO_TEMPLATE_DIMENSIONS_TOO_SMALL");
  }

  const portrait = height > width;
  const dividerY = Math.round(height * (portrait ? 0.82 : 0.81));
  const image = portrait
    ? {
        left: Math.round(width * 0.07),
        top: Math.round(height * 0.12),
        width: Math.round(width * 0.86),
        height: Math.round(height * 0.66),
      }
    : {
        left: Math.round(width * 0.07),
        top: Math.round(height * 0.15),
        width: Math.round(width * 0.86),
        height: Math.round(height * 0.61),
      };

  return {
    header: {
      top: Math.round(height * (portrait ? 0.035 : 0.035)),
      height: Math.round(height * (portrait ? 0.065 : 0.075)),
      fontSize: Math.round(
        portrait ? Math.min(width * 0.035, 44) : Math.min(height * 0.038, 46),
      ),
    },
    image,
    dividerY,
    subtitle: {
      top: dividerY,
      height: height - dividerY,
      maxWidth: Math.round(width * (portrait ? 0.86 : 0.82)),
    },
  };
}
