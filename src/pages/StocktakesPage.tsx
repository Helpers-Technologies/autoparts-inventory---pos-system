import { useNavigate } from "react-router-dom";
import { ClipboardList, Plus } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { EmptyState } from "../components/ui/EmptyState";
import { useCatalog } from "../store/CatalogContext";
import { useAuth } from "../store/AuthContext";
import { formatDate } from "../lib/format";
import { hasPermission } from "../lib/permissions";
import { todayISO } from "../lib/utils";

export function StocktakesPage() {
  const { stocktakes, products, addStocktake } = useCatalog();
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const canAdjust = hasPermission(currentUser, "inventory", "adjust");

  function handleNew() {
    const items = products
      .filter((p) => !p.archived)
      .map((p) => ({
        productId: p.id,
        productName: p.name,
        systemQty: p.quantity,
        countedQty: null as null,
        ...(p.piecesPerUnit
          ? {
              piecesPerUnit: p.piecesPerUnit,
              systemLoose: p.looseQuantity ?? 0,
              countedLoose: null as null,
            }
          : {}),
      }));
    const stk = addStocktake({
      date: todayISO(),
      items,
      notes: "",
    });
    navigate(`/stocktakes/${stk.id}`);
  }

  const draftCount = stocktakes.filter((s) => s.status === "draft").length;

  return (
    <>
      <PageHeader
        title="الجرد الدوري"
        description="عدّ المخزون الفعلي وتطبيق الفروقات"
        actions={
          canAdjust ? (
            <Button onClick={handleNew}>
              <Plus className="w-4 h-4" /> جرد جديد
            </Button>
          ) : null
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
        <StatCard label="إجمالي الجردات" value={stocktakes.length} />
        <StatCard label="مفتوحة" value={draftCount} tone="amber" />
        <StatCard label="المنتجات النشطة" value={products.filter((p) => !p.archived).length} />
      </div>

      <Card>
        <CardHeader title={`جردات المخزون (${stocktakes.length})`} />
        <CardBody>
          {stocktakes.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="w-5 h-5" />}
              title="لا توجد جردات بعد"
              description="اضغط «جرد جديد» لبدء جردة مخزون كاملة"
              action={
                canAdjust ? (
                  <Button onClick={handleNew}>
                    <Plus className="w-4 h-4" /> جرد جديد
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>التاريخ</TH>
                  <TH>البنود</TH>
                  <TH>تمت عدّه</TH>
                  <TH>الفروقات</TH>
                  <TH>الحالة</TH>
                </TR>
              </THead>
              <TBody>
                {stocktakes.map((stk) => {
                  const counted = stk.items.filter(
                    (i) => i.countedQty !== null || i.countedLoose != null
                  ).length;
                  const variances = stk.items.filter(
                    (i) =>
                      (i.countedQty !== null && i.countedQty !== i.systemQty) ||
                      (i.countedLoose != null && i.countedLoose !== (i.systemLoose ?? 0))
                  ).length;
                  return (
                    <TR
                      key={stk.id}
                      className="cursor-pointer hover:bg-surface-muted"
                      onClick={() => navigate(`/stocktakes/${stk.id}`)}
                    >
                      <TD>{formatDate(stk.date)}</TD>
                      <TD>{stk.items.length}</TD>
                      <TD>
                        <span className={counted === stk.items.length ? "text-emerald-700 dark:text-emerald-400 font-medium" : "text-amber-700 dark:text-amber-400"}>
                          {counted} / {stk.items.length}
                        </span>
                      </TD>
                      <TD>
                        {variances > 0 ? (
                          <span className="text-rose-700 dark:text-rose-400 font-medium">{variances}</span>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </TD>
                      <TD>
                        <Badge tone={stk.status === "applied" ? "green" : "amber"}>
                          {stk.status === "applied" ? "مطبق" : "مسودة"}
                        </Badge>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
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
  tone?: "slate" | "amber" | "green";
}) {
  const colors: Record<string, string> = {
    slate: "text-ink",
    amber: "text-amber-700 dark:text-amber-400",
    green: "text-emerald-700 dark:text-emerald-400",
  };
  return (
    <div className="bg-surface rounded-xl border border-line p-4">
      <div className="text-xs text-ink-faint">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${colors[tone]}`}>{value}</div>
    </div>
  );
}
