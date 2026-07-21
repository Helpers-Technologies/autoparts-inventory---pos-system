import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CarFront,
  CheckCircle2,
  Eye,
  EyeOff,
  KeyRound,
  MessageCircle,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { useAuth } from "../store/AuthContext";
import { Button } from "../components/ui/Button";
import { Field, Input } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import type { LoginResult } from "../types";
import sportHeroBackground from "../assets/autoparts-sport-hero-v1.png";

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportCode, setSupportCode] = useState("");
  const [supportUsername, setSupportUsername] = useState("");
  const [supportPassword, setSupportPassword] = useState("");
  const [supportSubmitting, setSupportSubmitting] = useState(false);
  const [supportCodeRequesting, setSupportCodeRequesting] = useState(false);
  const [machineCode, setMachineCode] = useState("");
  const [lockRemaining, setLockRemaining] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const submitInFlight = useRef(false);

  useEffect(() => {
    if (lockRemaining <= 0) return;
    const timer = window.setInterval(() => {
      setLockRemaining((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [lockRemaining]);

  useEffect(() => {
    if (!supportOpen || !window.desktopAPI?.license || machineCode) return;
    void window.desktopAPI.license.getMachineCode().then(setMachineCode).catch(() => {
      setMachineCode("");
    });
  }, [supportOpen, machineCode]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitInFlight.current) return;
    if (!username.trim()) return;
    if (lockRemaining > 0) {
      toast.error("الحساب مقفول مؤقتاً", `حاول مرة أخرى بعد ${lockRemaining} ثانية`);
      return;
    }
    submitInFlight.current = true;
    setSubmitting(true);

    let result: LoginResult = { ok: false, error: "invalid_credentials" };
    try {
      result = await login(username.trim(), password);
    } catch {
      // ignore
    }

    if (result.ok) {
      toast.success("تم تسجيل الدخول", "مرحباً بك في النظام");
      navigate("/", { replace: true });
      return;
    }

    if (result.error === "rate_limited") {
      const seconds = result.remainSeconds ?? 60;
      setLockRemaining(seconds);
      toast.error("تم قفل الحساب مؤقتاً", `محاولات فاشلة كثيرة. حاول مرة أخرى بعد ${seconds} ثانية.`);
    } else {
      const attemptsText =
        result.attemptsRemaining !== undefined
          ? `المتبقي قبل القفل: ${result.attemptsRemaining} محاولات.`
          : "بعد 5 محاولات فاشلة سيتم قفل الحساب لمدة دقيقة.";
      toast.error("فشل تسجيل الدخول", `اسم الدخول أو كلمة المرور غير صحيحة. ${attemptsText}`);
    }
    submitInFlight.current = false;
    setSubmitting(false);
  }

  async function resetOwnerPassword() {
    if (!window.desktopAPI?.auth) return;
    if (!supportCode.trim() || !supportPassword || !supportUsername.trim()) {
      toast.error("بيانات ناقصة", "أدخل كود الدعم وبيانات المدير الجديدة");
      return;
    }
    setSupportSubmitting(true);
    const cleanSupportCode = supportCode.replace(/\s+/g, "").trim();
    const result = await window.desktopAPI.auth.resetOwnerPassword(
      cleanSupportCode,
      supportUsername.trim(),
      supportPassword
    );
    setSupportSubmitting(false);
    if (result.ok) {
      toast.success("تم تحديث بيانات المدير");
      setSupportOpen(false);
      setSupportCode("");
      setSupportUsername("");
      setSupportPassword("");
    } else {
      const messages: Record<NonNullable<typeof result.error>, string> = {
        invalid_support_code: "الكود غير صحيح أو تم توليده بمفتاح مختلف. أعد تشغيل التطبيق لو تم تحديث المفتاح العام.",
        machine_mismatch: "الكود صادر لجهاز مختلف. استخدم كود الجهاز الظاهر في هذه الشاشة.",
        support_code_expired: "كود الدعم منتهي الصلاحية. ولّد كود دعم جديد.",
        owner_missing: "لا يوجد مدير مسجل على هذا الجهاز.",
        invalid_input: "اسم المدير وكلمة المرور الجديدة مطلوبان.",
        rate_limited: `محاولات كثيرة غير صحيحة. حاول مرة أخرى بعد ${result.remainSeconds ?? 600} ثانية.`,
      };
      toast.error("فشل كود الدعم", messages[result.error ?? "invalid_support_code"]);
    }
  }

  async function requestSupportCode() {
    setSupportCodeRequesting(true);
    let currentMachineCode = machineCode || "غير متاح";
    try {
      if (window.desktopAPI?.license) {
        currentMachineCode = await window.desktopAPI.license.getMachineCode();
        setMachineCode(currentMachineCode);
      }
      if (navigator.clipboard && currentMachineCode !== "غير متاح") {
        await navigator.clipboard.writeText(currentMachineCode);
        toast.success("تم نسخ كود الجهاز", "أرسله للدعم للحصول على كود الاستعادة");
      }
    } catch {
      // The WhatsApp message below still gives support enough context.
    } finally {
      setSupportCodeRequesting(false);
    }

    const message = encodeURIComponent(
      `مرحباً، نسيت كود الدعم الخاص باستعادة دخول المدير.\nكود الجهاز: ${currentMachineCode}\nاسم الدخول الحالي: ${username.trim() || "غير محدد"}`
    );
    window.open(`https://wa.me/201118445625?text=${message}`, "_blank", "noopener,noreferrer");
  }

  const darkInputClass =
    "h-12 rounded-xl !border-white/10 !bg-white/[0.06] !text-white placeholder:!text-slate-500 pr-11 text-base shadow-inner shadow-black/10 transition focus:!border-cyan-400/60 focus:!ring-cyan-400/15";

  return (
    <main className="relative h-[100dvh] overflow-hidden bg-[#040b14] text-white" dir="rtl">
      <div
        className="pointer-events-none absolute inset-0 bg-cover [background-position:24%_center]"
        style={{ backgroundImage: `url(${sportHeroBackground})` }}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,15,.38)_0%,rgba(2,8,15,.58)_44%,rgba(2,8,15,.91)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(0deg,rgba(2,8,15,.9)_0%,rgba(2,8,15,.08)_48%,rgba(2,8,15,.58)_100%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.025] [background-image:linear-gradient(rgba(255,255,255,.6)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.6)_1px,transparent_1px)] [background-size:56px_56px]" />
      <div className="pointer-events-none absolute -right-40 top-1/3 h-[520px] w-[520px] rounded-full bg-cyan-500/[0.07] blur-[140px]" />

      <div className="relative mx-auto flex h-full w-full max-w-[1600px] flex-col px-5 md:px-8 xl:px-12">
        <div className="grid min-h-0 flex-1 items-center gap-10 py-4 lg:grid-cols-[minmax(0,1fr)_420px] xl:gap-20 2xl:gap-28">
          <section className="hidden lg:block">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] px-3.5 py-2 text-[11px] font-bold text-cyan-300 backdrop-blur-xl">
              <CarFront className="h-4 w-4" />
              نظام تشغيل متخصص لمحلات قطع الغيار
            </div>

            <h1 className="mt-6 whitespace-nowrap text-[clamp(2.7rem,3.6vw,4rem)] font-black leading-none tracking-[-0.06em] drop-shadow-[0_14px_30px_rgba(0,0,0,.42)]">
              <span className="inline-block -skew-x-6 italic">
                القطعة الصح،
                <span className="bg-gradient-to-l from-cyan-300 to-sky-500 bg-clip-text text-transparent"> للعربية الصح</span>
              </span>
            </h1>

            <p className="mt-5 max-w-[660px] text-[15px] leading-8 text-slate-300/80 xl:text-base">
              اعثر على القطعة المتوافقة من رقم الشاسيه أو مرجع OEM، وتابع المبيعات (POS) والسعر والرصيد ومكان التخزين من شاشة واحدة واضحة.
            </p>

            <div className="mt-8 flex max-w-[700px] flex-wrap gap-2.5">
              {[
                "توافق السيارة والمحرك",
                "بحث برقم القطعة أو OEM",
                "فروع وضمان وتسعير",
              ].map((feature) => (
                <div key={feature} className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/35 px-3.5 py-2.5 text-xs font-bold text-slate-300 backdrop-blur-xl">
                  <CheckCircle2 className="h-4 w-4 text-cyan-400" />
                  {feature}
                </div>
              ))}
            </div>
          </section>

          <section className="mx-auto w-full max-w-[420px]">
            <form
              onSubmit={onSubmit}
              className="rounded-[24px] border border-white/10 bg-[#07111f]/80 p-6 shadow-[0_32px_90px_rgba(0,0,0,.5)] backdrop-blur-2xl md:p-7 [&_label]:!text-slate-300"
            >
              <div className="mb-6">
                <h2 className="text-[28px] font-black tracking-[-0.035em] text-white">تسجيل الدخول</h2>
                <p className="mt-2 text-[13px] leading-6 text-slate-400">سجّل الدخول للوصول إلى الكاشير والكتالوج ومخزون الفروع.</p>
              </div>

              <div className="space-y-4">
                <Field label="اسم الدخول" required>
                  <div className="relative">
                    <UserRound className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Login username"
                      autoComplete="username"
                      className={darkInputClass}
                    />
                  </div>
                </Field>

                <Field label="كلمة المرور" required>
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <Input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      type={showPassword ? "text" : "password"}
                      autoComplete="current-password"
                      className={`${darkInputClass} pl-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((value) => !value)}
                      className="absolute left-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-500 transition-colors hover:bg-white/[0.07] hover:text-white"
                      tabIndex={-1}
                      aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>
              </div>

              <Button
                type="submit"
                size="lg"
                className="mt-6 h-12 w-full rounded-xl bg-cyan-400 font-black text-slate-950 shadow-[0_14px_35px_rgba(34,211,238,.18)] hover:bg-cyan-300"
                disabled={submitting || lockRemaining > 0}
              >
                {lockRemaining > 0 ? `الحساب مقفول ${lockRemaining} ثانية` : submitting ? "جاري التحقق..." : <><span>تسجيل الدخول</span><ArrowLeft className="h-4 w-4" /></>}
              </Button>

              {lockRemaining > 0 ? (
                <div className="mt-4 rounded-xl border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs text-rose-300">تم قفل تسجيل الدخول مؤقتاً بسبب محاولات فاشلة كثيرة.</div>
              ) : null}



              <a
                href="https://wa.me/201118445625"
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-xs font-bold text-white transition-all hover:bg-emerald-500 shadow-[0_8px_20px_rgba(16,185,129,0.15)]"
              >
                <MessageCircle className="h-4 w-4" /> تواصل مع الدعم الفني عبر واتساب
              </a>

              {window.desktopAPI?.auth && (
                <button type="button" onClick={() => setSupportOpen((value) => !value)} className="mt-3 w-full text-[11px] text-slate-500 transition-colors hover:text-cyan-300">
                  استعادة دخول المدير بكود دعم مؤقت
                </button>
              )}

            </form>
          </section>
        </div>

        <footer className="flex shrink-0 flex-col items-center justify-between gap-2 border-t border-white/[0.07] py-3 text-sm text-slate-400 sm:flex-row">
          <div className="flex items-center gap-2">
            <img src="./helpers_tech_logo.png" alt="Helpers Technologies" className="h-6 w-6 object-contain opacity-70" />
            <span>تصميم وتطوير Helpers Technologies © 2026</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="https://helpers-tech.com/" target="_blank" rel="noreferrer" className="transition-colors hover:text-cyan-300">helpers-tech.com</a>
            <span>·</span>
            <span>نظام قطع الغيار · v1.0.0</span>
          </div>
        </footer>
      </div>

      {supportOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="account-recovery-title">
          <button
            type="button"
            className="absolute inset-0 cursor-default bg-[#020712]/75 backdrop-blur-md"
            aria-label="إغلاق نافذة الاستعادة"
            onClick={() => setSupportOpen(false)}
          />
          <section className="relative w-full max-w-md overflow-y-auto rounded-[24px] border border-white/10 bg-[#091625]/95 p-5 shadow-[0_32px_100px_rgba(0,0,0,.65)] backdrop-blur-2xl sm:p-6 [&_label]:!text-slate-300" style={{ maxHeight: "calc(100dvh - 2rem)" }}>
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>

                <h3 id="account-recovery-title" className="text-xl font-black tracking-[-0.025em] text-white">استعادة حساب المالك</h3>
                <p className="mt-1 text-xs leading-5 text-slate-400">استخدم كود الدعم المؤقت لإعادة تعيين بيانات دخول المدير.</p>
              </div>
              <button type="button" onClick={() => setSupportOpen(false)} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-slate-400 transition-colors hover:bg-white/10 hover:text-white" aria-label="إغلاق">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3">
              {machineCode ? (
                <Field label="كود الجهاز الحالي">
                  <div className="flex gap-2">
                    <Input value={machineCode} readOnly className={`${darkInputClass} pr-3 font-mono text-xs`} />
                    <Button type="button" variant="outline" className="border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]" onClick={async () => { await navigator.clipboard?.writeText(machineCode); toast.success("تم نسخ كود الجهاز"); }}>نسخ</Button>
                  </div>
                </Field>
              ) : null}
              <Field label="كود الدعم"><Input value={supportCode} onChange={(e) => setSupportCode(e.target.value.replace(/\s+/g, ""))} placeholder="APSUP..." className={`${darkInputClass} pr-3`} /></Field>
              <Field label="اسم دخول المدير الجديد"><Input value={supportUsername} onChange={(e) => setSupportUsername(e.target.value)} className={`${darkInputClass} pr-3`} /></Field>
              <Field label="كلمة المرور الجديدة"><Input type="password" value={supportPassword} onChange={(e) => setSupportPassword(e.target.value)} className={`${darkInputClass} pr-3`} /></Field>
            </div>

            <div className="mt-5 space-y-2.5">
              <Button type="button" className="h-11 w-full rounded-xl bg-cyan-400 font-black text-slate-950 hover:bg-cyan-300" onClick={resetOwnerPassword} disabled={supportSubmitting}>{supportSubmitting ? "جاري التحقق..." : "تحديث بيانات المدير"}</Button>
              <Button type="button" variant="ghost" className="h-10 w-full text-cyan-300 hover:bg-cyan-300/[0.08]" onClick={requestSupportCode} disabled={supportCodeRequesting}>{supportCodeRequesting ? "جاري تجهيز الطلب..." : "نسيت كود الدعم؟ تواصل مع الدعم"}</Button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
