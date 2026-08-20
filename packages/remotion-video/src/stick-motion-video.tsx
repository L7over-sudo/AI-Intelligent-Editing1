import { Audio } from "@remotion/media";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import {
  getKnowledgeBoardHeaderDecorationLayout,
  getKnowledgeBoardLayout,
  KNOWLEDGE_BOARD_HEADER_LETTER_SPACING_EM,
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
  calculateSceneStartFrame,
  calculateSceneTimelineDurationInFrames,
  calculateTransitionDurationInFrames,
} from "./timing";
import { narrationVolumeAtFrame } from "./audio-envelope";
import {
  buildVisibleImpactCaptionLines,
  impactCaptionTone,
  type ImpactCaptionTone,
} from "./impact-captions";

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

function verticalTextGroups(value: string | undefined): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  for (const character of verticalTextLines(value)) {
    if (character) {
      current.push(character);
    } else if (current.length > 0) {
      groups.push(current);
      current = [];
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
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

function knowledgeBoardSceneAppearance(
  scene: Scene,
  frame: number,
  durationInFrames: number,
  fps: number,
): CSSProperties {
  return sceneTransform(scene, frame, durationInFrames, fps);
}

const KnowledgeBoardSceneImage = ({
  scene,
  frame,
  durationInFrames,
  fps,
}: {
  scene: Scene;
  frame: number;
  durationInFrames: number;
  fps: number;
}) => {
  const source = staticFile(scene.imageFile);
  return (
    <>
      <div
        style={{
          width: "100%",
          height: "100%",
          backgroundImage: `url(${JSON.stringify(source)})`,
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "contain",
          ...knowledgeBoardSceneAppearance(scene, frame, durationInFrames, fps),
        }}
      />
      <Img
        src={source}
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        }}
      />
    </>
  );
};

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

const NarrationAudio = ({
  scene,
  fps,
  narrationVolume,
}: {
  scene: Scene;
  fps: number;
  narrationVolume: number;
}) => {
  const frame = useCurrentFrame();
  if (!scene.voiceFile) return null;
  const durationInFrames = calculateSceneDurationInFrames(
    scene.durationMs,
    fps,
  );
  const volume =
    narrationVolumeAtFrame(frame, durationInFrames, fps) * narrationVolume;
  return <Audio src={staticFile(scene.voiceFile)} volume={volume} />;
};

