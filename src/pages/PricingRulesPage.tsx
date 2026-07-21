import { useMemo, useState } from "react";
import { AlertTriangle, BadgeDollarSign, Plus, Search, Tags, Trash2, TrendingUp } from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { Field, Input, Select } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { formatCurrency } from "../lib/format";
import { calculateTierPrice, useAutoPartsPro } from "../store/AutoPartsProContext";
import { useCatalog } from "../store/CatalogContext";
import { useSettings } from "../store/SettingsContext";
import type { PriceTierBasis } from "../types";

const BASIS_LABELS: Record<PriceTierBasis, string> = { retail: "سعر القطاعي", wholesale: "سعر الجملة", cost: "تكلفة الشراء" };

export function PricingRulesPage() {
  const { products } = useCatalog();
  const { settings } = useSettings();
  const pro = useAutoPartsPro();
  const toast = useToast();
  const [selectedTierId, setSelectedTierId] = useState(pro.priceTiers.find((tier) => tier.isDefault)?.id ?? pro.priceTiers[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [dialog, setDialog] = useState(false);
  const [name, setName] = useState("");
  const [basis, setBasis] = useState<PriceTierBasis>("retail");
  const [adjustmentPct, setAdjustmentPct] = useState(0);
  const [minMarginPct, setMinMarginPct] = useState(10);
  const selectedTier = pro.priceTiers.find((tier) => tier.id === selectedTierId);
  const activeProducts = products.filter((product) => !product.archived);
  const preview = useMemo(() => activeProducts
    .filter((product) => `${product.name} ${product.partNumber ?? ""} ${product.code}`.toLowerCase().includes(query.trim().toLowerCase()))
    .map((product) => {
      const price = calculateTierPrice(product, selectedTier);
      const marginPct = price > 0 ? ((price - product.purchasePrice) / price) * 100 : 0;
      return { product, price, marginPct, floorApplied: selectedTier ? marginPct + 0.01 < selectedTier.minMarginPct : false };
    }), [activeProducts, query, selectedTier]);

  function addTier() {
    if (!name.trim()) {
      toast.error("اسم شريحة السعر مطلوب");
      return;
    }
    const item = pro.addPriceTier({ name: name.trim(), basis, adjustmentPct, minMarginPct: Math.max(0, minMarginPct), active: true });
    setSelectedTierId(item.id);
    setDialog(false);
    setName("");
    setAdjustmentPct(0);
    toast.success("تمت إضافة شريحة السعر");
  }

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={BadgeDollarSign}
        title="محرك التسعير المتقدم"
        description="حدد سعر كل فئة عميل كنسبة من القطاعي أو الجملة أو التكلفة، مع حد ربح أدنى يمنع البيع الخاسر داخل الكاشير."
        stats={[
          { label: "شريحة سعر", value: pro.priceTiers.filter((tier) => tier.active).length },
          { label: "منتج مراقب", value: activeProducts.length },
          { label: "متوسط ربح الشريحة", value: `${Math.round(preview.reduce((sum, row) => sum + row.marginPct, 0) / Math.max(1, preview.length))}%` },
        ]}
        actions={<Button className="bg-amber-400 text-slate-950 hover:bg-amber-300" onClick={() => setDialog(true)}><Plus className="h-4 w-4" /> شريحة جديدة</Button>}
      />

      <div className="grid gap-4 xl:grid-cols-[0.85fr_1.5fr]">
        <Card>
          <CardHeader title="شرائح البيع" subtitle="أي تعديل ينعكس فورًا في نقطة البيع" />
          <CardBody className="space-y-3">
            {pro.priceTiers.map((tier) => (
              <button key={tier.id} type="button" onClick={() => setSelectedTierId(tier.id)} className={`w-full rounded-2xl border p-4 text-right transition ${selectedTierId === tier.id ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10" : "border-line hover:border-brand-300"}`}>
                <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Tags className="h-4 w-4 text-brand-600" /><strong>{tier.name}</strong></div><div className="flex gap-1">{tier.isDefault ? <Badge tone="blue">افتراضي</Badge> : null}<Badge tone={tier.active ? "green" : "slate"}>{tier.active ? "نشط" : "موقوف"}</Badge></div></div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-xl bg-surface-muted p-2"><span className="text-ink-faint">الأساس</span><div className="mt-1 font-semibold">{BASIS_LABELS[tier.basis]}</div></div><div className="rounded-xl bg-surface-muted p-2"><span className="text-ink-faint">التعديل</span><div className="mt-1 font-semibold" dir="ltr">{tier.adjustmentPct > 0 ? "+" : ""}{tier.adjustmentPct}%</div></div></div>
              </button>
            ))}
          </CardBody>
        </Card>

        <div className="space-y-4">
          {selectedTier ? <Card><CardHeader title={`إعدادات شريحة ${selectedTier.name}`} subtitle="الحد الأدنى يُحسب على تكلفة الشراء" actions={pro.priceTiers.length > 1 ? <Button size="sm" variant="ghost" className="text-red-600" onClick={() => { if (pro.deletePriceTier(selectedTier.id)) setSelectedTierId(pro.priceTiers.find((tier) => tier.id !== selectedTier.id)?.id ?? ""); }}><Trash2 className="h-4 w-4" /> حذف</Button> : undefined} /><CardBody className="grid gap-4 md:grid-cols-4"><Field label="اسم الشريحة"><Input value={selectedTier.name} onChange={(event) => pro.updatePriceTier(selectedTier.id, { name: event.target.value })} /></Field><Field label="أساس السعر"><Select value={selectedTier.basis} onChange={(event) => pro.updatePriceTier(selectedTier.id, { basis: event.target.value as PriceTierBasis })}>{Object.entries(BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field><Field label="تعديل النسبة" hint="السالب = خصم"><Input type="number" value={selectedTier.adjustmentPct} onChange={(event) => pro.updatePriceTier(selectedTier.id, { adjustmentPct: Number(event.target.value) })} /></Field><Field label="أقل هامش ربح %"><Input type="number" min="0" value={selectedTier.minMarginPct} onChange={(event) => pro.updatePriceTier(selectedTier.id, { minMarginPct: Math.max(0, Number(event.target.value)) })} /></Field></CardBody></Card> : null}

          <Card>
            <CardHeader title="معاينة الأسعار والربحية" subtitle="الأسعار هنا محسوبة لحظيًا ولا تغيّر سعر المنتج الأساسي" actions={<div className="relative w-64"><Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن قطعة" className="pr-10" /></div>} />
            <CardBody className="p-0"><div className="max-h-[500px] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-surface-muted text-xs text-ink-muted"><tr><th className="p-3 text-right">القطعة</th><th className="p-3 text-left">التكلفة</th><th className="p-3 text-left">سعر الشريحة</th><th className="p-3 text-center">هامش الربح</th></tr></thead><tbody>{preview.map(({ product, price, marginPct }) => <tr key={product.id} className="border-t border-line"><td className="p-3"><div className="font-semibold">{product.name}</div><div className="font-mono text-[11px] text-ink-faint" dir="ltr">{product.partNumber || product.code}</div></td><td className="p-3 text-left">{formatCurrency(product.purchasePrice, settings.currency)}</td><td className="p-3 text-left font-bold text-brand-700">{formatCurrency(price, settings.currency)}</td><td className="p-3 text-center"><Badge tone={marginPct < (selectedTier?.minMarginPct ?? 0) ? "red" : marginPct < 15 ? "amber" : "green"}>{Math.round(marginPct)}%</Badge></td></tr>)}</tbody></table></div></CardBody>
          </Card>
        </div>
      </div>

      <Card><CardBody className="flex items-start gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-500/10"><AlertTriangle className="h-5 w-5" /></div><div><div className="font-bold text-ink">حماية الربحية مفعلة</div><div className="mt-1 text-sm leading-6 text-ink-muted">إذا نتج عن الخصم سعر أقل من تكلفة الشراء + هامش الشريحة، يرفع النظام السعر تلقائيًا للحد الآمن. راجع تكلفة الشراء أولًا للحصول على نتيجة دقيقة.</div></div><TrendingUp className="mr-auto h-5 w-5 text-emerald-600" /></CardBody></Card>

      <Dialog open={dialog} onClose={() => setDialog(false)} title="إضافة شريحة سعر" footer={<><Button variant="outline" onClick={() => setDialog(false)}>إلغاء</Button><Button onClick={addTier}><Plus className="h-4 w-4" /> إضافة</Button></>}><div className="space-y-4"><Field label="اسم الشريحة" required><Input value={name} onChange={(event) => setName(event.target.value)} placeholder="مركز صيانة معتمد" /></Field><Field label="أساس الحساب"><Select value={basis} onChange={(event) => setBasis(event.target.value as PriceTierBasis)}>{Object.entries(BASIS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field><div className="grid grid-cols-2 gap-3"><Field label="التعديل %"><Input type="number" value={adjustmentPct} onChange={(event) => setAdjustmentPct(Number(event.target.value))} /></Field><Field label="أقل هامش %"><Input type="number" min="0" value={minMarginPct} onChange={(event) => setMinMarginPct(Number(event.target.value))} /></Field></div></div></Dialog>
    </div>
  );
}
