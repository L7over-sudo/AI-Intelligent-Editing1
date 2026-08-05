import { randomUUID } from "node:crypto";
import {
  access,
  copyFile,
  mkdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { getPrisma } from "@stickmotion/db";
import { alignTextToDuration, cuesToSrt } from "@stickmotion/media";

function requiredProjectId(value: string | undefined): string {
  if (!value) throw new Error("PROJECT_ID_REQUIRED");
  return value;
}

const projectId = requiredProjectId(process.argv[2]);

const workspaceRoot = path.resolve(process.cwd(), "../..");
const storageRoot = path.join(workspaceRoot, "storage", "media");
const workRoot = path.join(workspaceRoot, "work");
const materialRoot = path.join(workRoot, "material");
const voiceRoot = path.join(workRoot, "voice");
const draftRoot = path.join(workRoot, "jianying_draft");
const draftMaterialRoot = path.join(draftRoot, "materials");

function uuid(): string {
  return randomUUID().toUpperCase();
}

function safeObjectPath(objectKey: string): string {
  if (
    !/^[a-zA-Z0-9._/-]+$/u.test(objectKey) ||
    objectKey.startsWith("/") ||
    objectKey.split("/").includes("..")
  ) {
    throw new Error("INVALID_OBJECT_KEY");
  }

  const resolvedRoot = path.resolve(storageRoot);
  const resolved = path.resolve(resolvedRoot, ...objectKey.split("/"));
  if (!resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("OBJECT_PATH_OUTSIDE_STORAGE");
  }
  return resolved;
}

function normalizeForDraft(filePath: string): string {
  return path.resolve(filePath).replaceAll("\\", "/");
}

function extensionFor(contentType: string, objectKey: string): string {
  const fromKey = path.extname(objectKey).toLowerCase();
  if (fromKey && /^[.][a-z0-9]{1,8}$/u.test(fromKey)) return fromKey;
  const known: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "video/mp4": ".mp4",
  };
  return known[contentType] ?? ".bin";
}

function transitionDuration(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const duration = (value as Record<string, unknown>).duration;
  return typeof duration === "number" && Number.isFinite(duration)
    ? Math.max(0, duration)
    : 0;
}

function metadataMatches(
  metadata: unknown,
  projectRevision: number,
  sceneRevision: number,
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  return (
    Reflect.get(metadata, "projectRevision") === projectRevision &&
    Reflect.get(metadata, "sceneRevision") === sceneRevision
  );
}


