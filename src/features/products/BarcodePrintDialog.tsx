import { useEffect, useRef, useState } from "react";
import JsBarcode from "jsbarcode";
import { Dialog } from "../../components/ui/Dialog";
import { Button } from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Input";
import { Minus, Plus, Printer } from "lucide-react";
import { printAppRoute } from "../../lib/print";

export function BarcodePrintDialog({
  open,
  onClose,
  productId,
  barcode,
  productName,
}: {
  open: boolean;
  onClose: () => void;
  productId: string;
  barcode: string;
  productName: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [copies, setCopies] = useState(1);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open || !svgRef.current) return;
    try {
      JsBarcode(svgRef.current, barcode, {
        format: "EAN13",
        width: 2,
        height: 70,
        displayValue: true,
        fontSize: 14,
        margin: 8,
        background: "#ffffff",
        lineColor: "#000000",
      });
      setError(false);
    } catch {
      setError(true);
    }
  }, [open, barcode]);

  async function handlePrint() {
    await printAppRoute(`/products/${productId}/barcode/print?copies=${copies}`);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="طباعة الباركود"
      subtitle={productName}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button onClick={handlePrint} disabled={error}>
            <Printer className="w-4 h-4" /> طباعة
          </Button>
        </>
      }
    >
      <div className="space-y-5 pt-2">
        <div className="flex justify-center rounded-lg border border-line bg-white p-4">
          {error ? (
            <div className="text-sm text-rose-500 text-center">
              رقم الباركود غير صالح للتحويل إلى EAN-13
            </div>
          ) : (
            <svg ref={svgRef} />
          )}
        </div>

        <Field label="عدد النسخ">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCopies((n) => Math.max(1, n - 1))}
            >
              <Minus className="w-4 h-4" />
            </Button>
            <Input
              type="number"
              min={1}
              max={100}
              value={copies}
              onChange={(e) => setCopies(Math.max(1, Math.min(100, Number(e.target.value))))}
              className="w-20 text-center"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setCopies((n) => Math.min(100, n + 1))}
            >
              <Plus className="w-4 h-4" />
            </Button>
          </div>
        </Field>
      </div>
    </Dialog>
  );
}
