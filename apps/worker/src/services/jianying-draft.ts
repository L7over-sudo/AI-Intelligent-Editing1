import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { cuesToSrt, type SubtitleCueInput } from "@stickmotion/media";
import { z } from "zod";
import type { SubtitleTemplateStyle } from "./subtitle-template-library";

export type JianyingFfmpegRunner = (
  args: readonly string[],
  onProgress: (outTimeMs: number) => void,
) => Promise<void>;

export type JianyingTransitionKind =
  | "CUT"
  | "FADE"
  | "DISSOLVE"
  | "PUSH"
  | "ZOOM";

export interface JianyingDraftMediaFile {
  bytes: Uint8Array;
  fileName: string;
  durationMs: number;
}

export interface JianyingDraftScene {
  image: JianyingDraftMediaFile & { width: number; height: number };
  durationMs: number;
  transition?: { type: JianyingTransitionKind; durationMs: number };
  voice?: JianyingDraftMediaFile;
  soundEffects?: Array<
    JianyingDraftMediaFile & { offsetMs: number; gainDb: number }
  >;
}

export interface JianyingDraftBackgroundMusic extends JianyingDraftMediaFile {
  volume: number;
}

export interface JianyingSubtitleStyle {
  fontSize: number;
  primaryColor: string;
  accentColor: string;
  outline: boolean;
  outlineColor: string;
  shadow: boolean;
  position: "TOP" | "CENTER" | "BOTTOM";
  keywordHighlight: boolean;
}

export interface JianyingDraftInput {
  projectId: string;
  projectRevision: number;
  title: string;
  width: number;
  height: number;
  durationMs: number;
  video?: Uint8Array;
  scenes?: readonly JianyingDraftScene[];
  backgroundMusic?: JianyingDraftBackgroundMusic;
  subtitleCues: readonly SubtitleCueInput[];
  subtitleStyle?: JianyingSubtitleStyle;
  subtitleTemplate?: {
    id: string;
    name: string;
    category: string;
    style: SubtitleTemplateStyle;
  };
}

export interface JianyingDraftResult {
  draftId: string;
  draftPath: string;
}

export interface JianyingTimelineTransition {
  name: string;
  resourceId: string;
  durationUs: number;
}

export interface JianyingTimelineScene {
  imagePath: string;
  imageWidth: number;
  imageHeight: number;
  durationUs: number;
  transition: JianyingTimelineTransition | null;
}

export interface JianyingTimelineAudio {
  kind: "music" | "voice" | "sfx";
  name: string;
  path: string;
  durationUs: number;
  startUs: number;
  targetDurationUs: number;
  volume: number;
}

export interface JianyingTimeline {
  scenes: JianyingTimelineScene[];
  audios: JianyingTimelineAudio[];
  durationUs: number;
}

export interface JianyingDraftMaterials {
  ai_translates: unknown[];
  audio_balances: unknown[];
  audio_effects: unknown[];
  audio_fades: unknown[];
  audios: Array<Record<string, unknown>>;
  beats: unknown[];
  canvases: unknown[];
  chromas: unknown[];
  color_curves: unknown[];
  digital_humans: unknown[];
  drafts: unknown[];
  effects: unknown[];
  flowers: unknown[];
  green_screens: unknown[];
  handwrites: unknown[];
  hsl: unknown[];
  images: unknown[];
  log_color_wheels: unknown[];
  loudnesses: unknown[];
  manual_deformations: unknown[];
  masks: unknown[];
  material_animations: unknown[];
  material_colors: unknown[];
  multi_language_refs: unknown[];
  placeholders: unknown[];
  plugin_effects: unknown[];
  primary_color_wheels: unknown[];
  realtime_denoises: unknown[];
  shapes: unknown[];
  smart_crops: unknown[];
  sound_channel_mappings: unknown[];
  sound_separations: unknown[];
  speeds: unknown[];
  stickers: unknown[];
  tail_leaders: unknown[];
  text_templates: unknown[];
  texts: Array<Record<string, unknown>>;
  time_marks: unknown[];
  transitions: Array<Record<string, unknown>>;
  video_effects: unknown[];
  video_trackings: unknown[];
  videos: Array<Record<string, unknown>>;
  vocal_beautifys: unknown[];
  vocal_separations: unknown[];
}

export interface JianyingDraftTrack {
  attribute: number;
  flag: number;
  id: string;
  is_default_name: boolean;
  name: string;
  segments: Array<Record<string, unknown>>;
  type: string;
}

export interface JianyingDraftDocuments {
  content: {
    duration: number;
    id: string;
    materials: JianyingDraftMaterials;
    tracks: JianyingDraftTrack[];
  };
  meta: {
    draft_id: string;
    draft_timeline_materials_size: number;
  };
  root: {
    all_draft_store: Array<{ draft_id: string }>;
  };
}

const configuredRootSchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => path.isAbsolute(value),
    "JIANYING_DRAFTS_DIR_ABSOLUTE_REQUIRED",
  );

const transitionCatalog: Record<
  JianyingTransitionKind,
  Omit<JianyingTimelineTransition, "durationUs"> | null
> = {
  CUT: null,
  FADE: { name: "叠化", resourceId: "6724845717472416269" },
  DISSOLVE: { name: "叠化", resourceId: "6724845717472416269" },
  PUSH: { name: "滑动", resourceId: "6757982416649851399" },
  ZOOM: { name: "推近", resourceId: "6724226861666144779" },
};

const photoMaterialDurationUs = 10_800_000_000;

function id(): string {
  return randomUUID().toUpperCase();
}

