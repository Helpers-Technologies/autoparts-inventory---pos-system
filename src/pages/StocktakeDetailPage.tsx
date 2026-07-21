import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowRight, CheckCircle, Search, Trash2 } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { ConfirmDialog } from "../components/ui/Dialog";
import { useCatalog } from "../store/CatalogContext";
import { useAuth } from "../store/AuthContext";
import { useToast } from "../components/ui/Toast";
import { formatDate } from "../lib/format";
import { hasPermission } from "../lib/permissions";
import type { StocktakeItem } from "../types";
import { parseNumericInput } from "../lib/numberInput";
import { BarcodeScanInput } from "../features/products/BarcodeScanInput";
import { findProductScanCandidates } from "../lib/partSearch";

export function StocktakeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { stocktakes, products, updateStocktakeItems, applyStocktake, deleteStocktake } = useCatalog();
  const { currentUser } = useAuth();
  const canAdjust = hasPermission(currentUser, "inventory", "adjust");

  const [search, setSearch] = useState("");
  const [applyOpen, setApplyOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [localItems, setLocalItems] = useState<StocktakeItem[] | null>(null);

  const stk = stocktakes.find((s) => s.id === id);
  const items = localItems ?? (stk?.items ?? []);
  const q = search.trim().toLowerCase();
  const filtered = q ? items.filter((i) => i.productName.toLowerCase().includes(q)) : items;

  if (!stk) {
    return (
      <Card>
        <CardBody>
          <div className="text-center py-8">
            <div className="text-ink font-medium">الجردة غير موجودة</div>
            <Button className="mt-4" onClick={() => navigate("/stocktakes")}>
              العودة للقائمة
            </Button>
          </div>
        </CardBody>
      </Card>
    );
  }

  function setCountedQty(productId: string, value: number | null) {
    setLocalItems((prev) =>
      (prev ?? stk!.items).map((item) =>
        item.productId === productId ? { ...item, countedQty: value } : item
      )
    );
  }

  function setCountedLoose(productId: string, value: number | null) {
    setLocalItems((prev) =>
      (prev ?? stk!.items).map((item) =>
        item.productId === productId ? { ...item, countedLoose: value } : item
      )
    );
  }

  function saveLocalEdits() {
    if (!localItems) return;
    updateStocktakeItems(stk!.id, localItems);
    setLocalItems(null);
    toast.success("تم حفظ التغييرات");
  }

  function handleStocktakeScan(code: string) {
    if (stk?.status !== "draft" || !canAdjust) return;
    const candidates = findProductScanCandidates(products, code);
    if (candidates.length > 1) {
      toast.info(`يوجد ${candidates.length} بدائل لهذا الرقم`, "امسح باركود العبوة أو رقم القطعة لتحديد صنف الجرد");
      return;
    }
    const product = candidates[0]?.product;
    if (!product) {
      toast.error("القطعة غير موجودة", `لا يوجد باركود أو Part Number أو OEM مطابق: ${code}`);
      return;
    }
    const target = items.find((item) => item.productId === product.id);
    if (!target) {
      toast.error("القطعة ليست ضمن هذه الجردة", product.name);
      return;
    }
    setLocalItems((previous) =>
      (previous ?? stk.items).map((item) =>
        item.productId === product.id
          ? { ...item, countedQty: (item.countedQty ?? 0) + 1 }
          : item,
      ),
    );
    setSearch(product.name);
    toast.success("تم عدّ قطعة", `${product.name} — الإجمالي المعدود ${(target.countedQty ?? 0) + 1}`);
  }

  const isCounted = (i: StocktakeItem) => i.countedQty !== null || i.countedLoose != null;
  const hasVariance = (i: StocktakeItem) =>
    (i.countedQty !== null && i.countedQty !== i.systemQty) ||
    (i.countedLoose != null && i.countedLoose !== (i.systemLoose ?? 0));

  const countedCount = items.filter(isCounted).length;
  const variances = items.filter(hasVariance);
  const hasUnsavedChanges = localItems !== null;

  return (
    <>
      <PageHeader
        title={`جردة ${formatDate(stk.date)}`}
        description={`${items.length} منتج — ${countedCount} تم عدّه — ${variances.length} فروقات`}
        actions={
          <>
            <Button variant="outline" onClick={() => navigate("/stocktakes")}>
              <ArrowRight className="w-4 h-4" /> رجوع
            </Button>
            {hasUnsavedChanges && (
              <Button variant="outline" onClick={saveLocalEdits}>
                حفظ التغييرات
              </Button>
            )}
            {stk.status === "draft" && canAdjust && countedCount > 0 ? (
              <Button onClick={() => setApplyOpen(true)}>
                <CheckCircle className="w-4 h-4" /> تطبيق الجردة
              </Button>
            ) : null}
            {stk.status === "draft" && canAdjust ? (
              <Button variant="danger" onClick={() => setDelOpen(true)}>
                <Trash2 className="w-4 h-4" /> حذف
              </Button>
            ) : null}
          </>
        }
      />

      {stk.status === "applied" && (
        <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/30 rounded-lg p-3 text-sm text-emerald-800 dark:text-emerald-400">
          ✅ تم تطبيق هذه الجردة — تم تعديل الكميات في المخزون.
          {stk.appliedAt ? ` (${formatDate(stk.appliedAt.slice(0, 10))})` : ""}
        </div>
      )}

      {stk.status === "draft" && canAdjust ? (
        <Card>
          <CardBody className="flex flex-col md:flex-row md:items-center gap-3">
            <div className="min-w-48"><div className="text-sm font-semibold">الجرد بالاسكان</div><div className="text-xs text-ink-muted">كل اسكان يضيف وحدة واحدة للكمية المعدودة ويحفظها كمسودة</div></div>
            <BarcodeScanInput onScan={handleStocktakeScan} disabled={products.length === 0} className="flex-1" />
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-2">
        <StatCard label="إجمالي البنود" value={items.length} />
        <StatCard label="تم العدّ" value={countedCount} tone={countedCount === items.length ? "green" : "amber"} />
        <StatCard label="فروقات" value={variances.length} tone={variances.length > 0 ? "rose" : "green"} />
        <StatCard label="لم يُعدّ بعد" value={items.length - countedCount} />
      </div>

      {variances.length > 0 && (
        <Card>
          <CardHeader
            title={`الفروقات (${variances.length})`}
            subtitle="المنتجات التي يختلف عدّها الفعلي عن الكمية في النظام"
          />
          <CardBody>
            <Table>
              <THead>
                <TR>
                  <TH>المنتج</TH>
                  <TH className="text-end">كمية النظام</TH>
                  <TH className="text-end">الكمية المعدودة</TH>
                  <TH className="text-end">الفرق</TH>
                </TR>
              </THead>
              <TBody>
                {variances.map((v) => {
                  const diff = v.countedQty !== null ? v.countedQty - v.systemQty : 0;
                  const looseDiff = v.countedLoose != null ? v.countedLoose - (v.systemLoose ?? 0) : 0;
                  const negative = diff < 0 || (diff === 0 && looseDiff < 0);
                  return (
                    <TR key={v.productId}>
                      <TD className="font-medium text-ink">{v.productName}</TD>
                      <TD className="text-end">
                        {v.systemQty}
                        {v.piecesPerUnit ? ` + ${v.systemLoose ?? 0} قطعة` : ""}
                      </TD>
                      <TD className="text-end">
                        {v.countedQty ?? v.systemQty}
                        {v.piecesPerUnit ? ` + ${v.countedLoose ?? v.systemLoose ?? 0} قطعة` : ""}
                      </TD>
                      <TD className={`text-end font-semibold ${negative ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                        {diff !== 0 ? `${diff > 0 ? "+" : ""}${diff}` : ""}
                        {diff !== 0 && looseDiff !== 0 ? " و" : ""}
                        {looseDiff !== 0 ? `${looseDiff > 0 ? "+" : ""}${looseDiff} قطعة` : ""}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader
          title="جميع المنتجات"
          actions={
            <div className="relative">
              <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" />
              <Input
                className="ps-9 w-52"
                placeholder="بحث..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          }
        />
        <CardBody>
          <Table>
            <THead>
              <TR>
                <TH>المنتج</TH>
                <TH className="text-end w-32">كمية النظام</TH>
                <TH className="w-40">الكمية المعدودة</TH>
                <TH className="text-end w-24">الفرق</TH>
                <TH className="w-24">الحالة</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((item) => {
                const diff = item.countedQty !== null ? item.countedQty - item.systemQty : null;
                const looseDiff = item.countedLoose != null ? item.countedLoose - (item.systemLoose ?? 0) : null;
                const counted = isCounted(item);
                const variant = hasVariance(item);
                return (
                  <TR key={item.productId}>
                    <TD className="font-medium text-ink">{item.productName}</TD>
                    <TD className="text-end text-ink-muted">
                      {item.systemQty}
                      {item.piecesPerUnit ? (
                        <span className="text-xs text-ink-faint"> + {item.systemLoose ?? 0} قطعة</span>
                      ) : null}
                    </TD>
                    <TD>
                      {stk.status === "draft" ? (
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={0}
                            step="1"
                            className="w-24"
                            placeholder="كرتونة"
                            value={item.countedQty ?? ""}
                            onChange={(e) => {
                              const val = e.target.value === "" ? null : parseNumericInput(e.target.value);
                              setCountedQty(item.productId, val);
                            }}
                          />
                          {item.piecesPerUnit ? (
                            <Input
                              type="number"
                              min={0}
                              step="1"
                              className="w-20"
                              placeholder="قطعة"
                              title={`قطع مفكوكة (${item.piecesPerUnit} قطعة بالكرتونة)`}
                              value={item.countedLoose ?? ""}
                              onChange={(e) => {
                                const val = e.target.value === "" ? null : parseNumericInput(e.target.value);
                                setCountedLoose(item.productId, val);
                              }}
                            />
                          ) : null}
                        </div>
                      ) : (
                        <span>
                          {item.countedQty ?? "—"}
                          {item.piecesPerUnit && item.countedLoose != null ? ` + ${item.countedLoose} قطعة` : ""}
                        </span>
                      )}
                    </TD>
                    <TD className={`text-end font-medium ${!counted ? "text-ink-faint" : !variant ? "text-ink-muted" : (diff ?? 0) < 0 || ((diff ?? 0) === 0 && (looseDiff ?? 0) < 0) ? "text-rose-700 dark:text-rose-400" : "text-emerald-700 dark:text-emerald-400"}`}>
                      {!counted
                        ? "—"
                        : !variant
                        ? "0"
                        : [
                            diff !== null && diff !== 0 ? `${diff > 0 ? "+" : ""}${diff}` : "",
                            looseDiff !== null && looseDiff !== 0 ? `${looseDiff > 0 ? "+" : ""}${looseDiff} قطعة` : "",
                          ]
                            .filter(Boolean)
                            .join(" و")}
                    </TD>
                    <TD>
                      {!counted ? (
                        <Badge tone="slate">لم يُعدّ</Badge>
                      ) : !variant ? (
                        <Badge tone="green">مطابق</Badge>
                      ) : (
                        <Badge tone="rose">فرق</Badge>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={applyOpen}
        onClose={() => setApplyOpen(false)}
        onConfirm={() => {
          if (hasUnsavedChanges) {
            updateStocktakeItems(stk.id, localItems!);
            setLocalItems(null);
          }
          applyStocktake(stk.id);
          toast.success("تم تطبيق الجردة", `تم تعديل ${variances.length} منتج في المخزون`);
          setApplyOpen(false);
        }}
        title="تطبيق الجردة"
        message={`سيتم تعديل كميات ${variances.length > 0 ? variances.length : "لا"} منتج في المخزون. هذا الإجراء لا يمكن التراجع عنه.`}
        confirmText="تطبيق"
        variant={variances.length > 0 ? "danger" : undefined}
      />

      <ConfirmDialog
        open={delOpen}
        onClose={() => setDelOpen(false)}
        onConfirm={() => {
          deleteStocktake(stk.id);
          toast.success("تم حذف الجردة");
          navigate("/stocktakes");
        }}
        title="حذف الجردة"
        message="هل أنت متأكد من حذف الجردة؟"
        variant="danger"
        confirmText="حذف"
      />
    </>
  );
}

function StatCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "amber" | "green" | "rose";
}) {
  const colors: Record<string, string> = {
    slate: "text-ink",
    amber: "text-amber-700 dark:text-amber-400",
    green: "text-emerald-700 dark:text-emerald-400",
    rose: "text-rose-700 dark:text-rose-400",
  };
  return (
    <div className="bg-surface rounded-xl border border-line p-4">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${colors[tone]}`}>{value}</div>
    </div>
  );
}