const SceneAudioLayers = ({
  scene,
  fps,
  narrationVolume,
}: {
  scene: Scene;
  fps: number;
  narrationVolume: number;
}) => (
  <>
    <NarrationAudio scene={scene} fps={fps} narrationVolume={narrationVolume} />
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
  narrationVolume,
}: {
  scene: Scene;
  fps: number;
  narrationVolume: number;
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
        <KnowledgeBoardSceneImage
          scene={scene}
          frame={frame}
          durationInFrames={durationInFrames}
          fps={fps}
        />
      </div>
      <SceneAudioLayers
        scene={scene}
        fps={fps}
        narrationVolume={narrationVolume}
      />
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
  const titleText = subtitleStyle.mainTitle?.trim() ?? "";
  const titleFontSize = Math.max(
    28,
    Math.min(
      layout.title.fontSize,
      Math.floor(
        (width * 0.72) / (Math.max(1, Array.from(titleText).length) * 0.95),
      ),
    ),
  );
  const headerFontSize = Math.max(
    18,
    Math.min(
      layout.header.fontSize,
      Math.floor(
        (width * 0.84) /
          (Math.max(1, Array.from(headerText).length) * 0.92 +
            Math.max(0, Array.from(headerText).length - 1) *
              KNOWLEDGE_BOARD_HEADER_LETTER_SPACING_EM),
      ),
    ),
  );
  const headerDecoration = getKnowledgeBoardHeaderDecorationLayout(
    width,
    headerText,
    headerFontSize,
  );
  const subtitleFontSize = subtitleStyle.fontSize;
  const sideTextFontSize = Math.max(16, Math.round(height * 0.028));
  const leftSideGroups = verticalTextGroups(
    subtitleStyle.leftVerticalText ?? "无限进化的Jay",
  );
  const rightSideGroups = verticalTextGroups(
    subtitleStyle.rightVerticalText ?? "个人观点\n\n无不良引导",
  );
  const sideCharGap = Math.round(sideTextFontSize * 0.25);
  const rightSideCharGap = Math.round(sideTextFontSize * 0.25);
  const sideTextStyle: CSSProperties = {
    position: "absolute",
    top: "22%",
    height: "55%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: '"DouyinSansBold", "Microsoft YaHei", sans-serif',
    fontWeight: 700,
    fontSize: sideTextFontSize,
    lineHeight: 1,
    letterSpacing: 0,
    userSelect: "none",
  };
  const leftSideTextStyle: CSSProperties = {
    ...sideTextStyle,
    left: "3.125%",
    color: "#CCCCCC",
    gap: sideTextFontSize,
    transform: "translateX(-50%)",
  };
  const rightSideTextStyle: CSSProperties = {
    ...sideTextStyle,
    right: "3.125%",
    color: "#CCCCCC",
    gap: sideTextFontSize,
    transform: "translateX(50%)",
  };
  const leftSideGroupStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: sideCharGap,
  };
  const rightSideGroupStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: rightSideCharGap,
  };
  return (
    <AbsoluteFill style={{ color: "#111", overflow: "hidden" }}>
      {titleText ? (
        <div
          style={{
            position: "absolute",
            top: layout.title.top,
            left: "8%",
            right: "8%",
            height: layout.title.height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#000000",
            fontFamily: '"DouyinSansBold", "Microsoft YaHei", sans-serif',
            fontSize: titleFontSize,
            fontWeight: 800,
            lineHeight: 1,
            whiteSpace: "nowrap",
          }}
        >
          {titleText}
        </div>
      ) : null}
      {headerText ? (
        <div
          style={{
            position: "absolute",
            top: layout.header.top,
            left: "12%",
            right: "12%",
            height: layout.header.height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#797979",
            fontFamily: '"DouyinSansBold", "Microsoft YaHei", sans-serif',
            fontSize: headerFontSize,
            fontWeight: 700,
            letterSpacing: `${KNOWLEDGE_BOARD_HEADER_LETTER_SPACING_EM}em`,
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
          top: Math.round(layout.header.top + layout.header.height * 0.5),
          left: headerDecoration.leftDashX,
          width: headerDecoration.dashWidth,
          height: Math.max(2, Math.round(height * 0.0025)),
          backgroundColor: "#787878",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: Math.round(layout.header.top + layout.header.height * 0.5),
          left: headerDecoration.rightDashX,
          width: headerDecoration.dashWidth,
          height: Math.max(2, Math.round(height * 0.0025)),
          backgroundColor: "#787878",
        }}
      />
      <div style={leftSideTextStyle}>
        {leftSideGroups.map((group, groupIndex) => (
          <div key={groupIndex} style={leftSideGroupStyle}>
            {group.map((character, charIndex) => (
              <span
                key={`${character}-${charIndex}`}
                style={{ height: sideTextFontSize }}
              >
                {character}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div style={rightSideTextStyle}>
        {rightSideGroups.map((group, groupIndex) => (
          <div key={groupIndex} style={rightSideGroupStyle}>
            {group.map((character, charIndex) => (
              <span
                key={`${character}-${charIndex}`}
                style={{ height: sideTextFontSize }}
              >
                {character}
              </span>
            ))}
          </div>
        ))}
      </div>
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
              display: "inline-block",
              whiteSpace: "nowrap",
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

function impactCaptionAppearance(tone: ImpactCaptionTone): CSSProperties {
  if (tone === "RED") {
    return {
      color: "#F31348",
      WebkitTextStroke: "7px #FFFFFF",
      paintOrder: "stroke fill",
      textShadow: "0 8px 0 #111111, 0 13px 20px rgba(0,0,0,.72)",
    };
  }
  return {
    color: tone === "YELLOW" ? "#FFE100" : "#FFFFFF",
    WebkitTextStroke: "9px #101010",
    paintOrder: "stroke fill",
    textShadow: "0 10px 20px rgba(0,0,0,.72)",
  };
}

function impactCaptionFontSize(
  width: number,
  height: number,
  line: string,
): number {
  const characterCount = Math.max(1, Array.from(line).length);
  return Math.max(
    58,
    Math.min(
      Math.round(height * 0.105),
      Math.floor((width * 0.76) / (characterCount * 0.94)),
    ),
  );
}

const ImpactCaptionOverlay = ({
  scene,
  frame,
  durationInFrames,
  fps,
}: {
  scene: Scene;
  frame: number;
  durationInFrames: number;
  fps: number;
}) => {
  const { width, height } = useVideoConfig();
  const currentMs = (frame / fps) * 1_000;
  const lines = buildVisibleImpactCaptionLines(
    scene.subtitleCues,
    currentMs,
  );
  if (lines.length === 0) return null;
  const newestLineStartFrame = Math.round(
    ((lines.at(-1)?.startMs ?? 0) / 1_000) * fps,
  );
  const beatFrame = Math.max(0, frame - newestLineStartFrame);
  const exitStart = Math.max(0, durationInFrames - Math.round(fps * 0.22));
  const exitOpacity = interpolate(
    frame,
    [exitStart, Math.max(exitStart + 1, durationInFrames - 1)],
    [1, 0],
    clamp,
  );
  const echoOpacity = interpolate(
    beatFrame,
    [
      0,
      Math.max(1, Math.round(fps * 0.07)),
      Math.max(2, Math.round(fps * 0.3)),
    ],
    [0, 0.34, 0],
    clamp,
  );
  const echoScale = interpolate(
    beatFrame,
    [0, Math.max(1, Math.round(fps * 0.3))],
    [2.45, 1.1],
    clamp,
  );
  const slashProgress = interpolate(
    beatFrame,
    [0, Math.max(1, Math.round(fps * 0.22))],
    [0, 1],
    clamp,
  );

  return (
    <AbsoluteFill style={{ pointerEvents: "none", opacity: exitOpacity }}>
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(0,0,0,.16) 0%, rgba(0,0,0,.03) 58%, rgba(0,0,0,.42) 100%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "7%",
          top: "28%",
          width: `${slashProgress * 86}%`,
          height: Math.max(8, Math.round(height * 0.012)),
          backgroundColor: "#FFE100",
          opacity: interpolate(
            slashProgress,
            [0, 0.55, 1],
            [0, 0.72, 0],
            clamp,
          ),
          transform: "skewX(-18deg)",
          transformOrigin: "left center",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: "4%",
          right: "4%",
          top: "14%",
          bottom: "27%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: Math.round(height * 0.012),
          opacity: echoOpacity,
          transform: `scale(${echoScale})`,
          filter: "blur(1.2px)",
          overflow: "hidden",
        }}
      >
        {lines.slice(-2).map((line, lineIndex) => (
          <div
            key={`echo-${line.sequence}-${line.text}`}
            style={{
              fontFamily:
                '"DouyinSansBold", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
              fontSize: impactCaptionFontSize(width, height, line.text),
              fontWeight: 900,
              lineHeight: 1.03,
              whiteSpace: "nowrap",
              ...impactCaptionAppearance(lineIndex === 0 ? "YELLOW" : "WHITE"),
            }}
          >
            {line.text}
          </div>
        ))}
      </div>
      <div
        style={{
          position: "absolute",
          left: "5%",
          right: "5%",
          top: "13%",
          bottom: "27%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: Math.round(height * 0.012),
          textAlign: "center",
        }}
      >
        {lines.map((line) => {
          const lineFrame =
            frame - Math.round((line.startMs / 1_000) * fps);
          const entrance = spring({
            frame: Math.max(0, lineFrame),
            fps,
            config: { damping: 13, mass: 0.46, stiffness: 245 },
            durationInFrames: Math.max(12, Math.round(fps * 0.58)),
          });
          const lineOpacity =
            lineFrame < 0
              ? 0
              : interpolate(
                  lineFrame,
                  [0, Math.max(1, fps * 0.12)],
                  [0, 1],
                  clamp,
                );
          return (
            <div
              key={`${line.sequence}-${line.text}`}
              style={{
                fontFamily:
                  '"DouyinSansBold", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
                fontSize: impactCaptionFontSize(width, height, line.text),
                fontWeight: 900,
                lineHeight: 1.03,
                letterSpacing: "-0.025em",
                whiteSpace: "nowrap",
                opacity: lineOpacity,
                transform: `translateY(${(1 - entrance) * 18}px) scale(${0.58 + entrance * 0.42}) rotate(${(1 - entrance) * (line.sequence % 2 === 0 ? -1.5 : 1.5)}deg)`,
                transformOrigin: "center center",
                ...impactCaptionAppearance(
                  impactCaptionTone(line.text, line.sequence),
                ),
              }}
            >
              {line.text}
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const ImpactBottomCaption = ({
  activeCue,
  frame,
  fps,
}: {
  activeCue: Scene["subtitleCues"][number];
  frame: number;
  fps: number;
}) => {
  const { width, height } = useVideoConfig();
  const cueStartFrame = Math.round((activeCue.startMs / 1_000) * fps);
  const cueFrame = Math.max(0, frame - cueStartFrame);
  const entrance = spring({
    frame: cueFrame,
    fps,
    config: { damping: 18, mass: 0.42, stiffness: 230 },
    durationInFrames: Math.max(10, Math.round(fps * 0.35)),
  });
  const baseFontSize = Math.min(56, Math.round(height * 0.052));
  const chineseFontSize = Math.max(
    30,
    Math.min(
      baseFontSize,
      Math.floor(
        (width * 0.82) /
          (Math.max(1, Array.from(activeCue.text).length) * 0.92),
      ),
    ),
  );

  return (
    <div
      style={{
        position: "absolute",
        left: "5%",
        right: "5%",
        bottom: activeCue.translation ? "4.4%" : "5.5%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: Math.round(height * 0.005),
        textAlign: "center",
        opacity: interpolate(
          cueFrame,
          [0, Math.max(1, fps * 0.08)],
          [0, 1],
          clamp,
        ),
        transform: `translateY(${(1 - entrance) * 10}px) scale(${0.96 + entrance * 0.04})`,
      }}
    >
      <div
        style={{
          maxWidth: "92%",
          color: "#FFFFFF",
          fontFamily:
            '"DouyinSansBold", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif',
          fontSize: chineseFontSize,
          fontWeight: 900,
          lineHeight: 1.05,
          letterSpacing: "0.01em",
          whiteSpace: "nowrap",
          WebkitTextStroke: `${Math.max(4, Math.round(height * 0.0055))}px #111111`,
          paintOrder: "stroke fill",
          textShadow: "0 5px 12px rgba(0,0,0,.75)",
        }}
      >
        {activeCue.text}
      </div>
      {activeCue.translation ? (
        <div
          style={{
            maxWidth: "90%",
            color: "rgba(255,255,255,.94)",
            fontFamily:
              '"HarmonyOS Sans SC Light", "Microsoft YaHei", sans-serif',
            fontSize: Math.max(22, Math.round(chineseFontSize * 0.48)),
            fontWeight: 500,
            lineHeight: 1.1,
            textShadow: "0 2px 5px rgba(0,0,0,.95)",
          }}
        >
          {activeCue.translation}
        </div>
      ) : null}
    </div>
  );
};

const SceneLayer = ({
  scene,
  subtitleStyle,
  watermark,
  videoTemplate,
  headerText,
  narrationVolume,
}: {
  scene: Scene;
  subtitleStyle: RemotionRenderInput["subtitleStyle"];
  watermark: string;
  videoTemplate: RemotionRenderInput["videoTemplate"];
  headerText: string;
  narrationVolume: number;
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
      <NarrationAudio
        scene={scene}
        fps={fps}
        narrationVolume={narrationVolume}
      />
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
          (width * 0.84) /
            (Math.max(1, Array.from(headerText).length) * 0.92 +
              Math.max(0, Array.from(headerText).length - 1) *
                KNOWLEDGE_BOARD_HEADER_LETTER_SPACING_EM),
        ),
      ),
    );
    const subtitleFontSize = subtitleStyle.fontSize;

    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#FFFFFF",
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
              letterSpacing: `${KNOWLEDGE_BOARD_HEADER_LETTER_SPACING_EM}em`,
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
          <KnowledgeBoardSceneImage
            scene={scene}
            frame={frame}
            durationInFrames={durationInFrames}
            fps={fps}
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
                display: "inline-block",
                whiteSpace: "nowrap",
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
      {videoTemplate === "IMPACT_CAPTIONS" ? (
        <ImpactCaptionOverlay
          scene={scene}
          frame={frame}
          durationInFrames={durationInFrames}
          fps={fps}
        />
      ) : null}
      {activeCue && videoTemplate === "IMPACT_CAPTIONS" ? (
        <ImpactBottomCaption activeCue={activeCue} frame={frame} fps={fps} />
      ) : activeCue ? (
        <div
          style={{
            position: "absolute",
            left: "7%",
            right: "7%",
            textAlign: "center",
            fontSize: subtitleStyle.fontSize,
            lineHeight: 1.35,
            letterSpacing: "0.02em",
            whiteSpace: "nowrap",
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

  return (
    <TransitionSeries.Transition
      key={key}
      presentation={fade()}
      timing={timing}
    />
  );
}

function hasRenderedTransition(scene: Scene): boolean {
  return scene.transition.type !== "CUT";
}

export const StickMotionVideo = (rawProps: RemotionRenderInput) => {
  const input = remotionRenderInputSchema.parse(rawProps);
  const timeline: ReactNode[] = [];
  const chromeTimeline: ReactNode[] = [];
  const knowledgeBoard = input.videoTemplate === "KNOWLEDGE_BOARD";

  input.scenes.forEach((scene, index) => {
    const sceneDurationInFrames = calculateSceneTimelineDurationInFrames(
      input.scenes,
      index,
      input.fps,
    );
    const outgoingTransition =
      index < input.scenes.length - 1 && hasRenderedTransition(scene)
        ? calculateTransitionDurationInFrames(scene, input.fps)
        : 0;
    timeline.push(
      <TransitionSeries.Sequence
        key={`scene-${index}`}
        durationInFrames={sceneDurationInFrames + outgoingTransition}
      >
        {knowledgeBoard ? (
          <KnowledgeBoardMedia
            scene={scene}
            fps={input.fps}
            narrationVolume={input.narrationVolume}
          />
        ) : (
          <SceneLayer
            scene={scene}
            subtitleStyle={input.subtitleStyle}
            watermark={input.watermark}
            videoTemplate={input.videoTemplate}
            headerText={input.headerText}
            narrationVolume={input.narrationVolume}
          />
        )}
      </TransitionSeries.Sequence>,
    );
    if (knowledgeBoard) {
      chromeTimeline.push(
        <Sequence
          key={`chrome-${index}`}
          from={calculateSceneStartFrame(input.scenes, index, input.fps)}
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
      {input.narrationFile ? (
        <Audio
          src={staticFile(input.narrationFile)}
          volume={input.narrationVolume}
        />
      ) : null}
      <TransitionSeries>{timeline}</TransitionSeries>
      {knowledgeBoard ? <>{chromeTimeline}</> : null}
    </AbsoluteFill>
  );
};
