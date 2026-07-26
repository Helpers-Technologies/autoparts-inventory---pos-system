import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Input";
import { useCatalog } from "../../store/CatalogContext";
import { useToast } from "../../components/ui/Toast";
import type { Driver } from "../../types";

export function DriverDialog({
  open,
  onClose,
  editing,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  editing?: Driver | null;
  onSaved?: (driver: Driver) => void;
}) {
  const { addDriver, updateDriver } = useCatalog();
  const toast = useToast();

  function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const phoneRaw = (fd.get("phone") as string || "").trim();
    const salaryRaw = (fd.get("salary") as string || "").trim();

    if (phoneRaw) {
      const digits = phoneRaw.replace(/\D/g, "");
      if (digits.length !== 11) {
        toast.error("رقم الهاتف غير صحيح", "يجب أن يكون رقم الهاتف مكون من 11 رقم بالضبط");
        return;
      }
    }

    const data = {
      name: (fd.get("name") as string || "").trim(),
      phone: phoneRaw,
      licenseNumber: (fd.get("licenseNumber") as string || "").trim(),
      salary: salaryRaw ? Number(salaryRaw) : undefined,
    };

    if (editing) {
      updateDriver(editing.id, data);
      toast.success("تم التحديث");
      if (onSaved) onSaved({ ...editing, ...data });
    } else {
      const drv = addDriver(data);
      toast.success("تمت الإضافة");
      if (onSaved) onSaved(drv);
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? "تعديل بيانات السائق" : "إضافة سائق جديد"}
    >
      <form id="driverForm" onSubmit={handleSave} className="space-y-4 mt-4">
        <Field label="اسم السائق" required>
          <Input name="name" defaultValue={editing?.name} required autoFocus />
        </Field>
        <Field label="رقم الهاتف (11 رقم)">
          <Input
            name="phone"
            defaultValue={editing?.phone}
            maxLength={11}
            inputMode="numeric"
            placeholder="مثال: 01000000000"
            onChange={(e) => {
              e.target.value = e.target.value.replace(/\D/g, "").slice(0, 11);
            }}
          />
        </Field>

        <Field label="المرتب الشهري (ج.م)">
          <Input
            name="salary"
            type="number"
            min={0}
            step="any"
            placeholder="مثال: 5000"
            defaultValue={editing?.salary}
          />
        </Field>

        <Field label="رقم الرخصة / السيارة">
          <Input name="licenseNumber" defaultValue={editing?.licenseNumber} />
        </Field>

        <div className="flex justify-end gap-3 pt-4 border-t border-line-soft">
          <Button type="button" variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button type="submit">حفظ</Button>
        </div>
      </form>
    </Dialog>
  );
}
