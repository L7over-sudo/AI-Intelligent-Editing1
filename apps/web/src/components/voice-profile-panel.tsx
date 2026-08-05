"use client";

import { useEffect, useState } from "react";

export type VoiceCloneLanguage = "zh" | "en" | "ja" | "ko" | "yue";

export interface VoiceProfileSummary {
  id: string;
  name: string;
  assetId: string;
  fileName: string;
  createdAt: string;
  available?: boolean;
}

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
  promptText,
  setPromptText,
  promptLanguage,
  setPromptLanguage,
  serviceUrl,
  setServiceUrl,
  consentConfirmed,
  setConsentConfirmed,
  onProfileSaved,
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
  promptText: string;
  setPromptText: (value: string) => void;
  promptLanguage: VoiceCloneLanguage;
  setPromptLanguage: (value: VoiceCloneLanguage) => void;
  serviceUrl: string;
  setServiceUrl: (value: string) => void;
  consentConfirmed: boolean;
  setConsentConfirmed: (value: boolean) => void;
  onProfileSaved: (profile: VoiceProfileSummary) => void;
  onProfileDeleted: (profileId: string) => void;
}) {
  const [previewUrl, setPreviewUrl] = useState("");
  const [duration, setDuration] = useState<number>();
  const [deletingProfileId, setDeletingProfileId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveHint, setSaveHint] = useState("");
  const voiceEnabled = voiceStyle === "voxcpm2";
  const uploadingNew = voiceEnabled && !selectedProfileId;

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
    setVoiceStyle("voxcpm2");
    setSelectedProfileId(profileId);
    setReferenceFile(undefined);
    setConsentConfirmed(false);
  };

  async function deleteProfile(profile: VoiceProfileSummary) {
    if (!window.confirm(`确定删除克隆音色“${profile.name}”吗？`)) return;
    setDeletingProfileId(profile.id);
    setDeleteError("");
    try {
      const response = await fetch(`/api/voice-profiles/${profile.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? "克隆音色删除失败");
      }
      onProfileDeleted(profile.id);
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "克隆音色删除失败",
      );
    } finally {
      setDeletingProfileId("");
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
          promptText: promptText.trim(),
          promptLanguage,
          serviceUrl,
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
      setVoiceStyle("voxcpm2");
      setSelectedProfileId(setupData.profile.id);
      setReferenceFile(undefined);
      setConsentConfirmed(false);
      setSaveHint("声音已保存，可以试听并在后续项目中直接使用");
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
        已保存的克隆声音可以在以后的视频中直接调用，不需要重复上传。
      </p>

      {profiles.length > 0 && (
        <section className="mt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-black">已保存声音</h3>
            <span className="text-xs text-black/35">{profiles.length} 个</span>
          </div>
          <div className="mt-2 grid gap-2">
            {profiles.map((profile) => (
              <div
                key={profile.id}
                className={`overflow-hidden rounded-xl border ${
                  voiceEnabled && selectedProfileId === profile.id
                    ? "border-cyan-400 bg-cyan-50"
                    : "border-black/[0.07] bg-white"
                }`}
              >
                <button
                  type="button"
                  disabled={profile.available === false}
                  onClick={() => selectProfile(profile.id)}
                  className="flex w-full items-center gap-3 p-3 text-left disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#11151b] text-white">
                    ♪
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block truncate text-sm">
                      {profile.name}
                    </strong>
                    <span className="block truncate text-xs text-black/40">
                      {profile.fileName}
                    </span>
                  </span>
                  <span className="text-xs font-bold text-cyan-700">
                    {profile.available === false
                      ? "原文件缺失"
                      : voiceEnabled && selectedProfileId === profile.id
                        ? "使用中"
                        : "选择"}
                  </span>
                </button>
                <div className="border-t border-black/[0.05] px-3 py-2">
                  {profile.available === false ? (
                    <div className="rounded-lg bg-amber-50 p-3 text-xs font-bold leading-5 text-amber-800">
                      早期项目清理时原音频被误删，无法试听。请重新上传原始声音文件。
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceStyle("voxcpm2");
                          setSelectedProfileId("");
                          setProfileName(profile.name);
                        }}
                        className="mt-2 block w-full rounded-lg bg-white px-3 py-2 text-center text-amber-900"
                      >
                        重新上传声音
                      </button>
                    </div>
                  ) : (
                    <>
                      <p className="mb-1 text-[11px] font-bold text-black/40">
                        试听声音
                      </p>
                      <audio
                        controls
                        preload="none"
                        className="h-9 w-full"
                        src={`/api/voice-profiles/${profile.id}/audio`}
                        aria-label={`试听 ${profile.name}`}
                      >
                        <track kind="captions" />
                      </audio>
                    </>
                  )}
                  <button
                    type="button"
                    disabled={deletingProfileId === profile.id}
                    onClick={() => void deleteProfile(profile)}
                    className="mt-2 w-full rounded-lg bg-red-50 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-40"
                  >
                    {deletingProfileId === profile.id
                      ? "删除中…"
                      : "删除克隆音色"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
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
            setVoiceStyle("voxcpm2");
            setSelectedProfileId("");
          }}
          className={`rounded-lg px-3 py-2 text-xs font-black ${
            uploadingNew ? "bg-white shadow-sm" : "text-black/40"
          }`}
        >
          上传新声音
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
                  : "点击上传约 1 分钟清晰人声"}
              </strong>
              <span className="mt-1 block font-normal text-black/35">
                WAV、MP3、M4A 或 FLAC，3 秒至 10 分钟，最大 200MB
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
                    ? "（需要 3 秒至 10 分钟）"
                    : ""}
                </p>
              )}
            </div>
          )}

          <div className="rounded-xl bg-cyan-50 p-3 text-xs leading-5 text-cyan-900">
            创建项目时会把这段音频保存为角色声音。以后只需选择角色，不再重复上传。
          </div>

          <details className="rounded-xl border border-black/[0.06] p-3">
            <summary className="cursor-pointer text-xs font-bold">
              高级设置（通常不用修改）
            </summary>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-2 text-xs font-bold">
                参考音频原文（可选）
                <textarea
                  value={promptText}
                  onChange={(event) => setPromptText(event.target.value)}
                  maxLength={500}
                  placeholder="留空时自动识别"
                  className="min-h-20 rounded-xl bg-[#f1f4f5] p-3 text-sm font-normal outline-none"
                />
              </label>
              <label className="grid gap-2 text-xs font-bold">
                参考音频语言
                <select
                  value={promptLanguage}
                  onChange={(event) =>
                    setPromptLanguage(event.target.value as VoiceCloneLanguage)
                  }
                  className="rounded-xl bg-[#f1f4f5] p-3 text-sm"
                >
                  <option value="zh">中文</option>
                  <option value="yue">粤语</option>
                  <option value="en">英语</option>
                  <option value="ja">日语</option>
                  <option value="ko">韩语</option>
                </select>
              </label>
              <label className="grid gap-2 text-xs font-bold">
                VoxCPM2 本地服务
                <input
                  value={serviceUrl}
                  onChange={(event) => setServiceUrl(event.target.value)}
                  className="rounded-xl bg-[#f1f4f5] p-3 font-mono text-xs"
                />
              </label>
            </div>
          </details>

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
