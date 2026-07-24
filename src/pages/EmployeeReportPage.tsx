import { useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Target, UserRound } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "../components/layout/AppLayout";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field } from "../components/ui/Input";
import { EmptyState } from "../components/ui/EmptyState";
import { useUsers } from "../store/UsersContext";
import { useReporting } from "../store/ReportingContext";
import { useSettings } from "../store/SettingsContext";
import { formatCurrency } from "../lib/format";
import { localISODate, MONTH_NAMES_AR } from "../lib/utils";

function currentMonth(): string {
  return localISODate().slice(0, 7);
}

function buildMonthOptions(): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  // Last 11 months + current + next 2 = 14 options total
  for (let i = -11; i <= 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const yyyymm = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = `${MONTH_NAMES_AR[d.getMonth()]} ${d.getFullYear()}`;
    options.push({ value: yyyymm, label });
  }
  return options.reverse();
}

export function EmployeeReportPage() {
  const { users } = useUsers();
  const { employeeSalesStats } = useReporting();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonth);
  const monthOptions = useMemo(() => buildMonthOptions(), []);

  const employees = useMemo(
    () => users.filter((user) => user.role === "employee"),
    [users]
  );

  return (
    <>
      <PageHeader
        title="تقرير الموظفين"
        description="متابعة المحصَّل والرواتب الشهرية لكل موظف"
        actions={
          <Button variant="outline" onClick={() => navigate("/reports/financial")}>
            <ArrowRight className="w-4 h-4" /> رجوع للمركز المالي
          </Button>
        }
      />

      <Card>
        <CardBody>
          <Field label="الشهر">
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-52 rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {monthOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>
        </CardBody>
      </Card>

      {employees.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<UserRound className="w-5 h-5" />}
              title="لا يوجد موظفون"
              description="أضف موظفين من صفحة المستخدمين لعرض التقرير."
            />
          </CardBody>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {employees.map((employee) => {
            const stats = employeeSalesStats(employee.id, month);

            return (
              <Card key={employee.id}>
                <CardHeader
                  title={
                    <div className="flex items-center gap-2">
                      <UserRound className="w-4 h-4 text-brand-600" />
                      <span>{employee.name || employee.username}</span>
                    </div>
                  }
                  actions={
                    <span className="text-xs text-ink-faint">{stats.monthLabel}</span>
                  }
                />
                <CardBody className="space-y-3">
                  <div className="divide-y divide-line-soft border-y border-line-soft">
                    <ReportRow
                      label="المحصَّل في الشهر"
                      value={formatCurrency(stats.totalCollected, settings.currency)}
                      tone="slate"
                    />
                    <ReportRow
                      label="الراتب الشهري"
                      value={formatCurrency(stats.salary, settings.currency)}
                      tone="green"
                      strong
                    />
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function ReportRow({
  label,
  value,
  suffix,
  tone = "slate",
  strong,
}: {
  label: string;
  value: string;
  suffix?: ReactNode;
  tone?: "slate" | "green" | "amber";
  strong?: boolean;
}) {
  const colors: Record<"slate" | "green" | "amber", string> = {
    slate: "text-ink",
    green: "text-emerald-700 dark:text-emerald-400",
    amber: "text-amber-700 dark:text-amber-400",
  };

  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <div className="flex items-center gap-2 text-ink-muted">
        <Target className="w-3.5 h-3.5 text-ink-faint" />
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {suffix}
        <span className={`${colors[tone]} ${strong ? "font-bold text-base" : "font-semibold"}`}>
          {value}
        </span>
      </div>
    </div>
  );
}
