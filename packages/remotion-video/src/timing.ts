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
  const durationMs = input.scenes.reduce(
    (total, scene) => total + scene.durationMs,
    0,
  );
  return Math.max(1, Math.round((durationMs / 1_000) * input.fps));
}

export function calculateSceneStartFrame(
  scenes: readonly RemotionRenderInput["scenes"][number][],
  sceneIndex: number,
  fps: number,
): number {
  const elapsedMs = scenes
    .slice(0, sceneIndex)
    .reduce((total, scene) => total + scene.durationMs, 0);
  return Math.round((elapsedMs / 1_000) * fps);
}

export function calculateSceneTimelineDurationInFrames(
  scenes: readonly RemotionRenderInput["scenes"][number][],
  sceneIndex: number,
  fps: number,
): number {
  return Math.max(
    1,
    calculateSceneStartFrame(scenes, sceneIndex + 1, fps) -
      calculateSceneStartFrame(scenes, sceneIndex, fps),
  );
}
