"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";

import { shortProjectTitle, type ImageSizePreset } from "@stickmotion/shared";

import { ConfirmDialog } from "./confirm-dialog";
import { AppDialog } from "./app-dialog";
import { withBusyState } from "./async-ui-state";
import {
  creativePreferencesStorageKey,
  parseStoredCreativePreferences,
  serializeCreativePreferences,
} from "./creative-preferences";
import {
  coverTemplateStorageKey,
  findSelectedCoverTemplate,
  noCoverTemplateId,
  parseSavedCoverTemplates,
  type SavedCoverTemplate,
} from "./cover-template";
import { GenerationAnalysisOverlay } from "./generation-analysis-overlay";
import {
  videoTemplateOptions,
  type VideoTemplate,
} from "./video-template-options";
import {
  VoiceProfilePanel,
  type VoiceProfileSummary,
} from "./voice-profile-panel";

type StudioTab =
  "visual" | "cover" | "transition" | "character" | "voice" | "music";
type AspectRatio = "PORTRAIT" | "LANDSCAPE";
type OutputMode = "NARRATED" | "VISUAL_ONLY";

const projectResponseSchema = z.object({
  project: z.object({ id: z.string().min(1) }).optional(),
  error: z.string().optional(),
  issues: z.array(z.object({ message: z.string() })).optional(),
});

interface CharacterProfileSummary {
  id: string;
  name: string;
  assetId: string;
  fileName: string;
  contentType: string;
  createdAt: string;
}

const sampleCopy =
  "你有没有发现，越重要的事情，我们越容易拖延？这并不是因为懒，而是大脑在回避不确定性。把任务拆成一个两分钟就能开始的小动作，先完成第一步，行动就会自然发生。";
