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
    const data = {
      name: fd.get("name") as string,
      phone: fd.get("phone") as string,
      licenseNumber: fd.get("licenseNumber") as string,
    };

    if (data.phone) {
      const digits = data.phone.replace(/\D/g, "");
      if (digits.length !== 11) {
        toast.error("رقم الهاتف غير صحيح", "يجب أن يكون 11 رقم بالضبط");
        return;
      }
    }

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
        <Field label="رقم الهاتف">
          <Input name="phone" defaultValue={editing?.phone} maxLength={11} inputMode="numeric" />
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
