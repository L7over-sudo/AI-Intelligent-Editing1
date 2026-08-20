"use client";

import { useEffect, useState } from "react";

import { AppDialog } from "./app-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import {
  VoiceProfileDropdown,
  type VoiceProfileSummary,
} from "./voice-profile-dropdown";

export type { VoiceProfileSummary } from "./voice-profile-dropdown";

export function VoiceProfilePanel({
  voiceStyle,
  setVoiceStyle,
  profiles,
  selectedProfileId,
  setSelectedProfileId,
  profileName,
  setProfileName,
  referenceFile,
  setReferenceFile,
  serviceUrl,
  setServiceUrl,
  consentConfirmed,
  setConsentConfirmed,
  onProfileSaved,
  onProfileRenamed,
  onProfileDeleted,
}: {
  voiceStyle: string;
  setVoiceStyle: (value: string) => void;
  profiles: VoiceProfileSummary[];
  selectedProfileId: string;
  setSelectedProfileId: (value: string) => void;
  profileName: string;
  setProfileName: (value: string) => void;
  referenceFile: File | undefined;
  setReferenceFile: (file: File | undefined) => void;
  serviceUrl: string;
  setServiceUrl: (value: string) => void;
  consentConfirmed: boolean;
  setConsentConfirmed: (value: boolean) => void;
  onProfileSaved: (profile: VoiceProfileSummary) => void;
  onProfileRenamed: (profile: VoiceProfileSummary) => void;
  onProfileDeleted: (profileId: string) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [duration, setDuration] = useState<number>();
  const [deletingProfileId, setDeletingProfileId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [profilePendingDelete, setProfilePendingDelete] =
    useState<VoiceProfileSummary | null>(null);
  const [profilePendingRename, setProfilePendingRename] =
    useState<VoiceProfileSummary | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveHint, setSaveHint] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const voiceEnabled = voiceStyle !== "none";
  const uploadingNew = voiceEnabled && !selectedProfileId;
  const builtinProfiles = profiles.filter((profile) => profile.builtin);
  const customProfiles = profiles.filter((profile) => !profile.builtin);
  const selectedCustomProfile = customProfiles.find(
    (profile) => profile.id === selectedProfileId,
  );

  useEffect(() => {
    if (!referenceFile) {
      setPreviewUrl("");
      setDuration(undefined);
      return;
    }
    const url = URL.createObjectURL(referenceFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [referenceFile]);

  const selectProfile = (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId);
    setVoiceStyle(profile?.provider ?? "local-clone");
    setSelectedProfileId(profileId);
    setReferenceFile(undefined);
    setConsentConfirmed(false);
  };

  async function deleteProfile(profileId: string) {
    setDeletingProfileId(profileId);
    setDeleteError("");
    try {
      const response = await fetch(`/api/voice-profiles/${profileId}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "克隆音色删除失败");
      }
      onProfileDeleted(profileId);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "克隆音色删除失败",
      );
    } finally {
      setDeletingProfileId("");
    }
  }

  async function renameProfile() {
    const profile = profilePendingRename;
    const name = renameName.trim();
    if (!profile || !name) {
      setRenameError("请输入音色名称");
      return;
    }
    setRenaming(true);
    setRenameError("");
    try {
      const response = await fetch(`/api/voice-profiles/${profile.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        profile?: VoiceProfileSummary;
        error?: string;
      };
      if (!response.ok || !data.profile) {
        throw new Error(data.error ?? "音色重命名失败");
      }
      onProfileRenamed(data.profile);
      setProfilePendingRename(null);
      setRenameName("");
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "音色重命名失败");
    } finally {
      setRenaming(false);
    }
  }

  async function saveProfile() {
    if (!referenceFile || !profileName.trim() || !consentConfirmed) {
      setSaveError("请填写声音名称、上传参考声音并确认授权");
      return;
    }
    setSaving(true);
    setSaveError("");
    setSaveHint("");
    let createdProfileId = "";
    try {
      const contentType = voiceReferenceContentType(referenceFile);
      const setup = await fetch("/api/voice-profiles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          profileName: profileName.trim(),
          fileName: referenceFile.name,
          contentType,
          byteSize: referenceFile.size,
          provider: voiceStyle === "none" ? "local-clone" : voiceStyle,
          ...(serviceUrl.trim() ? { serviceUrl: serviceUrl.trim() } : {}),
          consentConfirmed,
        }),
      });
      const setupData = (await setup.json().catch(() => ({}))) as {
        assetId?: string;
        uploadUrl?: string;
        profile?: VoiceProfileSummary;
        error?: string;
      };
      if (!setup.ok || !setupData.uploadUrl || !setupData.profile) {
        throw new Error(setupData.error ?? "声音档案创建失败");
      }
      createdProfileId = setupData.profile.id;
      const upload = await fetch(setupData.uploadUrl, {
        method: "PUT",
        headers: { "content-type": contentType },
        body: referenceFile,
      });
      if (!upload.ok) {
        const uploadData = (await upload.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(uploadData.error ?? "参考声音上传失败");
      }

      onProfileSaved(setupData.profile);
      setVoiceStyle(setupData.profile.provider ?? "local-clone");
      setSelectedProfileId(setupData.profile.id);
      setReferenceFile(undefined);
      setConsentConfirmed(false);
      setSaveHint("声音已保存，创建项目后即可在配音板块直接使用");
    } catch (error) {
      if (createdProfileId) {
        await fetch(`/api/voice-profiles/${createdProfileId}`, {
          method: "DELETE",
        }).catch(() => undefined);
      }
      setSaveError(error instanceof Error ? error.message : "声音保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h2 className="font-black">角色声音</h2>
      <p className="mt-1 text-xs leading-5 text-black/45">
        内置音色使用 Qwen3-TTS，上传声音默认使用 Qwen3-TTS 克隆。
      </p>

      <VoiceProfileDropdown
        title="内置音色"
        hint="官方示例音色，无需上传，展开后可直接试听选择。"
        profiles={builtinProfiles}
        selectedProfileId={selectedProfileId}
        placeholder="选择内置音色"
        onSelect={selectProfile}
      />

      <VoiceProfileDropdown
        title="我的音色"
        hint="克隆或上传的声音，选中后可重命名或删除。"
        profiles={customProfiles}
        selectedProfileId={selectedProfileId}
        placeholder="选择我的音色"
        onSelect={selectProfile}
      />
      {selectedCustomProfile && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setProfilePendingRename(selectedCustomProfile);
              setRenameName(selectedCustomProfile.name);
              setRenameError("");
            }}
            className="flex-1 rounded-lg bg-white px-3 py-2 text-xs font-bold text-black/70 ring-1 ring-black/10 hover:bg-black/[0.03]"
          >
            重命名
          </button>
          <button
            type="button"
            disabled={deletingProfileId === selectedCustomProfile.id}
            onClick={() => setProfilePendingDelete(selectedCustomProfile)}
            className="flex-1 rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-40"
          >
            {deletingProfileId === selectedCustomProfile.id
              ? "删除中…"
              : "删除音色"}
          </button>
        </div>
      )}

      {deleteError && (
        <p className="mt-3 rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">
          {deleteError}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-[#f1f4f5] p-1">
        <button
          type="button"
          onClick={() => {
            setVoiceStyle("qwen3-tts-clone");
            setSelectedProfileId("");
          }}
          className={`rounded-lg px-3 py-2 text-xs font-black ${
            uploadingNew ? "bg-white shadow-sm" : "text-black/40"
          }`}
        >
          上传新声音（Qwen3 克隆）
        </button>
        <button
          type="button"
          onClick={() => {
            setVoiceStyle("none");
            setSelectedProfileId("");
            setReferenceFile(undefined);
          }}
          className={`rounded-lg px-3 py-2 text-xs font-black ${
            !voiceEnabled ? "bg-white shadow-sm" : "text-black/40"
          }`}
        >
          暂不配音
        </button>
      </div>

      {uploadingNew && (
        <div className="mt-4 grid gap-4">
          <label className="grid gap-2 text-xs font-bold">
            角色声音名称
            <input
              value={profileName}
              onChange={(event) => setProfileName(event.target.value)}
              maxLength={40}
              placeholder="例如：我的讲解声音"
              className="rounded-xl bg-[#f1f4f5] p-3 text-sm outline-none focus:ring-2 focus:ring-cyan-300"
            />
          </label>

          <label className="grid gap-2 text-xs font-bold">
            参考声音
            <span className="cursor-pointer rounded-xl border-2 border-dashed border-black/10 bg-[#fafbfb] p-4 text-center hover:border-cyan-400">
              <strong className="block text-sm">
                {referenceFile
                  ? referenceFile.name
                  : "点击上传约 10 秒至 1 分钟清晰人声"}
              </strong>
              <span className="mt-1 block font-normal text-black/35">
                WAV、MP3、M4A 或 FLAC，最大 200MB
              </span>
              <input
                type="file"
                accept="audio/wav,audio/x-wav,audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,audio/flac,audio/x-flac"
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

          {previewUrl && (
            <div>
              <audio
                controls
                className="h-9 w-full"
                src={previewUrl}
                onLoadedMetadata={(event) =>
                  setDuration(event.currentTarget.duration)
                }
              >
                <track kind="captions" />
              </audio>
              {duration !== undefined && (
                <p
                  className={`mt-2 text-xs font-bold ${
                    duration >= 3 && duration <= 600
                      ? "text-emerald-700"
                      : "text-red-600"
                  }`}
                >
                  音频时长：{formatDuration(duration)}
                  {duration < 3 || duration > 600
                    ? "（建议 3 秒至 10 分钟）"
                    : ""}
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl bg-cyan-50 p-3 text-xs leading-5 text-cyan-900">
            保存后，创建项目时选择这个音色，配音板块会通过当前配音模型合成全部旁白。
          </div>

          <div className="rounded-xl border border-black/[0.06] p-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen((current) => !current)}
              className="cursor-pointer text-xs font-bold"
            >
              {advancedOpen ? "收起" : "展开"}高级设置（通常不用修改）
            </button>
            {advancedOpen && (
              <div className="mt-3 grid gap-3">
                <label className="grid gap-2 text-xs font-bold">
                  配音服务地址
                  <input
                    value={serviceUrl}
                    onChange={(event) => setServiceUrl(event.target.value)}
                    placeholder="https://your-voice-service.example"
                    className="rounded-xl bg-[#f1f4f5] p-3 font-mono text-xs"
                  />
                </label>
                <p className="text-[11px] leading-4 text-black/40">
                  如果当前模型需要单独启动服务，请先启动服务再保存声音。
                </p>
              </div>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            <input
              type="checkbox"
              checked={consentConfirmed}
              onChange={(event) => setConsentConfirmed(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-amber-600"
            />
            我确认拥有该声音的使用权并已获得本人授权，不用于冒充、欺诈或未经同意的内容。
          </label>

          <button
            type="button"
            disabled={
              saving ||
              !referenceFile ||
              !profileName.trim() ||
              !consentConfirmed
            }
            onClick={() => void saveProfile()}
            className="rounded-xl bg-[#11151b] px-4 py-3 text-sm font-black text-white hover:bg-black disabled:cursor-not-allowed disabled:opacity-35"
          >
            {saving ? "保存中…" : "保存声音"}
          </button>
          {saveError && (
            <p className="rounded-xl bg-red-50 p-3 text-xs font-bold text-red-700">
              {saveError}
            </p>
          )}
        </div>
      )}

      {saveHint && (
        <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
          {saveHint}
        </p>
      )}

      <ConfirmDialog
        open={profilePendingDelete !== null}
        title="删除克隆音色"
        description={
          profilePendingDelete
            ? `确定删除克隆音色“${profilePendingDelete.name}”吗？删除后需要重新上传参考声音。`
            : ""
        }
        confirmText="确认删除"
        busy={deletingProfileId !== ""}
        onConfirm={() => {
          if (profilePendingDelete) {
            void deleteProfile(profilePendingDelete.id);
          }
          setProfilePendingDelete(null);
        }}
        onClose={() => setProfilePendingDelete(null)}
      />

      <AppDialog
        open={profilePendingRename !== null}
        title="重命名音色"
        description={`修改“${profilePendingRename?.name ?? ""}”的名称`}
        confirmLabel="保存名称"
        busy={renaming}
        confirmDisabled={!renameName.trim()}
        input={{
          label: "音色名称",
          value: renameName,
          maxLength: 40,
          placeholder: "例如：我的讲解声",
          error: renameError,
          onChange: (value) => {
            setRenameName(value);
            setRenameError("");
          },
        }}
        onConfirm={() => void renameProfile()}
        onCancel={() => {
          setProfilePendingRename(null);
          setRenameError("");
        }}
      />

      {!uploadingNew && voiceEnabled && (
        <p className="mt-4 rounded-xl bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
          当前项目会直接使用已保存的角色声音朗读全部分镜。
        </p>
      )}
    </div>
  );
}

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function voiceReferenceContentType(file: File): string {
  const acceptedTypes = new Set([
    "audio/wav",
    "audio/x-wav",
    "audio/x-m4a",
    "audio/aac",
    "audio/mpeg",
    "audio/mp4",
    "audio/flac",
    "audio/x-flac",
  ]);
  if (acceptedTypes.has(file.type)) return file.type;
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    {
      wav: "audio/wav",
      mp3: "audio/mpeg",
      m4a: "audio/mp4",
      aac: "audio/aac",
      flac: "audio/flac",
    }[extension ?? ""] ?? "audio/wav"
  );
}
