import { useEffect, useState } from "react";
import { PlayCircle, Wallet, ShieldAlert } from "lucide-react";
import { Dialog } from "../ui/Dialog";
import { Field, Input } from "../ui/Input";
import { Button } from "../ui/Button";
import { useInvoicing } from "../../store/InvoicingContext";
import { useAuth } from "../../store/AuthContext";
import { useAutoPartsPro } from "../../store/AutoPartsProContext";
import { useToast } from "../ui/Toast";
import { hasPermission } from "../../lib/permissions";

interface OpenShiftDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function OpenShiftDialog({ open, onClose, onSuccess }: OpenShiftDialogProps) {
  const { openShift } = useInvoicing();
  const { currentUser } = useAuth();
  const pro = useAutoPartsPro();
  const toast = useToast();

  const canOpenShift = hasPermission(currentUser, "pos", "openShift");
  const shiftBranch =
    pro.branches.find((b) => b.id === currentUser?.branchId) ??
    pro.branches.find((b) => b.isMain) ??
    pro.branches[0];

  const [openingCash, setOpeningCash] = useState("0");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setOpeningCash("0");
    setNote("");
    setError("");
  }, [open]);

  const handleOpenShift = async () => {
    if (!canOpenShift) {
      setError("ليس لديك صلاحية فتح وردية جديدة");
      return;
    }
    const cashVal = Number(openingCash);
    if (isNaN(cashVal) || cashVal < 0) {
      setError("يرجى إدخال مبلغ افتتاحي صحيح بالدرج (0 أو أكثر)");
      return;
    }

    try {
      setLoading(true);
      setError("");
      const shift = openShift({ openingCash: cashVal, note, branchId: shiftBranch?.id, branchName: shiftBranch?.name });
      toast.success(`تم فتح الوردية رقم #${shift.shiftNumber} بنجاح`);
      onClose();
      if (onSuccess) onSuccess();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "تعذر فتح الوردية";
      setError(msg);
      toast.error("خطأ", msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="بدء وتفعيل وردية الكاشير"
      width="md"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            إلغاء
          </Button>
          <Button onClick={handleOpenShift} disabled={loading || !canOpenShift}>
            <PlayCircle className="w-4 h-4 ml-1.5" />
            {loading ? "جاري فتح الوردية..." : "بدء الوردية الآن"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {!canOpenShift ? (
          <div className="p-3.5 rounded-xl border border-red-200 dark:border-red-500/20 bg-red-50 dark:bg-red-500/10 text-sm text-red-700 dark:text-red-300 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-red-600 dark:text-red-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-bold">غير مصرح بفتح الوردية</div>
              <div className="text-xs text-red-600/80 dark:text-red-300/80 mt-1 leading-relaxed">
                حسابك الحالي لا يمتلك صلاحية <strong>فتح وردية جديدة</strong>. يرجى مراجعة إدارة النظام أو التبديل لحساب مشرف الورديات.
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3.5 rounded-xl border border-brand-200 dark:border-brand-500/20 bg-brand-50/50 dark:bg-brand-500/10 text-sm text-brand-900 dark:text-brand-300 flex items-start gap-3">
            <Wallet className="w-5 h-5 text-brand-600 dark:text-brand-400 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold">تنبيه فتح الوردية</div>
              <div className="text-xs text-ink-muted mt-1 leading-relaxed">
                الكاشير الحالي: <strong className="text-ink">{currentUser?.name || currentUser?.username}</strong>
                {shiftBranch ? <> — الفرع: <strong className="text-ink">{shiftBranch.name}</strong></> : null}.
                الرجاء عد النقود الموجودة بالدرج (الرصيد الافتتاحي / الفكة) قبل بدء إصدار الفواتير.
              </div>
            </div>
          </div>
        )}

        <Field label="الرصيد الافتتاحي بالدرج (الصرّاف / الفكة)" required error={error}>
          <div className="relative">
            <Input
              type="number"
              min={0}
              step="1"
              value={openingCash}
              onChange={(e) => {
                setOpeningCash(e.target.value);
                setError("");
              }}
              placeholder="مثال: 500"
              className="text-lg font-bold"
              autoFocus
            />
            <span className="absolute left-3 top-2.5 text-xs text-ink-faint font-medium">جنيه</span>
          </div>
        </Field>

        <Field label="ملاحظات وقت بدء الوردية (اختياري)">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="مثال: استلام الدرج بنظافة وسرعة الكاشير"
          />
        </Field>
      </div>
    </Dialog>
  );
}
