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

export interface JianyingDraftInput {
  projectId: string;
  projectRevision: number;
  title: string;
  width: number;
  height: number;
  durationMs: number;
  video: Uint8Array;
  subtitleCues: readonly SubtitleCueInput[];
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

const configuredRootSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => path.isAbsolute(value), "JIANYING_DRAFTS_DIR_ABSOLUTE_REQUIRED");

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

export function buildJianyingDraftDocuments(input: {
  draftId: string;
  draftPath: string;
  videoPath: string;
  coverPath: string;
  title: string;
  width: number;
  height: number;
  durationUs: number;
  videoBytes: number;
  now: Date;
}) {
  const videoMaterialId = id();
  const trackId = id();
  const segmentId = id();
  const nowSeconds = Math.floor(input.now.getTime() / 1_000);
  const nowMicroseconds = input.now.getTime() * 1_000;
  const draftPath = normalizePath(input.draftPath);
  const videoPath = normalizePath(input.videoPath);
  const coverPath = normalizePath(input.coverPath);
  const contentPath = normalizePath(
    path.join(input.draftPath, "draft_content.json"),
  );

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
    materials: {
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
      videos: [
        {
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
        },
      ],
      vocal_beautifys: [],
      vocal_separations: [],
    },
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
    tracks: [
      {
        attribute: 0,
        flag: 0,
        id: trackId,
        is_default_name: true,
        name: "",
        segments: [
          {
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
            extra_material_refs: [],
            group_id: "",
            hdr_settings: { intensity: 1, mode: 1, nits: 1_000 },
            id: segmentId,
            intensifies_audio: false,
            is_placeholder: false,
            is_tone_modify: false,
            keyframe_refs: [],
            last_nonzero_volume: 1,
            material_id: videoMaterialId,
            render_index: 0,
            reverse: false,
            source_timerange: { duration: input.durationUs, start: 0 },
            speed: 1,
            target_timerange: { duration: input.durationUs, start: 0 },
            template_id: "",
            template_scene: "default",
            track_attribute: 0,
            track_render_index: 0,
            uniform_scale: { on: true, value: 1 },
            visible: true,
            volume: 1,
          },
        ],
        type: "video",
      },
    ],
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
    draft_timeline_materials_size: input.videoBytes,
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
  };
}

const persistedMetaSchema = z.looseObject({ draft_id: z.string().min(1) });
const persistedContentSchema = z.looseObject({ id: z.string().min(1) });
const persistedRootSchema = z.looseObject({
  all_draft_store: z.array(z.looseObject({ draft_id: z.string().min(1) })).min(1),
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
  const videoPath = path.join(materialsPath, "remix.mp4");
  const coverPath = path.join(draftPath, "draft_cover.jpg");
  const durationUs = Math.max(1, Math.round(input.durationMs * 1_000));

  await mkdir(materialsPath, { recursive: true });
  await writeFile(videoPath, input.video);
  await writeFile(
    path.join(draftPath, "captions.srt"),
    cuesToSrt(input.subtitleCues),
    "utf8",
  );
  await ffmpegRunner(
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      "0",
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      coverPath,
    ],
    () => undefined,
  );

  const documents = buildJianyingDraftDocuments({
    draftId,
    draftPath,
    videoPath,
    coverPath,
    title: `StickMotion-${input.title}`,
    width: input.width,
    height: input.height,
    durationUs,
    videoBytes: (await stat(videoPath)).size,
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
        "remix.mp4 已包含旁白、字幕、音效、转场和特效。",
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
