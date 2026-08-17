import {
  animationSchema,
  applyAnimationPreference,
  type SceneAnimation,
} from "@stickmotion/shared";

export const KNOWLEDGE_BOARD_OPENING_ANIMATION = {
  type: "RISE",
  direction: "IN",
  intensity: 0.55,
} as const satisfies SceneAnimation;

/** Resolves the animation that is sent to the render engine from scene data. */
export function resolveRenderAnimation(
  value: unknown,
  sceneIndex: number,
  options: { knowledgeBoard?: boolean } = {},
): SceneAnimation {
  if (options.knowledgeBoard && sceneIndex === 0) {
    return KNOWLEDGE_BOARD_OPENING_ANIMATION;
  }
  return applyAnimationPreference(animationSchema.parse(value), sceneIndex);
}