function normalizePath(filePath: string): string {
  return path.resolve(filePath).replaceAll("\\", "/");
}

function safeFolderPart(value: string, maxLength = 48): string {
  const normalized = value
    .normalize("NFKC")
    .replaceAll(/[^\p{L}\p{N}_-]+/gu, "-")
    .replaceAll(/-+/gu, "-")
    .replaceAll(/^-|-$/gu, "")
    .slice(0, maxLength);
  return normalized || "video";
}

export function parseJianyingDraftsRoot(
  configured: string | undefined,
): string | null {
  if (!configured?.trim()) return null;
  return path.resolve(configuredRootSchema.parse(configured));
}

export function resolveDraftPath(root: string, folderName: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, safeFolderPart(folderName, 96));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("JIANYING_DRAFT_PATH_OUTSIDE_ROOT");
  }
  return resolved;
}

function transitionDurationUs(
  transition: { type: JianyingTransitionKind; durationMs: number } | undefined,
): number {
  if (!transition || transition.type === "CUT" || transition.durationMs <= 0) {
    return 0;
  }
  const meta = transitionCatalog[transition.type];
  if (!meta) return 0;
  return Math.max(1, Math.round(transition.durationMs * 1_000));
}

function resolveTransition(
  transition: { type: JianyingTransitionKind; durationMs: number } | undefined,
  durationUs: number,
): JianyingTimelineTransition | null {
  if (!transition || durationUs <= 0) return null;
  const meta = transitionCatalog[transition.type];
  if (!meta) return null;
  return { ...meta, durationUs };
}

export interface JianyingTimelineSceneInput {
  imageFileName: string;
  imageWidth: number;
  imageHeight: number;
  durationMs: number;
  transition?: { type: JianyingTransitionKind; durationMs: number };
  voice?: { fileName: string; durationMs: number };
  soundEffects?: Array<{
    fileName: string;
    durationMs: number;
    offsetMs: number;
    gainDb: number;
  }>;
}

export interface JianyingTimelineMusicInput {
  fileName: string;
  durationMs: number;
  volume: number;
}

export function buildJianyingTimeline(
  materialsPath: string,
  scenes: readonly JianyingTimelineSceneInput[],
  backgroundMusic?: JianyingTimelineMusicInput,
): JianyingTimeline {
  const normalizedMaterialsPath = normalizePath(materialsPath);
  const timelineScenes: JianyingTimelineScene[] = [];
  const timelineAudios: JianyingTimelineAudio[] = [];
  let cursorUs = 0;

  for (const [index, scene] of scenes.entries()) {
    const durationUs = Math.max(1, Math.round(scene.durationMs * 1_000));
    const isLast = index === scenes.length - 1;
    const followingTransitionUs = isLast
      ? 0
      : transitionDurationUs(scene.transition);
    const transition = resolveTransition(
      scene.transition,
      followingTransitionUs,
    );
    timelineScenes.push({
      imagePath: `${normalizedMaterialsPath}/${scene.imageFileName}`,
      imageWidth: scene.imageWidth,
      imageHeight: scene.imageHeight,
      durationUs: durationUs + followingTransitionUs,
      transition,
    });

    if (scene.voice) {
      const voiceDurationUs = Math.max(
        1,
        Math.round(scene.voice.durationMs * 1_000),
      );
      timelineAudios.push({
        kind: "voice",
        name: scene.voice.fileName,
        path: `${normalizedMaterialsPath}/${scene.voice.fileName}`,
        durationUs: voiceDurationUs,
        startUs: cursorUs,
        targetDurationUs: Math.min(voiceDurationUs, durationUs),
        volume: 1,
      });
    }

    for (const soundEffect of scene.soundEffects ?? []) {
      const effectDurationUs = Math.max(
        1,
        Math.round(soundEffect.durationMs * 1_000),
      );
      const offsetUs = Math.max(
        0,
        Math.round(soundEffect.offsetMs * 1_000),
      );
      const startUs = cursorUs + offsetUs;
      const remainingUs = Math.max(0, durationUs - offsetUs);
      const targetDurationUs = Math.min(effectDurationUs, remainingUs);
      if (targetDurationUs <= 0) continue;
      timelineAudios.push({
        kind: "sfx",
        name: soundEffect.fileName,
        path: `${normalizedMaterialsPath}/${soundEffect.fileName}`,
        durationUs: effectDurationUs,
        startUs,
        targetDurationUs,
        volume: Math.min(2, Math.max(0, 10 ** (soundEffect.gainDb / 20))),
      });
    }

    cursorUs += durationUs;
  }

  if (backgroundMusic) {
    const musicDurationUs = Math.max(
      1,
      Math.round(backgroundMusic.durationMs * 1_000),
    );
    let musicStartUs = 0;
    while (musicStartUs < cursorUs) {
      const pieceDurationUs = Math.min(musicDurationUs, cursorUs - musicStartUs);
      timelineAudios.push({
        kind: "music",
        name: backgroundMusic.fileName,
        path: `${normalizedMaterialsPath}/${backgroundMusic.fileName}`,
        durationUs: musicDurationUs,
        startUs: musicStartUs,
        targetDurationUs: pieceDurationUs,
        volume: Math.min(1, Math.max(0, backgroundMusic.volume)),
      });
      musicStartUs += musicDurationUs;
    }
  }

  return {
    scenes: timelineScenes,
    audios: timelineAudios,
    durationUs: cursorUs,
  };
}

