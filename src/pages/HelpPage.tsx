import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  BookOpen,
  BookOpenCheck,
  Bot,
  CarFront,
  ChevronDown,
  CircleHelp,
  LifeBuoy,
  MessageCircle,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  WifiOff,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { AutoPartsHero } from "../components/AutoPartsHero";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardBody, CardHeader } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { useFeatures } from "../lib/useFeatures";
import { useSettings } from "../store/SettingsContext";
import { useAuth } from "../store/AuthContext";
import {
  HELP_QUICK_QUESTIONS,
  HELP_SECTIONS,
  answerHelpQuestion,
  searchHelp,
} from "../lib/helpContent";
import { cn } from "../lib/utils";
import { hasPermission } from "../lib/permissions";

type AssistantMessage = {
  id: string;
  role: "assistant" | "user";
  text: string;
  matchedQuestion?: string;
  sectionTitle?: string;
  to?: string;
  relatedQuestions?: string[];
  noMatch?: boolean;
};

const WELCOME_MESSAGE: AssistantMessage = {
  id: "welcome",
  role: "assistant",
  text: "أهلاً بك. اكتب المشكلة بطريقتك، وسأبحث داخل دليل النظام وأعطيك الخطوات الأقرب مع رابط الصفحة المناسبة.",
  relatedQuestions: [
    "السكانر بيكتب الرقم ومش بيضيف القطعة",
    "نسيت كلمة المرور وعندي كود احتياطي",
    "إزاي أعرف القطعة تنفع للعربية؟",
  ],
};

