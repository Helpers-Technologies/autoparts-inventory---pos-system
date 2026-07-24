import { useMemo, useState } from "react";
import { ArrowLeftRight, Building2, Copy, KeyRound, LockKeyhole, MapPin, MessageCircle, Plus, Search, Warehouse } from "lucide-react";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { EmptyState } from "../components/ui/EmptyState";
import { Field, Input, Select, Textarea } from "../components/ui/Input";
import { useToast } from "../components/ui/Toast";
import { formatCurrency } from "../lib/format";
import { todayISO } from "../lib/utils";
import { useAutoPartsPro } from "../store/AutoPartsProContext";
import { useAuth } from "../store/AuthContext";
import { useCatalog } from "../store/CatalogContext";
import { useSettings } from "../store/SettingsContext";
import type { BranchLicenseError, BranchLicenseStatus } from "../types";

const DEVELOPER_WHATSAPP = "201118445625";

function branchLicenseErrorMessage(error?: BranchLicenseError) {
  switch (error) {
    case "machine_mismatch": return "كود التفعيل صادر لجهاز آخر. أرسل كود الجهاز الظاهر للمطور.";
    case "code_already_used": return "كود التفعيل مستخدم من قبل ولا يمكن استعماله مرة ثانية.";
    case "slot_already_available": return "يوجد تفعيل جاهز بالفعل. أضف الفرع أولًا قبل تفعيل كود جديد.";
    case "license_inactive": return "يجب أن يكون ترخيص البرنامج الأساسي ساريًا أولًا.";
    case "not_authorized": return "تفعيل وإضافة الفروع متاحان لحساب المدير فقط.";
    case "invalid_branch": return "راجع بيانات الفرع وحاول مرة أخرى.";
    case "desktop_required": return "تفعيل الفروع متاح من نسخة سطح المكتب فقط.";
    default: return "كود تفعيل الفرع غير صحيح أو تالف.";
  }
}

