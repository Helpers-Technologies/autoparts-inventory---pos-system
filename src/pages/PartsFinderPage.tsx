import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CarFront, ChevronLeft, PackageSearch, Search } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select } from "../components/ui/Input";
import { SearchableSelect } from "../components/ui/SearchableSelect";
import { YearSelect } from "../components/ui/YearSelect";
import { useSettings } from "../store/SettingsContext";
import { useCatalog } from "../store/CatalogContext";
import { useVehicleCatalog } from "../store/VehicleCatalogContext";
import { formatCurrency } from "../lib/format";
import { productMatchesSearch } from "../lib/partSearch";

export function PartsFinderPage() {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const { products } = useCatalog();
  const catalog = useVehicleCatalog();
  const [makeId, setMakeId] = useState("");
  const [modelId, setModelId] = useState("");
  const [generationId, setGenerationId] = useState("");
  const [engineId, setEngineId] = useState("");
  const [year, setYear] = useState("");
  const [query, setQuery] = useState("");

  const models = catalog.vehicleModels.filter((model) => model.makeId === makeId && model.active);
  const generations = catalog.vehicleGenerations.filter((generation) => generation.modelId === modelId && generation.active);
  const engines = catalog.vehicleEngines.filter((engine) => engine.generationId === generationId && engine.active);

  const results = useMemo(() => {
    const selectedYear = year ? Number(year) : undefined;
    const matchingProductIds = new Set(
      catalog.productFitments
        .filter((fitment) => {
          if (makeId && fitment.makeId !== makeId) return false;
          if (modelId && fitment.modelId && fitment.modelId !== modelId) return false;
          if (generationId && fitment.generationId && fitment.generationId !== generationId) return false;
          if (engineId && fitment.engineId && fitment.engineId !== engineId) return false;
          if (selectedYear && fitment.yearFrom && selectedYear < fitment.yearFrom) return false;
          if (selectedYear && fitment.yearTo && selectedYear > fitment.yearTo) return false;
          return true;
        })
        .map((fitment) => fitment.productId),
    );
    return products
      .filter((product) => !product.archived)
      .filter((product) => (!makeId ? true : matchingProductIds.has(product.id)))
      .filter((product) => productMatchesSearch(product, query));
  }, [catalog.productFitments, engineId, generationId, makeId, modelId, products, query, year]);

  return (
    <>
      <PageHeader title="دليل قطع الغيار" description="ابحث برقم القطعة أو اختر السيارة للوصول إلى القطع المتوافقة والبدائل" />
      <Card>
        <CardHeader title="بيانات السيارة" subtitle="كلما حددت تفاصيل أكثر كانت النتيجة أدق" />
        <CardBody className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <Field label="الماركة">
            <SearchableSelect
              value={makeId}
              onChange={(value) => { setMakeId(value); setModelId(""); setGenerationId(""); setEngineId(""); }}
              options={catalog.specializedVehicleMakes.filter((make) => make.active).map((make) => ({
                value: make.id,
                label: make.nameAr ? `${make.nameAr} — ${make.name}` : make.name,
                image: `/vehicle-logos/${make.slug}.png`,
                searchText: `${make.name} ${make.nameAr ?? ""}`
              }))}
              placeholder="كل الماركات"
              minChars={1}
            />
          </Field>
          <Field label="الموديل">
            <SearchableSelect
              value={modelId}
              onChange={(value) => { setModelId(value); setGenerationId(""); setEngineId(""); }}
              options={models.map((model) => ({
                value: model.id,
                label: model.nameAr ? `${model.nameAr} — ${model.name}` : model.name
              }))}
              placeholder="كل الموديلات"
              disabled={!makeId}
              minChars={1}
            />
          </Field>
          <Field label="الجيل"><Select value={generationId} onChange={(e) => { setGenerationId(e.target.value); setEngineId(""); }} disabled={!modelId}><option value="">كل الأجيال</option>{generations.map((generation) => <option key={generation.id} value={generation.id}>{generation.name}</option>)}</Select></Field>
          <Field label="المحرك"><Select value={engineId} onChange={(e) => setEngineId(e.target.value)} disabled={!generationId}><option value="">كل المحركات</option>{engines.map((engine) => <option key={engine.id} value={engine.id}>{engine.name}{engine.code ? ` — ${engine.code}` : ""}</option>)}</Select></Field>
          <Field label="سنة الصنع"><YearSelect value={year} onChange={(val) => setYear(val)} placeholder="كل السنوات" /></Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="القطع المطابقة" subtitle={`${results.length} نتيجة`} />
        <CardBody className="space-y-3">
          <div className="relative max-w-xl"><Search className="absolute end-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-faint" /><Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="رقم القطعة، رقم OEM، الباركود، الاسم أو الماركة..." className="pe-9" /></div>
          {results.length === 0 ? (
            <EmptyState icon={makeId ? <PackageSearch className="w-6 h-6" /> : <CarFront className="w-6 h-6" />} title={makeId ? "لا توجد قطع مرتبطة بهذه السيارة" : "لا توجد نتائج"} description="اربط القطع بالسيارات من نموذج المنتج أو جرّب البحث برقم القطعة" />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {results.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => navigate(`/products/${product.id}`)}
                  className="group space-y-3 rounded-xl border border-line bg-surface p-4 text-right transition-all hover:-translate-y-0.5 hover:border-cyan-400 hover:shadow-lg hover:shadow-cyan-950/5 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
                  aria-label={`عرض تفاصيل ${product.name}`}
                >
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-semibold truncate">{product.name}</div><div className="font-mono text-xs text-ink-muted" dir="ltr">{product.partNumber || product.code}</div></div><Badge tone={product.quantity > 0 ? "green" : "red"}>{product.quantity > 0 ? `متوفر ${product.quantity}` : "غير متوفر"}</Badge></div>
                  <div className="flex flex-wrap gap-1">{product.partBrand ? <Badge tone="slate">{product.partBrand}</Badge> : null}{product.qualityGrade ? <Badge tone="slate">{product.qualityGrade}</Badge> : null}{product.warrantyMonths ? <Badge tone="blue">ضمان {product.warrantyMonths} شهر</Badge> : null}</div>
                  {product.oemNumbers?.length ? <div className="text-xs"><span className="text-ink-faint">OEM: </span><span className="font-mono" dir="ltr">{product.oemNumbers.join(" · ")}</span></div> : null}
                  <div className="flex items-center justify-between border-t border-line-soft pt-3"><span className="font-bold text-brand-700">{formatCurrency(product.retailPrice, settings.currency)}</span><span className="flex items-center gap-1 text-xs font-semibold text-cyan-700 transition-transform group-hover:-translate-x-1 dark:text-cyan-400">عرض التفاصيل <ChevronLeft className="h-3.5 w-3.5" /></span></div>
                </button>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
