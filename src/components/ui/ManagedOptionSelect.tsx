import { useMemo, useState } from "react";
import { Check, Pencil, Plus, Settings2, Trash2, X } from "lucide-react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Input, Select } from "./Input";
import { useToast } from "./Toast";
import { useSettings } from "../../store/SettingsContext";
import {
  nextProductOptionValue,
  PRODUCT_OPTION_TITLES,
  resolveProductOptions,
  type ProductOption,
  type ProductOptionList,
} from "../../lib/productOptions";

/**
 * A dropdown whose choices the shop owns.
 *
 * Renders the resolved list for `list`, plus a "+" to add an entry and a
 * manage button to rename or delete one. Everything is written straight to
 * settings, so the same list appears wherever this component is used and in
 * the settings screen.
 *
 * `usageCount` is asked for per value rather than computed here: only the
 * caller knows the catalogue, and deleting a grade that ten thousand products
 * still carry would leave those products showing a raw slug.
 */
export function ManagedOptionSelect({
  list,
  value,
  onChange,
  usageCount,
  disabled,
  className,
  ariaLabel,
}: {
  list: ProductOptionList;
  value: string;
  onChange: (value: string) => void;
  usageCount?: (value: string) => number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const [manageOpen, setManageOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const { settings } = useSettings();
  const options = useMemo(
    () => resolveProductOptions(list, settings.productOptions),
    [list, settings.productOptions],
  );

  return (
    <>
      <div className={`flex items-center gap-1.5 ${className ?? ""}`}>
        <Select
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          className="flex-1"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
          {/* A product saved under an option that was later deleted keeps
              showing its own value instead of silently jumping to the first
              entry in the list. */}
          {value && !options.some((option) => option.value === value) ? (
            <option value={value}>{value}</option>
          ) : null}
        </Select>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          onClick={() => setAddOpen(true)}
          title={`إضافة إلى ${PRODUCT_OPTION_TITLES[list]}`}
          aria-label={`إضافة إلى ${PRODUCT_OPTION_TITLES[list]}`}
          className="shrink-0"
        >
          <Plus className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          onClick={() => setManageOpen(true)}
          title={`تعديل ${PRODUCT_OPTION_TITLES[list]}`}
          aria-label={`تعديل ${PRODUCT_OPTION_TITLES[list]}`}
          className="shrink-0"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      <AddOptionDialog
        list={list}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onAdded={(added) => onChange(added)}
      />
      <ManageOptionsDialog
        list={list}
        open={manageOpen}
        onClose={() => setManageOpen(false)}
        usageCount={usageCount}
      />
    </>
  );
}

/** Writes one list back to settings, preserving the other two. */
function useOptionListWriter(list: ProductOptionList) {
  const { settings, updateSettings } = useSettings();
  const options = useMemo(
    () => resolveProductOptions(list, settings.productOptions),
    [list, settings.productOptions],
  );

  function write(next: ProductOption[], deleted?: string) {
    const previous = settings.productOptions ?? {};
    const deletedBuiltIns = new Set(previous.deletedBuiltIns ?? []);
    if (deleted) deletedBuiltIns.add(deleted);
    updateSettings({
      productOptions: {
        ...previous,
        [list]: next.map((option) => ({ value: option.value, label: option.label })),
        deletedBuiltIns: [...deletedBuiltIns],
      },
    });
  }

  return { options, write };
}

export function AddOptionDialog({
  list,
  open,
  onClose,
  onAdded,
}: {
  list: ProductOptionList;
  open: boolean;
  onClose: () => void;
  onAdded?: (value: string) => void;
}) {
  const { options, write } = useOptionListWriter(list);
  const toast = useToast();
  const [label, setLabel] = useState("");
  const [months, setMonths] = useState("");

  const isWarranty = list === "warranties";

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) {
      toast.error("اكتب الاسم اللي هيظهر في القائمة");
      return;
    }
    const monthsValue = isWarranty ? Number(months) : undefined;
    if (isWarranty && (!months.trim() || !Number.isFinite(monthsValue) || (monthsValue as number) < 0)) {
      toast.error("عدد الشهور غير صحيح", "اكتب عدد شهور الضمان كرقم (0 يعني بدون ضمان).");
      return;
    }
    const value = nextProductOptionValue(list, trimmed, options, monthsValue);
    if (!value) {
      toast.error(
        isWarranty ? "مدة الضمان دي موجودة بالفعل" : "الاسم ده موجود بالفعل",
        "غيّر الاسم أو عدّل الموجود بدل ما تضيف نسخة تانية.",
      );
      return;
    }
    write([...options, { value, label: trimmed }]);
    toast.success("تمت الإضافة", `${trimmed} أصبح متاحًا في ${PRODUCT_OPTION_TITLES[list]}.`);
    onAdded?.(value);
    setLabel("");
    setMonths("");
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`إضافة إلى ${PRODUCT_OPTION_TITLES[list]}`}
      width="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={submit}>إضافة</Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-ink-muted">الاسم الظاهر</span>
          <Input
            autoFocus
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder={isWarranty ? "مثال: 4 شهور" : "مثال: أصلي مستعمل"}
          />
        </label>
        {isWarranty ? (
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-ink-muted">عدد الشهور</span>
            <Input
              type="number"
              min={0}
              value={months}
              onChange={(event) => setMonths(event.target.value)}
              placeholder="4"
            />
            <span className="block text-[11px] text-ink-faint">
              النظام بيحسب تاريخ انتهاء الضمان من الرقم ده، فلازم يكون بالشهور.
            </span>
          </label>
        ) : null}
      </div>
    </Dialog>
  );
}