const tabs: Array<{ id: StudioTab; label: string }> = [
  { id: "visual", label: "画面" },
  { id: "cover", label: "封面" },
  { id: "transition", label: "转场" },
  { id: "character", label: "角色" },
  { id: "voice", label: "配音" },
  { id: "music", label: "音乐" },
];
export function CreativeStudio({
  onProjectCreated,
  onOpenSettings,
  mode = "create",
}: {
  onProjectCreated: (projectId: string) => void | Promise<void>;
  onOpenSettings: () => void;
  mode?: "create" | "templates";
  onOpenCreate?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<StudioTab>("visual");
  const [sourceText, setSourceText] = useState("");
  const [projectName, setProjectName] = useState("");
  const [sourceKind, setSourceKind] = useState<"FULL_TEXT" | "TOPIC">(
    "FULL_TEXT",
  );
  const [imagePrompt, setImagePrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("LANDSCAPE");
  const [imageSize, setImageSize] = useState<ImageSizePreset>("21:9");
  const [videoTemplate, setVideoTemplate] =
    useState<VideoTemplate>("KNOWLEDGE_BOARD");
  const [templateHeader, setTemplateHeader] = useState(
    "\u601d\u7ef4\u63d0\u5347|\u8868\u8fbe\u6c9f\u901a|\u804c\u573a\u6210\u957f|\u81ea\u6211\u7a81\u7834",
  );
  const [outputMode, setOutputMode] = useState<OutputMode>("NARRATED");
  const [voiceStyle, setVoiceStyle] = useState("none");
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfileSummary[]>([]);
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState("");
  const [voiceProfileName, setVoiceProfileName] = useState("我的声音");
  const [voiceReferenceFile, setVoiceReferenceFile] = useState<File>();
  const [voiceServiceUrl, setVoiceServiceUrl] = useState("");
  const [voiceConsentConfirmed, setVoiceConsentConfirmed] = useState(false);
  const [characterProfiles, setCharacterProfiles] = useState<
    CharacterProfileSummary[]
  >([]);
  const [selectedCharacterProfileId, setSelectedCharacterProfileId] =
    useState("");
  const [characterProfileName, setCharacterProfileName] =
    useState("我的参考人物");
  const [characterReferenceFile, setCharacterReferenceFile] = useState<File>();
  const [transitionsEnabled, setTransitionsEnabled] = useState(true);
  const [leftVerticalText, setLeftVerticalText] = useState("无限进化的Jay");
  const [rightVerticalText, setRightVerticalText] =
    useState("个人观点\n\n无不良引导");
  const [mainTitle, setMainTitle] = useState("");
  const [music, setMusic] = useState("NONE");
  const narrationVolume = 1;
  const backgroundMusicVolume = 0.1;
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [imageApiReady, setImageApiReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [creativePreferencesLoaded, setCreativePreferencesLoaded] =
    useState(false);
  const [coverTemplates, setCoverTemplates] = useState<SavedCoverTemplate[]>(
    [],
  );
  const [selectedCoverTemplateId, setSelectedCoverTemplateId] = useState("");

  useEffect(() => {
    const savedTemplates = parseSavedCoverTemplates(
      window.localStorage.getItem(coverTemplateStorageKey),
    );
    setCoverTemplates(savedTemplates);
    setSelectedCoverTemplateId(
      savedTemplates[savedTemplates.length - 1]?.id ?? "",
    );
  }, []);

  useEffect(() => {
    let stored: ReturnType<typeof parseStoredCreativePreferences> | undefined;
    try {
      stored = parseStoredCreativePreferences(
        window.localStorage.getItem(creativePreferencesStorageKey),
      );
    } catch {
      stored = undefined;
    }
    if (stored?.videoTemplate) setVideoTemplate(stored.videoTemplate);
    if (stored?.imageSize) setImageSize(stored.imageSize);
    if (stored?.aspectRatio) setAspectRatio(stored.aspectRatio);
    if (stored?.templateHeader !== undefined) {
      setTemplateHeader(stored.templateHeader);
    }
    if (stored?.mainTitle !== undefined) setMainTitle(stored.mainTitle);
    if (stored?.leftVerticalText !== undefined) {
      setLeftVerticalText(stored.leftVerticalText);
    }
    if (stored?.rightVerticalText !== undefined) {
      setRightVerticalText(stored.rightVerticalText);
    }
    if (stored?.transitionsEnabled !== undefined) {
      setTransitionsEnabled(stored.transitionsEnabled);
    }
    if (stored?.outputMode) setOutputMode(stored.outputMode);
    if (stored?.music) setMusic(stored.music);
    if (stored?.selectedCoverTemplateId !== undefined) {
      setSelectedCoverTemplateId(stored.selectedCoverTemplateId);
    }
    setCreativePreferencesLoaded(true);
  }, []);

  useEffect(() => {
    if (!creativePreferencesLoaded) return;
    try {
      window.localStorage.setItem(
        creativePreferencesStorageKey,
        serializeCreativePreferences({
          videoTemplate,
          imageSize,
          aspectRatio,
          templateHeader,
          mainTitle,
          leftVerticalText,
          rightVerticalText,
          transitionsEnabled,
          outputMode,
          music,
          selectedCoverTemplateId,
        }),
      );
    } catch {
      // Keep the current form usable when browser storage is unavailable.
    }
  }, [
    aspectRatio,
    creativePreferencesLoaded,
    imageSize,
    leftVerticalText,
    mainTitle,
    music,
    outputMode,
    rightVerticalText,
    selectedCoverTemplateId,
    templateHeader,
    transitionsEnabled,
    videoTemplate,
  ]);

  const selectedCoverTemplate = findSelectedCoverTemplate(
    coverTemplates,
    selectedCoverTemplateId,
  );

  function selectVideoTemplate(value: VideoTemplate) {
    setVideoTemplate(value);
    if (value === "KNOWLEDGE_BOARD") {
      setAspectRatio("LANDSCAPE");
      setImageSize("21:9");
    } else if (value === "IMPACT_CAPTIONS") {
      setAspectRatio("LANDSCAPE");
      setImageSize("16:9");
    }
  }

  useEffect(() => {
    fetch("/api/character-profiles")
      .then((response) => response.json())
      .then((data: { profiles?: CharacterProfileSummary[] }) => {
        const profiles = data.profiles ?? [];
        setCharacterProfiles(profiles);
        setSelectedCharacterProfileId(
          (current) => current || profiles[0]?.id || "",
        );
      })
      .catch(() => setCharacterProfiles([]));
  }, []);
  useEffect(() => {
    fetch("/api/voice-profiles")
      .then((response) => response.json())
      .then((data: { profiles?: VoiceProfileSummary[] }) => {
        const profiles = data.profiles ?? [];
        setVoiceProfiles(profiles);
        setSelectedVoiceProfileId(
          (current) =>
            current ||
            profiles.find((profile) => profile.available !== false)?.id ||
            "",
        );
      })
      .catch(() => setVoiceProfiles([]));
  }, []);
  useEffect(() => {
    fetch("http://127.0.0.1:4317/settings/openai")
      .then((response) => response.json())
      .then(
        (data: {
          settings?: {
            imageApiKeyConfigured?: boolean;
          };
        }) => {
          setImageApiReady(Boolean(data.settings?.imageApiKeyConfigured));
        },
      )
      .catch(() => {
        setImageApiReady(false);
      });
  }, []);
  const projectTitle = useMemo(() => {
    return shortProjectTitle(sourceText);
  }, [sourceText]);

  async function submit() {
    const copy = sourceText.trim();
    if (copy.length < 2) {
      setError("请先输入主题或完整文案");
      return;
    }
    if (imagePrompt.trim().length < 3) {
      setError("请先输入画面提示词");
      setActiveTab("visual");
      return;
    }
    if (
      !selectedCharacterProfileId &&
      characterReferenceFile &&
      (characterProfileName.trim().length < 1 ||
        characterReferenceFile.size > 5 * 1024 * 1024 ||
        !["image/jpeg", "image/png", "image/webp"].includes(
          characterReferenceFile.type,
        ))
    ) {
      setError("参考人物仅支持 JPG、PNG、WebP，文件最大 5MB");
      setActiveTab("character");
      return;
    }
    if (!imageApiReady) {
      setError("提示词生图需要图像 API，请先前往 API 设置保存密钥");
      setActiveTab("visual");
      return;
    }
    if (outputMode === "NARRATED" && !selectedVoiceProfileId) {
      setError("请先在配音板块上传并选择音色");
      setActiveTab("voice");
      return;
    }

    setError("");
    try {
      await withBusyState(setBusy, async () => {
        const response = await fetch("/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: projectName.trim() || projectTitle,
            sourceText: copy,
            sourceKind,
            aspectRatio:
              videoTemplate === "KNOWLEDGE_BOARD" ||
              videoTemplate === "IMPACT_CAPTIONS"
                ? "LANDSCAPE"
                : aspectRatio,
            language: "zh-CN",
            voiceStyle:
              voiceProfiles.find(
                (profile) => profile.id === selectedVoiceProfileId,
              )?.provider ?? (selectedVoiceProfileId ? "local-clone" : "none"),
            voiceProfileId: selectedVoiceProfileId || undefined,
            characterProfileId:
              selectedCharacterProfileId &&
              selectedCharacterProfileId !== "__NONE__"
                ? selectedCharacterProfileId
                : undefined,
            accentColor: "#ee86aa",
            visualMode: "AI_IMAGE",
            imagePrompt: imagePrompt.trim(),
            includeNarration: outputMode === "NARRATED",
            includeSubtitles: outputMode === "NARRATED",
            narrationVolume,
            backgroundMusicVolume,
            backgroundMusic: music,
            subtitleStyle: {
              mode: "CHINESE",
              fontSize: 60,
              position: "BOTTOM",
              outline: true,
              shadow: true,
              keywordHighlight: true,

              videoTemplate,
              headerText:
                videoTemplate === "KNOWLEDGE_BOARD"
                  ? templateHeader.trim()
                  : "",
              mainTitle: mainTitle.trim(),
              leftVerticalText: leftVerticalText.trim(),
              rightVerticalText: rightVerticalText.trim(),
              transitionsEnabled,
              customTitle: projectName.trim().length > 0,
              imageSize:
                videoTemplate === "KNOWLEDGE_BOARD" ? "21:9" : imageSize,
              coverTemplate: selectedCoverTemplate,
            },
          }),
        });
        const data = projectResponseSchema.parse(await response.json());
        if (!response.ok || !data.project) {
          throw new Error(
            data.issues?.[0]?.message
              ? `项目校验失败：${data.issues[0].message}`
              : (data.error ?? "项目创建失败"),
          );
        }
        if (!selectedCharacterProfileId && characterReferenceFile) {
          const referenceFile = characterReferenceFile;
          const setup = await fetch(
            `/api/projects/${data.project.id}/character-reference`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                profileName: characterProfileName.trim(),
                fileName: referenceFile.name,
                contentType: referenceFile.type,
                byteSize: referenceFile.size,
              }),
            },
          );
          const setupData = (await setup.json()) as {
            assetId?: string;
            uploadUrl?: string;
            error?: string;
          };
          if (!setup.ok || !setupData.uploadUrl || !setupData.assetId) {
            throw new Error(setupData.error ?? "参考人物保存失败");
          }
          const upload = await fetch(setupData.uploadUrl, {
            method: "PUT",
            headers: { "content-type": referenceFile.type },
            body: referenceFile,
          });
          if (!upload.ok) throw new Error("参考人物上传失败");
        }
        const generation = await fetch(
          `/api/projects/${data.project.id}/storyboard/generate`,
          { method: "POST" },
        );
        if (!generation.ok) {
          const failure = projectResponseSchema.safeParse(
            await generation.json(),
          );
          const issue = failure.success
            ? failure.data.issues?.[0]?.message
            : undefined;
          throw new Error(
            issue
              ? `分镜任务校验失败：${issue}`
              : failure.success
                ? (failure.data.error ?? "项目已创建，但分镜任务启动失败")
                : "项目已创建，但分镜任务启动失败",
          );
        }
        await onProjectCreated(data.project.id);
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
    }
  }

  if (mode === "templates") {
    return (
      <main className="h-full overflow-y-auto bg-white text-[#17263a]">
        <div className="min-h-full w-full bg-white p-5 pb-24 md:p-6 lg:pb-6">
          <LegacyTemplatePanel
            videoTemplate={videoTemplate}
            setVideoTemplate={selectVideoTemplate}
            templateHeader={templateHeader}
            setTemplateHeader={setTemplateHeader}
            leftVerticalText={leftVerticalText}
            setLeftVerticalText={setLeftVerticalText}
            rightVerticalText={rightVerticalText}
            setRightVerticalText={setRightVerticalText}
            mainTitle={mainTitle}
            setMainTitle={setMainTitle}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="pink-blue-theme h-full overflow-y-auto bg-[#e7edef] p-0 text-[#20252b] lg:overflow-hidden">
      <div className="grid min-h-full gap-2 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="relative flex min-h-[680px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgb(20_35_45/8%)]">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.04] px-6 py-3 md:px-10">
            <div className="flex items-center gap-3">
              <img
                src="/stickmotion-logo.png"
                alt="StickMotion"
                className="size-9 object-contain"
              />
              <div>
                <p className="text-sm font-black">StickMotion 创作台</p>
                <p className="text-xs text-black/35">{projectTitle}</p>
              </div>
            </div>
            <div className="flex rounded-xl bg-[#f2f5f6] p-1 text-sm font-bold">
              <button
                type="button"
                onClick={() => setSourceKind("FULL_TEXT")}
                className={`rounded-lg px-3 py-2 ${
                  sourceKind === "FULL_TEXT"
                    ? "bg-white text-[#14191f] shadow-sm"
                    : "text-black/40"
                }`}
              >
                完整文案
              </button>
              <button
                type="button"
                onClick={() => setSourceKind("TOPIC")}
                className={`rounded-lg px-3 py-2 ${
                  sourceKind === "TOPIC"
                    ? "bg-white text-[#14191f] shadow-sm"
                    : "text-black/40"
                }`}
              >
                创意主题
              </button>
            </div>
          </header>

          <div className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-3 md:px-[10%] md:pt-4">
            <label className="mt-3 grid gap-1.5">
              <span className="text-xs font-black text-[#8d97a3]">
                项目名称
              </span>
              <input
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                maxLength={120}
                placeholder="留空则根据文案自动生成"
                className="w-full rounded-xl border border-black/[0.08] bg-white px-4 py-3 text-sm font-bold outline-none transition placeholder:text-black/25 focus:border-[#19b9c6]"
              />
            </label>

            <textarea
              value={sourceText}
              onChange={(event) => {
                setSourceText(event.target.value);
                setError("");
              }}
              autoFocus
              maxLength={30_000}
              placeholder={
                sourceKind === "FULL_TEXT"
                  ? "粘贴你的完整文案。系统会按照内容自然拆分分镜，视频时长由文案决定……"
                  : "输入一个创意主题，例如：为什么越重要的事情越容易拖延？"
              }
              className="mt-4 min-h-[430px] flex-1 resize-none border-0 bg-transparent text-lg leading-9 text-[#303740] outline-none placeholder:text-[#c6ccd2]"
            />

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.05] pt-4 text-xs text-black/40">
              <button
                type="button"
                onClick={() => {
                  if (!sourceText) setSourceText(sampleCopy);
                  setHint("会根据文案自动拆分镜头、字幕和画面提示");
                }}
                className="rounded-full border border-black/10 bg-white px-4 py-2 font-black text-[#477cff] shadow-sm"
              >
                ✦ 文案助手
              </button>
              <div className="flex items-center gap-5">
                <span className="rounded-full bg-cyan-50 px-3 py-1.5 font-bold text-[#159aa6]">
                  短句一分镜 · 长句自动细分 · 一分镜一张图
                </span>
                <span>
                  {sourceText.length.toLocaleString("zh-CN")} / 30,000
                </span>
                <label
                  className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition ${
                    keepOriginal
                      ? "border-[#16bec8]/30 bg-cyan-50 text-[#0f8791]"
                      : "border-black/10 bg-white text-black/40 hover:border-black/20"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={keepOriginal}
                    onChange={(event) => setKeepOriginal(event.target.checked)}
                    className="sr-only"
                  />
                  <span
                    className={`grid h-4 w-4 place-items-center rounded-full border-2 transition ${
                      keepOriginal
                        ? "border-[#16bec8] bg-[#16bec8] text-white"
                        : "border-black/20 bg-white"
                    }`}
                  >
                    {keepOriginal && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </span>
                  按原文配旁白
                </label>
              </div>
            </div>
            {(hint || error) && (
              <p
                className={`mt-3 rounded-xl px-4 py-3 text-sm font-bold ${
                  error ? "bg-red-50 text-red-700" : "bg-cyan-50 text-cyan-800"
                }`}
              >
                {error || hint}
              </p>
            )}
          </div>
        </section>

        <aside className="flex min-h-[680px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgb(20_35_45/8%)]">
          <nav className="flex border-b border-black/[0.05] px-5">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-3 py-4 text-sm font-bold transition ${
                  activeTab === tab.id ? "text-[#20252b]" : "text-[#9ba3ad]"
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <span className="absolute inset-x-3 bottom-0 h-0.5 bg-[#16bec8]" />
                )}
              </button>
            ))}
          </nav>

          <div className="border-b border-black/[0.05] px-5 py-3">
            <VideoTemplateDropdown
              value={videoTemplate}
              onChange={selectVideoTemplate}
              compact
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {activeTab === "visual" && (
              <VisualPanel
                imagePrompt={imagePrompt}
                setImagePrompt={setImagePrompt}
                aspectRatio={aspectRatio}
                setAspectRatio={setAspectRatio}
                imageSize={imageSize}
                setImageSize={setImageSize}
                videoTemplate={videoTemplate}
                setVideoTemplate={selectVideoTemplate}
                imageApiReady={imageApiReady}
                onOpenSettings={onOpenSettings}
              />
            )}
            {activeTab === "cover" && (
              <CoverPanel
                templates={coverTemplates}
                selectedTemplateId={selectedCoverTemplateId}
                onSelectTemplate={setSelectedCoverTemplateId}
              />
            )}
            {activeTab === "transition" && (
              <TransitionPanel
                transitionsEnabled={transitionsEnabled}
                setTransitionsEnabled={setTransitionsEnabled}
              />
            )}
            {activeTab === "character" && (
              <CharacterPanel
                profiles={characterProfiles}
                selectedProfileId={selectedCharacterProfileId}
                setSelectedProfileId={setSelectedCharacterProfileId}
                profileName={characterProfileName}
                setProfileName={setCharacterProfileName}
                referenceFile={characterReferenceFile}
                setReferenceFile={setCharacterReferenceFile}
                onProfileDeleted={(profileId) => {
                  setCharacterProfiles((current) =>
                    current.filter((profile) => profile.id !== profileId),
                  );
                  setSelectedCharacterProfileId((current) =>
                    current === profileId ? "" : current,
                  );
                }}
              />
            )}
            {activeTab === "voice" && (
              <VoiceProfilePanel
                profiles={voiceProfiles}
                selectedProfileId={selectedVoiceProfileId}
                setSelectedProfileId={setSelectedVoiceProfileId}
                profileName={voiceProfileName}
                setProfileName={setVoiceProfileName}
                voiceStyle={voiceStyle}
                setVoiceStyle={setVoiceStyle}
                referenceFile={voiceReferenceFile}
                setReferenceFile={setVoiceReferenceFile}
                serviceUrl={voiceServiceUrl}
                setServiceUrl={setVoiceServiceUrl}
                consentConfirmed={voiceConsentConfirmed}
                setConsentConfirmed={setVoiceConsentConfirmed}
                onProfileSaved={(profile) => {
                  setVoiceProfiles((current) => [
                    profile,
                    ...current.filter((item) => item.id !== profile.id),
                  ]);
                  setSelectedVoiceProfileId(profile.id);
                }}
                onProfileRenamed={(profile) => {
                  setVoiceProfiles((current) =>
                    current.map((item) =>
                      item.id === profile.id ? profile : item,
                    ),
                  );
                }}
                onProfileDeleted={(profileId) => {
                  setVoiceProfiles((current) =>
                    current.filter((profile) => profile.id !== profileId),
                  );
                  setSelectedVoiceProfileId((current) =>
                    current === profileId ? "" : current,
                  );
                }}
              />
            )}
            {activeTab === "music" && (
              <MusicPanel music={music} setMusic={setMusic} />
            )}
          </div>

          <footer className="border-t border-black/[0.06] p-5">
            <div className="mb-3">
              <p className="mb-2 text-xs font-black text-[#4a5560]">
                {"\u751f\u6210\u89c6\u9891"}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setOutputMode("NARRATED")}
                  className={`rounded-xl border px-3 py-2 text-xs font-black transition ${
                    outputMode === "NARRATED"
                      ? "border-[#16bec8] bg-cyan-50 text-[#148f99]"
                      : "border-black/[0.07] bg-white text-black/45"
                  }`}
                >
                  {"\u6717\u8bfb + \u5b57\u5e55"}
                </button>
                <button
                  type="button"
                  onClick={() => setOutputMode("VISUAL_ONLY")}
                  className={`rounded-xl border px-3 py-2 text-xs font-black transition ${
                    outputMode === "VISUAL_ONLY"
                      ? "border-[#16bec8] bg-cyan-50 text-[#148f99]"
                      : "border-black/[0.07] bg-white text-black/45"
                  }`}
                >
                  {"\u7eaf\u753b\u9762"}
                </button>
              </div>
            </div>
            <div className="mb-3 flex items-center justify-between text-xs text-[#8d97a3]">
              <span>提示词 AI 生图 · 一句一张</span>
              <span>
                {"\u751f\u6210\u5c3a\u5bf8\uff1a"}
                {videoTemplate === "KNOWLEDGE_BOARD" ? "21:9" : imageSize}
              </span>
            </div>
            <button
              type="button"
              disabled={
                busy ||
                sourceText.trim().length < 2 ||
                imagePrompt.trim().length < 3
              }
              onClick={() => void submit()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#4168a7] px-5 py-4 text-lg font-black text-white transition hover:bg-[#ee86aa] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-[#f4a4bd] via-[#6c93e7] to-[#9cbaff] text-xs">
                ✦
              </span>
              {busy ? "正在拆分文案…" : "拆分文案"}
            </button>
          </footer>
        </aside>
      </div>
      <GenerationAnalysisOverlay visible={busy} />
    </main>
  );
}

