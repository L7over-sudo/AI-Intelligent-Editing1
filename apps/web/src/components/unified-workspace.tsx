"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { z } from "zod";

import {
  dialogueCompletionInputSchema,
  dialogueConversationStorageKey,
  dialogueCompletionResponseSchema,
  groupScenesForContinuousVoice,
  parseStoredDialogueState,
  subtitleStyleSchema,
  type DialogueMessage,
} from "@stickmotion/shared";

import {
  characterCoverTemplateId,
  coverDownloadFileName,
  coverTemplateId,
  coverTemplateStorageKey,
  defaultSavedCoverName,
  defaultCoverTemplate,
  defaultCharacterCoverTemplate,
  isOfficialCoverTemplateId,
  officialCoverTemplates,
  parseSavedCoverTemplates,
  parseStoredCoverTemplate,
  type CoverTemplateData,
  type OfficialCoverTemplateId,
  type SavedCoverTemplate,
} from "./cover-template";
import { AppDialog } from "./app-dialog";
import { CoverTemplatePreview } from "./cover-template-preview";
import { CreativeStudio } from "./creative-studio";
import {
  dialogueUiStateStorageKey,
  emptyDialogueUiState,
  parseStoredDialogueUiState,
  type DialogueUiState,
} from "./dialogue-ui-state";
import {
  findReadyProjectCoverAssets,
  projectCoverDisplayState,
  type ProjectCoverAsset,
} from "./project-cover-assets";
import { canCancelRenderJob, canDeleteRenderJob } from "./render-job-actions";
import {
  failedVoiceSceneIds,
  latestVoiceJobAttempts,
} from "./voice-job-actions";
import type { VoiceProfileSummary } from "./voice-profile-dropdown";
import { ToolbarVoicePicker } from "./toolbar-voice-picker";
import {
  renderProgressPresentation,
  renderProgressSteps,
} from "./render-progress";
import {
  parseStoredProjectWorkspaceState,
  parseStoredWorkspaceState,
  projectWorkspaceStateStorageKey,
  workspaceStateStorageKey,
  type ProjectWorkspaceState,
  type WorkspaceView,
} from "./workspace-state";
import {
  downloadBlob,
  downloadCoverTemplatePng,
} from "./download-cover-template";
import {
  parseStoredSearchWorkspace,
  researchApiErrorSchema,
  researchAuthorizationResponseSchema,
  retainedSearchPlatformIdSchema,
  searchResponseSchema,
  searchStatusResponseSchema,
  searchWorkspaceStorageKey,
  type RetainedSearchPlatformId,
  type SearchPlatform,
  type SearchResponse,
} from "../search-bridge";

type ImageModel =
  | "gpt-image-2"
  | "gpt-image-2pro"
  | "gpt-image-2-template"
  | "nano-banana-2"
  | "nano-banana-pro";
type ImageSize = "1K" | "2K" | "4K";

interface ProjectSummary {
  id: string;
  title: string;
  status: string;
  revision: number;
  targetDuration: number;
  updatedAt: string;
  subtitleStyle: unknown;
  _count: { scenes: number };
  assets: ProjectCoverAsset[];
}

interface Scene {
  id: string;
  order: number;
  narration: string;
  subtitle: string;
  estimatedDuration: number;
  revision: number;
  visualPrompt: string;
  voiceTracks: Array<{ id: string; aiGenerated: boolean }>;
  sceneAssets: Array<{
    asset: {
      id: string;
      metadata?: {
        projectRevision?: number;
        sceneRevision?: number;
      } | null;
    };
  }>;
}

interface Job {
  id: string;
  type: string;
  status: string;
  progress: number;
  errorMessage?: string | null;
  createdAt: string;
  input?: {
    sceneId?: string;
    sceneIds?: string[];
    action?: "CREATE" | "INSTALL";
    draftJobId?: string;
  };
  output?: {
    action?: "CREATE" | "INSTALL";
    draftId?: string;
    stagingPath?: string;
    installedPath?: string;
    draftJobId?: string;
    stagingRemoved?: boolean;
  } | null;
}
interface RenderOutput {
  id: string;
  assetId: string;
  width: number;
  height: number;
  durationMs: number;
  createdAt: string;
  asset: {
    objectKey: string;
    source: string;
  };
}

interface Project {
  id: string;
  title: string;
  status: string;
  revision: number;
  aspectRatio: "PORTRAIT" | "LANDSCAPE";
  accentColor: string;
  visualMode: "TEMPLATE" | "AI_IMAGE";
  targetDuration: number;
  sourceText: string;
  voiceStyle: string;
  voiceProfileId: string | null;
  scenes: Scene[];
  jobs: Job[];
  renderOutputs: RenderOutput[];
}

function getCurrentSceneImage(project: Project, scene: Scene) {
  return scene.sceneAssets.find(
    (link) =>
      link.asset.metadata?.projectRevision === project.revision &&
      link.asset.metadata?.sceneRevision === scene.revision,
  );
}

interface Settings {
  apiKeyConfigured: boolean;
  apiBaseUrl: string;
  imageApiKeyConfigured: boolean;
  imageApiBaseUrl: string;
  imageModel: ImageModel;
  imageSize: ImageSize;
  scriptModel: string;
}

const settingsSchema = z.object({
  apiKeyConfigured: z.boolean(),
  apiBaseUrl: z.string(),
  imageApiKeyConfigured: z.boolean(),
  imageApiBaseUrl: z.string(),
  imageModel: z.enum([
    "gpt-image-2",
    "gpt-image-2pro",
    "gpt-image-2-template",
    "nano-banana-2",
    "nano-banana-pro",
  ]),
  imageSize: z.enum(["1K", "2K", "4K"]),
  scriptModel: z.string(),
});

const settingsResponseSchema = z.object({ settings: settingsSchema });
const apiErrorResponseSchema = z.object({
  error: z.string().optional(),
  issues: z.array(z.object({ message: z.string() })).optional(),
});

const settingsEndpoint = "http://127.0.0.1:4317/settings/openai";
const dialogueEndpoint = "http://127.0.0.1:4317/chat/completions";

// 2026-08-09: https://www.hfsyapi.cn/api/pricing
// Only entries tagged as text and exposing an OpenAI-compatible endpoint.
const dialogueModelOptions: Array<{
  value: string;
  label: string;
  detail: string;
}> = [
  {
    value: "claude-haiku-4-5-20251001",
    label: "claude-haiku-4-5-20251001",
    detail: "Claude · 快速轻量文本模型",
  },
  {
    value: "claude-sonnet-4-6",
    label: "claude-sonnet-4-6",
    detail: "Claude · 编码、智能体与长文本",
  },
  {
    value: "claude-opus-4-6",
    label: "claude-opus-4-6",
    detail: "Claude · 强推理与长周期任务",
  },
  {
    value: "gpt-5.6-luna",
    label: "gpt-5.6-luna",
    detail: "OpenAI · 通用文本与复杂推理",
  },
  {
    value: "gpt-5.6-terra",
    label: "gpt-5.6-terra",
    detail: "OpenAI · 通用文本与复杂推理",
  },
  {
    value: "claude-fable-5",
    label: "claude-fable-5",
    detail: "Claude · 强推理与智能体",
  },
  {
    value: "claude-sonnet-5",
    label: "claude-sonnet-5",
    detail: "Claude · 编码、智能体与长文本",
  },
  {
    value: "claude-opus-4-8",
    label: "claude-opus-4-8",
    detail: "Claude · 强推理与长周期任务",
  },
  {
    value: "kimi-k3",
    label: "kimi-k3",
    detail: "Kimi · 中文、编程与智能体",
  },
  {
    value: "claude-opus-5",
    label: "claude-opus-5",
    detail: "Claude · 强推理与长周期任务",
  },
  {
    value: "claude-opus-4-7",
    label: "claude-opus-4-7",
    detail: "Claude · 强推理与长周期任务",
  },
  {
    value: "gpt-5.6-sol",
    label: "gpt-5.6-sol",
    detail: "OpenAI · 通用文本与复杂推理",
  },
  {
    value: "gpt-5.5",
    label: "gpt-5.5",
    detail: "OpenAI · 文案、剧本与编程",
  },
  {
    value: "gpt-5.4",
    label: "gpt-5.4",
    detail: "OpenAI · 高性价比文本模型",
  },
].sort((left, right) => left.value.localeCompare(right.value, "en"));

const apiPresets: Record<
  ImageModel,
  {
    label: string;
    description: string;
    baseUrl: string;
    endpoint: string;
    defaultSize: ImageSize;
  }
> = {
  "gpt-image-2": {
    label: "GPT Image 2",
    description: "1K，最多 6 张参考图",
    baseUrl: "https://www.hfsyapi.cn",
    endpoint: "/v1/images/generations",
    defaultSize: "1K",
  },
  "gpt-image-2pro": {
    label: "GPT Image 2 Pro",
    description: "2K/4K，最多 4 张参考图",
    baseUrl: "https://www.hfsyapi.cn",
    endpoint: "/v1/images/generations",
    defaultSize: "2K",
  },
  "gpt-image-2-template": {
    label: "GPT Image 2 / Pro",
    description: "1K/2K/4K，按清晰度自动选择模型",
    baseUrl: "https://www.hfsyapi.cn",
    endpoint: "/v1/images/generations",
    defaultSize: "1K",
  },
  "nano-banana-2": {
    label: "Nano Banana 2",
    description: "1K/2K/4K，最多 7 张参考图",
    baseUrl: "https://www.hfsyapi.cn",
    endpoint: "/v1beta/models/nano-banana-2:generateContent",
    defaultSize: "1K",
  },
  "nano-banana-pro": {
    label: "Nano Banana Pro",
    description: "1K/2K/4K，最多 7 张参考图",
    baseUrl: "https://www.hfsyapi.cn",
    endpoint: "/v1beta/models/nano-banana-pro:generateContent",
    defaultSize: "2K",
  },
};

const emptySettings: Settings = {
  apiKeyConfigured: false,
  apiBaseUrl: "https://www.hfsyapi.cn",
  imageApiKeyConfigured: false,
  imageApiBaseUrl: "https://www.hfsyapi.cn",
  imageModel: "gpt-image-2-template",
  imageSize: "1K",
  scriptModel: "claude-sonnet-5",
};

const navigation: Array<{
  id: WorkspaceView;
  icon: ReactNode;
  label: string;
  projectRequired?: boolean;
}> = [
  { id: "create", icon: "＋", label: "创作" },
  { id: "projects", icon: "▦", label: "项目" },
  { id: "cover", icon: "▣", label: "封面" },
  {
    id: "chat",
    icon: (
      <svg
        aria-hidden="true"
        className="size-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 12a8 8 0 0 1-8 8H6l-4 2 1.3-4.6A9 9 0 1 1 21 12Z" />
        <path d="M8 12h.01M12 12h.01M16 12h.01" />
      </svg>
    ),
    label: "对话",
  },
  {
    id: "search",
    icon: (
      <svg
        aria-hidden="true"
        className="size-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-4-4" />
      </svg>
    ),
    label: "搜索",
  },
];

const statusLabels: Record<string, string> = {
  DRAFT: "草稿",
  GENERATING: "生成中",
  READY: "可编辑",
  RENDERING: "渲染中",
  COMPLETED: "已完成",
  FAILED: "失败",
  QUEUED: "排队中",
  RUNNING: "处理中",
  RETRYING: "重试中",
  SUCCEEDED: "已完成",
};

function sizesForModel(model: ImageModel): ImageSize[] {
  if (model === "gpt-image-2") return ["1K"];
  if (model === "gpt-image-2pro") return ["2K", "4K"];
  if (model === "gpt-image-2-template") return ["1K", "2K", "4K"];
  return ["1K", "2K", "4K"];
}

function normalizeImageModel(model: ImageModel): ImageModel {
  if (model === "gpt-image-2" || model === "gpt-image-2pro") {
    return "gpt-image-2-template";
  }
  return model;
}

export function UnifiedWorkspace() {
  const [view, setView] = useState<WorkspaceView>("create");
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [project, setProject] = useState<Project>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsActiveApi, setSettingsActiveApi] = useState<
    "dialogue" | "image"
  >("dialogue");
  const [workspaceStateLoaded, setWorkspaceStateLoaded] = useState(false);

  const loadProjects = useCallback(async () => {
    const response = await fetch("/api/projects");
    const data = (await response.json()) as {
      projects?: ProjectSummary[];
      error?: string;
    };
    if (!response.ok || !data.projects) {
      throw new Error(data.error ?? "项目列表加载失败");
    }
    const loadedProjects = data.projects;
    setProjects(loadedProjects);
    setSelectedProjectId((current) =>
      loadedProjects.some((item) => item.id === current)
        ? current
        : loadedProjects[0]?.id || "",
    );
  }, []);

  const loadProject = useCallback(async (projectId: string) => {
    if (!projectId) return;
    const response = await fetch(`/api/projects/${projectId}`);
    const data = (await response.json()) as {
      project?: Project;
      error?: string;
    };
    if (!response.ok || !data.project) {
      throw new Error(data.error ?? "项目加载失败");
    }
    setProject(data.project);
  }, []);

  useEffect(() => {
    try {
      const stored = parseStoredWorkspaceState(
        window.localStorage.getItem(workspaceStateStorageKey),
      );
      if (stored) {
        setView(stored.view);
        setSelectedProjectId(stored.selectedProjectId);
      }
    } catch {
      // Continue with defaults when browser storage is unavailable.
    }
    setWorkspaceStateLoaded(true);
  }, []);

  useEffect(() => {
    if (!workspaceStateLoaded) return;
    try {
      window.localStorage.setItem(
        workspaceStateStorageKey,
        JSON.stringify({ view, selectedProjectId }),
      );
    } catch {
      // The workspace remains usable when browser storage is unavailable.
    }
  }, [selectedProjectId, view, workspaceStateLoaded]);

  useEffect(() => {
    if (!settingsOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSettingsOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  useEffect(() => {
    if (!workspaceStateLoaded) return;
    void loadProjects().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "项目列表加载失败"),
    );
  }, [loadProjects, workspaceStateLoaded]);

  useEffect(() => {
    if (view !== "projects") return;
    void loadProjects().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "项目列表加载失败"),
    );
  }, [loadProjects, view]);

  useEffect(() => {
    if (
      !selectedProjectId ||
      !["storyboard", "preview", "render", "export"].includes(view)
    ) {
      return;
    }
    void loadProject(selectedProjectId).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "项目加载失败"),
    );
    const timer = window.setInterval(() => {
      void loadProject(selectedProjectId).catch(() => undefined);
    }, 1_500);
    return () => window.clearInterval(timer);
  }, [loadProject, selectedProjectId, view]);

  function openView(nextView: WorkspaceView) {
    const item = navigation.find(({ id }) => id === nextView);
    if (item?.projectRequired && !selectedProjectId) {
      setView("projects");
      setError("请先选择一个项目");
      return;
    }
    setMessage("");
    setError("");
    setView(nextView);
  }

  async function handleProjectCreated(projectId: string) {
    setSelectedProjectId(projectId);
    setView("storyboard");
    await Promise.all([loadProjects(), loadProject(projectId)]);
  }

  function openDeleteProject(projectId: string, title: string) {
    setDeleteTarget({ id: projectId, title });
  }

  async function confirmDeleteProject() {
    if (!deleteTarget) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${deleteTarget.id}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "项目删除失败");
      if (selectedProjectId === deleteTarget.id) {
        setSelectedProjectId("");
        setProject(undefined);
      }
      await loadProjects();
      setMessage(`项目“${deleteTarget.title}”已删除`);
      setDeleteTarget(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目删除失败");
    } finally {
      setLoading(false);
    }
  }

  function openRenameProject(projectId: string, currentTitle: string) {
    setRenameTitle(currentTitle);
    setRenameTarget({ id: projectId, title: currentTitle });
  }

  async function saveRenameProject() {
    if (!renameTarget) return;
    const cleaned = renameTitle.trim();
    if (!cleaned) return;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: cleaned }),
      });
      const data = (await response.json()) as {
        project?: ProjectSummary;
        error?: string;
      };
      if (!response.ok || !data.project) {
        throw new Error(data.error ?? "项目重命名失败");
      }
      setMessage("项目标题已更新");
      setRenameTarget(null);
      await loadProjects();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目重命名失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pink-blue-theme h-dvh overflow-hidden bg-[#e7edef] text-[#20252b]">
      <WorkspaceRail
        view={view}
        projectSelected={Boolean(selectedProjectId)}
        onOpen={openView}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div
        className={`${
          view === "create" ? "block" : "hidden"
        } h-full overflow-hidden lg:pl-24`}
      >
        <CreativeStudio
          onProjectCreated={handleProjectCreated}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </div>

      <main
        className={`${
          view === "create" ? "hidden" : "block"
        } h-dvh min-w-0 overflow-hidden overflow-x-hidden px-0 pb-0 pt-0 lg:pl-24`}
      >
        <div className="flex h-full min-w-0 w-full max-w-none flex-col overflow-hidden rounded-none bg-white p-5 shadow-none md:p-7">
          <WorkspaceHeader
            view={view}
            projects={projects}
            selectedProjectId={selectedProjectId}
            onSelectProject={(projectId) => {
              setSelectedProjectId(projectId);
              if (projectId) void loadProject(projectId);
            }}
          />

          <div
            className={`min-h-0 flex-1 ${
              view === "search" ? "overflow-hidden" : "overflow-y-auto"
            }`}
          >
            {(message || error) &&
              !["storyboard", "preview", "render", "export"].includes(view) && (
                <div
                  className={`mt-4 rounded-xl px-4 py-3 text-sm font-bold ${
                    error
                      ? "bg-red-50 text-red-700"
                      : "bg-emerald-50 text-emerald-800"
                  }`}
                >
                  {error || message}
                </div>
              )}

            {view === "projects" && (
              <ProjectsPanel
                projects={projects}
                onCreate={() => openView("create")}
                onOpen={(projectId) => {
                  setSelectedProjectId(projectId);
                  setView("storyboard");
                }}
                onDelete={(projectId, title) =>
                  openDeleteProject(projectId, title)
                }
                onRename={(projectId, title) =>
                  openRenameProject(projectId, title)
                }
              />
            )}

            {view === "cover" && <CoverWorkspacePanel />}

            {view === "chat" && <ChatWorkspacePanel />}

            <div className={view === "search" ? "h-full min-h-0" : "hidden"}>
              <SearchWorkspacePanel />
            </div>

            {["storyboard", "preview", "render", "export"].includes(view) && (
              <ProjectPanel
                view={view}
                project={project}
                loading={loading}
                setLoading={setLoading}
                reload={() => loadProject(selectedProjectId)}
                setMessage={setMessage}
                setError={setError}
                message={message}
                error={error}
                onOpen={openView}
              />
            )}
          </div>
        </div>
      </main>
      {settingsOpen && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="api-settings-title"
          onMouseDown={() => setSettingsOpen(false)}
        >
          <div
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-black/[0.06] px-6 py-5">
              <div>
                <h2 id="api-settings-title" className="text-xl font-black">
                  API 设置
                </h2>
                <p className="mt-1 text-sm text-black/40">
                  分别配置对话与图片服务，两个 API 互不占用
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f1f4f5] text-xl text-black/45 transition hover:bg-black/10 hover:text-black/70"
                aria-label="关闭 API 设置"
              >
                ×
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden px-6 pb-7">
              <SettingsPanel
                activeApi={settingsActiveApi}
                onActiveApiChange={setSettingsActiveApi}
              />
            </div>
          </div>
        </div>
      )}
      <AppDialog
        open={renameTarget !== null}
        title="重命名项目"
        description="修改后会在项目列表和所有项目下拉框中同步显示。"
        confirmLabel="保存"
        busy={loading}
        confirmDisabled={!renameTitle.trim()}
        input={{
          label: "项目名称",
          value: renameTitle,
          placeholder: "输入新的项目标题",
          maxLength: 120,
          onChange: setRenameTitle,
        }}
        onCancel={() => setRenameTarget(null)}
        onConfirm={() => void saveRenameProject()}
      />
      <AppDialog
        open={deleteTarget !== null}
        title="删除项目"
        description={
          deleteTarget ? (
            <span className="grid gap-2">
              <strong className="break-words text-slate-900">
                {deleteTarget.title}
              </strong>
              <span>
                项目图片、配音、字幕和视频文件也会从本机删除，删除后无法恢复。
              </span>
            </span>
          ) : null
        }
        confirmLabel="确认删除"
        tone="danger"
        busy={loading}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void confirmDeleteProject()}
      />
    </div>
  );
}

