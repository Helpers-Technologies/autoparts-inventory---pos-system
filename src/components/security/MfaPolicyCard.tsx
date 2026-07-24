import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Save, ShieldCheck } from "lucide-react";
import type { MfaPolicyMode } from "../../types";
import { Button } from "../ui/Button";
import { Card, CardBody, CardHeader } from "../ui/Card";
import { Field, Select } from "../ui/Input";
import { useToast } from "../ui/Toast";

const POLICY_LABELS: Record<MfaPolicyMode, string> = {
  disabled: "موقوفة للنظام كله",
  optional: "اختيارية لكل مستخدم",
  required_owner: "إجبارية للمالك فقط",
  required_all: "إجبارية لكل المستخدمين",
};

const POLICY_DESCRIPTIONS: Record<MfaPolicyMode, string> = {
  disabled: "لن يطلب النظام رمزًا ثانيًا عند الدخول، مع الاحتفاظ بإعدادات الحسابات الحالية.",
  optional: "يستطيع كل مستخدم تفعيل أو إغلاق المصادقة الثنائية لحسابه.",
  required_owner: "لن يفتح حساب المالك دون Authenticator أو كود احتياطي.",
  required_all: "كل حساب حالي يجب أن يكون مفعّلًا، وأي مستخدم جديد سيُطلب منه الإعداد عند أول دخول.",
};

export function MfaPolicyCard({ onChanged, embedded = false }: { onChanged?: () => void; embedded?: boolean }) {
  const toast = useToast();
  const [savedMode, setSavedMode] = useState<MfaPolicyMode>("optional");
  const [mode, setMode] = useState<MfaPolicyMode>("optional");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [missingUsers, setMissingUsers] = useState<string[]>([]);

  const loadPolicy = useCallback(async () => {
    if (!window.desktopAPI?.mfa) {
      setError("إدارة سياسة المصادقة الثنائية متاحة في تطبيق سطح المكتب فقط.");
      setLoading(false);
      return;
    }
    try {
      const result = await window.desktopAPI.mfa.getPolicy();
      if (!result.ok || !result.policy) {
        setError("تعذر قراءة سياسة الأمان الحالية.");
        return;
      }
      setSavedMode(result.policy.mode);
      setMode(result.policy.mode);
      setError("");
    } catch {
      setError("تعذر قراءة سياسة الأمان الحالية.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  async function savePolicy() {
    if (!window.desktopAPI?.mfa) return;
    setSaving(true);
    setError("");
    setMissingUsers([]);
    try {
      const result = await window.desktopAPI.mfa.updatePolicy(mode);
      if (!result.ok || !result.policy) {
        if (result.error === "users_not_enrolled") {
          const names = (result.missingUsers ?? []).map(
            (user) => `${user.name || user.username} (${user.username})`
          );
          setMissingUsers(names);
          setError("فعّل 2FA للحسابات الموضحة أولًا، ثم أعد تطبيق السياسة الإجبارية.");
        } else {
          setError("تعذر حفظ سياسة المصادقة الثنائية.");
        }
        return;
      }
      setSavedMode(result.policy.mode);
      setMode(result.policy.mode);
      toast.success("تم حفظ سياسة المصادقة الثنائية");
      onChanged?.();
    } catch {
      setError("تعذر حفظ سياسة المصادقة الثنائية.");
    } finally {
      setSaving(false);
    }
  }

  const Container = embedded ? "div" : Card;

  return (
    <Container dir="rtl">
      <CardHeader
        className={embedded ? "border-b-0 px-0 pt-0 pb-2" : undefined}
        title={
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-brand-600" />
            <span>سياسة المصادقة الثنائية للنظام</span>
          </div>
        }
        subtitle="يتحكم المالك في إتاحة الميزة أو إلزام الحسابات بها"
      />
      <CardBody className={embedded ? "space-y-2 p-0" : "space-y-4"}>
        {loading ? (
          <div className="flex min-h-20 items-center justify-center gap-2 text-sm text-ink-muted">
            <Loader2 className="h-4 w-4 animate-spin" /> جاري قراءة السياسة...
          </div>
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field label="وضع المصادقة الثنائية">
                <Select value={mode} onChange={(event) => setMode(event.target.value as MfaPolicyMode)}>
                  {(Object.keys(POLICY_LABELS) as MfaPolicyMode[]).map((value) => (
                    <option key={value} value={value}>{POLICY_LABELS[value]}</option>
                  ))}
                </Select>
              </Field>
              <Button type="button" onClick={savePolicy} disabled={saving || mode === savedMode}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                حفظ سياسة الأمان
              </Button>
            </div>

            <div className="rounded-lg border border-line bg-surface-muted px-3 py-2 text-xs leading-5 text-ink-muted">
              {POLICY_DESCRIPTIONS[mode]}
            </div>

            {mode === "disabled" ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                الإيقاف العام يعلّق طلب الرمز فقط ولا يحذف المفاتيح أو الأكواد الاحتياطية؛ الأكواد تظل صالحة لاسترداد الحساب.
              </div>
            ) : null}

            {error ? (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                <div>{error}</div>
                {missingUsers.length > 0 ? (
                  <ul className="mt-2 list-inside list-disc space-y-1">
                    {missingUsers.map((user) => <li key={user}>{user}</li>)}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Container>
  );
}