function photoMaterial(input: {
  id: string;
  path: string;
  materialName: string;
  width: number;
  height: number;
}): Record<string, unknown> {
  return {
    audio_fade: null,
    cartoon_path: "",
    category_id: "",
    category_name: "local",
    check_flag: 63487,
    crop: {
      lower_left_x: 0,
      lower_left_y: 1,
      lower_right_x: 1,
      lower_right_y: 1,
      upper_left_x: 0,
      upper_left_y: 0,
      upper_right_x: 1,
      upper_right_y: 0,
    },
    crop_ratio: "free",
    crop_scale: 1,
    duration: photoMaterialDurationUs,
    extra_type_option: 0,
    formula_id: "",
    freeze: null,
    gameplay: null,
    has_audio: false,
    height: input.height,
    id: input.id,
    intensifies_audio: false,
    intensifies_path: "",
    is_ai_generate_content: false,
    is_unified_beauty_mode: false,
    local_material_id: "",
    material_id: "",
    material_name: input.materialName,
    media_path: "",
    object_locked: null,
    origin_material_id: "",
    path: input.path,
    picture_from: "none",
    picture_set_category_id: "",
    picture_set_category_name: "",
    request_id: "",
    reverse_intensifies_path: "",
    reverse_path: "",
    smart_motion: null,
    source: 0,
    source_platform: 0,
    stable: null,
    team_id: "",
    type: "photo",
    video_algorithm: {
      algorithms: [],
      deflicker: null,
      noise_reduction: null,
      path: "",
      quality_enhance: null,
      time_range: null,
    },
    width: input.width,
  };
}

function audioMaterial(input: {
  id: string;
  path: string;
  name: string;
  durationUs: number;
}): Record<string, unknown> {
  return {
    app_id: 0,
    category_id: "",
    category_name: "local",
    check_flag: 3,
    copyright_limit_type: "none",
    duration: input.durationUs,
    effect_id: "",
    formula_id: "",
    id: input.id,
    intensifies_path: "",
    is_ai_clone_tone: false,
    is_text_edit_overdub: false,
    is_ugc: false,
    local_material_id: input.id,
    music_id: input.id,
    name: input.name,
    path: input.path,
    query: "",
    request_id: "",
    resource_id: "",
    search_id: "",
    source_from: "",
    source_platform: 0,
    team_id: "",
    text_id: "",
    tone_category_id: "",
    tone_category_name: "",
    tone_effect_id: "",
    tone_effect_name: "",
    tone_platform: "",
    tone_second_category_id: "",
    tone_second_category_name: "",
    tone_speaker: "",
    tone_type: "",
    type: "extract_music",
    video_id: "",
    wave_points: [],
  };
}

function transitionMaterial(input: {
  id: string;
  transition: JianyingTimelineTransition;
}): Record<string, unknown> {
  return {
    category_id: "",
    category_name: "",
    duration: input.transition.durationUs,
    effect_id: input.transition.resourceId,
    id: input.id,
    is_overlap: true,
    name: input.transition.name,
    platform: "all",
    resource_id: input.transition.resourceId,
    type: "transition",
  };
}

function videoSegment(input: {
  id: string;
  materialId: string;
  durationUs: number;
  startUs: number;
  transitionId?: string;
}): Record<string, unknown> {
  return {
    cartoon: false,
    clip: {
      alpha: 1,
      flip: { horizontal: false, vertical: false },
      rotation: 0,
      scale: { x: 1, y: 1 },
      transform: { x: 0, y: 0 },
    },
    common_keyframes: [],
    enable_adjust: true,
    enable_color_curves: true,
    enable_color_wheels: true,
    enable_lut: true,
    enable_smart_color_adjust: true,
    extra_material_refs: input.transitionId ? [input.transitionId] : [],
    group_id: "",
    hdr_settings: { intensity: 1, mode: 1, nits: 1_000 },
    id: input.id,
    intensifies_audio: false,
    is_placeholder: false,
    is_tone_modify: false,
    keyframe_refs: [],
    last_nonzero_volume: 1,
    material_id: input.materialId,
    render_index: 0,
    reverse: false,
    source_timerange: { duration: input.durationUs, start: 0 },
    speed: 1,
    target_timerange: { duration: input.durationUs, start: input.startUs },
    template_id: "",
    template_scene: "default",
    track_attribute: 0,
    track_render_index: 0,
    uniform_scale: { on: true, value: 1 },
    visible: true,
    volume: 1,
  };
}

function audioSegment(input: {
  id: string;
  materialId: string;
  durationUs: number;
  startUs: number;
  volume: number;
}): Record<string, unknown> {
  return {
    cartoon: false,
    clip: null,
    common_keyframes: [],
    enable_adjust: false,
    enable_color_curves: true,
    enable_color_match_adjust: false,
    enable_color_wheels: true,
    enable_lut: false,
    enable_smart_color_adjust: false,
    extra_material_refs: [],
    group_id: "",
    hdr_settings: null,
    id: input.id,
    intensifies_audio: false,
    is_placeholder: false,
    is_tone_modify: false,
    keyframe_refs: [],
    last_nonzero_volume: 1,
    material_id: input.materialId,
    render_index: 0,
    reverse: false,
    source_timerange: { duration: input.durationUs, start: 0 },
    speed: 1,
    target_timerange: { duration: input.durationUs, start: input.startUs },
    template_id: "",
    template_scene: "default",
    track_attribute: 0,
    track_render_index: 0,
    uniform_scale: null,
    visible: true,
    volume: input.volume,
  };
}

