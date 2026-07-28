import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";
import type { AppUser } from "../../types";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { Dialog } from "../ui/Dialog";
import { Field, Input } from "../ui/Input";
import { useToast } from "../ui/Toast";
import { OtpQrCode } from "./OtpQrCode";
import { downloadRecoveryCodes } from "../../lib/recoveryCodes";

interface MfaStatus {
  enabled: boolean;
  required: boolean;
  available: boolean;
  recoveryCodesRemaining: number;
}

interface MfaStatusResult {
  ok?: boolean;
  enabled?: boolean;
  required?: boolean;
  available?: boolean;
  recoveryCodesRemaining?: number;
  error?: string;
}

interface MfaActionResult {
  ok: boolean;
  error?: string;
}

interface MfaEnrollmentResult extends MfaActionResult {
  challengeId?: string;
  manualKey?: string;
  otpauthUri?: string;
}

interface MfaRecoveryCodesResult extends MfaActionResult {
  recoveryCodes?: string[];
}

interface MfaApi {
  getOwnStatus: () => Promise<MfaStatusResult>;
  beginEnrollment: (password: string) => Promise<MfaEnrollmentResult>;
  confirmEnrollment: (
    challengeId: string,
    code: string
  ) => Promise<MfaRecoveryCodesResult>;
  disableOwn: (
    password: string,
    verificationCode: string
  ) => Promise<MfaActionResult>;
  regenerateRecoveryCodes: (
    password: string,
    verificationCode: string
  ) => Promise<MfaRecoveryCodesResult>;
}

type DialogMode = "enroll" | "disable" | "regenerate" | null;
type EnrollmentStage = "password" | "verify" | "codes";

export interface TwoFactorSecurityPanelProps {
  currentUser: AppUser;
  isOwner: boolean;
  onChanged?: () => void;
  embedded?: boolean;
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: "راجع البيانات المدخلة ثم حاول مرة أخرى.",
  invalid_password: "كلمة المرور الحالية غير صحيحة.",
  invalid_current_password: "كلمة المرور الحالية غير صحيحة.",
  invalid_code: "رمز التحقق أو الكود الاحتياطي غير صحيح.",
  code_reused: "تم استخدام رمز التحقق هذا من قبل. انتظر الرمز التالي.",
  challenge_expired: "انتهت مهلة الإعداد. ابدأ التفعيل من جديد.",
  rate_limited: "محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.",
  already_enabled: "المصادقة الثنائية مفعّلة بالفعل لهذا الحساب.",
  not_enabled: "المصادقة الثنائية غير مفعّلة لهذا الحساب.",
  required_by_policy: "لا يمكن إغلاق الميزة لأنها إجبارية حسب سياسة النظام.",
  feature_disabled: "الميزة موقوفة حاليًا من سياسة النظام. فعّلها من إعدادات المالك أولًا.",
  feature_not_licensed: "المصادقة الثنائية إضافة مدفوعة غير مفعّلة في الترخيص الحالي.",
  not_authorized: "انتهت الجلسة أو لا تملك صلاحية تنفيذ هذه العملية.",
  desktop_required: "إدارة المصادقة الثنائية متاحة من تطبيق سطح المكتب فقط.",
};

function getMfaApi(): MfaApi | null {
  const api = window.desktopAPI as
    | (typeof window.desktopAPI & { mfa?: MfaApi })
    | undefined;
  return api?.mfa ?? null;
}

function messageForError(error?: string): string {
  if (!error) return "حدث خطأ غير متوقع. حاول مرة أخرى.";
  return ERROR_MESSAGES[error] ?? "تعذر إتمام العملية. حاول مرة أخرى.";
}

