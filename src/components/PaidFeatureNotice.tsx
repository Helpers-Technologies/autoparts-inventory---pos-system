import { Lock } from "lucide-react";
import { featureEntitlementMessage, type FeatureKey } from "../lib/features";

interface Props {
  title?: string;
  description?: string;
  /** When given, the notice auto-recommends the package tier that includes
   * this feature (e.g. "متاحة ضمن الباقة الاحترافية") instead of the generic
   * "contact sales" copy — `description` still overrides this if both are given. */
  featureKey?: FeatureKey;
}

export function PaidFeatureNotice({ title, description, featureKey }: Props) {
  const tierMessage = featureKey ? featureEntitlementMessage(featureKey).replace(/^"[^"]+" /, "") : undefined;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3.5 dark:border-amber-500/40 dark:bg-amber-500/15">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/25 dark:text-amber-200">
        <Lock className="h-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold text-amber-900 dark:text-amber-100">
          ميزة غير مفعّلة في الباقة الحالية{title ? ` (${title})` : ""}
        </div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200">
          {description ?? tierMessage ?? "تواصل مع الدعم الفني أو المبيعات لترقية باقة ترخيص النظام وتفعيل هذه الميزة."}
        </div>
      </div>
    </div>
  );
}
