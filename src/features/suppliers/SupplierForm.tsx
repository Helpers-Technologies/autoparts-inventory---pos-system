import { useEffect, useState, type ReactNode } from "react";
import {
  Building2,
  Hash,
  Phone,
  MapPin,
  FileText,
  AlertCircle,
  Sparkles,
} from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { HintIcon, Input, Textarea } from "../../components/ui/Input";
import { cn } from "../../lib/utils";
import type { Supplier } from "../../types";
import { useCatalog } from "../../store/CatalogContext";
import { useToast } from "../../components/ui/Toast";
import { formatSupplierCode } from "../../lib/codes";
import { isValidEgyptianMobile, normalizePhoneInput } from "../../lib/utils";

type FormState = Pick<Supplier, "code" | "name" | "phone" | "address" | "notes">;

const EMPTY: FormState = {
  code: "",
  name: "",
  phone: "",
  address: "",
  notes: "",
};

/**
 * Shared create/edit supplier dialog. Pass `editing` to edit an existing
 * supplier, or omit it to create a new one. `onCreated` fires only on create
 * (kept for inline callers like the purchase invoice screen); `onSaved` fires
 * on both create and edit.
 */
export function SupplierFormDialog({
  open,
  onClose,
  editing,
  onCreated,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing?: Supplier | null;
  onCreated?: (supplier: Supplier) => void;
  onSaved?: (supplier: Supplier) => void;
}) {
  const { addSupplier, updateSupplier, nextSupplierCode } = useCatalog();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSubmitted(false);
    if (editing) {
      setForm({
        code: editing.code ?? "",
        name: editing.name,
        phone: editing.phone ?? "",
        address: editing.address ?? "",
        notes: editing.notes ?? "",
      });
    } else {
      setForm({ ...EMPTY, code: formatSupplierCode(nextSupplierCode) });
    }
  }, [open, editing, nextSupplierCode]);

  const nameError = submitted && !form.name.trim() ? "اسم المورد مطلوب" : undefined;
  const phoneError =
    form.phone && !isValidEgyptianMobile(form.phone)
      ? "رقم غير صحيح — 11 رقم يبدأ بـ 01"
      : undefined;

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function submit() {
    setSubmitted(true);
    if (!form.name.trim()) {
      toast.error("اسم المورد مطلوب");
      return;
    }
    if (form.phone && !isValidEgyptianMobile(form.phone)) {
      toast.error("رقم الهاتف غير صحيح", "رقم الموبايل يجب أن يتكون من 11 رقمًا ويبدأ بـ 01 (مثال: 01018194709)");
      return;
    }
    if (editing) {
      updateSupplier(editing.id, form);
      toast.success("تم تحديث المورد");
      onSaved?.({ ...editing, ...form });
    } else {
      const created = addSupplier(form);
      toast.success("تم إضافة المورد");
      onCreated?.(created);
      onSaved?.(created);
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width="lg"
      title={editing ? "تعديل مورد" : "إضافة مورد"}
      subtitle={editing ? "حدّث بيانات المورد وشروطه التجارية" : "أدخل بيانات المورد الأساسية وشروطه التجارية"}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit}>{editing ? "حفظ التعديلات" : "إضافة المورد"}</Button>
        </>
      }
    >
      <div className="space-y-5">
        {/* Section: basic info */}
        <section className="space-y-3">
          <SectionTitle icon={<Building2 className="w-4 h-4" />}>البيانات الأساسية</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Row icon={<Hash className="w-3.5 h-3.5" />} label="كود المورد" hint="يُنشأ تلقائيًا">
              <Input
                value={form.code ?? ""}
                readOnly
                className="bg-surface-muted cursor-not-allowed text-ink-faint opacity-80 font-mono"
              />
            </Row>
            <Row icon={<Building2 className="w-3.5 h-3.5" />} label="اسم المورد" required error={nameError}>
              <Input
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="اسم المورد أو المصنع"
                className={cn("text-start", nameError && "border-red-400 dark:border-red-500/60")}
                autoFocus
              />
            </Row>
            <Row icon={<Phone className="w-3.5 h-3.5" />} label="الهاتف" hint="11 رقم يبدأ بـ 01" error={phoneError}>
              <Input
                type="tel"
                maxLength={11}
                value={form.phone ?? ""}
                onChange={(e) => set("phone", normalizePhoneInput(e.target.value))}
                placeholder="01xxxxxxxxx"
                dir="ltr"
                className={cn("tracking-wider font-mono text-right", phoneError && "border-red-400 dark:border-red-500/60")}
              />
            </Row>
            <Row icon={<MapPin className="w-3.5 h-3.5" />} label="العنوان">
              <Input
                value={form.address ?? ""}
                onChange={(e) => set("address", e.target.value)}
                placeholder="المدينة / المنطقة"
                className="text-start"
              />
            </Row>
          </div>
        </section>

        {/* Section: notes */}
        <section className="space-y-3">
          <SectionTitle icon={<FileText className="w-4 h-4" />}>الملاحظات</SectionTitle>
          <div className="space-y-3">
            <Row icon={<FileText className="w-3.5 h-3.5" />} label="ملاحظات">
              <Textarea
                rows={2}
                value={form.notes ?? ""}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="أي تفاصيل إضافية عن المورد"
              />
            </Row>
          </div>
        </section>

        {!editing ? (
          <div className="flex items-start gap-2 rounded-lg border border-brand-200 dark:border-brand-500/30 bg-brand-50 dark:bg-brand-500/10 p-3 text-xs text-brand-800 dark:text-brand-300">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
            <span>بعد الحفظ يمكنك فتح ملف المورد لإضافة شرائح العمولات والبونص ومتابعة الأصناف الموردة وكشف الحساب.</span>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

function SectionTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-brand-500">{icon}</span>
      <span className="text-xs font-bold text-ink-muted">{children}</span>
      <div className="flex-1 h-px bg-line" />
    </div>
  );
}

function Row({
  icon,
  label,
  required,
  hint,
  infoHint,
  error,
  children,
  className,
}: {
  icon?: ReactNode;
  label: string;
  required?: boolean;
  hint?: string;
  infoHint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-muted">
        {icon ? <span className="text-ink-faint">{icon}</span> : null}
        <span>{label}</span>
        {required ? <span className="text-red-500">*</span> : null}
        {hint ? <span className="font-normal text-ink-faint">— {hint}</span> : null}
        {infoHint ? <HintIcon hint={infoHint} label={label} /> : null}
      </label>
      {children}
      {error ? (
        <div className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
          <AlertCircle className="w-3 h-3" />
          {error}
        </div>
      ) : null}
    </div>
  );
}
