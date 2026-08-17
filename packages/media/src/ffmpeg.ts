export type VideoTransition = "CUT" | "FADE" | "DISSOLVE" | "PUSH" | "ZOOM";
export type VideoAnimation =
  | "NONE"
  | "FADE"
  | "SLIDE"
  | "ZOOM"
  | "PAN"
  | "BOUNCE"
  | "RISE";

export interface RenderSceneInput {
  imagePath: string;
  duration: number;
  animation: VideoAnimation;
  transition: {
    type: VideoTransition;
    duration: number;
  };
  voicePath?: string;
}

export interface SoundEffectInput {
  path: string;
  offsetMs: number;
  gainDb: number;
}

export interface FfmpegRenderPlan {
  scenes: RenderSceneInput[];
  outputPath: string;
  subtitlePath?: string;
  narrationPath?: string;
  backgroundMusicPath?: string;
  narrationVolume?: number;
  backgroundMusicVolume?: number;
  soundEffects?: SoundEffectInput[];
  width: number;
  height: number;
  fps?: number;
  watermark?: string;
  fontFile?: string;
  filterScriptPath?: string;
}

export interface BuiltFfmpegCommand {
  args: string[];
  filterScript: string;
  durationSeconds: number;
}

const transitionNames: Record<VideoTransition, string> = {
  CUT: "fade",
  FADE: "fade",
  DISSOLVE: "dissolve",
  PUSH: "slideleft",
  ZOOM: "zoomin",
};

function transitionDurationFor(scene: RenderSceneInput): number {
  return scene.transition.type === "CUT"
    ? 0.01
    : Math.max(0.01, Math.min(scene.transition.duration, 1.5));
}

function filterPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/^([A-Za-z]):/, "$1\\:")
    .replaceAll("'", "\\'");
}

function drawTextValue(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'");
}

function animationFilter(
  type: VideoAnimation,
  width: number,
  height: number,
  fps: number,
): string {
  const base = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  if (type === "ZOOM" || type === "BOUNCE") {
    const zoom =
      type === "BOUNCE"
        ? "1+0.025*sin(on/8)"
        : "min(zoom+0.0008,1.08)";
    return `${base},zoompan=z='${zoom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`;
  }
  if (type === "PAN" || type === "SLIDE") {
    return `${base},zoompan=z='1.04':x='(iw-iw/zoom)*on/300':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps}`;
  }
  if (type === "RISE") {
    return `${base},zoompan=z='1.06':x='iw/2-(iw/zoom/2)':y='max(0,ih-(ih/zoom/2)-on*10)':d=1:s=${width}x${height}:fps=${fps}`;
  }
  return `${base},fps=${fps}`;
}

