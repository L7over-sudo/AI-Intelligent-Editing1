import {
  remotionRenderInputSchema,
  type RemotionRenderInput,
} from "@stickmotion/shared";
import { Composition } from "remotion";

import { StickMotionVideo } from "./stick-motion-video";
import { calculateRemotionDurationInFrames } from "./timing";

const defaultProps: RemotionRenderInput = {
  width: 1920,
  height: 1080,
  fps: 30,
  scenes: [
    {
      imageFile: "placeholder.png",
      durationMs: 1_000,
      animation: { type: "NONE", direction: "NONE", intensity: 0 },
      transition: { type: "CUT", duration: 0 },
      subtitleCues: [],
      soundEffects: [],
    },
  ],
  backgroundMusicVolume: 0.18,
  videoTemplate: "FULL_BLEED",
  headerText: "",
  subtitleStyle: {
    fontSize: 60,
    position: "BOTTOM",
    outline: true,
    shadow: true,
    accentColor: "#FF5A3C",
  },
  watermark: "",
};

export const RemotionRoot = () => (
  <Composition
    id="StickMotionVideo"
    component={StickMotionVideo}
    durationInFrames={30}
    fps={30}
    width={1920}
    height={1080}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => {
      const input = remotionRenderInputSchema.parse(props);
      return {
        durationInFrames: calculateRemotionDurationInFrames(input),
        fps: input.fps,
        width: input.width,
        height: input.height,
        props: input,
      };
    }}
  />
);
