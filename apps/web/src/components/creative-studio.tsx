"use client";

import { useEffect, useMemo, useState } from "react";

import { GenerationAnalysisOverlay } from "./generation-analysis-overlay";
import {
  VoiceProfilePanel,
  type VoiceCloneLanguage,
  type VoiceProfileSummary,
} from "./voice-profile-panel";

type StudioTab = "visual" | "character" | "voice" | "music";
type AspectRatio = "PORTRAIT" | "LANDSCAPE";
type OutputMode = "NARRATED" | "VISUAL_ONLY";
type VideoTemplate = "FULL_BLEED" | "KNOWLEDGE_BOARD";

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
  { id: "character", label: "角色" },
  { id: "voice", label: "配音" },
  { id: "music", label: "音乐" },
];

export function CreativeStudio({
  onProjectCreated,
  onOpenSettings,
}: {
  onProjectCreated: (projectId: string) => void | Promise<void>;
  onOpenSettings: () => void;
}) {
  const [activeTab, setActiveTab] = useState<StudioTab>("visual");
  const [sourceText, setSourceText] = useState("");
  const [sourceKind, setSourceKind] = useState<"FULL_TEXT" | "TOPIC">(
    "FULL_TEXT",
  );
  const [imagePrompt, setImagePrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("LANDSCAPE");
  const [videoTemplate, setVideoTemplate] =
    useState<VideoTemplate>("KNOWLEDGE_BOARD");
  const [templateHeader, setTemplateHeader] = useState(
    "— 思维提升 | 表达沟通 | 职场成长 | 自我突破 —",
  );
  const [outputMode, setOutputMode] = useState<OutputMode>("NARRATED");
  const [voiceStyle, setVoiceStyle] = useState("voxcpm2");
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfileSummary[]>([]);
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState("");
  const [voiceProfileName, setVoiceProfileName] = useState("我的声音");
  const [voiceReferenceFile, setVoiceReferenceFile] = useState<File>();
  const [voicePromptText, setVoicePromptText] = useState("");
  const [voicePromptLanguage, setVoicePromptLanguage] =
    useState<VoiceCloneLanguage>("zh");
  const [voiceServiceUrl, setVoiceServiceUrl] = useState(
    "http://127.0.0.1:9880",
  );
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
  const [music, setMusic] = useState("NONE");
  const [keepOriginal, setKeepOriginal] = useState(true);
  const [imageApiReady, setImageApiReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");

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
    fetch("http://127.0.0.1:4317/settings/openai")
      .then((response) => response.json())
      .then((data: { settings?: { imageApiKeyConfigured?: boolean } }) =>
        setImageApiReady(Boolean(data.settings?.imageApiKeyConfigured)),
      )
      .catch(() => setImageApiReady(false));
  }, []);
  const projectTitle = useMemo(() => {
    const firstLine = sourceText
      .trim()
      .split(/\r?\n/u)
      .find((line) => line.trim());
    if (!firstLine) return "未命名视频";
    const cleaned = firstLine.replace(/[。！？!?]+$/u, "").trim();
    return cleaned.length > 28 ? `${cleaned.slice(0, 28)}…` : cleaned;
  }, [sourceText]);

  async function submit() {
    const copy = sourceText.trim();
    if (copy.length < 2) {
      setError("请先输入主题或完整文案");
      return;
    }
    if (
      outputMode === "NARRATED" &&
      voiceStyle === "voxcpm2" &&
      !selectedVoiceProfileId &&
      (!voiceReferenceFile ||
        !voiceConsentConfirmed ||
        voiceProfileName.trim().length < 1)
    ) {
      setError("请上传声音并确认声音授权");
      setActiveTab("voice");
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
      setError("提示词生图需要第三方图像 API，请先前往 API 设置保存密钥");
      setActiveTab("visual");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: projectTitle,
          sourceText: copy,
          sourceKind,
          aspectRatio,
          language: "zh-CN",
          voiceStyle,
          voiceProfileId: selectedVoiceProfileId || undefined,
          characterProfileId:
            selectedCharacterProfileId &&
            selectedCharacterProfileId !== "__NONE__"
              ? selectedCharacterProfileId
              : undefined,
          accentColor: "#19b9c6",
          visualMode: "AI_IMAGE",
          imagePrompt: imagePrompt.trim(),
          includeNarration: outputMode === "NARRATED",
          includeSubtitles: outputMode === "NARRATED",
          subtitleStyle: {
            mode: "CHINESE",
            fontSize: 60,
            position: "BOTTOM",
            outline: true,
            shadow: true,
            keywordHighlight: true,

            videoTemplate,
            headerText:
              videoTemplate === "KNOWLEDGE_BOARD" ? templateHeader.trim() : "",
            transitionsEnabled,
          },
        }),
      });
      const data = (await response.json()) as {
        project?: { id: string };
        error?: string;
      };
      if (!response.ok || !data.project) {
        throw new Error(data.error ?? "项目创建失败");
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
      if (
        outputMode === "NARRATED" &&
        voiceStyle === "voxcpm2" &&
        !selectedVoiceProfileId
      ) {
        const referenceFile = voiceReferenceFile;
        if (!referenceFile) throw new Error("VOICE_REFERENCE_REQUIRED");
        const extension = referenceFile.name.split(".").pop()?.toLowerCase();
        const referenceContentType =
          referenceFile.type ||
          ({
            wav: "audio/wav",
            mp3: "audio/mpeg",
            m4a: "audio/mp4",
            aac: "audio/aac",
            flac: "audio/flac",
          }[extension ?? ""] ??
            "application/octet-stream");
        const endpoint = "voice-clone";
        const setup = await fetch(
          `/api/projects/${data.project.id}/${endpoint}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              profileName: voiceProfileName.trim(),
              fileName: referenceFile.name,
              contentType: referenceContentType,
              byteSize: referenceFile.size,
              promptText: voicePromptText.trim(),
              promptLanguage: voicePromptLanguage,
              serviceUrl: voiceServiceUrl,
              consentConfirmed: voiceConsentConfirmed,
            }),
          },
        );
        const setupData = (await setup.json()) as {
          assetId?: string;
          uploadUrl?: string;
          error?: string;
        };
        if (!setup.ok || !setupData.uploadUrl || !setupData.assetId) {
          throw new Error(setupData.error ?? "VoxCPM2 声音参考配置失败");
        }
        const upload = await fetch(setupData.uploadUrl, {
          method: "PUT",
          headers: { "content-type": referenceContentType },
          body: referenceFile,
        });
        if (!upload.ok) throw new Error("声音上传失败");
      }
      const generation = await fetch(
        `/api/projects/${data.project.id}/storyboard/generate`,
        { method: "POST" },
      );
      if (!generation.ok) {
        throw new Error("项目已创建，但分镜任务启动失败");
      }
      await onProjectCreated(data.project.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建失败");
      setBusy(false);
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-[#e7edef] p-2 text-[#20252b] lg:overflow-hidden">
      <div className="grid min-h-[calc(100vh-1rem)] gap-2 lg:h-full lg:grid-cols-[minmax(0,1fr)_440px]">
        <section className="relative flex min-h-[680px] flex-col overflow-hidden rounded-2xl bg-white shadow-[0_1px_3px_rgb(20_35_45/8%)]">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-black/[0.04] px-6 py-4 md:px-10">
            <div className="flex items-center gap-3">
              <span
                className="grid size-9 place-items-center rounded-xl bg-[#11151b] text-white"
                aria-hidden="true"
              >
                ●
              </span>
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

          <div className="flex min-h-0 flex-1 flex-col px-6 pb-5 pt-6 md:px-[10%] md:pt-8">
            <div className="flex flex-wrap items-center gap-3 text-sm text-[#a0a8b3]">
              <span>支持创作想法、口播稿或分镜脚本</span>
              <button
                type="button"
                onClick={() => {
                  if (!sourceText) setSourceText(sampleCopy);
                  setHint("文案助手已准备示例结构，你可以继续修改");
                }}
                className="font-black text-[#477cff]"
              >
                ✦ 文案助手
              </button>
            </div>
            <button
              type="button"
              onClick={() => setSourceText(sampleCopy)}
              className="mt-3 w-fit rounded-lg border border-[#dfe5e8] px-3 py-1.5 text-xs font-bold text-[#8d97a3] transition hover:border-[#19b9c6] hover:text-[#19a8b5]"
            >
              示例文案
            </button>

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
              className="mt-5 min-h-[430px] flex-1 resize-none border-0 bg-transparent text-lg leading-9 text-[#303740] outline-none placeholder:text-[#c6ccd2]"
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
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={keepOriginal}
                    onChange={(event) => setKeepOriginal(event.target.checked)}
                    className="size-4 accent-[#19b9c6]"
                  />
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

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {activeTab === "visual" && (
              <VisualPanel
                imagePrompt={imagePrompt}
                setImagePrompt={setImagePrompt}
                aspectRatio={aspectRatio}
                setAspectRatio={setAspectRatio}
                videoTemplate={videoTemplate}
                setVideoTemplate={setVideoTemplate}
                templateHeader={templateHeader}
                setTemplateHeader={setTemplateHeader}
                transitionsEnabled={transitionsEnabled}
                setTransitionsEnabled={setTransitionsEnabled}
                imageApiReady={imageApiReady}
                onOpenSettings={onOpenSettings}
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
                promptText={voicePromptText}
                setPromptText={setVoicePromptText}
                promptLanguage={voicePromptLanguage}
                setPromptLanguage={setVoicePromptLanguage}
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
                {"\u751f\u6210\u6bd4\u4f8b\uff1a"}
                {aspectRatio === "PORTRAIT" ? "9:16" : "16:9"}
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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0c1016] px-5 py-4 text-lg font-black text-white transition hover:bg-[#19aeb8] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-cyan-300 via-blue-500 to-violet-500 text-xs">
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

  async function removeTemplate() {
    if (!selectedId || !window.confirm(promptTemplateText.confirmRemove))
      return;
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
        <select
          value={selectedId}
          onChange={(event) => selectTemplate(event.target.value)}
          className="w-full rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#16bec8]"
        >
          <option value="">{promptTemplateText.select}</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name}
            </option>
          ))}
        </select>
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
            onClick={() => void removeTemplate()}
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
    </div>
  );
}
function VisualPanel({
  imagePrompt,
  setImagePrompt,
  aspectRatio,
  setAspectRatio,
  videoTemplate,
  setVideoTemplate,
  templateHeader,
  setTemplateHeader,
  transitionsEnabled,
  setTransitionsEnabled,
  imageApiReady,
  onOpenSettings,
}: {
  imagePrompt: string;
  setImagePrompt: (value: string) => void;
  aspectRatio: AspectRatio;
  setAspectRatio: (value: AspectRatio) => void;
  videoTemplate: VideoTemplate;
  setVideoTemplate: (value: VideoTemplate) => void;
  templateHeader: string;
  setTemplateHeader: (value: string) => void;
  transitionsEnabled: boolean;
  setTransitionsEnabled: (value: boolean) => void;
  imageApiReady: boolean;
  onOpenSettings: () => void;
}) {
  const ratios: Array<{
    id: AspectRatio;
    label: string;
    detail: string;
  }> = [
    { id: "LANDSCAPE", label: "16:9 横屏", detail: "适合电脑、网页与横版视频" },
    { id: "PORTRAIT", label: "9:16 竖屏", detail: "适合短视频与手机全屏" },
  ];
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
        <h3 className="text-sm font-black">生成比例</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {ratios.map((ratio) => (
            <button
              key={ratio.id}
              type="button"
              onClick={() => setAspectRatio(ratio.id)}
              className={`rounded-2xl border p-3 text-left transition ${
                aspectRatio === ratio.id
                  ? "border-[#16bec8] bg-cyan-50 shadow-[0_0_0_2px_rgb(22_190_200/8%)]"
                  : "border-black/[0.07] bg-white hover:border-black/20"
              }`}
            >
              <span
                className={`mb-3 block rounded-md border-2 ${
                  ratio.id === "LANDSCAPE"
                    ? "aspect-video w-16"
                    : "aspect-[9/16] h-16"
                } ${
                  aspectRatio === ratio.id
                    ? "border-[#16bec8] bg-white"
                    : "border-[#9aa4ae] bg-[#f1f4f5]"
                }`}
              />
              <strong className="block text-sm">{ratio.label}</strong>
              <span className="mt-1 block text-[11px] leading-4 text-black/40">
                {ratio.detail}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-black">视频模板</h3>
        <p className="mt-1 text-xs leading-5 text-black/40">
          知识白板会缩小分镜图片，并为顶部标题和底部字幕保留独立区域。
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setVideoTemplate("KNOWLEDGE_BOARD")}
            className={`rounded-2xl border p-3 text-left transition ${
              videoTemplate === "KNOWLEDGE_BOARD"
                ? "border-[#16bec8] bg-cyan-50"
                : "border-black/[0.07] bg-white"
            }`}
          >
            <span className="relative mb-3 block aspect-video overflow-hidden rounded-lg border border-black/10 bg-white">
              <span className="absolute inset-x-[14%] top-[8%] h-1 rounded bg-black/70" />
              <span className="absolute inset-x-[17%] top-[25%] bottom-[27%] rounded bg-gradient-to-br from-slate-100 to-cyan-100" />
              <span className="absolute inset-x-0 bottom-[20%] h-px bg-black" />
              <span className="absolute inset-x-[25%] bottom-[8%] h-1.5 rounded bg-black/70" />
            </span>
            <strong className="block text-sm">知识白板</strong>
            <span className="mt-1 block text-[11px] text-black/40">
              图片缩小，字幕不遮挡画面
            </span>
          </button>
          <button
            type="button"
            onClick={() => setVideoTemplate("FULL_BLEED")}
            className={`rounded-2xl border p-3 text-left transition ${
              videoTemplate === "FULL_BLEED"
                ? "border-[#16bec8] bg-cyan-50"
                : "border-black/[0.07] bg-white"
            }`}
          >
            <span className="relative mb-3 block aspect-video overflow-hidden rounded-lg bg-gradient-to-br from-slate-300 via-cyan-100 to-orange-100">
              <span className="absolute inset-x-[18%] bottom-[12%] h-2 rounded bg-white shadow" />
            </span>
            <strong className="block text-sm">全屏画面</strong>
            <span className="mt-1 block text-[11px] text-black/40">
              保留原来的铺满画面样式
            </span>
          </button>
        </div>
        {videoTemplate === "KNOWLEDGE_BOARD" && (
          <label className="mt-4 grid gap-2 text-sm font-bold">
            顶部栏目标题
            <input
              value={templateHeader}
              onChange={(event) => setTemplateHeader(event.target.value)}
              maxLength={120}
              placeholder="例如：— 思维提升 | 表达沟通 | 职场成长 —"
              className="rounded-xl border border-black/[0.08] bg-[#f6f8f9] p-3 text-sm outline-none focus:border-[#16bec8] focus:bg-white"
            />
          </label>
        )}
      </section>

      <section>
        <h3 className="text-sm font-black">镜头转场</h3>
        <p className="mt-1 text-xs leading-5 text-black/40">
          添加转场会使用淡入、溶解、推入或缩放；关闭后镜头直接切换。
        </p>
        <div className="mt-3 grid grid-cols-2 rounded-xl bg-[#f0f3f4] p-1">
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
      </section>

      {imageApiReady ? (
        <div className="rounded-2xl bg-emerald-50 p-4 text-xs font-bold leading-5 text-emerald-800">
          图片 API 已配置。生成时会按所选比例为每个句子创建独立图片。
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenSettings}
          className="rounded-2xl bg-amber-50 p-4 text-left text-xs font-bold leading-5 text-amber-800"
        >
          提示词生图需要第三方图片 API。点击前往配置 →
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

  async function deleteProfile(profile: CharacterProfileSummary) {
    if (!window.confirm(`确定删除参考人物“${profile.name}”吗？`)) return;
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
                  onClick={() => void deleteProfile(profile)}
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
    </div>
  );
}

export function VoicePanel({
  voiceStyle,
  setVoiceStyle,
}: {
  voiceStyle: string;
  setVoiceStyle: (value: string) => void;
}) {
  return (
    <div>
      <h2 className="font-black">旁白声音</h2>
      <p className="mt-1 text-xs leading-5 text-black/40">
        旁白会在分镜生成后逐镜创建，并明确标记为 AI 生成。
      </p>
      <div className="mt-4 grid gap-3">
        {[
          ["alloy", "清晰中性", "自然、稳定，适合知识讲解"],
          ["nova", "明亮活力", "节奏轻快，适合故事内容"],
          ["echo", "沉稳叙述", "声音厚实，适合商业主题"],
        ].map(([id, label, description]) => (
          <button
            key={id}
            type="button"
            onClick={() => setVoiceStyle(id ?? "")}
            className={`rounded-2xl border p-4 text-left ${
              voiceStyle === id
                ? "border-[#14bdc7] bg-cyan-50"
                : "border-black/[0.06]"
            }`}
          >
            <strong className="text-sm">◉ {label}</strong>
            <p className="mt-1 text-xs text-black/40">{description}</p>
          </button>
        ))}
      </div>
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
  const [soundEffects, setSoundEffects] = useState<
    Array<{
      tag: string;
      assetId: string;
      displayName: string;
      source: "builtin-synthesized" | "user-local-library";
      license: string;
    }>
  >([]);
  const [previewTag, setPreviewTag] = useState("");
  const soundEffectLabels: Record<string, string> = {
    pop: "弹出 / 灵感",
    click: "点击 / 按钮",
    whoosh: "转场 / 飞过",
    success: "成功 / 完成",
    error: "错误 / 警告",
    typing: "键盘 / 打字",
    clock: "时钟 / 倒计时",
    impact: "重点 / 冲击",
    laughter: "笑声",
    applause: "掌声",
    cheer: "欢呼",
    surprise: "惊讶",
    question: "疑问",
    notification: "通知提示",
    camera: "相机快门",
    phone: "电话手机",
    footsteps: "脚步",
    door: "开关门",
    money: "金币到账",
    food: "吃喝",
    cooking: "烹饪厨房",
    water: "水流雨声",
    nature: "自然环境",
    traffic: "交通车辆",
    crowd: "人群环境",
    animal: "动物",
    magic: "魔法能量",
    tension: "紧张悬疑",
    sad: "悲伤叹气",
    game: "游戏升级",
    mechanical: "机械金属",
    sci_fi: "科幻未来",
  };

  useEffect(() => {
    let active = true;
    fetch("http://127.0.0.1:4317/sound-effects/catalog")
      .then(async (response) => {
        if (!response.ok) throw new Error("SFX_CATALOG_LOAD_FAILED");
        return (await response.json()) as {
          assets?: typeof soundEffects;
        };
      })
      .then((data) => {
        if (!active) return;
        const assets = data.assets ?? [];
        setSoundEffects(assets);
        setPreviewTag((current) => current || assets[0]?.tag || "");
      })
      .catch(() => {
        if (active) setSoundEffects([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const previewEffect = soundEffects.find(
    (effect) => effect.tag === previewTag,
  );

  return (
    <div>
      <h2 className="font-black">自动音效</h2>
      <div className="mt-3 rounded-2xl border border-[#16bec8]/30 bg-cyan-50 p-4">
        <div className="flex items-center justify-between gap-3">
          <strong className="text-sm text-[#168b94]">已开启</strong>
          <span className="rounded-full bg-white px-2 py-1 text-[10px] font-black text-[#16a5ae]">
            用户素材 + CC0 兜底
          </span>
        </div>
        <p className="mt-2 text-xs leading-5 text-black/50">
          系统会根据分镜语义自动添加少量音效，并自动压低音量，避免盖住朗读。
        </p>
        <div className="mt-3 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
          {soundEffects.map((effect) => (
            <span
              key={effect.tag}
              className="rounded-md bg-white px-2 py-1 text-[10px] font-bold text-black/45"
            >
              {soundEffectLabels[effect.tag] ?? effect.tag}
            </span>
          ))}
        </div>
        {soundEffects.length > 0 && (
          <div className="mt-4 rounded-xl bg-white p-3">
            <div className="flex items-center justify-between gap-3">
              <strong className="text-xs">
                音效试听 · {soundEffects.length} 类
              </strong>
              <select
                value={previewTag}
                onChange={(event) => setPreviewTag(event.target.value)}
                className="min-w-0 max-w-48 rounded-lg border border-black/10 px-2 py-1 text-xs outline-none"
              >
                {soundEffects.map((effect) => (
                  <option key={effect.tag} value={effect.tag}>
                    {soundEffectLabels[effect.tag] ?? effect.tag} ·{" "}
                    {effect.displayName}
                  </option>
                ))}
              </select>
            </div>
            {previewEffect && (
              <>
                <audio
                  key={previewEffect.assetId}
                  controls
                  preload="none"
                  src={`/api/assets/${previewEffect.assetId}/content`}
                  className="mt-3 h-9 w-full"
                />
                <p className="mt-2 text-[10px] leading-4 text-black/35">
                  {previewEffect.source === "user-local-library"
                    ? "来自 E:\\codex\\素材库，使用权由本地素材提供者确认"
                    : "StickMotion 本地合成 CC0 兜底音效"}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <h2 className="mt-6 border-t border-black/[0.06] pt-5 font-black">
        背景音乐
      </h2>
      <p className="mt-1 text-xs leading-5 text-black/40">
        创建项目后可以上传已获授权的背景音乐，渲染时会自动压低音乐突出人声。
      </p>
      <div className="mt-4 grid gap-3">
        {[
          ["NONE", "暂不添加", "保持纯净旁白"],
          ["UPLOAD", "创建后上传", "支持本地授权音频文件"],
        ].map(([id, label, description]) => (
          <button
            key={id}
            type="button"
            onClick={() => setMusic(id ?? "")}
            className={`rounded-2xl border p-4 text-left ${
              music === id
                ? "border-[#14bdc7] bg-cyan-50"
                : "border-black/[0.06]"
            }`}
          >
            <strong className="text-sm">♫ {label}</strong>
            <p className="mt-1 text-xs text-black/40">{description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
