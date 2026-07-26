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

/**
 * Compact "no results" hint for search dropdowns/lists (GlobalSearch,
 * SearchableSelect, SearchableProductSelect) — those three each had their own
 * slightly different markup for the same state; this is the one shared shape.
 */
export function NoResultsHint({
  icon,
  message,
  className,
}: {
  icon?: ReactNode;
  message: string;
  className?: string;
}) {
  return (
    <div className={cn("py-8 text-center text-sm text-ink-faint", className)}>
      {icon ? <div className="mb-2 flex justify-center">{icon}</div> : null}
      {message}
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
