import { useState, type FormEvent } from "react";
import { ArrowLeft, Copy, Globe } from "lucide-react";
import { useAuth } from "../store/AuthContext";
import { Button } from "../components/ui/Button";
import { Input, Textarea } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import type { ActivationState } from "../types";
// Porsche GT3 — Unsplash (free for commercial use, no attribution required); bundled locally so the app stays offline.
import gt3Image from "../assets/porsche-gt3.jpg";

const statusText: Record<ActivationState, string> = {
  inactive: "غير مفعل",
  expired: "انتهى الاشتراك",
  machine_mismatch: "الرخصة غير مخصصة لهذا الجهاز",
  clock_tampered: "تم اكتشاف تغيير غير آمن في تاريخ الجهاز",
  active: "مفعل",
};

/**
 * Per-state accent for the ambient glow behind the car, so the license state
 * still reads at a glance. cyan = awaiting a serial, amber = renew / wrong
 * device, rose = tamper, emerald = active.
 */
type Tone = { rgb: string };
const TONES: Record<ActivationState, Tone> = {
  inactive: { rgb: "34,211,238" },
  expired: { rgb: "251,191,36" },
  machine_mismatch: { rgb: "251,191,36" },
  clock_tampered: { rgb: "251,113,133" },
  active: { rgb: "52,211,153" },
};

