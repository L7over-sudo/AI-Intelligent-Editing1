import { z } from "zod";

export const videoTemplateSchema = z.enum(["FULL_BLEED", "KNOWLEDGE_BOARD"]);

export type VideoTemplate = z.infer<typeof videoTemplateSchema>;

/**
 * Canonical source canvas for every KNOWLEDGE_BOARD image. Keeping this fixed
 * prevents source-specific white-margin trimming from changing the composition.
 */
export const KNOWLEDGE_BOARD_IMAGE_SIZE = {
  width: 1344,
  height: 576,
} as const;

/** Header tracking shared by the Remotion and FFmpeg knowledge-board renderers. */
export const KNOWLEDGE_BOARD_HEADER_LETTER_SPACING_EM = 0.35;

export interface KnowledgeBoardLayout {
  title: { top: number; height: number; fontSize: number };
  header: { top: number; height: number; fontSize: number };
  image: { left: number; top: number; width: number; height: number };
  dividerY: number;
  subtitle: { top: number; height: number; maxWidth: number };
}

export interface KnowledgeBoardHeaderDecorationLayout {
  dashWidth: number;
  gap: number;
  estimatedTextWidth: number;
  leftDashX: number;
  rightDashX: number;
}

export function getKnowledgeBoardHeaderDecorationLayout(
  width: number,
  headerText: string,
  fontSize: number,
): KnowledgeBoardHeaderDecorationLayout {
  const characters = Math.max(1, Array.from(headerText).length);
  const letterSpacing = fontSize * KNOWLEDGE_BOARD_HEADER_LETTER_SPACING_EM;
  const estimatedTextWidth = Math.min(
    width * 0.68,
    characters * fontSize * 0.92 +
      Math.max(0, characters - 1) * letterSpacing,
  );
  const dashWidth = Math.max(4, Math.round(width * 0.017));
  const gap = Math.max(8, Math.round(width * 0.012));
  const minimumX = Math.round(width * 0.06);
  const maximumX = Math.round(width * 0.94) - dashWidth;
  const leftDashX = Math.max(
    minimumX,
    Math.round(width / 2 - estimatedTextWidth / 2 - gap - dashWidth),
  );
  const rightDashX = Math.min(
    maximumX,
    Math.round(width / 2 + estimatedTextWidth / 2 + gap),
  );

  return {
    dashWidth,
    gap,
    estimatedTextWidth,
    leftDashX,
    rightDashX,
  };
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
  const dividerY = Math.round(height * 0.815);
  const image = {
    left: Math.round(width * 0.07),
    top: Math.round(height * 0.213),
    width: Math.round(width * 0.86),
    height: Math.round(height * 0.6),
  };

  return {
    title: {
      top: Math.round(height * 0.025),
      height: Math.round(height * 0.115),
      fontSize: Math.round(
        portrait
          ? Math.min(width * 0.078, height * 0.045)
          : Math.min(width * 0.048, height * 0.082),
      ),
    },
    header: {
      top: Math.round(height * 0.145),
      height: Math.round(height * 0.065),
      fontSize: Math.round(
        portrait
          ? Math.min(width * 0.026, height * 0.035)
          : Math.min(width * 0.022, height * 0.035),
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
