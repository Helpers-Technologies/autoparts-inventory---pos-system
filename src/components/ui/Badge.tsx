import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

type Tone =
  | "slate"
  | "blue"
  | "green"
  | "amber"
  | "orange"
  | "red"
  | "indigo"
  | "emerald"
  | "rose";

const tones: Record<Tone, string> = {
  slate: "bg-surface-muted text-ink-muted border-line",
  blue: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-500/30 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
  green: "bg-green-50 dark:bg-green-500/10 text-green-700 border-green-200 dark:border-green-500/30 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
  amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  orange: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-500/15 dark:text-orange-300 dark:border-orange-500/30",
  red: "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400 border-red-200 dark:border-red-500/30 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
  indigo: "bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 border-indigo-200 dark:border-indigo-500/30 dark:bg-indigo-500/15 dark:text-indigo-300 dark:border-indigo-500/30",
  emerald: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
  rose: "bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-500/30 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
};

export function Badge({
  tone = "slate",
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone; children?: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border whitespace-nowrap",
        tones[tone],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
