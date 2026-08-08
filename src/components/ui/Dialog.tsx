import type { ReactNode } from "react";
import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./Button";

export function Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: "sm" | "md" | "lg" | "xl" | "2xl";
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const widthClass =
    width === "sm"
      ? "max-w-sm"
      : width === "md"
      ? "max-w-md"
      : width === "lg"
      ? "max-w-2xl"
      : width === "xl"
      ? "max-w-3xl"
      : "max-w-5xl";

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-slate-950/50 transition-opacity animate-fadeIn"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        className={cn(
          "relative w-full bg-surface rounded-2xl shadow-xl border border-line animate-fadeIn flex flex-col max-h-[90vh]",
          widthClass
        )}
      >
        {title || subtitle ? (
          <div className="flex items-start justify-between gap-4 p-4 border-b border-line">
            <div className="min-w-0 flex-1">
              {title ? (
                <div id={titleId} className="font-semibold text-ink">{title}</div>
              ) : null}
              {subtitle ? (
                <div className="text-xs text-ink-muted mt-0.5">{subtitle}</div>
              ) : null}
            </div>
            <Button size="icon" variant="ghost" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        ) : null}
        <div className="p-4 overflow-y-auto">{children}</div>
        {footer ? (
          <div className="p-4 border-t border-line flex items-center justify-end gap-2">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title = "تأكيد",
  message,
  confirmText = "تأكيد",
  cancelText = "إلغاء",
  variant = "primary",
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title?: string;
  message: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "primary" | "danger";
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      width="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {cancelText}
          </Button>
          <Button
            variant={variant === "danger" ? "danger" : "primary"}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="text-sm text-ink-muted">{message}</div>
    </Dialog>
  );
}
