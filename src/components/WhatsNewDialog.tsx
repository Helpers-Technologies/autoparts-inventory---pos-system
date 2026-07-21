import { Sparkles, Wrench, TrendingUp, Star } from "lucide-react";
import { Dialog } from "./ui/Dialog";
import { Badge } from "./ui/Badge";
import { Button } from "./ui/Button";
import type { Release, ReleaseTone } from "../lib/whatsNew";

const TONE_META: Record<ReleaseTone, { label: string; badge: "blue" | "green" | "amber"; icon: typeof Sparkles }> = {
  feature: { label: "جديد", badge: "blue", icon: Sparkles },
  fix: { label: "إصلاح", badge: "green", icon: Wrench },
  improvement: { label: "تحسين", badge: "amber", icon: TrendingUp },
};

/**
 * Post-update "What's New" modal. Lists the highlights of every release the
 * user hasn't acknowledged yet (newest first). Purely presentational — the
 * decision to show it and the "mark as seen" write live in AppLayout.
 */
export function WhatsNewDialog({
  open,
  onClose,
  releases,
  currentVersion,
}: {
  open: boolean;
  onClose: () => void;
  releases: Release[];
  currentVersion: string;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={
        <span className="flex items-center gap-2">
          <Star className="w-4 h-4 text-brand-600" />
          ما الجديد في الإصدار v{currentVersion}؟
        </span>
      }
      subtitle="أهم التحديثات والمميزات اللي وصلتك منذ آخر مرة فتحت فيها النظام"
      footer={
        <Button variant="primary" onClick={onClose}>
          تمام، فهمت
        </Button>
      }
    >
      <div className="space-y-6">
        {releases.map((release) => (
          <div key={release.version}>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-sm font-bold text-ink">الإصدار v{release.version}</span>
              <span className="text-xs text-ink-faint">{release.date}</span>
            </div>
            <ul className="space-y-2.5">
              {release.highlights.map((h, i) => {
                const meta = TONE_META[h.tone];
                const Icon = meta.icon;
                return (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-xl border border-line-soft bg-surface-muted/60 p-3"
                  >
                    <span className="mt-0.5 grid place-items-center w-8 h-8 shrink-0 rounded-lg bg-surface border border-line text-brand-600">
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-ink">{h.title}</span>
                        <Badge tone={meta.badge}>{meta.label}</Badge>
                      </div>
                      <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{h.description}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </Dialog>
  );
}