function hexToRgb01(hex: string): [number, number, number] {
  const normalized = hex.replace(/^#/u, "");
  const value = Number.parseInt(normalized, 16);
  if (!Number.isFinite(value) || normalized.length !== 6) return [1, 1, 1];
  return [
    Math.round(((value >> 16) & 0xff) / 255 * 1_000) / 1_000,
    Math.round(((value >> 8) & 0xff) / 255 * 1_000) / 1_000,
    Math.round((value & 0xff) / 255 * 1_000) / 1_000,
  ];
}

function solidFill(color: [number, number, number]): Record<string, unknown> {
  return {
    alpha: 1,
    content: {
      render_type: "solid",
      solid: { alpha: 1, color },
    },
  };
}

function buildSubtitleContent(input: {
  text: string;
  highlighted: readonly string[];
  primaryColor: string;
  accentColor: string;
  outline: boolean;
  outlineColor: string;
}): string {
  const primary = hexToRgb01(input.primaryColor);
  const accent = hexToRgb01(input.accentColor);
  const colors: Array<[number, number, number]> = Array.from(
    { length: input.text.length },
    () => primary,
  );

  const words = [...input.highlighted]
    .filter((word) => word.length > 0)
    .sort((a, b) => b.length - a.length);
  for (const word of words) {
    let index = input.text.indexOf(word);
    while (index >= 0) {
      for (let offset = 0; offset < word.length; offset += 1) {
        colors[index + offset] = accent;
      }
      index = input.text.indexOf(word, index + word.length);
    }
  }

  const runs: Array<{
    start: number;
    end: number;
    color: [number, number, number];
  }> = [];
  for (let index = 0; index < input.text.length; index += 1) {
    const color = colors[index] ?? primary;
    const last = runs[runs.length - 1];
    if (last && last.color === color) {
      last.end = index + 1;
    } else {
      runs.push({ start: index, end: index + 1, color });
    }
  }

  const styles = runs.map((run) => ({
    size: 5,
    fill: solidFill(run.color),
    font: { id: "", path: "" },
    strokes: input.outline
      ? [
          {
            width: 0.06,
            alpha: 1,
            content: {
              render_type: "solid",
              solid: { alpha: 1, color: hexToRgb01(input.outlineColor) },
            },
          },
        ]
      : [],
    range: [run.start, run.end],
  }));
  return JSON.stringify({
    text: input.text,
    styles: styles.length > 0 ? styles : [{ size: 5, fill: solidFill(primary), font: { id: "", path: "" }, strokes: [], range: [0, input.text.length] }],
  });
}

function subtitleMaterial(input: {
  id: string;
  text: string;
  highlighted: readonly string[];
  style: JianyingSubtitleStyle;
}): Record<string, unknown> {
  const fontSize = Math.max(8, Math.min(200, Math.round(input.style.fontSize)));
  const content = buildSubtitleContent({
    text: input.text,
    highlighted: input.highlighted,
    primaryColor: input.style.primaryColor,
    accentColor: input.style.accentColor,
    outline: input.style.outline,
    outlineColor: input.style.outlineColor,
  });
  return {
    recognize_task_id: "",
    id: input.id,
    name: "",
    type: "subtitle",
    content,
    base_content: "",
    global_alpha: 1,
    background_color: "",
    background_alpha: 1,
    background_style: 0,
    layer_weight: 0,
    letter_spacing: 0,
    line_spacing: 0.2,
    has_shadow: input.style.shadow,
    shadow_color: "#000000cc",
    shadow_alpha: 0.8,
    shadow_smoothing: 1,
    shadow_distance: 8,
    shadow_angle: -45,
    border_alpha: input.style.outline ? 1 : 0,
    border_color: input.style.outlineColor,
    border_width: 0.06,
    style_name: "",
    text_color: input.style.primaryColor,
    text_alpha: 1,
    font_name: "",
    font_title: "none",
    font_size: 5,
    font_path: "",
    font_id: "",
    font_resource_id: "",
    initial_scale: 1,
    font_url: "",
    typesetting: 0,
    alignment: 1,
    line_feed: 1,
    use_effect_default_color: true,
    is_rich_text: false,
    shape_clip_x: false,
    shape_clip_y: false,
    ktv_color: "",
    bold_width: 0,
    italic_degree: 0,
    underline: false,
    underline_width: 0.05,
    underline_offset: 0.22,
    sub_type: 0,
    check_flag: 15,
    text_size: fontSize,
    font_category_name: "",
    font_source_platform: 0,
    font_third_resource_id: "",
    font_category_id: "",
    add_type: 3,
    recognize_type: 0,
    background_round_radius: 0.4,
    background_width: 0.1,
    background_height: 0.1,
    background_vertical_offset: 0,
    background_horizontal_offset: 0,
    background_fill: "",
    font_team_id: "",
    tts_auto_update: false,
    text_preset_resource_id: "",
    group_id: "",
    preset_id: "",
    preset_name: "",
    preset_category: "",
    preset_category_id: "",
    preset_index: 0,
    preset_has_set_alignment: false,
    force_apply_line_max_width: false,
    language: "",
    fixed_width: -1,
    fixed_height: -1,
    line_max_width: 0.82,
    oneline_cutoff: false,
    cutoff_postfix: "",
    subtitle_template_original_fontsize: 0,
    inner_padding: -1,
    multi_language_current: "none",
    source_from: "",
    is_lyric_effect: false,
    lyric_group_id: "",
    is_words_linear: false,
    ssml_content: "",
    is_blank_text: false,
    text: input.text,
    fonts: [],
    relevance_segment: [],
    original_size: [],
  };
}

function textSegment(input: {
  id: string;
  materialId: string;
  startUs: number;
  durationUs: number;
  renderIndex: number;
  position: "TOP" | "CENTER" | "BOTTOM";
  transform?: { x: number; y: number };
}): Record<string, unknown> {
  const transformY = input.transform
    ? input.transform.y
    : input.position === "TOP"
      ? 0.8
      : input.position === "CENTER"
        ? 0
        : -0.8;
  const transformX = input.transform?.x ?? 0;
  return {
    id: input.id,
    desc: "",
    state: 0,
    speed: 1,
    is_loop: false,
    is_tone_modify: false,
    reverse: false,
    intensifies_audio: false,
    cartoon: false,
    volume: 1,
    last_nonzero_volume: 1,
    material_id: input.materialId,
    render_index: 14_000 + input.renderIndex,
    enable_lut: false,
    enable_adjust: false,
    enable_hsl: false,
    visible: true,
    group_id: "",
    enable_color_curves: true,
    track_render_index: 0,
    enable_color_wheels: true,
    track_attribute: 0,
    is_placeholder: false,
    template_id: "",
    enable_smart_color_adjust: false,
    template_scene: "default",
    enable_color_match_adjust: false,
    enable_color_correct_adjust: false,
    enable_adjust_mask: false,
    raw_segment_id: "",
    enable_video_mask: true,
    offset: 0,
    source_timerange: null,
    target_timerange: { start: input.startUs, duration: input.durationUs },
    render_timerange: { start: 0, duration: 0 },
    clip: {
      rotation: 0,
      alpha: 1,
      scale: { x: 1, y: 1 },
      transform: { x: transformX, y: transformY },
      flip: { vertical: false, horizontal: false },
    },
    uniform_scale: { on: true, value: 1 },
    hdr_settings: null,
    caption_info: null,
    responsive_layout: {
      enable: false,
      target_follow: "",
      size_layout: 0,
      horizontal_pos_layout: 0,
      vertical_pos_layout: 0,
    },
    lyric_keyframes: null,
    extra_material_refs: [],
    keyframe_refs: [],
    common_keyframes: [],
  };
}

export function buildJianyingDraftDocuments(input: {
  draftId: string;
  draftPath: string;
  videoPath?: string;
  coverPath: string;
  title: string;
  width: number;
  height: number;
  durationUs: number;
  videoBytes?: number;
  timeline?: JianyingTimeline;
  timelineMaterialsBytes?: number;
  subtitleCues?: readonly SubtitleCueInput[];
  subtitleStyle?: JianyingSubtitleStyle;
  now: Date;
}): JianyingDraftDocuments {
  const videoMaterialId = id();
  const trackId = id();
  const segmentId = id();
  const nowSeconds = Math.floor(input.now.getTime() / 1_000);
  const nowMicroseconds = input.now.getTime() * 1_000;
  const draftPath = normalizePath(input.draftPath);
  const videoPath = input.videoPath ? normalizePath(input.videoPath) : "";
  const coverPath = normalizePath(input.coverPath);
  const contentPath = normalizePath(
    path.join(input.draftPath, "draft_content.json"),
  );

  const materials: JianyingDraftMaterials = {
    ai_translates: [],
    audio_balances: [],
    audio_effects: [],
    audio_fades: [],
    audios: [],
    beats: [],
    canvases: [],
    chromas: [],
    color_curves: [],
    digital_humans: [],
    drafts: [],
    effects: [],
    flowers: [],
    green_screens: [],
    handwrites: [],
    hsl: [],
    images: [],
    log_color_wheels: [],
    loudnesses: [],
    manual_deformations: [],
    masks: [],
    material_animations: [],
    material_colors: [],
    multi_language_refs: [],
    placeholders: [],
    plugin_effects: [],
    primary_color_wheels: [],
    realtime_denoises: [],
    shapes: [],
    smart_crops: [],
    sound_channel_mappings: [],
    sound_separations: [],
    speeds: [],
    stickers: [],
    tail_leaders: [],
    text_templates: [],
    texts: [],
    time_marks: [],
    transitions: [],
    video_effects: [],
    video_trackings: [],
    videos: [],
    vocal_beautifys: [],
    vocal_separations: [],
  };

  const tracks: JianyingDraftTrack[] = [];
  let timelineMaterialsBytes = input.timelineMaterialsBytes ?? 0;

  if (input.timeline && input.timeline.scenes.length > 0) {
    const timeline = input.timeline;
    const audioMaterialIds = new Map<string, string>();
    const videoSegments: Array<Record<string, unknown>> = [];
    let contentCursorUs = 0;

    for (const scene of timeline.scenes) {
      const photoId = id();
      materials.videos.push(
        photoMaterial({
          id: photoId,
          path: scene.imagePath,
          materialName: path.basename(scene.imagePath),
          width: scene.imageWidth,
          height: scene.imageHeight,
        }),
      );
      let transitionId: string | undefined;
      if (scene.transition) {
        transitionId = id();
        materials.transitions.push(
          transitionMaterial({ id: transitionId, transition: scene.transition }),
        );
      }
      videoSegments.push(
        videoSegment({
          id: id(),
          materialId: photoId,
          durationUs: scene.durationUs,
          startUs: contentCursorUs,
          ...(transitionId ? { transitionId } : {}),
        }),
      );
      contentCursorUs +=
        scene.durationUs - (scene.transition?.durationUs ?? 0);
    }
    tracks.push({
      attribute: 0,
      flag: 0,
      id: trackId,
      is_default_name: true,
      name: "",
      segments: videoSegments,
      type: "video",
    });

    if (input.subtitleCues && input.subtitleStyle) {
      const subtitleSegments: Array<Record<string, unknown>> = [];
      for (const [index, cue] of input.subtitleCues.entries()) {
        const startUs = Math.max(0, Math.round(cue.startMs * 1_000));
        const durationUs = Math.max(
          1,
          Math.round((cue.endMs - cue.startMs) * 1_000),
        );
        if (durationUs <= 0) continue;
        const materialId = id();
        materials.texts.push(
          subtitleMaterial({
            id: materialId,
            text: cue.text,
            highlighted: cue.highlighted ?? [],
            style: input.subtitleStyle,
          }),
        );
        subtitleSegments.push(
          textSegment({
            id: id(),
            materialId,
            startUs,
            durationUs,
            renderIndex: index,
            position: input.subtitleStyle.position,
          }),
        );
      }
      if (subtitleSegments.length > 0) {
        tracks.push({
          attribute: 0,
          flag: 0,
          id: id(),
          is_default_name: false,
          name: "字幕",
          segments: subtitleSegments,
          type: "text",
        });
      }
    }

    const audioByKind: Record<
      "music" | "voice" | "sfx",
      Array<Record<string, unknown>>
    > = {
      music: [],
      voice: [],
      sfx: [],
    };
    for (const audio of timeline.audios) {
      let materialId = audioMaterialIds.get(audio.path);
      if (!materialId) {
        materialId = id();
        audioMaterialIds.set(audio.path, materialId);
        materials.audios.push(
          audioMaterial({
            id: materialId,
            path: audio.path,
            name: audio.name,
            durationUs: audio.durationUs,
          }),
        );
      }
      audioByKind[audio.kind].push(
        audioSegment({
          id: id(),
          materialId,
          durationUs: audio.targetDurationUs,
          startUs: audio.startUs,
          volume: audio.volume,
        }),
      );
    }
    const audioTrackNames: Array<{
      kind: "music" | "voice" | "sfx";
      name: string;
    }> = [
      { kind: "music", name: "音乐" },
      { kind: "voice", name: "配音" },
      { kind: "sfx", name: "音效" },
    ];
    for (const { kind, name } of audioTrackNames) {
      const clips = audioByKind[kind];
      if (clips.length === 0) continue;
      tracks.push({
        attribute: 0,
        flag: 0,
        id: id(),
        is_default_name: false,
        name,
        segments: clips,
        type: "audio",
      });
    }
  } else {
    materials.videos.push({
      audio_fade: null,
      cartoon_path: "",
      category_id: "",
      category_name: "local",
      check_flag: 63487,
      crop: {
        lower_left_x: 0,
        lower_left_y: 1,
        lower_right_x: 1,
        lower_right_y: 1,
        upper_left_x: 0,
        upper_left_y: 0,
        upper_right_x: 1,
        upper_right_y: 0,
      },
      crop_ratio: "free",
      crop_scale: 1,
      duration: input.durationUs,
      extra_type_option: 0,
      formula_id: "",
      freeze: null,
      gameplay: null,
      has_audio: true,
      height: input.height,
      id: videoMaterialId,
      intensifies_audio: false,
      intensifies_path: "",
      is_ai_generate_content: false,
      is_unified_beauty_mode: false,
      local_material_id: "",
      material_id: "",
      material_name: "remix.mp4",
      media_path: "",
      object_locked: null,
      origin_material_id: "",
      path: videoPath,
      picture_from: "none",
      picture_set_category_id: "",
      picture_set_category_name: "",
      request_id: "",
      reverse_intensifies_path: "",
      reverse_path: "",
      smart_motion: null,
      source: 0,
      source_platform: 0,
      stable: null,
      team_id: "",
      type: "video",
      video_algorithm: {
        algorithms: [],
        deflicker: null,
        noise_reduction: null,
        path: "",
        quality_enhance: null,
        time_range: null,
      },
      width: input.width,
    });
    tracks.push({
      attribute: 0,
      flag: 0,
      id: trackId,
      is_default_name: true,
      name: "",
      segments: [
        videoSegment({
          id: segmentId,
          materialId: videoMaterialId,
          durationUs: input.durationUs,
          startUs: 0,
        }),
      ],
      type: "video",
    });
    timelineMaterialsBytes = input.videoBytes ?? 0;
  }

  const content = {
    canvas_config: {
      height: input.height,
      ratio: "original",
      width: input.width,
    },
    color_space: 0,
    config: {
      adjust_max_index: 1,
      attachment_info: [],
      combination_max_index: 1,
      export_range: null,
      extract_audio_last_index: 1,
      lyrics_recognition_id: "",
      lyrics_sync: true,
      lyrics_taskinfo: [],
      maintrack_adsorb: true,
      material_save_mode: 0,
      original_sound_last_index: 1,
      record_audio_last_index: 1,
      sticker_max_index: 1,
      subtitle_recognition_id: "",
      subtitle_sync: true,
      subtitle_taskinfo: [],
      system_font_list: [],
      video_mute: false,
    },
    cover: null,
    create_time: nowSeconds,
    duration: input.durationUs,
    extra_info: null,
    fps: 30,
    free_render_index_mode_on: false,
    group_container: null,
    id: input.draftId,
    keyframe_graph_list: [],
    keyframes: {},
    last_modified_platform: {
      app_id: 3704,
      app_source: "lv",
      app_version: "5.9.0",
      device_id: "",
      hard_disk_id: "",
      mac_address: "",
      os: "windows",
      os_version: "10",
    },
    materials,
    mutable_config: null,
    name: input.title,
    new_version: "5.9.0",
    platform: {
      app_id: 3704,
      app_source: "lv",
      app_version: "5.9.0",
      device_id: "",
      hard_disk_id: "",
      mac_address: "",
      os: "windows",
      os_version: "10",
    },
    relationships: [],
    render_index_track_mode_on: false,
    retouch_cover: null,
    source: "default",
    static_cover_image_path: coverPath,
    time_marks: null,
    tracks,
    update_time: nowSeconds,
    version: 360_000,
  };

  const meta = {
    cloud_draft_cover: "",
    cloud_draft_sync: false,
    cloud_package_completed_time: "",
    draft_cloud_capcut_purchase_info: "",
    draft_cloud_last_action_download: false,
    draft_cloud_package_type: "",
    draft_cloud_purchase_info: "",
    draft_cloud_template_id: "",
    draft_cloud_tutorial_info: "",
    draft_cloud_videocut_purchase_info: "",
    draft_cover: coverPath,
    draft_deeplink_url: "",
    draft_enterprise_info: {
      draft_enterprise_extra: "",
      draft_enterprise_id: "",
      draft_enterprise_name: "",
    },
    draft_fold_path: draftPath,
    draft_id: input.draftId,
    draft_is_ai_shorts: false,
    draft_is_invisible: false,
    draft_json_file: contentPath,
    draft_name: input.title,
    draft_new_version: "5.9.0",
    draft_removable_storage_device: "",
    draft_root_path: draftPath,
    draft_segment_extra_info: [],
    draft_timeline_materials_size: timelineMaterialsBytes,
    draft_type: "",
    streaming_edit_draft_ready: true,
    tm_draft_cloud_completed: "",
    tm_draft_cloud_modified: 0,
    tm_draft_create: nowMicroseconds,
    tm_draft_modified: nowMicroseconds,
    tm_duration: input.durationUs,
  };

  return {
    content,
    meta,
    root: {
      all_draft_store: [meta],
      draft_ids: 1,
      root_path: draftPath,
    },
  } as JianyingDraftDocuments;
}

const persistedMetaSchema = z.looseObject({ draft_id: z.string().min(1) });
const persistedContentSchema = z.looseObject({ id: z.string().min(1) });
const persistedRootSchema = z.looseObject({
  all_draft_store: z
    .array(z.looseObject({ draft_id: z.string().min(1) }))
    .min(1),
});

async function reconcileDraftId(
  draftPath: string,
  generatedDraftId: string,
): Promise<string> {
  await delay(1_000);
  try {
    const meta = persistedMetaSchema.parse(
      JSON.parse(
        await readFile(path.join(draftPath, "draft_meta_info.json"), "utf8"),
      ) as unknown,
    );
    if (meta.draft_id === generatedDraftId) return generatedDraftId;

    const contentPath = path.join(draftPath, "draft_content.json");
    const rootPath = path.join(draftPath, "root_meta_info.json");
    const content = persistedContentSchema.parse(
      JSON.parse(await readFile(contentPath, "utf8")) as unknown,
    );
    const root = persistedRootSchema.parse(
      JSON.parse(await readFile(rootPath, "utf8")) as unknown,
    );
    content.id = meta.draft_id;
    root.all_draft_store[0]!.draft_id = meta.draft_id;
    await Promise.all([
      writeFile(contentPath, `${JSON.stringify(content, null, 2)}\n`, "utf8"),
      writeFile(rootPath, `${JSON.stringify(root, null, 2)}\n`, "utf8"),
    ]);
    return meta.draft_id;
  } catch {
    return generatedDraftId;
  }
}

function safeMaterialFileName(fileName: string, kind: string): string {
  const normalized = path
    .basename(fileName)
    .replaceAll(/[^a-zA-Z0-9._-]/gu, "-");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    !/^[a-zA-Z0-9._-]{1,160}$/u.test(normalized)
  ) {
    throw new Error(`JIANYING_DRAFT_MATERIAL_FILENAME_INVALID:${kind}`);
  }
  return normalized;
}

