import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { dissolve } from "@remotion/transitions/dissolve";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";
import { zoomInOut } from "@remotion/transitions/zoom-in-out";
import {
  getKnowledgeBoardLayout,
  remotionRenderInputSchema,
  type RemotionRenderInput,
} from "@stickmotion/shared";
import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import {
  calculateSceneDurationInFrames,
  calculateTransitionDurationInFrames,
} from "./timing";

type Scene = RemotionRenderInput["scenes"][number];

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

function gainToVolume(gainDb: number): number {
  return Math.min(1, Math.max(0, 10 ** (gainDb / 20)));
}

function sceneTransform(
  scene: Scene,
  frame: number,
  durationInFrames: number,
  fps: number,
): CSSProperties {
  const intensity = scene.animation.intensity;
  const progress = interpolate(
    frame,
    [0, Math.max(1, durationInFrames - 1)],
    [0, 1],
    clamp,
  );
  const enter = interpolate(
    frame,
    [0, Math.min(12, durationInFrames - 1)],
    [0, 1],
    clamp,
  );
  const direction = scene.animation.direction;

  if (scene.animation.type === "FADE") {
    return { opacity: enter };
  }
  if (scene.animation.type === "SLIDE") {
    const distance = (1 - enter) * 12 * intensity;
    const x =
      direction === "LEFT" ? distance : direction === "RIGHT" ? -distance : 0;
    const y =
      direction === "UP" ? distance : direction === "DOWN" ? -distance : 0;
    return {
      opacity: enter,
      transform: `translate3d(${x}%, ${y}%, 0) scale(1.04)`,
    };
  }
  if (scene.animation.type === "ZOOM") {
    const zoomOut = direction === "OUT";
    const start = zoomOut ? 1.09 : 1;
    const end = zoomOut ? 1 : 1.09;
    return {
      transform: `scale(${start + (end - start) * progress * Math.max(0.35, intensity)})`,
    };
  }
  if (scene.animation.type === "PAN") {
    const distance = 5 * Math.max(0.35, intensity);
    const x =
      direction === "RIGHT"
        ? -distance + progress * distance * 2
        : direction === "LEFT"
          ? distance - progress * distance * 2
          : 0;
    const y =
      direction === "DOWN"
        ? -distance + progress * distance * 2
        : direction === "UP"
          ? distance - progress * distance * 2
          : 0;
    return { transform: `translate3d(${x}%, ${y}%, 0) scale(1.1)` };
  }
  if (scene.animation.type === "BOUNCE") {
    const value = spring({
      frame,
      fps,
      config: { damping: 12, mass: 0.6, stiffness: 100 },
      durationInFrames: Math.min(durationInFrames, Math.round(fps * 0.7)),
    });
    return {
      opacity: enter,
      transform: `scale(${0.94 + value * 0.06}) translateY(${(1 - value) * 3}%)`,
    };
  }
  return { transform: "scale(1.015)" };
}

function subtitlePosition(
  position: RemotionRenderInput["subtitleStyle"]["position"],
): CSSProperties {
  if (position === "TOP") return { top: "8%" };
  if (position === "CENTER")
    return { top: "50%", transform: "translateY(-50%)" };
  return { bottom: "8%" };
}

function subtitleAppearance(
  style: RemotionRenderInput["subtitleStyle"],
  fallbackColor: string,
): CSSProperties {
  const outlineWidth = style.outline ? (style.outlineWidth ?? 3) : 0;
  return {
    color: style.primaryColor ?? fallbackColor,
    fontFamily:
      style.fontFamily ??
      '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
    fontWeight: style.fontWeight ?? 800,
    fontStyle: style.italic ? "italic" : "normal",
    backgroundColor: style.backgroundColor ?? undefined,
    borderRadius: style.backgroundColor ? 12 : undefined,
    padding: style.backgroundColor ? "0.12em 0.38em" : undefined,
    WebkitTextStroke:
      outlineWidth > 0
        ? `${outlineWidth}px ${style.outlineColor ?? "#000000"}`
        : undefined,
    paintOrder: "stroke fill",
    textShadow: style.shadow
      ? `0 6px 16px ${style.shadowColor ?? "rgba(0,0,0,.8)"}`
      : undefined,
  };
}

