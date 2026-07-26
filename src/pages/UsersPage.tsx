import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Users, Plus, Shield, Trash2, Edit, KeyRound, RefreshCw, BarChart3 } from "lucide-react";
import { useUsers } from "../store/UsersContext";
import { useAutoPartsPro } from "../store/AutoPartsProContext";
import { Button } from "../components/ui/Button";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { Field, Input, Select } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import type { AppUser, MfaUserStatus, UserPermissions } from "../types";
import { hashPassword } from "../lib/auth";
import { useFeatures } from "../lib/useFeatures";
import {
  PERMISSION_GROUPS,
  areAllPermissionsEnabled,
  createPermissions,
  normalizePermissions,
  setPermission,
  setPermissionGroup,
} from "../lib/permissions";

function UserFormDialog({
  open,
  onClose,
  editing,
}: {
  open: boolean;
  onClose: () => void;
  editing?: AppUser | null;
}) {
  const { addUser, updateUser, users } = useUsers();
  const pro = useAutoPartsPro();
  const activeBranches = pro.branches.filter((b) => b.active);
  const toast = useToast();

  const [name, setName] = useState(editing?.name || editing?.username || "");
  const [username, setUsername] = useState(editing?.username || "");
  const [password, setPassword] = useState("");
  const [branchId, setBranchId] = useState(editing?.branchId ?? "");
  const [permissions, setPermissions] = useState<UserPermissions>(
    normalizePermissions(editing?.permissions)
  );
  const [monthlySalary, setMonthlySalary] = useState(
    editing?.monthlySalary === undefined ? "" : String(editing.monthlySalary)
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const allPermissionsSelected = useMemo(
    () => areAllPermissionsEnabled(permissions),
    [permissions]
  );

  function optionalNumber(value: string) {
    return value.trim() === "" ? undefined : Number(value);
  }

  async function handleSave() {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "مطلوب";
    if (!username.trim()) e.username = "مطلوب";
    const normalizedUsername = username.trim().toLowerCase();
    const usernameExists = users.some(
      (user) => user.id !== editing?.id && user.username.toLowerCase() === normalizedUsername
    );
    if (usernameExists) e.username = "اسم الدخول مستخدم بالفعل";
    if (!editing && !password) e.password = "مطلوب";
    const salary = optionalNumber(monthlySalary);
    if (salary !== undefined && salary < 0) e.monthlySalary = "يجب أن يكون موجباً";
    if (Object.keys(e).length > 0) {
      setErrors(e);
      return;
    }

    setSaving(true);
    const employeeFields =
      editing?.role !== "owner"
        ? {
            monthlySalary: salary,
            branchId: branchId || undefined,
          }
        : {};
    if (editing) {
      const patch: Partial<AppUser> = {
        name: name.trim(),
        username: username.trim(),
        permissions,
        ...employeeFields,
      };
      if (password) patch.passwordHash = await hashPassword(password);
      updateUser(editing.id, patch);
      toast.success("تم تحديث المستخدم");
    } else {
      addUser({
        name: name.trim(),
        username: username.trim(),
        passwordHash: await hashPassword(password),
        role: "employee",
        permissions,
        ...employeeFields,
      });
      toast.success("تم إضافة المستخدم");
    }
    setSaving(false);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "تعديل مستخدم" : "إضافة مستخدم جديد"}
      width="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Field label="اسم الموظف" required error={errors.name}>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: أحمد محمد"
            />
          </Field>
          <Field label="اسم الدخول" required error={errors.username}>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={editing?.role === "owner"}
            />
          </Field>
          <Field label={editing ? "كلمة المرور (اتركه فارغاً لعدم التغيير)" : "كلمة المرور"} required={!editing} error={errors.password}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        </div>

        {editing?.role !== "owner" && (
          <div className="border border-line rounded-xl p-4 bg-surface-muted space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="الراتب الشهري" error={errors.monthlySalary}>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={monthlySalary}
                  onChange={(e) => setMonthlySalary(e.target.value)}
                  placeholder="جنيه"
                />
              </Field>
              {activeBranches.length > 1 && (
                <Field label="الفرع" hint="يقيّد هذا الموظف بفرع واحد في الكاشير والورديات — اتركه فارغاً للسماح بكل الفروع">
                  <Select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">كل الفروع (بدون تقييد)</option>
                    {activeBranches.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="font-semibold text-ink flex items-center gap-2">
                <Shield className="w-5 h-5 text-brand-600" /> الصلاحيات
              </h3>
              <label className="inline-flex items-center gap-2 rounded-lg border border-brand-200 bg-surface px-3 py-2 text-sm font-medium text-brand-700">
                <input
                  type="checkbox"
                  checked={allPermissionsSelected}
                  onChange={(e) => setPermissions(createPermissions(e.target.checked))}
                />
                اختيار الكل
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {PERMISSION_GROUPS.map((group) => {
                const groupSelected = areAllPermissionsEnabled(permissions, group.key);
                const groupPermissions = permissions[group.key] as Record<string, boolean>;

                return (
                  <div key={group.key} className="space-y-3 bg-surface p-3 rounded-lg border border-line">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-sm text-ink">{group.label}</div>
                        <div className="text-[11px] text-ink-faint mt-0.5">{group.description}</div>
                      </div>
                      <label className="inline-flex items-center gap-1.5 text-xs text-ink-muted whitespace-nowrap">
                        <input
                          type="checkbox"
                          checked={groupSelected}
                          onChange={(e) =>
                            setPermissions((current) =>
                              setPermissionGroup(current, group.key, e.target.checked)
                            )
                          }
                        />
                        كل القسم
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                      {group.actions.map((action) => (
                        <label key={action.key} className="flex items-center gap-2 text-ink-muted">
                          <input
                            type="checkbox"
                            checked={Boolean(groupPermissions[action.key])}
                            onChange={(e) =>
                              setPermissions((current) =>
                                setPermission(current, group.key, action.key, e.target.checked)
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
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function UsersPage() {
  const { users, deleteUser } = useUsers();
  const { isAllowed } = useFeatures();
  const mfaFeatureAllowed = isAllowed("twoFactorAuth");
  const [formState, setFormState] = useState<{ open: boolean; editing?: AppUser }>({ open: false });
  const [delUserId, setDelUserId] = useState<string | null>(null);
  const [mfaStatuses, setMfaStatuses] = useState<Record<string, MfaUserStatus>>({});
  const [mfaResetUser, setMfaResetUser] = useState<AppUser | null>(null);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerVerificationCode, setOwnerVerificationCode] = useState("");
  const [resettingMfa, setResettingMfa] = useState(false);
  const [mfaResetError, setMfaResetError] = useState("");
  const toast = useToast();

  const loadMfaStatuses = useCallback(async () => {
    if (!mfaFeatureAllowed || !window.desktopAPI?.mfa) {
      setMfaStatuses({});
      return;
    }
    try {
      const result = await window.desktopAPI.mfa.listUserStatuses();
      if (!result.ok || !result.users) return;
      setMfaStatuses(Object.fromEntries(result.users.map((status) => [status.userId, status])));
    } catch {
      // Status badges are informative; user management remains available.
    }
  }, [mfaFeatureAllowed]);

  useEffect(() => {
    void loadMfaStatuses();
  }, [loadMfaStatuses, users]);

  function closeMfaReset() {
    if (resettingMfa) return;
    setMfaResetUser(null);
    setOwnerPassword("");
    setOwnerVerificationCode("");
    setMfaResetError("");
  }

  async function resetEmployeeMfa() {
    if (!window.desktopAPI?.mfa || !mfaResetUser) return;
    if (!ownerPassword) {
      setMfaResetError("أدخل كلمة مرور المالك لتأكيد العملية.");
      return;
    }
    setResettingMfa(true);
    setMfaResetError("");
    try {
      const result = await window.desktopAPI.mfa.resetUser(
        mfaResetUser.id,
        ownerPassword,
        ownerVerificationCode.trim()
      );
      if (!result.ok) {
        const messages: Record<string, string> = {
          invalid_password: "كلمة مرور المالك غير صحيحة.",
          invalid_code: "رمز Authenticator أو الكود الاحتياطي غير صحيح.",
          code_reused: "تم استخدام هذا الرمز من قبل. انتظر الرمز التالي.",
          not_authorized: "الجلسة غير مصرح لها بتنفيذ العملية.",
          user_missing: "المستخدم غير موجود.",
        };
        setMfaResetError(messages[result.error ?? ""] ?? "تعذر إعادة ضبط المصادقة الثنائية.");
        return;
      }
      setResettingMfa(false);
      setMfaResetUser(null);
      setOwnerPassword("");
      setOwnerVerificationCode("");
      setMfaResetError("");
      await loadMfaStatuses();
      toast.success("تمت إعادة ضبط 2FA", "سيحتاج الموظف إلى تفعيلها من جديد إذا كانت السياسة إجبارية.");
    } catch {
      setMfaResetError("تعذر إعادة ضبط المصادقة الثنائية.");
    } finally {
      setResettingMfa(false);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-600" /> مستخدمي النظام
          </h1>
          <p className="text-ink-faint mt-1">إدارة الموظفين والصلاحيات الخاصة بهم</p>
        </div>
        <Button onClick={() => setFormState({ open: true })} className="gap-2">
          <Plus className="w-5 h-5" /> إضافة مستخدم
        </Button>
      </div>

      <div className="bg-surface border border-line rounded-xl overflow-hidden shadow-sm">
        <table className="w-full text-sm text-right">
          <thead className="bg-surface-muted border-b border-line text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">الاسم</th>
              <th className="px-4 py-3 font-medium">اسم الدخول</th>
              <th className="px-4 py-3 font-medium">الدور</th>
              {mfaFeatureAllowed ? <th className="px-4 py-3 font-medium">المصادقة الثنائية</th> : null}
              <th className="px-4 py-3 font-medium w-32">إجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-soft">
            {users.map((user) => (
              <tr key={user.id} className="hover:bg-surface-muted transition-colors">
                <td className="px-4 py-3 font-medium text-ink">{user.name || user.username}</td>
                <td className="px-4 py-3 font-medium text-ink">{user.username}</td>
                <td className="px-4 py-3 text-ink-muted">
                  {user.role === "owner" ? (
                    <span className="inline-flex items-center gap-1 bg-brand-100 text-brand-700 px-2 py-1 rounded-md text-xs font-semibold">
                      <Shield className="w-3 h-3" /> مدير النظام
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 bg-surface-muted text-ink-muted px-2 py-1 rounded-md text-xs font-medium">
                      موظف
                    </span>
                  )}
                </td>
                {mfaFeatureAllowed ? (
                  <td className="px-4 py-3 text-ink-muted">
                    {mfaStatuses[user.id]?.enabled ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
                        <KeyRound className="h-3 w-3" /> مفعّلة · {mfaStatuses[user.id].recoveryCodesRemaining} أكواد
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-xs text-ink-muted">غير مفعّلة</span>
                    )}
                  </td>
                ) : null}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/employees/${user.id}`}
                      className="h-8 px-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10 rounded-md transition-colors border border-brand-200 dark:border-brand-500/20"
                      title="عرض ملف الأداء والإنتاجية والصلاحيات"
                    >
                      <BarChart3 className="w-3.5 h-3.5" />
                      الأداء
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFormState({ open: true, editing: user })}
                      className="h-8 px-2 text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:bg-blue-500/10"
                      title="تعديل المستخدم"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    {mfaFeatureAllowed && user.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!mfaStatuses[user.id]?.enabled}
                        onClick={() => {
                          setMfaResetUser(user);
                          setOwnerPassword("");
                          setOwnerVerificationCode("");
                          setMfaResetError("");
                        }}
                        className="h-8 px-2 text-amber-600 hover:bg-amber-50 hover:text-amber-700 dark:text-amber-400 dark:hover:bg-amber-500/10"
                        title="إعادة ضبط المصادقة الثنائية"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    )}
                    {user.role !== "owner" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDelUserId(user.id)}
                        className="h-8 px-2 text-red-600 dark:text-red-400 hover:text-red-700 dark:text-red-400 hover:bg-red-50 dark:bg-red-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {formState.open && (
        <UserFormDialog
          open={formState.open}
          onClose={() => setFormState({ open: false })}
          editing={formState.editing}
        />
      )}

      {mfaFeatureAllowed ? <Dialog
        open={mfaResetUser !== null}
        onClose={closeMfaReset}
        title="إعادة ضبط المصادقة الثنائية"
        subtitle={`إلغاء مفتاح وأكواد ${mfaResetUser?.name || mfaResetUser?.username || "المستخدم"}`}
        width="sm"
        footer={
          <>
            <Button type="button" variant="outline" onClick={closeMfaReset} disabled={resettingMfa}>إلغاء</Button>
            <Button type="button" variant="danger" onClick={resetEmployeeMfa} disabled={resettingMfa}>
              {resettingMfa ? "جاري إعادة الضبط..." : "إعادة ضبط 2FA"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            ستُلغى كل أكواد المستخدم ومفتاح Authenticator، وستُنهى أي جلسة مفتوحة له.
          </div>
          <Field label="كلمة مرور المالك" required>
            <Input type="password" value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} autoComplete="current-password" />
          </Field>
          <Field label="رمز Authenticator أو كود احتياطي للمالك" hint="مطلوب فقط إذا كانت المصادقة الثنائية مفعّلة لحساب المالك">
            <Input value={ownerVerificationCode} onChange={(event) => setOwnerVerificationCode(event.target.value)} autoComplete="one-time-code" dir="ltr" />
          </Field>
          {mfaResetError ? <div role="alert" className="text-xs text-red-600 dark:text-red-400">{mfaResetError}</div> : null}
        </div>
      </Dialog> : null}

      <ConfirmDialog
        open={delUserId !== null}
        onClose={() => setDelUserId(null)}
        onConfirm={() => {
          if (delUserId) {
            const ok = deleteUser(delUserId);
            if (ok) {
              toast.success("تم حذف المستخدم");
            } else {
              toast.error("لا يمكن حذف مستخدم لديه ورديات أو فواتير مرتبطة");
            }
          }
          setDelUserId(null);
        }}
        title="حذف المستخدم"
        message="هل أنت متأكد من حذف هذا المستخدم نهائياً؟"
        variant="danger"
        confirmText="حذف"
      />
    </div>
  );
}
