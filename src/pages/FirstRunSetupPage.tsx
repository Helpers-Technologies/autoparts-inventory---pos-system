import { useState, type FormEvent } from "react";
import {
  UserPlus,
  Building2,
  Wallet,
  FolderOpen,
  Database,
  FileText,
  Image as ImageIcon,
  Trash2,
  Check,
  ChevronLeft,
  ChevronRight,
  Users,
  Shield,
  CarFront,
  ScanLine,
  Wrench,
  Gauge,
} from "lucide-react";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useUsers } from "../store/UsersContext";
import { BRANDING } from "../branding";
import { Button } from "../components/ui/Button";
import { Field, Input, Select } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { hashPassword } from "../lib/auth";
import { isValidEgyptianMobile, normalizePhoneInput } from "../lib/utils";
import {
  createPermissions,
  setPermission,
  setPermissionGroup,
  areAllPermissionsEnabled,
  PERMISSION_GROUPS,
} from "../lib/permissions";
import { VEHICLE_COUNTRIES } from "../data/vehicleCountries";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";

// A sensible salesperson starter set the owner can refine in the wizard or
// later from صفحة المستخدمين.
function makeEmployeeDefaultPermissions() {
  const p = createPermissions(false);
  p.pos.view = true;
  p.pos.createSale = true;
  p.pos.applyDiscount = true;
  p.pos.holdCart = true;
  p.products.view = true;
  p.inventory.view = true;
  p.salesInvoices.view = true;
  p.salesInvoices.add = true;
  p.salesInvoices.receive = true;
  p.customers.view = true;
  p.customers.add = true;
  p.returns.view = true;
  p.returns.add = true;
  p.alerts.view = true;
  p.cashbox.view = true;
  p.reports.view = true;
  return p;
}

// How long the welcome splash stays before the dashboard opens.
const WELCOME_MS = 2600;

const STEPS = [
  {
    icon: UserPlus,
    title: "حساب المدير",
    desc: "أنشئ حساب المالك الذي يدير النظام والمستخدمين والصلاحيات.",
  },
  {
    icon: Building2,
    title: "هوية محل قطع الغيار",
    desc: "اسم المحل وشعاره كما سيظهران في الكاشير والفواتير.",
  },
  {
    icon: CarFront,
    title: "تخصص السيارات",
    desc: "اختر أسواق السيارات التي يبيع لها المحل لفلترة الكتالوج والتوافق.",
  },
  {
    icon: Wallet,
    title: "الإعدادات المالية",
    desc: "الرصيد الافتتاحي للخزينة وقواعد التنبيهات الأساسية.",
  },
  {
    icon: FolderOpen,
    title: "مجلدات الحفظ",
    desc: "أماكن حفظ النُّسخ الاحتياطية والفواتير لحماية بياناتك.",
  },
  {
    icon: Users,
    title: "إضافة موظف",
    desc: "أضف أول موظف الآن، أو تخطَّ هذه الخطوة وأضفه لاحقاً.",
  },
] as const;

