import { useState } from "react";
import { Lock } from "lucide-react";
import { useAuth } from "../../store/AuthContext";
import { useSettings } from "../../store/SettingsContext";
import { Button } from "../ui/Button";
import { Field, Input } from "../ui/Input";
import type { LoginResult } from "../../types";

export function LockScreen() {
  const { currentUser, unlockSession, logout } = useAuth();
  const { settings } = useSettings();
  const [username, setUsername] = useState(currentUser?.username ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    setLoading(true);
    setError("");
    const result: LoginResult = await unlockSession(username.trim(), password);
    setLoading(false);
    if (!result.ok) {
      setError(
        result.error === "rate_limited"
          ? `محظور مؤقتاً — انتظر ${result.remainSeconds} ثانية`
          : "اسم المستخدم أو كلمة المرور غير صحيحة"
      );
      setPassword("");
    }
  }

  return (
    <div className="fixed inset-0 z-[9999] bg-slate-900/95 backdrop-blur-sm flex items-center justify-center" dir="rtl">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="bg-brand-600 px-6 py-8 text-center text-white">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-surface/20 mb-4">
            <Lock className="w-8 h-8" />
          </div>
          <div className="text-xl font-bold">{settings.companyNameAr || settings.companyName}</div>
          <div className="text-sm text-brand-100 mt-1">الجلسة مقفلة — أدخل بيانات الدخول للمتابعة</div>
        </div>
        <form onSubmit={handleUnlock} className="p-6 space-y-4">
          <Field label="اسم المستخدم">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </Field>
          <Field label="كلمة المرور">
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          {error && (
            <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-100 dark:border-red-500/20 rounded-lg px-3 py-2 text-center">
              {error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "جارٍ التحقق..." : "فتح الجلسة"}
          </Button>
          <button
            type="button"
            onClick={logout}
            className="w-full text-xs text-ink-faint hover:text-ink-muted transition-colors"
          >
            تسجيل خروج كامل
          </button>
        </form>
      </div>
    </div>
  );
}
