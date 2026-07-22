import { useMemo, useState } from "react";
import { ArrowLeft, BookOpenCheck, CarFront, ChevronDown, LifeBuoy, MessageCircle, ScanLine, Search, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { useFeatures } from "../lib/useFeatures";
import { useSettings } from "../store/SettingsContext";
import { useAuth } from "../store/AuthContext";
import { HELP_QUICK_QUESTIONS, HELP_SECTIONS, searchHelp } from "../lib/helpContent";
import { cn } from "../lib/utils";
import { hasPermission } from "../lib/permissions";

export function HelpPage() {
  const { isEnabled } = useFeatures();
  const { settings } = useSettings();
  const { currentUser } = useAuth();
  const [query, setQuery] = useState("");
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());

  // Only show help for modules the install actually has.
  const available = useMemo(
    () => HELP_SECTIONS.filter((s) => !s.feature || isEnabled(s.feature)),
    [isEnabled]
  );
  const sections = useMemo(() => searchHelp(available, query), [available, query]);
  const resultQuestions = sections.reduce((sum, section) => sum + section.items.length, 0);
  const canViewPartsFinder = hasPermission(currentUser, "products");

  const isSearching = query.trim().length > 0;
  const isOpen = (key: string) => isSearching || openItems.has(key);
  const toggle = (key: string) =>
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const supportUrl = `https://wa.me/201118445625?text=${encodeURIComponent(
    "استفسار / مشكلة — AutoParts Inventory & Sales System\nالمحل: " + (settings.companyNameAr || settings.companyName || "—")
  )}`;

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={BookOpenCheck}
        title="مساعد تشغيل محل قطع الغيار"
        description="اسأل بطريقتك عن السيارة أو القطعة أو الاسكان أو البيع والضمان والفروع. البحث يفهم المرادفات العربية والإنجليزية والأخطاء الإملائية البسيطة."
        actions={canViewPartsFinder ? <Link to="/parts-finder" className="inline-flex h-10 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 text-sm font-bold text-cyan-200 hover:bg-cyan-300/20"><CarFront className="h-4 w-4" /> افتح دليل القطع</Link> : undefined}
      />

      <Card className="overflow-hidden border-cyan-200/70 dark:border-cyan-500/20">
        <CardBody className="space-y-4 bg-gradient-to-l from-cyan-50/70 to-transparent dark:from-cyan-500/[0.06]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><div className="flex items-center gap-2 text-sm font-bold text-ink"><Sparkles className="h-4 w-4 text-cyan-600" /> بحث ذكي في المساعدة</div><div className="mt-1 text-xs text-ink-faint">مثال: «السكانر مش بيضيف»، «بديل OEM»، «قطعة تنفع للعربية؟»</div></div>
            {isSearching ? <Badge tone="blue">{resultQuestions} نتيجة</Badge> : <Badge tone="slate">كل الأسئلة</Badge>}
          </div>
          <div className="relative">
            <Search className="absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-600" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="اكتب المشكلة أو السؤال: VIN، OEM، توافق، ضمان، فرع، سعر ورشة..."
              className="h-12 rounded-xl bg-surface ps-12 text-base shadow-sm"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {HELP_QUICK_QUESTIONS.map((question) => (
              <button key={question} type="button" onClick={() => setQuery(question)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-semibold text-ink-muted transition hover:border-cyan-400 hover:text-cyan-700">{question}</button>
            ))}
          </div>
        </CardBody>
      </Card>

      {sections.length === 0 ? (
        <Card>
          <CardBody>
            <div className="text-center py-10 text-sm text-ink-faint">
              <LifeBuoy className="w-8 h-8 mx-auto mb-3 text-ink-faint" />
              مفيش نتيجة مطابقة. جرّب رقم القطعة أو كلمة أبسط زي «شاسيه»، «بديل»، «اسكان» أو «ضمان».
            </div>
          </CardBody>
        </Card>
      ) : (
        sections.map((section) => (
          <Card key={section.id} className="overflow-hidden">
            <CardHeader title={<span className="flex items-center gap-2"><ScanLine className="h-4 w-4 text-cyan-600" />{section.title}</span>} subtitle={`${section.items.length} سؤال`} />
            <CardBody className="p-0">
              <ul className="divide-y divide-line-soft">
                {section.items.map((item) => {
                  const key = `${section.id}-${item.q}`;
                  const open = isOpen(key);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        className="w-full flex items-center justify-between gap-3 text-start px-4 py-3 hover:bg-surface-muted transition-colors"
                      >
                        <span className="text-sm font-medium text-ink">{item.q}</span>
                        <ChevronDown
                          className={cn(
                            "w-4 h-4 shrink-0 text-ink-faint transition-transform",
                            open && "rotate-180"
                          )}
                        />
                      </button>
                      {open && (
                        <div className="-mt-1 bg-surface-muted/45 px-4 pb-4 pt-3 text-sm leading-7 text-ink-muted">
                          <div>{item.a}</div>
                          {item.to ? <Link to={item.to} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-700 hover:bg-cyan-100 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300">افتح الصفحة المرتبطة <ArrowLeft className="h-3.5 w-3.5" /></Link> : null}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </CardBody>
          </Card>
        ))
      )}

      <Card>
        <CardBody className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-sm text-ink-muted">
            ملقيتش إجابة لسؤالك؟ تواصل مع الدعم الفني مباشرة.
          </div>
          <a
            href={supportUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 py-2.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-semibold text-sm transition-colors shrink-0"
          >
            <MessageCircle className="w-4 h-4" />
            تواصل مع الدعم عبر واتساب
          </a>
        </CardBody>
      </Card>
    </div>
  );
}