export function BranchesPage() {
  const { products } = useCatalog();
  const { settings } = useSettings();
  const { currentUser, licenseStatus } = useAuth();
  const pro = useAutoPartsPro();
  const toast = useToast();
  const activeBranches = pro.branches.filter((branch) => branch.active);
  const [selectedBranchId, setSelectedBranchId] = useState(activeBranches[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [branchDialog, setBranchDialog] = useState(false);
  const [activationDialog, setActivationDialog] = useState(false);
  const [branchLicenseStatus, setBranchLicenseStatus] = useState<BranchLicenseStatus | null>(null);
  const [activationCode, setActivationCode] = useState("");
  const [checkingLicense, setCheckingLicense] = useState(false);
  const [activating, setActivating] = useState(false);
  const [creatingBranch, setCreatingBranch] = useState(false);
  const [transferDialog, setTransferDialog] = useState(false);
  const [branchName, setBranchName] = useState("");
  const [branchAddress, setBranchAddress] = useState("");
  const [branchPhone, setBranchPhone] = useState("");
  const [fromBranchId, setFromBranchId] = useState(activeBranches[0]?.id ?? "");
  const [toBranchId, setToBranchId] = useState("");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [transferNotes, setTransferNotes] = useState("");

  const selectedBranch = activeBranches.find((branch) => branch.id === selectedBranchId);
  const productRows = useMemo(() => products
    .filter((product) => !product.archived && `${product.name} ${product.partNumber ?? ""} ${product.code}`.toLowerCase().includes(query.trim().toLowerCase()))
    .map((product) => ({ product, quantity: pro.branchQuantity(selectedBranchId, product.id) }))
    .sort((a, b) => b.quantity - a.quantity), [products, pro, query, selectedBranchId]);
  const selectedValue = productRows.reduce((sum, row) => sum + row.quantity * row.product.purchasePrice, 0);
  const sourceAvailable = productId ? pro.branchQuantity(fromBranchId, productId) : 0;
  const machineCode = branchLicenseStatus?.machineCode ?? licenseStatus?.machineCode ?? "";
  const whatsappMessage = encodeURIComponent(`مرحبًا، أريد شراء تفعيل لإضافة فرع جديد في نظام AutoParts.\nكود الجهاز: ${machineCode || "غير متاح"}`);

  async function openNewBranch() {
    if (currentUser?.role !== "owner") {
      toast.error("ليس لديك صلاحية", "إضافة الفروع متاحة لحساب المدير فقط.");
      return;
    }
    const api = window.desktopAPI?.branchLicensing;
    if (!api) {
      toast.error("نسخة سطح المكتب مطلوبة", "تفعيل الفروع غير متاح من المتصفح.");
      return;
    }
    setCheckingLicense(true);
    try {
      const status = await api.getStatus();
      setBranchLicenseStatus(status);
      if (status.availableSlots > 0) setBranchDialog(true);
      else setActivationDialog(true);
    } catch {
      toast.error("تعذر فحص تفعيل الفروع", "أعد المحاولة أو تواصل مع المطور.");
    } finally {
      setCheckingLicense(false);
    }
  }

  async function activateBranchSlot() {
    const serial = activationCode.trim();
    if (!serial) {
      toast.error("اكتب كود تفعيل الفرع");
      return;
    }
    const api = window.desktopAPI?.branchLicensing;
    if (!api) return;
    setActivating(true);
    try {
      const result = await api.activate(serial);
      if (!result.ok) {
        if (result.status) setBranchLicenseStatus(result.status);
        toast.error("تعذر تفعيل الفرع", branchLicenseErrorMessage(result.error));
        return;
      }
      if (result.status) setBranchLicenseStatus(result.status);
      setActivationCode("");
      setActivationDialog(false);
      setBranchDialog(true);
      toast.success("تم تفعيل فرع واحد", "أكمل بيانات الفرع الآن؛ الكود لا يفتح أكثر من فرع.");
    } catch {
      toast.error("تعذر التفعيل", "أعد المحاولة وتأكد من نسخ الكود كاملًا.");
    } finally {
      setActivating(false);
    }
  }

  async function copyMachineCode() {
    if (!machineCode) return;
    try {
      await navigator.clipboard.writeText(machineCode);
      toast.success("تم نسخ كود الجهاز");
    } catch {
      toast.error("تعذر نسخ كود الجهاز");
    }
  }

  async function addBranch() {
    if (!branchName.trim()) {
      toast.error("اسم الفرع مطلوب");
      return;
    }
    setCreatingBranch(true);
    try {
      const result = await pro.addBranch({ name: branchName.trim(), address: branchAddress.trim() || undefined, phone: branchPhone.trim() || undefined, active: true });
      if (!result.ok || !result.branch) {
        if (result.status) setBranchLicenseStatus(result.status);
        if (result.error === "activation_required") {
          setBranchDialog(false);
          setActivationDialog(true);
          toast.warning("يلزم تفعيل فرع جديد", "كل كود يتيح إضافة فرع واحد فقط.");
        } else {
          toast.error("تعذر إضافة الفرع", branchLicenseErrorMessage(result.error));
        }
        return;
      }
      setBranchLicenseStatus(result.status ?? null);
      setSelectedBranchId(result.branch.id);
      setToBranchId(result.branch.id);
      setBranchDialog(false);
      setBranchName("");
      setBranchAddress("");
      setBranchPhone("");
      toast.success("تم إضافة الفرع", "تم استهلاك التفعيل. انقل إليه الرصيد من شاشة التحويلات.");
    } finally {
      setCreatingBranch(false);
    }
  }

  function transfer() {
    const product = products.find((item) => item.id === productId);
    if (!product || !fromBranchId || !toBranchId || quantity <= 0) {
      toast.error("أكمل بيانات التحويل");
      return;
    }
    const item = pro.transferStock({ date: todayISO(), fromBranchId, toBranchId, productId, productName: product.name, quantity, notes: transferNotes.trim() || undefined });
    if (!item) {
      toast.error("تعذر التحويل", "تأكد من اختلاف الفرعين وتوفر الكمية في فرع المصدر.");
      return;
    }
    setTransferDialog(false);
    setProductId("");
    setQuantity(0);
    setTransferNotes("");
    toast.success("تم تحويل المخزون", item.transferNumber);
  }

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={Building2}
        title="الفروع وتوزيع قطع الغيار"
        description="إجمالي المنتج يظل ثابتًا، بينما يوضح النظام مكان وجود كل وحدة ويمنع التحويل بأكثر من المتاح."
        stats={[
          { label: "فرع نشط", value: activeBranches.length },
          { label: "تحويل مكتمل", value: pro.stockTransfers.filter((transfer) => transfer.status === "completed").length },
          { label: "إجمالي وحدات موزعة", value: pro.branchStocks.reduce((sum, row) => sum + row.quantity, 0) },
        ]}
        actions={<>{currentUser?.role === "owner" ? <Button variant="outline" className="border-white/20 bg-white/10 text-white hover:bg-white/20" onClick={openNewBranch} disabled={checkingLicense}><LockKeyhole className="h-4 w-4" /> {checkingLicense ? "جارِ الفحص..." : "فرع جديد"}</Button> : null}<Button className="bg-amber-400 text-slate-950 hover:bg-amber-300" onClick={() => setTransferDialog(true)}><ArrowLeftRight className="h-4 w-4" /> تحويل مخزون</Button></>}
      />

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {activeBranches.map((branch) => {
          const units = pro.branchStocks.filter((row) => row.branchId === branch.id).reduce((sum, row) => sum + row.quantity, 0);
          return (
            <button
              key={branch.id}
              type="button"
              onClick={() => setSelectedBranchId(branch.id)}
              className={`rounded-xl border p-3 text-right transition ${
                selectedBranchId === branch.id
                  ? "border-cyan-500 bg-cyan-50 dark:bg-cyan-500/10 shadow-sm"
                  : "border-line bg-surface hover:border-brand-300"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-950 text-cyan-300">
                    <Warehouse className="h-4 w-4" />
                  </div>
                  <div className="truncate font-bold text-sm text-ink">{branch.name}</div>
                </div>
                {branch.isMain ? <Badge tone="blue">رئيسي</Badge> : <Badge tone="slate">{branch.code}</Badge>}
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-2 text-xs border-t border-line/60 pt-2">
                <div className="flex items-center gap-1 text-[11px] text-ink-faint truncate">
                  <MapPin className="h-3 w-3 shrink-0" /> {branch.address || "العنوان غير مسجل"}
                </div>
                <span className="shrink-0 font-bold text-brand-700 text-xs">
                  {units.toLocaleString("ar-EG")} وحدة
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader title={`رصيد ${selectedBranch?.name || "الفرع"}`} subtitle={`قيمة تقديرية: ${formatCurrency(selectedValue, settings.currency)}`} actions={<div className="relative w-64"><Search className="absolute right-3 top-2.5 h-4 w-4 text-ink-faint" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="بحث في رصيد الفرع" className="pr-10" /></div>} />
          <CardBody className="p-0"><div className="max-h-[520px] overflow-auto"><table className="w-full text-sm"><thead className="sticky top-0 bg-surface-muted text-xs text-ink-muted"><tr><th className="p-3 text-right">القطعة</th><th className="p-3 text-right">الرف</th><th className="p-3 text-center">رصيد الفرع</th><th className="p-3 text-center">الإجمالي</th></tr></thead><tbody>{productRows.map(({ product, quantity: rowQuantity }) => <tr key={product.id} className="border-t border-line"><td className="p-3"><div className="font-semibold">{product.name}</div><div className="font-mono text-[11px] text-ink-faint" dir="ltr">{product.partNumber || product.code}</div></td><td className="p-3 font-mono text-xs" dir="ltr">{product.rackLocation || "—"}</td><td className="p-3 text-center"><Badge tone={rowQuantity <= 0 ? "red" : rowQuantity <= product.minStock ? "amber" : "green"}>{rowQuantity}</Badge></td><td className="p-3 text-center text-ink-muted">{product.quantity}</td></tr>)}</tbody></table></div></CardBody>
        </Card>

        <Card>
          <CardHeader title="آخر التحويلات" subtitle="سجل حركة المخزون بين الفروع" />
          <CardBody>
            {pro.stockTransfers.length === 0 ? <EmptyState icon={<ArrowLeftRight className="h-6 w-6" />} title="لا توجد تحويلات" /> : <div className="space-y-2">{pro.stockTransfers.slice(0, 12).map((transferRow) => <div key={transferRow.id} className="rounded-2xl border border-line p-3"><div className="flex items-center justify-between gap-2"><span className="font-mono text-xs text-brand-700" dir="ltr">{transferRow.transferNumber}</span><Badge tone="green">{transferRow.quantity} وحدة</Badge></div><div className="mt-1 text-sm font-semibold text-ink">{transferRow.productName}</div><div className="mt-2 flex items-center gap-2 text-xs text-ink-muted"><span>{pro.branches.find((branch) => branch.id === transferRow.fromBranchId)?.name}</span><ArrowLeftRight className="h-3.5 w-3.5" /><span>{pro.branches.find((branch) => branch.id === transferRow.toBranchId)?.name}</span></div><div className="mt-1 text-[11px] text-ink-faint" dir="ltr">{transferRow.date}</div></div>)}</div>}
          </CardBody>
        </Card>
      </div>

      <Dialog open={activationDialog} onClose={() => setActivationDialog(false)} title="تفعيل إضافة فرع جديد" subtitle="ميزة مدفوعة — كل كود يفتح فرعًا واحدًا فقط" width="lg" footer={<><Button variant="outline" onClick={() => setActivationDialog(false)}>إلغاء</Button><Button variant="outline" onClick={() => window.open(`https://wa.me/${DEVELOPER_WHATSAPP}?text=${whatsappMessage}`, "_blank", "noopener,noreferrer")}><MessageCircle className="h-4 w-4" /> تواصل مع المطور</Button><Button onClick={activateBranchSlot} disabled={activating}><KeyRound className="h-4 w-4" /> {activating ? "جارِ التفعيل..." : "تفعيل فرع واحد"}</Button></>}>
        <div className="space-y-4">
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="flex items-center gap-2 font-bold"><LockKeyhole className="h-5 w-5" /> إضافة الفروع تحتاج ترخيصًا مستقلًا</div>
            <p className="mt-2 leading-6">أرسل كود الجهاز للمطور بعد سداد تكلفة تركيب الفرع. سيصلك كود مرتبط بهذا الجهاز، يُستخدم مرة واحدة ويتيح إنشاء فرع واحد فقط.</p>
          </div>
          <Field label="كود الجهاز" hint="انسخه وأرسله للمطور">
            <div className="flex gap-2" dir="ltr"><Input value={machineCode} readOnly className="font-mono text-left" /><Button type="button" variant="outline" onClick={copyMachineCode}><Copy className="h-4 w-4" /> نسخ</Button></div>
          </Field>
          <Field label="كود تفعيل الفرع" required hint="يبدأ الكود بـ APBRN">
            <Textarea value={activationCode} onChange={(event) => setActivationCode(event.target.value)} placeholder="APBRN..." dir="ltr" className="min-h-28 font-mono text-left" />
          </Field>
          <div className="rounded-xl border border-line bg-surface-muted p-3 text-xs leading-6 text-ink-muted">بعد نجاح التفعيل ستفتح شاشة بيانات الفرع مباشرة. عند طلب فرع ثالث أو رابع ستتكرر نفس الخطوات بكود جديد لكل فرع.</div>
        </div>
      </Dialog>

      <Dialog open={branchDialog} onClose={() => setBranchDialog(false)} title="إضافة الفرع المُفعّل" subtitle="سيبدأ بدون رصيد، وسيُستهلك مكان الفرع بعد الحفظ" footer={<><Button variant="outline" onClick={() => setBranchDialog(false)}>إلغاء</Button><Button onClick={addBranch} disabled={creatingBranch}><Plus className="h-4 w-4" /> {creatingBranch ? "جارِ الإضافة..." : "إضافة الفرع"}</Button></>}><div className="space-y-4"><Field label="اسم الفرع" required><Input value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="فرع مدينة نصر" /></Field><Field label="العنوان"><Input value={branchAddress} onChange={(event) => setBranchAddress(event.target.value)} /></Field><Field label="الهاتف"><Input value={branchPhone} onChange={(event) => setBranchPhone(event.target.value)} dir="ltr" /></Field></div></Dialog>

      <Dialog open={transferDialog} onClose={() => setTransferDialog(false)} title="تحويل مخزون بين الفروع" subtitle="التحويل يعيد توزيع الرصيد ولا يغير إجمالي المنتج" width="lg" footer={<><Button variant="outline" onClick={() => setTransferDialog(false)}>إلغاء</Button><Button onClick={transfer}><ArrowLeftRight className="h-4 w-4" /> تنفيذ التحويل</Button></>}>
        <div className="grid gap-4 md:grid-cols-2"><Field label="من فرع" required><Select value={fromBranchId} onChange={(event) => setFromBranchId(event.target.value)}>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select></Field><Field label="إلى فرع" required><Select value={toBranchId} onChange={(event) => setToBranchId(event.target.value)}><option value="">اختر الفرع</option>{activeBranches.filter((branch) => branch.id !== fromBranchId).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</Select></Field><Field label="القطعة" required className="md:col-span-2"><Select value={productId} onChange={(event) => setProductId(event.target.value)}><option value="">اختر المنتج</option>{products.filter((product) => !product.archived && pro.branchQuantity(fromBranchId, product.id) > 0).map((product) => <option key={product.id} value={product.id}>{product.partNumber || product.code} — {product.name}</option>)}</Select></Field><Field label="الكمية" hint={`المتاح في المصدر: ${sourceAvailable}`} required><Input type="number" min="1" max={sourceAvailable} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} /></Field><div className="rounded-xl border border-line bg-surface-muted p-3"><div className="text-xs text-ink-faint">بعد التحويل</div><div className="mt-1 text-lg font-bold text-ink">{Math.max(0, sourceAvailable - quantity)} متبقي</div></div><Field label="ملاحظات" className="md:col-span-2"><Textarea value={transferNotes} onChange={(event) => setTransferNotes(event.target.value)} /></Field></div>
      </Dialog>
    </div>
  );
}