type PromptTemplateSummary = {
  id: string;
  name: string;
  content: string;
  updatedAt: string;
};

const promptTemplateText = {
  title: "\u63d0\u793a\u8bcd\u6a21\u677f",
  select: "\u9009\u62e9\u5df2\u4fdd\u5b58\u6a21\u677f",
  name: "\u6a21\u677f\u540d\u79f0",
  create: "\u65b0\u5efa",
  save: "\u4fdd\u5b58\u6a21\u677f",
  update: "\u66f4\u65b0\u6a21\u677f",
  remove: "\u5220\u9664",
  saved: "\u63d0\u793a\u8bcd\u6a21\u677f\u5df2\u4fdd\u5b58",
  removed: "\u63d0\u793a\u8bcd\u6a21\u677f\u5df2\u5220\u9664",
  loadFailed: "\u63d0\u793a\u8bcd\u6a21\u677f\u52a0\u8f7d\u5931\u8d25",
  saveFailed: "\u63d0\u793a\u8bcd\u6a21\u677f\u4fdd\u5b58\u5931\u8d25",
  removeFailed: "\u63d0\u793a\u8bcd\u6a21\u677f\u5220\u9664\u5931\u8d25",
  nameRequired: "\u8bf7\u8f93\u5165\u6a21\u677f\u540d\u79f0",
  promptRequired: "\u8bf7\u5148\u8f93\u5165\u753b\u9762\u63d0\u793a\u8bcd",
  confirmRemove:
    "\u786e\u5b9a\u5220\u9664\u8fd9\u4e2a\u63d0\u793a\u8bcd\u6a21\u677f\u5417\uff1f",
};

