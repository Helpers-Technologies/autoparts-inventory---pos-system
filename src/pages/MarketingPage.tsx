import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Copy,
  Crown,
  Download,
  HeartHandshake,
  Lightbulb,
  Megaphone,
  MessageCircle,
  Phone,
  PhoneOff,
  Receipt,
  Repeat2,
  Save,
  ShieldCheck,
  Sparkles,
  Target,
  UserPlus,
  Users,
} from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { PaidFeatureNotice } from "../components/PaidFeatureNotice";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/Tabs";
import { formatCurrency, formatDate } from "../lib/format";
import {
  MARKETING_SEGMENTS,
  buildCategoryInsights,
  buildCustomerMarketingProfiles,
  renderMarketingMessage,
  selectMarketingAudience,
  summarizeMarketingProfiles,
  type CustomerMarketingProfile,
  type MarketingAudienceFilter,
  type MarketingSegmentId,
} from "../lib/marketing";
import { lsGet, lsSet } from "../lib/storage";
import { todayISO, uid } from "../lib/utils";
import { useFeatures } from "../lib/useFeatures";
import { useToast } from "../components/ui/Toast";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";

type CampaignGoal = "winback" | "vip" | "welcome" | "cross_sell" | "maintenance" | "custom";
type ContactStatus = "contacted" | "responded" | "converted" | "skipped";

interface CampaignRecord {
  id: string;
  name: string;
  goal: CampaignGoal;
  segment: MarketingAudienceFilter;
  message: string;
  audienceCount: number;
  createdAt: string;
}

interface ContactRecord {
  id: string;
  customerId: string;
  campaignName: string;
  status: ContactStatus;
  createdAt: string;
}

const CAMPAIGN_STORAGE_KEY = "marketingCampaigns";
const CONTACT_STORAGE_KEY = "marketingContactLog";

const CAMPAIGN_GOALS: Record<
  CampaignGoal,
  { label: string; segment: MarketingAudienceFilter; name: string; message: string; tip: string }
> = {
  winback: {
    label: "استعادة العملاء",
    segment: "at_risk",
    name: "حملة استعادة العملاء",
    message: "أهلاً {customerName}، وحشتنا في {companyName}. جهزنا لك عرضًا خاصًا على {topCategory} لفترة محدودة. يسعدنا نساعدك في احتياجات {vehicle}.",
    tip: "ابدأ بالعملاء المعرضين للتوقف، ثم أنشئ حملة منفصلة للمتوقفين منذ مدة أطول.",
  },
  vip: {
    label: "مكافأة كبار العملاء",
    segment: "vip",
    name: "عرض حصري لكبار العملاء",
    message: "أهلاً {customerName}، تقديرًا لثقتك في {companyName} جهزنا لك معاملة وعرضًا حصريًا على احتياجات {vehicle}. تواصل معنا قبل انتهاء العرض.",
    tip: "لا تجعل الخصم هو المكافأة الوحيدة؛ الأولوية والحجز وخدمة أسرع تحافظ على الهامش.",
  },
  welcome: {
    label: "الزيارة الثانية",
    segment: "new",
    name: "ترحيب العملاء الجدد",
    message: "أهلاً {customerName}، سعدنا بزيارتك لـ {companyName}. لو احتجت أي مساعدة تخص {vehicle} أو {topCategory} ابعت لنا رقم القطعة وسنراجع التوافق قبل زيارتك.",
    tip: "هدف الرسالة هو بناء الثقة وإعطاء سبب واضح للعودة، وليس بيعًا ضاغطًا.",
  },
  cross_sell: {
    label: "منتجات مكملة",
    segment: "active",
    name: "عرض منتجات مكملة",
    message: "أهلاً {customerName}، بناءً على مشترياتك من {topCategory} لدى {companyName} قد تكون هناك قطع مكملة مناسبة لـ {vehicle}. أرسل لنا رقم الشاسيه أو رقم القطعة للمراجعة.",
    tip: "راجع التوافق والمخزون قبل اقتراح أي قطعة؛ لا تعتمد على تشابه الاسم فقط.",
  },
  maintenance: {
    label: "تذكير صيانة",
    segment: "loyal",
    name: "متابعة احتياجات الصيانة",
    message: "أهلاً {customerName}، نطمئن على {vehicle} بعد آخر زيارة بتاريخ {lastPurchase}. لو حان موعد تغيير أو فحص {topCategory} تواصل مع {companyName} لمراجعة القطعة المناسبة.",
    tip: "التذكير تقديري بناءً على تاريخ الشراء؛ اسأل العميل عن الاستخدام والكيلومترات قبل التوصية.",
  },
  custom: {
    label: "حملة مخصّصة",
    segment: "all",
    name: "حملة جديدة",
    message: "أهلاً {customerName}، لدينا عرض جديد من {companyName} يناسب احتياجاتك. تواصل معنا لمعرفة التفاصيل.",
    tip: "اختر شريحة محددة ورسالة واحدة واضحة، ولا تجمع عدة عروض في نفس الرسالة.",
  },
};

const SEGMENT_TONES: Record<MarketingSegmentId, "amber" | "green" | "blue" | "indigo" | "orange" | "slate" | "rose"> = {
  vip: "amber",
  loyal: "green",
  new: "blue",
  active: "indigo",
  at_risk: "orange",
  dormant: "rose",
  lead: "slate",
};