async function run(
  command: string,
  args: string[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspaceRoot,
      stdio: ["ignore", "ignore", "pipe"],
      windowsHide: true,
    });
    let errorText = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      errorText = `${errorText}${chunk}`.slice(-8_000);
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command.toUpperCase()}_FAILED_${code}: ${errorText}`));
    });
  });
}

async function main(): Promise<void> {
  const prisma = getPrisma();
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        scenes: {
          orderBy: { order: "asc" },
          include: {
            sceneAssets: {
              where: { role: "VISUAL" },
              orderBy: { order: "desc" },
              include: { asset: true },
            },
            voiceTracks: {
              orderBy: { createdAt: "desc" },
              take: 1,
              include: { asset: true },
            },
          },
        },
        renderOutputs: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { asset: true },
        },
      },
    });

    if (!project) throw new Error("PROJECT_NOT_FOUND");
    if (project.scenes.length === 0) throw new Error("PROJECT_SCENES_REQUIRED");

    const render = project.renderOutputs.find(
      (item) => item.projectRevision === project.revision,
    );
    if (!render) throw new Error("CURRENT_RENDER_REQUIRED");

    await Promise.all([
      mkdir(materialRoot, { recursive: true }),
      mkdir(voiceRoot, { recursive: true }),
      mkdir(draftMaterialRoot, { recursive: true }),
    ]);

    const renderSource = safeObjectPath(render.asset.objectKey);
    await access(renderSource);
    const remixPath = path.join(workRoot, "remix.mp4");
    const draftVideoPath = path.join(draftMaterialRoot, "remix.mp4");
    await Promise.all([
      copyFile(renderSource, remixPath),
      copyFile(renderSource, draftVideoPath),
    ]);

    const timeline: Array<{
      sceneId: string;
      order: number;
      narration: string;
      subtitle: string;
      visualPrompt: string;
      imagePath: string | null;
      voicePath: string | null;
      startUs: number;
      durationUs: number;
      transitionDurationUs: number;
    }> = [];
    let startUs = 0;

    for (const [index, scene] of project.scenes.entries()) {
      const fileNumber = String(index + 1).padStart(3, "0");
      const imageAsset =
        scene.sceneAssets.find((item) =>
          metadataMatches(item.asset.metadata, project.revision, scene.revision),
        )?.asset ?? scene.sceneAssets[0]?.asset;
      let imagePath: string | null = null;
      if (imageAsset) {
        const extension = extensionFor(imageAsset.contentType, imageAsset.objectKey);
        imagePath = path.join(materialRoot, `scene-${fileNumber}${extension}`);
        const source = safeObjectPath(imageAsset.objectKey);
        await access(source);
        await Promise.all([
          copyFile(source, imagePath),
          copyFile(
            source,
            path.join(draftMaterialRoot, `scene-${fileNumber}${extension}`),
          ),
        ]);
      }

      const voiceAsset = scene.voiceTracks[0]?.asset;
      let voicePath: string | null = null;
      if (voiceAsset) {
        const extension = extensionFor(voiceAsset.contentType, voiceAsset.objectKey);
        voicePath = path.join(voiceRoot, `scene-${fileNumber}${extension}`);
        const source = safeObjectPath(voiceAsset.objectKey);
        await access(source);
        await Promise.all([
          copyFile(source, voicePath),
          copyFile(
            source,
            path.join(draftMaterialRoot, `voice-${fileNumber}${extension}`),
          ),
        ]);
      }

      const durationUs = Math.max(
        100_000,
        Math.round(scene.estimatedDuration * 1_000_000),
      );
      const overlapUs = Math.min(
        durationUs - 1,
        Math.round(transitionDuration(scene.transition) * 1_000_000),
      );
      timeline.push({
        sceneId: scene.id,
        order: scene.order,
        narration: scene.narration,
        subtitle: scene.subtitle,
        visualPrompt: scene.visualPrompt,
        imagePath: imagePath ? normalizeForDraft(imagePath) : null,
        voicePath: voicePath ? normalizeForDraft(voicePath) : null,
        startUs,
        durationUs,
        transitionDurationUs: overlapUs,
      });
      startUs += durationUs - overlapUs;
    }

    const durationUs = render.durationMs * 1_000;
    const subtitleCues = timeline
      .flatMap((item) => {
        const sceneStartMs = Math.round(item.startUs / 1_000);
        return alignTextToDuration(
          item.subtitle,
          Math.round(item.durationUs / 1_000),
        ).map((cue) => ({
          ...cue,
          startMs: sceneStartMs + cue.startMs,
          endMs: Math.min(render.durationMs, sceneStartMs + cue.endMs),
        }));
      })
      .filter((cue) => cue.endMs > cue.startMs);
    const srt = cuesToSrt(subtitleCues);
    const captionsPath = path.join(workRoot, "captions.srt");
    await Promise.all([
      writeFile(captionsPath, srt, "utf8"),
      writeFile(path.join(draftRoot, "captions.srt"), srt, "utf8"),
      writeFile(
        path.join(workRoot, "script.txt"),
        timeline.map((item) => item.narration).join("\n"),
        "utf8",
      ),
    ]);

    const recipe = {
      schemaVersion: 1,
      projectId: project.id,
      projectRevision: project.revision,
      title: project.title,
      aspectRatio: project.aspectRatio === "PORTRAIT" ? "9:16" : "16:9",
      width: render.width,
      height: render.height,
      durationMs: render.durationMs,
      videoPath: normalizeForDraft(remixPath),
      captionsPath: normalizeForDraft(captionsPath),
      timeline,
    };
    const matches = {
      schemaVersion: 1,
      projectId: project.id,
      matches: timeline.map((item) => ({
        sceneId: item.sceneId,
        order: item.order,
        material: item.imagePath,
        voice: item.voicePath,
        startUs: item.startUs,
        durationUs: item.durationUs,
      })),
    };
    await Promise.all([
      writeFile(
        path.join(workRoot, "recipe.json"),
        `${JSON.stringify(recipe, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(workRoot, "matches.json"),
        `${JSON.stringify(matches, null, 2)}\n`,
        "utf8",
      ),
    ]);

    const finalVoicePath = path.join(voiceRoot, "final_voice.mp3");
    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      remixPath,
      "-vn",
      "-codec:a",
      "libmp3lame",
      "-q:a",
      "2",
      finalVoicePath,
    ]);
    await copyFile(
      finalVoicePath,
      path.join(draftMaterialRoot, "final_voice.mp3"),
    );

    const coverPath = path.join(draftRoot, "draft_cover.jpg");
    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      "0",
      "-i",
      draftVideoPath,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      coverPath,
    ]);

    const draftId = uuid();
    const videoMaterialId = uuid();
    const segmentId = uuid();
    const trackId = uuid();
    const nowSeconds = Math.floor(Date.now() / 1_000);
    const nowMicroseconds = Date.now() * 1_000;
    const absoluteDraftRoot = normalizeForDraft(draftRoot);
    const absoluteDraftVideo = normalizeForDraft(draftVideoPath);
    const draftContentPath = normalizeForDraft(
      path.join(draftRoot, "draft_content.json"),
    );

    const draftContent = {
      canvas_config: {
        height: render.height,
        ratio: "original",
        width: render.width,
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
        multi_language_current: "none",
        multi_language_list: [],
        multi_language_main: "none",
        multi_language_mode: "none",
        original_sound_last_index: 1,
        record_audio_last_index: 1,
        sticker_max_index: 1,
        subtitle_keywords_config: null,
        subtitle_recognition_id: "",
        subtitle_sync: true,
        subtitle_taskinfo: [],
        system_font_list: [],
        video_mute: false,
        zoom_info_params: null,
      },
      cover: null,
      create_time: nowSeconds,
      duration: durationUs,
      extra_info: null,
      fps: 30,
      free_render_index_mode_on: false,
      group_container: null,
      id: draftId,
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
            duration: durationUs,
            extra_type_option: 0,
            formula_id: "",
            freeze: null,
            gameplay: null,
            has_audio: true,
            height: render.height,
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
            path: absoluteDraftVideo,
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
            width: render.width,
          },
        ],
        vocal_beautifys: [],
        vocal_separations: [],
      },
      mutable_config: null,
      name: project.title,
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
      static_cover_image_path: normalizeForDraft(coverPath),
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
              source_timerange: { duration: durationUs, start: 0 },
              speed: 1,
              target_timerange: { duration: durationUs, start: 0 },
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

    const videoSize = (await stat(draftVideoPath)).size;
    const draftMeta = {
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
      draft_cover: normalizeForDraft(coverPath),
      draft_deeplink_url: "",
      draft_enterprise_info: {
        draft_enterprise_extra: "",
        draft_enterprise_id: "",
        draft_enterprise_name: "",
      },
      draft_fold_path: absoluteDraftRoot,
      draft_id: draftId,
      draft_is_ai_shorts: false,
      draft_is_invisible: false,
      draft_json_file: draftContentPath,
      draft_name: `StickMotion-${project.title}`,
      draft_new_version: "5.9.0",
      draft_removable_storage_device: "",
      draft_root_path: absoluteDraftRoot,
      draft_segment_extra_info: [],
      draft_timeline_materials_size: videoSize,
      draft_type: "",
      streaming_edit_draft_ready: true,
      tm_draft_cloud_completed: "",
      tm_draft_cloud_modified: 0,
      tm_draft_create: nowMicroseconds,
      tm_draft_modified: nowMicroseconds,
      tm_duration: durationUs,
    };
    const rootMeta = {
      all_draft_store: [draftMeta],
      draft_ids: 1,
      root_path: absoluteDraftRoot,
    };

    await Promise.all([
      writeFile(
        path.join(draftRoot, "draft_content.json"),
        `${JSON.stringify(draftContent, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(draftRoot, "draft_meta_info.json"),
        `${JSON.stringify(draftMeta, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(draftRoot, "root_meta_info.json"),
        `${JSON.stringify(rootMeta, null, 2)}\n`,
        "utf8",
      ),
      writeFile(
        path.join(draftRoot, "README.txt"),
        [
          "StickMotion 剪映草稿",
          "",
          "1. 草稿内所有素材均已复制到 materials 文件夹。",
          "2. remix.mp4 已包含旁白、字幕、音效、转场和特效。",
          "3. captions.srt 是可单独导入剪映的字幕文件。",
          "4. 将整个 jianying_draft 文件夹复制到剪映草稿目录后打开剪映。",
          "5. 当前新版剪映会在首次打开时迁移并加密旧版兼容草稿。",
          "",
          `草稿 ID：${draftId}`,
        ].join("\r\n"),
        "utf8",
      ),
    ]);

    const result = {
      projectId: project.id,
      projectRevision: project.revision,
      draftId,
      sceneCount: timeline.length,
      durationMs: render.durationMs,
      width: render.width,
      height: render.height,
      remixPath: normalizeForDraft(remixPath),
      captionsPath: normalizeForDraft(captionsPath),
      voicePath: normalizeForDraft(finalVoicePath),
      draftRoot: absoluteDraftRoot,
    };
    await writeFile(
      path.join(workRoot, "export-result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      "utf8",
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