function PromptTemplateControls({
  imagePrompt,
  setImagePrompt,
}: {
  imagePrompt: string;
  setImagePrompt: (value: string) => void;
}) {
  const [templates, setTemplates] = useState<PromptTemplateSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [templateMenuOpenUp, setTemplateMenuOpenUp] = useState(false);
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  const selectedTemplate = templates.find((item) => item.id === selectedId);

  useEffect(() => {
    if (!templateMenuOpen) return;
    function closeOnOutside(event: MouseEvent) {
      if (
        templateMenuRef.current &&
        !templateMenuRef.current.contains(event.target as Node)
      ) {
        setTemplateMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setTemplateMenuOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [templateMenuOpen]);

  useEffect(() => {
    let active = true;
    fetch("/api/prompt-templates")
      .then(async (response) => {
        const data = (await response.json()) as {
          templates?: PromptTemplateSummary[];
          error?: string;
        };
        if (!response.ok) throw new Error(data.error);
        if (active) setTemplates(data.templates ?? []);
      })
      .catch(() => {
        if (active) {
          setFailed(true);
          setMessage(promptTemplateText.loadFailed);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  function selectTemplate(templateId: string) {
    setSelectedId(templateId);
    setFailed(false);
    setMessage("");
    const template = templates.find((item) => item.id === templateId);
    if (!template) {
      setTemplateName("");
      return;
    }
    setTemplateName(template.name);
    setImagePrompt(template.content);
  }

  async function saveTemplate() {
    const name = templateName.trim();
    const content = imagePrompt.trim();
    if (!name) {
      setFailed(true);
      setMessage(promptTemplateText.nameRequired);
      return;
    }
    if (!content) {
      setFailed(true);
      setMessage(promptTemplateText.promptRequired);
      return;
    }

    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const response = await fetch(
        selectedId
          ? `/api/prompt-templates/${encodeURIComponent(selectedId)}`
          : "/api/prompt-templates",
        {
          method: selectedId ? "PATCH" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name, content }),
        },
      );
      const data = (await response.json()) as {
        template?: PromptTemplateSummary;
        error?: string;
      };
      if (!response.ok || !data.template) {
        throw new Error(data.error ?? promptTemplateText.saveFailed);
      }
      const saved = data.template;
      setTemplates((current) => [
        saved,
        ...current.filter((item) => item.id !== saved.id),
      ]);
      setSelectedId(saved.id);
      setTemplateName(saved.name);
      setMessage(promptTemplateText.saved);
    } catch (reason) {
      setFailed(true);
      setMessage(
        reason instanceof Error && reason.message
          ? reason.message
          : promptTemplateText.saveFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  function openRemoveTemplate() {
    if (!selectedId) return;
    setRemoveConfirmOpen(true);
  }

  async function confirmRemoveTemplate() {
    if (!selectedId) return;
    setBusy(true);
    setFailed(false);
    setMessage("");
    try {
      const response = await fetch(
        `/api/prompt-templates/${encodeURIComponent(selectedId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) throw new Error(promptTemplateText.removeFailed);
      setTemplates((current) =>
        current.filter((item) => item.id !== selectedId),
      );
      setSelectedId("");
      setTemplateName("");
      setMessage(promptTemplateText.removed);
      setRemoveConfirmOpen(false);
    } catch (reason) {
      setFailed(true);
      setMessage(
        reason instanceof Error && reason.message
          ? reason.message
          : promptTemplateText.removeFailed,
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleTemplateMenu() {
    const nextOpen = !templateMenuOpen;
    if (nextOpen && templateMenuRef.current) {
      const rect = templateMenuRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setTemplateMenuOpenUp(spaceBelow < 300 && spaceAbove > spaceBelow);
    }
    setTemplateMenuOpen(nextOpen);
  }

  return (
    <div className="mt-4 rounded-2xl border border-black/[0.07] bg-[#f6f8f9] p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">{promptTemplateText.title}</strong>
        <button
          type="button"
          onClick={() => selectTemplate("")}
          className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-[#159aa6] shadow-sm"
        >
          {promptTemplateText.create}
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        <div ref={templateMenuRef} className="relative">
          <button
            type="button"
            onClick={toggleTemplateMenu}
            className={`flex h-11 w-full items-center gap-2.5 rounded-xl border bg-white px-3 text-left shadow-sm transition ${
              templateMenuOpen
                ? "border-[#16bec8] ring-2 ring-cyan-100"
                : "border-black/[0.08] hover:border-[#16bec8]/40 hover:shadow"
            }`}
          >
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-cyan-50 text-[#159aa6]">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
                <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15Z" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <strong
                className={`block truncate text-sm font-black ${
                  selectedTemplate ? "text-[#20252b]" : "text-black/45"
                }`}
              >
                {selectedTemplate
                  ? selectedTemplate.name
                  : promptTemplateText.select}
              </strong>
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 text-black/45 transition ${
                templateMenuOpen ? "rotate-180" : ""
              }`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {templateMenuOpen && (
            <div
              className={`absolute inset-x-0 z-30 max-h-64 overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-2 shadow-[0_18px_40px_rgb(0_0_0/14%)] ${
                templateMenuOpenUp ? "bottom-full mb-2" : "top-full mt-2"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  selectTemplate("");
                  setTemplateMenuOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                  !selectedTemplate ? "bg-cyan-50" : "hover:bg-[#f1f4f5]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <strong className="block text-sm">
                    {promptTemplateText.create}
                  </strong>
                </span>
                {!selectedTemplate && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#159aa6"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="shrink-0"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
              {templates.map((template) => {
                const active = template.id === selectedId;
                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => {
                      selectTemplate(template.id);
                      setTemplateMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                      active ? "bg-cyan-50" : "hover:bg-[#f1f4f5]"
                    }`}
                  >
                    <span className="min-w-0 flex-1">
                      <strong className="block truncate text-sm">
                        {template.name}
                      </strong>
                      <span className="mt-0.5 block truncate text-[11px] text-black/40">
                        {template.content.slice(0, 40)}
                      </span>
                    </span>
                    {active && (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#159aa6"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                );
              })}
              {templates.length === 0 && (
                <p className="px-3 py-4 text-center text-xs text-black/35">
                  暂无模板
                </p>
              )}
            </div>
          )}
        </div>
        <input
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
          maxLength={60}
          placeholder={promptTemplateText.name}
          className="w-full rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm outline-none placeholder:text-black/25 focus:border-[#16bec8]"
        />
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveTemplate()}
            className="rounded-xl bg-[#11151b] px-3 py-2.5 text-xs font-black text-white disabled:opacity-40"
          >
            {selectedId ? promptTemplateText.update : promptTemplateText.save}
          </button>
          <button
            type="button"
            disabled={busy || !selectedId}
            onClick={openRemoveTemplate}
            className="rounded-xl border border-red-200 bg-white px-3 py-2.5 text-xs font-black text-red-600 disabled:opacity-30"
          >
            {promptTemplateText.remove}
          </button>
        </div>
      </div>
      {message && (
        <p
          className={`mt-2 text-xs font-bold ${failed ? "text-red-600" : "text-emerald-700"}`}
        >
          {message}
        </p>
      )}
      <ConfirmDialog
        open={removeConfirmOpen}
        title="删除提示词模板"
        description={promptTemplateText.confirmRemove}
        confirmText="确认删除"
        busy={busy}
        onConfirm={() => void confirmRemoveTemplate()}
        onClose={() => setRemoveConfirmOpen(false)}
      />
    </div>
  );
}
function TransitionPanel({
  transitionsEnabled,
  setTransitionsEnabled,
}: {
  transitionsEnabled: boolean;
  setTransitionsEnabled: (value: boolean) => void;
}) {
  return (
    <div>
      <h2 className="font-black">镜头转场</h2>
      <p className="mt-1 text-xs leading-5 text-black/40">
        添加转场会使用淡入、溶解、推入或缩放；关闭后镜头直接切换。
      </p>
      <div className="mt-4 grid grid-cols-2 rounded-xl bg-[#f0f3f4] p-1">
        <button
          type="button"
          onClick={() => setTransitionsEnabled(true)}
          className={`rounded-lg px-3 py-3 text-xs font-black transition ${
            transitionsEnabled
              ? "bg-white text-black shadow-sm"
              : "text-black/40"
          }`}
        >
          添加转场
        </button>
        <button
          type="button"
          onClick={() => setTransitionsEnabled(false)}
          className={`rounded-lg px-3 py-3 text-xs font-black transition ${
            !transitionsEnabled
              ? "bg-white text-black shadow-sm"
              : "text-black/40"
          }`}
        >
          不加转场
        </button>
      </div>
    </div>
  );
}

function CoverPanel({
  templates,
  selectedTemplateId,
  onSelectTemplate,
}: {
  templates: SavedCoverTemplate[];
  selectedTemplateId: string;
  onSelectTemplate: (templateId: string) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function closeOnOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const selectedTemplate = templates.find(
    (template) => template.id === selectedTemplateId,
  );
  const noCoverSelected =
    selectedTemplateId === noCoverTemplateId || !selectedTemplate;

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="font-black">封面模板</h2>
        <p className="mt-1 text-xs leading-5 text-black/40">
          选择生成视频时使用的封面模板，可在左侧“封面”页编辑模板内容。
        </p>
      </div>

      <div className="grid gap-2 text-sm font-black text-black/65">
        <span>封面</span>
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-haspopup="listbox"
            aria-expanded={menuOpen}
            className={`flex w-full items-center justify-between gap-4 rounded-2xl border bg-white px-4 py-3.5 text-left outline-none transition ${
              menuOpen
                ? "border-[#16bec8] shadow-[0_0_0_3px_rgb(22_190_200/10%)]"
                : "border-black/[0.08] shadow-sm hover:border-black/15 hover:shadow-md"
            }`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#11151b] text-white shadow-sm">
                {noCoverSelected ? (
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="m5.6 5.6 12.8 12.8" />
                  </svg>
                ) : (
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="4" y="3" width="16" height="18" rx="2" />
                    <path d="M8 8h8M8 12h6M8 16h4" />
                  </svg>
                )}
              </span>
              <span className="min-w-0">
                <strong className="block truncate text-sm font-black text-[#1f2937]">
                  {noCoverSelected ? "不添加封面" : selectedTemplate?.name}
                </strong>
                <span className="mt-0.5 block text-[11px] font-bold text-black/35">
                  {noCoverSelected
                    ? "无封面视频"
                    : `${selectedTemplate?.templateName} · 3:4`}
                </span>
              </span>
            </span>
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 text-black/35 transition-transform ${
                menuOpen ? "rotate-180" : ""
              }`}
              aria-hidden="true"
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {menuOpen ? (
            <div
              role="listbox"
              aria-label="封面模板"
              className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl border border-black/[0.08] bg-white p-2 shadow-[0_18px_45px_rgb(15_23_42/15%)]"
            >
              <button
                type="button"
                role="option"
                aria-selected={noCoverSelected}
                data-template-id={noCoverTemplateId}
                onClick={() => {
                  onSelectTemplate(noCoverTemplateId);
                  setMenuOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition ${
                  noCoverSelected ? "bg-cyan-50" : "hover:bg-cyan-50"
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#11151b] text-xs font-black text-white">
                    <svg
                      width="17"
                      height="17"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <circle cx="12" cy="12" r="9" />
                      <path d="m5.6 5.6 12.8 12.8" />
                    </svg>
                  </span>
                  <span className="min-w-0">
                    <strong className="block truncate text-sm font-black text-[#1f2937]">
                      不添加封面
                    </strong>
                    <span className="mt-0.5 block text-[11px] font-bold text-black/35">
                      无封面视频
                    </span>
                  </span>
                </span>
                {noCoverSelected && (
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#16bec8] text-white">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                )}
              </button>
              {templates.map((template) => {
                const selected = template.id === selectedTemplateId;
                return (
                  <button
                    key={template.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-template-id={template.id}
                    onClick={() => {
                      onSelectTemplate(template.id);
                      setMenuOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-3 text-left transition ${
                      selected ? "bg-cyan-50" : "hover:bg-cyan-50"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#11151b] text-xs font-black text-white">
                        DY
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-sm font-black text-[#1f2937]">
                          {template.name}
                        </strong>
                        <span className="mt-0.5 block text-[11px] font-bold text-black/35">
                          {template.templateName} · 3:4
                        </span>
                      </span>
                    </span>
                    {selected && (
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-[#16bec8] text-white">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M20 6 9 17l-5-5" />
                        </svg>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>

      <p className="rounded-xl bg-cyan-50 px-4 py-3 text-xs font-bold leading-5 text-cyan-800">
        {noCoverSelected
          ? "当前选择不添加封面，生成视频时不会附带封面。"
          : `当前共有 ${templates.length} 个封面模板：${templates
              .map((template) => template.name)
              .join("、")}`}
      </p>
    </div>
  );
}

function VideoTemplateDropdown({
  value,
  onChange,
  compact = false,
}: {
  value: VideoTemplate;
  onChange: (value: VideoTemplate) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel =
    videoTemplateOptions.find((option) => option.value === value)?.label ??
    "选择模板";

  return (
    <div>
      <span className="text-[10px] font-black tracking-[0.08em] text-[#7f8b98]">
        视频模板
      </span>
      <span className="relative mt-1.5 block">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className={`flex w-full items-center justify-between rounded-xl border border-black/10 bg-[#f7f9fb] text-left font-black text-[#16334f] outline-none transition hover:bg-white focus:border-[#16bec8] focus:ring-4 focus:ring-cyan-50 ${
            compact ? "px-3 py-2 text-xs" : "px-4 py-3 text-sm"
          }`}
          aria-label="选择视频模板"
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span>{selectedLabel}</span>
          <span
            className={`text-[10px] text-[#718096] transition ${
              open ? "rotate-180" : ""
            }`}
          >
            ▼
          </span>
        </button>
        {open && (
          <span
            role="listbox"
            aria-label="视频模板选项"
            className="absolute inset-x-0 top-[calc(100%+0.35rem)] z-50 grid overflow-hidden rounded-xl border border-black/10 bg-white p-1.5 shadow-[0_16px_40px_rgba(21,46,67,0.16)]"
          >
            {videoTemplateOptions.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-bold transition ${
                    selected
                      ? "bg-[#16334f] text-white"
                      : "text-[#526274] hover:bg-[#f2f6f8]"
                  }`}
                >
                  {option.label}
                  {selected && <span className="text-[#5ce0e5]">●</span>}
                </button>
              );
            })}
          </span>
        )}
      </span>
    </div>
  );
}

export function LegacyTemplatePanel({
  videoTemplate,
  setVideoTemplate,
  templateHeader,
  setTemplateHeader,
  leftVerticalText,
  setLeftVerticalText,
  rightVerticalText,
  setRightVerticalText,
  mainTitle,
  setMainTitle,
}: {
  videoTemplate: VideoTemplate;
  setVideoTemplate: (value: VideoTemplate) => void;
  templateHeader: string;
  setTemplateHeader: (value: string) => void;
  leftVerticalText: string;
  setLeftVerticalText: (value: string) => void;
  rightVerticalText: string;
  setRightVerticalText: (value: string) => void;
  mainTitle: string;
  setMainTitle: (value: string) => void;
}) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="grid gap-6">
      <section>
        <h2 className="text-lg font-black">视频模板</h2>
        <p className="mt-1 text-sm leading-6 text-black/40">
          选择画面结构和文字呈现方式，选择哪个就使用哪个模板。
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {videoTemplateOptions.map((template) => (
            <div
              key={template.value}
              role="button"
              tabIndex={0}
              data-template-id={template.value}
              onClick={() => setVideoTemplate(template.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  setVideoTemplate(template.value);
                }
              }}
              className={`relative cursor-pointer rounded-2xl border p-3 text-left transition ${
                videoTemplate === template.value
                  ? "border-[#16bec8] bg-cyan-50 shadow-[0_0_0_3px_rgb(22_190_200/10%)]"
                  : "border-black/[0.07] bg-white hover:border-black/15"
              }`}
            >
              {template.value === "KNOWLEDGE_BOARD" ? (
                <KnowledgeBoardLayoutPreview
                  mainTitle={mainTitle}
                  templateHeader={templateHeader}
                  leftVerticalText={leftVerticalText}
                  rightVerticalText={rightVerticalText}
                  compact
                />
              ) : template.value === "IMPACT_CAPTIONS" ? (
                <span className="relative mb-3 block aspect-video overflow-hidden rounded-lg bg-[#172b3b]">
                  <span
                    className="absolute top-0 left-0 block origin-top-left scale-50"
                    style={{ width: "200%", height: "200%" }}
                  >
                    <TemplateArtwork
                      template="IMPACT_CAPTIONS"
                      templateHeader={templateHeader}
                      mainTitle={mainTitle}
                      leftVerticalText={leftVerticalText}
                      rightVerticalText={rightVerticalText}
                    />
                  </span>
                </span>
              ) : (
                <span className="relative mb-3 block aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-slate-300 via-cyan-100 to-orange-100">
                  <span className="absolute inset-x-[18%] bottom-[12%] h-2 rounded bg-white shadow" />
                </span>
              )}
              <div className="flex items-center justify-between gap-2">
                <strong className="block text-sm">{template.label}</strong>
                {template.value === "KNOWLEDGE_BOARD" && (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      setVideoTemplate("KNOWLEDGE_BOARD");
                      setModalOpen(true);
                    }}
                    className="shrink-0 rounded-lg bg-black/75 px-2.5 py-1 text-[10px] font-black text-white transition hover:bg-black"
                  >
                    编辑
                  </button>
                )}
              </div>
              <span className="mt-1 block text-[11px] text-black/40">
                {template.description}
              </span>
            </div>
          ))}
        </div>
      </section>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-black">知识白板模板</h3>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg bg-black/5 px-3 py-2 text-sm font-bold"
              >
                关闭
              </button>
            </div>

            <div className="mt-4 grid gap-5 lg:grid-cols-2">
              <KnowledgeBoardLayoutPreview
                mainTitle={mainTitle}
                templateHeader={templateHeader}
                leftVerticalText={leftVerticalText}
                rightVerticalText={rightVerticalText}
              />
              <div className="grid content-start gap-3">
                <TemplateTextField
                  label="主标题"
                  value={mainTitle}
                  onChange={setMainTitle}
                  placeholder="例如：自我突破"
                />
                <TemplateTextField
                  label="顶部栏目标题"
                  value={templateHeader}
                  onChange={setTemplateHeader}
                  placeholder="例如：思维提升 | 表达沟通 | 职场成长"
                />
                <TemplateTextField
                  label="左侧竖排文字"
                  value={leftVerticalText}
                  onChange={setLeftVerticalText}
                  placeholder="无限进化的Jay"
                  multiline
                />
                <TemplateTextField
                  label="右侧竖排文字"
                  value={rightVerticalText}
                  onChange={setRightVerticalText}
                  placeholder={"个人观点\n\n无不良引导"}
                  multiline
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function KnowledgeBoardLayoutPreview({
  mainTitle,
  templateHeader,
  leftVerticalText,
  rightVerticalText,
  compact = false,
}: {
  mainTitle: string;
  templateHeader: string;
  leftVerticalText: string;
  rightVerticalText: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`relative aspect-video overflow-hidden border border-black/10 bg-white ${
        compact ? "mb-3 rounded-lg" : "rounded-xl"
      }`}
      style={{ fontFamily: "DouyinSansBold, Microsoft YaHei" }}
    >
      <div
        className={`absolute inset-x-[8%] top-[3%] flex h-[11.5%] items-center justify-center overflow-hidden whitespace-nowrap font-black text-black ${
          compact ? "text-[6px]" : "text-xl"
        }`}
      >
        {mainTitle || "标题"}
      </div>
      <div className="absolute inset-x-[12%] top-[14.5%] flex h-[6.5%] items-center justify-center gap-[1.5%]">
        <span className="h-px w-[1.7%] shrink-0 bg-[#787878]" />
        <span
          className={`max-w-[82%] overflow-hidden whitespace-nowrap font-bold tracking-[0.2em] text-[#797979] ${
            compact ? "text-[3px]" : "text-[10px]"
          }`}
        >
          {templateHeader || "顶部栏目标题"}
        </span>
        <span className="h-px w-[1.7%] shrink-0 bg-[#787878]" />
      </div>
      <span
        className={`absolute top-[24%] bottom-[24%] left-[2.5%] overflow-hidden leading-[1.45] text-[#cccccc] ${
          compact ? "text-[3px]" : "text-[7px]"
        }`}
        style={{ writingMode: "vertical-rl" }}
      >
        {leftVerticalText.replace(/\n/gu, "")}
      </span>
      <span
        className={`absolute top-[24%] right-[2.5%] bottom-[24%] overflow-hidden leading-[1.45] text-[#cccccc] ${
          compact ? "text-[3px]" : "text-[7px]"
        }`}
        style={{ writingMode: "vertical-rl" }}
      >
        {rightVerticalText.replace(/\n/gu, "")}
      </span>
      <span className="absolute inset-x-0 bottom-[18.5%] h-px bg-black" />
      <span className="absolute inset-x-0 bottom-0 flex h-[18.5%] items-center justify-center">
        <span
          className={`font-black leading-none text-white ${
            compact ? "text-[4px]" : "text-base"
          }`}
          style={{
            WebkitTextStroke: compact ? "0.4px black" : "1px black",
            paintOrder: "stroke fill",
          }}
        >
          {compact ? "预览字幕" : "朗读字幕示例"}
        </span>
      </span>
    </div>
  );
}

