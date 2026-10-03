import { useMemo, useState } from "react";
import { CalendarClock, Pencil, Plus, Search, TicketPercent, Trash2 } from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { ConfirmDialog, Dialog } from "../components/ui/Dialog";
import { Field, Input, Select } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { discountCodeUsage, normalizeDiscountCode } from "../lib/discountCodes";
import { formatCurrency } from "../lib/format";
import { todayISO, uid } from "../lib/utils";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import type { DiscountCode, DiscountCodeType, SalesPriceType } from "../types";

type FormState = {
  code: string;
  name: string;
  type: DiscountCodeType;
  value: number;
  maxDiscount: number;
  minOrderTotal: number;
  startsAt: string;
  expiresAt: string;
  usageLimit: number;
  perCustomerLimit: number;
  scope: "all" | SalesPriceType;
  active: boolean;
};

const EMPTY_FORM: FormState = {
  code: "",
  name: "",
  type: "percentage",
  value: 0,
  maxDiscount: 0,
  minOrderTotal: 0,
  startsAt: "",
  expiresAt: "",
  usageLimit: 0,
  perCustomerLimit: 0,
  scope: "all",
  active: true,
};

function asForm(code: DiscountCode): FormState {
  const allowed = code.allowedPriceTypes ?? [];
  return {
    code: code.code,
    name: code.name,
    type: code.type,
    value: code.value,
    maxDiscount: code.maxDiscount ?? 0,
    minOrderTotal: code.minOrderTotal ?? 0,
    startsAt: code.startsAt ?? "",
    expiresAt: code.expiresAt ?? "",
    usageLimit: code.usageLimit ?? 0,
    perCustomerLimit: code.perCustomerLimit ?? 0,
    scope: allowed.length === 1 ? allowed[0] : "all",
    active: code.active,
  };
}

