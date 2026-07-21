import { useState, type FormEvent } from "react";
import { Copy, KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";
import { useAuth } from "../store/AuthContext";
import { Button } from "../components/ui/Button";
import { Field, Input, Textarea } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";

const statusText = {
  inactive: "غير مفعل",
  expired: "انتهى الاشتراك",
  machine_mismatch: "الرخصة غير مخصصة لهذا الجهاز",
  clock_tampered: "تم اكتشاف تغيير غير آمن في تاريخ الجهاز",
  active: "مفعل",
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
      <div className="min-h-screen grid place-items-center bg-surface-muted" dir="rtl">
        <div className="text-sm text-ink-faint">جاري فحص حالة الترخيص...</div>
      </div>
    );
  }

  const activationWhatsappUrl = `https://wa.me/201118445625?text=${encodeURIComponent(
    "طلب تفعيل / تجديد نسخة — AutoParts Inventory & Sales System\n" +
      "الحالة: " + (statusText[licenseStatus.state] || "—") + "\n" +
      "كود الجهاز: " + (licenseStatus.machineCode || "غير متاح")
  )}`;

  return (
    <div className="min-h-screen grid md:grid-cols-2 bg-surface-muted" dir="rtl">
      <div className="hidden md:flex relative bg-gradient-to-br from-brand-700 to-brand-900 text-white p-10 flex-col justify-between">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl overflow-hidden">
            <img src="./helpers_tech_logo.png" alt="Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <div className="font-bold text-lg">شركة هيلبيرز تيكنولوجي</div>
            <div className="text-xs text-white/70 font-medium">Helpers Technologies</div>
          </div>
        </div>
        <div className="space-y-4 max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-surface/10 flex items-center justify-center mb-6">
            <ShieldCheck className="w-10 h-10 text-white/85" />
          </div>
          <h1 className="text-3xl font-bold leading-tight">تفعيل AutoParts Inventory & Sales System</h1>
          <p className="text-white/80 text-sm leading-relaxed">
            التفعيل يتم بسيريال موقّع ومربوط بهذا الجهاز، وبعده يتم إنشاء حساب مدير
            النظام لأول مرة.
          </p>
          <div className="pt-6 border-t border-white/10 mt-8">
            <div className="text-xs text-white/60 mb-2">تطوير وتجهيز:</div>
            <div className="text-sm font-semibold text-white/90">المطور: هيلبيرز تيكنولوجي (Helpers Technologies)</div>
            <div className="flex flex-col gap-1 mt-3">
              <div className="text-xs text-white/70">واتساب: 01118445625 (20+)</div>
              <div className="text-xs text-white/70">الموقع: www.helpers-tech.com</div>
            </div>
          </div>
        </div>
        <div className="text-xs text-white/60">Helpers Technologies © 2026</div>
      </div>

      <div className="flex flex-col items-center justify-center p-6 min-h-screen">
        <form
          onSubmit={onSubmit}
          className="w-full max-w-lg bg-surface border border-line rounded-2xl shadow-card p-6 space-y-5"
        >
          <div className="flex items-center gap-2 text-brand-700">
            {licenseStatus.state === "clock_tampered" ? (
              <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400" />
            ) : (
              <KeyRound className="w-5 h-5" />
            )}
            <div className="text-sm font-medium">بوابة التفعيل</div>
          </div>

          <div>
            <h2 className="text-2xl font-semibold text-ink">
              {statusText[licenseStatus.state]}
            </h2>
            <p className="text-sm text-ink-faint mt-1">
              كود الجهاز مطلوب لإصدار السيريال الخاص بالعميل.
            </p>
          </div>

          <Field label="كود الجهاز">
            <div className="flex gap-2">
              <Input
                value={licenseStatus.machineCode}
                readOnly
                className="font-mono text-left"
                dir="ltr"
              />
              <Button type="button" variant="outline" onClick={copyMachineCode}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </Field>

          <Field label="السيريال">
            <Textarea
              rows={4}
              value={serial}
              onChange={(e) => setSerial(e.target.value)}
              placeholder="APLIC..."
              dir="ltr"
              className="font-mono text-left"
            />
          </Field>

          <div className="flex flex-col sm:flex-row gap-2">
            <Button type="submit" size="lg" className="flex-1" disabled={submitting}>
              {submitting ? "جاري التفعيل..." : "تفعيل النسخة"}
            </Button>
          </div>

          <div className="text-[10px] text-ink-faint text-center">
            الرخصة لا تعمل على جهاز آخر ولا تحتوي على بيانات الجهاز الخام.
          </div>

          <a
            href={activationWhatsappUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm transition-colors shadow-sm"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            للتفعيل تواصل مع المطور عبر واتساب
          </a>
        </form>
      </div>
    </div>
  );
}
