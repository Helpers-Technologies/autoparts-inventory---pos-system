import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, BriefcaseBusiness, Pencil, Plus, UserRoundCog } from "lucide-react";
import { PageHeader } from "../components/layout/AppLayout";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody } from "../components/ui/Card";
import { Dialog } from "../components/ui/Dialog";
import { Field, Input, Textarea } from "../components/ui/Input";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { useToast } from "../components/ui/Toast";
import { formatCurrency } from "../lib/format";
import { todayISO } from "../lib/utils";
import { useCatalog } from "../store/CatalogContext";
import { useInvoicing } from "../store/InvoicingContext";
import { useSettings } from "../store/SettingsContext";
import { useUsers } from "../store/UsersContext";

type EmployeeKind = "user" | "driver" | "offline";
type EmployeeRow = {
  key: string;
  id: string;
  kind: EmployeeKind;
  name: string;
  subtitle: string;
  salary: number;
  bonus: number;
  penalty: number;
  advance: number;
  commission: number;
  net: number;
};

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function EmployeesPage() {
  const { users, updateUser } = useUsers();
  const {
    drivers, updateDriver, offlineEmployees, offlineTransactions,
    addOfflineEmployee, updateOfflineEmployee, addOfflineTransaction, deleteOfflineTransaction,
  } = useCatalog();
  const { salesInvoices, cashEntries } = useInvoicing();
  const { settings } = useSettings();
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [form, setForm] = useState({ salary: "", bonus: "", penalty: "", advance: "" });

  const rows = useMemo<EmployeeRow[]>(() => {
    const paidFor = (kind: EmployeeKind, id: string) => Math.abs(
      cashEntries
        .filter((entry) => entry.referenceId === `payroll:${kind}:${id}:${month}` && entry.amount < 0)
        .reduce((sum, entry) => sum + entry.amount, 0),
    );
    const userRows = users.filter((user) => user.role !== "owner").map((user) => {
      const cfg = user.monthlyConfigs?.[month] ?? {};
      const sales = salesInvoices
        .filter((invoice) => !invoice.cancelled && invoice.createdByUserId === user.id && invoice.date.slice(0, 7) === month)
        .reduce((sum, invoice) => sum + invoice.total, 0);
      const commission = Math.round((sales * (cfg.commissionPct ?? user.salesCommissionPct ?? 0) / 100) * 100) / 100;
      const salary = user.monthlySalary ?? 0;
      const bonus = cfg.bonus ?? 0;
      const penalty = cfg.penalty ?? 0;
      const advance = cfg.advance ?? 0;
      return { key: `user:${user.id}`, id: user.id, kind: "user" as const, name: user.name || user.username, subtitle: `حساب نظام: ${user.username}`, salary, bonus, penalty, advance, commission, net: Math.max(0, salary + bonus + commission - penalty - advance - paidFor("user", user.id)) };
    });
    const driverRows = drivers.map((driver) => {
      const cfg = driver.monthlyConfigs?.[month] ?? {};
      const salary = driver.salary ?? 0;
      const bonus = cfg.bonus ?? 0;
      const penalty = cfg.penalty ?? 0;
      const advance = cfg.advance ?? 0;
      return { key: `driver:${driver.id}`, id: driver.id, kind: "driver" as const, name: driver.name, subtitle: "سائق بدون حساب نظام", salary, bonus, penalty, advance, commission: 0, net: Math.max(0, salary + bonus - penalty - advance - paidFor("driver", driver.id)) };
    });
    const offlineRows = offlineEmployees.filter((employee) => !employee.archived).map((employee) => {
      const tx = offlineTransactions.filter((item) => item.employeeId === employee.id && item.month === month);
      const sum = (type: "incentive" | "deduction" | "advance") => tx.filter((item) => item.type === type).reduce((total, item) => total + item.amount, 0);
      const bonus = sum("incentive");
      const penalty = sum("deduction");
      const advance = sum("advance");
      return { key: `offline:${employee.id}`, id: employee.id, kind: "offline" as const, name: employee.name, subtitle: employee.jobTitle || "موظف بدون حساب نظام", salary: employee.basicSalary, bonus, penalty, advance, commission: 0, net: Math.max(0, employee.basicSalary + bonus - penalty - advance - paidFor("offline", employee.id)) };
    });
    return [...userRows, ...driverRows, ...offlineRows].sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [users, drivers, offlineEmployees, offlineTransactions, month, salesInvoices, cashEntries]);

  const totals = rows.reduce((result, row) => ({ salary: result.salary + row.salary, bonus: result.bonus + row.bonus + row.commission, deductions: result.deductions + row.penalty + row.advance, net: result.net + row.net }), { salary: 0, bonus: 0, deductions: 0, net: 0 });

  function openEdit(row: EmployeeRow) {
    setEditing(row);
    setForm({ salary: String(row.salary), bonus: String(row.bonus), penalty: String(row.penalty), advance: String(row.advance) });
  }

  function saveFinancials() {
    if (!editing) return;
    const salary = Math.max(0, Number(form.salary) || 0);
    const bonus = Math.max(0, Number(form.bonus) || 0);
    const penalty = Math.max(0, Number(form.penalty) || 0);
    const advance = Math.max(0, Number(form.advance) || 0);
    if (editing.kind === "user") {
      const user = users.find((item) => item.id === editing.id);
      if (user) updateUser(user.id, { monthlySalary: salary, monthlyConfigs: { ...(user.monthlyConfigs ?? {}), [month]: { ...(user.monthlyConfigs?.[month] ?? {}), bonus, penalty, advance } } });
    } else if (editing.kind === "driver") {
      const driver = drivers.find((item) => item.id === editing.id);
      if (driver) updateDriver(driver.id, { salary, monthlyConfigs: { ...(driver.monthlyConfigs ?? {}), [month]: { ...(driver.monthlyConfigs?.[month] ?? {}), bonus, penalty, advance } } });
    } else {
      updateOfflineEmployee(editing.id, { basicSalary: salary });
      offlineTransactions
        .filter((item) => item.employeeId === editing.id && item.month === month && ["incentive", "deduction", "advance"].includes(item.type))
        .forEach((item) => deleteOfflineTransaction(item.id));
      ([
        ["incentive", bonus], ["deduction", penalty], ["advance", advance],
      ] as const).forEach(([type, amount]) => {
        if (amount > 0) addOfflineTransaction({ employeeId: editing.id, type, amount, month, date: todayISO(), notes: `استحقاق شهر ${month}` });
      });
    }
    toast.success("تم تحديث استحقاقات الموظف");
    setEditing(null);
  }

  return (
    <>
      <PageHeader title="الموظفين والمرتبات" description="المستخدمون والسائقون والموظفون بدون حساب في مكان واحد" actions={<><Input type="month" value={month} onChange={(event) => setMonth(event.target.value || currentMonth())} className="w-40" /><Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> إضافة موظف بدون حساب</Button></>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Summary label="إجمالي المرتبات" value={totals.salary} currency={settings.currency} />
        <Summary label="البونص والعمولات" value={totals.bonus} currency={settings.currency} tone="green" />
        <Summary label="الخصومات والسلف" value={totals.deductions} currency={settings.currency} tone="red" />
        <Summary label="المتبقي للصرف" value={totals.net} currency={settings.currency} tone="blue" />
      </div>
      <Card>
        <CardBody className="p-0">
          <Table><THead><TR><TH>الموظف</TH><TH>النوع</TH><TH className="text-end">المرتب</TH><TH className="text-end">البونص / العمولة</TH><TH className="text-end">الخصم</TH><TH className="text-end">السلفة</TH><TH className="text-end">المتبقي للصرف</TH><TH className="w-40" /></TR></THead>
            <TBody>{rows.map((row) => <TR key={row.key}><TD><div className="font-semibold text-ink">{row.name}</div><div className="text-xs text-ink-faint">{row.subtitle}</div></TD><TD><Badge tone={row.kind === "user" ? "blue" : row.kind === "driver" ? "indigo" : "slate"}>{row.kind === "user" ? "مستخدم نظام" : row.kind === "driver" ? "سائق" : "بدون حساب"}</Badge></TD><TD className="text-end">{formatCurrency(row.salary, settings.currency)}</TD><TD className="text-end text-emerald-600">+{formatCurrency(row.bonus + row.commission, settings.currency)}</TD><TD className="text-end text-rose-600">-{formatCurrency(row.penalty, settings.currency)}</TD><TD className="text-end text-amber-600">-{formatCurrency(row.advance, settings.currency)}</TD><TD className="text-end font-bold text-brand-600">{formatCurrency(row.net, settings.currency)}</TD><TD><div className="flex justify-end gap-1"><Button size="sm" variant="outline" onClick={() => openEdit(row)}><Pencil className="h-3.5 w-3.5" /> الاستحقاقات</Button>{row.kind === "user" && <Link to={`/employees/${row.id}`}><Button size="sm" variant="ghost">الملف</Button></Link>}{row.kind === "driver" && <Link to={`/drivers/${row.id}`}><Button size="sm" variant="ghost">الملف</Button></Link>}</div></TD></TR>)}</TBody>
          </Table>
        </CardBody>
      </Card>

      <Dialog open={addOpen} onClose={() => setAddOpen(false)} title="إضافة موظف بدون حساب نظام" footer={<><Button variant="outline" onClick={() => setAddOpen(false)}>إلغاء</Button><Button type="submit" form="offline-employee-form">حفظ</Button></>}>
        <form id="offline-employee-form" className="space-y-3" onSubmit={(event) => { event.preventDefault(); const data = new FormData(event.currentTarget); addOfflineEmployee({ name: String(data.get("name") || "").trim(), jobTitle: String(data.get("jobTitle") || "").trim(), phone: String(data.get("phone") || "").trim(), idNumber: String(data.get("idNumber") || "").trim(), basicSalary: Math.max(0, Number(data.get("salary")) || 0), notes: String(data.get("notes") || "").trim() }); toast.success("تمت إضافة الموظف"); setAddOpen(false); }}>
          <Field label="اسم الموظف" required><Input name="name" required autoFocus /></Field><div className="grid grid-cols-2 gap-3"><Field label="الوظيفة"><Input name="jobTitle" /></Field><Field label="رقم الهاتف"><Input name="phone" inputMode="numeric" /></Field><Field label="الرقم القومي / التعريفي"><Input name="idNumber" /></Field><Field label="المرتب الأساسي"><Input name="salary" type="number" min={0} required /></Field></div><Field label="ملاحظات"><Textarea name="notes" /></Field>
        </form>
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={`استحقاقات ${editing?.name ?? "الموظف"}`} subtitle={`شهر ${month} — هذه القيم ستظهر تلقائيًا وقت الصرف`} footer={<><Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button><Button onClick={saveFinancials}>حفظ</Button></>}>
        <div className="grid grid-cols-2 gap-3"><Field label="المرتب الأساسي"><Input type="number" min={0} value={form.salary} onChange={(event) => setForm({ ...form, salary: event.target.value })} /></Field><Field label="البونص (+)"><Input type="number" min={0} value={form.bonus} onChange={(event) => setForm({ ...form, bonus: event.target.value })} /></Field><Field label="الخصم (-)"><Input type="number" min={0} value={form.penalty} onChange={(event) => setForm({ ...form, penalty: event.target.value })} /></Field><Field label="السلفة (-)"><Input type="number" min={0} value={form.advance} onChange={(event) => setForm({ ...form, advance: event.target.value })} /></Field></div>
      </Dialog>
    </>
  );
}

function Summary({ label, value, currency, tone = "slate" }: { label: string; value: number; currency: string; tone?: "slate" | "green" | "red" | "blue" }) {
  const colors = { slate: "text-ink", green: "text-emerald-600", red: "text-rose-600", blue: "text-brand-600" };
  return <Card><CardBody className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-lg bg-surface-muted text-brand-500">{tone === "blue" ? <Banknote className="h-5 w-5" /> : tone === "slate" ? <BriefcaseBusiness className="h-5 w-5" /> : <UserRoundCog className="h-5 w-5" />}</div><div><div className="text-xs text-ink-faint">{label}</div><div className={`mt-1 text-lg font-bold ${colors[tone]}`}>{formatCurrency(value, currency)}</div></div></CardBody></Card>;
}
