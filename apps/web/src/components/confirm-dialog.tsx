import type { ReactNode } from "react";

import { AppDialog } from "./app-dialog";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmText = "确认",
  tone = "danger",
  busy = false,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmText?: string;
  tone?: "danger" | "default";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AppDialog
      open={open}
      title={title}
      description={description}
      confirmLabel={confirmText}
      tone={tone}
      busy={busy}
      onConfirm={onConfirm}
      onCancel={onClose}
    />
  );
}
