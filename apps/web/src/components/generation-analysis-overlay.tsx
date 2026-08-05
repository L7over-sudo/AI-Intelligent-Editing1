"use client";

import { useEffect, useState } from "react";

export function GenerationAnalysisOverlay({ visible }: { visible: boolean }) {
  const [progress, setProgress] = useState(8);

  useEffect(() => {
    if (!visible) {
      setProgress(8);
      return;
    }

    const timer = window.setInterval(() => {
      setProgress((current) => {
        const remaining = 93 - current;
        return Math.min(93, current + Math.max(1, Math.ceil(remaining * 0.12)));
      });
    }, 420);
    return () => window.clearInterval(timer);
  }, [visible]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/55 px-5 backdrop-blur-[1px]">
      <section
        className="w-full max-w-64 rounded-2xl bg-[#242426] p-6 text-center text-white shadow-2xl"
        aria-live="polite"
        aria-label="正在分析文案"
      >
        <div className="relative mx-auto grid size-20 place-items-center">
          <span className="absolute size-16 animate-ping rounded-full bg-blue-500/10" />
          <span className="text-5xl drop-shadow-[0_0_16px_rgb(91_142_255)]">
            ✦
          </span>
        </div>
        <h2 className="mt-3 text-lg font-black">
          文案分析中… {progress}%
        </h2>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-4 text-xs leading-5 text-white/45">
          正在拆分旁白、字幕、画面提示和镜头节奏
        </p>
      </section>
    </div>
  );
}

