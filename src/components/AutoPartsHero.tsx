import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function AutoPartsHero({
  icon: Icon,
  eyebrow,
  title,
  description,
  actions,
  stats = [],
}: {
  icon: LucideIcon;
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
  stats?: Array<{ label: string; value: string | number }>;
}) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-slate-700/70 bg-[radial-gradient(circle_at_top_left,_#1e3a5f_0,_#0f172a_42%,_#020617_100%)] p-5 text-white shadow-xl shadow-slate-950/10 md:p-7" dir="rtl">
      <div className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full border-[26px] border-cyan-400/10" />
      <div className="pointer-events-none absolute bottom-[-70px] right-[38%] h-44 w-44 rounded-full border-[18px] border-amber-400/10" />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
        <div className="max-w-2xl">
          {eyebrow && (
            <div className="mb-3 flex items-center gap-2 text-[11px] font-bold tracking-[0.2em] text-cyan-300" dir="ltr">
              <Icon className="h-4 w-4" /> {eyebrow}
            </div>
          )}
          <h1 className="text-2xl font-black tracking-tight text-white md:text-3xl">{title}</h1>
          <p className="mt-2 text-sm leading-7 text-slate-300">{description}</p>
        </div>
        <div className="flex shrink-0 flex-col items-start gap-3 xl:items-end">
          {stats.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {stats.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/10 bg-white/[0.06] px-4 py-2 text-center backdrop-blur-sm min-w-[90px]">
                  <div className="text-lg font-black text-white">{stat.value}</div>
                  <div className="text-[10px] font-semibold text-slate-400">{stat.label}</div>
                </div>
              ))}
            </div>
          ) : null}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      </div>
    </section>
  );
}
