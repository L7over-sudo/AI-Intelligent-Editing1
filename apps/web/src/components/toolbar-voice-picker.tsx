"use client";

import { useRef, useState } from "react";

import type { VoiceProfileSummary } from "./voice-profile-dropdown";

export function ToolbarVoicePicker({
  profiles,
  selectedProfileId,
  loading,
  onSelect,
}: {
  profiles: VoiceProfileSummary[];
  selectedProfileId: string;
  loading: boolean;
  onSelect: (profileId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = profiles.find((profile) => profile.id === selectedProfileId);
  const displayName =
    selected?.name ?? (profiles.length ? "选择音色" : "暂无音色");

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="当前项目音色"
        aria-expanded={open}
        disabled={loading || profiles.length === 0}
        onClick={() => setOpen((current) => !current)}
        className={`relative flex h-[42px] w-[180px] items-center justify-center rounded-xl border px-4 py-2 text-sm font-bold transition ${
          open
            ? "border-[#4c3377] bg-[#5b3f8b] text-white"
            : "border-[#5b3f8b] bg-[#6d4aa8] text-white hover:border-[#4c3377] hover:bg-[#5b3f8b]"
        } disabled:cursor-not-allowed disabled:border-black/10 disabled:bg-black/[0.03] disabled:text-black/35`}
      >
        <span
          className="block max-w-[145px] truncate text-center text-sm font-bold"
          title={displayName}
        >
          {displayName}
        </span>
        <span className="absolute right-3 text-xs font-black text-white/85">
          {open ? "⌃" : "⌄"}
        </span>
      </button>

      {open && (
        <>
          <button
            type="button"
            aria-label="关闭音色列表"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-30 cursor-default"
          />
          <div className="absolute right-0 top-full z-40 mt-2 w-[240px] overflow-hidden rounded-2xl border border-[#d4bcec] bg-white shadow-lg shadow-[#7655a0]/10">
            <div className="border-b border-[#d9c8ef] bg-[#e7dcf7] px-4 py-3">
              <strong className="block text-sm font-black text-[#514469]">
                选择音色
              </strong>
              <span className="mt-1 block text-[11px] text-[#806e98]">
                选择后自动保存到当前项目
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto p-2">
              {profiles.map((profile) => (
                <ToolbarVoiceOption
                  key={profile.id}
                  profile={profile}
                  selected={profile.id === selectedProfileId}
                  onSelect={() => {
                    onSelect(profile.id);
                    setOpen(false);
                  }}
                />
              ))}
              {profiles.length === 0 && (
                <p className="px-3 py-3 text-xs text-black/40">暂无音色</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ToolbarVoiceOption({
  profile,
  selected,
  onSelect,
}: {
  profile: VoiceProfileSummary;
  selected: boolean;
  onSelect: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  function togglePreview() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      void audio.play();
    }
  }

  return (
    <div
      className={`flex items-center gap-2 rounded-xl p-2 transition ${
        selected ? "bg-[#eee6fb]" : "hover:bg-[#f5f0fc]"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 text-left"
      >
        <span className="flex items-start gap-2">
          <span
            className={`mt-1.5 size-2 shrink-0 rounded-full ${
              selected ? "bg-[#9a82bd]" : "bg-black/15"
            }`}
          />
          <span className="break-words text-sm font-bold leading-5 text-black/75">
            {profile.name}
          </span>
        </span>
        {selected && (
          <span className="ml-4 mt-0.5 block text-[11px] font-bold text-[#8066a3]">
            使用中
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`试听${profile.name}`}
        onClick={togglePreview}
        className="shrink-0 rounded-lg bg-[#e8defb] px-2 py-1 text-[11px] font-bold text-[#8066a3] transition hover:bg-[#dfd0f2]"
      >
        {playing ? "暂停" : "试听"}
      </button>
      <audio
        ref={audioRef}
        src={`/api/voice-profiles/${profile.id}/audio`}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </div>
  );
}