export function ManageOptionsDialog({
  list,
  open,
  onClose,
  usageCount,
}: {
  list: ProductOptionList;
  open: boolean;
  onClose: () => void;
  usageCount?: (value: string) => number;
}) {
  const { options, write } = useOptionListWriter(list);
  const toast = useToast();
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");

  function startEdit(option: ProductOption) {
    setEditingValue(option.value);
    setDraftLabel(option.label);
  }

  function commitEdit() {
    const trimmed = draftLabel.trim();
    if (!trimmed) {
      toast.error("الاسم لا يمكن أن يكون فارغًا");
      return;
    }
    write(options.map((option) => (option.value === editingValue ? { ...option, label: trimmed } : option)));
    setEditingValue(null);
    toast.success("تم تعديل الاسم");
  }

  function remove(option: ProductOption) {
    const used = usageCount?.(option.value) ?? 0;
    if (used > 0) {
      toast.error(
        "مش هينفع تحذفه دلوقتي",
        `${used} صنف مرتبط بـ "${option.label}". غيّر الأصناف دي الأول أو عدّل الاسم بدل الحذف.`,
      );
      return;
    }
    write(
      options.filter((item) => item.value !== option.value),
      option.builtIn ? option.value : undefined,
    );
    toast.success("تم الحذف", `"${option.label}" اتشال من ${PRODUCT_OPTION_TITLES[list]}.`);
  }

  return (
    <Dialog
      open={open}
      onClose={() => { setEditingValue(null); onClose(); }}
      title={`تعديل ${PRODUCT_OPTION_TITLES[list]}`}
      subtitle="غيّر الأسماء زي ما بتتقال عندك، واحذف اللي مش بتستخدمه"
      width="md"
      footer={<Button variant="outline" onClick={() => { setEditingValue(null); onClose(); }}>إغلاق</Button>}
    >
      <div className="space-y-2">
        {options.map((option) => {
          const used = usageCount?.(option.value) ?? 0;
          const editing = editingValue === option.value;
          return (
            <div
              key={option.value}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface p-2.5"
            >
              {editing ? (
                <>
                  <Input
                    autoFocus
                    value={draftLabel}
                    onChange={(event) => setDraftLabel(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") commitEdit();
                      if (event.key === "Escape") setEditingValue(null);
                    }}
                    className="flex-1 min-w-[160px]"
                  />
                  <Button type="button" size="icon" variant="outline" onClick={commitEdit} title="حفظ">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button type="button" size="icon" variant="outline" onClick={() => setEditingValue(null)} title="إلغاء">
                    <X className="h-4 w-4" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-ink">{option.label}</div>
                    <div className="text-[11px] text-ink-faint">
                      {option.builtIn ? "أساسي" : "مضاف من عندك"}
                      {usageCount ? ` · ${used} صنف` : ""}
                    </div>
                  </div>
                  <Button type="button" size="icon" variant="outline" onClick={() => startEdit(option)} title="تعديل الاسم">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    onClick={() => remove(option)}
                    title={used > 0 ? `مستخدم في ${used} صنف` : "حذف"}
                    className={used > 0 ? "opacity-50" : "text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </>
              )}
            </div>
          );
        })}
        {options.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-ink-faint">
            القائمة فاضية — أضف أول اختيار من زرار «+».
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
