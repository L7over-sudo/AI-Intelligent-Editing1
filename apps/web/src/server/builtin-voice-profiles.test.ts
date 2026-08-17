import { describe, expect, it } from "vitest";

import {
  builtinVoiceProfileDefinitions,
  builtinVoiceProfileMetadata,
  INDEXTTS_BUILTIN_PRESET_PREFIX,
} from "./builtin-voice-profiles";

describe("builtin voice profiles", () => {
  it("defines the official Chinese example voices", () => {
    const definitions = builtinVoiceProfileDefinitions();
    expect(definitions).toHaveLength(9);
    expect(definitions[0]).toEqual({
      name: "展示讲解女声",
      fileName: "voice_03.wav",
      objectKey: `${INDEXTTS_BUILTIN_PRESET_PREFIX}/voice_03.wav`,
    });
    for (const definition of definitions) {
      expect(definition.objectKey).toMatch(
        /^presets\/indextts2\/voice_\d{2}\.wav$/u,
      );
      expect(definition.objectKey).not.toContain("..");
    }
  });

  it("builds schema-valid builtin metadata", () => {
    const definition = builtinVoiceProfileDefinitions()[0]!;
    const metadata = builtinVoiceProfileMetadata(
      "http://127.0.0.1:7851",
      definition,
    );
    expect(metadata.builtin).toBe(true);
    expect(metadata.provider).toBe("indextts2");
    expect(metadata.originalFileName).toBe(definition.fileName);
    expect(metadata.serviceUrl).toBe("http://127.0.0.1:7851");
  });
});