function WorkspaceRail({
  view,
  projectSelected,
  onOpen,
  onOpenSettings,
}: {
  view: WorkspaceView;
  projectSelected: boolean;
  onOpen: (view: WorkspaceView) => void;
  onOpenSettings: () => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 grid h-16 grid-cols-6 items-center border-t border-[#d8e5f7] bg-gradient-to-b from-[#edf5ff] via-[#f6f9ff] to-[#fff1f6] px-2 text-[#58708f] shadow-xl lg:inset-y-0 lg:left-0 lg:right-auto lg:flex lg:h-auto lg:w-24 lg:flex-col lg:justify-start lg:gap-1 lg:border-r lg:border-t-0 lg:py-5">
      <button
        type="button"
        onClick={() => onOpen("create")}
        className="relative hidden place-items-center lg:grid"
        aria-label="StickMotion 创作台"
      >
        <img
          src="/stickmotion-logo.png"
          alt="StickMotion"
          className="size-11 object-contain"
        />
        <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-emerald-400 ring-2 ring-[#edf5ff]" />
      </button>
      <div className="hidden h-px w-10 bg-[#d8e5f7] lg:my-3 lg:block" />
      {navigation.map((item) => {
        const active = view === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.id)}
            title={
              item.projectRequired && !projectSelected
                ? `${item.label}：请先选择项目`
                : item.label
            }
            className={`group relative flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-xs font-bold transition lg:w-20 lg:px-2 lg:py-3 ${
              active
                ? "bg-white text-[#36588f] shadow-sm"
                : "text-[#7c8ea8] hover:bg-white/70 hover:text-[#456aa8]"
            }`}
          >
            {active && (
              <span className="absolute left-1 top-1/2 hidden h-5 w-1 -translate-y-1/2 rounded-full bg-[#ee86aa] lg:block" />
            )}
            <span className="text-xl leading-6">{item.icon}</span>
            <span>{item.label}</span>
          </button>
        );
      })}
      <div className="lg:mt-auto lg:pb-3">
        <button
          type="button"
          onClick={onOpenSettings}
          className="flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-xs font-bold text-[#7c8ea8] transition hover:bg-white/80 hover:text-[#456aa8] lg:flex-row lg:rounded-full lg:bg-white/70 lg:px-3 lg:text-[11px] lg:text-[#6d83a2] lg:shadow-sm"
          aria-label="打开 API 设置"
        >
          <span className="text-base leading-none">⚙</span>
          <span>设置</span>
        </button>
      </div>
    </nav>
  );
}

function WorkspaceHeader({
  view,
  projects,
  selectedProjectId,
  onSelectProject,
}: {
  view: WorkspaceView;
  projects: ProjectSummary[];
  selectedProjectId: string;
  onSelectProject: (projectId: string) => void;
}) {
  const titles: Record<WorkspaceView, [string, string]> = {
    create: ["开始创作", "输入文案并生成视频"],
    projects: ["项目中心", "管理本机保存的视频项目"],
    cover: ["封面", "管理项目封面"],
    chat: ["对话", "和 AI 一起梳理脚本、分镜与封面想法"],
    search: ["搜索", "跨平台检索内容、趋势与创作参考"],
    storyboard: ["分镜编辑", "调整旁白、字幕、画面和镜头顺序"],
    preview: ["分镜图片预览", "查看每个分镜生成的图片"],
    render: ["渲染中心", "查看 FFmpeg 后台任务和错误日志"],
    export: ["导出成片", "播放或下载 1080P MP4"],
  };
  const [title, description] = titles[view];
  const headerIcon =
    view === "projects" ? (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
      </svg>
    ) : null;

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.06] pb-5">
      <div className="flex items-center gap-3">
        {headerIcon && (
          <span
            className={`grid size-10 shrink-0 place-items-center rounded-xl shadow-sm ring-1 ring-black/[0.03] ${
              view === "projects"
                ? "bg-cyan-50 text-[#0f8791]"
                : "bg-violet-50 text-violet-600"
            }`}
          >
            {headerIcon}
          </span>
        )}
        <div>
          <h1 className="text-lg font-bold md:text-xl">{title}</h1>
          <p className="mt-1 text-sm text-black/40">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-3">
        {!["projects", "cover", "chat", "search"].includes(view) && (
          <ProjectSelect
            projects={projects}
            value={selectedProjectId}
            onSelect={onSelectProject}
          />
        )}
        <span className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
          ● 本机服务正常
        </span>
      </div>
    </header>
  );
}

type DialogueConversation = {
  id: string;
  title: string;
  titleCustomized: boolean;
  draft: string;
  error: string;
  messages: Array<DialogueMessage & { id: string }>;
};

function createDialogueConversation(
  id: string,
  title: string,
): DialogueConversation {
  return {
    id,
    title,
    titleCustomized: false,
    draft: "",
    error: "",
    messages: [
      {
        id: `${id}-welcome`,
        content:
          title === "短视频创作助手"
            ? "我是短视频创作助手。你可以在这里讨论文案、分镜和封面方向，我会结合当前对话继续回答。"
            : "这是一个新的独立对话。输入问题后，我会只结合当前对话的上下文继续回答。",
        role: "assistant",
      },
    ],
  };
}

