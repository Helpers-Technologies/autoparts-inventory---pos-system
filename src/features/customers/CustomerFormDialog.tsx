import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field, Input, Select, Textarea } from "../../components/ui/Input";
import type { Customer } from "../../types";
import { useCatalog } from "../../store/CatalogContext";
import { useToast } from "../../components/ui/Toast";

type FormState = Pick<Customer, "code" | "name" | "phone" | "address" | "shippingDirection" | "notes">;

const EMPTY: FormState = {
  code: "",
  name: "",
  phone: "",
  address: "",
  shippingDirection: undefined,
  notes: "",
};

export function CustomerFormDialog({
  open,
  onClose,
  onCreated,
  initialName,
}: {
  open: boolean;
  onClose: () => void;
  onCreated?: (customer: Customer) => void;
  initialName?: string;
}) {
  const { addCustomer, nextCustomerCode } = useCatalog();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (open) {
      setForm({
        ...EMPTY,
        code: `CUS-${String(nextCustomerCode).padStart(4, "0")}`,
        name: initialName ?? "",
      });
    }
  }, [open, nextCustomerCode, initialName]);

  function submit() {
    if (!form.name.trim()) {
      toast.error("الاسم مطلوب");
      return;
    }
    if (form.phone && form.phone.trim().replace(/\D/g, "").length < 11) {
      toast.error("رقم الهاتف غير صحيح", "يجب أن يحتوي على 11 رقماً على الأقل");
      return;
    }
    const created = addCustomer(form);
    toast.success("تم إضافة العميل");
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
      title="إضافة عميل جديد"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit}>إضافة العميل</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label="كود العميل">
          <Input
            value={form.code ?? ""}
            readOnly
            className="bg-surface-muted cursor-not-allowed text-ink-faint opacity-70 font-mono"
          />
        </Field>
        <Field label="اسم العميل" required>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="الهاتف">
          <Input value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        <Field label="العنوان">
          <Input value={form.address ?? ""} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="اتجاه الشحن">
          <Select
            value={form.shippingDirection ?? ""}
            onChange={(e) => set("shippingDirection", e.target.value as Customer["shippingDirection"] || undefined)}
          >
            <option value="">— غير محدد —</option>
            <option value="qibli">قبلي</option>
            <option value="bahri">بحري</option>
          </Select>
        </Field>
        <Field label="ملاحظات" className="col-span-2">
          <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
