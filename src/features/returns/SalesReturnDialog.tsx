import { useState } from "react";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table";
import { useInvoicing } from "../../store/InvoicingContext";
import { useSettings } from "../../store/SettingsContext";
import { useToast } from "../../components/ui/Toast";
import type { SalesInvoice, ReturnLine } from "../../types";
import { formatCurrency } from "../../lib/format";
import { todayISO, uid } from "../../lib/utils";

export function SalesReturnDialog({
  open,
  onClose,
  invoice,
}: {
  open: boolean;
  onClose: () => void;
  invoice: SalesInvoice;
}) {
  const { addSalesReturn, salesReturns } = useInvoicing();
  const { settings } = useSettings();
  const toast = useToast();

  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [refundCash, setRefundCash] = useState(false);

  // Compute already-returned quantities per line so users can't over-return
  const returnedQtyByLineId = new Map<string, number>();
  salesReturns
    .filter((r) => r.originalInvoiceId === invoice.id)
    .forEach((r) =>
      r.lines.forEach((rl) => {
        const key = rl.sourceLineId ?? rl.id;
        returnedQtyByLineId.set(key, (returnedQtyByLineId.get(key) ?? 0) + rl.quantity);
      })
    );

  const selectedLines = invoice.lines.filter((l) => (quantities[l.id] || 0) > 0);
  const total = selectedLines.reduce(
    (acc, l) => acc + (quantities[l.id] || 0) * l.price,
    0
  );
  // FIX-05: Track cumulative returns to prevent exceeding invoice total
  const previousReturnsTotal = salesReturns
    .filter((r) => r.originalInvoiceId === invoice.id)
    .reduce((sum, r) => sum + r.total, 0);
  const maxReturnable = Math.max(0, invoice.total - previousReturnsTotal);

  function handleSave() {
    if (selectedLines.length === 0) {
      toast.error("الرجاء تحديد كميات للإرجاع");
      return;
    }
    // FIX-05: Prevent total return value from exceeding invoice total
    if (total > maxReturnable + 0.005) {
      toast.error(
        "قيمة المرتجع تتجاوز المتبقي من الفاتورة",
        `الحد الأقصى المتاح للإرجاع: ${maxReturnable.toFixed(2)}`
      );
      return;
    }

    const returnLines: ReturnLine[] = selectedLines.map((l) => {
      const q = quantities[l.id] || 0;
      return {
        id: uid("rl"),
        sourceLineId: l.id,
        productId: l.productId,
        productName: l.productName,
        unit: l.unit,
        quantity: q,
        price: l.price,
        priceType: l.priceType,
        subtotal: q * l.price,
        isRetailUnit: l.isRetailUnit,
      };
    });

    const refundable = invoice.amountReceived + (invoice.overpayment ?? 0);
    if (refundCash && total > refundable) {
      toast.error(
        "لا يمكن رد كاش أكبر من المحصل",
        "اختر خصم من الرصيد أو قلل كمية المرتجع"
      );
      return;
    }

    addSalesReturn({
      date: todayISO(),
      originalInvoiceId: invoice.id,
      originalInvoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId,
      customerName: invoice.customerName,
      lines: returnLines,
      total,
      refundCash,
    });

    toast.success("تم إنشاء مرتجع مبيعات بنجاح");
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`إنشاء مرتجع - فاتورة ${invoice.invoiceNumber}`}
      width="lg"
      footer={
        <>
          <div className="flex-1 text-right text-lg font-bold text-ink">
            الإجمالي: {formatCurrency(total, settings.currency)}
          </div>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={handleSave} disabled={total === 0}>
            اعتماد المرتجع
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Table>
          <THead>
            <TR>
              <TH>المنتج</TH>
              <TH>السعر</TH>
              <TH>الكمية المتاحة</TH>
              <TH className="w-32">كمية الإرجاع</TH>
              <TH className="text-end">القيمة</TH>
            </TR>
          </THead>
          <TBody>
            {invoice.lines
              .map((l) => ({
                ...l,
                availableQty: Math.max(0, l.quantity - (returnedQtyByLineId.get(l.id) ?? 0)),
              }))
              .filter((l) => l.availableQty > 0)
              .map((l) => {
                const q = quantities[l.id] || 0;
                return (
                  <TR key={l.id}>
                    <TD>{l.productName}</TD>
                    <TD>{formatCurrency(l.price, settings.currency)}</TD>
                    <TD>{l.availableQty}</TD>
                    <TD>
                      <input
                        type="number"
                        min={0}
                        max={l.availableQty}
                        className="w-full border-line rounded-md text-sm p-1.5 focus:border-brand-500 focus:ring-brand-500"
                        value={q || ""}
                        onChange={(e) => {
                          let val = Number(e.target.value);
                          if (val < 0) val = 0;
                          if (val > l.availableQty) val = l.availableQty;
                          setQuantities((prev) => ({ ...prev, [l.id]: val }));
                        }}
                      />
                    </TD>
                    <TD className="text-end font-medium">
                      {formatCurrency(q * l.price, settings.currency)}
                    </TD>
                  </TR>
                );
              })}
          </TBody>
        </Table>

        <div className="bg-surface-muted border border-line rounded-lg p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-ink-muted">
            <input
              type="checkbox"
              checked={refundCash}
              onChange={(e) => setRefundCash(e.target.checked)}
              className="rounded border-line text-brand-600 focus:ring-brand-500"
            />
            رد القيمة كاش (تسجيل حركة سحب من الخزينة)
          </label>
          <p className="text-xs text-ink-faint mt-1 mr-6">
            إذا لم تقم بتحديد هذا الخيار، سيتم خصم القيمة من مديونية العميل وتحديث الفاتورة.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
