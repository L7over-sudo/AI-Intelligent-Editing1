"use client";

import { useRef, useState } from "react";

export interface VoiceProfileSummary {
  id: string;
  name: string;
  assetId: string;
  fileName: string;
  createdAt: string;
  provider?: string;
  speaker?: string;
  builtin?: boolean;
  available?: boolean;
}

export function VoiceProfileDropdown({
  title,
  hint,
  profiles,
  selectedProfileId,
  placeholder,
  onSelect,
  compact = false,
}: {
  title: string;
  hint?: string;
  profiles: VoiceProfileSummary[];
  selectedProfileId: string;
  placeholder: string;
  onSelect: (profileId: string) => void;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = profiles.find((profile) => profile.id === selectedProfileId);

  return (
    <section className={compact ? "relative" : "mt-4"}>
      {!compact && <h3 className="text-sm font-black">{title}</h3>}
      {!compact && hint && (
        <p className="mt-1 text-xs leading-5 text-black/45">{hint}</p>
      )}
      <div className={compact ? "relative" : "relative mt-2"}>
        <button
          type="button"
          aria-label={title}
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          className={`flex items-center justify-between gap-2 rounded-xl border text-left transition ${
            compact
              ? "min-w-[150px] max-w-[185px] border-[#7c3aed] bg-[#7c3aed] px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#6d28d9]"
              : "w-full px-3 py-2.5"
          } ${
            open
              ? compact
                ? "border-[#6d28d9] bg-[#6d28d9]"
                : "border-cyan-400 bg-cyan-50"
              : compact
                ? "border-[#7c3aed] bg-[#7c3aed] hover:bg-[#6d28d9]"
                : "border-black/10 bg-white hover:border-cyan-400"
          }`}
        >
          <span className="min-w-0">
            <strong
              className={`block ${compact ? "max-w-[155px] whitespace-normal break-words text-sm leading-5" : "truncate text-sm"}`}
            >
              {selected?.name ?? placeholder}
            </strong>
            {!compact && (
              <span className="block truncate text-xs text-black/40">
                {selected ? selected.fileName : `${profiles.length} 个可选`}
              </span>
            )}
          </span>
          <span
            className={`shrink-0 text-[10px] font-black ${
              compact ? "text-white/80" : "text-black/40"
            }`}
          >
            {open ? "▲" : "▼"}
          </span>
        </button>
        {open && (
          <>
            <button
              type="button"
              aria-label="关闭音色列表"
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-20 cursor-default"
            />
            <div
              className={`absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-black/10 bg-white shadow-lg ${
                compact ? "min-w-[190px]" : ""
              }`}
            >
              {profiles.map((profile) => (
                <VoiceDropdownRow
                  key={profile.id}
                  profile={profile}
                  selected={selectedProfileId === profile.id}
                  compact={compact}
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
          </>
        )}
      </div>
    </section>
  );
}

function VoiceDropdownRow({
  profile,
  selected,
  compact,
  onSelect,
}: {
  profile: VoiceProfileSummary;
  selected: boolean;
  compact: boolean;
  onSelect: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  function togglePlay() {
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
      className={`flex items-center gap-2 border-b border-black/[0.05] last:border-b-0 ${
        selected ? "bg-cyan-50" : "bg-white"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="min-w-0 flex-1 px-3 py-2.5 text-left"
      >
        <span className="flex items-center gap-2">
          <strong className="break-words text-sm leading-4">
            {profile.name}
          </strong>
          {selected && (
            <span className="shrink-0 rounded bg-cyan-100 px-1.5 py-0.5 text-[10px] font-black text-cyan-700">
              使用中
            </span>
          )}
        </span>
        {!compact && (
          <span className="block truncate text-xs text-black/40">
            {profile.fileName}
          </span>
        )}
      </button>
      <button
        type="button"
        aria-label={`试听 ${profile.name}`}
        onClick={togglePlay}
        className="mr-2 grid size-8 shrink-0 place-items-center rounded-full bg-black/[0.04] text-xs text-black/60 transition hover:bg-black/[0.08]"
      >
        {playing ? "⏸" : "♪"}
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
