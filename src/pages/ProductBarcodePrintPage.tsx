import { useEffect, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import JsBarcode from "jsbarcode";
import { useCatalog } from "../store/CatalogContext";
import { useAuth } from "../store/AuthContext";
import { hasPermission } from "../lib/permissions";
import { useFeatures } from "../lib/useFeatures";

export function ProductBarcodePrintPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const copies = Math.max(1, Math.min(100, Number(params.get("copies") ?? "1")));
  const { products } = useCatalog();
  const { currentUser, auth } = useAuth();
  const { isEnabled } = useFeatures();
  const barcodeEnabled = isEnabled("barcodeSystem");
  const product = products.find((p) => p.id === id);
  const containerRef = useRef<HTMLDivElement>(null);
  // Require an authenticated user with products "view"; the internal PDF window
  // (pre-authorized by main) is the only exception. Blocks the auto-print below
  // and the barcode render for unauthorized contexts.
  const isInternalPrint = Boolean(window.desktopAPI?.isInternalPrint);
  const authorized = isInternalPrint || (auth.isAuthenticated && hasPermission(currentUser, "products"));

  useEffect(() => {
    if (!authorized) return;
    if (!product?.barcode || !containerRef.current) return;
    const svgs = containerRef.current.querySelectorAll<SVGSVGElement>("svg[data-barcode]");
    svgs.forEach((svg) => {
      try {
        JsBarcode(svg, product.barcode!, {
          format: "EAN13",
          width: 2,
          height: 70,
          displayValue: true,
          fontSize: 13,
          margin: 6,
          background: "#ffffff",
          lineColor: "#000000",
        });
      } catch {
        /* invalid barcode value — skip rendering this label */
      }
    });
    window.print();
  }, [product, authorized]);

  if (!authorized) {
    return <div style={{ padding: 20 }}>ليس لديك صلاحية لعرض هذه الصفحة</div>;
  }

  if (!barcodeEnabled) {
    return <div style={{ padding: 20 }}>نظام الباركود غير مفعل في الباقة الحالية</div>;
  }

  if (!product) {
    return <div style={{ padding: 20 }}>المنتج غير موجود</div>;
  }

  if (!product.barcode) {
    return <div style={{ padding: 20 }}>هذا المنتج ليس له باركود</div>;
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        padding: 10,
        background: "#fff",
        direction: "rtl",
        fontFamily: "Arial, sans-serif",
      }}
    >
      {Array.from({ length: copies }).map((_, i) => (
        <div
          key={i}
          style={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            border: "1px dashed #bbb",
            padding: "6px 10px 4px",
            width: 200,
            background: "#fff",
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: "bold",
              textAlign: "center",
              marginBottom: 2,
              maxWidth: 180,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {product.name}
          </div>
          <div style={{ fontSize: 10, color: "#555", marginBottom: 4 }}>
            {product.code}
          </div>
          <svg data-barcode style={{ maxWidth: 180 }} />
        </div>
      ))}

      <style>{`
        @media print {
          body { margin: 0; }
          @page { margin: 8mm; }
        }
      `}</style>
    </div>
  );
}
