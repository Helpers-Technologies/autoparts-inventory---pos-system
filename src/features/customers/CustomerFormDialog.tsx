import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field, Input, Textarea } from "../../components/ui/Input";
import type { Customer } from "../../types";
import { useCatalog } from "../../store/CatalogContext";
import { useToast } from "../../components/ui/Toast";
import { isValidEgyptianMobile, normalizePhoneInput } from "../../lib/utils";
import { uid } from "../../lib/utils";
import { AddressFields, type AddressDraft } from "../shipping/AddressFields";

type FormState = Pick<
  Customer,
  "code" | "name" | "phone" | "address" | "notes"
>;

const EMPTY: FormState = {
  code: "",
  name: "",
  phone: "",
  address: "",
  notes: "",
};

const EMPTY_ADDRESS: AddressDraft = {
  label: "العنوان الرئيسي",
  governorate: "",
  city: "",
  addressLine: "",
  isDefault: true,
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
  const [address, setAddress] = useState<AddressDraft>(EMPTY_ADDRESS);

  useEffect(() => {
    if (open) {
      setForm({
        ...EMPTY,
        code: `CUS-${String(nextCustomerCode).padStart(4, "0")}`,
        name: initialName ?? "",
      });
      setAddress({ ...EMPTY_ADDRESS });
    }
  }, [open, nextCustomerCode, initialName]);

  function submit() {
    if (!form.name.trim()) {
      toast.error("الاسم مطلوب");
      return;
    }
    if (form.phone && !isValidEgyptianMobile(form.phone)) {
      toast.error(
        "رقم الهاتف غير صحيح",
        "رقم الموبايل يجب أن يتكون من 11 رقمًا ويبدأ بـ 01 (مثال: 01018194709)",
      );
      return;
    }
    if (address.addressLine.trim() && (!address.governorate || !address.city)) {
      toast.error(
        "بيانات عنوان التوصيل غير مكتملة",
        "اختر المحافظة واكتب المدينة حتى يحسب النظام سعر التوصيل تلقائيًا",
      );
      return;
    }
    const timestamp = new Date().toISOString();
    const structured = address.addressLine.trim()
      ? [
          {
            ...address,
            id: uid("address"),
            recipientName: address.recipientName?.trim() || form.name.trim(),
            phone: address.phone?.trim() || form.phone?.trim(),
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ]
      : undefined;
    const created = addCustomer({
      ...form,
      address: address.addressLine.trim() || form.address,
      addresses: structured,
    });
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
      width="lg"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
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
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="الهاتف" hint="11 رقمًا ويبدأ بـ 01">
          <Input
            type="tel"
            maxLength={11}
            value={form.phone ?? ""}
            onChange={(e) => set("phone", normalizePhoneInput(e.target.value))}
            placeholder="01xxxxxxxxx (11 رقم)"
            dir="ltr"
            className="tracking-wider font-mono text-right"
          />
        </Field>
        <div className="col-span-2 rounded-xl border border-line bg-surface-muted/20 p-3">
          <div className="mb-3 text-sm font-bold text-ink">عنوان التوصيل</div>
          <AddressFields
            value={address}
            onChange={setAddress}
            showRecipient={false}
          />
        </div>
        <Field label="ملاحظات" className="col-span-2">
          <Textarea
            rows={2}
            value={form.notes ?? ""}
            onChange={(e) => set("notes", e.target.value)}
          />
        </Field>
      </div>
    </Dialog>
  );
}