export function TemplateLibraryPanel({
  videoTemplate,
  setVideoTemplate,
  templateHeader,
  setTemplateHeader,
  leftVerticalText,
  setLeftVerticalText,
  rightVerticalText,
  setRightVerticalText,
  mainTitle,
  setMainTitle,
  onOpenCreate,
}: {
  videoTemplate: VideoTemplate;
  setVideoTemplate: (value: VideoTemplate) => void;
  templateHeader: string;
  setTemplateHeader: (value: string) => void;
  leftVerticalText: string;
  setLeftVerticalText: (value: string) => void;
  rightVerticalText: string;
  setRightVerticalText: (value: string) => void;
  mainTitle: string;
  setMainTitle: (value: string) => void;
  onOpenCreate?: () => void;
}) {
  const [category, setCategory] = useState<"all" | "text" | "layout">("all");
  const [editingTemplate, setEditingTemplate] = useState<VideoTemplate | null>(
    null,
  );
  const [previewingTemplate, setPreviewingTemplate] =
    useState<VideoTemplate | null>(null);
  const [previewRun, setPreviewRun] = useState(0);
  const templates: Array<{
    id: VideoTemplate;
    title: string;
    description: string;
    category: "text" | "layout";
    tags: string[];
  }> = [
    {
      id: "KNOWLEDGE_BOARD",
      title: "知识白板",
      description: "固定使用黑白火柴人画面，标题、页眉和字幕各有独立区域。",
      category: "layout",
      tags: ["16:9", "固定火柴人", "字幕避让"],
    },
    {
      id: "IMPACT_CAPTIONS",
      title: "爆点大字",
      description: "全文重点句按原文顺序逐句出现，并在同一画面持续累积。",
      category: "text",
      tags: ["16:9", "重点文字", "弹入回弹"],
    },
    {
      id: "FULL_BLEED",
      title: "全屏画面",
      description: "素材铺满画布，底部保留轻量跟读字幕，突出画面本身。",
      category: "layout",
      tags: ["全屏素材", "轻量字幕", "沉浸画面"],
    },
  ];
  const visibleTemplates = templates.filter(
    (template) => category === "all" || template.category === category,
  );
  const editingMeta = templates.find(
    (template) => template.id === editingTemplate,
  );
  const previewMeta = templates.find(
    (template) => template.id === previewingTemplate,
  );

  function useTemplate(template: VideoTemplate) {
    setVideoTemplate(template);
    onOpenCreate?.();
  }

  return (
    <main className="h-full overflow-y-auto bg-[linear-gradient(180deg,#f7f9fc_0%,#eef4f9_100%)] p-5 pb-24 text-[#17263a] md:p-7 lg:pb-7">
      <div className="w-full">
        <header className="flex min-h-[61px] items-center gap-3 border-b border-black/[0.06] pb-5">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#edf4ff] text-[#3767a5] shadow-sm ring-1 ring-black/[0.03]">
            <svg
              aria-hidden="true"
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M8 4v16M8 9h13" />
            </svg>
          </span>
          <div>
            <h1 className="text-lg font-bold md:text-xl">视频模板</h1>
            <p className="mt-1 text-sm text-black/40">
              预览、选择和调整视频模板
            </p>
          </div>
        </header>

        <div className="relative mx-auto mt-5 flex max-w-[1380px] flex-col items-center gap-3">
          <div className="inline-flex rounded-2xl border border-[#dfe6ed] bg-white p-1.5 shadow-sm">
            {[
              ["all", "全部模板"],
              ["text", "重点文字"],
              ["layout", "画面结构"],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setCategory(id as "all" | "text" | "layout")}
                className={`rounded-xl px-5 py-2.5 text-sm font-black transition ${
                  category === id
                    ? "bg-[#e9f1ff] text-[#315f9d]"
                    : "text-[#758397] hover:bg-[#f4f7fa]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs font-bold text-[#8290a0] lg:absolute lg:right-0 lg:top-1/2 lg:-translate-y-1/2">
            当前使用：
            <span className="text-[#315f9d]">
              {
                templates.find((template) => template.id === videoTemplate)
                  ?.title
              }
            </span>
          </p>
        </div>

        <section className="mx-auto mt-6 grid max-w-[1380px] gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visibleTemplates.map((template) => {
            const selected = template.id === videoTemplate;
            return (
              <article
                key={template.id}
                className={`group overflow-hidden rounded-[24px] border bg-white shadow-[0_12px_36px_rgba(47,73,96,0.08)] transition hover:-translate-y-1 hover:shadow-[0_18px_44px_rgba(47,73,96,0.13)] ${
                  selected
                    ? "border-[#5e8fd5] ring-4 ring-[#dceaff]"
                    : "border-[#dfe6ed]"
                }`}
              >
                <div className="relative aspect-video overflow-hidden bg-[#132338]">
                  <TemplateArtwork
                    template={template.id}
                    templateHeader={templateHeader}
                    mainTitle={mainTitle}
                    leftVerticalText={leftVerticalText}
                    rightVerticalText={rightVerticalText}
                  />
                  <span className="absolute top-4 left-4 rounded-full border border-white/15 bg-black/35 px-3 py-1.5 text-[10px] font-black tracking-[0.08em] text-white backdrop-blur-md">
                    {selected ? "当前使用" : "自有模板"}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewingTemplate(template.id);
                      setPreviewRun((run) => run + 1);
                    }}
                    className="absolute right-4 bottom-4 rounded-full border border-white/15 bg-black/45 px-3 py-1.5 text-[11px] font-black text-white backdrop-blur-md transition hover:bg-black/70"
                  >
                    预览
                  </button>
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <h2 className="text-xl font-black">{template.title}</h2>
                    {selected && (
                      <span className="rounded-full bg-[#eaf2ff] px-2.5 py-1 text-[10px] font-black text-[#3568a8]">
                        已选择
                      </span>
                    )}
                  </div>
                  <p className="mt-2 min-h-12 text-sm leading-6 text-[#6f7e91]">
                    {template.description}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {template.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-lg bg-[#edf4ff] px-2.5 py-1 text-[11px] font-bold text-[#4d73a4]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="mt-5 grid grid-cols-[1fr_auto] gap-2.5">
                    <button
                      type="button"
                      onClick={() => useTemplate(template.id)}
                      className="rounded-xl bg-[#315f9d] px-4 py-3 text-sm font-black text-white transition hover:bg-[#244f88]"
                    >
                      {selected ? "已选中，去创作" : "使用此模板"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingTemplate(template.id)}
                      className="rounded-xl border border-[#d8e2eb] bg-white px-4 py-3 text-sm font-black text-[#52677e] transition hover:bg-[#f3f7fa]"
                    >
                      编辑
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </section>
      </div>

      {previewingTemplate && previewMeta && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[#07131f]/60 p-4 backdrop-blur-[3px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-template-preview-title"
          onMouseDown={() => setPreviewingTemplate(null)}
        >
          <div
            className="w-full max-w-4xl rounded-[24px] bg-white p-4 shadow-2xl md:p-5"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 px-1 pb-3">
              <div>
                <p className="text-[11px] font-black tracking-[0.14em] text-[#7290ad]">
                  动画预览
                </p>
                <h2
                  id="video-template-preview-title"
                  className="mt-1 text-xl font-black"
                >
                  {previewMeta.title}
                </h2>
                <p className="mt-1 text-sm text-[#758397]">
                  {previewMeta.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewingTemplate(null)}
                className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f0f4f7] text-xl text-[#66788a]"
                aria-label="关闭模板预览"
              >
                ×
              </button>
            </div>

            <div
              key={`${previewingTemplate}-${previewRun}`}
              className="relative aspect-video overflow-hidden rounded-xl border border-[#dce5ed] bg-[#132338] shadow-[inset_0_0_0_1px_rgba(255,255,255,.06)]"
            >
              <TemplateArtwork
                template={previewingTemplate}
                templateHeader={templateHeader}
                mainTitle={mainTitle}
                leftVerticalText={leftVerticalText}
                rightVerticalText={rightVerticalText}
                animated
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-white/15">
                <div className="template-preview-progress h-full bg-[#5e8fd5]" />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-bold text-[#7b8998]">
                预览会演示文字入场、画面运动和字幕出现顺序
              </p>
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setPreviewRun((run) => run + 1)}
                  className="rounded-xl border border-[#d8e2eb] bg-white px-4 py-2.5 text-sm font-black text-[#52677e] transition hover:bg-[#f3f7fa]"
                >
                  ↻ 重新播放
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewingTemplate(null);
                    useTemplate(previewingTemplate);
                  }}
                  className="rounded-xl bg-[#315f9d] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#244f88]"
                >
                  使用此模板
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingTemplate && editingMeta && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-[#07131f]/55 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="video-template-editor-title"
          onMouseDown={() => setEditingTemplate(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[28px] bg-white p-5 shadow-2xl md:p-7"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-black tracking-[0.14em] text-[#7290ad]">
                  模板编辑
                </p>
                <h2
                  id="video-template-editor-title"
                  className="mt-1 text-2xl font-black"
                >
                  {editingMeta.title}
                </h2>
                <p className="mt-1 text-sm text-[#758397]">
                  {editingMeta.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingTemplate(null)}
                className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f0f4f7] text-xl text-[#66788a]"
                aria-label="关闭模板编辑"
              >
                ×
              </button>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="relative aspect-video overflow-hidden rounded-2xl border border-[#dce5ed] bg-[#132338] shadow-inner">
                <TemplateArtwork
                  template={editingTemplate}
                  templateHeader={templateHeader}
                  mainTitle={mainTitle}
                  leftVerticalText={leftVerticalText}
                  rightVerticalText={rightVerticalText}
                />
              </div>

              {editingTemplate === "KNOWLEDGE_BOARD" ? (
                <div className="grid content-start gap-3">
                  <TemplateTextField
                    label="主标题"
                    value={mainTitle}
                    onChange={setMainTitle}
                    placeholder="例如：职场沟通"
                  />
                  <TemplateTextField
                    label="顶部栏目"
                    value={templateHeader}
                    onChange={setTemplateHeader}
                    placeholder="思维提升 | 表达沟通 | 职场成长"
                  />
                  <TemplateTextField
                    label="左侧竖排文字"
                    value={leftVerticalText}
                    onChange={setLeftVerticalText}
                    multiline
                  />
                  <TemplateTextField
                    label="右侧竖排文字"
                    value={rightVerticalText}
                    onChange={setRightVerticalText}
                    multiline
                  />
                </div>
              ) : (
                <div className="grid content-start gap-4">
                  <div className="rounded-2xl bg-[#f2f6fa] p-4">
                    <strong className="text-sm">文字怎么修改</strong>
                    <p className="mt-2 text-sm leading-6 text-[#697b8e]">
                      {editingTemplate === "IMPACT_CAPTIONS"
                        ? "大字内容来自创作页的完整文案，系统会按原文顺序提取重点句并逐句累积。修改创作文案，模板文字会同步变化。"
                        : "全屏模板的画面和字幕跟随创作页内容生成。修改文案、画面提示词或分镜素材即可调整最终效果。"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-[#dce5ed] p-4">
                    <strong className="text-sm">模板固定效果</strong>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {editingMeta.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-lg bg-[#edf4ff] px-3 py-1.5 text-xs font-bold text-[#4d73a4]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-[#e4eaf0] pt-5">
              <button
                type="button"
                onClick={() => setEditingTemplate(null)}
                className="rounded-xl border border-[#d8e2eb] px-5 py-3 text-sm font-black text-[#5f7184]"
              >
                完成编辑
              </button>
              <button
                type="button"
                onClick={() => useTemplate(editingTemplate)}
                className="rounded-xl bg-[#315f9d] px-5 py-3 text-sm font-black text-white"
              >
                使用并进入创作
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function TemplateTextField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  const className =
    "mt-1.5 w-full rounded-xl border border-[#dce5ed] bg-[#f7f9fb] px-3 py-2.5 text-sm outline-none transition focus:border-[#6c98d1] focus:bg-white focus:ring-4 focus:ring-[#e7f0fc]";
  return (
    <label className="text-xs font-black text-[#5f7184]">
      {label}
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          placeholder={placeholder}
          className={`${className} resize-none`}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          className={className}
        />
      )}
    </label>
  );
}

function TemplateArtwork({
  template,
  templateHeader,
  mainTitle,
  leftVerticalText,
  rightVerticalText,
  animated = false,
}: {
  template: VideoTemplate;
  templateHeader: string;
  mainTitle: string;
  leftVerticalText: string;
  rightVerticalText: string;
  animated?: boolean;
}) {
  if (template === "KNOWLEDGE_BOARD") {
    return (
      <div className="absolute inset-0 overflow-hidden bg-white text-black">
        <div
          className={`absolute inset-x-[9%] top-[6%] truncate text-center text-[clamp(11px,1.5vw,22px)] font-black ${animated ? "template-preview-knowledge-title" : ""}`}
        >
          {mainTitle || "职场沟通，先把话说清楚"}
        </div>
        <div className="absolute inset-x-[18%] top-[18%] flex items-center justify-center gap-2 text-[clamp(5px,.55vw,9px)] font-bold tracking-[0.16em] text-black/40">
          <span className="h-px w-5 bg-black/30" />
          <span className="truncate">{templateHeader}</span>
          <span className="h-px w-5 bg-black/30" />
        </div>
        <div
          className={`absolute inset-x-[8%] top-[23%] h-[63%] overflow-hidden rounded-xl bg-[#dce8ef] ${animated ? "template-preview-knowledge-board" : ""}`}
        >
          <img
            src="/template-previews/knowledge-board-stick-figure.png"
            alt=""
            className="h-full w-full object-cover object-center"
          />
          <span className="absolute inset-0 bg-gradient-to-r from-black/5 via-transparent to-black/15" />
        </div>
        <span
          className="absolute top-[28%] bottom-[14%] left-[3.5%] overflow-hidden text-[clamp(4px,.45vw,8px)] leading-[1.55] text-black/20"
          style={{ writingMode: "vertical-rl" }}
        >
          {leftVerticalText.replace(/\n/gu, "")}
        </span>
        <span
          className="absolute top-[28%] right-[3.5%] bottom-[14%] overflow-hidden text-[clamp(4px,.45vw,8px)] leading-[1.55] text-black/20"
          style={{ writingMode: "vertical-rl" }}
        >
          {rightVerticalText.replace(/\n/gu, "")}
        </span>
        <div className="absolute inset-x-0 bottom-[11%] h-px bg-black/70" />
        <div
          className={`absolute inset-x-[12%] bottom-[3%] text-center text-[clamp(7px,.75vw,12px)] font-black text-white [text-shadow:0_1px_3px_rgba(0,0,0,.8)] ${animated ? "template-preview-knowledge-subtitle" : ""}`}
        >
          把复杂信息讲得更清楚
        </div>
      </div>
    );
  }
  if (template === "IMPACT_CAPTIONS") {
    return (
      <div className="absolute inset-0 overflow-hidden bg-[linear-gradient(125deg,#102739_0%,#314656_45%,#785e50_100%)]">
        <img
          src="/template-previews/workplace-thinking.png"
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-center opacity-85"
        />
        <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(5,20,31,.35),rgba(20,35,48,.48),rgba(44,28,22,.48))]" />
        <span className="absolute inset-0 bg-black/10" />
        <div
          className={`absolute inset-x-[8%] top-[24%] text-center text-[clamp(14px,2.2vw,34px)] font-black leading-none text-[#ff2457] [-webkit-text-stroke:1.5px_white] [paint-order:stroke_fill] [text-shadow:0_4px_4px_rgba(0,0,0,.75)] ${animated ? "template-preview-impact-line-one" : ""}`}
        >
          但你知道吗
        </div>
        <div
          className={`absolute inset-x-[7%] top-[47%] text-center text-[clamp(12px,1.8vw,29px)] font-black leading-none text-[#ffe700] [-webkit-text-stroke:1.5px_black] [paint-order:stroke_fill] ${animated ? "template-preview-impact-line-two" : ""}`}
        >
          很多答案你早就知道了
        </div>
        <div
          className={`absolute inset-x-0 bottom-[8%] text-center text-[clamp(6px,.65vw,11px)] font-bold text-white/75 ${animated ? "template-preview-impact-caption" : ""}`}
        >
          全文重点 · 逐句弹入 · 同屏累积
        </div>
      </div>
    );
  }
  return (
    <div className="absolute inset-0 overflow-hidden bg-[#182b3b]">
      <img
        src="/template-previews/workplace-thinking.png"
        alt=""
        className={`absolute inset-0 h-full w-full object-cover object-center ${animated ? "template-preview-full-pan" : ""}`}
      />
      <span className="absolute inset-0 bg-gradient-to-r from-black/5 via-transparent to-black/20" />
      <div className="absolute inset-x-0 bottom-0 h-[30%] bg-gradient-to-t from-black/75 to-transparent" />
      <div
        className={`absolute inset-x-[10%] bottom-[9%] rounded-lg bg-black/30 px-3 py-2 text-center text-[clamp(7px,.75vw,12px)] font-black text-white backdrop-blur-sm ${animated ? "template-preview-full-subtitle" : ""}`}
      >
        画面铺满，字幕轻量呈现
      </div>
    </div>
  );
}

