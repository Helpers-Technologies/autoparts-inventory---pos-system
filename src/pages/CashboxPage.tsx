import { useMemo, useState } from "react";
import { Plus, Minus, Wallet, HandCoins, Factory, NotebookPen, Search } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Field, Select, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useReporting } from "../store/ReportingContext";
import { useAuth } from "../store/AuthContext";
import { useSettings } from "../store/SettingsContext";
import { useToast } from "../components/ui/Toast";
import { todayISO, uid } from "../lib/utils";
import type { CashEntryType, PaymentMethod } from "../types";
import { formatCurrency, formatDate, PAYMENT_METHOD_LABELS } from "../lib/format";
import { hasPermission } from "../lib/permissions";

export function CashboxPage() {
  const { suppliers } = useCatalog();
  const { cashEntries, salesInvoices, purchaseInvoices, addCashEntry, currentCashBalance } = useInvoicing();
  const { supplierBalance } = useReporting();
  const { currentUser } = useAuth();
  const { settings, updateSettings } = useSettings();
  const toast = useToast();
  const canAddCash = hasPermission(currentUser, "cashbox", "add");
  const canSpendCash = hasPermission(currentUser, "cashbox", "spend");
  const canEditOpeningBalance = hasPermission(currentUser, "cashbox", "editOpeningBalance");

  const [open, setOpen] = useState(false);
  const [entryType, setEntryType] = useState<CashEntryType>("manual-add");
  const [amount, setAmount] = useState(0);
  const [desc, setDesc] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");

  const [openBalOpen, setOpenBalOpen] = useState(false);
  const [newOpening, setNewOpening] = useState(settings.openingBalance);

  const [cashQ, setCashQ] = useState("");
  const [cashType, setCashType] = useState("all");
  const [cashFrom, setCashFrom] = useState("");
  const [cashTo, setCashTo] = useState("");

  const filteredEntries = useMemo(() => {
    let list = [...cashEntries];
    if (cashQ.trim()) {
      const q = cashQ.trim().toLowerCase();
      list = list.filter((e) => e.description?.toLowerCase().includes(q));
    }
    if (cashType !== "all") list = list.filter((e) => e.type === cashType);
    if (cashFrom) list = list.filter((e) => e.date >= cashFrom);
    if (cashTo)   list = list.filter((e) => e.date <= cashTo);
    return list;
  }, [cashEntries, cashQ, cashType, cashFrom, cashTo]);

  const totalReceived = useMemo(
    () =>
      salesInvoices
        .filter((s) => !s.cancelled)
        .reduce((a, s) => a + s.amountReceived + (s.overpayment ?? 0), 0),
    [salesInvoices]
  );
  const totalPurchasePayments = useMemo(
    () => purchaseInvoices.reduce((a, s) => a + s.amountPaid + (s.overpayment ?? 0), 0),
    [purchaseInvoices]
  );
  const payables = useMemo(
    () => suppliers.reduce((a, s) => a + supplierBalance(s.id), 0),
    [suppliers, supplierBalance]
  );

  function submit() {
    if (amount <= 0) {
      toast.error("المبلغ يجب أن يكون أكبر من صفر");
      return;
    }
    if (!desc.trim()) {
      toast.error("الوصف مطلوب");
      return;
    }
    if (entryType === "manual-add" && !canAddCash) {
      toast.error("ليس لديك صلاحية", "لا تملك صلاحية إضافة نقدية");
      return;
    }
    if (entryType === "manual-remove" && !canSpendCash) {
      toast.error("ليس لديك صلاحية", "لا تملك صلاحية صرف نقدية");
      return;
    }
    if (entryType === "adjustment" && !canAddCash && !canSpendCash) {
      toast.error("ليس لديك صلاحية", "لا تملك صلاحية تسجيل تسوية");
      return;
    }
    const signed = entryType === "manual-add" ? amount : -amount;
    addCashEntry({
      id: uid("cash_m"),
      type: entryType,
      amount: signed,
      description: desc.trim(),
      date: todayISO(),
      paymentMethod,
    });
    toast.success(entryType === "manual-add" ? "تم إضافة نقدية" : "تم خصم نقدية");
    setOpen(false);
    setAmount(0);
    setDesc("");
    setPaymentMethod("cash");
  }

  return (
    <>
      <PageHeader
        title="الخزينة"
        description="رصيد نقدي، إيداعات، صرف، وسجل مالي"
        actions={
          canEditOpeningBalance || canAddCash || canSpendCash ? (
            <>
              {canEditOpeningBalance ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setNewOpening(settings.openingBalance);
                    setOpenBalOpen(true);
                  }}
                >
                  الرصيد الافتتاحي
                </Button>
              ) : null}
              {canAddCash ? (
                <Button
                  onClick={() => {
                    setEntryType("manual-add");
                    setOpen(true);
                  }}
                >
                  <Plus className="w-4 h-4" /> إضافة نقدية
                </Button>
              ) : null}
              {canSpendCash ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setEntryType("manual-remove");
                    setOpen(true);
                  }}
                >
                  <Minus className="w-4 h-4" /> صرف
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Stat icon={<Wallet className="w-5 h-5" />} label="الرصيد الحالي" value={formatCurrency(currentCashBalance(), settings.currency)} tone="green" />
        <Stat icon={<HandCoins className="w-5 h-5" />} label="إجمالي المحصل" value={formatCurrency(totalReceived, settings.currency)} tone="blue" />
        <Stat icon={<Factory className="w-5 h-5" />} label="مدفوعات الموردين" value={formatCurrency(totalPurchasePayments, settings.currency)} tone="amber" />
      </div>

      <Card>
        <CardHeader
          title="دفتر الخزينة"
          subtitle={`الرصيد الافتتاحي: ${formatCurrency(settings.openingBalance, settings.currency)} • مستحقات على الموردين: ${formatCurrency(payables, settings.currency)}`}
        />
        <CardBody className="space-y-3">
          <div className="flex gap-2 items-center flex-wrap">
            <div className="relative w-52">
              <Search className="w-4 h-4 absolute top-1/2 -translate-y-1/2 end-3 text-ink-faint" />
              <Input
                value={cashQ}
                onChange={(e) => setCashQ(e.target.value)}
                placeholder="بحث في البيان..."
                className="pe-9"
              />
            </div>
            <div className="inline-flex items-center gap-1 bg-surface-muted p-1 rounded-lg">
              <span className="px-2 text-xs text-ink-faint select-none">النوع:</span>
              {([
                { key: "all",              label: "الكل" },
                { key: "sales-receipt",    label: "تحصيل" },
                { key: "purchase-payment", label: "مشتريات" },
                { key: "manual-add",       label: "إضافة" },
                { key: "manual-remove",    label: "صرف" },
                { key: "adjustment",       label: "تسوية" },
              ] as const).map((b) => (
                <button
                  key={b.key}
                  onClick={() => setCashType(b.key)}
                  className={`px-3 h-8 text-xs rounded-md transition-colors ${
                    cashType === b.key ? "bg-surface text-brand-700 shadow-sm" : "text-ink-muted hover:text-ink"
                  }`}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1 bg-surface-muted px-3 py-1.5 rounded-lg">
              <span className="text-xs text-ink-faint select-none">من:</span>
              <input type="date" value={cashFrom} onChange={(e) => setCashFrom(e.target.value)} className="bg-transparent text-xs text-ink outline-none w-28" />
            </div>
            <div className="flex items-center gap-1 bg-surface-muted px-3 py-1.5 rounded-lg">
              <span className="text-xs text-ink-faint select-none">إلى:</span>
              <input type="date" value={cashTo} onChange={(e) => setCashTo(e.target.value)} className="bg-transparent text-xs text-ink outline-none w-28" />
            </div>
            {(cashFrom || cashTo || cashQ || cashType !== "all") && (
              <button
                type="button"
                onClick={() => { setCashQ(""); setCashType("all"); setCashFrom(""); setCashTo(""); }}
                className="text-xs text-ink-faint hover:text-ink transition-colors"
              >
                مسح الفلاتر
              </button>
            )}
            <span className="text-xs text-ink-faint me-auto">{filteredEntries.length} حركة</span>
          </div>
          {cashEntries.length === 0 ? (
            <EmptyState
              icon={<NotebookPen className="w-5 h-5" />}
              title="لا توجد حركات بالخزينة"
              description="سيتم تسجيل كل دفعة تلقائياً هنا."
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>التاريخ</TH>
                  <TH>النوع</TH>
                  <TH>البيان</TH>
                  <TH>وسيلة الدفع</TH>
                  <TH className="text-end">المبلغ</TH>
                </TR>
              </THead>
              <TBody>
                {filteredEntries.map((c) => (
                  <TR key={c.id}>
                    <TD>{formatDate(c.date)}</TD>
                    <TD>
                      <TypeBadge type={c.type} />
                    </TD>
                    <TD className="text-ink-muted">{c.description}</TD>
                    <TD className="text-ink-faint text-sm">
                      {c.paymentMethod ? PAYMENT_METHOD_LABELS[c.paymentMethod] : "—"}
                    </TD>
                    <TD
                      className={`text-end font-medium ${
                        c.amount >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                      }`}
                    >
                      {c.amount >= 0 ? "+" : ""}
                      {formatCurrency(c.amount, settings.currency)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={entryType === "manual-add" ? "إضافة نقدية" : "صرف"}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={submit}>حفظ</Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="النوع">
            <Select value={entryType} onChange={(e) => setEntryType(e.target.value as CashEntryType)}>
              {canAddCash ? <option value="manual-add">إضافة نقدية</option> : null}
              {canSpendCash ? <option value="manual-remove">صرف</option> : null}
              {canAddCash || canSpendCash ? <option value="adjustment">تسوية / ملاحظة</option> : null}
            </Select>
          </Field>
          <Field label="المبلغ" required>
            <Input
              type="number"
              min={0.01}
              step="0.01"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value))}
            />
          </Field>
          <Field label="طريقة الدفع">
            <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
              {Object.entries(PAYMENT_METHOD_LABELS).filter(([k]) => k !== "credit").map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </Field>
          <Field label="البيان" required>
            <Textarea
              rows={2}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="مثل: إيداع من صاحب المحل، صرف مصاريف..."
            />
          </Field>
        </div>
      </Dialog>

      <Dialog
        open={openBalOpen}
        onClose={() => setOpenBalOpen(false)}
        title="تعديل الرصيد الافتتاحي"
        footer={
          <>
            <Button variant="outline" onClick={() => setOpenBalOpen(false)}>إلغاء</Button>
            <Button
              onClick={() => {
                updateSettings({ openingBalance: Math.max(0, newOpening) });
                toast.success("تم تحديث الرصيد الافتتاحي");
                setOpenBalOpen(false);
              }}
            >
              حفظ
            </Button>
          </>
        }
      >
        <Field label="الرصيد الافتتاحي للخزينة">
          <Input type="number" step="0.01" value={newOpening} onChange={(e) => setNewOpening(Number(e.target.value))} />
        </Field>
      </Dialog>
    </>
  );
}

function TypeBadge({ type }: { type: CashEntryType }) {
  if (type === "sales-receipt") return <Badge tone="green">تحصيل مبيعات</Badge>;
  if (type === "purchase-payment") return <Badge tone="blue">سداد مشتريات</Badge>;
  if (type === "manual-add") return <Badge tone="emerald">إضافة يدوية</Badge>;
  if (type === "manual-remove") return <Badge tone="rose">صرف يدوي</Badge>;
  return <Badge tone="amber">تسوية</Badge>;
}

function Stat({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "green" | "blue" | "amber" | "rose" | "violet";
}) {
  const colors: Record<string, string> = {
    green: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-300",
    blue: "bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-400 dark:bg-blue-500/15 dark:text-blue-300",
    amber: "bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 dark:bg-amber-500/15 dark:text-amber-300",
    emerald: "bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    rose: "bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400",
    violet: "bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400",
  };
  return (
    <div className="bg-surface rounded-xl border border-line p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-lg grid place-items-center ${colors[tone]}`}>
        {icon}
      </div>
      <div>
        <div className="text-xs text-ink-muted">{label}</div>
        <div className="font-semibold text-ink">{value}</div>
      </div>
    </div>
  );
}
