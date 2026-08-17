"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface AppDialogInput {
  label: string;
  value: string;
  placeholder?: string;
  maxLength?: number;
  error?: string;
  onChange: (value: string) => void;
}

export function AppDialog({
  open,
  title,
  description,
  confirmLabel = "确定",
  cancelLabel = "取消",
  tone = "default",
  busy = false,
  confirmDisabled = false,
  input,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  busy?: boolean;
  confirmDisabled?: boolean;
  input?: AppDialogInput;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  const hasInput = Boolean(input);
  onCancelRef.current = onCancel;

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      if (hasInput) {
        inputRef.current?.focus();
        inputRef.current?.select();
      } else {
        cancelRef.current?.focus();
      }
    });
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      event.preventDefault();
      onCancelRef.current();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [busy, hasInput, open]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) onConfirm();
        }}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-white/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <span
              className={`grid size-11 shrink-0 place-items-center rounded-2xl text-xl font-black ${
                tone === "danger"
                  ? "bg-red-50 text-red-600"
                  : "bg-blue-50 text-blue-600"
              }`}
              aria-hidden="true"
            >
              {tone === "danger" ? "!" : "✓"}
            </span>
            <div className="min-w-0 pt-0.5">
              <h2 id="app-dialog-title" className="text-lg font-black text-slate-900">
                {title}
              </h2>
              {description && (
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {description}
                </p>
              )}
            </div>
          </div>

          {input && (
            <label className="mt-5 block text-sm font-bold text-slate-700">
              {input.label}
              <input
                ref={inputRef}
                value={input.value}
                maxLength={input.maxLength}
                placeholder={input.placeholder}
                disabled={busy}
                onChange={(event) => input.onChange(event.target.value)}
                className={`mt-2 h-12 w-full rounded-xl border bg-slate-50 px-4 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-300 focus:bg-white focus:ring-2 ${
                  input.error
                    ? "border-red-300 focus:border-red-400 focus:ring-red-100"
                    : "border-slate-200 focus:border-cyan-400 focus:ring-cyan-100"
                }`}
              />
              {input.error && (
                <span className="mt-2 block text-xs font-bold text-red-600">
                  {input.error}
                </span>
              )}
            </label>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-100 bg-slate-50/80 px-6 py-4">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-black text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
          >
            {cancelLabel}
          </button>
          <button
            type="submit"
            disabled={busy || confirmDisabled}
            className={`rounded-xl px-5 py-2.5 text-sm font-black text-white shadow-sm transition disabled:cursor-wait disabled:opacity-50 ${
              tone === "danger"
                ? "bg-red-600 hover:bg-red-700"
                : "bg-[#2563eb] hover:bg-[#1d4ed8]"
            }`}
          >
            {busy ? "处理中…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
