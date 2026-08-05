import { fileURLToPath } from "node:url";

export function getRemotionEntryPoint(): string {
  return fileURLToPath(new URL("./entry.tsx", import.meta.url));
}

export {
  calculateRemotionDurationInFrames,
  calculateSceneDurationInFrames,
  calculateTransitionDurationInFrames,
} from "./timing";
