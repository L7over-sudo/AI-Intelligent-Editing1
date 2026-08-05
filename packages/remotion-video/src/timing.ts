import type { RemotionRenderInput } from "@stickmotion/shared";

export function calculateSceneDurationInFrames(
  durationMs: number,
  fps: number,
): number {
  return Math.max(1, Math.round((durationMs / 1_000) * fps));
}

export function calculateTransitionDurationInFrames(
  scene: RemotionRenderInput["scenes"][number],
  fps: number,
): number {
  if (scene.transition.type === "CUT") return 0;
  const requested = Math.round(scene.transition.duration * fps);
  const sceneFrames = calculateSceneDurationInFrames(scene.durationMs, fps);
  return Math.max(1, Math.min(requested, sceneFrames - 1));
}

export function calculateRemotionDurationInFrames(
  input: RemotionRenderInput,
): number {
  return input.scenes.reduce(
    (total, scene) =>
      total + calculateSceneDurationInFrames(scene.durationMs, input.fps),
    0,
  );
}