function RecoveryCodesView({
  codes,
  confirmed,
  onConfirmedChange,
  onCopy,
  onDownload,
}: {
  codes: string[];
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
  onCopy: (text: string, label: string) => Promise<void>;
  onDownload: () => void;
}) {
  return (
    <div className="space-y-4" dir="rtl">
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="font-bold">احفظ هذه الأكواد الآن — لن تظهر مرة أخرى</div>
            <p className="mt-1 text-xs leading-6">
              يمكنك استخدام أي كود مرة واحدة بدل تطبيق المصادقة، وكذلك من شاشة
              استرداد الحساب إذا تعطل 2FA أو نسيت كلمة المرور.
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" dir="ltr">
        {codes.map((code, index) => (
          <button
            key={code}
            type="button"
            onClick={() => onCopy(code, `الكود رقم ${index + 1}`)}
            className="group flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-muted px-3 py-2 text-left transition-colors hover:border-brand-400"
            aria-label={`نسخ الكود الاحتياطي رقم ${index + 1}`}
          >
            <code className="font-mono text-sm font-bold tracking-wider text-ink">
              {code}
            </code>
            <Copy className="h-3.5 w-3.5 shrink-0 text-ink-faint group-hover:text-brand-600" />
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() =>
            onCopy(
              codes.map((code, index) => `${index + 1}. ${code}`).join("\n"),
              "كل الأكواد الاحتياطية"
            )
          }
        >
          <Copy className="h-4 w-4" /> نسخ كل الأكواد
        </Button>
        <Button type="button" variant="outline" className="w-full" onClick={onDownload}>
          <Download className="h-4 w-4" /> تنزيل ملف الأكواد
        </Button>
      </div>

      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-sm text-ink">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand-600"
        />
        <span>أؤكد أنني حفظت الأكواد في مكان آمن خارج هذا الجهاز.</span>
      </label>
    </div>
  );
}

export function TwoFactorSecurityPanel({
  currentUser,
  isOwner,
  onChanged,
  embedded = false,
}: TwoFactorSecurityPanelProps) {
  const toast = useToast();
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [enrollmentStage, setEnrollmentStage] =
    useState<EnrollmentStage>("password");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [manualKey, setManualKey] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [codesConfirmed, setCodesConfirmed] = useState(false);
  const [dialogError, setDialogError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadStatus = useCallback(async () => {
    const api = getMfaApi();
    setStatusLoading(true);
    setStatusError("");

    if (!api) {
      setStatus(null);
      setStatusError("إدارة المصادقة الثنائية غير متاحة في هذه النسخة.");
      setStatusLoading(false);
      return;
    }

    try {
      const result = await api.getOwnStatus();
      if (result.ok === false || typeof result.enabled !== "boolean") {
        setStatus(null);
        setStatusError(messageForError(result.error));
      } else {
        setStatus({
          enabled: result.enabled,
          required: Boolean(result.required),
          available: result.available !== false,
          recoveryCodesRemaining: Math.max(
            0,
            Number(result.recoveryCodesRemaining) || 0
          ),
        });
      }
    } catch {
      setStatus(null);
      setStatusError("تعذر قراءة حالة المصادقة الثنائية.");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!currentUser.id) return;
    void loadStatus();
  }, [currentUser.id, loadStatus]);

  function resetTransientState() {
    setEnrollmentStage("password");
    setPassword("");
    setVerificationCode("");
    setChallengeId("");
    setManualKey("");
    setOtpauthUri("");
    setRecoveryCodes([]);
    setCodesConfirmed(false);
    setDialogError("");
    setBusy(false);
  }

  function openDialog(mode: Exclude<DialogMode, null>) {
    resetTransientState();
    setDialogMode(mode);
  }

  function closeDialog() {
    if (busy) return;
    if (recoveryCodes.length > 0 && !codesConfirmed) {
      toast.warning(
        "احفظ الأكواد الاحتياطية أولًا",
        "لن يستطيع النظام عرضها مرة أخرى بعد إغلاق النافذة."
      );
      return;
    }
    setDialogMode(null);
    resetTransientState();
  }

  function finishRecoveryCodes() {
    if (!codesConfirmed) {
      toast.warning("أكد حفظ الأكواد قبل المتابعة");
      return;
    }
    setDialogMode(null);
    resetTransientState();
  }

  function reportChange() {
    onChanged?.();
    void loadStatus();
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`تم نسخ ${label}`);
    } catch {
      toast.error("تعذر النسخ", "حدد النص وانسخه يدويًا.");
    }
  }

  async function handleBeginEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const api = getMfaApi();
    if (!api) return setDialogError("الميزة غير متاحة في هذه النسخة.");
    if (!password) return setDialogError("أدخل كلمة المرور الحالية.");

    setBusy(true);
    setDialogError("");
    try {
      const result = await api.beginEnrollment(password);
      if (
        !result.ok ||
        !result.challengeId ||
        !result.manualKey ||
        !result.otpauthUri
      ) {
        setDialogError(messageForError(result.error));
        return;
      }
      setChallengeId(result.challengeId);
      setManualKey(result.manualKey);
      setOtpauthUri(result.otpauthUri);
      setPassword("");
      setEnrollmentStage("verify");
    } catch {
      setDialogError("تعذر بدء التفعيل. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const api = getMfaApi();
    if (!api) return setDialogError("الميزة غير متاحة في هذه النسخة.");
    if (!/^\d{6}$/.test(verificationCode)) {
      return setDialogError("اكتب رمزًا صحيحًا مكونًا من 6 أرقام.");
    }

    setBusy(true);
    setDialogError("");
    try {
      const result = await api.confirmEnrollment(challengeId, verificationCode);
      if (!result.ok || !result.recoveryCodes?.length) {
        setDialogError(messageForError(result.error));
        return;
      }
      setRecoveryCodes(result.recoveryCodes);
      setVerificationCode("");
      setEnrollmentStage("codes");
      toast.success("تم تفعيل المصادقة الثنائية");
      reportChange();
    } catch {
      setDialogError("تعذر تأكيد الرمز. حاول مرة أخرى.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const api = getMfaApi();
    if (!api) return setDialogError("الميزة غير متاحة في هذه النسخة.");
    if (!password || !verificationCode.trim()) {
      return setDialogError("أدخل كلمة المرور ورمز التحقق أو كودًا احتياطيًا.");
    }

    setBusy(true);
    setDialogError("");
    try {
      const result = await api.disableOwn(password, verificationCode.trim());
      if (!result.ok) {
        setDialogError(messageForError(result.error));
        return;
      }
      toast.success("تم إغلاق المصادقة الثنائية");
      setDialogMode(null);
      resetTransientState();
      reportChange();
    } catch {
      setDialogError("تعذر إغلاق المصادقة الثنائية.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const api = getMfaApi();
    if (!api) return setDialogError("الميزة غير متاحة في هذه النسخة.");
    if (!password || !verificationCode.trim()) {
      return setDialogError("أدخل كلمة المرور ورمز التحقق أو كودًا احتياطيًا.");
    }

    setBusy(true);
    setDialogError("");
    try {
      const result = await api.regenerateRecoveryCodes(
        password,
        verificationCode.trim()
      );
      if (!result.ok || !result.recoveryCodes?.length) {
        setDialogError(messageForError(result.error));
        return;
      }
      setRecoveryCodes(result.recoveryCodes);
      setPassword("");
      setVerificationCode("");
      toast.success("تم إنشاء أكواد احتياطية جديدة", "تم إلغاء الأكواد القديمة.");
      reportChange();
    } catch {
      setDialogError("تعذر إنشاء أكواد احتياطية جديدة.");
    } finally {
      setBusy(false);
    }
  }

  const showingCodes = recoveryCodes.length > 0;
  const dialogTitle =
    dialogMode === "disable"
      ? "إغلاق المصادقة الثنائية"
      : dialogMode === "regenerate"
        ? showingCodes
          ? "الأكواد الاحتياطية الجديدة"
          : "تجديد الأكواد الاحتياطية"
        : enrollmentStage === "codes"
          ? "الأكواد الاحتياطية"
          : "تفعيل المصادقة الثنائية";

  const dialogSubtitle = showingCodes
    ? "تُعرض هذه الأكواد مرة واحدة فقط"
    : dialogMode === "disable"
      ? "سيتم إلغاء مفتاح المصادقة وكل الأكواد الاحتياطية"
      : dialogMode === "regenerate"
        ? "سيتم إلغاء كل الأكواد القديمة فور إنشاء المجموعة الجديدة"
        : "استخدم تطبيق Google Authenticator أو Microsoft Authenticator أو أي تطبيق TOTP";

  const Container = embedded ? "div" : Card;

  return (
    <Container dir="rtl">
      <CardHeader
        className={embedded ? "border-b-0 px-0 pt-0 pb-2" : undefined}
        title={
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand-600" />
            <span>المصادقة الثنائية والأكواد الاحتياطية</span>
          </div>
        }
        subtitle={`حماية ${isOwner ? "حساب المالك" : "حساب المستخدم"} «${currentUser.username}» عند تسجيل الدخول واسترداد الحساب`}
        actions={
          status ? (
            <Badge tone={status.enabled && status.available ? "green" : "slate"}>
              {status.enabled ? (
                <ShieldCheck className="h-3.5 w-3.5" />
              ) : (
                <ShieldOff className="h-3.5 w-3.5" />
              )}
              {status.enabled ? (status.available ? "مفعّلة" : "معلّقة") : "غير مفعّلة"}
            </Badge>
          ) : null
        }
      />

      <CardBody className={embedded ? "p-0" : undefined}>
        {statusLoading ? (
          <div className="flex min-h-24 items-center justify-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> جاري قراءة إعدادات الأمان...
          </div>
        ) : statusError || !status ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
            <div className="flex items-start gap-2 text-sm text-amber-900 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{statusError || "تعذر قراءة حالة المصادقة الثنائية."}</span>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => void loadStatus()}
            >
              <RefreshCw className="h-3.5 w-3.5" /> إعادة المحاولة
            </Button>
          </div>
        ) : status.enabled ? (
          <div className={embedded ? "space-y-3" : "space-y-4"}>
            {!status.available ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                طلب الرمز معلّق حاليًا من سياسة النظام، لكن المفتاح والأكواد الاحتياطية محفوظة ويمكن إعادة تشغيلها دون إعداد جديد.
              </div>
            ) : null}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <div className="flex items-start gap-2">
                  <Smartphone className="mt-0.5 h-5 w-5 text-emerald-700 dark:text-emerald-300" />
                  <div>
                    <div className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                      {status.available ? "الحساب محمي بتطبيق المصادقة" : "إعداد المصادقة محفوظ"}
                    </div>
                    <div className="mt-1 text-xs leading-5 text-emerald-800 dark:text-emerald-300">
                      {status.available
                        ? "سيُطلب رمز من 6 أرقام بعد كلمة المرور عند تسجيل الدخول."
                        : "لن يُطلب الرمز أثناء الإيقاف العام، وسيعود العمل به عند إعادة تشغيل السياسة."}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-line bg-surface-muted p-3">
                <div className="flex items-start gap-2">
                  <KeyRound className="mt-0.5 h-5 w-5 text-brand-600" />
                  <div>
                    <div className="text-sm font-bold text-ink">
                      {status.recoveryCodesRemaining} كود احتياطي متبقٍ
                    </div>
                    <div className="mt-1 text-xs leading-5 text-ink-muted">
                      تُستخدم عند فقد الهاتف أو تعطل 2FA أو لاسترداد الحساب عند
                      نسيان كلمة المرور.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {status.recoveryCodesRemaining <= 2 ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                الأكواد الاحتياطية أوشكت على النفاد. أنشئ مجموعة جديدة واحفظها
                خارج الجهاز.
              </div>
            ) : null}

            {status.required ? (
              <div className="text-xs text-ink-muted">
                المصادقة الثنائية إجبارية لهذا الحساب حسب سياسة النظام، لذلك لا
                يمكن إغلاقها.
              </div>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => openDialog("regenerate")}
              >
                <RefreshCw className="h-4 w-4" /> تجديد الأكواد الاحتياطية
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={status.required}
                onClick={() => openDialog("disable")}
              >
                <ShieldOff className="h-4 w-4" /> إغلاق المصادقة الثنائية
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="max-w-2xl">
              <div className="text-sm font-bold text-ink">أضف خطوة حماية ثانية لحسابك</div>
              <p className="mt-1 text-xs leading-6 text-ink-muted">
                بعد التفعيل ستحصل على أكواد احتياطية تستخدمها إذا لم يعمل تطبيق
                2FA، ويمكنك بها استرداد الحساب حتى عند نسيان كلمة المرور.
              </p>
              {status.required ? (
                <Badge tone="amber" className="mt-2">
                  التفعيل مطلوب حسب سياسة النظام
                </Badge>
              ) : null}
            </div>
            <Button type="button" disabled={!status.available} onClick={() => openDialog("enroll")}>
              <Smartphone className="h-4 w-4" /> تفعيل
            </Button>
          </div>
        )}
      </CardBody>

      <Dialog
        open={dialogMode !== null}
        onClose={closeDialog}
        title={dialogTitle}
        subtitle={dialogSubtitle}
        width="md"
        footer={
          showingCodes ? (
            <Button
              type="button"
              onClick={finishRecoveryCodes}
              disabled={!codesConfirmed}
            >
              <CheckCircle2 className="h-4 w-4" /> حفظت الأكواد — إنهاء
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={closeDialog}
                disabled={busy}
              >
                إلغاء
              </Button>
              {dialogMode === "enroll" ? (
                <Button
                  type="submit"
                  form={
                    enrollmentStage === "password"
                      ? "mfa-enrollment-password-form"
                      : "mfa-enrollment-code-form"
                  }
                  disabled={busy}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  {enrollmentStage === "password" ? "متابعة" : "تأكيد وتفعيل"}
                </Button>
              ) : dialogMode === "disable" ? (
                <Button
                  type="submit"
                  form="mfa-disable-form"
                  variant="danger"
                  disabled={busy}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  إغلاق الميزة
                </Button>
              ) : (
                <Button
                  type="submit"
                  form="mfa-regenerate-form"
                  disabled={busy}
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  إنشاء أكواد جديدة
                </Button>
              )}
            </>
          )
        }
      >
        {showingCodes ? (
          <RecoveryCodesView
            codes={recoveryCodes}
            confirmed={codesConfirmed}
            onConfirmedChange={setCodesConfirmed}
            onCopy={copyText}
            onDownload={() => downloadRecoveryCodes(recoveryCodes, currentUser.username)}
          />
        ) : dialogMode === "enroll" && enrollmentStage === "password" ? (
          <form
            id="mfa-enrollment-password-form"
            onSubmit={handleBeginEnrollment}
            className="space-y-4"
            dir="rtl"
          >
            <p className="text-sm leading-6 text-ink-muted">
              أكد هويتك بكلمة المرور الحالية قبل إنشاء مفتاح المصادقة.
            </p>
            <Field label="كلمة المرور الحالية" required>
              <Input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            {dialogError ? (
              <div role="alert" className="text-xs text-red-600 dark:text-red-400">
                {dialogError}
              </div>
            ) : null}
          </form>
        ) : dialogMode === "enroll" ? (
          <form
            id="mfa-enrollment-code-form"
            onSubmit={handleConfirmEnrollment}
            className="space-y-4"
            dir="rtl"
          >
            <div className="rounded-xl border border-brand-200 bg-brand-50 p-3 dark:border-brand-500/30 dark:bg-brand-500/10">
              <div className="flex items-start gap-2">
                <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <div className="text-sm leading-6 text-ink">
                  افتح تطبيق المصادقة واختر إضافة حساب باستخدام «مفتاح إعداد»، ثم
                  اكتب المفتاح التالي.
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <OtpQrCode uri={otpauthUri} />
            </div>

            <Field label="مفتاح الإعداد اليدوي">
              <div className="flex flex-col gap-2 sm:flex-row" dir="ltr">
                <div className="flex min-h-11 flex-1 items-center justify-center rounded-lg border border-line bg-surface-muted px-3">
                  <code className="break-all text-center font-mono text-base font-black tracking-[0.18em] text-ink">
                    {manualKey}
                  </code>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => copyText(manualKey, "مفتاح الإعداد")}
                >
                  <Copy className="h-4 w-4" /> نسخ
                </Button>
              </div>
            </Field>

            <details className="rounded-lg border border-line px-3 py-2 text-xs text-ink-muted">
              <summary className="cursor-pointer font-semibold text-ink">
                رابط الإعداد المتقدم
              </summary>
              <div className="mt-2 flex items-center gap-2" dir="ltr">
                <code className="min-w-0 flex-1 truncate rounded bg-surface-muted px-2 py-1 font-mono">
                  {otpauthUri}
                </code>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => copyText(otpauthUri, "رابط الإعداد")}
                >
                  <Copy className="h-3.5 w-3.5" /> نسخ
                </Button>
              </div>
            </details>

            <Field label="رمز التحقق من التطبيق" required>
              <Input
                autoFocus
                value={verificationCode}
                onChange={(event) =>
                  setVerificationCode(
                    event.target.value.replace(/\D/g, "").slice(0, 6)
                  )
                }
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="000000"
                dir="ltr"
                className="font-mono text-lg tracking-[0.35em]"
              />
            </Field>
            {dialogError ? (
              <div role="alert" className="text-xs text-red-600 dark:text-red-400">
                {dialogError}
              </div>
            ) : null}
          </form>
        ) : dialogMode === "disable" ? (
          <form
            id="mfa-disable-form"
            onSubmit={handleDisable}
            className="space-y-4"
            dir="rtl"
          >
            <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <span>
                بعد الإغلاق لن تُطلب خطوة التحقق الثانية، وستُلغى جميع الأكواد
                الاحتياطية الحالية.
              </span>
            </div>
            <Field label="كلمة المرور الحالية" required>
              <Input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="رمز التطبيق أو كود احتياطي" required>
              <Input
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                autoComplete="one-time-code"
                placeholder="6 أرقام أو كود احتياطي"
                dir="ltr"
                className="font-mono tracking-wider"
              />
            </Field>
            {dialogError ? (
              <div role="alert" className="text-xs text-red-600 dark:text-red-400">
                {dialogError}
              </div>
            ) : null}
          </form>
        ) : (
          <form
            id="mfa-regenerate-form"
            onSubmit={handleRegenerate}
            className="space-y-4"
            dir="rtl"
          >
            <p className="text-sm leading-6 text-ink-muted">
              لحمايتك، أكد هويتك أولًا. إنشاء مجموعة جديدة يلغي كل الأكواد
              الاحتياطية القديمة حتى لو لم تُستخدم.
            </p>
            <Field label="كلمة المرور الحالية" required>
              <Input
                autoFocus
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="رمز التطبيق أو كود احتياطي" required>
              <Input
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
                autoComplete="one-time-code"
                placeholder="6 أرقام أو كود احتياطي"
                dir="ltr"
                className="font-mono tracking-wider"
              />
            </Field>
            {dialogError ? (
              <div role="alert" className="text-xs text-red-600 dark:text-red-400">
                {dialogError}
              </div>
            ) : null}
          </form>
        )}
      </Dialog>
    </Container>
  );
}
