"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { CreativeStudio } from "./creative-studio";

type WorkspaceView =
  | "create"
  | "projects"
  | "storyboard"
  | "preview"
  | "render"
  | "export"
  | "settings";

type ImageModel =
  "gpt-image-2" | "gpt-image-2pro" | "nano-banana-2" | "nano-banana-pro";
type ImageSize = "1K" | "2K" | "4K";

interface ProjectSummary {
  id: string;
  title: string;
  status: string;
  targetDuration: number;
  updatedAt: string;
  _count: { scenes: number };
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
  imageApiKeyConfigured: boolean;
  imageApiBaseUrl: string;
  imageModel: ImageModel;
  imageSize: ImageSize;
  scriptModel: string;
  ttsModel: string;
  transcribeModel: string;
}

const settingsEndpoint = "http://127.0.0.1:4317/settings/openai";

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
  imageApiKeyConfigured: false,
  imageApiBaseUrl: "https://www.hfsyapi.cn",
  imageModel: "gpt-image-2",
  imageSize: "1K",
  scriptModel: "local",
  ttsModel: "",
  transcribeModel: "",
};

const navigation: Array<{
  id: WorkspaceView;
  icon: string;
  label: string;
  projectRequired?: boolean;
}> = [
  { id: "create", icon: "＋", label: "创作" },
  { id: "projects", icon: "▦", label: "项目" },
  { id: "settings", icon: "⚙", label: "API" },
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
  return ["1K", "2K", "4K"];
}

