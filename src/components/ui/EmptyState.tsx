import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center py-12 px-6",
        className
      )}
    >
      {icon ? (
        <div className="w-12 h-12 rounded-full bg-surface-muted text-ink-muted grid place-items-center mb-3">
          {icon}
        </div>
      ) : null}
      <div className="text-ink font-medium">{title}</div>
      {description ? (
        <div className="text-sm text-ink-muted mt-1 max-w-md">{description}</div>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({
  className,
  rounded = "md",
}: {
  className?: string;
  rounded?: "sm" | "md" | "lg" | "full";
}) {
  const r =
    rounded === "full"
      ? "rounded-full"
      : rounded === "sm"
      ? "rounded"
      : rounded === "lg"
      ? "rounded-xl"
      : "rounded-md";
  return (
    <div
      className={cn("animate-pulse bg-line", r, className)}
    />
  );
}