export function HelpPage() {
  const { isEnabled } = useFeatures();
  const { settings } = useSettings();
  const { currentUser } = useAuth();
  const [query, setQuery] = useState("");
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([WELCOME_MESSAGE]);
  const assistantEndRef = useRef<HTMLDivElement>(null);

  // Only show help for modules the install actually has.
  const available = useMemo(
    () => HELP_SECTIONS.filter((section) => !section.feature || isEnabled(section.feature)),
    [isEnabled],
  );
  const searchedSections = useMemo(() => searchHelp(available, query), [available, query]);
  const isSearching = query.trim().length > 0;
  const visibleSections = useMemo(() => {
    if (isSearching) return searchedSections;
    if (!activeSectionId) return [];
    return available.filter((section) => section.id === activeSectionId);
  }, [activeSectionId, available, isSearching, searchedSections]);
  const resultQuestions = searchedSections.reduce((sum, section) => sum + section.items.length, 0);
  const totalQuestions = available.reduce((sum, section) => sum + section.items.length, 0);
  const canViewPartsFinder = hasPermission(currentUser, "products");

  const topResultKey = isSearching && visibleSections[0]?.items[0]
    ? `${visibleSections[0].id}-${visibleSections[0].items[0].q}`
    : "";
  const isOpen = (key: string) => openItems.has(key) || key === topResultKey;
  const toggle = (key: string) =>
    setOpenItems((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    assistantEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [assistantMessages]);

  const supportUrl = `https://wa.me/201118445625?text=${encodeURIComponent(
    "استفسار / مشكلة — AutoParts Inventory & Sales System\nالمحل: " + (settings.companyNameAr || settings.companyName || "—"),
  )}`;

  function askAssistant(rawQuestion?: string) {
    const question = (rawQuestion ?? assistantInput).trim();
    if (!question) return;

    const answer = answerHelpQuestion(available, question);
    const stamp = `${Date.now()}-${assistantMessages.length}`;
    const userMessage: AssistantMessage = {
      id: `user-${stamp}`,
      role: "user",
      text: question,
    };
    const assistantMessage: AssistantMessage = answer
      ? {
          id: `assistant-${stamp}`,
          role: "assistant",
          text: answer.answer,
          matchedQuestion: answer.matchedQuestion,
          sectionTitle: answer.sectionTitle,
          to: answer.to,
          relatedQuestions: answer.relatedQuestions,
        }
      : {
          id: `assistant-${stamp}`,
          role: "assistant",
          text: "لم أجد إجابة مؤكدة داخل دليل النظام. جرّب كتابة اسم الصفحة أو العملية بكلمات أبسط، مثل: فاتورة، مخزون، باركود، فرع، ضمان أو كود احتياطي.",
          relatedQuestions: [...HELP_QUICK_QUESTIONS.slice(0, 3)],
          noMatch: true,
        };

    setAssistantMessages((previous) => [...previous, userMessage, assistantMessage]);
    setAssistantInput("");
  }

  function handleAssistantSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    askAssistant();
  }

  function resetAssistant() {
    setAssistantMessages([WELCOME_MESSAGE]);
    setAssistantInput("");
  }

  function selectSection(sectionId: string) {
    setQuery("");
    setActiveSectionId(sectionId);
    setOpenItems(new Set());
  }

  return (
    <div className="space-y-5" dir="rtl">
      <AutoPartsHero
        icon={BookOpenCheck}
        title="مركز المساعدة الذكي"
        description="اسأل مساعد النظام بطريقتك أو ابحث داخل دليل التشغيل. يفهم المرادفات العربية والإنجليزية والأخطاء الإملائية البسيطة، ويعمل محلياً بدون إنترنت."
        actions={canViewPartsFinder ? (
          <Link
            to="/parts-finder"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-cyan-300/20 bg-cyan-300/10 px-4 text-sm font-bold text-cyan-200 transition-colors hover:bg-cyan-300/20"
          >
            <CarFront className="h-4 w-4" /> افتح دليل القطع
          </Link>
        ) : undefined}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(19rem,0.55fr)]">
        <Card className="overflow-hidden border-cyan-200/70 dark:border-cyan-500/25">
          <CardHeader
            title={(
              <span className="flex items-center gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300">
                  <Bot className="h-4 w-4" />
                </span>
                مساعد النظام
              </span>
            )}
            subtitle="إجابات مباشرة من دليل التشغيل الخاص بنسختك"
            actions={(
              <div className="flex items-center gap-2">
                <Badge tone="emerald" className="hidden sm:inline-flex"><WifiOff className="h-3 w-3" /> محلي وأوفلاين</Badge>
                <Button type="button" variant="ghost" size="icon" title="بدء محادثة جديدة" onClick={resetAssistant}>
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            )}
          />
          <CardBody className="space-y-3 bg-gradient-to-l from-cyan-50/45 to-transparent dark:from-cyan-500/[0.04]">
            <div className="max-h-[25rem] min-h-60 space-y-3 overflow-y-auto rounded-xl border border-line bg-surface/80 p-3">
              {assistantMessages.map((message) => (
                <div key={message.id} className={cn("flex", message.role === "user" ? "justify-start" : "justify-end")}>
                  <div
                    className={cn(
                      "max-w-[92%] rounded-2xl px-3.5 py-3 text-sm leading-7 shadow-sm sm:max-w-[82%]",
                      message.role === "user"
                        ? "rounded-tr-md bg-brand-600 text-white"
                        : message.noMatch
                          ? "rounded-tl-md border border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100"
                          : "rounded-tl-md border border-line bg-surface text-ink-muted",
                    )}
                  >
                    {message.role === "assistant" ? (
                      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold text-cyan-700 dark:text-cyan-300">
                        <Sparkles className="h-3.5 w-3.5" /> إجابة من دليل النظام
                      </div>
                    ) : null}
                    <p>{message.text}</p>
                    {message.matchedQuestion ? (
                      <div className="mt-2 rounded-lg bg-surface-muted/75 px-2.5 py-2 text-[11px] leading-5 text-ink-faint">
                        <span className="font-bold text-ink-muted">الموضوع المطابق:</span> {message.matchedQuestion}
                        {message.sectionTitle ? <span className="me-1"> · {message.sectionTitle}</span> : null}
                      </div>
                    ) : null}
                    {message.to ? (
                      <Link
                        to={message.to}
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-700 hover:bg-cyan-100 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300"
                      >
                        افتح الصفحة المرتبطة <ArrowLeft className="h-3.5 w-3.5" />
                      </Link>
                    ) : null}
                    {message.relatedQuestions?.length ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {message.relatedQuestions.map((question) => (
                          <button
                            key={`${message.id}-${question}`}
                            type="button"
                            onClick={() => askAssistant(question)}
                            className="rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-semibold leading-5 text-ink-muted transition-colors hover:border-cyan-400 hover:text-cyan-700 dark:hover:text-cyan-300"
                          >
                            {question}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
              <div ref={assistantEndRef} />
            </div>

            <form onSubmit={handleAssistantSubmit} className="flex gap-2">
              <div className="relative min-w-0 flex-1">
                <Bot className="absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-600" />
                <Input
                  value={assistantInput}
                  onChange={(event) => setAssistantInput(event.target.value)}
                  placeholder="اكتب سؤالك أو المشكلة بطريقتك..."
                  className="h-11 rounded-xl bg-surface ps-10 pe-3 text-start"
                  autoComplete="off"
                />
              </div>
              <Button type="submit" className="h-11 shrink-0 rounded-xl px-4" disabled={!assistantInput.trim()}>
                <Send className="h-4 w-4" /> <span className="hidden sm:inline">اسأل</span>
              </Button>
            </form>
            <p className="text-[10px] leading-5 text-ink-faint">
              المساعد لا يرسل بياناتك لأي جهة؛ إجاباته مبنية على دليل النظام المحلي ولا ينفّذ أي تعديل بنفسه.
            </p>
          </CardBody>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title={<span className="flex items-center gap-2"><CircleHelp className="h-4 w-4 text-brand-600" /> أسئلة شائعة</span>}
            subtitle="ابدأ بأحد الأسئلة المقترحة"
            actions={<Badge tone="slate">{totalQuestions} إجابة</Badge>}
          />
          <CardBody className="space-y-2.5">
            {HELP_QUICK_QUESTIONS.slice(0, 5).map((question, index) => (
              <button
                key={question}
                type="button"
                onClick={() => askAssistant(question)}
                className="group flex w-full items-center gap-3 rounded-xl border border-line bg-surface-muted/35 p-3 text-start transition-colors hover:border-cyan-300 hover:bg-cyan-50/60 dark:hover:bg-cyan-500/[0.06]"
              >
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface text-[11px] font-black text-cyan-700 shadow-sm dark:text-cyan-300">
                  {index + 1}
                </span>
                <span className="flex-1 text-xs font-semibold leading-5 text-ink-muted group-hover:text-ink">{question}</span>
                <ArrowLeft className="h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform group-hover:-translate-x-0.5" />
              </button>
            ))}
            <a
              href={supportUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700"
            >
              <MessageCircle className="h-4 w-4" /> تواصل مع الدعم
            </a>
          </CardBody>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader
          title={<span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-cyan-600" /> دليل تشغيل النظام</span>}
          subtitle="ابحث بكلمة أو اختر موضوعاً لتصفح الخطوات"
          actions={isSearching ? <Badge tone="blue">{resultQuestions} نتيجة</Badge> : <Badge tone="slate">{available.length} موضوع</Badge>}
        />
        <CardBody className="space-y-4">
          <div className="relative">
            <Search className="absolute start-4 top-1/2 h-5 w-5 -translate-y-1/2 text-cyan-600" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="ابحث عن عملية أو مشكلة: VIN، OEM، باركود، ضمان، فرع، 2FA..."
              className="h-12 rounded-xl bg-surface ps-12 pe-12 text-start text-base shadow-sm"
              autoComplete="off"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                title="مسح البحث"
                className="absolute end-3 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-faint hover:bg-surface-muted hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>

          {!isSearching && !activeSectionId ? (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {available.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => selectSection(section.id)}
                  className="group flex items-center gap-3 rounded-xl border border-line bg-surface-muted/30 p-3 text-start transition-colors hover:border-cyan-300 hover:bg-cyan-50/60 dark:hover:bg-cyan-500/[0.06]"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-surface text-cyan-700 dark:text-cyan-300">
                    <BookOpen className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">{section.title}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-faint">{section.items.length} سؤال وإجابة</span>
                  </span>
                  <ArrowLeft className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:-translate-x-0.5" />
                </button>
              ))}
            </div>
          ) : null}

          {!isSearching && activeSectionId ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-muted/45 px-3 py-2">
              <span className="text-xs text-ink-muted">
                تعرض الآن: <strong className="text-ink">{available.find((section) => section.id === activeSectionId)?.title}</strong>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => setActiveSectionId(null)}>
                كل الموضوعات
              </Button>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {isSearching && visibleSections.length === 0 ? (
        <Card>
          <CardBody className="py-10 text-center">
            <LifeBuoy className="mx-auto mb-3 h-8 w-8 text-ink-faint" />
            <div className="text-sm font-bold text-ink">لم نجد نتيجة مطابقة</div>
            <p className="mt-1 text-xs leading-6 text-ink-faint">
              جرّب كلمة أبسط مثل «شاسيه»، «بديل»، «باركود»، «ضمان» أو اسأل مساعد النظام بالأعلى.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {visibleSections.length > 0 ? (
        <div className={cn("grid gap-4", visibleSections.length > 1 && "xl:grid-cols-2")}>
          {visibleSections.map((section) => (
            <Card key={section.id} className="self-start overflow-hidden">
              <CardHeader
                title={<span className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-cyan-600" />{section.title}</span>}
                subtitle={`${section.items.length} سؤال`}
              />
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
                          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-start transition-colors hover:bg-surface-muted"
                        >
                          <span className="text-sm font-medium leading-6 text-ink">{item.q}</span>
                          <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
                        </button>
                        {open ? (
                          <div className="-mt-1 bg-surface-muted/45 px-4 pb-4 pt-3 text-sm leading-7 text-ink-muted">
                            <div>{item.a}</div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              {item.to ? (
                                <Link
                                  to={item.to}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-700 hover:bg-cyan-100 dark:border-cyan-500/30 dark:bg-cyan-500/10 dark:text-cyan-300"
                                >
                                  افتح الصفحة المرتبطة <ArrowLeft className="h-3.5 w-3.5" />
                                </Link>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => askAssistant(item.q)}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold text-ink-muted hover:border-cyan-300 hover:text-cyan-700 dark:hover:text-cyan-300"
                              >
                                <Bot className="h-3.5 w-3.5" /> اسأل المساعد
                              </button>
                            </div>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
