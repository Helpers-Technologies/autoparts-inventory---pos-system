import { useEffect, useMemo, useState } from "react";
import { ArrowLeftRight, Link2, PackageSearch, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { SearchableProductSelect } from "../components/ui/SearchableProductSelect";
import { useToast } from "../components/ui/Toast";
import { formatCurrency } from "../lib/format";
import { productMatchesSearch } from "../lib/partSearch";
import { useCatalog } from "../store/CatalogContext";
import { useSettings } from "../store/SettingsContext";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import type { PartAlternativeRelation } from "../types";

const RELATION_LABELS: Record<PartAlternativeRelation, string> = {
  equivalent: "بديل مطابق",
  economy: "بديل اقتصادي",
  premium: "بديل أعلى جودة",
  superseded: "رقم بديل / مُحدّث",
};

export function PartAlternativesPage() {
  const { products } = useCatalog();
  const { settings } = useSettings();
  const vehicleCatalog = useVehicleCatalog();
  const toast = useToast();
  const activeProducts = useMemo(() => products.filter((product) => !product.archived), [products]);
  // The "original" side of a cross-reference link must be the genuine/agency part —
  // alternatives (aftermarket, OEM, economy...) are what gets linked to it, not the other way around.
  const genuineProducts = useMemo(() => activeProducts.filter((product) => product.qualityGrade === "genuine"), [activeProducts]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(genuineProducts[0]?.id ?? "");
  const [alternativeId, setAlternativeId] = useState("");
  const [relation, setRelation] = useState<PartAlternativeRelation>("equivalent");
  const [notes, setNotes] = useState("");
  const selected = activeProducts.find((product) => product.id === selectedId);
  const productById = useMemo(() => new Map(activeProducts.map((product) => [product.id, product])), [activeProducts]);
  const selectedLinks = useMemo(
    () => vehicleCatalog.productAlternatives.filter((link) => link.productId === selectedId || link.alternativeProductId === selectedId),
    [selectedId, vehicleCatalog.productAlternatives],
  );

  const alternativeCandidates = useMemo(
    () => activeProducts.filter((product) => product.id !== selectedId),
    [activeProducts, selectedId],
  );

  // If the selection is no longer a genuine part (e.g. loaded from older data,
  // or its quality grade changed), clear it rather than silently allow a
  // non-genuine "original" side.
  useEffect(() => {
    if (selectedId && !genuineProducts.some((product) => product.id === selectedId)) {
      setSelectedId("");
    }
  }, [genuineProducts, selectedId]);

  const searchResults = query.trim()
    ? genuineProducts.filter((product) => productMatchesSearch(product, query)).slice(0, 20)
    : [];

  // Index fitments by product once per change instead of re-scanning the full
  // fitments array for every candidate — O(products + fitments) instead of
  // O(products * fitments), which was the slow/unindexed part of this search.
  const fitmentsByProduct = useMemo(() => {
    const map = new Map<string, typeof vehicleCatalog.productFitments>();
    for (const fitment of vehicleCatalog.productFitments) {
      const list = map.get(fitment.productId);
      if (list) list.push(fitment);
      else map.set(fitment.productId, [fitment]);
    }
    return map;
  }, [vehicleCatalog.productFitments]);

  const suggestions = useMemo(() => {
    if (!selected) return [];
    const linkedIds = new Set(selectedLinks.flatMap((link) => [link.productId, link.alternativeProductId]));
    const selectedFitments = fitmentsByProduct.get(selected.id) ?? [];
    const selectedOem = new Set((selected.oemNumbers ?? []).map((value) => value.toLowerCase()));
    return activeProducts
      .filter((candidate) => candidate.id !== selected.id && !linkedIds.has(candidate.id))
      .map((candidate) => {
        let score = 0;
        const reasons: string[] = [];
        if (candidate.category === selected.category) { score += 2; reasons.push("نفس التصنيف"); }
        if ((candidate.oemNumbers ?? []).some((value) => selectedOem.has(value.toLowerCase()))) { score += 6; reasons.push("OEM مشترك"); }

        // Vehicle-fitment match: engine match is the strongest signal (same
        // engine ⇒ near-certain fit), generation is next, then bare make/model.
        const candidateFitments = fitmentsByProduct.get(candidate.id) ?? [];
        let vehicleScore = 0;
        let vehicleReason = "";
        for (const cf of candidateFitments) {
          for (const sf of selectedFitments) {
            if (sf.makeId !== cf.makeId) continue;
            if (sf.modelId && cf.modelId && sf.modelId !== cf.modelId) continue;
            let matchScore = 4;
            let reason = "توافق سيارة مشترك";
            if (sf.engineId && cf.engineId && sf.engineId === cf.engineId) {
              matchScore = 8;
              reason = "نفس المحرك بالضبط";
            } else if (sf.generationId && cf.generationId && sf.generationId === cf.generationId) {
              matchScore = 6;
              reason = "نفس الجيل";
            }
            if (matchScore > vehicleScore) {
              vehicleScore = matchScore;
              vehicleReason = reason;
            }
          }
        }
        if (vehicleScore > 0) {
          score += vehicleScore;
          reasons.push(vehicleReason);
        }

        return { candidate, score, reasons };
      })
      .filter((row) => row.score >= 4)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [activeProducts, selected, selectedLinks, fitmentsByProduct]);

  function addAlternative() {
    if (!selectedId || !alternativeId || selectedId === alternativeId) {
      toast.error("اختر القطعة والبديل");
      return;
    }
    const duplicate = vehicleCatalog.productAlternatives.some((link) =>
      (link.productId === selectedId && link.alternativeProductId === alternativeId) ||
      (link.productId === alternativeId && link.alternativeProductId === selectedId)
    );
    if (duplicate) {
      toast.error("البديل مسجل بالفعل");
      return;
    }
    vehicleCatalog.addProductAlternative({ productId: selectedId, alternativeProductId: alternativeId, relation, notes: notes.trim() || undefined });
    setAlternativeId("");
    setNotes("");
    toast.success("تم ربط البديل", "سيظهر أثناء البحث عن رقم القطعة أو OEM.");
  }

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={ArrowLeftRight}
        title="بدائل وأرقام قطع الغيار"
        description="اربط الأصلي بالتجاري والاقتصادي، وسجل الأرقام التي تم استبدالها، واعرض البديل المتوفر عندما تنفد القطعة المطلوبة."
        stats={[
          { label: "علاقة بديل", value: vehicleCatalog.productAlternatives.length },
          { label: "منتج له بدائل", value: new Set(vehicleCatalog.productAlternatives.flatMap((link) => [link.productId, link.alternativeProductId])).size },
          { label: "اقتراح ذكي", value: suggestions.length },
        ]}
      />

      <Card>
        <CardHeader title="بحث Cross Reference" subtitle="دوّر على القطعة الأصلية (أصلي توكيل) بـ Part Number أو OEM أو الباركود أو الاسم" />
        <CardBody>
          <div className="relative"><Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="مثال: 26300-35505" className="pr-10" dir="ltr" /></div>
          {searchResults.length > 0 ? <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-4">{searchResults.map((product) => <button key={product.id} type="button" onClick={() => { setSelectedId(product.id); setQuery(""); }} className="rounded-xl border border-line p-3 text-right hover:border-cyan-500"><div className="font-mono text-xs text-cyan-700" dir="ltr">{product.partNumber || product.code}</div><div className="mt-1 line-clamp-2 text-sm font-semibold text-ink">{product.name}</div><div className="mt-1 text-xs text-ink-faint">{product.partBrand || "بدون ماركة"}</div></button>)}</div> : null}
        </CardBody>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[0.95fr_1.4fr]">
        <Card>
          <CardHeader title="إضافة بديل" subtitle="الربط لا يغير المخزون أو الأسعار" />
          <CardBody className="space-y-4">
            <Field label="القطعة الأصلية" hint="بيظهر هنا القطع المسجلة بدرجة جودة «أصلي توكيل» فقط — البدائل (تجاري/OEM/اقتصادي) بتتربط بيها من حقل «المنتج البديل» تحت.">
              <SearchableProductSelect
                products={genuineProducts}
                value={selectedId}
                onChange={setSelectedId}
                placeholder="اختر القطعة الأصلية"
                searchPlaceholder="ابحث برقم القطعة أو OEM أو الاسم..."
              />
            </Field>
            {selected ? <div className="rounded-2xl border border-cyan-200 bg-cyan-50/60 p-4 dark:border-cyan-500/30 dark:bg-cyan-500/10"><div className="font-mono text-xs text-cyan-700" dir="ltr">{selected.partNumber}</div><div className="mt-1 font-bold text-ink">{selected.name}</div><div className="mt-2 flex flex-wrap gap-2"><Badge tone="blue">{selected.partBrand || "بدون ماركة"}</Badge><Badge tone="slate">{selected.category}</Badge><Badge tone={selected.quantity > 0 ? "green" : "red"}>{selected.quantity} {selected.unit}</Badge></div></div> : null}
            <Field label="المنتج البديل">
              <SearchableProductSelect
                products={alternativeCandidates}
                value={alternativeId}
                onChange={setAlternativeId}
                placeholder="اختر البديل"
                searchPlaceholder="ابحث برقم القطعة أو OEM أو الاسم..."
              />
            </Field>
            <Field label="نوع العلاقة"><Select value={relation} onChange={(event) => setRelation(event.target.value as PartAlternativeRelation)}>{Object.entries(RELATION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></Field>
            <Field label="ملاحظات المطابقة"><Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="مثال: يلزم تغيير الجلبة مع الموديل القديم" /></Field>
            <Button className="w-full" onClick={addAlternative}><Link2 className="h-4 w-4" /> ربط البديل</Button>
          </CardBody>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="البدائل المسجلة" subtitle={selected?.name || "اختر القطعة الأصلية"} />
            <CardBody>
              {selectedLinks.length === 0 ? <EmptyState icon={<PackageSearch className="h-6 w-6" />} title="لا توجد بدائل مسجلة" /> : <div className="space-y-2">{selectedLinks.map((link) => {
                const otherId = link.productId === selectedId ? link.alternativeProductId : link.productId;
                const product = productById.get(otherId);
                if (!product) return null;
                return <div key={link.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line p-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="font-mono text-xs text-brand-700" dir="ltr">{product.partNumber || product.code}</span><Badge tone={link.relation === "economy" ? "amber" : link.relation === "premium" ? "indigo" : "green"}>{RELATION_LABELS[link.relation]}</Badge></div><div className="mt-1 font-semibold text-ink">{product.name}</div><div className="mt-1 text-xs text-ink-muted">{product.partBrand || "—"} · {formatCurrency(product.retailPrice, settings.currency)} · مخزون {product.quantity}</div>{link.notes ? <div className="mt-1 text-xs text-ink-faint">{link.notes}</div> : null}</div><Button size="icon" variant="ghost" className="shrink-0 text-red-600" onClick={() => vehicleCatalog.deleteProductAlternative(link.id)}><Trash2 className="h-4 w-4" /></Button></div>;
              })}</div>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-500" /> اقتراحات المطابقة</span>} subtitle="حسب OEM والتصنيف وتوافق السيارات — راجعها قبل الاعتماد" />
            <CardBody>
              {suggestions.length === 0 ? <div className="text-sm text-ink-faint">لا توجد اقتراحات قوية لهذه القطعة.</div> : <div className="grid gap-2 md:grid-cols-2">{suggestions.map(({ candidate, reasons }) => <div key={candidate.id} className="rounded-2xl border border-line p-3"><div className="font-mono text-xs text-brand-700" dir="ltr">{candidate.partNumber || candidate.code}</div><div className="mt-1 text-sm font-semibold text-ink">{candidate.name}</div><div className="mt-2 flex flex-wrap gap-1">{reasons.map((reason) => <Badge key={reason} tone="blue">{reason}</Badge>)}</div><Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setAlternativeId(candidate.id)}><Plus className="h-3.5 w-3.5" /> اختياره كبديل</Button></div>)}</div>}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
