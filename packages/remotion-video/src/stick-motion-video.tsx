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

function verticalTextLines(value: string | undefined): string[] {
  const text = value?.trim() ?? "";
  if (!text) return [];
  return text.split(/\r?\n/u).flatMap((line, index) => {
    const characters = Array.from(line.trim());
    if (index > 0) return ["", ...characters];
    return characters;
  });
}

const RED_OPENING_COLOR = "#BE2426";

function RedTextOpening({
  text,
  fps,
}: {
  text: string;
  fps: number;
}) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const entranceFrames = Math.min(15, Math.round(fps * 0.5));
  const scale = interpolate(
    frame,
    [0, entranceFrames * 0.4, entranceFrames * 0.95, entranceFrames * 1.35],
    [0.35, 1.28, 1.03, 1],
    clamp,
  );
  const translateY = interpolate(
    frame,
    [0, entranceFrames],
    [height * 0.045, 0],
    clamp,
  );
  const opacity = interpolate(
    frame,
    [0, Math.max(1, entranceFrames * 0.3)],
    [0.6, 1],
    clamp,
  );
  const glow = interpolate(
    frame,
    [0, entranceFrames * 0.4, entranceFrames, entranceFrames * 1.4],
    [0, 1, 0.35, 0.3],
    clamp,
  );
  const lines = text.split("\n").filter((line) => line.length > 0);
  const longestLineLength = Math.max(
    1,
    ...lines.map((line) => Array.from(line).length),
  );
  const baseFontSize = Math.round(Math.min(width, height) * 0.11);
  const widthFontSize = Math.floor((width * 0.86) / longestLineLength);
  const heightFontSize = Math.floor(
    (height * 0.46) / Math.max(1, lines.length * 1.35),
  );
  const fontSize = Math.max(
    28,
    Math.min(baseFontSize, widthFontSize, heightFontSize),
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        transform: `translate3d(0, ${translateY}px, 0) scale(${scale})`,
      }}
    >
      <div
        style={{
          width: "86%",
          textAlign: "center",
          color: RED_OPENING_COLOR,
          fontFamily: '"Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
          fontWeight: 900,
          fontSize,
          lineHeight: 1.35,
          letterSpacing: "0.02em",
          whiteSpace: "pre-line",
          textShadow: `0 ${Math.round(6 + 8 * glow)}px ${Math.round(
            18 + 62 * glow,
          )}px rgba(255,${Math.round(92 - 46 * glow)},${Math.round(
            90 - 52 * glow,
          )},${0.35 + 0.55 * glow})`,
        }}
      >
        {text}
      </div>
    </div>
  );
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
  if (scene.animation.type === "RISE") {
    const rise = interpolate(
      frame,
      [0, Math.min(14, durationInFrames - 1)],
      [0, 1],
      clamp,
    );
    const flash = interpolate(
      frame,
      [0, 3, 8, Math.min(14, durationInFrames - 1)],
      [0, 0.85, 0.2, 0],
      clamp,
    );
    const distance = (1 - rise) * 10 * Math.max(0.35, intensity);
    return {
      opacity: enter,
      filter: `brightness(${1 + flash * 0.9})`,
      transform: `translate3d(0, ${distance}%, 0) scale(${
        1.02 + (1 - rise) * 0.04
      })`,
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
  const outlineWidth = style.outline ? (style.outlineWidth ?? 8) : 0;
  return {
    color: style.primaryColor ?? fallbackColor,
    fontFamily:
      style.fontFamily ??
      '"DouyinSansBold", "HarmonyOS Sans SC Light", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
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

const SceneAudioLayers = ({
  scene,
  fps,
}: {
  scene: Scene;
  fps: number;
}) => (
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

const KnowledgeBoardMedia = ({
  scene,
  fps,
}: {
  scene: Scene;
  fps: number;
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const durationInFrames = calculateSceneDurationInFrames(
    scene.durationMs,
    fps,
  );
  const layout = getKnowledgeBoardLayout(width, height);
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
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
      {scene.isTextOpening ? (
        <RedTextOpening
          text={scene.openingText ?? scene.subtitleCues[0]?.text ?? ""}
          fps={fps}
        />
      ) : null}
      <SceneAudioLayers scene={scene} fps={fps} />
    </AbsoluteFill>
  );
};

const KnowledgeBoardBackdrop = () => (
  <AbsoluteFill
    style={{
      backgroundColor: "#FFFFFF",
    }}
  />
);

const KnowledgeBoardChrome = ({
  scene,
  subtitleStyle,
  watermark,
  headerText,
}: {
  scene: Scene;
  subtitleStyle: RemotionRenderInput["subtitleStyle"];
  watermark: string;
  headerText: string;
}) => {
  const frame = useCurrentFrame();
  const { width, height, fps } = useVideoConfig();
  const currentMs = (frame / fps) * 1_000;
  const activeCue = scene.subtitleCues.find(
    (cue) => currentMs >= cue.startMs && currentMs < cue.endMs,
  );
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
  const sideTextFontSize = Math.round(height * 0.038);
  const leftSideLines = verticalTextLines(
    subtitleStyle.leftVerticalText ?? "@杰研社进化论",
  );
  const rightSideLines = verticalTextLines(
    subtitleStyle.rightVerticalText ?? "个人观点\n\n无不良引导",
  );
  const sideTextStyle: CSSProperties = {
    position: "absolute",
    top: "22%",
    height: "56%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: '"DouyinSansBold", "Microsoft YaHei", sans-serif',
    fontWeight: 700,
    fontSize: sideTextFontSize,
    lineHeight: 1.1,
    letterSpacing: "0.02em",
    userSelect: "none",
  };
  const leftSideTextStyle: CSSProperties = {
    ...sideTextStyle,
    left: "3.125%",
    color: "#CCCCCC",
    gap: Math.round(sideTextFontSize * 0.65),
  };
  const rightSideTextStyle: CSSProperties = {
    ...sideTextStyle,
    right: "3.125%",
    color: "#CCCCCC",
    gap: Math.round(sideTextFontSize * 0.18),
  };
  return (
    <AbsoluteFill style={{ color: "#111", overflow: "hidden" }}>
      {headerText ? (
        <div
          style={{
            position: "absolute",
            top: "6.5%",
            left: "5%",
            right: "5%",
            height: "5%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#090909",
            fontFamily: '"DouyinSansBold", "Microsoft YaHei", sans-serif',
            fontSize: Math.min(headerFontSize, Math.round(height * 0.038)),
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
          top: layout.dividerY,
          left: 0,
          right: 0,
          height: Math.max(3, Math.round(height * 0.0025)),
          backgroundColor: "#111",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "8.3%",
          left: "21.3%",
          width: Math.round(width * 0.022),
          height: Math.max(3, Math.round(height * 0.004)),
          backgroundColor: "rgba(0,0,0,0.75)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "8.3%",
          right: "21.3%",
          width: Math.round(width * 0.022),
          height: Math.max(3, Math.round(height * 0.004)),
          backgroundColor: "rgba(0,0,0,0.75)",
        }}
      />
      <div style={leftSideTextStyle}>
        {leftSideLines.map((character, index) => (
          <span key={`${character}-${index}`} style={{ height: sideTextFontSize }}>
            {character}
          </span>
        ))}
      </div>
      <div style={rightSideTextStyle}>
        {rightSideLines.map((character, index) => (
          <span
            key={`${character}-${index}`}
            style={{
              height: character
                ? sideTextFontSize
                : Math.round(sideTextFontSize * 0.4),
            }}
          >
            {character}
          </span>
        ))}
      </div>
      {activeCue && !scene.isTextOpening ? (
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
              ...subtitleAppearance(
                { ...subtitleStyle, shadow: false },
                "#FFFFFF",
              ),
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
    </AbsoluteFill>
  );
};

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
        {activeCue && !scene.isTextOpening ? (
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
        {scene.isTextOpening ? (
          <RedTextOpening
            text={scene.openingText ?? scene.subtitleCues[0]?.text ?? ""}
            fps={fps}
          />
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
      {activeCue && !scene.isTextOpening ? (
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
      {scene.isTextOpening ? (
        <RedTextOpening
          text={scene.openingText ?? scene.subtitleCues[0]?.text ?? ""}
          fps={fps}
        />
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
  const chromeTimeline: ReactNode[] = [];
  let chromeStartFrame = 0;
  const knowledgeBoard = input.videoTemplate === "KNOWLEDGE_BOARD";

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
        {knowledgeBoard ? (
          <KnowledgeBoardMedia scene={scene} fps={input.fps} />
        ) : (
          <SceneLayer
            scene={scene}
            subtitleStyle={input.subtitleStyle}
            watermark={input.watermark}
            videoTemplate={input.videoTemplate}
            headerText={input.headerText}
          />
        )}
      </TransitionSeries.Sequence>,
    );
    if (knowledgeBoard) {
      const sceneDurationInFrames = calculateSceneDurationInFrames(
        scene.durationMs,
        input.fps,
      );
      chromeTimeline.push(
        <Sequence
          key={`chrome-${index}`}
          from={chromeStartFrame}
          durationInFrames={sceneDurationInFrames}
        >
          <KnowledgeBoardChrome
            scene={scene}
            subtitleStyle={input.subtitleStyle}
            watermark={input.watermark}
            headerText={input.headerText}
          />
        </Sequence>,
      );
      chromeStartFrame += sceneDurationInFrames;
    }
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
      <style>{`@font-face{font-family:"DouyinSansBold";src:url("${staticFile(
        "DouyinSansBold.otf",
      )}") format("opentype")}@font-face{font-family:"HarmonyOS Sans SC Light";src:url("${staticFile(
        "HarmonyOS_Sans_SC_Light.ttf",
      )}") format("truetype")}`}</style>
      {knowledgeBoard ? <KnowledgeBoardBackdrop /> : null}
      {input.backgroundMusicFile ? (
        <Audio
          src={staticFile(input.backgroundMusicFile)}
          volume={input.backgroundMusicVolume}
          loop
        />
      ) : null}
      <TransitionSeries>{timeline}</TransitionSeries>
      {knowledgeBoard ? <>{chromeTimeline}</> : null}
    </AbsoluteFill>
  );
};
