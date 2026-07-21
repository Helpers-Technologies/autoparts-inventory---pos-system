import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field, Input, Textarea } from "../../components/ui/Input";
import type { Supplier } from "../../types";
import { useCatalog } from "../../store/CatalogContext";
import { useToast } from "../../components/ui/Toast";
import { formatSupplierCode } from "../../lib/codes";

type FormState = Pick<Supplier, "code" | "name" | "phone" | "address" | "notes" | "commissionNote">;

const EMPTY: FormState = {
  code: "",
  name: "",
  phone: "",
  address: "",
  notes: "",
  commissionNote: "",
};

/**
 * Lightweight create-only supplier dialog so a new supplier can be added inline
 * (e.g. while writing a purchase invoice) without leaving the page. Calls
 * onCreated with the new supplier so the caller can select it immediately.
 */
export function SupplierFormDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (supplier: Supplier) => void;
}) {
  const { addSupplier, nextSupplierCode } = useCatalog();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (open) setForm({ ...EMPTY, code: formatSupplierCode(nextSupplierCode) });
  }, [open, nextSupplierCode]);

  function submit() {
    if (!form.name.trim()) {
      toast.error("الاسم مطلوب");
      return;
    }
    if (form.phone && form.phone.trim().replace(/\D/g, "").length < 11) {
      toast.error("رقم الهاتف غير صحيح", "يجب أن يحتوي على 11 رقماً على الأقل");
      return;
    }
    const created = addSupplier(form);
    toast.success("تم إضافة المورد");
    onCreated?.(created);
    onClose();
  }

  function set<K extends keyof FormState>(key: K, val: FormState[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="إضافة مورد جديد"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit}>إضافة المورد</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="كود المورد">
          <Input
            value={form.code ?? ""}
            readOnly
            className="bg-surface-muted cursor-not-allowed text-ink-faint opacity-70 font-mono"
          />
        </Field>
        <Field label="اسم المورد" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="الهاتف">
          <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="العنوان">
          <Input value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="ملاحظة عمولة / هدف" className="col-span-2">
          <Input
            value={form.commissionNote ?? ""}
            onChange={(e) => set("commissionNote", e.target.value)}
            placeholder="مثل: خصم 2% على الكميات الكبيرة"
          />
        </Field>
        <Field label="ملاحظات" className="col-span-2">
          <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