export function DiscountCodesPage() {
  const { settings, updateSettings } = useSettings();
  const { salesInvoices } = useInvoicing();
  const toast = useToast();
  const codes = settings.discountCodes ?? [];
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const today = todayISO();

  const rows = useMemo(() => codes.filter((item) => {
    const haystack = `${item.code} ${item.name}`.toLowerCase();
    if (query.trim() && !haystack.includes(query.trim().toLowerCase())) return false;
    if (type !== "all" && item.type !== type) return false;
    const expired = Boolean(item.expiresAt && item.expiresAt < today);
    const scheduled = Boolean(item.startsAt && item.startsAt > today);
    if (status === "active" && (!item.active || expired || scheduled)) return false;
    if (status === "inactive" && item.active) return false;
    if (status === "expired" && !expired) return false;
    if (status === "scheduled" && !scheduled) return false;
    return true;
  }), [codes, query, status, type, today]);

  const totalUses = useMemo(
    () => codes.reduce((sum, item) => sum + discountCodeUsage(salesInvoices, item.id), 0),
    [codes, salesInvoices],
  );

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(item: DiscountCode) {
    setEditingId(item.id);
    setForm(asForm(item));
    setDialogOpen(true);
  }

  function save() {
    const normalized = normalizeDiscountCode(form.code);
    if (!normalized || !form.name.trim()) {
      toast.error("أدخل كود الخصم واسمه");
      return;
    }
    if (form.value <= 0 || (form.type === "percentage" && form.value > 100)) {
      toast.error(form.type === "percentage" ? "نسبة الخصم يجب أن تكون بين 0 و100" : "قيمة الخصم يجب أن تكون أكبر من صفر");
      return;
    }
    if (form.startsAt && form.expiresAt && form.startsAt > form.expiresAt) {
      toast.error("تاريخ الانتهاء يجب أن يكون بعد تاريخ البداية");
      return;
    }
    if (codes.some((item) => item.id !== editingId && normalizeDiscountCode(item.code) === normalized)) {
      toast.error("كود الخصم مستخدم بالفعل");
      return;
    }

    const current = codes.find((item) => item.id === editingId);
    const item: DiscountCode = {
      id: current?.id ?? uid("discount"),
      createdAt: current?.createdAt ?? new Date().toISOString(),
      code: normalized,
      name: form.name.trim(),
      type: form.type,
      value: form.value,
      maxDiscount: form.type === "percentage" && form.maxDiscount > 0 ? form.maxDiscount : undefined,
      minOrderTotal: form.minOrderTotal > 0 ? form.minOrderTotal : undefined,
      startsAt: form.startsAt || undefined,
      expiresAt: form.expiresAt || undefined,
      usageLimit: form.usageLimit > 0 ? form.usageLimit : undefined,
      perCustomerLimit: form.perCustomerLimit > 0 ? form.perCustomerLimit : undefined,
      allowedPriceTypes: form.scope === "all" ? undefined : [form.scope],
      active: form.active,
    };
    updateSettings({ discountCodes: editingId ? codes.map((code) => code.id === editingId ? item : code) : [item, ...codes] });
    setDialogOpen(false);
    toast.success(editingId ? "تم تحديث كود الخصم" : "تم إنشاء كود الخصم");
  }

  function toggle(item: DiscountCode) {
    updateSettings({ discountCodes: codes.map((code) => code.id === item.id ? { ...code, active: !code.active } : code) });
  }

  const activeCount = codes.filter((item) => item.active && (!item.expiresAt || item.expiresAt >= today) && (!item.startsAt || item.startsAt <= today)).length;
  const expiredCount = codes.filter((item) => item.expiresAt && item.expiresAt < today).length;

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={TicketPercent}
        title="أكواد الخصم"
        description="أنشئ خصومات بنسبة أو بقيمة ثابتة، وحدد فترة الصلاحية والحد الأدنى وحدود الاستخدام ونوع السعر المسموح."
        stats={[
          { label: "إجمالي الأكواد", value: codes.length },
          { label: "أكواد نشطة", value: activeCount },
          { label: "منتهية", value: expiredCount },
          { label: "مرات الاستخدام", value: totalUses },
        ]}
        actions={<Button className="bg-amber-400 text-slate-950 hover:bg-amber-300" onClick={openCreate}><Plus className="h-4 w-4" /> كود جديد</Button>}
      />

      <Card>
        <CardHeader title="قائمة أكواد الخصم" subtitle="يمكن إيقاف الكود مؤقتًا دون حذفه" />
        <CardBody className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_220px_220px]">
            <div className="relative"><Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث بالكود أو الاسم..." className="pr-10 text-right" /></div>
            <Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">كل الحالات</option><option value="active">نشط الآن</option><option value="inactive">موقوف</option><option value="scheduled">مجدول</option><option value="expired">منتهي</option></Select>
            <Select value={type} onChange={(event) => setType(event.target.value)}><option value="all">كل الأنواع</option><option value="percentage">نسبة مئوية</option><option value="fixed">قيمة ثابتة</option></Select>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-surface-muted text-xs text-ink-muted"><tr><th className="p-3 text-right">الكود</th><th className="p-3 text-right">الخصم</th><th className="p-3 text-right">الشروط</th><th className="p-3 text-center">الفترة</th><th className="p-3 text-center">الاستخدام</th><th className="p-3 text-center">الحالة</th><th className="p-3 text-center">إجراءات</th></tr></thead>
              <tbody>
                {rows.map((item) => {
                  const usage = discountCodeUsage(salesInvoices, item.id);
                  const expired = Boolean(item.expiresAt && item.expiresAt < today);
                  const scheduled = Boolean(item.startsAt && item.startsAt > today);
                  return <tr key={item.id} className="border-t border-line align-top">
                    <td className="p-3"><div className="font-mono font-bold text-brand-600" dir="ltr">{item.code}</div><div className="mt-1 text-xs text-ink-muted">{item.name}</div></td>
                    <td className="p-3 font-semibold">{item.type === "percentage" ? `${item.value}%` : formatCurrency(item.value, settings.currency)}{item.maxDiscount ? <div className="mt-1 text-xs font-normal text-ink-muted">بحد أقصى {formatCurrency(item.maxDiscount, settings.currency)}</div> : null}</td>
                    <td className="p-3 text-xs leading-6 text-ink-muted"><div>الحد الأدنى: {item.minOrderTotal ? formatCurrency(item.minOrderTotal, settings.currency) : "بدون"}</div><div>نوع السعر: {!item.allowedPriceTypes?.length ? "الكل" : item.allowedPriceTypes[0] === "retail" ? "قطاعي" : "جملة"}</div><div>للعميل: {item.perCustomerLimit ? `${item.perCustomerLimit} مرة` : "غير محدود"}</div></td>
                    <td className="p-3 text-center text-xs"><div>{item.startsAt || "فورًا"}</div><div className="my-1 text-ink-faint">إلى</div><div>{item.expiresAt || "بدون انتهاء"}</div></td>
                    <td className="p-3 text-center"><span className="font-semibold">{usage}</span><span className="text-ink-muted"> / {item.usageLimit ?? "∞"}</span></td>
                    <td className="p-3 text-center"><button type="button" onClick={() => toggle(item)}><Badge tone={!item.active ? "slate" : expired ? "red" : scheduled ? "amber" : "green"}>{!item.active ? "موقوف" : expired ? "منتهي" : scheduled ? "مجدول" : "نشط"}</Badge></button></td>
                    <td className="p-3"><div className="flex justify-center gap-1"><Button size="icon" variant="ghost" onClick={() => openEdit(item)} title="تعديل"><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="text-red-600" onClick={() => setDeleteId(item.id)} title="حذف"><Trash2 className="h-4 w-4" /></Button></div></td>
                  </tr>;
                })}
                {!rows.length ? <tr><td colSpan={7} className="p-10 text-center text-ink-muted">لا توجد أكواد مطابقة للفلاتر.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} width="xl" title={editingId ? "تعديل كود الخصم" : "إضافة كود خصم"} subtitle="اترك الحدود الاختيارية بصفر لتكون غير محدودة" footer={<><Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button><Button onClick={save}>{editingId ? "حفظ التعديلات" : "إنشاء الكود"}</Button></>}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="كود الخصم" required><Input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="مثال: SAVE20" dir="ltr" /></Field>
          <Field label="اسم الحملة" required><Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="خصم افتتاح الفرع" /></Field>
          <Field label="نوع الخصم"><Select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as DiscountCodeType })}><option value="percentage">نسبة مئوية</option><option value="fixed">قيمة ثابتة</option></Select></Field>
          <Field label={form.type === "percentage" ? "نسبة الخصم %" : "قيمة الخصم"}><Input type="number" min="0" max={form.type === "percentage" ? 100 : undefined} value={form.value} onChange={(event) => setForm({ ...form, value: Number(event.target.value) })} /></Field>
          {form.type === "percentage" ? <Field label="أقصى قيمة للخصم"><Input type="number" min="0" value={form.maxDiscount} onChange={(event) => setForm({ ...form, maxDiscount: Number(event.target.value) })} /></Field> : null}
          <Field label="الحد الأدنى للفاتورة"><Input type="number" min="0" value={form.minOrderTotal} onChange={(event) => setForm({ ...form, minOrderTotal: Number(event.target.value) })} /></Field>
          <Field label="يبدأ من"><Input type="date" value={form.startsAt} onChange={(event) => setForm({ ...form, startsAt: event.target.value })} /></Field>
          <Field label="ينتهي في"><Input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} /></Field>
          <Field label="إجمالي مرات الاستخدام"><Input type="number" min="0" value={form.usageLimit} onChange={(event) => setForm({ ...form, usageLimit: Number(event.target.value) })} /></Field>
          <Field label="مرات الاستخدام لكل عميل"><Input type="number" min="0" value={form.perCustomerLimit} onChange={(event) => setForm({ ...form, perCustomerLimit: Number(event.target.value) })} /></Field>
          <Field label="يعمل مع سعر"><Select value={form.scope} onChange={(event) => setForm({ ...form, scope: event.target.value as FormState["scope"] })}><option value="all">القطاعي والجملة</option><option value="retail">القطاعي فقط</option><option value="wholesale">الجملة فقط</option></Select></Field>
          <Field label="الحالة"><Select value={form.active ? "active" : "inactive"} onChange={(event) => setForm({ ...form, active: event.target.value === "active" })}><option value="active">نشط</option><option value="inactive">موقوف</option></Select></Field>
        </div>
        <div className="mt-4 flex items-start gap-2 rounded-xl bg-surface-muted p-3 text-xs leading-5 text-ink-muted"><CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />يُعاد فحص صلاحية الكود وحدود استخدامه عند حفظ الفاتورة، وليس عند إدخاله فقط.</div>
      </Dialog>

      <ConfirmDialog open={Boolean(deleteId)} onClose={() => setDeleteId(null)} onConfirm={() => { if (!deleteId) return; updateSettings({ discountCodes: codes.filter((item) => item.id !== deleteId) }); toast.success("تم حذف كود الخصم"); }} title="حذف كود الخصم" message="سيتم حذف الكود ولن يمكن استخدامه في فواتير جديدة. الفواتير السابقة ستحتفظ ببيانات الخصم." confirmText="حذف" cancelText="إلغاء" variant="danger" />
    </div>
  );
}
