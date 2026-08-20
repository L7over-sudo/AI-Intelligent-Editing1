import { describe, expect, it } from "vitest";

import {
  builtinVoiceProfileDefinitions,
  builtinVoiceProfileMetadata,
  BUILTIN_VOICE_PRESET_PREFIX,
} from "./builtin-voice-profiles";

describe("builtin voice profiles", () => {
  it("defines the official Chinese example voices", () => {
    const definitions = builtinVoiceProfileDefinitions();
    expect(definitions).toHaveLength(14);
    expect(definitions[0]).toEqual({
      name: "展示讲解女声",
      fileName: "voice_03.wav",
      objectKey: `${BUILTIN_VOICE_PRESET_PREFIX}/voice_03.wav`,
    });
    for (const definition of definitions.slice(0, 9)) {
      expect(definition.objectKey).toMatch(
        /^presets\/voice\/voice_\d{2}\.wav$/u,
      );
      expect(definition.objectKey).not.toContain("..");
    }
    expect(
      definitions.slice(9).map((definition) => definition.speaker),
    ).toEqual(["Vivian", "Serena", "Uncle_Fu", "Dylan", "Eric"]);
  });

  it("builds schema-valid builtin metadata", () => {
    const definition = builtinVoiceProfileDefinitions()[0]!;
    const metadata = builtinVoiceProfileMetadata(
      "http://127.0.0.1:7851",
      definition,
    );
    expect(metadata.builtin).toBe(true);
    expect(metadata.provider).toBe("local-clone");
    expect(metadata.originalFileName).toBe(definition.fileName);
    expect(metadata.serviceUrl).toBe("http://127.0.0.1:7851");
  });

  it("marks Qwen custom voices with their speaker id", () => {
    const definition = builtinVoiceProfileDefinitions()[9]!;
    const metadata = builtinVoiceProfileMetadata(undefined, definition);
    expect(metadata.provider).toBe("qwen3-tts-custom");
    expect(metadata.speaker).toBe("Vivian");
    expect(metadata.builtin).toBe(true);
  });
});