const CONTACT_LABELS: Record<ContactStatus, string> = {
  contacted: "تم التواصل",
  responded: "رد العميل",
  converted: "تحولت لبيع",
  skipped: "تم التخطي",
};

export function MarketingPage() {
  const { customers, products } = useCatalog();
  const { salesInvoices, salesReturns } = useInvoicing();
  const { settings } = useSettings();
  const { isEnabled } = useFeatures();
  const toast = useToast();
  const whatsappEnabled = isEnabled("whatsappIntegration");
  const companyName = settings.companyNameAr || settings.companyName || "المحل";
  const currency = settings.currency;

  const [tab, setTab] = useState("overview");
  const [segmentFilter, setSegmentFilter] = useState<MarketingAudienceFilter>("all");
  const [segmentQuery, setSegmentQuery] = useState("");
  const [segmentConsentFilter, setSegmentConsentFilter] = useState<"all" | "opted_in" | "opted_out" | "unknown">("all");
  const [segmentPhoneFilter, setSegmentPhoneFilter] = useState<"all" | "valid" | "invalid">("all");
  const [audienceConsentFilter, setAudienceConsentFilter] = useState<"all" | "opted_in" | "unknown">("all");
  const [audienceContactFilter, setAudienceContactFilter] = useState<"all" | ContactStatus | "not_contacted">("all");
  const [goal, setGoal] = useState<CampaignGoal>("winback");
  const [campaignName, setCampaignName] = useState(CAMPAIGN_GOALS.winback.name);
  const [campaignSegment, setCampaignSegment] = useState<MarketingAudienceFilter>(CAMPAIGN_GOALS.winback.segment);
  const [message, setMessage] = useState(CAMPAIGN_GOALS.winback.message);
  const [includeUnknownConsent, setIncludeUnknownConsent] = useState(false);
  const [audienceQuery, setAudienceQuery] = useState("");
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>(() => lsGet(CAMPAIGN_STORAGE_KEY, []));
  const [contactLog, setContactLog] = useState<ContactRecord[]>(() => lsGet(CONTACT_STORAGE_KEY, []));

  const profiles = useMemo(
    () => buildCustomerMarketingProfiles(customers, salesInvoices, salesReturns, products, todayISO()),
    [customers, products, salesInvoices, salesReturns],
  );
  const summary = useMemo(() => summarizeMarketingProfiles(profiles), [profiles]);
  const categoryInsights = useMemo(
    () => buildCategoryInsights(salesInvoices, salesReturns, products),
    [products, salesInvoices, salesReturns],
  );
  const selectedSegmentProfiles = useMemo(
    () => profiles.filter((profile) => campaignSegment === "all" || profile.segment === campaignSegment),
    [campaignSegment, profiles],
  );
  const audience = useMemo(
    () => selectMarketingAudience(profiles, campaignSegment, includeUnknownConsent),
    [campaignSegment, includeUnknownConsent, profiles],
  );
  const latestContactByCustomer = useMemo(() => {
    const map = new Map<string, ContactRecord>();
    for (const item of [...contactLog].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
      if (!map.has(item.customerId)) map.set(item.customerId, item);
    }
    return map;
  }, [contactLog]);
  const visibleAudience = useMemo(() => {
    const query = audienceQuery.trim().toLowerCase();
    return audience.filter((profile) => {
      if (audienceConsentFilter !== "all") {
        const consent = profile.customer.marketingConsent;
        const isUnknown = !consent || consent === "unknown";
        if (audienceConsentFilter === "unknown" ? !isUnknown : isUnknown) return false;
      }
      if (audienceContactFilter !== "all") {
        const latest = latestContactByCustomer.get(profile.customer.id);
        if (audienceContactFilter === "not_contacted" ? latest : latest?.status !== audienceContactFilter) return false;
      }
      if (query) {
        const haystack = `${profile.customer.name} ${profile.customer.phone ?? ""} ${profile.topCategory ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [audience, audienceQuery, audienceConsentFilter, audienceContactFilter, latestContactByCustomer]);
  const filteredProfiles = useMemo(() => {
    const query = segmentQuery.trim().toLowerCase();
    return profiles.filter((profile) => {
      if (segmentFilter !== "all" && profile.segment !== segmentFilter) return false;
      if (segmentConsentFilter !== "all") {
        const consent = profile.customer.marketingConsent;
        if (segmentConsentFilter === "unknown" ? Boolean(consent) && consent !== "unknown" : consent !== segmentConsentFilter) return false;
      }
      if (segmentPhoneFilter === "valid" && !profile.hasReachablePhone) return false;
      if (segmentPhoneFilter === "invalid" && profile.hasReachablePhone) return false;
      if (query) {
        const haystack = `${profile.customer.name} ${profile.customer.phone ?? ""} ${profile.topCategory ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [profiles, segmentFilter, segmentQuery, segmentConsentFilter, segmentPhoneFilter]);
  const unknownInSelection = selectedSegmentProfiles.filter(
    (profile) => (!profile.customer.marketingConsent || profile.customer.marketingConsent === "unknown") && profile.hasReachablePhone,
  ).length;
  const missingPhone = selectedSegmentProfiles.filter((profile) => !profile.hasReachablePhone).length;
  const currentCampaignContactByCustomer = useMemo(() => {
    const map = new Map<string, ContactRecord>();
    const currentName = campaignName.trim();
    for (const item of contactLog) {
      if (item.campaignName === currentName && !map.has(item.customerId)) map.set(item.customerId, item);
    }
    return map;
  }, [campaignName, contactLog]);
  const campaignPerformance = useMemo(() => {
    const latestByCampaignCustomer = new Map<string, ContactRecord>();
    for (const item of contactLog) {
      const key = `${item.campaignName}\u0000${item.customerId}`;
      if (!latestByCampaignCustomer.has(key)) latestByCampaignCustomer.set(key, item);
    }
    const result = new Map<string, { reached: number; responded: number; converted: number }>();
    for (const item of latestByCampaignCustomer.values()) {
      const stats = result.get(item.campaignName) ?? { reached: 0, responded: 0, converted: 0 };
      if (item.status !== "skipped") stats.reached += 1;
      if (item.status === "responded" || item.status === "converted") stats.responded += 1;
      if (item.status === "converted") stats.converted += 1;
      result.set(item.campaignName, stats);
    }
    return result;
  }, [contactLog]);

  function prepareCampaign(nextGoal: CampaignGoal, segment?: MarketingAudienceFilter) {
    const config = CAMPAIGN_GOALS[nextGoal];
    setGoal(nextGoal);
    setCampaignName(config.name);
    setCampaignSegment(segment ?? config.segment);
    setMessage(config.message);
    setTab("campaigns");
  }

  function handleGoalChange(nextGoal: CampaignGoal) {
    prepareCampaign(nextGoal);
  }

  function addMessageToken(token: string) {
    setMessage((current) => `${current}${current.endsWith(" ") || !current ? "" : " "}${token}`);
  }

  async function copyText(value: string, successMessage: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(successMessage);
    } catch {
      toast.error("تعذر النسخ", "انسخ النص يدويًا من الحقل.");
    }
  }

  function saveCampaign() {
    if (!campaignName.trim() || !message.trim()) return toast.error("أكمل اسم الحملة والرسالة");
    if (audience.length === 0) return toast.error("لا يوجد جمهور صالح", "راجع الشريحة والموافقة التسويقية وأرقام الهاتف.");
    const record: CampaignRecord = {
      id: uid("campaign"),
      name: campaignName.trim(),
      goal,
      segment: campaignSegment,
      message: message.trim(),
      audienceCount: audience.length,
      createdAt: new Date().toISOString(),
    };
    const next = [record, ...campaigns].slice(0, 100);
    setCampaigns(next);
    lsSet(CAMPAIGN_STORAGE_KEY, next);
    toast.success("تم حفظ الحملة", "يمكنك بدء التواصل مع العملاء واحدًا تلو الآخر.");
  }

  function recordContact(profile: CustomerMarketingProfile, status: ContactStatus) {
    const entry: ContactRecord = {
      id: uid("contact"),
      customerId: profile.customer.id,
      campaignName: campaignName.trim() || CAMPAIGN_GOALS[goal].label,
      status,
      createdAt: new Date().toISOString(),
    };
    const next = [entry, ...contactLog].slice(0, 2_000);
    setContactLog(next);
    lsSet(CONTACT_STORAGE_KEY, next);
    toast.success(CONTACT_LABELS[status]);
  }

  function openWhatsapp(profile: CustomerMarketingProfile) {
    if (!whatsappEnabled) return toast.error("تكامل واتساب غير مفعّل", "فعّل إضافة واتساب أو انسخ الرسالة يدويًا.");
    if (!profile.normalizedPhone) return toast.error("رقم الهاتف غير صالح");
    const rendered = renderMarketingMessage(message, profile, { companyName, currency });
    window.open(`https://wa.me/${profile.normalizedPhone}?text=${encodeURIComponent(rendered)}`, "_blank", "noopener,noreferrer");
  }

  function exportAudienceCsv() {
    if (audience.length === 0) return toast.error("لا يوجد جمهور للتصدير");
    const escape = (value: unknown) => {
      const raw = String(value ?? "");
      const safe = /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const rows = [
      ["العميل", "الهاتف", "الشريحة", "آخر شراء", "صافي المشتريات", "الفئة المفضلة", "الموافقة"],
      ...audience.map((profile) => [
        profile.customer.name,
        profile.customer.phone ?? "",
        MARKETING_SEGMENTS[profile.segment].label,
        profile.lastPurchaseDate ?? "",
        profile.netRevenue,
        profile.topCategory ?? "",
        profile.customer.marketingConsent ?? "unknown",
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(escape).join(",")).join("\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `marketing-audience-${todayISO()}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير قائمة الجمهور");
  }

  const previewProfile = audience[0] ?? selectedSegmentProfiles.find((profile) => profile.hasReachablePhone) ?? profiles[0];
  const previewMessage = previewProfile
    ? renderMarketingMessage(message, previewProfile, { companyName, currency })
    : message;

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={Megaphone}
        title="مركز التسويق والنمو"
        description="حوّل بيانات المبيعات والعملاء إلى شرائح وفرص وحملات قابلة للتنفيذ—محليًا وبصورة مبسطة، مع احترام موافقة العميل."
        actions={(
          <Button className="h-10 bg-amber-400 text-slate-950 hover:bg-amber-300" onClick={() => prepareCampaign("winback")}>
            <Target className="h-4 w-4" /> أنشئ حملة
          </Button>
        )}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="min-w-max">
            <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
            <TabsTrigger value="segments">شرائح العملاء</TabsTrigger>
            <TabsTrigger value="campaigns">إنشاء حملة</TabsTrigger>
            <TabsTrigger value="guide">ابدأ هنا</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard icon={<Users className="h-5 w-5" />} tone="blue" label="عملاء قابلون للتواصل" value={String(summary.reachableOptedIn)} detail="هاتف صالح + موافقة مسجلة" />
            <MetricCard icon={<Repeat2 className="h-5 w-5" />} tone="green" label="معدل تكرار الشراء" value={`${(summary.repeatCustomerRate * 100).toFixed(1)}%`} detail="اشتروا مرتين أو أكثر" />
            <MetricCard icon={<Receipt className="h-5 w-5" />} tone="indigo" label="متوسط الفاتورة الصافي" value={formatCurrency(summary.averageOrderValue, currency)} detail="بعد خصم المرتجعات" />
            <MetricCard icon={<AlertTriangle className="h-5 w-5" />} tone="orange" label="قيمة معرضة للفقد" value={formatCurrency(summary.atRiskRevenue, currency)} detail="تاريخ شراء شرائح الخطر والتوقف" />
            <MetricCard icon={<BarChart3 className="h-5 w-5" />} tone="amber" label="صافي قيمة العملاء" value={formatCurrency(summary.netRevenue, currency)} detail={`${summary.invoiceCount} فاتورة غير ملغاة`} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.6fr)]">
            <Card>
              <CardHeader title="فرص تسويقية جاهزة" subtitle="كل فرصة موضحة بالسبب والإجراء المقترح" />
              <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <OpportunityCard
                  icon={<AlertTriangle className="h-4 w-4" />}
                  title="استعادة العملاء المعرضين للتوقف"
                  value={`${summary.segmentCounts.at_risk} عميل`}
                  description={`قيمة تعامل تاريخية ${formatCurrency(profiles.filter((p) => p.segment === "at_risk").reduce((sum, p) => sum + p.netRevenue, 0), currency)}`}
                  tone="orange"
                  action="جهّز حملة استعادة"
                  onClick={() => prepareCampaign("winback", "at_risk")}
                />
                <OpportunityCard
                  icon={<Crown className="h-4 w-4" />}
                  title="حافظ على كبار العملاء"
                  value={`${summary.segmentCounts.vip} عميل VIP`}
                  description="كافئ القيمة والولاء بخدمة أو عرض حصري."
                  tone="amber"
                  action="جهّز عرض VIP"
                  onClick={() => prepareCampaign("vip")}
                />
                <OpportunityCard
                  icon={<UserPlus className="h-4 w-4" />}
                  title="حوّل المسجلين إلى مشترين"
                  value={`${summary.segmentCounts.lead} عميل محتمل`}
                  description="مسجلون في النظام ولم تصدر لهم فاتورة بعد."
                  tone="blue"
                  action="أنشئ حملة تعريفية"
                  onClick={() => prepareCampaign("custom", "lead")}
                />
                <OpportunityCard
                  icon={<PhoneOff className="h-4 w-4" />}
                  title="حسّن جاهزية البيانات"
                  value={`${summary.unknownConsent} موافقة غير مسجلة`}
                  description={`${profiles.filter((p) => !p.hasReachablePhone).length} عميل بدون رقم صالح.`}
                  tone="slate"
                  action="راجع العملاء"
                  to="/customers"
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="أقوى فئات المبيعات" subtitle="صافي تقريبي بعد المرتجعات" />
              <CardBody className="space-y-3">
                {categoryInsights.slice(0, 5).map((item, index) => (
                  <div key={item.category} className="flex items-center gap-3 rounded-lg border border-line bg-surface-muted/35 p-2.5">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface text-xs font-black text-brand-700">{index + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold text-ink">{item.category}</div>
                      <div className="text-[11px] text-ink-faint">{item.customers} عميل · {item.units.toLocaleString("ar-EG")} وحدة</div>
                    </div>
                    <div className="shrink-0 text-xs font-bold text-ink-muted">{formatCurrency(item.revenue, currency)}</div>
                  </div>
                ))}
                {categoryInsights.length === 0 ? <div className="py-8 text-center text-xs text-ink-faint">سجّل مبيعات لتظهر الفئات الأقوى.</div> : null}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="جاهزية التسويق" subtitle="قبل أي حملة، أكمل البيانات التي تؤثر على جودة الاستهداف" />
            <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <ReadinessItem label="أرقام الهاتف" value={profiles.filter((p) => p.hasReachablePhone).length} total={profiles.length} description="رقم صالح لفتح قناة التواصل" />
              <ReadinessItem label="الموافقة التسويقية" value={profiles.filter((profile) => profile.customer.marketingConsent === "opted_in").length} total={profiles.length} description="موافقة واضحة ومسجلة" />
              <ReadinessItem label="سجل شراء مفيد" value={summary.purchasingCustomerCount} total={profiles.length} description="على الأقل فاتورة غير ملغاة" />
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="segments" className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {(Object.keys(MARKETING_SEGMENTS) as MarketingSegmentId[]).map((segment) => {
              const segmentProfiles = profiles.filter((profile) => profile.segment === segment);
              return (
                <button
                  key={segment}
                  type="button"
                  onClick={() => setSegmentFilter(segment)}
                  className="rounded-xl border border-line bg-surface p-3.5 text-start shadow-card transition-colors hover:border-brand-300 hover:bg-surface-muted/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <Badge tone={SEGMENT_TONES[segment]}>{MARKETING_SEGMENTS[segment].label}</Badge>
                    <span className="text-xl font-black text-ink">{segmentProfiles.length}</span>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-ink-muted">{MARKETING_SEGMENTS[segment].description}</p>
                  <p className="mt-2 text-[11px] font-semibold text-brand-700 dark:text-brand-300">{MARKETING_SEGMENTS[segment].action}</p>
                </button>
              );
            })}
          </div>

          <Card>
            <CardHeader
              title="تحليل العملاء"
              subtitle={`${filteredProfiles.length} عميل في العرض الحالي`}
            />
            <CardBody className="space-y-3 p-4 pb-0">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Input
                  value={segmentQuery}
                  onChange={(event) => setSegmentQuery(event.target.value)}
                  placeholder="ابحث بالاسم أو الهاتف أو الفئة..."
                  className="text-start"
                />
                <Select value={segmentFilter} onChange={(event) => setSegmentFilter(event.target.value as MarketingAudienceFilter)}>
                  <option value="all">كل الشرائح</option>
                  {(Object.keys(MARKETING_SEGMENTS) as MarketingSegmentId[]).map((segment) => <option key={segment} value={segment}>{MARKETING_SEGMENTS[segment].label}</option>)}
                </Select>
                <Select value={segmentConsentFilter} onChange={(event) => setSegmentConsentFilter(event.target.value as typeof segmentConsentFilter)}>
                  <option value="all">كل حالات الموافقة</option>
                  <option value="opted_in">موافق</option>
                  <option value="unknown">غير مسجلة</option>
                  <option value="opted_out">منسحب</option>
                </Select>
                <Select value={segmentPhoneFilter} onChange={(event) => setSegmentPhoneFilter(event.target.value as typeof segmentPhoneFilter)}>
                  <option value="all">كل الأرقام</option>
                  <option value="valid">رقم هاتف صالح</option>
                  <option value="invalid">بدون رقم صالح</option>
                </Select>
              </div>
              {(segmentQuery || segmentFilter !== "all" || segmentConsentFilter !== "all" || segmentPhoneFilter !== "all") && (
                <button
                  type="button"
                  onClick={() => { setSegmentQuery(""); setSegmentFilter("all"); setSegmentConsentFilter("all"); setSegmentPhoneFilter("all"); }}
                  className="text-xs text-ink-faint hover:text-ink transition-colors"
                >
                  مسح الفلاتر
                </button>
              )}
            </CardBody>
            <CardBody className="overflow-x-auto p-0">
              <Table>
                <THead><TR><TH>العميل</TH><TH>الشريحة</TH><TH className="text-center">الفواتير</TH><TH className="text-end">صافي القيمة</TH><TH>آخر شراء</TH><TH>الفئة المفضلة</TH><TH>التواصل</TH><TH /></TR></THead>
                <TBody>
                  {filteredProfiles.map((profile) => (
                    <TR key={profile.customer.id}>
                      <TD><div className="font-bold text-ink">{profile.customer.name}</div><div className="text-[11px] text-ink-faint" dir="ltr">{profile.customer.phone ?? "بدون هاتف"}</div></TD>
                      <TD><Badge tone={SEGMENT_TONES[profile.segment]}>{MARKETING_SEGMENTS[profile.segment].label}</Badge></TD>
                      <TD className="text-center">{profile.invoiceCount}</TD>
                      <TD className="text-end font-mono">{formatCurrency(profile.netRevenue, currency)}</TD>
                      <TD className="text-xs text-ink-muted">{profile.lastPurchaseDate ? formatDate(profile.lastPurchaseDate) : "لم يشترِ"}</TD>
                      <TD className="text-xs text-ink-muted">{profile.topCategory ?? "—"}</TD>
                      <TD><ConsentBadge value={profile.customer.marketingConsent} hasPhone={profile.hasReachablePhone} /></TD>
                      <TD className="text-end"><Button size="sm" variant="outline" onClick={() => prepareCampaign("custom", profile.segment)}>استهدف الشريحة</Button></TD>
                    </TR>
                  ))}
                  {filteredProfiles.length === 0 ? <TR><TD colSpan={8} className="py-10 text-center text-ink-faint">لا يوجد عملاء مطابقون للفلاتر الحالية.</TD></TR> : null}
                </TBody>
              </Table>
            </CardBody>
          </Card>
        </TabsContent>

        <TabsContent value="campaigns" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <Card className="self-start">
              <CardHeader title="إعداد الحملة" subtitle="هدف واحد، شريحة واضحة ورسالة قابلة للقياس" />
              <CardBody className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="هدف الحملة">
                    <Select value={goal} onChange={(event) => handleGoalChange(event.target.value as CampaignGoal)}>
                      {(Object.keys(CAMPAIGN_GOALS) as CampaignGoal[]).map((key) => <option key={key} value={key}>{CAMPAIGN_GOALS[key].label}</option>)}
                    </Select>
                  </Field>
                  <Field label="الشريحة المستهدفة">
                    <Select value={campaignSegment} onChange={(event) => setCampaignSegment(event.target.value as MarketingAudienceFilter)}>
                      <option value="all">كل العملاء</option>
                      {(Object.keys(MARKETING_SEGMENTS) as MarketingSegmentId[]).map((segment) => <option key={segment} value={segment}>{MARKETING_SEGMENTS[segment].label}</option>)}
                    </Select>
                  </Field>
                </div>
                <Field label="اسم الحملة">
                  <Input value={campaignName} onChange={(event) => setCampaignName(event.target.value)} className="text-start" />
                </Field>
                <Field label="نص الرسالة" hint="المتغيرات بين الأقواس تُستبدل تلقائيًا ببيانات كل عميل.">
                  <Textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={6} className="resize-y leading-7" />
                </Field>
                <div>
                  <div className="mb-2 text-[11px] font-bold text-ink-muted">أضف متغيرًا للرسالة</div>
                  <div className="flex flex-wrap gap-1.5">
                    {["{customerName}", "{companyName}", "{vehicle}", "{topCategory}", "{topProduct}", "{lastPurchase}", "{totalPurchases}"].map((token) => (
                      <button key={token} type="button" onClick={() => addMessageToken(token)} className="rounded-md border border-line bg-surface-muted px-2 py-1 font-mono text-[10px] text-ink-muted hover:border-brand-300 hover:text-brand-700">{token}</button>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-brand-100 bg-brand-50/55 p-3 dark:border-brand-500/20 dark:bg-brand-500/[0.06]">
                  <div className="mb-1 flex items-center gap-1.5 text-[11px] font-bold text-brand-700 dark:text-brand-300"><Sparkles className="h-3.5 w-3.5" /> معاينة ببيانات عميل</div>
                  <p className="whitespace-pre-wrap text-sm leading-7 text-ink-muted">{previewMessage}</p>
                </div>
                <div className="rounded-lg border border-line bg-surface-muted/45 p-3 text-xs leading-6 text-ink-muted">
                  <strong className="text-ink">نصيحة الحملة:</strong> {CAMPAIGN_GOALS[goal].tip}
                </div>
                <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-xs leading-5 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200">
                  <input type="checkbox" checked={includeUnknownConsent} onChange={(event) => setIncludeUnknownConsent(event.target.checked)} className="mt-1 w-4 h-4 rounded border-2 border-ink-faint bg-surface accent-brand-600 focus:ring-2 focus:ring-brand-500 cursor-pointer" />
                  <span><strong>تضمين العملاء بدون موافقة مسجلة ({unknownInSelection})</strong><br />استخدم هذا الخيار فقط بعد التأكد أن لديك إذنًا مناسبًا للتواصل. الرافضون مستبعدون دائمًا.</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={saveCampaign}><Save className="h-4 w-4" /> حفظ الحملة</Button>
                  <Button variant="outline" onClick={exportAudienceCsv}><Download className="h-4 w-4" /> تصدير الجمهور CSV</Button>
                  <Button variant="outline" onClick={() => copyText(previewMessage, "تم نسخ الرسالة")}><Copy className="h-4 w-4" /> نسخ المعاينة</Button>
                </div>
              </CardBody>
            </Card>

            <div className="space-y-4">
              {!whatsappEnabled ? <PaidFeatureNotice title="التكامل مع واتساب" featureKey="whatsappIntegration" description="يمكنك حفظ الحملة وتصدير الجمهور ونسخ الرسائل الآن. فعّل إضافة واتساب لفتح المحادثات مباشرة من القائمة." /> : null}
              <Card>
                <CardHeader
                  title="قائمة الجمهور"
                  subtitle={`${audience.length} صالح للتواصل · ${missingPhone} بدون رقم صالح · الرافضون مستبعدون`}
                  actions={<Badge tone={audience.length > 0 ? "green" : "slate"}>{audience.length} عميل</Badge>}
                />
                <CardBody className="space-y-3">
                  <Input value={audienceQuery} onChange={(event) => setAudienceQuery(event.target.value)} placeholder="ابحث داخل الجمهور بالاسم أو الهاتف أو الفئة..." className="text-start" />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Select value={audienceConsentFilter} onChange={(event) => setAudienceConsentFilter(event.target.value as typeof audienceConsentFilter)}>
                      <option value="all">كل حالات الموافقة</option>
                      <option value="opted_in">موافق فقط</option>
                      <option value="unknown">غير مسجلة فقط</option>
                    </Select>
                    <Select value={audienceContactFilter} onChange={(event) => setAudienceContactFilter(event.target.value as typeof audienceContactFilter)}>
                      <option value="all">كل حالات التواصل</option>
                      <option value="not_contacted">لم يتم التواصل بعد</option>
                      <option value="contacted">تم التواصل</option>
                      <option value="responded">رد العميل</option>
                      <option value="converted">تحولت لبيع</option>
                      <option value="skipped">تم التخطي</option>
                    </Select>
                  </div>
                  <div className="max-h-[38rem] overflow-auto rounded-xl border border-line">
                    <Table>
                      <THead><TR><TH>العميل</TH><TH>السبب</TH><TH>آخر تواصل</TH><TH className="text-end">إجراء</TH></TR></THead>
                      <TBody>
                        {visibleAudience.map((profile) => {
                          const latestContact = latestContactByCustomer.get(profile.customer.id);
                          const currentCampaignContact = currentCampaignContactByCustomer.get(profile.customer.id);
                          return (
                            <TR key={profile.customer.id}>
                              <TD><div className="font-bold text-ink">{profile.customer.name}</div><div className="font-mono text-[11px] text-ink-faint" dir="ltr">{profile.customer.phone}</div></TD>
                              <TD><Badge tone={SEGMENT_TONES[profile.segment]}>{MARKETING_SEGMENTS[profile.segment].label}</Badge><div className="mt-1 text-[10px] text-ink-faint">{profile.topCategory ?? "بيانات عامة"}</div></TD>
                              <TD className="text-xs text-ink-muted">{latestContact ? <><span>{CONTACT_LABELS[latestContact.status]}</span><div className="text-[10px] text-ink-faint">{formatDate(latestContact.createdAt)}</div></> : "لم يتم"}</TD>
                              <TD className="text-end">
                                <div className="inline-flex items-center gap-1">
                                  {whatsappEnabled ? <Button size="sm" variant="success" onClick={() => openWhatsapp(profile)}><MessageCircle className="h-3.5 w-3.5" /> واتساب</Button> : null}
                                  <Button size="sm" variant="outline" onClick={() => copyText(renderMarketingMessage(message, profile, { companyName, currency }), "تم نسخ رسالة العميل")}><Copy className="h-3.5 w-3.5" /></Button>
                                  <Select
                                    aria-label={`نتيجة التواصل مع ${profile.customer.name}`}
                                    value={currentCampaignContact?.status ?? ""}
                                    onChange={(event) => recordContact(profile, event.target.value as ContactStatus)}
                                    className="h-8 min-w-28 py-1 text-xs"
                                  >
                                    <option value="" disabled>سجّل النتيجة</option>
                                    <option value="contacted">تم التواصل</option>
                                    <option value="responded">رد العميل</option>
                                    <option value="converted">تحولت لبيع</option>
                                    <option value="skipped">تم التخطي</option>
                                  </Select>
                                </div>
                              </TD>
                            </TR>
                          );
                        })}
                        {visibleAudience.length === 0 ? <TR><TD colSpan={4} className="py-10 text-center text-ink-faint">لا يوجد عملاء صالحون وفق الشريحة والموافقة الحالية.</TD></TR> : null}
                      </TBody>
                    </Table>
                  </div>
                </CardBody>
              </Card>

              {campaigns.length > 0 ? (
                <Card>
                  <CardHeader title="آخر الحملات المحفوظة" subtitle="سجل محلي ضمن النسخ الاحتياطية" />
                  <CardBody className="space-y-2">
                    {campaigns.slice(0, 5).map((campaign) => (
                      <CampaignHistoryItem
                        key={campaign.id}
                        campaign={campaign}
                        performance={campaignPerformance.get(campaign.name)}
                        onReuse={() => { setGoal(campaign.goal); setCampaignName(campaign.name); setCampaignSegment(campaign.segment); setMessage(campaign.message); }}
                      />
                    ))}
                  </CardBody>
                </Card>
              ) : null}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="guide" className="space-y-4">
          <Card>
            <CardHeader title="طريقة استخدام المركز في 4 خطوات" subtitle="ابدأ صغيرًا، قِس النتيجة، ثم كرر ما ينجح" />
            <CardBody className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              <GuideStep number="1" title="حسّن البيانات" description="راجع الهاتف وسجّل موافقة التسويق، واختر سيارة العميل عند إصدار الفاتورة كلما أمكن." />
              <GuideStep number="2" title="اختر فرصة واحدة" description="ابدأ بالعملاء المعرضين للتوقف أو الجدد بدل إرسال عرض عام للجميع." />
              <GuideStep number="3" title="خصص الرسالة" description="استخدم الاسم والسيارة والفئة المفضلة، وتأكد من المخزون والتوافق قبل العرض." />
              <GuideStep number="4" title="سجّل النتيجة" description="حدّث حالة التواصل إلى رد أو بيع حتى تعرف أي حملة تستحق التكرار." />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader title="كيف تُحسب المؤشرات؟" />
              <CardBody className="space-y-3 text-xs leading-6 text-ink-muted">
                <Definition title="صافي قيمة العميل">إجمالي فواتير البيع غير الملغاة مطروحًا منه مرتجعات المبيعات المرتبطة بها.</Definition>
                <Definition title="معدل تكرار الشراء">عدد العملاء الذين اشتروا مرتين أو أكثر ÷ عدد العملاء الذين اشتروا مرة واحدة على الأقل.</Definition>
                <Definition title="معرض للتوقف">عميل لديه فاتورتان أو أكثر، ومرّ على آخر شراء من 61 إلى 120 يومًا.</Definition>
                <Definition title="VIP">من أعلى 20% في صافي القيمة مع 3 فواتير على الأقل. النتيجة تتغير طبيعيًا مع نمو البيانات.</Definition>
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="قواعد حملة محترفة" />
              <CardBody className="space-y-3">
                <Rule icon={<Target className="h-4 w-4" />} title="هدف واحد" text="اجعل لكل حملة إجراءً واحدًا واضحًا: عودة، زيارة ثانية، أو مراجعة قطعة." />
                <Rule icon={<ShieldCheck className="h-4 w-4" />} title="احترم قرار العميل" text="لا تراسل المنسحبين، وسجّل الموافقة بدل الاعتماد على الذاكرة." />
                <Rule icon={<HeartHandshake className="h-4 w-4" />} title="القيمة قبل الخصم" text="قدّم مراجعة توافق، حجز قطعة أو خدمة أسرع قبل تخفيض السعر." />
                <Rule icon={<Lightbulb className="h-4 w-4" />} title="اختبر وتعلّم" text="ابدأ بعينة صغيرة وسجّل الردود والمبيعات قبل توسيع الجمهور." />
              </CardBody>
            </Card>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs leading-6 text-blue-900 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-200">
            <strong>حدود النسخة المحلية:</strong> المركز يحلل البيانات ويبني الشرائح والقوالب ويحفظ سجلًا يدويًا. الإرسال الجماعي والجدولة ومعرفة التسليم والقراءة تحتاج WhatsApp Business API وخادمًا آمنًا؛ لا يتم ادعاء هذه الوظائف داخل التطبيق الحالي.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetricCard({ icon, label, value, detail, tone }: { icon: ReactNode; label: string; value: string; detail: string; tone: "blue" | "green" | "indigo" | "orange" | "amber" }) {
  const tones = {
    blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    indigo: "bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300",
    orange: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
  };
  return <Card><CardBody className="flex items-center gap-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>{icon}</span><span className="min-w-0"><span className="block text-[11px] text-ink-faint">{label}</span><span className="block truncate text-lg font-black text-ink">{value}</span><span className="block truncate text-[10px] text-ink-faint">{detail}</span></span></CardBody></Card>;
}

function OpportunityCard({ icon, title, value, description, tone, action, onClick, to }: { icon: ReactNode; title: string; value: string; description: string; tone: "orange" | "amber" | "blue" | "slate"; action: string; onClick?: () => void; to?: string }) {
  const tones = { orange: "bg-orange-50 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300", amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300", blue: "bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300", slate: "bg-surface-muted text-ink-muted" };
  const content = <><div className="flex items-start gap-3"><span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>{icon}</span><div className="min-w-0 flex-1"><div className="text-sm font-bold text-ink">{title}</div><div className="mt-0.5 text-lg font-black text-ink">{value}</div></div></div><p className="mt-2 text-xs leading-5 text-ink-muted">{description}</p><span className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-brand-700 dark:text-brand-300">{action} <ArrowLeft className="h-3.5 w-3.5" /></span></>;
  const classes = "rounded-xl border border-line bg-surface-muted/25 p-3.5 text-start transition-colors hover:border-brand-300 hover:bg-surface-muted/50";
  return to ? <Link to={to} className={classes}>{content}</Link> : <button type="button" onClick={onClick} className={classes}>{content}</button>;
}

function ReadinessItem({ label, value, total, description }: { label: string; value: number; total: number; description: string }) {
  const ratio = total > 0 ? Math.round((value / total) * 100) : 0;
  return <div className="rounded-xl border border-line bg-surface-muted/30 p-3"><div className="flex items-center justify-between gap-2"><span className="text-sm font-bold text-ink">{label}</span><span className="font-mono text-xs text-ink-muted">{ratio}%</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand-600" style={{ width: `${ratio}%` }} /></div><div className="mt-2 text-[11px] text-ink-faint">{value} من {total} · {description}</div></div>;
}

function ConsentBadge({ value, hasPhone }: { value: "unknown" | "opted_in" | "opted_out" | undefined; hasPhone: boolean }) {
  if (!hasPhone) return <Badge tone="red"><PhoneOff className="h-3 w-3" /> رقم غير صالح</Badge>;
  if (value === "opted_in") return <Badge tone="green"><Phone className="h-3 w-3" /> موافق</Badge>;
  if (value === "opted_out") return <Badge tone="red"><PhoneOff className="h-3 w-3" /> منسحب</Badge>;
  return <Badge tone="amber"><AlertTriangle className="h-3 w-3" /> غير مسجل</Badge>;
}

function GuideStep({ number, title, description }: { number: string; title: string; description: string }) {
  return <div className="rounded-xl border border-line bg-surface-muted/30 p-4"><span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-sm font-black text-white">{number}</span><div className="mt-3 text-sm font-bold text-ink">{title}</div><p className="mt-1 text-xs leading-6 text-ink-muted">{description}</p></div>;
}

function Definition({ title, children }: { title: string; children: ReactNode }) {
  return <div className="rounded-lg border border-line bg-surface-muted/30 p-3"><div className="font-bold text-ink">{title}</div><div className="mt-1">{children}</div></div>;
}

function Rule({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-muted/30 p-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">{icon}</span><div><div className="text-sm font-bold text-ink">{title}</div><div className="mt-0.5 text-xs leading-5 text-ink-muted">{text}</div></div></div>;
}

function CampaignHistoryItem({
  campaign,
  performance,
  onReuse,
}: {
  campaign: CampaignRecord;
  performance?: { reached: number; responded: number; converted: number };
  onReuse: () => void;
}) {
  const reached = performance?.reached ?? 0;
  const conversionRate = reached > 0 ? Math.round(((performance?.converted ?? 0) / reached) * 100) : 0;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-muted/35 p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="truncate text-sm font-bold text-ink">{campaign.name}</div>
        <div className="text-[11px] text-ink-faint">{formatDate(campaign.createdAt)} · جمهور محفوظ {campaign.audienceCount}</div>
        <div className="mt-1 text-[11px] text-ink-muted">تواصل {reached} · رد {performance?.responded ?? 0} · بيع {performance?.converted ?? 0} · تحويل {conversionRate}%</div>
      </div>
      <Button size="sm" variant="ghost" onClick={onReuse}>إعادة الاستخدام</Button>
    </div>
  );
}