const SceneLayer = ({
  scene,
  subtitleStyle,
  watermark,
  videoTemplate,
  headerText,
}: {
  scene: Scene;
  subtitleStyle: RemotionRenderInput["subtitleStyle"];
  watermark: string;
  videoTemplate: RemotionRenderInput["videoTemplate"];
  headerText: string;
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const durationInFrames = calculateSceneDurationInFrames(
    scene.durationMs,
    fps,
  );
  const currentMs = (frame / fps) * 1_000;
  const activeCue = scene.subtitleCues.find(
    (cue) => currentMs >= cue.startMs && currentMs < cue.endMs,
  );
  const audioLayers = (
    <>
      {scene.voiceFile ? <Audio src={staticFile(scene.voiceFile)} /> : null}
      {scene.soundEffects.map((effect, index) => (
        <Sequence
          key={`${effect.file}-${effect.offsetMs}-${index}`}
          from={Math.round((effect.offsetMs / 1_000) * fps)}
        >
          <Audio
            src={staticFile(effect.file)}
            volume={gainToVolume(effect.gainDb)}
          />
        </Sequence>
      ))}
    </>
  );
  if (videoTemplate === "KNOWLEDGE_BOARD") {
    const layout = getKnowledgeBoardLayout(width, height);
    const headerFontSize = Math.max(
      18,
      Math.min(
        layout.header.fontSize,
        Math.floor(
          (width * 0.84) / (Math.max(1, Array.from(headerText).length) * 0.92),
        ),
      ),
    );
    const subtitleFontSize = Math.min(
      subtitleStyle.fontSize,
      Math.round(height * (height > width ? 0.038 : 0.055)),
    );

    return (
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 38%, #ffffff 0%, #fdfdfc 68%, #f7f7f5 100%)",
          color: "#111",
          overflow: "hidden",
        }}
      >
        {headerText ? (
          <div
            style={{
              position: "absolute",
              top: layout.header.top,
              left: "5%",
              right: "5%",
              height: layout.header.height,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#090909",
              fontFamily: '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
              fontSize: headerFontSize,
              fontWeight: 800,
              letterSpacing: "0.2em",
              whiteSpace: "nowrap",
            }}
          >
            {headerText}
          </div>
        ) : null}
        <div
          style={{
            position: "absolute",
            left: layout.image.left,
            top: layout.image.top,
            width: layout.image.width,
            height: layout.image.height,
            display: "grid",
            placeItems: "center",
            overflow: "hidden",
          }}
        >
          <Img
            src={staticFile(scene.imageFile)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              ...sceneTransform(scene, frame, durationInFrames, fps),
            }}
          />
        </div>
        <div
          style={{
            position: "absolute",
            top: layout.dividerY,
            left: 0,
            right: 0,
            height: Math.max(3, Math.round(height * 0.0025)),
            backgroundColor: "#111",
          }}
        />
        {activeCue ? (
          <div
            style={{
              position: "absolute",
              top: layout.subtitle.top,
              left: 0,
              right: 0,
              height: layout.subtitle.height,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: `0 ${Math.round(width * 0.06)}px`,
              textAlign: "center",
              fontSize: subtitleFontSize,
              lineHeight: 1.3,
              letterSpacing: "0.01em",
            }}
          >
            <span
              style={{
                maxWidth: layout.subtitle.maxWidth,
                ...subtitleAppearance(subtitleStyle, "#111111"),
              }}
            >
              {activeCue.text}
            </span>
          </div>
        ) : null}
        {watermark ? (
          <div
            style={{
              position: "absolute",
              right: 24,
              top: 18,
              color: "rgba(0,0,0,.45)",
              fontFamily: "sans-serif",
              fontSize: 20,
            }}
          >
            {watermark}
          </div>
        ) : null}
        {audioLayers}
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ backgroundColor: "#000", overflow: "hidden" }}>
      <Img
        src={staticFile(scene.imageFile)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          ...sceneTransform(scene, frame, durationInFrames, fps),
        }}
      />
      {audioLayers}
      {activeCue ? (
        <div
          style={{
            position: "absolute",
            left: "7%",
            right: "7%",
            textAlign: "center",
            fontSize: subtitleStyle.fontSize,
            lineHeight: 1.35,
            letterSpacing: "0.02em",
            ...subtitleAppearance(subtitleStyle, "#FFFFFF"),
            ...subtitlePosition(subtitleStyle.position),
          }}
        >
          {activeCue.text}
        </div>
      ) : null}
      {watermark ? (
        <div
          style={{
            position: "absolute",
            right: 28,
            bottom: 24,
            color: "rgba(255,255,255,.75)",
            fontFamily: "sans-serif",
            fontSize: 24,
          }}
        >
          {watermark}
        </div>
      ) : null}
    </AbsoluteFill>
  );
};

function transitionNode(scene: Scene, fps: number, key: string): ReactNode {
  const durationInFrames = calculateTransitionDurationInFrames(scene, fps);
  if (durationInFrames === 0) return null;
  const timing = linearTiming({ durationInFrames });

  if (scene.transition.type === "PUSH") {
    return (
      <TransitionSeries.Transition
        key={key}
        presentation={slide({ direction: "from-right" })}
        timing={timing}
      />
    );
  }
  if (scene.transition.type === "ZOOM") {
    return (
      <TransitionSeries.Transition
        key={key}
        presentation={zoomInOut({})}
        timing={timing}
      />
    );
  }
  if (scene.transition.type === "DISSOLVE") {
    return (
      <TransitionSeries.Transition
        key={key}
        presentation={dissolve({ intensity: 0.8 })}
        timing={timing}
      />
    );
  }
  return (
    <TransitionSeries.Transition
      key={key}
      presentation={fade()}
      timing={timing}
    />
  );
}

export const StickMotionVideo = (rawProps: RemotionRenderInput) => {
  const input = remotionRenderInputSchema.parse(rawProps);
  const timeline: ReactNode[] = [];

  input.scenes.forEach((scene, index) => {
    const outgoingTransition =
      index < input.scenes.length - 1
        ? calculateTransitionDurationInFrames(scene, input.fps)
        : 0;
    timeline.push(
      <TransitionSeries.Sequence
        key={`scene-${index}`}
        durationInFrames={
          calculateSceneDurationInFrames(scene.durationMs, input.fps) +
          outgoingTransition
        }
      >
        <SceneLayer
          scene={scene}
          subtitleStyle={input.subtitleStyle}
          watermark={input.watermark}
          videoTemplate={input.videoTemplate}
          headerText={input.headerText}
        />
      </TransitionSeries.Sequence>,
    );
    if (index < input.scenes.length - 1) {
      const transition = transitionNode(
        scene,
        input.fps,
        `transition-${index}`,
      );
      if (transition) timeline.push(transition);
    }
  });

  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {input.backgroundMusicFile ? (
        <Audio
          src={staticFile(input.backgroundMusicFile)}
          volume={input.backgroundMusicVolume}
          loop
        />
      ) : null}
      <TransitionSeries>{timeline}</TransitionSeries>
    </AbsoluteFill>
  );
};