function ChatWorkspacePanel() {
  const [conversations, setConversations] = useState<DialogueConversation[]>(
    () => [
      createDialogueConversation("short-video-assistant", "短视频创作助手"),
    ],
  );
  const [activeConversationId, setActiveConversationId] = useState(
    "short-video-assistant",
  );
  const [pendingConversationIds, setPendingConversationIds] = useState<
    Set<string>
  >(() => new Set());
  const [editingConversationId, setEditingConversationId] = useState<
    string | null
  >(null);
  const [conversationTitleDraft, setConversationTitleDraft] = useState("");
  const [pendingConversationDeletion, setPendingConversationDeletion] =
    useState<{ id: string; title: string } | null>(null);
  const [dialogueStorageLoaded, setDialogueStorageLoaded] = useState(false);
  const [dialogueUiStorageLoaded, setDialogueUiStorageLoaded] = useState(false);
  const [dialogueStorageError, setDialogueStorageError] = useState("");
  const [connection, setConnection] = useState<
    "loading" | "ready" | "missing" | "offline"
  >("loading");
  const [model, setModel] = useState("");
  const [dialogueSettings, setDialogueSettings] = useState<Settings | null>(
    null,
  );
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [modelSwitchBusy, setModelSwitchBusy] = useState(false);
  const [modelSwitchError, setModelSwitchError] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const conversationListRef = useRef<HTMLDivElement>(null);
  const copiedMessageTimerRef = useRef<number | null>(null);
  const dialogueUiStateRef = useRef<DialogueUiState>({
    ...emptyDialogueUiState,
    messageScrollTopByConversation: {},
    pendingConversationIds: [],
  });
  const dialogueUiSaveTimerRef = useRef<number | null>(null);
  const previousActiveConversationIdRef = useRef<string | null>(null);
  const previousMessageCountRef = useRef(0);
  const activeConversation =
    conversations.find((item) => item.id === activeConversationId) ??
    conversations[0];
  const messages = activeConversation?.messages ?? [];
  const draft = activeConversation?.draft ?? "";

  useEffect(
    () => () => {
      if (copiedMessageTimerRef.current !== null) {
        window.clearTimeout(copiedMessageTimerRef.current);
      }
    },
    [],
  );

  async function copyDialogueMessage(messageId: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopiedMessageId(messageId);
    if (copiedMessageTimerRef.current !== null) {
      window.clearTimeout(copiedMessageTimerRef.current);
    }
    copiedMessageTimerRef.current = window.setTimeout(() => {
      setCopiedMessageId((current) => (current === messageId ? null : current));
      copiedMessageTimerRef.current = null;
    }, 1_600);
  }
  const error = activeConversation?.error ?? "";
  const busy = activeConversation
    ? pendingConversationIds.has(activeConversation.id)
    : false;

  const persistDialogueUiState = useCallback(() => {
    try {
      window.localStorage.setItem(
        dialogueUiStateStorageKey,
        JSON.stringify(dialogueUiStateRef.current),
      );
    } catch {
      // Conversation content persistence reports storage failures separately.
    }
  }, []);

  const scheduleDialogueUiStateSave = useCallback(() => {
    if (dialogueUiSaveTimerRef.current !== null) {
      window.clearTimeout(dialogueUiSaveTimerRef.current);
    }
    dialogueUiSaveTimerRef.current = window.setTimeout(() => {
      dialogueUiSaveTimerRef.current = null;
      persistDialogueUiState();
    }, 120);
  }, [persistDialogueUiState]);

  useEffect(() => {
    try {
      const storedUi = parseStoredDialogueUiState(
        window.localStorage.getItem(dialogueUiStateStorageKey),
      );
      const interruptedIds = new Set(storedUi?.pendingConversationIds ?? []);
      if (storedUi) {
        dialogueUiStateRef.current = {
          ...storedUi,
          messageScrollTopByConversation: {
            ...storedUi.messageScrollTopByConversation,
          },
          pendingConversationIds: [],
        };
        setEditingConversationId(storedUi.editingConversationId);
        setConversationTitleDraft(storedUi.conversationTitleDraft);
      }
      const stored = parseStoredDialogueState(
        window.localStorage.getItem(dialogueConversationStorageKey),
      );
      if (stored) {
        setConversations(
          stored.conversations.map((conversation) => ({
            ...conversation,
            error: interruptedIds.has(conversation.id)
              ? "上次回复因页面刷新而中断，请重新发送。"
              : "",
          })),
        );
        setActiveConversationId(stored.activeConversationId);
      }
    } catch {
      // Continue with the default conversation when storage is unavailable.
    }
    setDialogueStorageLoaded(true);
    setDialogueUiStorageLoaded(true);
  }, []);

  useEffect(() => {
    if (!dialogueStorageLoaded) return;
    try {
      window.localStorage.setItem(
        dialogueConversationStorageKey,
        JSON.stringify({
          version: 1,
          activeConversationId,
          conversations: conversations.map(
            ({ id, title, titleCustomized, draft, messages }) => ({
              id,
              title,
              titleCustomized,
              draft,
              messages,
            }),
          ),
        }),
      );
      setDialogueStorageError("");
    } catch {
      setDialogueStorageError("对话记录本地保存失败，请释放浏览器存储空间");
    }
  }, [activeConversationId, conversations, dialogueStorageLoaded]);

  useEffect(() => {
    if (!dialogueUiStorageLoaded) return;
    dialogueUiStateRef.current = {
      ...dialogueUiStateRef.current,
      editingConversationId,
      conversationTitleDraft,
      pendingConversationIds: [...pendingConversationIds],
    };
    scheduleDialogueUiStateSave();
  }, [
    conversationTitleDraft,
    dialogueUiStorageLoaded,
    editingConversationId,
    pendingConversationIds,
    scheduleDialogueUiStateSave,
  ]);

  useEffect(() => {
    if (!dialogueUiStorageLoaded) return;
    const frame = window.requestAnimationFrame(() => {
      if (conversationListRef.current) {
        conversationListRef.current.scrollTop =
          dialogueUiStateRef.current.conversationListScrollTop;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [dialogueUiStorageLoaded]);

  useEffect(() => {
    if (!dialogueUiStorageLoaded || !activeConversationId) return;
    const activeChanged =
      previousActiveConversationIdRef.current !== activeConversationId;
    const messageCountIncreased =
      !activeChanged && messages.length > previousMessageCountRef.current;
    previousActiveConversationIdRef.current = activeConversationId;
    previousMessageCountRef.current = messages.length;
    const frame = window.requestAnimationFrame(() => {
      const list = messageListRef.current;
      if (!list) return;
      if (activeChanged) {
        const storedTop =
          dialogueUiStateRef.current.messageScrollTopByConversation[
            activeConversationId
          ];
        list.scrollTo({
          top: storedTop ?? list.scrollHeight,
          behavior: "auto",
        });
      } else if (messageCountIncreased) {
        list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeConversationId, dialogueUiStorageLoaded, messages.length]);

  useEffect(
    () => () => {
      if (dialogueUiSaveTimerRef.current !== null) {
        window.clearTimeout(dialogueUiSaveTimerRef.current);
        persistDialogueUiState();
      }
    },
    [persistDialogueUiState],
  );

  function updateConversation(
    conversationId: string,
    update: (current: DialogueConversation) => DialogueConversation,
  ) {
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId
          ? update(conversation)
          : conversation,
      ),
    );
  }

  function createNewConversation() {
    if (conversations.length >= 50) {
      setDialogueStorageError("最多保留 50 个对话，请先删除不需要的对话");
      return;
    }
    const conversationId = window.crypto.randomUUID();
    const newConversationCount =
      conversations.filter((item) => item.title.startsWith("新对话")).length +
      1;
    const title =
      newConversationCount === 1 ? "新对话" : `新对话 ${newConversationCount}`;
    setConversations((current) => [
      createDialogueConversation(conversationId, title),
      ...current,
    ]);
    setActiveConversationId(conversationId);
  }

  function deleteConversation(conversationId: string, title: string) {
    setPendingConversationDeletion({ id: conversationId, title });
  }

  function confirmConversationDeletion() {
    if (!pendingConversationDeletion) return;
    const conversationId = pendingConversationDeletion.id;

    const deletedIndex = conversations.findIndex(
      (conversation) => conversation.id === conversationId,
    );
    if (deletedIndex < 0) {
      setPendingConversationDeletion(null);
      return;
    }

    const remainingConversations = conversations.filter(
      (conversation) => conversation.id !== conversationId,
    );
    if (remainingConversations.length === 0) {
      setConversations([]);
      setActiveConversationId("");
    } else {
      const nextActiveConversationId =
        remainingConversations[
          Math.min(deletedIndex, remainingConversations.length - 1)
        ]?.id;
      setConversations(remainingConversations);
      setActiveConversationId((current) => {
        if (current !== conversationId) return current;
        return nextActiveConversationId ?? current;
      });
    }
    setPendingConversationIds((current) => {
      const next = new Set(current);
      next.delete(conversationId);
      return next;
    });
    delete dialogueUiStateRef.current.messageScrollTopByConversation[
      conversationId
    ];
    if (editingConversationId === conversationId) {
      setEditingConversationId(null);
      setConversationTitleDraft("");
    }
    scheduleDialogueUiStateSave();
    setPendingConversationDeletion(null);
  }

  function beginRenamingConversation(conversation: DialogueConversation) {
    setEditingConversationId(conversation.id);
    setConversationTitleDraft(conversation.title);
  }

  function cancelRenamingConversation() {
    setEditingConversationId(null);
    setConversationTitleDraft("");
  }

  function saveConversationTitle() {
    if (!editingConversationId) return;
    const title = conversationTitleDraft.trim().replace(/\s+/gu, " ");
    if (title) {
      updateConversation(editingConversationId, (current) => ({
        ...current,
        title: title.slice(0, 40),
        titleCustomized: true,
      }));
    }
    cancelRenamingConversation();
  }

  function updateDraft(value: string) {
    if (!activeConversation) return;
    updateConversation(activeConversation.id, (current) => ({
      ...current,
      draft: value,
    }));
  }

  useEffect(() => {
    let active = true;
    void fetch(settingsEndpoint, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("SETTINGS_UNAVAILABLE");
        return settingsResponseSchema.parse(await response.json());
      })
      .then(({ settings: loaded }) => {
        if (!active) return;
        setDialogueSettings(loaded);
        setModel(loaded.scriptModel);
        setConnection(loaded.apiKeyConfigured ? "ready" : "missing");
      })
      .catch(() => {
        if (active) setConnection("offline");
      });
    return () => {
      active = false;
    };
  }, []);

  async function selectDialogueModel(selectedModel: string) {
    if (modelSwitchBusy || selectedModel === model) {
      setModelPickerOpen(false);
      return;
    }
    setModelSwitchBusy(true);
    setModelSwitchError("");
    try {
      const latestResponse = await fetch(settingsEndpoint, {
        cache: "no-store",
      });
      if (!latestResponse.ok) throw new Error("无法读取当前 API 配置");
      const latest = settingsResponseSchema.parse(await latestResponse.json());
      const response = await fetch(settingsEndpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clearApiKey: false,
          clearImageApiKey: false,
          apiBaseUrl: latest.settings.apiBaseUrl,
          imageApiBaseUrl: latest.settings.imageApiBaseUrl,
          imageModel: latest.settings.imageModel,
          imageSize: latest.settings.imageSize,
          scriptModel: selectedModel,
        }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const failure = apiErrorResponseSchema.safeParse(payload);
        throw new Error(
          failure.success
            ? (failure.data.issues?.[0]?.message ??
                failure.data.error ??
                "模型切换失败")
            : "模型切换失败",
        );
      }
      const saved = settingsResponseSchema.parse(payload).settings;
      setDialogueSettings(saved);
      setModel(saved.scriptModel);
      setConnection(saved.apiKeyConfigured ? "ready" : "missing");
      setModelPickerOpen(false);
    } catch (reason) {
      setModelSwitchError(
        reason instanceof Error ? reason.message : "模型切换失败",
      );
    } finally {
      setModelSwitchBusy(false);
    }
  }

  async function addMessage() {
    const content = draft.trim();
    if (!content || !activeConversation || busy || connection !== "ready") {
      return;
    }
    const conversationId = activeConversation.id;
    const userMessage: DialogueMessage & { id: string } = {
      id: window.crypto.randomUUID(),
      content,
      role: "user",
    };
    const history = activeConversation.messages
      .filter((message) => !message.id.endsWith("-welcome"))
      .map(({ role, content: messageContent }) => ({
        role,
        content: messageContent,
      }));
    const recentHistory: DialogueMessage[] = [];
    let requestCharacterCount = userMessage.content.length;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const message = history[index];
      if (!message || recentHistory.length >= 99) break;
      if (requestCharacterCount + message.content.length > 390_000) break;
      recentHistory.push(message);
      requestCharacterCount += message.content.length;
    }
    const requestMessages = [
      ...recentHistory.reverse(),
      { role: userMessage.role, content: userMessage.content },
    ];
    const requestPayload = dialogueCompletionInputSchema.safeParse({
      messages: requestMessages,
      temperature: 0.7,
    });
    if (!requestPayload.success) {
      updateConversation(conversationId, (current) => ({
        ...current,
        error: `对话内容校验失败：${requestPayload.error.issues[0]?.message ?? "请新建对话后重试"}`,
      }));
      return;
    }
    updateConversation(conversationId, (current) => ({
      ...current,
      draft: "",
      error: "",
      title:
        !current.titleCustomized && current.title.startsWith("新对话")
          ? content.replace(/\s+/gu, " ").slice(0, 18)
          : current.title,
      titleCustomized:
        current.titleCustomized || current.title.startsWith("新对话"),
      messages: [...current.messages, userMessage],
    }));
    setPendingConversationIds((current) => {
      const next = new Set(current);
      next.add(conversationId);
      return next;
    });
    try {
      const response = await fetch(dialogueEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(requestPayload.data),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const code =
          typeof payload === "object" && payload !== null && "error" in payload
            ? String(payload.error)
            : "DIALOGUE_REQUEST_FAILED";
        const failure = apiErrorResponseSchema.safeParse(payload);
        const validationIssue = failure.success
          ? failure.data.issues?.[0]
          : undefined;
        const friendlyErrors: Record<string, string> = {
          DIALOGUE_MODEL_UNAVAILABLE:
            "当前模型暂时不可用，请切换其他模型后重试",
          DIALOGUE_CONTEXT_TOO_LONG:
            "当前对话上下文过长，请新建对话或删除较早的消息",
          DIALOGUE_CONTENT_REJECTED:
            "对话服务因内容策略拒绝了本次请求，请调整内容后重试",
          DIALOGUE_RATE_LIMITED: "对话服务当前请求过多，请稍后再试",
          DIALOGUE_PROVIDER_TIMEOUT:
            "对话服务响应超时，系统已经自动重试，请稍后再试",
          DIALOGUE_PROVIDER_UNAVAILABLE:
            "对话服务暂时不可用，系统已经自动重试，请稍后再试",
          DIALOGUE_REQUEST_REJECTED:
            "对话服务未接受本次请求，请调整内容或切换模型后重试",
          DIALOGUE_API_KEY_REQUIRED: "请先在设置中填写对话 API 密钥",
          DIALOGUE_API_AUTH_FAILED: "对话密钥无效，请检查后重新保存",
          DIALOGUE_PROVIDER_REJECTED: "对话服务拒绝了请求，请检查模型名称",
          DIALOGUE_PROVIDER_UNREACHABLE: "暂时无法连接对话服务",
          DIALOGUE_RESPONSE_INVALID: "对话服务返回了无法识别的内容",
          VALIDATION_ERROR: "对话内容格式不正确或上下文过长",
        };
        throw new Error(
          code === "VALIDATION_ERROR" && validationIssue
            ? `对话请求校验失败：${validationIssue.message}`
            : (friendlyErrors[code] ?? "对话请求失败，请稍后重试"),
        );
      }
      const result = dialogueCompletionResponseSchema.parse(payload);
      setModel(result.model);
      updateConversation(conversationId, (current) => ({
        ...current,
        messages: [
          ...current.messages,
          { ...result.message, id: window.crypto.randomUUID() },
        ],
      }));
    } catch (reason) {
      updateConversation(conversationId, (current) => ({
        ...current,
        error: reason instanceof Error ? reason.message : "对话请求失败",
      }));
    } finally {
      setPendingConversationIds((current) => {
        const next = new Set(current);
        next.delete(conversationId);
        return next;
      });
    }
  }

  return (
    <>
      <section className="flex h-full min-h-[560px] flex-col pt-5">
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-black/[0.06] bg-[#f7f9fc] shadow-sm">
          <aside className="hidden w-64 shrink-0 flex-col border-r border-black/[0.06] bg-white p-4 lg:flex">
            <div className="flex items-center justify-between gap-3 px-1">
              <div>
                <h2 className="text-sm font-black text-[#263a59]">对话</h2>
                <p className="mt-0.5 text-[11px] text-black/35">
                  {conversations.length} 个对话
                </p>
              </div>
              <button
                type="button"
                onClick={createNewConversation}
                className="inline-flex h-9 items-center gap-1 rounded-xl bg-[#36588f] px-3 text-xs font-black text-white shadow-sm transition hover:bg-[#2c4b79]"
              >
                <span className="text-base leading-none">＋</span>
                新对话
              </button>
            </div>

            <div
              ref={conversationListRef}
              onScroll={(event) => {
                if (!dialogueUiStorageLoaded) return;
                dialogueUiStateRef.current.conversationListScrollTop =
                  event.currentTarget.scrollTop;
                scheduleDialogueUiStateSave();
              }}
              className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto"
            >
              {conversations.map((conversation) => {
                const active = conversation.id === activeConversation?.id;
                const latestMessage = conversation.messages.at(-1);
                const pending = pendingConversationIds.has(conversation.id);
                return (
                  <div key={conversation.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => setActiveConversationId(conversation.id)}
                      aria-current={active ? "true" : undefined}
                      className={`w-full rounded-2xl border p-3 pr-10 text-left transition ${
                        active
                          ? "border-[#cdd9eb] bg-gradient-to-br from-[#edf4ff] to-[#f9f3fb] shadow-sm ring-1 ring-[#5374aa]/5"
                          : "border-transparent hover:border-[#dce4ef] hover:bg-[#f7f9fc]"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <span
                          className={`grid size-9 shrink-0 place-items-center rounded-xl ${
                            active
                              ? "bg-white text-[#5374aa] shadow-sm"
                              : "bg-[#f1f4f8] text-[#7185a3]"
                          }`}
                        >
                          <svg
                            aria-hidden="true"
                            className="size-5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M21 12a8 8 0 0 1-8 8H6l-4 2 1.3-4.6A9 9 0 1 1 21 12Z" />
                            <path d="M8 12h.01M12 12h.01M16 12h.01" />
                          </svg>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <strong
                              className={`block flex-1 truncate text-sm ${
                                active ? "text-[#263a59]" : "text-[#4b5e79]"
                              }`}
                            >
                              {conversation.title}
                            </strong>
                            {pending && (
                              <span className="size-2 animate-pulse rounded-full bg-[#6c93e7]" />
                            )}
                          </span>
                          <span className="mt-1 block truncate text-[11px] font-medium text-[#8998ae]">
                            {latestMessage?.content ?? "暂无消息"}
                          </span>
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        deleteConversation(conversation.id, conversation.title)
                      }
                      aria-label={`删除对话“${conversation.title}”`}
                      title="删除对话"
                      className="absolute right-2 top-2 grid size-7 place-items-center rounded-lg text-[#91a0b5] opacity-60 transition hover:bg-red-50 hover:text-red-500 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <svg
                        aria-hidden="true"
                        className="size-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="m19 6-1 14H6L5 6" />
                        <path d="M10 11v5M14 11v5" />
                      </svg>
                    </button>
                  </div>
                );
              })}
              {conversations.length === 0 && (
                <div className="rounded-2xl border border-dashed border-[#d8e2f0] bg-[#f8faff] px-4 py-8 text-center">
                  <p className="text-sm font-black text-[#607694]">暂无对话</p>
                  <p className="mt-1 text-[11px] leading-5 text-[#91a0b5]">
                    点击上方“新对话”开始
                  </p>
                </div>
              )}
            </div>

            <div
              className={`mt-3 rounded-xl px-3 py-2.5 text-[10px] leading-4 ${
                dialogueStorageError
                  ? "bg-red-50 text-red-600"
                  : "bg-[#f6f8fb] text-black/35"
              }`}
            >
              {dialogueStorageError ||
                "对话记录和输入草稿自动保存在本机；仅手动删除时才会移除。"}
            </div>
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-2 overflow-x-auto border-b border-black/[0.06] bg-white p-3 lg:hidden">
              <button
                type="button"
                onClick={createNewConversation}
                className="shrink-0 rounded-xl bg-[#36588f] px-3 py-2 text-xs font-black text-white"
              >
                ＋ 新对话
              </button>
              {conversations.map((conversation) => (
                <div key={conversation.id} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setActiveConversationId(conversation.id)}
                    className={`max-w-40 truncate rounded-xl py-2 pl-3 pr-9 text-xs font-bold ${
                      conversation.id === activeConversation?.id
                        ? "bg-[#edf3ff] text-[#36588f]"
                        : "bg-[#f5f7fa] text-black/45"
                    }`}
                  >
                    {conversation.title}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      deleteConversation(conversation.id, conversation.title)
                    }
                    aria-label={`删除对话“${conversation.title}”`}
                    className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-[#8b9ab0] hover:bg-red-50 hover:text-red-500"
                  >
                    <svg
                      aria-hidden="true"
                      className="size-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3 6h18" />
                      <path d="M8 6V4h8v2" />
                      <path d="m19 6-1 14H6L5 6" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-black/[0.06] bg-white px-5 py-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#edf3ff] text-[#5374aa]">
                  <svg
                    aria-hidden="true"
                    className="size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 12a8 8 0 0 1-8 8H6l-4 2 1.3-4.6A9 9 0 1 1 21 12Z" />
                    <path d="M8 12h.01M12 12h.01M16 12h.01" />
                  </svg>
                </span>
                <div className="min-w-0">
                  {activeConversation &&
                  editingConversationId === activeConversation.id ? (
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        value={conversationTitleDraft}
                        onChange={(event) =>
                          setConversationTitleDraft(event.target.value)
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") saveConversationTitle();
                          if (event.key === "Escape")
                            cancelRenamingConversation();
                        }}
                        maxLength={40}
                        aria-label="对话名称"
                        className="h-8 min-w-0 max-w-64 rounded-lg border border-[#b9c9df] bg-white px-2.5 text-sm font-black text-[#263a59] outline-none ring-[#5374aa]/15 transition focus:border-[#6d8cbb] focus:ring-4"
                      />
                      <button
                        type="button"
                        onClick={saveConversationTitle}
                        aria-label="保存对话名称"
                        title="保存"
                        className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600 transition hover:bg-emerald-100"
                      >
                        <svg
                          aria-hidden="true"
                          className="size-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m5 12 4 4L19 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={cancelRenamingConversation}
                        aria-label="取消修改对话名称"
                        title="取消"
                        className="grid size-8 shrink-0 place-items-center rounded-lg text-[#91a0b5] transition hover:bg-[#f1f4f8] hover:text-[#5d6f89]"
                      >
                        <svg
                          aria-hidden="true"
                          className="size-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        >
                          <path d="M6 6l12 12M18 6 6 18" />
                        </svg>
                      </button>
                    </div>
                  ) : (
                    <div className="flex min-w-0 items-center gap-1.5">
                      <h2 className="truncate text-sm font-black">
                        {activeConversation?.title ?? "暂无对话"}
                      </h2>
                      {activeConversation && (
                        <button
                          type="button"
                          onClick={() =>
                            beginRenamingConversation(activeConversation)
                          }
                          aria-label="修改对话名称"
                          title="修改对话名称"
                          className="grid size-7 shrink-0 place-items-center rounded-lg text-[#91a0b5] transition hover:bg-[#edf3ff] hover:text-[#5374aa]"
                        >
                          <svg
                            aria-hidden="true"
                            className="size-3.5"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M12 20h9" />
                            <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                  <p className="mt-0.5 text-xs text-black/40">
                    {activeConversation
                      ? `独立上下文 · ${Math.max(0, messages.length - 1)} 条消息`
                      : "点击左侧“新对话”开始"}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setModelPickerOpen(true)}
                disabled={!dialogueSettings || modelSwitchBusy}
                aria-haspopup="dialog"
                title="切换对话模型"
                className={`shrink-0 rounded-full px-3 py-1.5 text-[11px] font-bold ${
                  connection === "ready"
                    ? "bg-emerald-50 text-emerald-700"
                    : connection === "loading"
                      ? "bg-slate-50 text-slate-500"
                      : "bg-amber-50 text-amber-700"
                } inline-flex items-center gap-1.5 transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                {connection === "ready"
                  ? `● ${model || "对话模型"}`
                  : connection === "loading"
                    ? "正在读取配置…"
                    : connection === "missing"
                      ? "请先配置对话 API"
                      : "本机对话服务未连接"}
                {dialogueSettings && (
                  <svg
                    aria-hidden="true"
                    className="size-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="m7 10 5 5 5-5" />
                  </svg>
                )}
              </button>
            </div>

            {modelPickerOpen && (
              <div
                className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]"
                role="dialog"
                aria-modal="true"
                aria-labelledby="dialogue-model-picker-title"
                onMouseDown={() => {
                  if (!modelSwitchBusy) setModelPickerOpen(false);
                }}
              >
                <div
                  className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
                  onMouseDown={(event) => event.stopPropagation()}
                >
                  <div className="flex items-start justify-between gap-4 border-b border-black/[0.06] px-6 py-5">
                    <div>
                      <h3
                        id="dialogue-model-picker-title"
                        className="text-lg font-black text-[#263a59]"
                      >
                        切换对话模型
                      </h3>
                      <p className="mt-1 text-xs leading-5 text-black/40">
                        模型来自幻方思域模型广场，仅显示文本模型。
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={modelSwitchBusy}
                      onClick={() => setModelPickerOpen(false)}
                      aria-label="关闭模型选择"
                      className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f1f4f5] text-lg text-black/45 transition hover:bg-black/10 disabled:opacity-40"
                    >
                      ×
                    </button>
                  </div>
                  <div className="min-h-0 overflow-y-auto p-4 sm:p-5">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {dialogueModelOptions.map((option) => {
                        const active = option.value === model;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            disabled={modelSwitchBusy}
                            onClick={() =>
                              void selectDialogueModel(option.value)
                            }
                            className={`flex min-h-16 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition disabled:cursor-wait disabled:opacity-60 ${
                              active
                                ? "border-emerald-200 bg-emerald-50 shadow-sm ring-1 ring-emerald-100"
                                : "border-black/[0.06] hover:border-[#9bb0d0] hover:bg-[#f7f9fc]"
                            }`}
                          >
                            <span
                              className={`grid size-8 shrink-0 place-items-center rounded-xl text-xs font-black ${
                                active
                                  ? "bg-emerald-100 text-emerald-700"
                                  : "bg-[#edf3ff] text-[#5374aa]"
                              }`}
                            >
                              {option.value.startsWith("gpt")
                                ? "G"
                                : option.value.startsWith("claude")
                                  ? "C"
                                  : "K"}
                            </span>
                            <span className="min-w-0 flex-1">
                              <strong className="block truncate font-mono text-xs text-[#263a59]">
                                {option.label}
                              </strong>
                              <span className="mt-1 block truncate text-[11px] text-black/40">
                                {option.detail}
                              </span>
                            </span>
                            {active && (
                              <svg
                                aria-hidden="true"
                                className="size-4 shrink-0 text-emerald-600"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="m5 12 4 4L19 6" />
                              </svg>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {modelSwitchError && (
                      <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-xs font-bold text-red-700">
                        {modelSwitchError}
                      </p>
                    )}
                    <p className="mt-4 text-center text-[11px] leading-5 text-black/35">
                      切换只修改对话模型，不会改动 API 地址、密钥或图片模型。
                    </p>
                  </div>
                </div>
              </div>
            )}

            <div
              ref={messageListRef}
              onScroll={(event) => {
                if (!dialogueUiStorageLoaded || !activeConversationId) return;
                dialogueUiStateRef.current.messageScrollTopByConversation[
                  activeConversationId
                ] = event.currentTarget.scrollTop;
                scheduleDialogueUiStateSave();
              }}
              className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-8"
            >
              <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-5">
                {!activeConversation && (
                  <div className="grid min-h-64 place-items-center text-center">
                    <div>
                      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-[#edf3ff] to-[#fff0f6] text-[#5374aa] shadow-sm">
                        <svg
                          aria-hidden="true"
                          className="size-6"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M21 12a8 8 0 0 1-8 8H6l-4 2 1.3-4.6A9 9 0 1 1 21 12Z" />
                        </svg>
                      </span>
                      <h3 className="mt-4 text-sm font-black text-[#405777]">
                        暂无对话
                      </h3>
                      <p className="mt-1 text-xs text-[#8b9ab0]">
                        点击左侧上方“新对话”创建一个独立对话
                      </p>
                    </div>
                  </div>
                )}
                {messages.map((item) => (
                  <div
                    key={item.id}
                    className={`message-copy-group flex items-end gap-3 ${
                      item.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {item.role === "assistant" && (
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#6c93e7] to-[#ee86aa] text-xs font-black text-white shadow-sm">
                        S
                      </span>
                    )}
                    <div
                      className={`relative max-w-[88%] whitespace-pre-wrap rounded-2xl py-3 pl-5 pr-12 text-sm leading-6 shadow-sm ${
                        item.role === "user"
                          ? "rounded-br-md bg-[#43689e] text-white"
                          : "rounded-bl-md border border-black/[0.05] bg-white text-black/70"
                      }`}
                    >
                      {item.content}
                      <button
                        type="button"
                        onClick={() =>
                          void copyDialogueMessage(item.id, item.content)
                        }
                        aria-label={
                          copiedMessageId === item.id ? "已复制" : "复制消息"
                        }
                        title={copiedMessageId === item.id ? "已复制" : "复制"}
                        className={`message-copy-button absolute bottom-2 right-2 grid size-7 place-items-center rounded-lg transition-colors ${
                          item.role === "user"
                            ? "text-white/75 hover:bg-white/15 hover:text-white"
                            : "text-black/35 hover:bg-black/[0.06] hover:text-black/65"
                        }`}
                      >
                        {copiedMessageId === item.id ? (
                          <svg
                            aria-hidden="true"
                            className="size-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.4"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="m5 12 4 4L19 6" />
                          </svg>
                        ) : (
                          <svg
                            aria-hidden="true"
                            className="size-4"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <rect width="14" height="14" x="8" y="8" rx="2" />
                            <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
                {busy && (
                  <div className="flex items-end gap-3 justify-start">
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#6c93e7] to-[#ee86aa] text-xs font-black text-white shadow-sm">
                      S
                    </span>
                    <div className="rounded-2xl rounded-bl-md border border-black/[0.05] bg-white px-4 py-3 text-sm text-black/45 shadow-sm">
                      正在思考…
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-black/[0.06] bg-white p-4 sm:px-8 sm:py-5">
              <div className="mx-auto w-full max-w-[1280px]">
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void addMessage();
                  }}
                  className="flex items-end gap-3 rounded-2xl border border-[#cfdaea] bg-white p-2 shadow-sm focus-within:border-[#7895bf] focus-within:ring-4 focus-within:ring-[#7895bf]/10"
                >
                  <textarea
                    value={draft}
                    onChange={(event) => updateDraft(event.target.value)}
                    disabled={!activeConversation || connection !== "ready"}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        if (busy) return;
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                    rows={1}
                    maxLength={32_000}
                    placeholder={
                      !activeConversation
                        ? "请先点击左侧“新对话”"
                        : connection === "ready"
                          ? "输入问题或灵感，Enter 发送，Shift + Enter 换行"
                          : "请先在设置中配置对话 API"
                    }
                    aria-label="对话内容"
                    className="max-h-32 min-h-10 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 outline-none placeholder:text-black/30"
                  />
                  <button
                    type="submit"
                    disabled={
                      !activeConversation ||
                      !draft.trim() ||
                      busy ||
                      connection !== "ready"
                    }
                    className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#36588f] text-white transition hover:bg-[#2d4d7e] disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="添加到对话"
                  >
                    <svg
                      aria-hidden="true"
                      className="size-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="m22 2-7 20-4-9-9-4Z" />
                      <path d="M22 2 11 13" />
                    </svg>
                  </button>
                </form>
                {error && (
                  <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-center text-xs font-bold text-red-600">
                    {error}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
      <AppDialog
        open={pendingConversationDeletion !== null}
        title="删除对话"
        description={
          pendingConversationDeletion
            ? `确定删除“${pendingConversationDeletion.title}”吗？本地保存的消息也会一并删除。`
            : ""
        }
        confirmLabel="删除对话"
        tone="danger"
        onCancel={() => setPendingConversationDeletion(null)}
        onConfirm={confirmConversationDeletion}
      />
    </>
  );
}

function SearchWorkspacePanel() {
  const [platforms, setPlatforms] = useState<SearchPlatform[]>([]);
  const [platformId, setPlatformId] =
    useState<RetainedSearchPlatformId>("douyin");
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(12);
  const [serviceState, setServiceState] = useState<
    "loading" | "ready" | "offline"
  >("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [guide, setGuide] = useState("");
  const [response, setResponse] = useState<SearchResponse>();
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);
  const [authorizationAction, setAuthorizationAction] = useState<
    "open" | "check" | ""
  >("");
  const [authorizationMessage, setAuthorizationMessage] = useState("");

  const selectedPlatform = platforms.find((item) => item.id === platformId);
  const readyCount = platforms.filter((item) => item.ready).length;

  useEffect(() => {
    const stored = parseStoredSearchWorkspace(
      window.localStorage.getItem(searchWorkspaceStorageKey),
    );
    if (stored) {
      setPlatformId(stored.platformId);
      setQuery(stored.query);
      setLimit(stored.limit);
      setResponse(stored.response);
      setRestoredFromStorage(Boolean(stored.response));
    }
    setStorageLoaded(true);
  }, []);

  useEffect(() => {
    if (!storageLoaded) return;
    try {
      if (!response) {
        window.localStorage.removeItem(searchWorkspaceStorageKey);
        return;
      }
      window.localStorage.setItem(
        searchWorkspaceStorageKey,
        JSON.stringify({
          version: 1,
          platformId,
          query,
          limit,
          response,
        }),
      );
    } catch {
      // Search remains usable even when browser storage is unavailable.
    }
  }, [limit, platformId, query, response, storageLoaded]);

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    async function loadStatus() {
      try {
        const statusResponse = await fetch("/api/research/status", {
          cache: "no-store",
        });
        const payload: unknown = await statusResponse.json();
        if (!statusResponse.ok) {
          const apiError = researchApiErrorSchema.safeParse(payload);
          throw new Error(
            apiError.success ? apiError.data.message : "搜索服务状态读取失败",
          );
        }
        const status = searchStatusResponseSchema.parse(payload);
        if (!active) return;
        setPlatforms(status.platforms);
        setServiceState(status.bridgeConfigured ? "ready" : "offline");
        setError("");
      } catch (reason) {
        if (!active) return;
        setServiceState("offline");
        setError(
          reason instanceof Error ? reason.message : "搜索服务状态读取失败",
        );
        retryTimer = setTimeout(() => void loadStatus(), 2_000);
      }
    }

    void loadStatus();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  async function runSearch() {
    const submittedQuery = query.trim();
    if (!submittedQuery) return;
    if (!selectedPlatform?.ready) {
      setError("该平台尚未完成账号授权，暂时不能搜索");
      setGuide(selectedPlatform?.guide ?? "");
      return;
    }
    setBusy(true);
    setError("");
    setGuide("");
    setResponse(undefined);
    setRestoredFromStorage(false);
    try {
      const params = new URLSearchParams({
        platform: platformId,
        q: submittedQuery,
        limit: String(limit),
      });
      const searchResponse = await fetch(
        `/api/research/search?${params.toString()}`,
        { cache: "no-store" },
      );
      const payload: unknown = await searchResponse.json();
      if (!searchResponse.ok) {
        const apiError = researchApiErrorSchema.safeParse(payload);
        if (apiError.success) {
          setGuide(apiError.data.guide ?? "");
          throw new Error(apiError.data.message);
        }
        throw new Error("搜索没有完成，请稍后重试");
      }
      setResponse(searchResponseSchema.parse(payload));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "搜索没有完成");
    } finally {
      setBusy(false);
    }
  }

  function clearSearchRecord() {
    setResponse(undefined);
    setQuery("");
    setError("");
    setGuide("");
    setRestoredFromStorage(false);
    try {
      window.localStorage.removeItem(searchWorkspaceStorageKey);
    } catch {
      // The visible record is still cleared when browser storage is unavailable.
    }
  }

  async function authorizeXiaohongshu(action: "open" | "check") {
    setAuthorizationAction(action);
    setAuthorizationMessage("");
    setError("");
    try {
      const authorizationResponse = await fetch("/api/research/authorize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ platform: "xiaohongshu", action }),
      });
      const payload: unknown = await authorizationResponse.json();
      if (!authorizationResponse.ok) {
        const apiError = researchApiErrorSchema.safeParse(payload);
        throw new Error(
          apiError.success ? apiError.data.message : "小红书授权操作失败",
        );
      }
      const result = researchAuthorizationResponseSchema.parse(payload);
      setAuthorizationMessage(result.message);
      if (result.authorized) {
        setPlatforms((current) =>
          current.map((platform) =>
            platform.id === "xiaohongshu"
              ? { ...platform, ready: true }
              : platform,
          ),
        );
        setGuide("");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "小红书授权操作失败");
    } finally {
      setAuthorizationAction("");
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col pt-5">
      <div className="relative z-30 shrink-0 rounded-2xl border border-black/[0.06] bg-gradient-to-br from-[#f7faff] to-[#fff8fb] p-4 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="grid size-9 place-items-center rounded-xl bg-[#eaf1fd] text-[#466a9f]">
                <svg
                  aria-hidden="true"
                  className="size-5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
              </span>
              <div>
                <h2 className="font-black">多平台搜索</h2>
                <p className="mt-0.5 text-xs text-black/40">
                  来源：本机 AI Agent 搜索服务
                </p>
              </div>
            </div>
          </div>
          <span
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${
              serviceState === "ready"
                ? "bg-emerald-50 text-emerald-700"
                : serviceState === "loading"
                  ? "bg-amber-50 text-amber-700"
                  : "bg-red-50 text-red-700"
            }`}
          >
            {serviceState === "ready"
              ? `● 服务已连接 · ${readyCount} 个平台可直接用`
              : serviceState === "loading"
                ? "正在连接搜索服务…"
                : "搜索服务未连接"}
          </span>
        </div>

        <form
          className="mt-5 grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)_100px_auto]"
          onSubmit={(event) => {
            event.preventDefault();
            void runSearch();
          }}
        >
          <div className="grid gap-1.5 text-xs font-bold text-black/50">
            <span>搜索平台</span>
            <SearchDropdown
              value={platformId}
              onSelect={(value) => {
                setPlatformId(retainedSearchPlatformIdSchema.parse(value));
                setResponse(undefined);
                setError("");
                setGuide("");
                setAuthorizationMessage("");
              }}
              disabled={platforms.length === 0}
              placeholder="平台载入中…"
              options={platforms.map((platform) => ({
                value: platform.id,
                label: platform.name,
                detail: `${platform.group} · AI 智能搜索`,
                available: platform.ready,
              }))}
            />
          </div>

          <label className="grid gap-1.5 text-xs font-bold text-black/50">
            搜索问题或需求
            <span className="flex h-12 items-center rounded-xl border border-[#d5deeb] bg-white px-3 focus-within:border-[#6e8cb8] focus-within:ring-4 focus-within:ring-[#6e8cb8]/10">
              <svg
                aria-hidden="true"
                className="mr-2 size-4 shrink-0 text-[#8194b0]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-4-4" />
              </svg>
              <input
                type={selectedPlatform?.mode === "url" ? "url" : "search"}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                placeholder={
                  "直接描述搜索要求，例如：最近7天职场选题，点赞超过4万"
                }
                className="min-w-0 flex-1 bg-transparent text-sm text-black/80 outline-none placeholder:text-black/30"
              />
            </span>
          </label>

          <div className="grid gap-1.5 text-xs font-bold text-black/50">
            <span>结果数</span>
            <SearchDropdown
              value={String(limit)}
              onSelect={(value) => setLimit(Number(value))}
              options={[
                { value: "8", label: "8 条", detail: "快速查看" },
                { value: "12", label: "12 条", detail: "常用" },
                { value: "20", label: "20 条", detail: "更多参考" },
                { value: "30", label: "30 条", detail: "完整结果" },
              ]}
            />
          </div>

          <button
            type="submit"
            disabled={
              busy ||
              serviceState !== "ready" ||
              !selectedPlatform?.ready ||
              !query.trim()
            }
            className="mt-auto h-12 rounded-xl bg-[#36588f] px-6 text-sm font-black text-white shadow-sm transition hover:bg-[#2c4b79] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy
              ? "检索中…"
              : selectedPlatform?.mode === "url"
                ? "读取内容"
                : "开始智能搜索"}
          </button>
        </form>

        {selectedPlatform?.id === "xiaohongshu" &&
          selectedPlatform.guide &&
          (!selectedPlatform.ready || Boolean(error)) && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-black/45">
              <span className="rounded-full bg-amber-50 px-3 py-2 font-bold text-amber-700">
                {selectedPlatform.guide}
              </span>
              <>
                <button
                  type="button"
                  disabled={Boolean(authorizationAction)}
                  onClick={() => void authorizeXiaohongshu("open")}
                  className="rounded-xl border border-[#d5deeb] bg-white px-4 py-2 font-black text-[#36588f] shadow-sm transition hover:border-[#89a2c5] hover:bg-[#f7faff] disabled:opacity-40"
                >
                  {authorizationAction === "open"
                    ? "正在打开…"
                    : "在 Chrome 打开登录"}
                </button>
                <button
                  type="button"
                  disabled={Boolean(authorizationAction)}
                  onClick={() => void authorizeXiaohongshu("check")}
                  className="rounded-xl bg-[#36588f] px-4 py-2 font-black text-white shadow-sm transition hover:bg-[#2c4b79] disabled:opacity-40"
                >
                  {authorizationAction === "check"
                    ? "正在检测授权…"
                    : "我已登录，检测授权"}
                </button>
              </>
            </div>
          )}
        {authorizationMessage && (
          <p className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
            {authorizationMessage}
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {(error || guide) && (
          <div className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            <p className="font-black">{error}</p>
            {guide && <p className="mt-1 text-xs leading-5">{guide}</p>}
          </div>
        )}

        {busy && (
          <div className="mt-5 grid min-h-56 place-items-center rounded-2xl border border-dashed border-[#cad6e7] bg-[#f8faff] text-center">
            <div>
              <span className="mx-auto block size-8 animate-spin rounded-full border-2 border-[#91a8c9] border-t-[#36588f]" />
              <p className="mt-3 text-sm font-black text-[#526b8f]">
                AI 正在理解需求并调用 {selectedPlatform?.name ?? "平台"} 搜索
              </p>
              <p className="mt-1 text-xs text-black/35">
                将自动提炼搜索词、分批检索并筛选结果
              </p>
            </div>
          </div>
        )}

        {!busy && response && (
          <div className="mt-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs font-black tracking-[0.16em] text-[#758aa8]">
                  SEARCH RESULTS
                </p>
                <h2 className="mt-1 text-xl font-black">
                  {selectedPlatform?.name ?? response.platform} · “
                  {response.query}”
                </h2>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {restoredFromStorage && (
                  <span className="rounded-full bg-[#edf3fb] px-2.5 py-1 text-[10px] font-black text-[#5b759b]">
                    本地记录
                  </span>
                )}
                <p className="text-xs text-black/40">
                  {response.count} 条结果 ·{" "}
                  {new Date(response.fetchedAt).toLocaleString("zh-CN", {
                    hour12: false,
                  })}
                </p>
                <button
                  type="button"
                  onClick={clearSearchRecord}
                  className="rounded-lg border border-red-100 bg-white px-3 py-1.5 text-xs font-black text-red-600 transition hover:bg-red-50"
                >
                  清空记录
                </button>
              </div>
            </div>

            {response.plan && (
              <div className="mt-4 rounded-xl border border-[#dce5f1] bg-[#f7f9fc] px-4 py-3 text-xs text-[#526b8f]">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="font-black text-[#314b70]">
                    AI 搜索方案
                  </strong>
                  {response.plan.queries.map((plannedQuery) => (
                    <span
                      key={plannedQuery}
                      className="rounded-full bg-white px-2.5 py-1 font-bold shadow-sm"
                    >
                      搜索词：{plannedQuery}
                    </span>
                  ))}
                </div>
                <p className="mt-2 leading-5">{response.plan.summary}</p>
              </div>
            )}

            {response.results.length > 0 ? (
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {response.results.map((item, index) => (
                  <article
                    key={`${item.url || item.title}-${index}`}
                    className="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm transition hover:border-[#9db2d2] hover:shadow-md"
                  >
                    <div className="flex items-start gap-3">
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#edf3fb] text-xs font-black text-[#5b759b]">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0 flex-1">
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-black leading-6 text-[#233a5e] hover:text-[#2e6eb5] hover:underline"
                          >
                            {item.title}
                          </a>
                        ) : (
                          <h3 className="font-black leading-6 text-[#233a5e]">
                            {item.title}
                          </h3>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-black/45">
                          <span>{item.author || selectedPlatform?.name}</span>
                          {item.metricText && (
                            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-600">
                              {item.metricText}
                            </span>
                          )}
                          {item.date && <span>{item.date}</span>}
                        </div>
                        {item.summary && (
                          <p className="mt-3 max-h-24 overflow-hidden text-xs leading-5 text-black/50">
                            {item.summary}
                          </p>
                        )}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-black/10 py-16 text-center text-sm text-black/40">
                没有找到匹配结果，请更换关键词或检索条件
              </div>
            )}
          </div>
        )}

        {!busy && !response && !error && (
          <div className="mt-5 grid min-h-56 place-items-center rounded-2xl border border-dashed border-[#cad6e7] bg-[#f8faff] px-6 text-center">
            <div>
              <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-white text-[#6d86aa] shadow-sm">
                <svg
                  aria-hidden="true"
                  className="size-6"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
              </span>
              <p className="mt-3 font-black text-[#526b8f]">
                选择平台并描述搜索需求
              </p>
              <p className="mt-1 text-xs text-black/35">
                搜索结果只作创作参考，使用前请核实来源与授权
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SearchDropdown({
  value,
  options,
  onSelect,
  disabled = false,
  placeholder = "请选择",
}: {
  value: string;
  options: Array<{
    value: string;
    label: string;
    detail?: string;
    available?: boolean;
  }>;
  onSelect: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  function toggle() {
    if (disabled) return;
    const nextOpen = !open;
    if (nextOpen && rootRef.current) {
      const rect = rootRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      setOpenUp(spaceBelow < 330 && rect.top > spaceBelow);
    }
    setOpen(nextOpen);
  }

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`group flex h-12 w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 text-left shadow-sm outline-none transition-all duration-200 ${
          open
            ? "border-[#6e8cb8] shadow-[0_8px_22px_rgb(54_88_143/14%)] ring-4 ring-[#6e8cb8]/10"
            : "border-[#d5deeb] hover:-translate-y-px hover:border-[#9eb1cb] hover:shadow-md"
        } ${disabled ? "cursor-not-allowed opacity-55" : ""}`}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          {typeof selected?.available === "boolean" ? (
            <span
              className={`size-2 shrink-0 rounded-full ring-4 ${
                selected.available
                  ? "bg-emerald-400 ring-emerald-50"
                  : "bg-amber-400 ring-amber-50"
              }`}
            />
          ) : (
            <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#edf3fb] text-[11px] font-black text-[#58739a]">
              {selected?.value ?? "—"}
            </span>
          )}
          <span className="min-w-0">
            <strong className="block truncate text-sm font-black text-[#263a59]">
              {selected?.label ?? placeholder}
            </strong>
            {selected?.detail && (
              <span className="mt-0.5 block truncate text-[10px] font-medium text-black/35">
                {selected.detail}
              </span>
            )}
          </span>
        </span>
        <span
          className={`grid size-7 shrink-0 place-items-center rounded-lg text-[#7387a5] transition duration-200 group-hover:bg-[#f1f5fb] ${
            open ? "rotate-180 bg-[#edf3fb] text-[#36588f]" : ""
          }`}
        >
          <svg
            aria-hidden="true"
            className="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute inset-x-0 z-[65] max-h-80 overflow-y-auto rounded-2xl border border-[#d7e0ed] bg-white/95 p-1.5 shadow-[0_22px_55px_rgb(37_58_89/20%)] backdrop-blur-xl ${
            openUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                  active
                    ? "bg-[#eaf1fb] text-[#284b7b]"
                    : "text-[#34445c] hover:bg-[#f4f7fb]"
                }`}
              >
                {typeof option.available === "boolean" ? (
                  <span
                    className={`size-2 shrink-0 rounded-full ${
                      option.available ? "bg-emerald-400" : "bg-amber-400"
                    }`}
                  />
                ) : (
                  <span
                    className={`grid size-8 shrink-0 place-items-center rounded-lg text-[11px] font-black ${
                      active
                        ? "bg-white text-[#36588f] shadow-sm"
                        : "bg-[#eef2f7] text-[#71839d]"
                    }`}
                  >
                    {option.value}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">
                    {option.label}
                  </strong>
                  {option.detail && (
                    <span className="mt-0.5 block truncate text-[10px] font-medium opacity-50">
                      {option.detail}
                    </span>
                  )}
                </span>
                {typeof option.available === "boolean" && (
                  <span
                    className={`rounded-full px-2 py-1 text-[9px] font-black ${
                      option.available
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-amber-50 text-amber-700"
                    }`}
                  >
                    {option.available ? "可用" : "需授权"}
                  </span>
                )}
                {active && (
                  <svg
                    aria-hidden="true"
                    className="size-4 shrink-0 text-[#36588f]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ProjectSelect({
  projects,
  value,
  onSelect,
}: {
  projects: ProjectSummary[];
  value: string;
  onSelect: (projectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = projects.find((item) => item.id === value);

  function toggle() {
    const nextOpen = !open;
    if (nextOpen && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUp(spaceBelow < 360 && spaceAbove > spaceBelow);
    }
    setOpen(nextOpen);
  }

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative w-64">
      <button
        type="button"
        onClick={toggle}
        className={`flex h-10 w-full items-center gap-2.5 rounded-xl border bg-white px-3 text-left shadow-sm transition ${
          open
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
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
          </svg>
        </span>
        <span className="min-w-0 flex-1">
          <strong
            className={`block truncate text-sm font-black ${
              selected ? "text-[#20252b]" : "text-black/45"
            }`}
          >
            {selected ? selected.title : "选择项目"}
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
            open ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className={`absolute right-0 z-50 max-h-80 w-full overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-2 shadow-[0_18px_40px_rgb(0_0_0/14%)] ${
            openUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              onSelect("");
              setOpen(false);
            }}
            className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
              !value ? "bg-cyan-50" : "hover:bg-[#f1f4f5]"
            }`}
          >
            <span className="min-w-0 flex-1">
              <strong className="block text-sm">选择项目</strong>
            </span>
            {!value && (
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
          {projects.map((item) => {
            const active = item.id === value;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                  active ? "bg-cyan-50" : "hover:bg-[#f1f4f5]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">
                    {item.title}
                  </strong>
                  <span className="mt-0.5 block text-[11px] text-black/40">
                    {item._count.scenes} 个分镜
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
          {projects.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-black/35">
              暂无项目
            </p>
          )}
        </div>
      )}
    </div>
  );
}

async function downloadAssetFile(
  assetId: string,
  fileName: string,
): Promise<void> {
  const response = await fetch(`/api/assets/${assetId}/content?download=1`);
  if (!response.ok) throw new Error("COVER_DOWNLOAD_FAILED");
  downloadBlob(await response.blob(), fileName);
}

function ProjectsPanel({
  projects,
  onCreate,
  onOpen,
  onDelete,
  onRename,
}: {
  projects: ProjectSummary[];
  onCreate: () => void;
  onOpen: (projectId: string) => void;
  onDelete: (projectId: string, title: string) => void;
  onRename: (projectId: string, currentTitle: string) => void;
}) {
  return (
    <section className="pt-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-black/45">共 {projects.length} 个项目</p>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-xl bg-[#11151b] px-5 py-3 text-sm font-black text-white"
        >
          ＋ 新建视频
        </button>
      </div>
      <div className="mt-5 grid gap-4">
        {projects.map((item) => (
          <article
            key={item.id}
            className="group flex flex-col gap-4 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm transition hover:border-black/10 hover:shadow-md sm:flex-row sm:items-center"
          >
            <ProjectCoverPreview project={item} />
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="min-w-0 flex-1 text-left"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                  {statusLabels[item.status] ?? item.status}
                </span>
                <span className="text-xs text-black/40">
                  {item.targetDuration > 0
                    ? `约 ${item.targetDuration} 秒`
                    : "正在计算时长"}
                </span>
              </div>
              <h2 className="mt-2 truncate text-xl font-black">{item.title}</h2>
              <p className="mt-1 text-xs text-black/40">
                {item._count.scenes} 个分镜 ·{" "}
                {new Date(item.updatedAt).toLocaleString("zh-CN")}
              </p>
            </button>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="rounded-xl bg-[#11151b] px-4 py-2 text-xs font-black text-white"
              >
                打开编辑
              </button>
              <button
                type="button"
                onClick={() => onRename(item.id, item.title)}
                className="rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-black text-[#20252b] hover:bg-[#f1f4f5]"
              >
                重命名
              </button>
              <button
                type="button"
                onClick={() => onDelete(item.id, item.title)}
                className="rounded-xl border border-red-100 px-3 py-2 text-xs font-black text-red-600 hover:bg-red-50"
              >
                删除项目
              </button>
            </div>
          </article>
        ))}
        {projects.length === 0 && (
          <button
            type="button"
            onClick={onCreate}
            className="min-h-64 rounded-2xl border-2 border-dashed border-black/10 text-black/35 hover:border-cyan-400 hover:text-cyan-600"
          >
            ＋ 创建第一个视频
          </button>
        )}
      </div>
    </section>
  );
}

function ProjectCoverPreview({ project }: { project: ProjectSummary }) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloadKind, setDownloadKind] = useState<
    "portrait" | "landscape" | null
  >(null);
  const [coverLoadFailed, setCoverLoadFailed] = useState(false);
  const readyAssets = findReadyProjectCoverAssets(
    project.revision,
    project.assets,
  );
  const portraitAsset = readyAssets?.portrait;
  const landscapeAsset = readyAssets?.landscape;
  const parsedSubtitleStyle = subtitleStyleSchema.safeParse(
    project.subtitleStyle,
  );
  const coverEnabled = Boolean(
    parsedSubtitleStyle.success && parsedSubtitleStyle.data.coverTemplate,
  );
  const displayState = projectCoverDisplayState({
    coverEnabled,
    projectCompleted: project.status === "COMPLETED",
    assetsReady: Boolean(portraitAsset && landscapeAsset),
    loadFailed: coverLoadFailed,
  });

  useEffect(() => {
    setCoverLoadFailed(false);
  }, [portraitAsset?.id, landscapeAsset?.id]);

  useEffect(() => {
    if (!previewOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewOpen]);

  async function downloadPortrait(): Promise<void> {
    if (!portraitAsset) return;
    setDownloadKind("portrait");
    try {
      const fileName = coverDownloadFileName(`${project.title}-竖屏`);
      await downloadAssetFile(portraitAsset.id, fileName);
    } finally {
      setDownloadKind(null);
    }
  }

  async function downloadLandscape(): Promise<void> {
    if (!landscapeAsset) return;
    setDownloadKind("landscape");
    try {
      const fileName = coverDownloadFileName(`${project.title}-横屏`);
      await downloadAssetFile(landscapeAsset.id, fileName);
    } finally {
      setDownloadKind(null);
    }
  }

  if (displayState !== "READY" || !portraitAsset || !landscapeAsset) {
    const noCover = displayState === "NONE";
    return (
      <div className="grid aspect-video w-full shrink-0 place-items-center overflow-hidden rounded-xl border border-dashed border-black/10 bg-[#f4f6f7] text-center sm:h-24 sm:w-40">
        <div>
          <div className="mx-auto grid size-8 place-items-center rounded-full bg-white text-sm text-black/25 shadow-sm">
            {noCover ? "—" : "◌"}
          </div>
          <p className="mt-2 text-xs font-black text-black/35">
            {noCover ? "暂未选择封面" : "封面生成中"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="relative aspect-video w-full shrink-0 sm:h-24 sm:w-40">
        <button
          type="button"
          aria-label={`${project.title} 封面预览`}
          onClick={() => setPreviewOpen(true)}
          className="relative size-full overflow-hidden rounded-xl border border-black/[0.05] bg-black"
        >
          <img
            src={`/api/assets/${landscapeAsset.id}/content`}
            alt={`${project.title} 封面`}
            onError={() => setCoverLoadFailed(true)}
            className="absolute inset-0 size-full object-cover"
          />
        </button>
      </div>

      {previewOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/55 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="封面预览"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="w-full max-w-4xl rounded-2xl bg-white p-5 shadow-2xl sm:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-5 flex items-center justify-between">
              <h3 className="text-lg font-black text-[#20252b]">封面预览</h3>
              <button
                type="button"
                aria-label="关闭封面预览"
                onClick={() => setPreviewOpen(false)}
                className="grid size-9 place-items-center rounded-full text-2xl leading-none text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                ×
              </button>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-2 text-center text-sm font-black text-slate-500">
                  横屏 16:9
                </p>
                <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
                  <img
                    src={`/api/assets/${landscapeAsset.id}/content`}
                    alt={`${project.title} 横屏封面`}
                    onError={() => setCoverLoadFailed(true)}
                    className="absolute inset-0 size-full object-cover"
                  />
                </div>
                <button
                  type="button"
                  disabled={downloadKind !== null}
                  onClick={() =>
                    void downloadLandscape().catch(() => undefined)
                  }
                  className="mt-3 w-full rounded-xl bg-[#eef2f6] px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-[#e3e9ef] disabled:cursor-wait disabled:opacity-50"
                >
                  {downloadKind === "landscape"
                    ? "正在生成横屏封面..."
                    : "下载横屏封面"}
                </button>
              </div>

              <div className="min-w-0">
                <p className="mb-2 text-center text-sm font-black text-slate-500">
                  竖屏 3:4
                </p>
                <div className="mx-auto aspect-[3/4] max-h-[55vh] w-full max-w-[280px] overflow-hidden rounded-xl bg-black">
                  <img
                    src={`/api/assets/${portraitAsset.id}/content`}
                    alt={`${project.title} 竖屏封面`}
                    onError={() => setCoverLoadFailed(true)}
                    className="block size-full object-contain"
                  />
                </div>
                <button
                  type="button"
                  disabled={downloadKind !== null}
                  onClick={() => void downloadPortrait().catch(() => undefined)}
                  className="mt-3 w-full rounded-xl bg-[#eef2f6] px-4 py-2.5 text-sm font-black text-slate-700 transition hover:bg-[#e3e9ef] disabled:cursor-wait disabled:opacity-50"
                >
                  {downloadKind === "portrait"
                    ? "正在生成竖屏封面..."
                    : "下载竖屏封面"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ProjectPanel({
  view,
  project,
  loading,
  setLoading,
  reload,
  setMessage,
  setError,
  message,
  error,
  onOpen,
}: {
  view: WorkspaceView;
  project: Project | undefined;
  loading: boolean;
  setLoading: (value: boolean) => void;
  reload: () => Promise<void>;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
  message: string;
  error: string;
  onOpen: (view: WorkspaceView) => void;
}) {
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const [sceneDrafts, setSceneDrafts] = useState<
    ProjectWorkspaceState["sceneDrafts"]
  >({});
  const [expandedSceneIds, setExpandedSceneIds] = useState<string[]>([]);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [selectedRenderOutputId, setSelectedRenderOutputId] = useState("");
  const [pendingRenderDeletion, setPendingRenderDeletion] = useState<{
    jobId: string;
    hasOutput: boolean;
  } | null>(null);
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfileSummary[]>([]);
  const [voiceProfilesLoading, setVoiceProfilesLoading] = useState(true);
  const [voiceProfileLoadError, setVoiceProfileLoadError] = useState("");
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState("");
  const [projectWorkspaceStateLoadedFor, setProjectWorkspaceStateLoadedFor] =
    useState("");

  useEffect(() => {
    let cancelled = false;
    setVoiceProfilesLoading(true);
    setVoiceProfileLoadError("");
    void fetch("/api/voice-profiles")
      .then(async (response) => {
        const raw: unknown = await response.json();
        if (!response.ok) {
          const errorData = apiErrorResponseSchema.safeParse(raw);
          throw new Error(
            errorData.success && errorData.data.error
              ? errorData.data.error
              : "音色列表加载失败",
          );
        }
        const parsed = z
          .object({
            profiles: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                assetId: z.string(),
                fileName: z.string(),
                createdAt: z.string(),
                builtin: z.boolean(),
                available: z.boolean(),
              }),
            ),
          })
          .safeParse(raw);
        if (!parsed.success) throw new Error("音色列表数据格式无效");
        return parsed.data.profiles;
      })
      .then((profiles) => {
        if (cancelled) return;
        setVoiceProfiles(profiles);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setVoiceProfileLoadError(
          reason instanceof Error ? reason.message : "音色列表加载失败",
        );
      })
      .finally(() => {
        if (!cancelled) setVoiceProfilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSelectedVoiceProfileId(project?.voiceProfileId ?? "");
  }, [project?.id, project?.voiceProfileId]);

  const latestRender = project?.jobs.find((job) => job.type === "RENDER");
  const latestScriptJob = project?.jobs.find((job) => job.type === "SCRIPT");
  const voicedScenes =
    project?.scenes.filter((scene) => scene.voiceTracks.length > 0).length ?? 0;
  const generatedScenes = project
    ? project.scenes.filter((scene) => getCurrentSceneImage(project, scene))
        .length
    : 0;
  const latestSceneImageJob = project?.jobs.find((job) => job.type === "SCENE");
  const voiceJobs = project?.jobs.filter((job) => job.type === "VOICE") ?? [];
  const currentVoiceJobs = latestVoiceJobAttempts(voiceJobs);
  const voiceJobTotal = currentVoiceJobs.length;
  const voiceJobDone = currentVoiceJobs.filter(
    (job) => job.status === "SUCCEEDED",
  ).length;
  const voiceJobFailed = currentVoiceJobs.filter(
    (job) => job.status === "FAILED",
  ).length;
  const activeVoiceJobs = currentVoiceJobs.filter((job) =>
    ["QUEUED", "RUNNING", "RETRYING"].includes(job.status),
  );
  const failedVoiceSceneIdList = failedVoiceSceneIds(
    currentVoiceJobs,
    project?.scenes.map((scene) => scene.id) ?? [],
  );
  const voiceProgress = voiceJobTotal
    ? Math.round((voiceJobDone / voiceJobTotal) * 100)
    : 0;
  const jianyingJobs =
    project?.jobs.filter((job) => job.type === "JIANYING_DRAFT") ?? [];
  const activeJianyingJob = jianyingJobs.find((job) =>
    ["QUEUED", "RUNNING", "RETRYING"].includes(job.status),
  );
  const latestCreatedDraftJob = jianyingJobs.find(
    (job) => job.status === "SUCCEEDED" && job.output?.action === "CREATE",
  );
  const relatedInstallJob = latestCreatedDraftJob
    ? jianyingJobs.find(
        (job) =>
          job.input?.action === "INSTALL" &&
          job.input.draftJobId === latestCreatedDraftJob.id,
      )
    : undefined;
  const latestJianyingJob = jianyingJobs[0];

  useEffect(() => {
    if (!project) return;
    const availableSceneIds = new Set(project.scenes.map((scene) => scene.id));
    let stored: ProjectWorkspaceState | undefined;
    try {
      stored = parseStoredProjectWorkspaceState(
        window.localStorage.getItem(
          projectWorkspaceStateStorageKey(project.id),
        ),
      );
    } catch {
      // Continue with project defaults when browser storage is unavailable.
    }
    setSelectedSceneIds(
      stored?.selectedSceneIds.filter((id) => availableSceneIds.has(id)) ?? [],
    );
    setExpandedSceneIds(
      stored
        ? stored.expandedSceneIds.filter((id) => availableSceneIds.has(id))
        : [...availableSceneIds],
    );
    setSceneDrafts(
      stored
        ? Object.fromEntries(
            Object.entries(stored.sceneDrafts).filter(([sceneId]) =>
              availableSceneIds.has(sceneId),
            ),
          )
        : {},
    );
    setSelectedRenderOutputId(
      stored &&
        project.renderOutputs.some(
          (output) => output.id === stored.selectedRenderOutputId,
        )
        ? stored.selectedRenderOutputId
        : (project.renderOutputs[0]?.id ?? ""),
    );
    setProjectWorkspaceStateLoadedFor(project.id);
  }, [project?.id]);

  useEffect(() => {
    if (!project || projectWorkspaceStateLoadedFor !== project.id) return;
    const availableSceneIds = new Set(project.scenes.map((scene) => scene.id));
    setSelectedSceneIds((current) =>
      current.filter((id) => availableSceneIds.has(id)),
    );
    setExpandedSceneIds((current) =>
      current.filter((id) => availableSceneIds.has(id)),
    );
    setSceneDrafts((current) => {
      const retainedEntries = Object.entries(current).filter(
        ([sceneId, draft]) => {
          const scene = project.scenes.find((item) => item.id === sceneId);
          if (!scene) return false;
          return (
            (draft.narration !== undefined &&
              draft.narration !== scene.narration) ||
            (draft.subtitle !== undefined &&
              draft.subtitle !== scene.subtitle) ||
            (draft.visualPrompt !== undefined &&
              draft.visualPrompt !== scene.visualPrompt)
          );
        },
      );
      if (retainedEntries.length === Object.keys(current).length)
        return current;
      return Object.fromEntries(retainedEntries);
    });
    setSelectedRenderOutputId((current) => {
      if (project.renderOutputs.some((output) => output.id === current)) {
        return current;
      }
      return project.renderOutputs[0]?.id ?? "";
    });
  }, [
    project?.renderOutputs,
    project?.scenes,
    project?.id,
    projectWorkspaceStateLoadedFor,
  ]);

  useEffect(() => {
    if (!project || projectWorkspaceStateLoadedFor !== project.id) return;
    const nextState: ProjectWorkspaceState = {
      selectedSceneIds,
      expandedSceneIds,
      selectedRenderOutputId,
      sceneDrafts,
    };
    try {
      window.localStorage.setItem(
        projectWorkspaceStateStorageKey(project.id),
        JSON.stringify(nextState),
      );
    } catch {
      // Keep in-memory editing available when browser storage is unavailable.
    }
  }, [
    expandedSceneIds,
    project,
    projectWorkspaceStateLoadedFor,
    sceneDrafts,
    selectedRenderOutputId,
    selectedSceneIds,
  ]);

  useEffect(() => {
    if (!lightboxAssetId) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setLightboxAssetId(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [lightboxAssetId]);
  const progressItems = useMemo(
    () =>
      [
        ["文案", Boolean(project?.sourceText)],
        ["分镜", Boolean(project?.scenes.length)],
        [
          "画面",
          Boolean(
            project?.scenes.length && generatedScenes === project.scenes.length,
          ),
        ],
        [
          "配音",
          Boolean(
            project?.scenes.length && voicedScenes === project.scenes.length,
          ),
        ],
        ["渲染", Boolean(project?.renderOutputs.length)],
        ["导出", Boolean(project?.renderOutputs.length)],
      ] as Array<[string, boolean]>,
    [project, generatedScenes, voicedScenes],
  );
  const completedProgressCount = progressItems.filter(
    ([, complete]) => complete,
  ).length;
  const progressPercent = Math.round(
    (completedProgressCount / Math.max(1, progressItems.length)) * 100,
  );

  if (!project) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-black/40">
        正在加载项目…
      </div>
    );
  }

  const selectedProject = project;
  const selectedRenderOutput =
    selectedProject.renderOutputs.find(
      (output) => output.id === selectedRenderOutputId,
    ) ?? selectedProject.renderOutputs[0];
  const outputForRenderJob = (jobId: string) =>
    selectedProject.renderOutputs.find((output) =>
      output.asset.objectKey.endsWith(`/renders/${jobId}.mp4`),
    );
  const failedJobCurrentSceneIds = (
    latestSceneImageJob?.input?.sceneIds ?? []
  ).filter((sceneId) =>
    selectedProject.scenes.some((scene) => scene.id === sceneId),
  );
  const failedSceneImageIds =
    latestSceneImageJob?.status === "FAILED"
      ? failedJobCurrentSceneIds.length > 0
        ? failedJobCurrentSceneIds
        : selectedProject.scenes
            .filter((scene) => !getCurrentSceneImage(selectedProject, scene))
            .map((scene) => scene.id)
      : [];

  async function runAction(
    action: () => Promise<Response>,
    successMessage: string,
  ) {
    setLoading(true);
    setError("");
    try {
      const response = await action();
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "操作失败");
      }
      setMessage(successMessage);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  async function generateSceneImages(sceneIds: string[], label: string) {
    if (sceneIds.length === 0) {
      setError("请先勾选至少一个分镜");
      return;
    }
    await runAction(
      () =>
        fetch(`/api/projects/${selectedProject.id}/images`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sceneIds }),
        }),
      `${label}已加入画面生成队列，每批并行生成 6 个分镜`,
    );
    setSelectedSceneIds([]);
  }

  async function generateAllVoices() {
    if (selectedProject.scenes.length === 0) {
      setError("当前项目还没有分镜");
      return;
    }
    if (selectedProject.voiceStyle === "none") {
      setError("当前项目未配置配音服务");
      return;
    }
    await runAction(async () => {
      const voiceGroups = groupScenesForContinuousVoice(selectedProject.scenes);
      for (const voiceGroup of voiceGroups) {
        const scene = voiceGroup[0];
        if (!scene) continue;
        const response = await fetch(
          `/api/projects/${selectedProject.id}/scenes/${scene.id}/voice`,
          { method: "POST" },
        );
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(
            data.error ?? `第 ${scene.order + 1} 个分镜配音提交失败`,
          );
        }
      }
      return new Response(null, { status: 202 });
    }, "全部配音已按当前音色的原生朗读方式加入生成队列");
  }

  async function saveProjectVoiceProfile(profileId: string) {
    if (!profileId) {
      setError("请先选择一个音色");
      return;
    }
    if (profileId === selectedProject.voiceProfileId) {
      setMessage("当前项目已经使用这个音色");
      return;
    }
    const activeMediaJob = selectedProject.jobs.some(
      (job) =>
        ["VOICE", "AUDIO_MIX", "RENDER"].includes(job.type) &&
        ["QUEUED", "RUNNING", "RETRYING"].includes(job.status),
    );
    if (activeMediaJob) {
      setError("当前有配音、混音或渲染任务进行中，请完成后再切换音色");
      return;
    }
    await runAction(
      () =>
        fetch(`/api/projects/${selectedProject.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            voiceStyle: "indextts2",
            voiceProfileId: profileId,
          }),
        }),
      "当前项目音色已保存；现有配音未改变",
    );
  }

  async function retryFailedVoices() {
    if (failedVoiceSceneIdList.length === 0) {
      setError("当前没有可重新生成的失败配音");
      return;
    }
    if (selectedProject.voiceStyle === "none") {
      setError("当前项目未配置配音服务");
      return;
    }
    await runAction(async () => {
      for (const sceneId of failedVoiceSceneIdList) {
        const response = await fetch(
          `/api/projects/${selectedProject.id}/scenes/${sceneId}/voice`,
          { method: "POST" },
        );
        if (!response.ok) {
          const data = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(data.error ?? "失败配音重新生成提交失败");
        }
      }
      return new Response(null, { status: 202 });
    }, `已重新提交 ${failedVoiceSceneIdList.length} 段失败配音`);
  }

  function toggleSceneSelection(sceneId: string) {
    setSelectedSceneIds((current) =>
      current.includes(sceneId)
        ? current.filter((id) => id !== sceneId)
        : [...current, sceneId],
    );
  }

  function toggleSceneExpanded(sceneId: string) {
    setExpandedSceneIds((current) =>
      current.includes(sceneId)
        ? current.filter((id) => id !== sceneId)
        : [...current, sceneId],
    );
  }

  function toggleAllSceneExpanded() {
    setExpandedSceneIds((current) =>
      current.length === selectedProject.scenes.length &&
      selectedProject.scenes.length > 0
        ? []
        : selectedProject.scenes.map((scene) => scene.id),
    );
  }

  function toggleAllSceneSelection() {
    setSelectedSceneIds((current) =>
      current.length === selectedProject.scenes.length
        ? []
        : selectedProject.scenes.map((scene) => scene.id),
    );
  }

  function updateScene(
    sceneId: string,
    patch: Partial<Pick<Scene, "narration" | "subtitle" | "visualPrompt">>,
  ) {
    setSceneDrafts((current) => ({
      ...current,
      [sceneId]: { ...current[sceneId], ...patch },
    }));
  }

  function getEditedScene(scene: Scene): Scene {
    const draft = sceneDrafts[scene.id];
    return {
      ...scene,
      narration: draft?.narration ?? scene.narration,
      subtitle: draft?.subtitle ?? scene.subtitle,
      visualPrompt: draft?.visualPrompt ?? scene.visualPrompt,
    };
  }

  async function saveScene(scene: Scene) {
    await runAction(
      () =>
        fetch(`/api/projects/${selectedProject.id}/scenes/${scene.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            narration: scene.narration,
            subtitle: scene.subtitle,
            estimatedDuration: scene.estimatedDuration,
            visualPrompt: scene.visualPrompt,
          }),
        }),
      `第 ${scene.order + 1} 个分镜已保存`,
    );
    setSceneDrafts((current) => {
      const next = { ...current };
      delete next[scene.id];
      return next;
    });
  }

  async function moveScene(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= selectedProject.scenes.length) return;
    const ordered = selectedProject.scenes.map(({ id }) => id);
    [ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!];
    await runAction(
      () =>
        fetch(`/api/projects/${selectedProject.id}/scenes/reorder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sceneIds: ordered,
            expectedProjectRevision: selectedProject.revision,
          }),
        }),
      "分镜顺序已更新",
    );
  }

  async function uploadMusic(file: File) {
    if (!["audio/mpeg", "audio/wav", "audio/mp4"].includes(file.type)) {
      setError("仅支持 MP3、WAV 或 M4A 音频");
      return;
    }
    setLoading(true);
    try {
      const create = await fetch(`/api/projects/${selectedProject.id}/music`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type,
          byteSize: file.size,
        }),
      });
      const data = (await create.json()) as {
        uploadUrl?: string;
        error?: string;
      };
      if (!create.ok || !data.uploadUrl) {
        throw new Error(data.error ?? "音乐上传任务创建失败");
      }
      const upload = await fetch(data.uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!upload.ok) throw new Error("音乐文件保存失败");
      setMessage("背景音乐已保存，渲染时会自动压低以突出人声");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "音乐上传失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={`flex min-h-0 flex-col pt-5 ${
        view === "preview" ||
        view === "storyboard" ||
        view === "render" ||
        view === "export"
          ? "h-full overflow-hidden"
          : ""
      }`}
    >
      <div className="sticky top-0 z-20 bg-white pb-2">
        <section className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-black text-emerald-700">
                  {statusLabels[project.status] ?? project.status} · REV{" "}
                  {project.revision}
                </span>
                <span className="text-xs text-black/40">
                  {project.scenes.length} 个分镜 · 约 {project.targetDuration}{" "}
                  秒 · {project.aspectRatio === "PORTRAIT" ? "9:16" : "16:9"}
                </span>
              </div>
            </div>
            <div className="w-full max-w-xs">
              <div className="flex items-center justify-between text-[10px] font-black text-black/40">
                <span>制作进度</span>
                <span>
                  {completedProgressCount}/{progressItems.length}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                <div
                  className="h-full rounded-full bg-[#16bec8] transition-all"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          </div>
        </section>

        <nav className="mt-5 flex gap-1 border-b border-black/[0.06]">
          {(
            [
              ["storyboard", "分镜编辑"],
              ["preview", "分镜图片预览"],
              ["render", "渲染进度"],
              ["export", "导出成片"],
            ] as const
          ).map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              onClick={() => onOpen(tab)}
              className={`relative px-4 pb-3 pt-1 text-sm font-bold transition ${
                view === tab
                  ? "text-[#0f8791]"
                  : "text-black/40 hover:text-black"
              }`}
            >
              {label}
              {view === tab && (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[#16bec8]" />
              )}
            </button>
          ))}
        </nav>
        {(message || error) && (
          <div
            className={`mt-3 rounded-xl px-4 py-3 text-sm font-bold ${
              error
                ? "bg-red-50 text-red-700"
                : "bg-emerald-50 text-emerald-800"
            }`}
          >
            {error || message}
          </div>
        )}
      </div>

      {view === "storyboard" && (
        <section className="mt-5 flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-black">分镜时间线</h3>
                <p className="mt-1 text-xs text-black/40">
                  可以编辑、删除、重新排序，并单独生成配音。
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={loading || project.scenes.length === 0}
                  onClick={toggleAllSceneExpanded}
                  className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-black text-[#20252b] disabled:opacity-35"
                >
                  {expandedSceneIds.length === project.scenes.length &&
                  project.scenes.length > 0
                    ? "全部收起"
                    : "全部展开"}
                </button>
                <button
                  type="button"
                  disabled={loading || project.scenes.length === 0}
                  onClick={toggleAllSceneSelection}
                  className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-black text-[#20252b] disabled:opacity-35"
                >
                  {selectedSceneIds.length === project.scenes.length &&
                  project.scenes.length > 0
                    ? "取消全选"
                    : `全选分镜（${project.scenes.length}）`}
                </button>
                <button
                  type="button"
                  disabled={loading || selectedSceneIds.length === 0}
                  onClick={() =>
                    void generateSceneImages(selectedSceneIds, "选中分镜")
                  }
                  className="rounded-xl bg-[#16b9c4] px-4 py-2 text-sm font-black text-white disabled:opacity-35"
                >
                  并行生成选中画面（{selectedSceneIds.length}）
                </button>
                <button
                  type="button"
                  disabled={loading || project.scenes.length === 0}
                  onClick={() =>
                    void generateSceneImages(
                      project.scenes.map((scene) => scene.id),
                      "全部分镜",
                    )
                  }
                  className="rounded-xl bg-[#11151b] px-4 py-2 text-sm font-black text-white disabled:opacity-35"
                >
                  一键生成全部
                </button>
                <ToolbarVoicePicker
                  profiles={voiceProfiles}
                  selectedProfileId={selectedVoiceProfileId}
                  loading={
                    loading ||
                    voiceProfilesLoading ||
                    Boolean(voiceProfileLoadError)
                  }
                  onSelect={(profileId) => {
                    setSelectedVoiceProfileId(profileId);
                    void saveProjectVoiceProfile(profileId);
                  }}
                />
                <button
                  type="button"
                  disabled={loading || project.scenes.length === 0}
                  onClick={() => void generateAllVoices()}
                  className="rounded-xl bg-[#2563eb] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#1d4ed8] disabled:opacity-35"
                >
                  一键生成全部配音
                </button>
                <label className="cursor-pointer rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-bold text-black/70">
                  上传背景音乐
                  <input
                    type="file"
                    accept="audio/mpeg,audio/wav,audio/mp4"
                    disabled={loading}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void uploadMusic(file);
                    }}
                    className="hidden"
                  />
                </label>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() =>
                    void runAction(
                      () =>
                        fetch(
                          `/api/projects/${project.id}/storyboard/generate`,
                          {
                            method: "POST",
                          },
                        ),
                      "\u6587\u6848\u91cd\u65b0\u62c6\u5206\u4efb\u52a1\u5df2\u5f00\u59cb",
                    )
                  }
                  className="rounded-xl border border-black/10 bg-white px-4 py-2 text-sm font-bold text-black/70 disabled:opacity-40"
                >
                  {"\u91cd\u65b0\u62c6\u5206\u6587\u6848"}
                </button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-[#f6f8f9] px-4 py-3">
              <span className="text-xs font-black text-[#0f8791]">
                已生成 {generatedScenes}/{project.scenes.length} 张
              </span>
              <span className="h-3 w-px bg-black/10" />
              <span className="text-xs text-black/40">
                每批并行处理 6 个分镜，可单独勾选或一键生成全部。
              </span>
            </div>
          </div>
          {latestSceneImageJob &&
            ["QUEUED", "RUNNING", "RETRYING", "FAILED"].includes(
              latestSceneImageJob.status,
            ) && (
              <div className="mt-3 shrink-0 rounded-xl bg-[#f3f6f7] p-3">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span>
                    画面任务：
                    {statusLabels[latestSceneImageJob.status] ??
                      latestSceneImageJob.status}
                  </span>
                  <span>{latestSceneImageJob.progress}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
                  <div
                    className="h-full rounded-full bg-[#16b9c4] transition-all"
                    style={{ width: `${latestSceneImageJob.progress}%` }}
                  />
                </div>
                {latestSceneImageJob.errorMessage && (
                  <p className="mt-2 text-xs text-red-700">
                    {latestSceneImageJob.errorMessage}
                  </p>
                )}
                {latestSceneImageJob.status === "FAILED" &&
                  failedSceneImageIds.length > 0 && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() =>
                        void generateSceneImages(
                          failedSceneImageIds,
                          "\u5931\u8d25\u5206\u955c\u91cd\u8bd5",
                        )
                      }
                      className="mt-3 rounded-lg bg-[#11151b] px-4 py-2 text-xs font-black text-white disabled:opacity-40"
                    >
                      {"\u91cd\u65b0\u751f\u6210\u5931\u8d25\u753b\u9762"} (
                      {failedSceneImageIds.length})
                    </button>
                  )}
              </div>
            )}
          {voiceJobTotal > 0 && voiceJobDone < voiceJobTotal && (
            <div className="mt-3 shrink-0 rounded-xl bg-[#f3f6f7] p-3">
              <div className="flex items-center justify-between text-xs font-bold">
                <span>
                  配音任务：{voiceJobDone}/{voiceJobTotal} 段
                </span>
                <span>{voiceProgress}%</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-black/10">
                <div
                  className="h-full rounded-full bg-[#7c5cff] transition-all"
                  style={{ width: `${voiceProgress}%` }}
                />
              </div>
              {activeVoiceJobs.length > 0 && (
                <p className="mt-2 text-xs text-black/45">正在生成配音…</p>
              )}
              {voiceJobFailed > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs text-red-700">
                    {voiceJobFailed} 段配音失败，可重新生成
                  </p>
                  {failedVoiceSceneIdList.length > 0 && (
                    <button
                      type="button"
                      disabled={
                        loading ||
                        activeVoiceJobs.length > 0 ||
                        failedVoiceSceneIdList.length === 0
                      }
                      onClick={() => void retryFailedVoices()}
                      className="rounded-lg bg-[#11151b] px-3 py-1.5 text-xs font-black text-white transition hover:bg-black disabled:opacity-40"
                    >
                      重新生成失败配音 ({failedVoiceSceneIdList.length})
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid gap-4">
              {project.scenes.map((scene, index) => (
                <article
                  key={scene.id}
                  className="overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm transition hover:shadow-md"
                >
                  <div className="flex flex-wrap items-center gap-3 border-b border-black/[0.05] px-4 py-3">
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-black text-cyan-800">
                      <input
                        type="checkbox"
                        checked={selectedSceneIds.includes(scene.id)}
                        onChange={() => toggleSceneSelection(scene.id)}
                        className="size-4 accent-[#16b9c4]"
                      />
                      选择
                    </label>
                    <span className="text-lg font-black text-black/15">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="rounded-md bg-[#f1f4f5] px-2 py-1 text-[11px] font-bold text-black/50">
                      {scene.estimatedDuration.toFixed(1)} 秒
                    </span>
                    {getCurrentSceneImage(project, scene) ? (
                      <button
                        type="button"
                        onClick={() =>
                          setLightboxAssetId(
                            getCurrentSceneImage(project, scene)!.asset.id,
                          )
                        }
                        className="h-12 w-20 shrink-0 cursor-zoom-in overflow-hidden rounded-lg border border-black/[0.05]"
                      >
                        <img
                          src={`/api/assets/${getCurrentSceneImage(project, scene)!.asset.id}/content`}
                          alt={`分镜 ${index + 1} 画面`}
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className="grid h-12 w-20 place-items-center rounded-lg bg-[#f1f4f5] text-[10px] text-black/35">
                        未生成
                      </div>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => toggleSceneExpanded(scene.id)}
                        className="flex items-center gap-1 rounded-lg border border-black/10 bg-white px-2.5 py-1 text-xs font-bold text-[#0f8791] shadow-sm"
                      >
                        {expandedSceneIds.includes(scene.id)
                          ? "收起"
                          : "展开编辑"}
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={`transition ${
                            expandedSceneIds.includes(scene.id)
                              ? "rotate-180"
                              : ""
                          }`}
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={index === 0 || loading}
                        onClick={() => void moveScene(index, -1)}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-black/10 bg-white text-xs shadow-sm disabled:opacity-20"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        disabled={
                          index === project.scenes.length - 1 || loading
                        }
                        onClick={() => void moveScene(index, 1)}
                        className="grid h-7 w-7 place-items-center rounded-lg border border-black/10 bg-white text-xs shadow-sm disabled:opacity-20"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        disabled={loading || project.scenes.length <= 2}
                        onClick={() =>
                          void runAction(
                            () =>
                              fetch(
                                `/api/projects/${project.id}/scenes/${scene.id}`,
                                { method: "DELETE" },
                              ),
                            "分镜已删除",
                          )
                        }
                        className="ml-1 rounded-lg px-2 py-1 text-xs font-bold text-red-600 disabled:opacity-30"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  {expandedSceneIds.includes(scene.id) && (
                    <>
                      <div className="p-4">
                        <div className="grid gap-4 lg:grid-cols-2">
                          <div className="grid gap-4 rounded-xl bg-[#fafbfc] p-4">
                            <EditorField label="旁白">
                              <textarea
                                value={getEditedScene(scene).narration}
                                onChange={(event) =>
                                  updateScene(scene.id, {
                                    narration: event.target.value,
                                  })
                                }
                                className="min-h-24 rounded-xl border border-black/[0.05] bg-white p-3 text-sm outline-none ring-1 ring-black/[0.04] transition focus:border-[#16bec8] focus:ring-2 focus:ring-cyan-200"
                              />
                              <span className="mt-1 block text-right text-[10px] font-bold text-black/30">
                                {getEditedScene(scene).narration.length} 字
                              </span>
                            </EditorField>
                            <EditorField label="字幕">
                              <textarea
                                value={getEditedScene(scene).subtitle}
                                onChange={(event) =>
                                  updateScene(scene.id, {
                                    subtitle: event.target.value,
                                  })
                                }
                                className="min-h-16 rounded-xl border border-black/[0.05] bg-white p-3 text-sm outline-none ring-1 ring-black/[0.04] transition focus:border-[#16bec8] focus:ring-2 focus:ring-cyan-200"
                              />
                              <span className="mt-1 block text-right text-[10px] font-bold text-black/30">
                                {getEditedScene(scene).subtitle.length} 字
                              </span>
                            </EditorField>
                          </div>

                          <div className="grid gap-4 rounded-xl bg-[#fafbfc] p-4">
                            <EditorField label="画面提示">
                              <textarea
                                value={getEditedScene(scene).visualPrompt}
                                onChange={(event) =>
                                  updateScene(scene.id, {
                                    visualPrompt: event.target.value,
                                  })
                                }
                                className="min-h-[13rem] rounded-xl border border-black/[0.05] bg-white p-3 text-sm outline-none ring-1 ring-black/[0.04] transition focus:border-[#16bec8] focus:ring-2 focus:ring-cyan-200"
                              />
                              <span className="mt-1 block text-right text-[10px] font-bold text-black/30">
                                {getEditedScene(scene).visualPrompt.length} 字
                              </span>
                            </EditorField>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-black/[0.05] pt-3">
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() =>
                              void saveScene(getEditedScene(scene))
                            }
                            className="rounded-lg bg-[#11151b] px-4 py-2 text-xs font-black text-white shadow-sm disabled:opacity-40"
                          >
                            保存修改
                          </button>
                          <button
                            type="button"
                            disabled={loading}
                            onClick={() =>
                              void runAction(
                                () =>
                                  fetch(
                                    `/api/projects/${project.id}/scenes/${scene.id}/voice`,
                                    { method: "POST" },
                                  ),
                                "配音任务已加入队列",
                              )
                            }
                            className="rounded-lg border border-black/10 bg-white px-4 py-2 text-xs font-black text-[#20252b] shadow-sm disabled:opacity-40"
                          >
                            {scene.voiceTracks.length
                              ? "重新生成配音"
                              : "生成配音"}
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </article>
              ))}
              {project.scenes.length === 0 && (
                <div
                  className={`rounded-2xl border-2 border-dashed p-12 text-center text-sm ${
                    latestScriptJob?.status === "FAILED"
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-black/10 text-black/40"
                  }`}
                >
                  {latestScriptJob?.status === "FAILED"
                    ? `分镜拆分失败：${latestScriptJob.errorMessage ?? "请点击重新拆分文案重试"}`
                    : "正在等待本地分镜任务完成，页面会自动刷新。"}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {view === "preview" && (
        <section className="mt-5 flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-black">分镜图片预览</h3>
              <p className="mt-1 text-xs text-black/40">
                查看每个分镜生成的图片，点击可放大。
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpen("render")}
              className="rounded-xl bg-[#11151b] px-4 py-2 text-sm font-black text-white"
            >
              前往渲染
            </button>
          </div>

          <div
            className={`mt-4 grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1 ${
              project.aspectRatio === "LANDSCAPE"
                ? "md:grid-cols-2"
                : "grid-cols-2 md:grid-cols-3"
            }`}
          >
            {project.scenes.map((scene, index) => (
              <article
                key={scene.id}
                className={`relative grid place-items-center overflow-hidden rounded-2xl border-2 border-[#20252b] bg-[#fbfbfb] p-5 text-center ${
                  project.aspectRatio === "PORTRAIT"
                    ? "h-[28rem] md:h-[32rem]"
                    : "h-64 md:h-80"
                }`}
              >
                <span className="absolute left-3 top-3 text-xs font-black text-black/20">
                  {String(index + 1).padStart(2, "0")}
                </span>
                {getCurrentSceneImage(project, scene) ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setLightboxAssetId(
                          getCurrentSceneImage(project, scene)!.asset.id,
                        )
                      }
                      className="absolute inset-0 z-10 cursor-zoom-in"
                      aria-label={`放大分镜 ${index + 1} 图片`}
                    >
                      <img
                        src={`/api/assets/${getCurrentSceneImage(project, scene)!.asset.id}/content`}
                        alt={`分镜 ${index + 1}`}
                        className="absolute inset-0 size-full object-cover"
                      />
                    </button>
                    <p className="absolute inset-x-3 bottom-3 z-20 rounded-lg bg-black/65 px-3 py-2 text-sm font-bold text-white">
                      {scene.subtitle}
                    </p>
                  </>
                ) : (
                  <div>
                    <StickFigure accentColor={project.accentColor} />
                    <p className="mt-4 font-black">画面尚未生成</p>
                    <p className="mt-2 text-xs text-black/35">
                      返回分镜编辑，勾选后生成
                    </p>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>
      )}

      {view === "render" && (
        <section className="mt-5 grid min-h-0 flex-1 items-start gap-5 lg:grid-cols-[1fr_360px]">
          <div className="flex min-h-0 min-w-0 flex-col rounded-2xl border border-black/[0.08] p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black">后台渲染任务</h3>
                <p className="mt-1 text-sm text-black/40">
                  FFmpeg 在独立后台服务中运行，页面可以安全关闭。
                </p>
              </div>
              <button
                type="button"
                disabled={loading || project.scenes.length === 0}
                onClick={() =>
                  void runAction(
                    () =>
                      fetch(`/api/projects/${project.id}/render`, {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          watermark: "",
                          introTitle: true,
                          outro: true,
                        }),
                      }),
                    "1080P 渲染任务已加入队列",
                  )
                }
                className="rounded-xl bg-[#2563eb] px-5 py-3 text-sm font-bold text-white transition hover:bg-[#1d4ed8] disabled:opacity-40"
              >
                开始 1080P 渲染
              </button>
            </div>
            {project.visualMode === "AI_IMAGE" &&
              generatedScenes !== project.scenes.length && (
                <p className="mt-4 rounded-xl bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">
                  还有 {project.scenes.length - generatedScenes}{" "}
                  个分镜没有画面。请先返回分镜编辑，勾选生成后再渲染。
                </p>
              )}
            <div className="mt-6 min-h-0 flex-1 grid gap-3 overflow-y-auto overscroll-contain pr-1">
              {project.jobs
                .filter((job) => job.type === "RENDER")
                .map((job) => {
                  const presentation = renderProgressPresentation(
                    job.status,
                    job.progress,
                  );
                  const output = outputForRenderJob(job.id);
                  const selected = output?.id === selectedRenderOutput?.id;
                  const deletable = canDeleteRenderJob(job.status);
                  const cancellable = canCancelRenderJob(job.status);
                  return (
                    <article
                      key={job.id}
                      className={`rounded-xl border p-4 text-left transition ${
                        selected
                          ? "border-black/20 bg-white shadow-sm ring-1 ring-black/[0.04]"
                          : "border-black/[0.06] bg-[#f7f8f9]"
                      }`}
                    >
                      <button
                        type="button"
                        disabled={!output}
                        onClick={() => {
                          if (!output) return;
                          setSelectedRenderOutputId(output.id);
                          onOpen("export");
                        }}
                        className={`block w-full text-left ${
                          output ? "cursor-pointer" : "cursor-default"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4 text-sm font-bold">
                          <span>{presentation.label}</span>
                          <span className="shrink-0">
                            {presentation.progress}%
                          </span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10">
                          <div
                            className="h-full rounded-full bg-[#2563eb] transition-[width] duration-500"
                            style={{ width: `${presentation.progress}%` }}
                          />
                        </div>
                        <div className="mt-3 grid gap-1.5 sm:grid-cols-4">
                          {renderProgressSteps.map((step, index) => {
                            const nextStep = renderProgressSteps[index + 1];
                            const done =
                              presentation.progress >=
                              (nextStep?.minimum ?? step.minimum);
                            const active =
                              presentation.progress >= step.minimum &&
                              (!nextStep ||
                                presentation.progress < nextStep.minimum);
                            return (
                              <span
                                key={step.label}
                                className={`rounded-lg px-2 py-1.5 text-[10px] font-bold leading-4 ${
                                  done
                                    ? "bg-[#eef1f4] text-black/55"
                                    : active
                                      ? "bg-blue-50 text-blue-700"
                                      : "bg-white text-black/30"
                                }`}
                              >
                                {done ? "✓ " : active ? "● " : "○ "}
                                {step.label}
                              </span>
                            );
                          })}
                        </div>
                      </button>
                      <div className="mt-3 flex items-center justify-between text-[11px] text-black/40">
                        <span>
                          {new Date(job.createdAt).toLocaleString("zh-CN")}
                        </span>
                        <span className="flex items-center gap-3">
                          {output && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedRenderOutputId(output.id);
                                onOpen("export");
                              }}
                              className="font-bold text-[#2563eb]"
                            >
                              {selected ? "当前展示" : "点击查看成片"}
                            </button>
                          )}
                          {cancellable && (
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() =>
                                void runAction(
                                  () =>
                                    fetch(
                                      `/api/projects/${project.id}/render/${job.id}/cancel`,
                                      { method: "POST" },
                                    ),
                                  "已提交取消渲染请求",
                                )
                              }
                              className="font-bold text-[#0f8791] transition hover:text-[#0b6b73] disabled:cursor-not-allowed disabled:text-black/20"
                            >
                              取消
                            </button>
                          )}
                          {job.status === "CANCEL_REQUESTED" && (
                            <span className="font-bold text-black/35">
                              取消中…
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={loading || !deletable}
                            title={
                              deletable
                                ? "删除这条渲染记录"
                                : "正在渲染的任务不能删除"
                            }
                            onClick={() => {
                              setPendingRenderDeletion({
                                jobId: job.id,
                                hasOutput: Boolean(output),
                              });
                            }}
                            className="font-bold text-red-500 transition hover:text-red-700 disabled:cursor-not-allowed disabled:text-black/20"
                          >
                            删除
                          </button>
                        </span>
                      </div>
                      {job.errorMessage && (
                        <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">
                          {job.errorMessage}
                        </p>
                      )}
                    </article>
                  );
                })}
              {!latestRender && (
                <div className="rounded-xl border-2 border-dashed border-black/10 p-10 text-center text-sm text-black/35">
                  尚未创建渲染任务
                </div>
              )}
            </div>
          </div>
          <aside className="self-start rounded-2xl bg-[#11151b] p-5 text-white">
            <h3 className="font-black">输出规格</h3>
            <dl className="mt-5 grid gap-4 text-sm">
              <InfoRow label="分辨率" value="1080P" />
              <InfoRow label="视频编码" value="H.264" />
              <InfoRow label="音频编码" value="AAC" />
              <InfoRow label="转场" value="淡入 / 溶解 / 推入 / 缩放" />
              <InfoRow label="字幕" value="SRT + ASS" />
            </dl>
          </aside>
        </section>
      )}

      {view === "export" && (
        <section className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            {selectedRenderOutput ? (
              <div className="grid h-full min-h-0 items-start gap-5 lg:grid-cols-[1fr_380px]">
                <div className="flex h-full min-h-0 items-start">
                  <div className="box-border h-full w-fit max-w-full overflow-hidden rounded-xl bg-black p-4 shadow-sm ring-1 ring-black/10">
                    <video
                      key={selectedRenderOutput.assetId}
                      controls
                      className="block aspect-video h-full min-h-0 w-auto max-w-full rounded-lg bg-black object-contain ring-1 ring-inset ring-white/20"
                      src={`/api/assets/${selectedRenderOutput.assetId}/content`}
                    />
                  </div>
                </div>
                <aside className="flex max-h-full min-h-0 flex-col self-start overflow-y-auto rounded-2xl border border-black/[0.06] bg-white p-5 shadow-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="rounded-full bg-[#eef1f4] px-3 py-1 text-xs font-bold text-black/60">
                      ✓ 成片已准备好
                    </span>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-xl font-black">1080P MP4</h3>
                    <p className="mt-1 text-xs text-black/45">
                      {selectedRenderOutput.width} ×{" "}
                      {selectedRenderOutput.height} ·{" "}
                      {(selectedRenderOutput.durationMs / 1_000).toFixed(1)} 秒
                    </p>
                  </div>

                  <div className="mt-4 rounded-xl border border-black/[0.06] bg-[#f6f8f9] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-black">历史成片</h4>
                      <span className="text-[10px] font-bold text-black/35">
                        {project.renderOutputs.length} 个版本
                      </span>
                    </div>
                    <div className="mt-3 grid max-h-44 gap-2 overflow-y-auto pr-1">
                      {project.renderOutputs.map((output, index) => {
                        const active = output.id === selectedRenderOutput.id;
                        return (
                          <button
                            key={output.id}
                            type="button"
                            onClick={() => setSelectedRenderOutputId(output.id)}
                            className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left transition ${
                              active
                                ? "border-black/20 bg-[#f3f5f7]"
                                : "border-black/[0.06] bg-white hover:border-black/20 hover:bg-[#fafafa]"
                            }`}
                          >
                            <span>
                              <strong className="block text-xs">
                                成片 {project.renderOutputs.length - index}
                              </strong>
                              <span className="mt-0.5 block text-[10px] text-black/40">
                                {new Date(output.createdAt).toLocaleString(
                                  "zh-CN",
                                )}
                              </span>
                            </span>
                            <span
                              className={`text-[10px] font-black ${
                                active ? "text-[#2563eb]" : "text-black/30"
                              }`}
                            >
                              {active ? "正在展示" : "选择"}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-black/[0.06] bg-[#f6f8f9] p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="font-black">剪映草稿</h4>
                      {activeJianyingJob ? (
                        <span className="text-[10px] font-black text-[#0f8791]">
                          {activeJianyingJob.progress}%
                        </span>
                      ) : relatedInstallJob?.status === "SUCCEEDED" ? (
                        <span className="text-[10px] font-black text-emerald-700">
                          已保存
                        </span>
                      ) : latestCreatedDraftJob ? (
                        <span className="text-[10px] font-black text-[#0f8791]">
                          待确认
                        </span>
                      ) : null}
                    </div>
                    {activeJianyingJob ? (
                      <p className="mt-2 text-xs leading-5 text-black/50">
                        {activeJianyingJob.input?.action === "INSTALL"
                          ? "正在复制到剪映并清理临时文件"
                          : "正在创建本地剪映草稿"}
                        ……
                      </p>
                    ) : relatedInstallJob?.status === "SUCCEEDED" ? (
                      <>
                        <p className="mt-2 text-xs font-bold text-emerald-700">
                          ✓ 已保存到剪映，原临时草稿已删除
                        </p>
                        <p className="mt-1 break-all text-[11px] text-black/40">
                          {relatedInstallJob.output?.installedPath}
                        </p>
                      </>
                    ) : latestCreatedDraftJob ? (
                      <>
                        <p className="mt-2 text-xs text-black/55">
                          草稿已创建，确认后可保存到剪映。
                        </p>
                        <p className="mt-1 break-all text-[11px] text-black/35">
                          {latestCreatedDraftJob.output?.stagingPath}
                        </p>
                        {relatedInstallJob?.status === "FAILED" && (
                          <p className="mt-2 text-xs text-red-600">
                            保存失败，临时草稿仍然保留，可以重新保存。
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="mt-2 text-xs leading-5 text-black/50">
                        成片完成后手动创建，不会自动占用剪映目录。
                      </p>
                    )}
                    {latestJianyingJob?.status === "FAILED" &&
                      latestJianyingJob.id !== relatedInstallJob?.id && (
                        <p className="mt-2 text-xs text-red-600">
                          {latestJianyingJob.errorMessage ?? "剪映草稿任务失败"}
                        </p>
                      )}
                  </div>

                  <div className="grid gap-2 pt-3 sm:grid-cols-2">
                    <button
                      type="button"
                      disabled={loading || Boolean(activeJianyingJob)}
                      onClick={() =>
                        void runAction(
                          () =>
                            fetch(
                              `/api/projects/${project.id}/jianying-draft`,
                              {
                                method: "POST",
                                headers: { "content-type": "application/json" },
                                body: JSON.stringify(
                                  latestCreatedDraftJob &&
                                    relatedInstallJob?.status !== "SUCCEEDED"
                                    ? {
                                        action: "INSTALL",
                                        draftJobId: latestCreatedDraftJob.id,
                                      }
                                    : { action: "CREATE" },
                                ),
                              },
                            ),
                          latestCreatedDraftJob &&
                            relatedInstallJob?.status !== "SUCCEEDED"
                            ? "保存到剪映任务已提交"
                            : "剪映草稿创建任务已提交",
                        )
                      }
                      className="rounded-xl border border-black/10 bg-white px-3 py-2.5 text-xs font-black text-[#20252b] shadow-sm disabled:opacity-40"
                    >
                      {activeJianyingJob
                        ? "处理中…"
                        : latestCreatedDraftJob &&
                            relatedInstallJob?.status !== "SUCCEEDED"
                          ? "保存到剪映"
                          : relatedInstallJob?.status === "SUCCEEDED"
                            ? "重新创建剪映草稿"
                            : "创建剪映草稿"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        window.location.assign(
                          `/api/assets/${selectedRenderOutput.assetId}/content?download=1`,
                        )
                      }
                      className="rounded-xl bg-[#11151b] px-3 py-2.5 text-xs font-black text-white shadow-sm"
                    >
                      下载 MP4
                    </button>
                  </div>
                </aside>
              </div>
            ) : (
              <div className="grid h-full min-h-0 place-items-center rounded-2xl border-2 border-dashed border-black/10 text-center">
                <div>
                  <p className="text-4xl">◌</p>
                  <h3 className="mt-4 text-xl font-black">
                    还没有可导出的成片
                  </h3>
                  <p className="mt-2 text-sm text-black/40">
                    完成后台渲染后，视频会自动出现在这里。
                  </p>
                  <button
                    type="button"
                    onClick={() => onOpen("render")}
                    className="mt-5 rounded-xl bg-[#11151b] px-5 py-3 text-sm font-black text-white"
                  >
                    前往渲染
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
      <AppDialog
        open={pendingRenderDeletion !== null}
        title={
          pendingRenderDeletion?.hasOutput ? "删除渲染成片" : "删除渲染记录"
        }
        description={
          pendingRenderDeletion?.hasOutput
            ? "对应的本地 MP4 会一并删除。如果删除的是当前版本，系统会自动显示上一版成片。"
            : "这条渲染记录会从任务列表中永久删除。"
        }
        confirmLabel="确认删除"
        tone="danger"
        busy={loading}
        onCancel={() => setPendingRenderDeletion(null)}
        onConfirm={() => {
          if (!pendingRenderDeletion) return;
          const request = pendingRenderDeletion;
          void runAction(
            () =>
              fetch(`/api/projects/${project.id}/render/${request.jobId}`, {
                method: "DELETE",
              }),
            request.hasOutput ? "渲染成片已删除" : "渲染记录已删除",
          ).finally(() => setPendingRenderDeletion(null));
        }}
      />
      {lightboxAssetId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setLightboxAssetId(null)}
        >
          <button
            type="button"
            onClick={() => setLightboxAssetId(null)}
            className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-xl text-white transition hover:bg-white/20"
            aria-label="关闭大图"
          >
            ×
          </button>
          <img
            src={`/api/assets/${lightboxAssetId}/content`}
            alt="分镜大图"
            className="max-h-[88vh] max-w-[92vw] rounded-2xl object-contain shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}

function CoverWorkspacePanel() {
  const [officialCovers, setOfficialCovers] = useState<
    Record<OfficialCoverTemplateId, CoverTemplateData>
  >({
    [coverTemplateId]: defaultCoverTemplate,
    [characterCoverTemplateId]: defaultCharacterCoverTemplate,
  });
  const [activeCoverTemplateId, setActiveCoverTemplateId] =
    useState<OfficialCoverTemplateId>(coverTemplateId);
  const [myTemplates, setMyTemplates] = useState<SavedCoverTemplate[]>([]);
  const [previewTemplate, setPreviewTemplate] =
    useState<SavedCoverTemplate | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [saveTemplateDialogOpen, setSaveTemplateDialogOpen] = useState(false);
  const [saveTemplateName, setSaveTemplateName] = useState(
    defaultSavedCoverName,
  );
  const [saveTemplateNameError, setSaveTemplateNameError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [templateError, setTemplateError] = useState("");
  const [downloadError, setDownloadError] = useState("");
  const [downloadBusyTemplateId, setDownloadBusyTemplateId] =
    useState<OfficialCoverTemplateId | null>(null);
  const exportPreviewRefs = useRef(
    new Map<OfficialCoverTemplateId, HTMLDivElement>(),
  );
  const cover = officialCovers[activeCoverTemplateId];
  const activeOfficialTemplate =
    officialCoverTemplates.find(
      (template) => template.id === activeCoverTemplateId,
    ) ?? officialCoverTemplates[0];

  useEffect(() => {
    const storedCover = window.localStorage.getItem(coverTemplateStorageKey);
    const savedTemplates = parseSavedCoverTemplates(storedCover);
    const latestTemplate = savedTemplates[savedTemplates.length - 1];
    const loadedTemplateId = isOfficialCoverTemplateId(
      latestTemplate?.templateId,
    )
      ? latestTemplate.templateId
      : coverTemplateId;
    const loadedCover =
      latestTemplate?.cover ?? parseStoredCoverTemplate(storedCover);
    setMyTemplates(savedTemplates);
    setOfficialCovers((current) => ({
      ...current,
      [loadedTemplateId]: loadedCover,
    }));
    setActiveCoverTemplateId(loadedTemplateId);
  }, []);

  useEffect(() => {
    if (!modalOpen && !previewTemplate) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (saveTemplateDialogOpen) return;
      if (event.key === "Escape") setModalOpen(false);
      if (event.key === "Escape") setPreviewTemplate(null);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [modalOpen, previewTemplate, saveTemplateDialogOpen]);

  function updateAvatar(file: File | undefined) {
    if (!file) return;
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.type)) {
      setAvatarError("头像仅支持 JPG、PNG 或 WebP 图片。");
      return;
    }
    if (file.size > 2_000_000) {
      setAvatarError("头像文件不能超过 2 MB。");
      return;
    }
    setAvatarError("");
    const reader = new FileReader();
    reader.onload = () => {
      const avatarUrl = reader.result;
      if (typeof avatarUrl !== "string") return;
      updateActiveCover((current) => ({ ...current, avatarUrl }));
    };
    reader.readAsDataURL(file);
  }

  function updateCover(
    field: Exclude<keyof CoverTemplateData, "avatarUrl">,
    value: string,
  ) {
    updateActiveCover((current) => ({ ...current, [field]: value }));
  }

  function updateActiveCover(
    update: (current: CoverTemplateData) => CoverTemplateData,
  ) {
    setOfficialCovers((current) => ({
      ...current,
      [activeCoverTemplateId]: update(current[activeCoverTemplateId]),
    }));
  }

  function openOfficialTemplate(templateId: OfficialCoverTemplateId) {
    setActiveCoverTemplateId(templateId);
    setTemplateError("");
    setAvatarError("");
    setModalOpen(true);
  }

  function deleteMyTemplate(templateId: string) {
    const nextTemplates = myTemplates.filter(
      (template) => template.id !== templateId,
    );
    setMyTemplates(nextTemplates);
    if (nextTemplates.length === 0) {
      window.localStorage.removeItem(coverTemplateStorageKey);
    } else {
      window.localStorage.setItem(
        coverTemplateStorageKey,
        JSON.stringify(nextTemplates),
      );
    }
  }

  function saveMyTemplate() {
    if (myTemplates.length >= 10) {
      setTemplateError("最多保存 10 个模板，请先删除一个已有模板。");
      return;
    }
    setSaveTemplateName(defaultSavedCoverName);
    setSaveTemplateNameError("");
    setSaveTemplateDialogOpen(true);
  }

  function confirmSaveMyTemplate() {
    const cleanedName = saveTemplateName.trim();
    if (!cleanedName) {
      setSaveTemplateNameError("模板名称不能为空。");
      return;
    }
    const nextTemplates = [
      ...myTemplates,
      {
        id: window.crypto.randomUUID(),
        name: cleanedName,
        templateId: activeCoverTemplateId,
        templateName: activeOfficialTemplate.name,
        cover,
      },
    ];
    window.localStorage.setItem(
      coverTemplateStorageKey,
      JSON.stringify(nextTemplates),
    );
    setMyTemplates(nextTemplates);
    setTemplateError("");
    setSaveTemplateNameError("");
    setSaveTemplateDialogOpen(false);
    setModalOpen(false);
  }

  async function downloadCover(templateId: OfficialCoverTemplateId) {
    const exportPreview = exportPreviewRefs.current.get(templateId);
    if (!exportPreview || downloadBusyTemplateId) return;
    setDownloadBusyTemplateId(templateId);
    setDownloadError("");
    try {
      await downloadCoverTemplatePng(
        exportPreview,
        coverDownloadFileName(officialCovers[templateId].title),
      );
    } catch (reason) {
      setDownloadError(
        reason instanceof Error ? reason.message : "封面下载失败",
      );
    } finally {
      setDownloadBusyTemplateId(null);
    }
  }

  return (
    <div className="pt-3 text-sm">
      <section className="rounded-xl bg-[#f4f7fb] p-3 md:p-4">
        <div>
          <h2 className="text-lg font-black text-[#111827]">官方模板</h2>
          <p className="mt-1 text-[11px] leading-4 text-black/50">
            挑选模板创建您的封面模板预设，在创作任务中选择预设生成视频封面。
          </p>
        </div>

        <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(160px,190px))] gap-3">
          {officialCoverTemplates.map((template) => {
            const templateCover = officialCovers[template.id];
            const active = template.id === activeCoverTemplateId;
            const downloading = downloadBusyTemplateId === template.id;
            return (
              <article
                key={template.id}
                className={`overflow-hidden rounded-lg border bg-white p-1 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                  active
                    ? "border-[#16bec8]/50 ring-2 ring-cyan-100"
                    : "border-black/[0.08]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => openOfficialTemplate(template.id)}
                  className="relative block w-full cursor-pointer text-left"
                  aria-label={`编辑${template.name}`}
                >
                  <CoverTemplatePreview
                    value={templateCover}
                    templateId={template.id}
                    className="rounded-xl border border-white/10"
                  />
                  <span className="absolute right-1.5 top-1.5 rounded-full bg-[#1677ff] px-2 py-0.5 text-[10px] font-black text-white shadow-sm">
                    可编辑
                  </span>
                </button>
                <h3 className="px-1 pb-1 pt-1.5 text-center text-[11px] font-black text-[#374151]">
                  {template.name}
                </h3>
                <div className="grid grid-cols-2 gap-1 border-t border-black/[0.06] p-1">
                  <button
                    type="button"
                    onClick={() => openOfficialTemplate(template.id)}
                    className="rounded-md bg-[#f1f4f5] px-1.5 py-1 text-[10px] font-black text-black/60 transition hover:bg-black/10"
                  >
                    编辑模板
                  </button>
                  <button
                    type="button"
                    disabled={downloadBusyTemplateId !== null}
                    onClick={() => void downloadCover(template.id)}
                    className="rounded-md bg-[#11151b] px-1.5 py-1 text-[10px] font-black text-white transition hover:bg-black disabled:cursor-wait disabled:opacity-50"
                  >
                    {downloading ? "生成中…" : "下载 PNG"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
        {downloadError ? (
          <p className="mt-2 text-[11px] font-bold text-red-600">
            {downloadError}
          </p>
        ) : null}
      </section>

      {myTemplates.length > 0 && (
        <section className="mt-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-black text-[#111827]">我的封面</h2>
            <span className="rounded-md bg-[#e7edf6] px-1.5 py-0.5 text-xs font-bold text-[#5d7395]">
              {myTemplates.length}/10
            </span>
          </div>
          <div className="mt-2 grid max-w-md gap-1.5">
            {myTemplates.map((template) => (
              <article
                key={template.id}
                role="button"
                tabIndex={0}
                aria-label={`预览${template.name}封面`}
                onClick={() => setPreviewTemplate(template)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setPreviewTemplate(template);
                  }
                }}
                className="flex cursor-pointer items-center justify-between rounded-lg border border-[#dce5f0] bg-white px-3 py-2 shadow-sm transition hover:border-[#16bec8]/50 hover:shadow-md"
              >
                <div className="min-w-0 flex-1 text-left">
                  <p className="text-sm font-black text-[#111827]">
                    {template.name}
                  </p>
                  <p className="mt-0.5 text-xs text-[#6b83aa]">
                    {template.templateName}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    deleteMyTemplate(template.id);
                  }}
                  aria-label={`删除${template.name}`}
                  className="grid size-8 place-items-center rounded-md border border-[#dce5f0] text-[#111827] transition hover:bg-[#f4f7fb]"
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 7h16" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M6 7l1 13h10l1-13" />
                    <path d="M9 7V4h6v3" />
                  </svg>
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      <div
        aria-hidden="true"
        className="pointer-events-none fixed left-[-10000px] top-0"
      >
        {officialCoverTemplates.map((template) => (
          <div
            key={template.id}
            ref={(element) => {
              if (element) exportPreviewRefs.current.set(template.id, element);
              else exportPreviewRefs.current.delete(template.id);
            }}
            className="h-[1024px] w-[768px]"
          >
            <CoverTemplatePreview
              value={officialCovers[template.id]}
              templateId={template.id}
            />
          </div>
        ))}
      </div>

      {previewTemplate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewTemplate(null)}
        >
          <div
            className="relative flex max-h-[92vh] w-full max-w-lg flex-col items-center rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex w-full items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-[#111827]">
                  {previewTemplate.name}
                </h3>
                <p className="mt-0.5 text-xs font-bold text-[#6b83aa]">
                  {previewTemplate.templateName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                className="rounded-lg bg-black/5 px-3 py-2 text-sm font-bold text-[#111827] transition hover:bg-black/10"
              >
                关闭
              </button>
            </div>
            <div className="mt-4 max-h-[76vh] w-full overflow-auto rounded-2xl bg-black p-3">
              <CoverTemplatePreview
                value={previewTemplate.cover}
                templateId={previewTemplate.templateId}
                className="mx-auto max-w-[360px] rounded-xl"
              />
            </div>
          </div>
        </div>
      )}

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black">编辑封面模板</h3>
                <p className="mt-1 text-xs text-black/40">
                  {activeCoverTemplateId === characterCoverTemplateId
                    ? "顶部标语、两行主标题和底部标语均可独立替换。"
                    : "主标题前景板覆盖模糊背景层，其余文字和头像均可替换。"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="grid h-9 w-9 place-items-center rounded-full bg-[#f1f4f5] text-black/45 transition hover:bg-black/10"
                aria-label="关闭"
              >
                ×
              </button>
            </div>

            <div className="mt-5 grid items-start gap-7 md:grid-cols-[minmax(260px,360px)_1fr]">
              <CoverTemplatePreview
                value={cover}
                templateId={activeCoverTemplateId}
                className="mx-auto max-w-[360px] rounded-2xl border border-white/10 shadow-lg"
              />
              <div className="grid content-start gap-3">
                {activeCoverTemplateId === characterCoverTemplateId && (
                  <label className="grid gap-1.5 text-xs font-black text-black/50">
                    顶部标语
                    <input
                      value={cover.account}
                      onChange={(event) =>
                        updateCover("account", event.target.value)
                      }
                      maxLength={30}
                      className="rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#16bec8]"
                    />
                  </label>
                )}
                <label className="grid gap-1.5 text-xs font-black text-black/50">
                  {activeCoverTemplateId === characterCoverTemplateId
                    ? "主标题第一行"
                    : "主标题"}
                  <input
                    value={cover.title}
                    onChange={(event) =>
                      updateCover("title", event.target.value)
                    }
                    maxLength={
                      activeCoverTemplateId === characterCoverTemplateId
                        ? 20
                        : 4
                    }
                    className="rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#16bec8]"
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-black text-black/50">
                  {activeCoverTemplateId === characterCoverTemplateId
                    ? "主标题第二行"
                    : "副标题"}
                  <input
                    value={cover.subtitle}
                    onChange={(event) =>
                      updateCover("subtitle", event.target.value)
                    }
                    maxLength={
                      activeCoverTemplateId === characterCoverTemplateId
                        ? 40
                        : 12
                    }
                    className="rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#16bec8]"
                  />
                </label>
                {activeCoverTemplateId === characterCoverTemplateId ? (
                  <label className="grid gap-1.5 text-xs font-black text-black/50">
                    底部标语
                    <input
                      value={cover.footer}
                      onChange={(event) =>
                        updateCover("footer", event.target.value)
                      }
                      maxLength={40}
                      className="rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#16bec8]"
                    />
                  </label>
                ) : (
                  <>
                    <label className="grid gap-1.5 text-xs font-black text-black/50">
                      账号文字
                      <input
                        value={cover.account}
                        onChange={(event) =>
                          updateCover("account", event.target.value)
                        }
                        maxLength={30}
                        className="rounded-xl border border-black/[0.08] bg-white px-3 py-2.5 text-sm outline-none focus:border-[#16bec8]"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="cursor-pointer rounded-xl border border-black/10 bg-white px-3 py-2.5 text-center text-xs font-black text-[#159aa6] transition hover:bg-cyan-50">
                        替换头像
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(event) => {
                            updateAvatar(event.target.files?.[0]);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        disabled={!cover.avatarUrl}
                        onClick={() =>
                          updateActiveCover((current) => ({
                            ...current,
                            avatarUrl: "",
                          }))
                        }
                        className="rounded-xl border border-black/10 bg-white px-3 py-2.5 text-xs font-black text-black/45 transition hover:bg-black/[0.03] disabled:cursor-not-allowed disabled:opacity-35"
                      >
                        移除头像
                      </button>
                    </div>
                    {avatarError ? (
                      <p className="text-xs font-bold text-red-600">
                        {avatarError}
                      </p>
                    ) : (
                      <p className="text-[11px] leading-5 text-black/35">
                        模糊标题自动跟随主标题；头像支持
                        JPG、PNG、WebP，文件不超过 2 MB。
                      </p>
                    )}
                  </>
                )}
                <button
                  type="button"
                  onClick={saveMyTemplate}
                  className="mt-2 rounded-xl bg-[#11151b] px-4 py-3 text-sm font-black text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
                >
                  保存为我的模板
                </button>
                {templateError && (
                  <p className="text-xs font-bold text-red-600">
                    {templateError}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
      <AppDialog
        open={saveTemplateDialogOpen}
        title="保存封面模板"
        description="给当前模板起一个容易识别的名称，保存后可在创作页面直接选择。"
        confirmLabel="保存模板"
        input={{
          label: "模板名称",
          value: saveTemplateName,
          placeholder: `例如：${defaultSavedCoverName}`,
          maxLength: 30,
          error: saveTemplateNameError,
          onChange: (value) => {
            setSaveTemplateName(value);
            if (saveTemplateNameError) setSaveTemplateNameError("");
          },
        }}
        onCancel={() => {
          setSaveTemplateDialogOpen(false);
          setSaveTemplateNameError("");
        }}
        onConfirm={confirmSaveMyTemplate}
      />
    </div>
  );
}

function SettingsPanel({
  activeApi,
  onActiveApiChange,
}: {
  activeApi: "dialogue" | "image";
  onActiveApiChange: (api: "dialogue" | "image") => void;
}) {
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [dialogueApiKey, setDialogueApiKey] = useState("");
  const [dialogueApiBaseUrl, setDialogueApiBaseUrl] = useState(
    emptySettings.apiBaseUrl,
  );
  const [dialogueModel, setDialogueModel] = useState(emptySettings.scriptModel);
  const [imageApiKey, setImageApiKey] = useState("");
  const [imageApiBaseUrl, setImageApiBaseUrl] = useState(
    emptySettings.imageApiBaseUrl,
  );
  const [imageModel, setImageModel] = useState<ImageModel>(
    emptySettings.imageModel,
  );
  const [imageSize, setImageSize] = useState<ImageSize>(
    emptySettings.imageSize,
  );
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const preset = apiPresets[imageModel] ?? apiPresets["gpt-image-2-template"];
  const visibleModelEntries = Object.entries(apiPresets).filter(
    ([model]) =>
      model === "gpt-image-2-template" || model.startsWith("nano-banana"),
  );
  useEffect(() => {
    fetch(settingsEndpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取本机 API 配置");
        return response.json() as Promise<{ settings: Settings }>;
      })
      .then((data) => {
        const loaded = {
          ...data.settings,
          imageModel: normalizeImageModel(data.settings.imageModel),
        };
        setSettings(loaded);
        setDialogueApiBaseUrl(loaded.apiBaseUrl);
        setDialogueModel(loaded.scriptModel);
        setImageApiBaseUrl(loaded.imageApiBaseUrl);
        setImageModel(loaded.imageModel);
        setImageSize(loaded.imageSize);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "设置服务连接失败"),
      )
      .finally(() => setBusy(false));
  }, []);

  async function save(api: "dialogue" | "image", clearKey = false) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const dialogueFields =
        api === "dialogue"
          ? {
              apiBaseUrl: dialogueApiBaseUrl,
              scriptModel: dialogueModel,
            }
          : {
              apiBaseUrl: settings.apiBaseUrl,
              scriptModel: settings.scriptModel,
            };
      const imageFields =
        api === "image"
          ? {
              imageApiBaseUrl,
              imageModel,
              imageSize,
            }
          : {
              imageApiBaseUrl: settings.imageApiBaseUrl,
              imageModel: settings.imageModel,
              imageSize: settings.imageSize,
            };
      const response = await fetch(settingsEndpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(api === "dialogue" && dialogueApiKey
            ? { apiKey: dialogueApiKey }
            : {}),
          ...(api === "image" && imageApiKey ? { imageApiKey } : {}),
          clearApiKey: api === "dialogue" && clearKey,
          clearImageApiKey: api === "image" && clearKey,
          ...dialogueFields,
          ...imageFields,
        }),
      });
      const data = (await response.json()) as {
        settings?: Settings;
        error?: string;
        issues?: Array<{ message: string }>;
      };
      if (!response.ok || !data.settings) {
        throw new Error(
          data.issues?.[0]?.message ?? data.error ?? "API 配置保存失败",
        );
      }
      const saved = {
        ...data.settings,
        imageModel: normalizeImageModel(data.settings.imageModel),
      };
      setSettings(saved);
      if (api === "dialogue") {
        setDialogueApiKey("");
        setDialogueApiBaseUrl(saved.apiBaseUrl);
        setDialogueModel(saved.scriptModel);
        setMessage(
          saved.apiKeyConfigured
            ? "对话 API 已独立保存并启用"
            : "对话服务参数已保存，请填写密钥",
        );
      } else if (api === "image") {
        setImageApiKey("");
        setImageApiBaseUrl(saved.imageApiBaseUrl);
        setImageModel(saved.imageModel);
        setImageSize(saved.imageSize);
        setMessage(
          saved.imageApiKeyConfigured
            ? `${apiPresets[saved.imageModel].label} 已独立保存并启用`
            : "图片服务参数已保存，请填写图片密钥",
        );
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function selectModel(model: ImageModel) {
    const selected = apiPresets[model];
    setImageModel(model);
    setImageApiBaseUrl(selected.baseUrl);
    setImageSize(selected.defaultSize);
  }

  return (
    <section className="mx-auto max-w-4xl pt-6">
      <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4 text-sm leading-6 text-cyan-950">
        对话和图片使用两套独立配置。保存或移除其中一套密钥，不会改动另外两套。
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-[#f1f4f5] p-1">
        {(
          [
            {
              id: "dialogue" as const,
              label: "对话 API",
              detail: dialogueModel,
              configured: settings.apiKeyConfigured,
            },
            {
              id: "image" as const,
              label: "图片 API",
              detail: preset.label,
              configured: settings.imageApiKeyConfigured,
            },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              onActiveApiChange(item.id);
              setMessage("");
              setError("");
            }}
            className={`rounded-xl px-4 py-3 text-left transition ${
              activeApi === item.id
                ? "bg-white shadow-sm ring-1 ring-black/[0.06]"
                : "text-black/45 hover:text-black/70"
            }`}
          >
            <span className="flex items-center justify-between gap-2 text-sm font-black">
              {item.label}
              <span
                className={`rounded-full px-2 py-1 text-[10px] ${
                  item.configured
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-black/[0.05] text-black/40"
                }`}
              >
                {item.configured ? "已配置" : "未配置"}
              </span>
            </span>
            <span className="mt-1 block truncate text-xs font-medium opacity-55">
              {item.detail}
            </span>
          </button>
        ))}
      </div>

      {activeApi === "dialogue" ? (
        <div className="mt-4 grid gap-4 rounded-2xl border border-black/[0.08] p-4 md:p-5">
          <div>
            <h3 className="font-black">对话与文本生成</h3>
            <p className="mt-1 text-sm leading-6 text-black/40">
              仅供对话和脚本文本调用。图片生成不会读取这里的地址或密钥。
            </p>
          </div>

          <label className="grid gap-2 text-sm font-bold">
            对话 API 密钥
            <input
              type="password"
              autoComplete="new-password"
              value={dialogueApiKey}
              onChange={(event) => setDialogueApiKey(event.target.value)}
              placeholder={
                settings.apiKeyConfigured
                  ? "密钥已保存；留空保持不变"
                  : "输入对话服务访问令牌"
              }
              className="rounded-xl bg-[#f1f4f5] p-4 font-mono text-sm outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-bold">
              服务地址
              <input
                value={dialogueApiBaseUrl}
                onChange={(event) => setDialogueApiBaseUrl(event.target.value)}
                placeholder="https://www.hfsyapi.cn"
                className="rounded-xl bg-[#f1f4f5] p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-cyan-300"
              />
            </label>
            <div className="grid gap-2 text-sm font-bold">
              <span>对话模型</span>
              <SettingsSelect
                value={dialogueModel}
                disabled={busy}
                options={dialogueModelOptions}
                onSelect={setDialogueModel}
                onInputChange={setDialogueModel}
                editable
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-xl bg-[#f5f7f8] p-4 text-sm md:grid-cols-2">
            <InfoRow label="调用方式" value="POST /v1/chat/completions" />
            <InfoRow label="用途" value="对话、文案与脚本文本" />
          </div>

          <p className="text-xs leading-5 text-black/35">
            密钥只发送给本机后台服务，不会回传到页面；图片 API
            始终使用自己单独的图片密钥。
          </p>

          {(message || error) && (
            <SettingsFeedback message={message} error={error} />
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save("dialogue")}
              className="rounded-xl bg-[#11151b] px-6 py-3 font-black text-white disabled:opacity-40"
            >
              {busy ? "正在处理…" : "保存对话 API"}
            </button>
            {settings.apiKeyConfigured && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void save("dialogue", true)}
                className="rounded-xl px-5 py-3 font-bold text-red-600 disabled:opacity-40"
              >
                移除对话密钥
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-5 rounded-2xl border border-black/[0.08] p-5 md:p-7">
          <label className="grid gap-2 text-sm font-bold">
            图片服务
            <SettingsSelect
              value={imageModel}
              disabled={busy}
              options={visibleModelEntries.map(([model, item]) => ({
                value: model,
                label: item.label,
                detail: item.description,
              }))}
              onSelect={(value) => selectModel(value as ImageModel)}
            />
            <span className="font-normal text-black/35">
              选择后会填入对应服务地址、接口和默认清晰度，保存后才会生效。
            </span>
          </label>

          <div className="grid gap-3 rounded-xl bg-[#f5f7f8] p-4 text-sm md:grid-cols-2">
            <InfoRow label="服务地址" value={imageApiBaseUrl} />
            <InfoRow label="接口" value={preset.endpoint} />
          </div>

          <label className="grid gap-2 text-sm font-bold">
            {preset.label} 密钥
            <input
              type="password"
              autoComplete="new-password"
              value={imageApiKey}
              onChange={(event) => setImageApiKey(event.target.value)}
              placeholder={
                settings.imageApiKeyConfigured
                  ? "密钥已保存；留空保持不变"
                  : "输入图片服务访问令牌"
              }
              className="rounded-xl bg-[#f1f4f5] p-4 font-mono text-sm outline-none focus:ring-2 focus:ring-cyan-300"
            />
            <span className="font-normal text-black/35">
              这里只保存图片密钥，不会读取或覆盖对话 API 密钥。
            </span>
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-bold">
              图片清晰度
              <SettingsSelect
                value={imageSize}
                options={sizesForModel(imageModel).map((size) => ({
                  value: size,
                  label: size,
                }))}
                onSelect={(value) => setImageSize(value as ImageSize)}
              />
            </label>
            <label className="grid gap-2 text-sm font-bold">
              自定义服务地址
              <input
                value={imageApiBaseUrl}
                onChange={(event) => setImageApiBaseUrl(event.target.value)}
                className="rounded-xl bg-[#f1f4f5] p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-cyan-300"
              />
            </label>
          </div>

          {(message || error) && (
            <SettingsFeedback message={message} error={error} />
          )}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void save("image")}
              className="rounded-xl bg-[#11151b] px-6 py-3 font-black text-white disabled:opacity-40"
            >
              {busy ? "正在处理…" : `保存图片 API`}
            </button>
            {settings.imageApiKeyConfigured && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void save("image", true)}
                className="rounded-xl px-5 py-3 font-bold text-red-600 disabled:opacity-40"
              >
                移除图片密钥
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsFeedback({
  message,
  error,
}: {
  message: string;
  error: string;
}) {
  return (
    <p
      className={`rounded-xl p-3 text-sm font-bold ${
        error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-800"
      }`}
    >
      {error || message}
    </p>
  );
}

function EditorField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-1 text-xs font-bold text-black/50">
      {label}
      {children}
    </label>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-bold opacity-45">{label}</dt>
      <dd className="mt-1 break-all font-bold">{value}</dd>
    </div>
  );
}

function SettingsSelect({
  value,
  options,
  onSelect,
  onInputChange,
  editable = false,
  disabled,
}: {
  value: string;
  options: Array<{ value: string; label: string; detail?: string }>;
  onSelect: (value: string) => void;
  onInputChange?: (value: string) => void;
  editable?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [openUp, setOpenUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  function toggle() {
    if (disabled) return;
    const nextOpen = !open;
    if (nextOpen && ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUp(spaceBelow < 300 && spaceAbove > spaceBelow);
    }
    setOpen(nextOpen);
  }

  function openList() {
    if (disabled || open) return;
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      setOpenUp(spaceBelow < 300 && spaceAbove > spaceBelow);
    }
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    function closeOnOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <div
        className={`flex h-11 w-full items-center gap-2 rounded-xl border bg-white pl-3 pr-1 shadow-sm transition ${
          open
            ? "border-[#16bec8] ring-2 ring-cyan-100"
            : "border-black/[0.08] hover:border-[#16bec8]/40 hover:shadow"
        } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
      >
        {editable ? (
          <input
            value={value}
            disabled={disabled}
            onChange={(event) => onInputChange?.(event.target.value)}
            onClick={openList}
            onFocus={openList}
            placeholder="选择或输入模型 ID"
            aria-label="对话模型 ID"
            className="min-w-0 flex-1 bg-transparent font-mono text-sm outline-none"
          />
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={toggle}
            className="flex h-full min-w-0 flex-1 items-center justify-between gap-3 text-left"
          >
            <span className="min-w-0">
              <strong className="block truncate text-sm font-black">
                {selected?.label ?? "请选择"}
              </strong>
              {selected?.detail && (
                <span className="mt-0.5 block truncate text-[11px] text-black/40">
                  {selected.detail}
                </span>
              )}
            </span>
          </button>
        )}
        <button
          type="button"
          tabIndex={-1}
          disabled={disabled}
          onClick={toggle}
          aria-label={open ? "收起选项" : "展开选项"}
          className={`shrink-0 rounded-lg p-1.5 text-black/45 transition hover:bg-[#f1f4f5] disabled:cursor-not-allowed disabled:opacity-50 ${
            open ? "rotate-180" : ""
          }`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          className={`absolute inset-x-0 z-40 max-h-72 overflow-y-auto rounded-xl border border-black/[0.08] bg-white p-2 shadow-[0_18px_40px_rgb(0_0_0/14%)] ${
            openUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition ${
                  active ? "bg-cyan-50" : "hover:bg-[#f1f4f5]"
                }`}
              >
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm">
                    {option.label}
                  </strong>
                  {option.detail && (
                    <span className="mt-0.5 block text-[11px] leading-4 text-black/40">
                      {option.detail}
                    </span>
                  )}
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
        </div>
      )}
    </div>
  );
}

function StickFigure({ accentColor }: { accentColor: string }) {
  return (
    <svg viewBox="0 0 120 100" className="mx-auto w-28">
      <circle
        cx="50"
        cy="20"
        r="13"
        fill="white"
        stroke="#20252b"
        strokeWidth="5"
      />
      <path
        d="M50 33V67M50 43L27 54M50 43L79 35M50 67L34 93M50 67L70 93"
        fill="none"
        stroke="#20252b"
        strokeWidth="5"
        strokeLinecap="round"
      />
      <path d="M83 18h25v18H88l-8 8 3-10z" fill={accentColor} opacity="0.9" />
    </svg>
  );
}