export function UnifiedWorkspace() {
  const [view, setView] = useState<WorkspaceView>("create");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [project, setProject] = useState<Project>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
    void loadProjects().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "项目列表加载失败"),
    );
  }, [loadProjects]);

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

  async function deleteProject(projectId: string, title: string) {
    if (
      !window.confirm(
        `确定永久删除“${title}”吗？项目图片、配音、字幕和视频文件也会从本机删除，无法恢复。`,
      )
    ) {
      return;
    }
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/projects/${projectId}`, {
        method: "DELETE",
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "项目删除失败");
      if (selectedProjectId === projectId) {
        setSelectedProjectId("");
        setProject(undefined);
      }
      await loadProjects();
      setMessage(`项目“${title}”已删除`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "项目删除失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="h-dvh overflow-hidden bg-[#e7edef] text-[#20252b]">
      <WorkspaceRail
        view={view}
        projectSelected={Boolean(selectedProjectId)}
        onOpen={openView}
      />

      {view === "create" ? (
        <div className="h-full overflow-hidden pb-16 lg:pb-0 lg:pl-20">
          <CreativeStudio
            onProjectCreated={handleProjectCreated}
            onOpenSettings={() => openView("settings")}
          />
        </div>
      ) : (
        <main className="h-dvh overflow-hidden px-3 pb-20 pt-3 lg:pb-3 lg:pl-[92px]">
          <div className="mx-auto flex h-full max-w-[1600px] flex-col overflow-hidden rounded-2xl bg-white p-5 shadow-sm md:p-7">
            <WorkspaceHeader
              view={view}
              projects={projects}
              selectedProjectId={selectedProjectId}
              onSelectProject={(projectId) => {
                setSelectedProjectId(projectId);
                if (projectId) void loadProject(projectId);
              }}
            />

            <div className="min-h-0 flex-1 overflow-y-auto">
              {(message || error) && (
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
                    void deleteProject(projectId, title)
                  }
                />
              )}

              {view === "settings" && <SettingsPanel />}

              {["storyboard", "preview", "render", "export"].includes(view) && (
                <ProjectPanel
                  view={view}
                  project={project}
                  loading={loading}
                  setLoading={setLoading}
                  setProject={setProject}
                  reload={() => loadProject(selectedProjectId)}
                  setMessage={setMessage}
                  setError={setError}
                  onOpen={openView}
                />
              )}
            </div>
          </div>
        </main>
      )}
    </div>
  );
}

function WorkspaceRail({
  view,
  projectSelected,
  onOpen,
}: {
  view: WorkspaceView;
  projectSelected: boolean;
  onOpen: (view: WorkspaceView) => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex h-16 items-center justify-around border-t border-black/10 bg-[#11151b] px-2 text-white shadow-xl lg:inset-y-0 lg:left-0 lg:right-auto lg:h-auto lg:w-20 lg:flex-col lg:justify-start lg:gap-1 lg:border-r lg:border-t-0 lg:py-3">
      <button
        type="button"
        onClick={() => onOpen("create")}
        className="mb-0 hidden size-12 place-items-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 text-xl font-black lg:grid"
        aria-label="StickMotion 创作台"
      >
        S
      </button>
      <div className="hidden h-px w-10 bg-white/10 lg:my-2 lg:block" />
      {navigation.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item.id)}
          title={
            item.projectRequired && !projectSelected
              ? `${item.label}：请先选择项目`
              : item.label
          }
          className={`group flex min-w-11 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-bold transition lg:w-16 lg:py-2 ${
            view === item.id
              ? "bg-white text-[#11151b]"
              : "text-white/55 hover:bg-white/10 hover:text-white"
          }`}
        >
          <span className="text-lg leading-5">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
      <div className="mt-auto hidden pb-2 text-center text-[9px] text-white/30 lg:block">
        本机版
        <br />
        已登录
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
    storyboard: ["分镜编辑", "调整旁白、字幕、画面和镜头顺序"],
    preview: ["视频预览", "检查每个镜头和已经生成的成片"],
    render: ["渲染中心", "查看 FFmpeg 后台任务和错误日志"],
    export: ["导出成片", "播放或下载 1080P MP4"],
    settings: ["第三方 API", "配置图片生成模型和密钥"],
  };
  const [title, description] = titles[view];

  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-black/[0.06] pb-5">
      <div>
        <h1 className="text-2xl font-black md:text-3xl">{title}</h1>
        <p className="mt-1 text-sm text-black/40">{description}</p>
      </div>
      <div className="flex items-center gap-3">
        {!["projects", "settings"].includes(view) && (
          <select
            value={selectedProjectId}
            onChange={(event) => onSelectProject(event.target.value)}
            className="max-w-64 rounded-xl border border-black/10 bg-[#f2f5f6] px-3 py-2 text-sm font-bold outline-none"
          >
            <option value="">选择项目</option>
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
        )}
        <span className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">
          ● 本机服务正常
        </span>
      </div>
    </header>
  );
}

function ProjectsPanel({
  projects,
  onCreate,
  onOpen,
  onDelete,
}: {
  projects: ProjectSummary[];
  onCreate: () => void;
  onOpen: (projectId: string) => void;
  onDelete: (projectId: string, title: string) => void;
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
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {projects.map((item) => (
          <article
            key={item.id}
            className="group overflow-hidden rounded-2xl border border-black/[0.08] bg-[#f8fafb] transition hover:border-cyan-400 hover:shadow-lg"
          >
            <button
              type="button"
              onClick={() => onOpen(item.id)}
              className="block w-full p-5 text-left"
            >
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-white px-3 py-1 text-xs font-bold">
                  {statusLabels[item.status] ?? item.status}
                </span>
                <span className="text-xs text-black/35">
                  {item.targetDuration > 0
                    ? `约 ${item.targetDuration} 秒`
                    : "正在计算时长"}
                </span>
              </div>
              <div className="mt-8 flex aspect-video items-end rounded-xl bg-gradient-to-br from-white to-cyan-50 p-4">
                <span className="text-4xl font-black text-black/[0.06]">
                  {String(item._count.scenes).padStart(2, "0")}
                </span>
              </div>
              <h2 className="mt-4 line-clamp-2 text-xl font-black">
                {item.title}
              </h2>
              <p className="mt-2 text-xs text-black/40">
                {item._count.scenes} 个分镜 ·{" "}
                {new Date(item.updatedAt).toLocaleString("zh-CN")}
              </p>
            </button>
            <div className="flex items-center justify-between border-t border-black/[0.06] px-5 py-3">
              <button
                type="button"
                onClick={() => onOpen(item.id)}
                className="text-xs font-black text-cyan-700"
              >
                打开编辑
              </button>
              <button
                type="button"
                onClick={() => onDelete(item.id, item.title)}
                className="rounded-lg px-3 py-1.5 text-xs font-black text-red-600 hover:bg-red-50"
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

function ProjectPanel({
  view,
  project,
  loading,
  setLoading,
  setProject,
  reload,
  setMessage,
  setError,
  onOpen,
}: {
  view: WorkspaceView;
  project: Project | undefined;
  loading: boolean;
  setLoading: (value: boolean) => void;
  setProject: (project: Project | undefined) => void;
  reload: () => Promise<void>;
  setMessage: (message: string) => void;
  setError: (message: string) => void;
  onOpen: (view: WorkspaceView) => void;
}) {
  const [selectedSceneIds, setSelectedSceneIds] = useState<string[]>([]);
  const latestRender = project?.jobs.find((job) => job.type === "RENDER");
  const voicedScenes =
    project?.scenes.filter((scene) => scene.voiceTracks.length > 0).length ?? 0;
  const generatedScenes = project
    ? project.scenes.filter((scene) => getCurrentSceneImage(project, scene))
        .length
    : 0;
  const latestSceneImageJob = project?.jobs.find((job) => job.type === "SCENE");
  const voiceJobs = project?.jobs.filter((job) => job.type === "VOICE") ?? [];
  const voiceJobTotal = voiceJobs.length;
  const voiceJobDone = voiceJobs.filter(
    (job) => job.status === "SUCCEEDED",
  ).length;
  const voiceJobFailed = voiceJobs.filter(
    (job) => job.status === "FAILED",
  ).length;
  const activeVoiceJobs = voiceJobs.filter((job) =>
    ["QUEUED", "RUNNING", "RETRYING"].includes(job.status),
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
    const available = new Set(project?.scenes.map((scene) => scene.id) ?? []);
    setSelectedSceneIds((current) => current.filter((id) => available.has(id)));
  }, [project?.id, project?.scenes]);
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

  if (!project) {
    return (
      <div className="grid min-h-[60vh] place-items-center text-sm text-black/40">
        正在加载项目…
      </div>
    );
  }

  const selectedProject = project;
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
      `${label}已加入画面生成队列，每批并行生成 4 个分镜`,
    );
    setSelectedSceneIds([]);
  }

  function toggleSceneSelection(sceneId: string) {
    setSelectedSceneIds((current) =>
      current.includes(sceneId)
        ? current.filter((id) => id !== sceneId)
        : [...current, sceneId],
    );
  }

  function toggleAllSceneSelection() {
    setSelectedSceneIds((current) =>
      current.length === selectedProject.scenes.length
        ? []
        : selectedProject.scenes.map((scene) => scene.id),
    );
  }

  function updateScene(sceneId: string, patch: Partial<Scene>) {
    setProject({
      ...selectedProject,
      scenes: selectedProject.scenes.map((scene) =>
        scene.id === sceneId ? { ...scene, ...patch } : scene,
      ),
    });
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
    <div className="pt-5">
      <section className="rounded-2xl bg-[#f3f6f7] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-black">{project.title}</h2>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold">
                {statusLabels[project.status] ?? project.status} · REV{" "}
                {project.revision}
              </span>
            </div>
            <p className="mt-1 text-xs text-black/40">
              {project.scenes.length} 个分镜 · 约 {project.targetDuration} 秒 ·{" "}
              {project.aspectRatio === "PORTRAIT" ? "9:16" : "16:9"}
            </p>
          </div>
          <div className="flex gap-2">
            {progressItems.map(([label, complete]) => (
              <span
                key={label}
                className={`rounded-lg px-2.5 py-1.5 text-[10px] font-bold ${
                  complete
                    ? "bg-[#11151b] text-white"
                    : "bg-white text-black/35"
                }`}
              >
                {complete ? "✓ " : "○ "}
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      <nav className="mt-4 flex flex-wrap gap-2 border-b border-black/[0.06] pb-4">
        {(
          [
            ["storyboard", "分镜编辑"],
            ["preview", "画面预览"],
            ["render", "渲染进度"],
            ["export", "导出成片"],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => onOpen(tab)}
            className={`rounded-xl px-4 py-2 text-sm font-bold transition ${
              view === tab
                ? "bg-[#11151b] text-white"
                : "bg-[#f2f5f6] text-black/45 hover:text-black"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {view === "storyboard" && (
        <section className="mt-5">
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
                className="rounded-xl border border-cyan-500 px-4 py-2 text-sm font-black text-cyan-700 disabled:opacity-35"
              >
                一键生成全部
              </button>
              <label className="cursor-pointer rounded-xl border border-black/10 px-4 py-2 text-sm font-bold">
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
                      fetch(`/api/projects/${project.id}/storyboard/generate`, {
                        method: "POST",
                      }),
                    "\u6587\u6848\u91cd\u65b0\u62c6\u5206\u4efb\u52a1\u5df2\u5f00\u59cb",
                  )
                }
                className="rounded-xl bg-[#11151b] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
              >
                {"\u91cd\u65b0\u62c6\u5206\u6587\u6848"}
              </button>
            </div>
          </div>

          <div className="mt-4 rounded-xl bg-cyan-50 px-4 py-3 text-sm text-cyan-900">
            文案拆分完成后不会自动生成图片。请勾选需要的分镜再生成，或点击“一键生成全部”。每批并行处理
            4 个分镜，每个分镜生成 1 张图片。已生成 {generatedScenes}/
            {project.scenes.length} 张。
          </div>
          {latestSceneImageJob &&
            ["QUEUED", "RUNNING", "RETRYING", "FAILED"].includes(
              latestSceneImageJob.status,
            ) && (
              <div className="mt-3 rounded-xl bg-[#f3f6f7] p-3">
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
            <div className="mt-3 rounded-xl bg-[#f3f6f7] p-3">
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
                <p className="mt-2 text-xs text-black/45">
                  正在生成配音…
                </p>
              )}
              {voiceJobFailed > 0 && (
                <p className="mt-2 text-xs text-red-700">
                  {voiceJobFailed} 段配音失败，可重新生成
                </p>
              )}
            </div>
          )}
          <div className="mt-4 grid gap-4">
            {project.scenes.map((scene, index) => (
              <article
                key={scene.id}
                className="grid gap-4 rounded-2xl border border-black/[0.08] p-4 xl:grid-cols-[72px_1fr_1fr]"
              >
                <div>
                  <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs font-black text-cyan-800">
                    <input
                      type="checkbox"
                      checked={selectedSceneIds.includes(scene.id)}
                      onChange={() => toggleSceneSelection(scene.id)}
                      className="size-4 accent-[#16b9c4]"
                    />
                    选择此分镜
                  </label>
                  {getCurrentSceneImage(project, scene) ? (
                    <img
                      src={`/api/assets/${getCurrentSceneImage(project, scene)!.asset.id}/content`}
                      alt={`分镜 ${index + 1} 画面`}
                      className="mb-3 aspect-video w-full rounded-lg object-cover xl:w-16"
                    />
                  ) : (
                    <div className="mb-3 grid aspect-video w-full place-items-center rounded-lg bg-[#f1f4f5] text-[10px] text-black/35 xl:w-16">
                      未生成
                    </div>
                  )}
                  <span className="text-3xl font-black text-black/10">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-1 text-xs text-black/40">
                    {scene.estimatedDuration.toFixed(1)} 秒
                  </p>
                  <div className="mt-3 flex gap-1">
                    <button
                      type="button"
                      disabled={index === 0 || loading}
                      onClick={() => void moveScene(index, -1)}
                      className="rounded border px-2 py-1 text-xs disabled:opacity-20"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      disabled={index === project.scenes.length - 1 || loading}
                      onClick={() => void moveScene(index, 1)}
                      className="rounded border px-2 py-1 text-xs disabled:opacity-20"
                    >
                      ↓
                    </button>
                  </div>
                </div>

                <div className="grid gap-3">
                  <EditorField label="旁白">
                    <textarea
                      value={scene.narration}
                      onChange={(event) =>
                        updateScene(scene.id, {
                          narration: event.target.value,
                        })
                      }
                      className="min-h-24 rounded-xl bg-[#f4f7f8] p-3 text-sm outline-none focus:ring-2 focus:ring-cyan-300"
                    />
                  </EditorField>
                  <EditorField label="字幕">
                    <textarea
                      value={scene.subtitle}
                      onChange={(event) =>
                        updateScene(scene.id, { subtitle: event.target.value })
                      }
                      className="min-h-16 rounded-xl bg-[#f4f7f8] p-3 text-sm outline-none focus:ring-2 focus:ring-cyan-300"
                    />
                  </EditorField>
                </div>

                <div className="grid gap-3">
                  <EditorField label="画面提示">
                    <textarea
                      value={scene.visualPrompt}
                      onChange={(event) =>
                        updateScene(scene.id, {
                          visualPrompt: event.target.value,
                        })
                      }
                      className="min-h-24 rounded-xl bg-[#f4f7f8] p-3 text-sm outline-none focus:ring-2 focus:ring-cyan-300"
                    />
                  </EditorField>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void saveScene(scene)}
                      className="rounded-lg bg-[#11151b] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
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
                      className="rounded-lg border border-black/10 px-3 py-2 text-xs font-bold disabled:opacity-40"
                    >
                      {scene.voiceTracks.length ? "重新生成配音" : "生成配音"}
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
                      className="rounded-lg px-3 py-2 text-xs font-bold text-red-600 disabled:opacity-30"
                    >
                      删除
                    </button>
                  </div>
                  <p className="text-[11px] text-black/35">
                    配音会标记为 AI 生成；未配置配音服务时任务会给出错误提示。
                  </p>
                </div>
              </article>
            ))}
            {project.scenes.length === 0 && (
              <div className="rounded-2xl border-2 border-dashed border-black/10 p-12 text-center text-sm text-black/40">
                正在等待本地分镜任务完成，页面会自动刷新。
              </div>
            )}
          </div>
        </section>
      )}

      {view === "preview" && (
        <section className="mt-5">
          {project.renderOutputs[0] ? (
            <div className="rounded-2xl bg-[#11151b] p-4">
              <video
                controls
                className="mx-auto max-h-[70vh] w-full rounded-xl bg-black"
                src={`/api/assets/${project.renderOutputs[0].assetId}/content`}
              />
            </div>
          ) : (
            <div
              className={`grid gap-4 ${
                project.aspectRatio === "LANDSCAPE"
                  ? "md:grid-cols-2 xl:grid-cols-3"
                  : "grid-cols-2 md:grid-cols-3 xl:grid-cols-5"
              }`}
            >
              {project.scenes.map((scene, index) => (
                <article
                  key={scene.id}
                  className={`relative grid place-items-center overflow-hidden rounded-2xl border-2 border-[#20252b] bg-[#fbfbfb] p-5 text-center ${
                    project.aspectRatio === "PORTRAIT"
                      ? "aspect-[9/16]"
                      : "aspect-video"
                  }`}
                >
                  <span className="absolute left-3 top-3 text-xs font-black text-black/20">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {getCurrentSceneImage(project, scene) ? (
                    <>
                      <img
                        src={`/api/assets/${getCurrentSceneImage(project, scene)!.asset.id}/content`}
                        alt={`分镜 ${index + 1}`}
                        className="absolute inset-0 size-full object-cover"
                      />
                      <p className="absolute inset-x-3 bottom-3 rounded-lg bg-black/65 px-3 py-2 text-sm font-bold text-white">
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
          )}
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => onOpen("render")}
              className="rounded-xl bg-[#11151b] px-5 py-3 text-sm font-black text-white"
            >
              进入渲染 →
            </button>
          </div>
        </section>
      )}

      {view === "render" && (
        <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="rounded-2xl border border-black/[0.08] p-5">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-black">后台渲染任务</h3>
                <p className="mt-1 text-sm text-black/40">
                  FFmpeg 在独立 Worker 中运行，页面可以安全关闭。
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
                className="rounded-xl bg-[#16b9c4] px-5 py-3 text-sm font-black text-white disabled:opacity-40"
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
            <div className="mt-6 grid gap-3">
              {project.jobs
                .filter((job) => job.type === "RENDER")
                .map((job) => (
                  <div key={job.id} className="rounded-xl bg-[#f3f6f7] p-4">
                    <div className="flex items-center justify-between text-sm font-bold">
                      <span>{statusLabels[job.status] ?? job.status}</span>
                      <span>{job.progress}%</span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-black/10">
                      <div
                        className="h-full rounded-full bg-[#16b9c4] transition-all"
                        style={{ width: `${job.progress}%` }}
                      />
                    </div>
                    {job.errorMessage && (
                      <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-700">
                        {job.errorMessage}
                      </p>
                    )}
                  </div>
                ))}
              {!latestRender && (
                <div className="rounded-xl border-2 border-dashed border-black/10 p-10 text-center text-sm text-black/35">
                  尚未创建渲染任务
                </div>
              )}
            </div>
          </div>
          <aside className="rounded-2xl bg-[#11151b] p-5 text-white">
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
        <section className="mt-5">
          {project.renderOutputs[0] ? (
            <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
              <div className="rounded-2xl bg-[#11151b] p-4">
                <video
                  controls
                  className="max-h-[68vh] w-full rounded-xl bg-black"
                  src={`/api/assets/${project.renderOutputs[0].assetId}/content`}
                />
              </div>
              <aside className="flex flex-col rounded-2xl border border-black/[0.08] p-6">
                <span className="w-fit rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                  ✓ 成片已准备好
                </span>
                <h3 className="mt-6 text-2xl font-black">1080P MP4</h3>
                <p className="mt-2 text-sm leading-6 text-black/45">
                  {project.renderOutputs[0].width} ×{" "}
                  {project.renderOutputs[0].height} ·{" "}
                  {(project.renderOutputs[0].durationMs / 1_000).toFixed(1)} 秒
                </p>
                <div className="mt-6 rounded-2xl bg-[#f2f5f6] p-4">
                  <h4 className="font-black">剪映草稿</h4>
                  {activeJianyingJob ? (
                    <p className="mt-2 text-sm text-black/50">
                      {activeJianyingJob.input?.action === "INSTALL"
                        ? "正在复制到剪映并清理临时文件"
                        : "正在创建本地剪映草稿"}
                      …… {activeJianyingJob.progress}%
                    </p>
                  ) : relatedInstallJob?.status === "SUCCEEDED" ? (
                    <>
                      <p className="mt-2 text-sm font-bold text-emerald-700">
                        ✓ 已保存到剪映，原临时草稿已删除
                      </p>
                      <p className="mt-2 break-all text-xs text-black/40">
                        {relatedInstallJob.output?.installedPath}
                      </p>
                    </>
                  ) : latestCreatedDraftJob ? (
                    <>
                      <p className="mt-2 text-sm text-black/55">
                        草稿已创建，确认后可保存到剪映。
                      </p>
                      <p className="mt-2 break-all text-xs text-black/35">
                        {latestCreatedDraftJob.output?.stagingPath}
                      </p>
                      {relatedInstallJob?.status === "FAILED" && (
                        <p className="mt-2 text-xs text-red-600">
                          保存失败，临时草稿仍然保留，可以重新保存。
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-black/50">
                      成片完成后手动创建，不会自动占用剪映目录。
                    </p>
                  )}
                  <button
                    type="button"
                    disabled={loading || Boolean(activeJianyingJob)}
                    onClick={() =>
                      void runAction(
                        () =>
                          fetch(`/api/projects/${project.id}/jianying-draft`, {
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
                          }),
                        latestCreatedDraftJob &&
                          relatedInstallJob?.status !== "SUCCEEDED"
                          ? "保存到剪映任务已提交"
                          : "剪映草稿创建任务已提交",
                      )
                    }
                    className="mt-4 w-full rounded-xl bg-cyan-500 px-4 py-3 text-sm font-black text-white disabled:opacity-40"
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
                  {latestJianyingJob?.status === "FAILED" &&
                    latestJianyingJob.id !== relatedInstallJob?.id && (
                      <p className="mt-2 text-xs text-red-600">
                        {latestJianyingJob.errorMessage ?? "剪映草稿任务失败"}
                      </p>
                    )}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    window.location.assign(
                      `/api/assets/${project.renderOutputs[0]!.assetId}/content?download=1`,
                    )
                  }
                  className="mt-4 rounded-xl bg-[#11151b] px-5 py-4 font-black text-white"
                >
                  下载 MP4
                </button>
              </aside>
            </div>
          ) : (
            <div className="grid min-h-[55vh] place-items-center rounded-2xl border-2 border-dashed border-black/10 text-center">
              <div>
                <p className="text-4xl">◌</p>
                <h3 className="mt-4 text-xl font-black">还没有可导出的成片</h3>
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
        </section>
      )}
    </div>
  );
}

function SettingsPanel() {
  const [settings, setSettings] = useState<Settings>(emptySettings);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const preset = apiPresets[settings.imageModel];

  useEffect(() => {
    fetch(settingsEndpoint)
      .then(async (response) => {
        if (!response.ok) throw new Error("无法读取本机 API 配置");
        return response.json() as Promise<{ settings: Settings }>;
      })
      .then((data) => setSettings(data.settings))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "设置服务连接失败"),
      )
      .finally(() => setBusy(false));
  }, []);

  async function save(
    nextSettings = settings,
    options?: { clearImageApiKey?: boolean },
  ) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch(settingsEndpoint, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...(apiKey ? { imageApiKey: apiKey } : {}),
          clearApiKey: false,
          clearImageApiKey: options?.clearImageApiKey ?? false,
          imageApiBaseUrl: nextSettings.imageApiBaseUrl,
          imageModel: nextSettings.imageModel,
          imageSize: nextSettings.imageSize,
          scriptModel: nextSettings.scriptModel,
          ttsModel: nextSettings.ttsModel,
          transcribeModel: nextSettings.transcribeModel,
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
      setSettings(data.settings);
      setApiKey("");
      setMessage(
        data.settings.imageApiKeyConfigured
          ? `${apiPresets[data.settings.imageModel].label} 已配置并启用`
          : "模型预设已保存，请填写第三方密钥",
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function selectModel(model: ImageModel) {
    const selected = apiPresets[model];
    const nextSettings = {
      ...settings,
      imageModel: model,
      imageApiBaseUrl: selected.baseUrl,
      imageSize: selected.defaultSize,
    };
    setSettings(nextSettings);
    void save(nextSettings);
  }

  return (
    <section className="mx-auto max-w-4xl pt-6">
      <div
        className={`rounded-2xl p-4 ${
          settings.imageApiKeyConfigured
            ? "bg-emerald-50 text-emerald-800"
            : "bg-amber-50 text-amber-900"
        }`}
      >
        <p className="text-xs font-bold opacity-60">当前图片 API</p>
        <p className="mt-1 font-black">
          {settings.imageApiKeyConfigured ? "●" : "○"} {preset.label} ·{" "}
          {settings.imageApiKeyConfigured ? "已配置" : "未配置密钥"}
        </p>
      </div>

      <div className="mt-5 grid gap-5 rounded-2xl border border-black/[0.08] p-5 md:p-7">
        <label className="grid gap-2 text-sm font-bold">
          API 选择
          <select
            value={settings.imageModel}
            disabled={busy}
            onChange={(event) => selectModel(event.target.value as ImageModel)}
            className="rounded-xl bg-[#f1f4f5] p-4 font-black outline-none"
          >
            {Object.entries(apiPresets).map(([model, item]) => (
              <option key={model} value={model}>
                {item.label} — {item.description}
              </option>
            ))}
          </select>
          <span className="font-normal text-black/35">
            选择后自动配置服务地址、接口、模型和默认清晰度。
          </span>
        </label>

        <div className="grid gap-3 rounded-xl bg-[#f5f7f8] p-4 text-sm md:grid-cols-2">
          <InfoRow label="服务地址" value={preset.baseUrl} />
          <InfoRow label="接口" value={preset.endpoint} />
        </div>

        <label className="grid gap-2 text-sm font-bold">
          {preset.label} API Key
          <input
            type="password"
            autoComplete="new-password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              settings.imageApiKeyConfigured
                ? "密钥已保存；留空保持不变"
                : "输入 Bearer Token"
            }
            className="rounded-xl bg-[#f1f4f5] p-4 font-mono text-sm outline-none focus:ring-2 focus:ring-cyan-300"
          />
          <span className="font-normal text-black/35">
            密钥只发送给本机 Worker，不会显示在浏览器页面或返回结果中。
          </span>
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold">
            图片清晰度
            <select
              value={settings.imageSize}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  imageSize: event.target.value as ImageSize,
                })
              }
              className="rounded-xl bg-[#f1f4f5] p-3 outline-none"
            >
              {sizesForModel(settings.imageModel).map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-bold">
            自定义基地地址
            <input
              value={settings.imageApiBaseUrl}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  imageApiBaseUrl: event.target.value,
                })
              }
              className="rounded-xl bg-[#f1f4f5] p-3 font-mono text-sm outline-none"
            />
          </label>
        </div>

        {(message || error) && (
          <p
            className={`rounded-xl p-3 text-sm font-bold ${
              error
                ? "bg-red-50 text-red-700"
                : "bg-emerald-50 text-emerald-800"
            }`}
          >
            {error || message}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void save()}
            className="rounded-xl bg-[#11151b] px-6 py-3 font-black text-white disabled:opacity-40"
          >
            {busy ? "正在处理…" : `保存并启用 ${preset.label}`}
          </button>
          {settings.imageApiKeyConfigured && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void save(settings, { clearImageApiKey: true })}
              className="rounded-xl px-5 py-3 font-bold text-red-600 disabled:opacity-40"
            >
              移除第三方密钥
            </button>
          )}
        </div>
      </div>
    </section>
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