export function ActivationPage() {
  const { licenseStatus, activateLicense } = useAuth();
  const toast = useToast();
  const [serial, setSerial] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!serial.trim()) return;
    setSubmitting(true);
    const result = await activateLicense(serial.trim());
    setSubmitting(false);
    if (result.ok) {
      toast.success("تم التفعيل", "تم ربط النسخة بهذا الجهاز بنجاح");
    } else {
      toast.error("فشل التفعيل", statusText[result.status.state] || "السيريال غير صالح");
    }
  }

  async function copyMachineCode() {
    if (!licenseStatus?.machineCode) return;
    await navigator.clipboard.writeText(licenseStatus.machineCode);
    toast.success("تم نسخ كود الجهاز");
  }

  if (!licenseStatus) {
    return (
      <div className="grid min-h-[100dvh] place-items-center bg-[#040b14] text-white" dir="rtl">
        <ActivationStyles />
        <div className="flex flex-col items-center gap-4">
          <div className="apw-boot-ring h-14 w-14 rounded-full border-2 border-cyan-400/25 border-t-cyan-300" />
          <div className="text-sm font-medium text-slate-400">جاري فحص حالة الترخيص…</div>
        </div>
      </div>
    );
  }

  const state = licenseStatus.state;
  const tone = TONES[state] ?? TONES.inactive;

  const activationWhatsappUrl = `https://wa.me/201118445625?text=${encodeURIComponent(
    "طلب تفعيل / تجديد نسخة — AutoParts Inventory & Sales System\n" +
      "الحالة: " + (statusText[state] || "—") + "\n" +
      "كود الجهاز: " + (licenseStatus.machineCode || "غير متاح")
  )}`;

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#040b14] text-white" dir="rtl">
      <ActivationStyles />

      {/* Full-bleed GT3 background — framed so the car sits clear on the right */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute inset-0" style={{ transform: "scale(1.3) translateX(22%)" }}>
          <img
            src={gt3Image}
            alt="Porsche GT3"
            draggable={false}
            className="apw-fade h-full w-full select-none object-cover [object-position:50%_46%]"
          />
        </div>
      </div>
      {/* Cinematic scrims — darken the console side (left), keep the car bright on the right */}
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,#040b14_0%,rgba(4,11,20,.9)_20%,rgba(4,11,20,.32)_40%,transparent_62%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(0deg,rgba(4,11,20,.55)_0%,transparent_13%,transparent_88%,rgba(4,11,20,.5)_100%)]" />
      <div
        className="pointer-events-none absolute -left-40 top-1/3 h-[560px] w-[560px] rounded-full blur-[150px]"
        style={{ background: `rgba(${tone.rgb},0.1)` }}
      />
      <div className="pointer-events-none absolute inset-0 opacity-[0.02] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:52px_52px]" />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-[1500px] flex-col px-5 md:px-8 xl:px-12">
        {/* Top bar */}
        <header className="flex shrink-0 items-center py-5">
          <div className="flex items-center gap-3">
            <img src="./helpers_tech_logo.png" alt="Helpers Technologies" className="h-10 w-10 object-contain drop-shadow-[0_2px_6px_rgba(0,0,0,.5)]" />
            <div>
              <div className="text-sm font-bold leading-tight text-white">AutoParts Inventory & Sales</div>
              <div className="text-[11px] font-medium text-slate-300">شركة هيلبيرز تيكنولوجي · Helpers Technologies</div>
            </div>
          </div>
        </header>

        {/* Stage: console card on the LEFT, GT3 background fills the RIGHT */}
        <div className="grid min-h-0 flex-1 items-center py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
          <div className="hidden lg:block" aria-hidden="true" />
          <section className="apw-rise w-full">
            <form
              onSubmit={onSubmit}
              className="rounded-[26px] border border-white/10 bg-[#07111f]/85 p-6 shadow-[0_36px_100px_rgba(0,0,0,.55)] backdrop-blur-2xl md:p-7"
            >
              <h1 className="text-[26px] font-black leading-tight tracking-[-0.03em] text-white">
                {statusText[state]}
              </h1>
              <p className="mt-2 text-[13px] leading-6 text-slate-400">
                فعّل النظام في خطوتين: انسخ كود هذا الجهاز وأرسله لنا، ثم الصق السيريال الموقّع لتشغيل المحل.
              </p>

              {/* Step 01 — machine code */}
              <div className="mt-6 space-y-3">
                <StepHead n="01" title="كود الجهاز" hint="أرسله للمطوّر لإصدار سيريال مخصّص لهذا الجهاز." />
                <div className="flex gap-2">
                  <Input
                    value={licenseStatus.machineCode}
                    readOnly
                    dir="ltr"
                    className="h-11 flex-1 rounded-xl !border-white/10 !bg-white/[0.05] text-left font-mono !text-[13px] !text-slate-100 shadow-inner shadow-black/20"
                  />
                  <Button
                    type="button"
                    onClick={copyMachineCode}
                    className="h-11 w-11 shrink-0 rounded-xl border border-white/10 bg-white/[0.05] p-0 text-slate-200 hover:bg-white/[0.1]"
                    title="نسخ كود الجهاز"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Step 02 — serial */}
              <div className="mt-5 space-y-3">
                <StepHead n="02" title="السيريال" hint="الصق الكود الذي يبدأ بـ APLIC." />
                <Textarea
                  rows={3}
                  value={serial}
                  onChange={(e) => setSerial(e.target.value)}
                  placeholder="APLIC…"
                  dir="ltr"
                  className="rounded-xl !border-white/10 !bg-white/[0.05] text-left font-mono !text-[13px] !text-slate-100 shadow-inner shadow-black/20 placeholder:!text-slate-600 focus:!border-cyan-400/50"
                />
              </div>

              <Button
                type="submit"
                size="lg"
                disabled={submitting}
                className="mt-6 h-12 w-full rounded-xl bg-gradient-to-l from-cyan-400 to-blue-500 font-black text-slate-950 shadow-[0_16px_40px_rgba(34,211,238,.25)] transition-transform hover:brightness-110 active:scale-[.99]"
              >
                {submitting ? (
                  <>جاري التفعيل…</>
                ) : (
                  <>
                    <span>تفعيل النسخة</span>
                    <ArrowLeft className="h-4 w-4" />
                  </>
                )}
              </Button>

              <a
                href={activationWhatsappUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-[13px] font-bold text-white shadow-[0_10px_26px_rgba(16,185,129,.2)] transition-colors hover:bg-emerald-500"
              >
                <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                ماعندكش سيريال؟ تواصل مع المطوّر على واتساب
              </a>
            </form>
          </section>
        </div>

        {/* Footer */}
        <footer className="flex shrink-0 flex-col items-center justify-between gap-2 border-t border-white/[0.07] py-4 text-[12px] text-slate-500 sm:flex-row">
          <span>تطوير وتصميم Helpers Technologies © 2026</span>
          <div className="flex items-center gap-3">
            <a
              href="https://wa.me/201118445625"
              target="_blank"
              rel="noreferrer"
              dir="ltr"
              className="flex items-center gap-1.5 transition-colors hover:text-emerald-400"
            >
              01118445625
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-current">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </a>
            <span>·</span>
            <a
              href="https://helpers-tech.com/"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 transition-colors hover:text-cyan-300"
            >
              <Globe className="h-3.5 w-3.5" />
              helpers-tech.com
            </a>
          </div>
        </footer>
      </div>
    </main>
  );
}

function StepHead({ n, title, hint }: { n: string; title: string; hint: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-cyan-300/25 bg-cyan-300/[0.08] font-mono text-[11px] font-bold text-cyan-300">
        {n}
      </span>
      <div>
        <div className="text-[13px] font-bold text-slate-100">{title}</div>
        <div className="text-[11px] leading-4 text-slate-500">{hint}</div>
      </div>
    </div>
  );
}

/** Scoped keyframes for the shell — respects prefers-reduced-motion. */
function ActivationStyles() {
  return (
    <style>{`
      @keyframes apw-spin { to { transform: rotate(360deg); } }
      @keyframes apw-rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes apw-fade { from { opacity: 0; transform: scale(1.06); } to { opacity: 1; transform: scale(1); } }

      .apw-rise { animation: apw-rise .7s cubic-bezier(.22,1,.36,1) both; }
      .apw-fade { animation: apw-fade 1.2s cubic-bezier(.22,1,.36,1) both; }
      .apw-boot-ring { animation: apw-spin .9s linear infinite; }

      @media (prefers-reduced-motion: reduce) {
        .apw-boot-ring { animation: none !important; }
        .apw-rise, .apw-fade { animation: none !important; opacity: 1; transform: none; }
      }
    `}</style>
  );
}
