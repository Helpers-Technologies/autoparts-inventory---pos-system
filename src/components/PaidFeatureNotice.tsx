import { Lock } from "lucide-react";

interface Props {
  title?: string;
  description?: string;
}

export function PaidFeatureNotice({ title, description }: Props) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
        <Lock className="h-4 h-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-xs font-bold text-amber-900 dark:text-amber-200">
          ميزة غير مفعّلة في الباقة الحالية{title ? ` (${title})` : ""}
        </div>
        <div className="mt-0.5 text-[11px] text-amber-800/80 dark:text-amber-300/80">
          {description ?? "تواصل مع الدعم الفني أو المبيعات لترقية باقة ترخيص النظام وتفعيل هذه الميزة."}
        </div>
      </div>
    </div>
  );
}