export async function createJianyingDraft(
  input: JianyingDraftInput,
  ffmpegRunner: JianyingFfmpegRunner,
  configuredRoot = process.env.JIANYING_DRAFTS_DIR,
): Promise<JianyingDraftResult | null> {
  const root = parseJianyingDraftsRoot(configuredRoot);
  if (!root) return null;

  const now = new Date();
  const draftId = id();
  const timestamp = now
    .toISOString()
    .replaceAll(/[-:TZ.]/gu, "")
    .slice(0, 14);
  const folderName = `StickMotion-${safeFolderPart(input.title)}-${timestamp}-${draftId.slice(0, 8)}`;
  const draftPath = resolveDraftPath(root, folderName);
  const materialsPath = path.join(draftPath, "materials");
  const coverPath = path.join(draftPath, "draft_cover.jpg");
  const durationUs = Math.max(1, Math.round(input.durationMs * 1_000));

  await mkdir(materialsPath, { recursive: true });
  await writeFile(
    path.join(draftPath, "captions.srt"),
    cuesToSrt(input.subtitleCues),
    "utf8",
  );

  let timeline: JianyingTimeline | undefined;
  let timelineMaterialsBytes = 0;
  let coverSourcePath: string | undefined;

  if (input.scenes && input.scenes.length > 0) {
    const timelineInput: Array<{
      imageFileName: string;
      imageWidth: number;
      imageHeight: number;
      durationMs: number;
      transition?: { type: JianyingTransitionKind; durationMs: number };
      voice?: { fileName: string; durationMs: number };
      soundEffects?: Array<{
        fileName: string;
        durationMs: number;
        offsetMs: number;
        gainDb: number;
      }>;
    }> = [];
    for (const [index, scene] of input.scenes.entries()) {
      const imageFileName = safeMaterialFileName(scene.image.fileName, "image");
      const imagePath = path.join(materialsPath, imageFileName);
      await writeFile(imagePath, scene.image.bytes);
      timelineMaterialsBytes += scene.image.bytes.byteLength;
      if (index === 0) coverSourcePath = imagePath;

      const voiceFileName = scene.voice
        ? safeMaterialFileName(scene.voice.fileName, "voice")
        : undefined;
      if (scene.voice && voiceFileName) {
        await writeFile(path.join(materialsPath, voiceFileName), scene.voice.bytes);
        timelineMaterialsBytes += scene.voice.bytes.byteLength;
      }

      const soundEffects: Array<{
        fileName: string;
        durationMs: number;
        offsetMs: number;
        gainDb: number;
      }> = [];
      for (const soundEffect of scene.soundEffects ?? []) {
        const soundFileName = safeMaterialFileName(
          soundEffect.fileName,
          "sfx",
        );
        await writeFile(path.join(materialsPath, soundFileName), soundEffect.bytes);
        timelineMaterialsBytes += soundEffect.bytes.byteLength;
        soundEffects.push({
          fileName: soundFileName,
          durationMs: soundEffect.durationMs,
          offsetMs: soundEffect.offsetMs,
          gainDb: soundEffect.gainDb,
        });
      }

      timelineInput.push({
        imageFileName,
        imageWidth: scene.image.width,
        imageHeight: scene.image.height,
        durationMs: scene.durationMs,
        ...(scene.transition ? { transition: scene.transition } : {}),
        ...(scene.voice && voiceFileName
          ? {
              voice: {
                fileName: voiceFileName,
                durationMs: scene.voice.durationMs,
              },
            }
          : {}),
        ...(soundEffects.length > 0 ? { soundEffects } : {}),
      });
    }

    const backgroundMusic = input.backgroundMusic
      ? {
          fileName: safeMaterialFileName(
            input.backgroundMusic.fileName,
            "music",
          ),
          durationMs: input.backgroundMusic.durationMs,
          volume: input.backgroundMusic.volume,
        }
      : undefined;
    if (input.backgroundMusic && backgroundMusic) {
      const musicPath = path.join(materialsPath, backgroundMusic.fileName);
      await writeFile(musicPath, input.backgroundMusic.bytes);
      timelineMaterialsBytes += input.backgroundMusic.bytes.byteLength;
    }
    timeline = buildJianyingTimeline(
      materialsPath,
      timelineInput,
      backgroundMusic,
    );
  } else if (input.video) {
    const videoPath = path.join(materialsPath, "remix.mp4");
    await writeFile(videoPath, input.video);
    coverSourcePath = videoPath;
  }

  if (!coverSourcePath) throw new Error("JIANYING_DRAFT_MEDIA_REQUIRED");
  await ffmpegRunner(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      "0",
      "-i",
      coverSourcePath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      coverPath,
    ],
    () => undefined,
  );

  const remixPath = path.join(materialsPath, "remix.mp4");
  const hasRemix = input.video && !timeline;
  const documents = buildJianyingDraftDocuments({
    draftId,
    draftPath,
    ...(hasRemix
      ? {
          videoPath: remixPath,
          videoBytes: (await stat(remixPath)).size,
        }
      : {}),
    coverPath,
    title: `StickMotion-${input.title}`,
    width: input.width,
    height: input.height,
    durationUs: timeline?.durationUs ?? durationUs,
    ...(timeline ? { timeline } : {}),
    timelineMaterialsBytes,
    subtitleCues: input.subtitleCues,
    ...(input.subtitleStyle ? { subtitleStyle: input.subtitleStyle } : {}),
    now,
  });
  await Promise.all([
    writeFile(
      path.join(draftPath, "draft_content.json"),
      `${JSON.stringify(documents.content, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(draftPath, "draft_meta_info.json"),
      `${JSON.stringify(documents.meta, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(draftPath, "root_meta_info.json"),
      `${JSON.stringify(documents.root, null, 2)}\n`,
      "utf8",
    ),
    writeFile(
      path.join(draftPath, "README.txt"),
      [
        "StickMotion 自动生成的剪映草稿",
        "",
        timeline
          ? [
              "时间线上已按素材拆分：",
              "- 主视频轨道：每张场景图片，片段间按场景配置挂载转场（叠化/滑动/推近）",
              "- 配音轨：每段旁白配音，与对应图片对齐",
              "- 音效轨：每个音效片段（含增益和场景内偏移）",
              "- 音乐轨：背景音乐，短于成片时自动循环拼接",
              "- 字幕轨：每句字幕文本（可编辑，样式跟随字幕模板）",
            ].join("\r\n")
          : "remix.mp4 已包含旁白、字幕、音效、转场和特效。",
        "captions.srt 可在剪映中作为可编辑字幕单独导入。",
        input.subtitleTemplate
          ? `字幕模板：${input.subtitleTemplate.name}（样式已渲染进视频；剪映专属动画资源需在剪映内重新下载）`
          : "字幕模板：系统清晰字幕",
        `项目：${input.projectId}`,
        `版本：${input.projectRevision}`,
        `草稿 ID：${draftId}`,
      ].join("\r\n"),
      "utf8",
    ),
    ...(input.subtitleTemplate
      ? [
          writeFile(
            path.join(draftPath, "subtitle_template.json"),
            `${JSON.stringify(
              {
                version: 1,
                source: "user-local-library",
                ...input.subtitleTemplate,
              },
              null,
              2,
            )}\n`,
            "utf8",
          ),
        ]
      : []),
  ]);

  const persistedDraftId = await reconcileDraftId(draftPath, draftId);
  return { draftId: persistedDraftId, draftPath };
}