function VisualPanel({
  imagePrompt,
  setImagePrompt,
  setAspectRatio,
  imageSize,
  setImageSize,
  videoTemplate,
  setVideoTemplate,
  imageApiReady,
  onOpenSettings,
}: {
  imagePrompt: string;
  setImagePrompt: (value: string) => void;
  aspectRatio: AspectRatio;
  setAspectRatio: (value: AspectRatio) => void;
  imageSize: ImageSizePreset;
  setImageSize: (value: ImageSizePreset) => void;
  videoTemplate: VideoTemplate;
  setVideoTemplate: (value: VideoTemplate) => void;
  imageApiReady: boolean;
  onOpenSettings: () => void;
}) {
  const generationSizes: Array<{
    id: ImageSizePreset;
    label: string;
    detail: string;
    shape: string;
  }> = [
    { id: "9:16", label: "9:16", detail: "720x1280", shape: "9/16" },
    { id: "16:9", label: "16:9", detail: "1280x720", shape: "16/9" },
    { id: "3:2", label: "3:2", detail: "1008x672", shape: "3/2" },
    { id: "21:9", label: "21:9", detail: "1344x576", shape: "21/9" },
    { id: "1024x1024", label: "1:1", detail: "1024x1024", shape: "1/1" },
    { id: "1040x832", label: "5:4", detail: "1040x832", shape: "5/4" },
    { id: "1024x768", label: "4:3", detail: "1024x768", shape: "4/3" },
    { id: "832x1040", label: "4:5", detail: "832x1040", shape: "4/5" },
    { id: "768x1024", label: "3:4", detail: "768x1024", shape: "3/4" },
    { id: "672x1008", label: "2:3", detail: "672x1008", shape: "2/3" },
  ];
  const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
  const [sizeMenuOpenUp, setSizeMenuOpenUp] = useState(false);
  const sizeMenuRef = useRef<HTMLDivElement>(null);
  const activeSize = imageSize;
  const activeSizeOption =
    generationSizes.find((option) => option.id === activeSize) ??
    generationSizes[0]!;

  function selectSize(value: ImageSizePreset) {
    setImageSize(value);
    if (
      (videoTemplate === "KNOWLEDGE_BOARD" && value !== "21:9") ||
      (videoTemplate === "IMPACT_CAPTIONS" && value !== "16:9")
    ) {
      setVideoTemplate("FULL_BLEED");
    }
    if (value.includes("x")) {
      const [width, height] = value.split("x").map(Number);
      if (width && height && width !== height) {
        setAspectRatio(width > height ? "LANDSCAPE" : "PORTRAIT");
      }
    } else if (value === "9:16") {
      setAspectRatio("PORTRAIT");
    } else if (value === "16:9" || value === "3:2") {
      setAspectRatio("LANDSCAPE");
    }
  }

  function toggleSizeMenu() {
    const nextOpen = !sizeMenuOpen;
    if (nextOpen && sizeMenuRef.current) {
      const rect = sizeMenuRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setSizeMenuOpenUp(spaceBelow < 360 && spaceAbove > spaceBelow);
    }
    setSizeMenuOpen(nextOpen);
  }

  useEffect(() => {
    if (!sizeMenuOpen) return;
    function closeOnOutside(event: MouseEvent) {
      if (
        sizeMenuRef.current &&
        !sizeMenuRef.current.contains(event.target as Node)
      ) {
        setSizeMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSizeMenuOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [sizeMenuOpen]);
  return (
    <div className="grid gap-6">
      <section>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-black">提示词生成</h2>
            <p className="mt-1 text-xs leading-5 text-black/40">
              描述统一画风、人物和场景要求。系统会结合每句话自动生成一张图。
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-black text-[#159aa6]">
            一句一张
          </span>
        </div>

        <PromptTemplateControls
          imagePrompt={imagePrompt}
          setImagePrompt={setImagePrompt}
        />

        <label className="mt-4 grid gap-2 text-sm font-bold">
          画面提示词
          <textarea
            value={imagePrompt}
            onChange={(event) => setImagePrompt(event.target.value)}
            rows={8}
            placeholder="例如：黑白极简火柴人插画，统一主角形象，干净浅色背景，主体居中，线条简洁，画面有故事感，不要文字和水印。"
            className="resize-none rounded-2xl border border-black/[0.08] bg-[#f6f8f9] p-4 text-sm font-medium leading-6 text-[#303740] outline-none transition placeholder:text-black/25 focus:border-[#16bec8] focus:bg-white"
          />
        </label>
        <div className="mt-2 flex items-center justify-between text-xs text-black/35">
          <span>这段提示词会应用到全部分镜，并自动附加当前句内容。</span>
          <span>{imagePrompt.length}</span>
        </div>
      </section>

      <section>
        <h3 className="text-sm font-black">生图尺寸</h3>
        <div ref={sizeMenuRef} className="relative mt-3">
          <button
            type="button"
            onClick={toggleSizeMenu}
            className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
              sizeMenuOpen
                ? "border-[#16bec8] bg-white shadow-[0_0_0_2px_rgb(22_190_200/8%)]"
                : "border-black/[0.08] bg-[#f6f8f9] hover:border-black/20"
            }`}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className="block w-14 shrink-0 rounded-md border-2 border-[#16bec8] bg-white"
                style={{ aspectRatio: activeSizeOption.shape }}
              />
              <span className="min-w-0">
                <strong className="block truncate text-sm">
                  {activeSizeOption.label}
                </strong>
                <span className="mt-0.5 block truncate text-[11px] text-black/40">
                  {activeSizeOption.detail}
                </span>
              </span>
            </span>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`shrink-0 text-black/45 transition ${
                sizeMenuOpen ? "rotate-180" : ""
              }`}
            >
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>

          {sizeMenuOpen && (
            <div
              className={`absolute inset-x-0 z-30 max-h-80 overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-2 shadow-[0_18px_40px_rgb(0_0_0/14%)] ${
                sizeMenuOpenUp ? "bottom-full mb-2" : "top-full mt-2"
              }`}
            >
              {generationSizes.map((option) => {
                const selected = activeSize === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      selectSize(option.id);
                      setSizeMenuOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
                      selected ? "bg-cyan-50" : "hover:bg-[#f1f4f5]"
                    }`}
                  >
                    <span
                      className="block w-10 shrink-0 rounded border-2 border-[#16bec8]/70 bg-white"
                      style={{ aspectRatio: option.shape }}
                    />
                    <span className="min-w-0 flex-1">
                      <strong className="block text-sm">{option.label}</strong>
                      <span className="mt-0.5 block text-[11px] text-black/40">
                        {option.detail}
                      </span>
                    </span>
                    {selected ? (
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="#159aa6"
                        strokeWidth="2.4"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {imageApiReady ? (
        <div className="rounded-2xl bg-emerald-50 p-4 text-xs font-bold leading-5 text-emerald-800">
          {videoTemplate === "KNOWLEDGE_BOARD"
            ? "图片 API 已配置。生成时会按固定 21:9 为每个句子创建独立图片。"
            : videoTemplate === "IMPACT_CAPTIONS"
              ? "图片 API 已配置。爆点大字模板固定使用 16:9，文字动画会在成片渲染时叠加。"
              : "图片 API 已配置。生成时会按所选比例为每个句子创建独立图片。"}
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-2xl bg-amber-50 p-4 text-left text-xs font-bold leading-5 text-amber-800"
        >
          提示词生图需要图片 API。点击前往配置 →
        </button>
      )}
    </div>
  );
}
function CharacterPanel({
  profiles,
  selectedProfileId,
  setSelectedProfileId,
  profileName,
  setProfileName,
  referenceFile,
  setReferenceFile,
  onProfileDeleted,
}: {
  profiles: CharacterProfileSummary[];
  selectedProfileId: string;
  setSelectedProfileId: (value: string) => void;
  profileName: string;
  setProfileName: (value: string) => void;
  referenceFile: File | undefined;
  setReferenceFile: (file: File | undefined) => void;
  onProfileDeleted: (profileId: string) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [deletingProfileId, setDeletingProfileId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleteTarget, setDeleteTarget] =
    useState<CharacterProfileSummary | null>(null);
  const uploadingNew = !selectedProfileId;

  useEffect(() => {
    if (!referenceFile) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(referenceFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [referenceFile]);

  function openDeleteProfile(profile: CharacterProfileSummary) {
    setDeleteTarget(profile);
  }

  async function confirmDeleteProfile() {
    if (!deleteTarget) return;
    const profile = deleteTarget;
    setDeletingProfileId(profile.id);
    setDeleteError("");
    try {
      const response = await fetch(`/api/character-profiles/${profile.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "参考人物删除失败");
      }
      onProfileDeleted(profile.id);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "参考人物删除失败",
      );
    } finally {
      setDeletingProfileId("");
      setDeleteTarget(null);
    }
  }

  return (
    <div>
      <h2 className="font-black">参考人物</h2>
      <p className="mt-1 text-xs leading-5 text-black/45">
        上传一张清晰人物图，保存后可在后续项目中复用，并用于保持分镜人物一致。
      </p>

      {profiles.length > 0 && (
        <section className="mt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black">已保存人物</h3>
            <span className="text-xs text-black/35">{profiles.length} 个</span>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className={`overflow-hidden rounded-xl border ${
                  selectedProfileId === profile.id
                    ? "border-cyan-400 bg-cyan-50"
                    : "border-black/[0.07] bg-white"
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    setSelectedProfileId(profile.id);
                    setReferenceFile(undefined);
                  }}
                  className="block w-full p-2 text-left"
                >
                  <span
                    role="img"
                    aria-label={profile.name}
                    className="block aspect-square rounded-lg bg-[#edf1f2] bg-cover bg-center"
                    style={{
                      backgroundImage: `url("/api/character-profiles/${profile.id}")`,
                    }}
                  />
                  <strong className="mt-2 block truncate text-xs">
                    {profile.name}
                  </strong>
                  <span className="mt-0.5 block truncate text-[11px] text-black/40">
                    {selectedProfileId === profile.id
                      ? "使用中"
                      : profile.fileName}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={deletingProfileId === profile.id}
                  onClick={() => openDeleteProfile(profile)}
                  className="w-full border-t border-black/[0.05] px-2 py-2 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-40"
                >
                  {deletingProfileId === profile.id ? "删除中…" : "删除"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-[#f1f4f5] p-1">
        <button
          type="button"
          onClick={() => setSelectedProfileId("")}
          className={`rounded-lg px-3 py-2 text-xs font-black ${
            uploadingNew ? "bg-white shadow-sm" : "text-black/40"
          }`}
        >
          上传新人物
        </button>
        <button
          type="button"
          onClick={() => {
            setSelectedProfileId("__NONE__");
            setReferenceFile(undefined);
          }}
          className={`rounded-lg px-3 py-2 text-xs font-black ${
            selectedProfileId === "__NONE__"
              ? "bg-white shadow-sm"
              : "text-black/40"
          }`}
        >
          不使用人物
        </button>
      </div>

      {uploadingNew && (
        <div className="mt-4 grid gap-4">
          <label className="grid gap-2 text-xs font-bold">
            参考人物名称
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              maxLength={40}
              placeholder="例如：我的讲解人物"
              className="rounded-xl bg-[#f1f4f5] p-3 text-sm outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </label>
          <label className="grid gap-2 text-xs font-bold">
            人物图片
            <span className="cursor-pointer rounded-xl border-2 border-dashed border-black/10 bg-[#fafbfb] p-3 text-center hover:border-cyan-400">
              {previewUrl ? (
                <span
                  role="img"
                  aria-label="参考人物预览"
                  className="mx-auto block aspect-square max-w-40 rounded-xl bg-cover bg-center"
                  style={{ backgroundImage: `url("${previewUrl}")` }}
                />
              ) : (
                <span className="grid min-h-32 place-items-center text-sm text-black/45">
                  点击上传人物图片
                </span>
              )}
              <span className="mt-2 block text-[11px] font-normal text-black/35">
                JPG、PNG 或 WebP，最大 5MB
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  setReferenceFile(file);
                  if (file && !profileName.trim()) {
                    setProfileName(file.name.replace(/\.[^.]+$/u, ""));
                  }
                }}
                className="hidden"
              />
            </span>
          </label>
          <p className="rounded-xl bg-cyan-50 p-3 text-xs leading-5 text-cyan-900">
            创建项目时会把图片保存为参考人物，以后选择后即可直接复用。
          </p>
        </div>
      )}

      {deleteError && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">
          {deleteError}
        </p>
      )}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title="删除参考人物"
        description={
          deleteTarget
            ? `确定删除参考人物“${deleteTarget.name}”吗？删除后无法恢复。`
            : ""
        }
        confirmText="确认删除"
        busy={Boolean(deleteTarget && deletingProfileId === deleteTarget.id)}
        onConfirm={() => void confirmDeleteProfile()}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function MusicPanel({
  music,
  setMusic,
}: {
  music: string;
  setMusic: (value: string) => void;
}) {
  const [libraryTracks, setLibraryTracks] = useState<
    Array<{ id: string; title: string; fileName: string }>
  >([]);
  const [libraryStatus, setLibraryStatus] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [libraryMenuOpen, setLibraryMenuOpen] = useState(false);
  const libraryMenuRef = useRef<HTMLDivElement>(null);
  const [previewTrack, setPreviewTrack] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [libraryRoot, setLibraryRoot] = useState("");
  const [librarySettingsOpen, setLibrarySettingsOpen] = useState(false);
  const [libraryRootDraft, setLibraryRootDraft] = useState("");
  const [librarySettingsBusy, setLibrarySettingsBusy] = useState(false);
  const [librarySettingsError, setLibrarySettingsError] = useState("");

  const loadLibraryTracks = useCallback(async () => {
    setLibraryStatus("loading");
    try {
      const response = await fetch("/api/music-library");
      if (!response.ok) throw new Error("音乐库读取失败");
      const data = (await response.json()) as {
        root?: string;
        tracks?: Array<{ id: string; title: string; fileName: string }>;
      };
      setLibraryRoot(data.root ?? "");
      setLibraryTracks(data.tracks ?? []);
      setLibraryStatus("ready");
    } catch {
      setLibraryStatus("error");
    }
  }, []);

  useEffect(() => {
    void loadLibraryTracks();
  }, [loadLibraryTracks]);

  async function saveMusicLibraryRoot() {
    const root = libraryRootDraft.trim();
    if (!root) return;
    setLibrarySettingsBusy(true);
    setLibrarySettingsError("");
    try {
      const response = await fetch(
        "http://127.0.0.1:4317/music-library/settings",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ root }),
        },
      );
      const data = (await response.json()) as {
        root?: string;
        error?: string;
      };
      if (!response.ok || !data.root) {
        throw new Error(data.error ?? "音乐库设置保存失败");
      }
      setLibraryRoot(data.root);
      setLibrarySettingsOpen(false);
      await loadLibraryTracks();
    } catch (reason) {
      setLibrarySettingsError(
        reason instanceof Error ? reason.message : "音乐库设置保存失败",
      );
    } finally {
      setLibrarySettingsBusy(false);
    }
  }

  useEffect(() => {
    if (!libraryMenuOpen) return;
    function closeOnOutside(event: MouseEvent) {
      if (
        libraryMenuRef.current &&
        !libraryMenuRef.current.contains(event.target as Node)
      ) {
        setLibraryMenuOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setLibraryMenuOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [libraryMenuOpen]);

  useEffect(() => {
    if (!libraryMenuOpen) {
      setPreviewTrack("");
      setPreviewError("");
    }
  }, [libraryMenuOpen]);

  const autoMatchActive =
    music === "AUTO_MATCH" || music.startsWith("AUTO_MATCH:");
  const selectedLibraryLabel = music.startsWith("AUTO_MATCH:")
    ? (libraryTracks.find((track) => `AUTO_MATCH:${track.fileName}` === music)
        ?.title ?? "自动选择（根据文案主题）")
    : "自动选择（根据文案主题）";

  return (
    <div className="grid gap-4">
      <div>
        <h2 className="font-black">背景音乐</h2>
        <p className="mt-1 text-xs leading-5 text-black/40">
          创建项目后可以上传已获授权的背景音乐，渲染时会自动压低音乐突出人声。
        </p>
        <div className="mt-4 grid gap-3">
          <button
            type="button"
            onClick={() => setMusic("NONE")}
            className={`rounded-2xl border p-4 text-left ${
              music === "NONE"
                ? "border-[#14bdc7] bg-cyan-50"
                : "border-black/[0.06]"
            }`}
          >
            <strong className="text-sm">♫ 暂不添加</strong>
            <p className="mt-1 text-xs text-black/40">保持纯净旁白</p>
          </button>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setMusic("AUTO_MATCH")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setMusic("AUTO_MATCH");
              }
            }}
            className={`rounded-2xl border p-4 text-left ${
              autoMatchActive
                ? "border-[#14bdc7] bg-cyan-50"
                : "border-black/[0.06]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <strong className="text-sm">♫ 自动匹配</strong>
                <p className="mt-1 text-xs text-black/40">
                  根据文案主题从音乐库自动选曲，也可以手动指定一首
                </p>
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setLibraryRootDraft(libraryRoot);
                  setLibrarySettingsError("");
                  setLibrarySettingsOpen(true);
                }}
                className="shrink-0 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-[11px] font-black text-black/55 transition hover:bg-[#f7f9fa]"
              >
                设置
              </button>
            </div>
            {autoMatchActive && (
              <div
                ref={libraryMenuRef}
                className="mt-3"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={libraryMenuOpen}
                  onClick={() => setLibraryMenuOpen((open) => !open)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-black/[0.08] bg-white px-3 py-3 text-left text-sm font-bold outline-none transition hover:border-black/20"
                >
                  <span className="min-w-0 truncate">
                    {selectedLibraryLabel}
                  </span>
                  <span
                    aria-hidden="true"
                    className={`shrink-0 text-black/35 transition-transform ${
                      libraryMenuOpen ? "rotate-180" : ""
                    }`}
                  >
                    ⌄
                  </span>
                </button>
                {libraryMenuOpen && (
                  <div
                    role="listbox"
                    aria-label="音乐库"
                    className="mt-2 max-h-64 overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-2 shadow-[0_18px_45px_rgb(15_23_42/15%)]"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={music === "AUTO_MATCH"}
                      onClick={() => {
                        setMusic("AUTO_MATCH");
                        setLibraryMenuOpen(false);
                      }}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold transition ${
                        music === "AUTO_MATCH"
                          ? "bg-cyan-50 text-cyan-900"
                          : "hover:bg-[#f7f9fa]"
                      }`}
                    >
                      自动选择（根据文案主题）
                      {music === "AUTO_MATCH" && <span>✓</span>}
                    </button>
                    {libraryTracks.map((track) => {
                      const selected = music === `AUTO_MATCH:${track.fileName}`;
                      const previewing = previewTrack === track.fileName;
                      return (
                        <div
                          key={track.id}
                          className={`rounded-lg ${
                            selected ? "bg-cyan-50" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2 px-1">
                            <button
                              type="button"
                              role="option"
                              aria-selected={selected}
                              onClick={() => {
                                setMusic(`AUTO_MATCH:${track.fileName}`);
                                setLibraryMenuOpen(false);
                              }}
                              className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-left text-sm font-bold transition hover:bg-[#f7f9fa]"
                            >
                              <span className="min-w-0 truncate">
                                {track.title}
                              </span>
                              {selected && <span>✓</span>}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPreviewTrack(
                                  previewing ? "" : track.fileName,
                                );
                                setPreviewError("");
                              }}
                              className={`shrink-0 rounded-lg border px-2.5 py-2 text-[11px] font-black transition ${
                                previewing
                                  ? "border-cyan-200 bg-cyan-50 text-cyan-700"
                                  : "border-black/10 bg-white text-black/55 hover:bg-[#f7f9fa]"
                              }`}
                            >
                              {previewing ? "收起" : "▶ 试听"}
                            </button>
                          </div>
                          {previewing && (
                            <audio
                              autoPlay
                              controls
                              preload="auto"
                              className="h-8 w-full px-1 pb-1"
                              src={`/api/music-library/audio?file=${encodeURIComponent(track.fileName)}`}
                              onError={() =>
                                setPreviewError(`试听加载失败：${track.title}`)
                              }
                            >
                              <track kind="captions" />
                            </audio>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {previewError && (
                  <p className="mt-2 text-xs font-bold text-red-600">
                    {previewError}
                  </p>
                )}
                {libraryStatus === "loading" && (
                  <p className="mt-2 text-xs text-black/40">正在读取音乐库…</p>
                )}
                {libraryStatus === "error" && (
                  <p className="mt-2 text-xs font-bold text-red-600">
                    音乐库读取失败，请检查
                    {libraryRoot ? ` ${libraryRoot} ` : "音乐库目录"}
                    是否存在
                  </p>
                )}
                {libraryStatus === "ready" && libraryTracks.length === 0 && (
                  <p className="mt-2 text-xs font-bold text-amber-700">
                    音乐库还没有音乐，自动匹配会先跳过配乐
                  </p>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setMusic("UPLOAD")}
            className={`rounded-2xl border p-4 text-left ${
              music === "UPLOAD"
                ? "border-[#14bdc7] bg-cyan-50"
                : "border-black/[0.06]"
            }`}
          >
            <strong className="text-sm">♫ 创建后上传</strong>
            <p className="mt-1 text-xs text-black/40">支持本地授权音频文件</p>
          </button>
        </div>
      </div>
      <AppDialog
        open={librarySettingsOpen}
        title="音乐库设置"
        description="指定自动匹配和下拉框使用的音乐文件夹，保存后立即生效。"
        confirmLabel="保存"
        busy={librarySettingsBusy}
        confirmDisabled={!libraryRootDraft.trim()}
        input={{
          label: "音乐库文件夹路径",
          value: libraryRootDraft,
          placeholder: "例如：E:\\codex\\素材库\\音乐库",
          ...(librarySettingsError ? { error: librarySettingsError } : {}),
          onChange: setLibraryRootDraft,
        }}
        onConfirm={() => void saveMusicLibraryRoot()}
        onCancel={() => setLibrarySettingsOpen(false)}
      />
    </div>
  );
}