export function buildFfmpegRenderCommand(
  plan: FfmpegRenderPlan,
): BuiltFfmpegCommand {
  if (plan.scenes.length === 0) throw new Error("RENDER_SCENES_REQUIRED");
  if (plan.width % 2 !== 0 || plan.height % 2 !== 0) {
    throw new Error("RENDER_DIMENSIONS_MUST_BE_EVEN");
  }

  const fps = plan.fps ?? 30;
  const narrationVolume = Math.min(
    2,
    Math.max(0, plan.narrationVolume ?? 1),
  );
  const backgroundMusicVolume = Math.min(
    1,
    Math.max(0, plan.backgroundMusicVolume ?? 0.1),
  );
  const args = ["-y", "-hide_banner", "-progress", "pipe:2", "-nostats"];
  const filters: string[] = [];
  const voiceInputs: Array<{ inputIndex: number; sceneIndex: number }> = [];
  const transitionDurations = plan.scenes.map((scene, index) =>
    index < plan.scenes.length - 1 ? transitionDurationFor(scene) : 0,
  );

  for (const [index, scene] of plan.scenes.entries()) {
    if (scene.duration <= 0) throw new Error("RENDER_DURATION_INVALID");
    const videoDuration = scene.duration + (transitionDurations[index] ?? 0);
    args.push("-loop", "1", "-framerate", String(fps), "-t", videoDuration.toFixed(3), "-i", scene.imagePath);
    filters.push(
      `[${index}:v]${animationFilter(scene.animation, plan.width, plan.height, fps)},format=yuv420p,setpts=PTS-STARTPTS[v${index}]`,
    );
  }

  let nextInputIndex = plan.scenes.length;
  let narrationInputIndex: number | undefined;
  if (plan.narrationPath) {
    args.push("-i", plan.narrationPath);
    narrationInputIndex = nextInputIndex++;
  }
  for (const [sceneIndex, scene] of plan.scenes.entries()) {
    if (scene.voicePath && narrationInputIndex === undefined) {
      args.push("-i", scene.voicePath);
      voiceInputs.push({ inputIndex: nextInputIndex, sceneIndex });
      nextInputIndex += 1;
    }
  }

  let backgroundMusicIndex: number | undefined;
  if (plan.backgroundMusicPath) {
    args.push("-stream_loop", "-1", "-i", plan.backgroundMusicPath);
    backgroundMusicIndex = nextInputIndex++;
  }

  const soundEffectInputs = (plan.soundEffects ?? []).map((soundEffect) => {
    args.push("-i", soundEffect.path);
    return { ...soundEffect, inputIndex: nextInputIndex++ };
  });

  let videoLabel = "v0";
  let elapsed =
    (plan.scenes[0]?.duration ?? 0) + (transitionDurations[0] ?? 0);
  for (let index = 1; index < plan.scenes.length; index += 1) {
    const scene = plan.scenes[index];
    if (!scene) continue;
    const requested = plan.scenes[index - 1]?.transition;
    const transitionDuration = transitionDurations[index - 1] ?? 0.01;
    const offset = Math.max(0, elapsed - transitionDuration);
    const output = `vx${index}`;
    filters.push(
      `[${videoLabel}][v${index}]xfade=transition=${transitionNames[requested?.type ?? "CUT"]}:duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}[${output}]`,
    );
    videoLabel = output;
    elapsed =
      offset + scene.duration + (transitionDurations[index] ?? 0);
  }

  if (plan.subtitlePath) {
    filters.push(
      `[${videoLabel}]ass='${filterPath(plan.subtitlePath)}'[vsub]`,
    );
    videoLabel = "vsub";
  }
  if (plan.watermark) {
    const fontFile = plan.fontFile
      ? `fontfile='${filterPath(plan.fontFile)}':`
      : "";
    filters.push(
      `[${videoLabel}]drawtext=${fontFile}text='${drawTextValue(plan.watermark)}':x=w-tw-32:y=32:fontsize=28:fontcolor=white@0.6:shadowx=2:shadowy=2[vout]`,
    );
    videoLabel = "vout";
  }

  const sceneStarts: number[] = [];
  let cursor = 0;
  for (const scene of plan.scenes) {
    sceneStarts.push(cursor);
    cursor += scene.duration;
  }
  const durationSeconds = Math.max(elapsed, cursor);

  const audioLabels: string[] = [];
  if (narrationInputIndex !== undefined) {
    filters.push(
      `[${narrationInputIndex}:a]aresample=48000,atrim=duration=${durationSeconds.toFixed(3)},volume=${narrationVolume.toFixed(4)}[voice]`,
    );
    audioLabels.push("voice");
  }
  for (const voice of voiceInputs) {
    const delay = Math.round((sceneStarts[voice.sceneIndex] ?? 0) * 1_000);
    const label = `voice${voice.sceneIndex}`;
    const duration = plan.scenes[voice.sceneIndex]!.duration;
    filters.push(
      `[${voice.inputIndex}:a]aresample=48000,atrim=duration=${duration.toFixed(3)},adelay=${delay}|${delay},volume=${narrationVolume.toFixed(4)}[${label}]`,
    );
    audioLabels.push(label);
  }
  for (const [index, sound] of soundEffectInputs.entries()) {
    const label = `sfx${index}`;
    filters.push(
      `[${sound.inputIndex}:a]aresample=48000,adelay=${sound.offsetMs}|${sound.offsetMs},volume=${Math.pow(10, sound.gainDb / 20).toFixed(4)}[${label}]`,
    );
    audioLabels.push(label);
  }

  let narrationLabel: string;
  if (audioLabels.length > 0) {
    filters.push(
      `${audioLabels.map((label) => `[${label}]`).join("")}amix=inputs=${audioLabels.length}:normalize=0:duration=longest[narration]`,
    );
    narrationLabel = "narration";
  } else {
    filters.push(
      `anullsrc=r=48000:cl=stereo,atrim=duration=${durationSeconds.toFixed(3)}[narration]`,
    );
    narrationLabel = "narration";
  }

  let audioLabel = narrationLabel;
  if (backgroundMusicIndex !== undefined) {
    filters.push(
      `[${backgroundMusicIndex}:a]aresample=48000,volume=${backgroundMusicVolume.toFixed(4)}[bgm]`,
      `[${narrationLabel}]asplit=2[narrationSidechain][narrationMix]`,
      `[bgm][narrationSidechain]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=350[ducked]`,
      `[narrationMix][ducked]amix=inputs=2:normalize=0:duration=first[aout]`,
    );
    audioLabel = "aout";
  }

  const filterScript = filters.join(";");
  args.push(
    ...(plan.filterScriptPath
      ? ["-filter_complex_script", plan.filterScriptPath]
      : ["-filter_complex", filterScript]),
    "-map",
    `[${videoLabel}]`,
    "-map",
    `[${audioLabel}]`,
    "-t",
    durationSeconds.toFixed(3),
    "-r",
    String(fps),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-ar",
    "48000",
    "-movflags",
    "+faststart",
    plan.outputPath,
  );

  return { args, filterScript, durationSeconds };
}