export function FirstRunSetupPage() {
  const { createOwner } = useAuth();
  const { settings, updateSettings } = useSettings();
  const { addUser } = useUsers();
  const vehicleCatalog = useVehicleCatalog();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);

  // Step 1 — admin account
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Step 2 — company (pre-filled from per-client branding when present)
  const [companyNameAr, setCompanyNameAr] = useState(BRANDING.companyNameAr);
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [companyName, setCompanyName] = useState(BRANDING.companyName);
  const [logoImage, setLogoImage] = useState(BRANDING.logoImage);
  const [selectedCountryCodes, setSelectedCountryCodes] = useState<string[]>(["CN", "KR"]);

  // Step 3 — financial
  const [openingBalance, setOpeningBalance] = useState(0);
  const [paymentTermDays, setPaymentTermDays] = useState(7);
  const [lowStockThreshold, setLowStockThreshold] = useState(10);

  // Step 4 — folders
  const [backupPath, setBackupPath] = useState("");
  const [invoicesSavePath, setInvoicesSavePath] = useState("");

  // Step 5 — first employee (optional)
  const [employeeName, setEmployeeName] = useState("");
  const [employeeUsername, setEmployeeUsername] = useState("");
  const [employeePassword, setEmployeePassword] = useState("");
  const [employeePermissions, setEmployeePermissions] = useState(
    makeEmployeeDefaultPermissions
  );
  const allEmployeePermissionsSelected = areAllPermissionsEnabled(employeePermissions);

  async function pickBackupFolder() {
    const dir = await window.desktopAPI?.backup?.selectDirectory();
    if (dir) setBackupPath(dir);
  }
  async function pickInvoicesFolder() {
    const dir = await window.desktopAPI?.setup?.selectDirectory();
    if (dir) setInvoicesSavePath(dir);
  }

  // Steps 0–4 are required. Step 5 (employee) is validated separately because
  // it is optional and can be skipped.
  function validateStep(s: number): string | null {
    if (s === 0) {
      if (!username.trim()) return "اسم الدخول مطلوب";
      if (password.length < 6) return "كلمة المرور يجب ألا تقل عن 6 أحرف";
      if (password !== confirmPassword) return "كلمتا المرور غير متطابقتين";
    }
    if (s === 1) {
      if (!companyNameAr.trim()) return "اسم الشركة بالعربية مطلوب";
      if (!ownerName.trim()) return "اسم صاحب الشركة / المحل مطلوب";
      if (!ownerPhone.trim()) return "رقم موبايل صاحب الشركة / المحل مطلوب";
      if (!isValidEgyptianMobile(ownerPhone)) {
        return "رقم موبايل صاحب الشركة يجب أن يتكون من 11 رقمًا ويبدأ بـ 01 (مثال: 01018194709)";
      }
    }
    if (s === 4) {
      if (!backupPath.trim()) return "اختر مجلد النسخ الاحتياطي التلقائي";
      if (!invoicesSavePath.trim()) return "اختر مجلد حفظ الفواتير (PDF)";
    }
    return null;
  }

  function validateEmployee(): string | null {
    if (!employeeName.trim()) return "اسم الموظف مطلوب";
    if (!employeeUsername.trim()) return "اسم دخول الموظف مطلوب";
    if (employeeUsername.trim() === username.trim())
      return "اسم دخول الموظف مطابق لاسم دخول المدير";
    if (employeePassword.length < 6) return "كلمة مرور الموظف 6 أحرف على الأقل";
    return null;
  }

  const isLast = step === STEPS.length - 1;

  function goNext() {
    const err = validateStep(step);
    if (err) {
      toast.error("بيانات ناقصة", err);
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  }
  function goBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  async function finishSetup(includeEmployee: boolean) {
    // Validate the required steps (0–4) and jump back to the first faulty one.
    for (let i = 0; i < STEPS.length - 1; i++) {
      const err = validateStep(i);
      if (err) {
        setStep(i);
        toast.error("بيانات ناقصة", err);
        return;
      }
    }
    if (includeEmployee) {
      const empErr = validateEmployee();
      if (empErr) {
        setStep(STEPS.length - 1);
        toast.error("بيانات الموظف ناقصة", empErr);
        return;
      }
    }

    setSubmitting(true);
    // Play the welcome animation first, then open the session (which navigates
    // away and unmounts this page). Purely visual — no data/auth logic here.
    setShowWelcome(true);
    await new Promise((resolve) => setTimeout(resolve, WELCOME_MS));

    const ok = await createOwner(username.trim(), password);
    if (!ok) {
      setShowWelcome(false);
      setSubmitting(false);
      toast.error("فشل إنشاء المدير", "تأكد أن الحساب غير موجود بالفعل");
      return;
    }
    // createOwner set the owner session, so storage writes are now authorized.
    // The owner can change any of this later from الإعدادات.
    const derivedLogoText =
      companyNameAr.trim().slice(0, 2).toUpperCase() || settings.logoText;
    updateSettings({
      companyNameAr: companyNameAr.trim(),
      companyName: companyName.trim(),
      ownerName: ownerName.trim(),
      ownerPhone: ownerPhone.trim(),
      logoImage,
      logoText: derivedLogoText,
      openingBalance: Math.max(0, openingBalance),
      paymentTermDays,
      lowStockThreshold: Math.max(0, lowStockThreshold),
      backupPath: backupPath.trim(),
      invoicesSavePath: invoicesSavePath.trim(),
    });
    vehicleCatalog.updateVehicleCatalogPreferences({
      includeAllMakes: selectedCountryCodes.length === 0,
      selectedCountryCodes,
      selectedMakeIds: [],
      updatedAt: new Date().toISOString(),
    });

    if (includeEmployee) {
      addUser({
        name: employeeName.trim(),
        username: employeeUsername.trim(),
        passwordHash: await hashPassword(employeePassword),
        role: "employee",
        permissions: employeePermissions,
      });
    }
    toast.success("تم إنشاء المدير", "تم فتح النظام بالحساب الجديد");
  }

  function onFormSubmit(e: FormEvent) {
    e.preventDefault();
    // On the last (employee) step, submitting means "add the employee".
    if (isLast) void finishSetup(true);
    else goNext();
  }

  const ActiveIcon = STEPS[step].icon;

  return (
    <div className="min-h-screen grid lg:grid-cols-[0.9fr_1.1fr] bg-[#f4f7fb] dark:bg-slate-950" dir="rtl">
      {showWelcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-gradient-to-br from-brand-700 via-brand-800 to-brand-900 text-white overflow-hidden">
          <style
            dangerouslySetInnerHTML={{
              __html: `
              @keyframes hwFadeUp { from { opacity: 0; transform: translateY(20px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }
              @keyframes hwLogo { 0% { opacity: 0; transform: scale(.7) rotate(-6deg); } 100% { opacity: 1; transform: scale(1) rotate(0); } }
              @keyframes hwPop { 0% { transform: scale(0); } 60% { transform: scale(1.18); } 100% { transform: scale(1); } }
              @keyframes hwRing { 0% { opacity: .55; transform: scale(.7); } 100% { opacity: 0; transform: scale(1.9); } }
              @keyframes hwGlowA { 0%,100% { opacity:.30; transform: translate(0,0) scale(1); } 50% { opacity:.55; transform: translate(20px,-16px) scale(1.12); } }
              @keyframes hwGlowB { 0%,100% { opacity:.22; transform: translate(0,0) scale(1); } 50% { opacity:.40; transform: translate(-24px,18px) scale(1.15); } }
              @keyframes hwBar { from { width: 0%; } to { width: 100%; } }
              .hw-logo  { animation: hwLogo .7s cubic-bezier(.16,.84,.44,1) both; }
              .hw-check { animation: hwPop .55s .35s cubic-bezier(.34,1.56,.64,1) both; }
              .hw-ring  { animation: hwRing 1.4s .5s ease-out infinite; }
              .hw-t1    { animation: hwFadeUp .6s .55s cubic-bezier(.16,.84,.44,1) both; }
              .hw-t2    { animation: hwFadeUp .6s .72s cubic-bezier(.16,.84,.44,1) both; }
              .hw-t3    { animation: hwFadeUp .6s .9s cubic-bezier(.16,.84,.44,1) both; }
              .hw-glowA { animation: hwGlowA 3.2s ease-in-out infinite; }
              .hw-glowB { animation: hwGlowB 3.6s ease-in-out infinite; }
              .hw-bar   { animation: hwBar linear .3s both; }
            `,
            }}
          />
          {/* ambient depth glows */}
          <div className="hw-glowA absolute -top-24 -right-16 w-[420px] h-[420px] rounded-full bg-surface/10 blur-3xl" />
          <div className="hw-glowB absolute -bottom-28 -left-20 w-[460px] h-[460px] rounded-full bg-sky-300/10 blur-3xl" />

          <div className="relative flex flex-col items-center gap-6 text-center px-8 w-full max-w-sm">
            <div className="hw-logo w-24 h-24 rounded-3xl bg-surface/10 border border-white/20 grid place-items-center overflow-hidden text-3xl font-bold shadow-xl">
              {logoImage ? (
                <img src={logoImage} alt="Logo" className="w-full h-full object-contain p-1.5" />
              ) : (
                companyNameAr.trim().slice(0, 2).toUpperCase() || settings.logoText
              )}
            </div>

            <div className="relative grid place-items-center">
              <span className="hw-ring absolute w-16 h-16 rounded-full border-2 border-white/60" />
              <div className="hw-check w-16 h-16 rounded-full bg-surface grid place-items-center shadow-lg">
                <Check className="w-9 h-9 text-brand-700" strokeWidth={3} />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="hw-t1 text-3xl font-bold tracking-tight">مرحباً بك</div>
              {companyNameAr.trim() && (
                <div className="hw-t2 text-xl text-white/90">{companyNameAr.trim()}</div>
              )}
              <div className="hw-t3 text-xs text-white/60">
                {companyName.trim() || "Helpers Technologies"}
              </div>
            </div>

            {/* progress bar synced to the splash duration */}
            <div className="hw-t3 w-full mt-2 space-y-2">
              <div className="h-1.5 w-full rounded-full bg-surface/15 overflow-hidden">
                <div
                  className="hw-bar h-full rounded-full bg-surface"
                  style={{ animationDuration: `${WELCOME_MS}ms` }}
                />
              </div>
              <div className="text-[11px] text-white/70">جارٍ تجهيز كتالوج قطع الغيار والكاشير...</div>
            </div>
          </div>
        </div>
      )}

      {/* Automotive identity panel with the vertical stepper */}
      <div className="hidden lg:flex relative overflow-hidden bg-[radial-gradient(circle_at_top_right,_#164e63_0,_#0f172a_42%,_#020617_100%)] text-white p-10 flex-col justify-between">
        <div className="pointer-events-none absolute -left-28 -top-20 h-80 w-80 rounded-full border-[38px] border-cyan-400/[0.07]" />
        <div className="pointer-events-none absolute -bottom-24 right-20 h-64 w-64 rounded-full border-[30px] border-amber-400/[0.08]" />
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-white/10 border border-white/10 grid place-items-center font-bold overflow-hidden shadow-xl">
            {logoImage ? (
              <img src={logoImage} alt="Logo" className="w-full h-full object-cover" />
            ) : (
              <Wrench className="h-5 w-5 text-cyan-300" />
            )}
          </div>
          <div>
            <div className="font-semibold">{companyNameAr || "AutoParts Store"}</div>
            <div className="text-[10px] font-bold tracking-[0.18em] text-cyan-300" dir="ltr">INVENTORY · FITMENT · POS</div>
          </div>
        </div>

        <div className="relative max-w-md w-full">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-bold text-amber-300"><Gauge className="h-3.5 w-3.5" /> تشغيل مخصص لقطع غيار السيارات</div>
          <h1 className="text-3xl font-black leading-tight mb-2">جهّز المحل للعمل الحقيقي</h1>
          <p className="mb-6 text-sm leading-7 text-slate-400">من أول VIN وتوافق العربية، حتى الرف والكاشير والضمان. الإعدادات هنا تبني تجربة محل قطع غيار وليست مخزنًا عامًا.</p>
          <ol className="space-y-2">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done = i < step;
              const active = i === step;
              return (
                <li
                  key={s.title}
                  className={`flex items-start gap-3 p-3 rounded-xl transition-colors ${
                    active ? "bg-white/10 border border-white/10" : "opacity-55"
                  }`}
                >
                  <div
                    className={`w-9 h-9 shrink-0 rounded-full grid place-items-center border-2 ${
                      done
                        ? "bg-surface text-brand-800 border-white"
                        : active
                        ? "border-white text-white"
                        : "border-white/40 text-white/70"
                    }`}
                  >
                    {done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="text-sm font-semibold leading-7">{s.title}</div>
                    <div className="text-[11px] text-white/70 leading-snug">{s.desc}</div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="relative flex items-center justify-between text-[11px] text-slate-500"><span>Helpers Technologies © 2026</span><span>نظام قطع الغيار · v{__APP_VERSION__}</span></div>
      </div>

      {/* Right form panel — one step at a time */}
      <div className="flex flex-col items-center justify-center p-5 md:p-8 min-h-screen">
        <form
          onSubmit={onFormSubmit}
          className="w-full max-w-lg bg-surface border border-line rounded-[28px] shadow-2xl shadow-slate-900/10 p-6 md:p-8"
        >
          <div className="mb-5 flex items-center justify-between">
            <div className="text-[10px] font-black tracking-[0.2em] text-cyan-700" dir="ltr">AUTOPARTS QUICK SETUP</div>
            <div className="flex items-center gap-1.5 text-[11px] text-ink-faint"><CarFront className="h-3.5 w-3.5" /> إعداد متخصص</div>
          </div>
          {/* progress bar */}
          <div className="flex items-center gap-2 mb-2">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`h-1.5 flex-1 rounded-full transition-colors ${
                  i <= step ? "bg-brand-600" : "bg-line"
                }`}
              />
            ))}
          </div>
          <div className="text-[11px] text-ink-faint mb-5">
            الخطوة {step + 1} من {STEPS.length}
          </div>

          {/* step header */}
          <div className="flex items-center gap-3 text-brand-700 mb-2">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-cyan-300"><ActiveIcon className="w-5 h-5" /></div>
            <div className="text-lg font-black text-ink">{STEPS[step].title}</div>
          </div>
          <p className="text-sm text-ink-faint mb-5 leading-relaxed">{STEPS[step].desc}</p>

          {/* step content */}
          <div className="space-y-4 min-h-[280px]">
            {step === 0 && (
              <>
                <Field label="اسم الدخول" required>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} />
                </Field>
                <Field label="كلمة المرور" required hint="6 أحرف على الأقل">
                  <Input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </Field>
                <Field label="تأكيد كلمة المرور" required>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                </Field>
              </>
            )}

            {step === 1 && (
              <>
                <div className="flex items-center gap-4">
                  <div
                    className={`w-20 h-20 rounded-2xl border-4 border-white shadow-lg overflow-hidden flex items-center justify-center text-2xl ${
                      logoImage
                        ? "bg-surface"
                        : "bg-gradient-to-br from-brand-600 to-brand-800 text-white font-bold"
                    }`}
                  >
                    {logoImage ? (
                      <img src={logoImage} alt="Logo" className="w-full h-full object-contain" />
                    ) : (
                      companyNameAr.trim().slice(0, 2).toUpperCase() || "؟"
                    )}
                  </div>
                  <div className="flex-1 space-y-2">
                    <div className="text-sm font-bold text-ink">
                      شعار الشركة{" "}
                      <span className="text-ink-faint font-normal">(اختياري)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative">
                        <input
                          type="file"
                          accept="image/*"
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) {
                              const reader = new FileReader();
                              reader.onloadend = () =>
                                setLogoImage(reader.result as string);
                              reader.readAsDataURL(file);
                            }
                          }}
                        />
                        <Button type="button" variant="outline" size="sm" className="gap-2">
                          <ImageIcon className="w-4 h-4" /> رفع صورة
                        </Button>
                      </div>
                      {logoImage && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-red-600 dark:text-red-400 gap-1"
                          onClick={() => setLogoImage("")}
                        >
                          <Trash2 className="w-4 h-4" /> حذف
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <Field label="اسم الشركة بالعربية" required>
                  <Input
                    value={companyNameAr}
                    onChange={(e) => setCompanyNameAr(e.target.value)}
                    placeholder="مثال: النور لقطع غيار السيارات"
                  />
                </Field>
                <Field
                  label="اسم الشركة بالإنجليزية"
                  hint="اختياري — يظهر أسفل الاسم العربي في الفواتير"
                >
                  <Input
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="Optional — e.g. Al Noor Auto Parts"
                    dir="ltr"
                  />
                </Field>
                <Field label="اسم صاحب الشركة / المحل" required>
                  <Input
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    placeholder="مثال: عمر أحمد"
                  />
                </Field>
                <Field label="رقم موبايل صاحب الشركة / المحل" required hint="يجب أن يتكون من 11 رقمًا ويبدأ بـ 01">
                  <Input
                    type="tel"
                    maxLength={11}
                    value={ownerPhone}
                    onChange={(e) => setOwnerPhone(normalizePhoneInput(e.target.value))}
                    placeholder="01xxxxxxxxx (11 رقم)"
                    dir="ltr"
                    className="tracking-wider font-mono text-right"
                  />
                </Field>
              </>
            )}

            {step === 2 && (
              <>
                <div className="rounded-2xl border border-cyan-200 bg-cyan-50/70 p-4 dark:border-cyan-500/30 dark:bg-cyan-500/10">
                  <div className="flex items-center gap-2 font-bold text-cyan-900 dark:text-cyan-300"><ScanLine className="h-4 w-4" /> الكتالوج سيتخصص تلقائيًا</div>
                  <p className="mt-1 text-xs leading-6 text-cyan-800/80 dark:text-cyan-300/80">ستظهر ماركات الدول المختارة أولًا في إضافة المنتجات، دليل القطع، وملفات سيارات العملاء. يمكنك تعديلها لاحقًا.</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {VEHICLE_COUNTRIES.slice(0, 8).map((country) => {
                    const selected = selectedCountryCodes.includes(country.code);
                    return (
                      <button
                        key={country.code}
                        type="button"
                        onClick={() => setSelectedCountryCodes((current) => selected ? current.filter((code) => code !== country.code) : [...current, country.code])}
                        className={`rounded-2xl border p-3 text-right transition ${selected ? "border-cyan-500 bg-cyan-50 ring-2 ring-cyan-100 dark:bg-cyan-500/10 dark:ring-cyan-500/10" : "border-line bg-surface hover:border-brand-300"}`}
                      >
                        <div className="flex items-center justify-between"><span className="text-xl">{country.flag}</span>{selected ? <Check className="h-4 w-4 text-cyan-600" /> : null}</div>
                        <div className="mt-2 text-sm font-bold text-ink">{country.nameAr}</div>
                        <div className="text-[10px] text-ink-faint" dir="ltr">{country.nameEn}</div>
                      </button>
                    );
                  })}
                </div>
                <button type="button" onClick={() => setSelectedCountryCodes([])} className={`w-full rounded-xl border px-3 py-2 text-xs font-semibold ${selectedCountryCodes.length === 0 ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-ink-muted"}`}>عرض الكتالوج العالمي بالكامل</button>
              </>
            )}

            {step === 3 && (
              <>
                <Field
                  label="الرصيد الافتتاحي للخزينة"
                  hint="رصيد النقدية الموجود فعلياً عند بدء استخدام النظام"
                >
                  <div className="relative">
                    <Input
                      type="number"
                      min={0}
                      value={openingBalance}
                      onChange={(e) => setOpeningBalance(Number(e.target.value))}
                      className="pl-12"
                    />
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-ink-faint">
                      {settings.currency}
                    </span>
                  </div>
                </Field>
                <Field
                  label="الحد الأدنى الافتراضي للمخزون"
                  hint="عند وصول كمية أي منتج لهذا الحد يظهر تنبيه نقص"
                >
                  <Input
                    type="number"
                    min={0}
                    value={lowStockThreshold}
                    onChange={(e) => setLowStockThreshold(Number(e.target.value))}
                  />
                </Field>
                <Field
                  label="مدة تنبيه تأخر السداد"
                  hint="المدة التي يُعتبر بعدها المورد متأخراً في السداد فتظهر تنبيهاته"
                >
                  <Select
                    value={String(paymentTermDays)}
                    onChange={(e) => setPaymentTermDays(Number(e.target.value))}
                  >
                    <option value="7">أسبوع (7 أيام)</option>
                    <option value="14">أسبوعين (14 يوم)</option>
                    <option value="30">شهر (30 يوم)</option>
                    <option value="60">شهرين (60 يوم)</option>
                    <option value="90">3 شهور (90 يوم)</option>
                  </Select>
                </Field>
              </>
            )}

            {step === 4 && (
              <>
                <div className="text-xs text-ink-faint leading-relaxed">
                  لحماية بياناتك، حدِّد مجلدين مطلوبين (يمكن تغييرهما لاحقاً من الإعدادات).
                </div>
                <Field label="مجلد النسخ الاحتياطي التلقائي" required>
                  <div className="flex gap-2">
                    <Input
                      value={backupPath}
                      readOnly
                      placeholder="اختر مجلداً (محلي / خارجي / شبكة)..."
                      className="bg-surface-muted font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      aria-label="اختر مجلد النسخ الاحتياطي"
                      onClick={pickBackupFolder}
                    >
                      <FolderOpen className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-ink-faint mt-1">
                    <Database className="w-3 h-3" /> تُحفظ نسخة كاملة من البيانات تلقائياً في هذا المجلد.
                  </div>
                </Field>

                <Field label="مجلد حفظ الفواتير (PDF)" required>
                  <div className="flex gap-2">
                    <Input
                      value={invoicesSavePath}
                      readOnly
                      placeholder="اختر مجلداً..."
                      className="bg-surface-muted font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      aria-label="اختر مجلد حفظ الفواتير"
                      onClick={pickInvoicesFolder}
                    >
                      <FolderOpen className="w-4 h-4" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-ink-faint mt-1">
                    <FileText className="w-3 h-3" /> الوجهة الافتراضية لحفظ الفواتير المطبوعة كـ PDF.
                  </div>
                </Field>
              </>
            )}

            {step === 5 && (
              <>
                <div className="text-xs text-ink-faint leading-relaxed">
                  خطوة اختيارية. أضف أول موظف الآن، أو اضغط «تخطّي الآن» وأضِفه
                  لاحقاً من صفحة المستخدمين.
                </div>
                <Field label="اسم الموظف">
                  <Input
                    value={employeeName}
                    onChange={(e) => setEmployeeName(e.target.value)}
                    placeholder="مثال: محمد علي"
                  />
                </Field>
                <Field label="اسم دخول الموظف">
                  <Input
                    value={employeeUsername}
                    onChange={(e) => setEmployeeUsername(e.target.value)}
                    placeholder="employee"
                  />
                </Field>
                <Field label="كلمة مرور الموظف" hint="6 أحرف على الأقل">
                  <Input
                    type="password"
                    value={employeePassword}
                    onChange={(e) => setEmployeePassword(e.target.value)}
                  />
                </Field>

                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-ink-muted">
                      <Shield className="w-4 h-4 text-brand-600" /> صلاحيات الموظف
                    </div>
                    <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 cursor-pointer"
                        checked={allEmployeePermissionsSelected}
                        onChange={(e) =>
                          setEmployeePermissions(createPermissions(e.target.checked))
                        }
                      />
                      اختيار الكل
                    </label>
                  </div>

                  <div className="max-h-56 overflow-y-auto rounded-lg border border-line divide-y divide-line-soft">
                    {PERMISSION_GROUPS.map((group) => {
                      const groupSelected = areAllPermissionsEnabled(
                        employeePermissions,
                        group.key
                      );
                      const groupPermissions = employeePermissions[group.key] as Record<
                        string,
                        boolean
                      >;
                      return (
                        <div key={group.key} className="p-2.5 space-y-2">
                          <label className="flex items-center justify-between gap-2">
                            <span className="text-xs font-medium text-ink">
                              {group.label}
                            </span>
                            <input
                              type="checkbox"
                              className="w-4 h-4 rounded border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 cursor-pointer"
                              checked={groupSelected}
                              onChange={(e) =>
                                setEmployeePermissions((current) =>
                                  setPermissionGroup(current, group.key, e.target.checked)
                                )
                              }
                            />
                          </label>
                          <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                            {group.actions.map((action) => (
                              <label
                                key={action.key}
                                className="flex items-center gap-1.5 text-ink-muted"
                              >
                                <input
                                  type="checkbox"
                                  className="w-4 h-4 rounded border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 cursor-pointer"
                                  checked={Boolean(groupPermissions[action.key])}
                                  onChange={(e) =>
                                    setEmployeePermissions((current) =>
                                      setPermission(
                                        current,
                                        group.key,
                                        action.key,
                                        e.target.checked
                                      )
                                    )
                                  }
                                />
                                {action.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="text-[11px] text-ink-faint">
                    يمكنك تعديل الصلاحيات لاحقاً من صفحة المستخدمين.
                  </div>
                </div>
              </>
            )}
          </div>

          {/* navigation */}
          <div className="flex items-center justify-between gap-3 mt-6 pt-4 border-t border-line-soft">
            <Button
              type="button"
              variant="ghost"
              onClick={goBack}
              disabled={submitting}
              className={step === 0 ? "invisible" : "gap-1"}
            >
              <ChevronRight className="w-4 h-4" /> السابق
            </Button>

            {isLast ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="whitespace-nowrap"
                  onClick={() => void finishSetup(false)}
                  disabled={submitting}
                >
                  تخطّي الآن
                </Button>
                <Button type="submit" className="whitespace-nowrap" disabled={submitting}>
                  {submitting ? "جارٍ التجهيز..." : "إضافة الموظف"}
                </Button>
              </div>
            ) : (
              <Button type="submit" className="gap-1">
                التالي <ChevronLeft className="w-4 h-4" />
              </Button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
