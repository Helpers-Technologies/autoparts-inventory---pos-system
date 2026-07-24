import { describe, it, expect } from "vitest";
import {
  answerHelpQuestion,
  searchHelp,
  HELP_SECTIONS,
  type HelpSection,
} from "../../../src/lib/helpContent";

const FIXTURE: HelpSection[] = [
  {
    id: "a",
    title: "الفواتير",
    items: [
      { q: "إزاي أعمل فاتورة؟", a: "اضغط فاتورة جديدة واختر العميل." },
      { q: "إزاي ألغي فاتورة؟", a: "اضغط إلغاء ثم اختر رد كاش." },
    ],
  },
  {
    id: "b",
    title: "المخزون",
    items: [{ q: "إزاي أعمل جرد؟", a: "من الجرد الدوري." }],
  },
];

describe("searchHelp", () => {
  it("empty/whitespace query returns all sections unchanged", () => {
    expect(searchHelp(FIXTURE, "")).toBe(FIXTURE);
    expect(searchHelp(FIXTURE, "   ")).toBe(FIXTURE);
  });

  it("matches inside question or answer and narrows to matching items", () => {
    const res = searchHelp(FIXTURE, "إلغاء");
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("a");
    expect(res[0].items).toHaveLength(1);
    expect(res[0].items[0].q).toContain("ألغي");
  });

  it("a section-title match returns ALL of that section's items", () => {
    const res = searchHelp(FIXTURE, "المخزون");
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe("b");
    expect(res[0].items).toHaveLength(1);
  });

  it("returns [] when nothing matches", () => {
    expect(searchHelp(FIXTURE, "زززحاجةمشموجودة")).toEqual([]);
  });

  it("matches in the answer text too", () => {
    const res = searchHelp(FIXTURE, "العميل");
    expect(res).toHaveLength(1);
    expect(res[0].items[0].q).toContain("أعمل فاتورة");
  });

  it("is forgiving about ة/ه and ى/ي and alef forms", () => {
    // query uses ه where content has ة, and ا where content has أ/إ
    expect(searchHelp(FIXTURE, "فاتوره")).toHaveLength(1);
    expect(searchHelp(FIXTURE, "ازاي اعمل جرد")).toHaveLength(1);
  });

  it("ignores tashkeel in the query", () => {
    expect(searchHelp(FIXTURE, "فَاتُورَة")).toHaveLength(1);
  });

  it("does not mutate the input sections", () => {
    const before = JSON.parse(JSON.stringify(FIXTURE));
    searchHelp(FIXTURE, "جرد");
    expect(FIXTURE).toEqual(before);
  });

  it("understands automotive aliases such as VIN/chassis and scanner/barcode", () => {
    const vinResults = searchHelp(HELP_SECTIONS, "رقم الشاسيه");
    expect(vinResults.some((section) => section.items.some((item) => /VIN|شاسيه/i.test(`${item.q} ${item.a}`)))).toBe(true);

    const scanResults = searchHelp(HELP_SECTIONS, "scanner مش بيقرا");
    expect(scanResults.some((section) => section.id === "scanning-pos")).toBe(true);
  });

  it("matches meaningful words in any order", () => {
    const results = searchHelp(HELP_SECTIONS, "مخزون فرع نقل");
    expect(results.some((section) => section.id === "branches-pricing-purchasing")).toBe(true);
  });

  it("tolerates one typo in a long automotive term", () => {
    const results = searchHelp(HELP_SECTIONS, "الضمانن");
    expect(results.some((section) => section.id === "garage-warranty")).toBe(true);
  });
});

describe("answerHelpQuestion", () => {
  it("returns a direct offline answer with its traceable source", () => {
    const answer = answerHelpQuestion(HELP_SECTIONS, "السكانر بيكتب الرقم ومش بيضيف");

    expect(answer).not.toBeNull();
    expect(answer?.sectionId).toBe("scanning-pos");
    expect(answer?.matchedQuestion).toContain("الاسكان");
    expect(answer?.answer).toContain("الباركود");
  });

  it("returns null instead of inventing an answer", () => {
    expect(answerHelpQuestion(HELP_SECTIONS, "ززز سؤال غير موجود نهائيا")).toBeNull();
  });

  it("respects the caller's feature-filtered knowledge base", () => {
    const restricted = HELP_SECTIONS.filter((section) => section.id === "getting-started");
    expect(answerHelpQuestion(restricted, "مطالبة ضمان")).toBeNull();
  });

  it("suggests a small set of distinct follow-up questions", () => {
    const answer = answerHelpQuestion(HELP_SECTIONS, "نسيت كلمة المرور وعندي كود احتياطي");

    expect(answer?.sectionId).toBe("backup-security");
    expect(answer?.relatedQuestions.length).toBeLessThanOrEqual(3);
    expect(new Set(answer?.relatedQuestions).size).toBe(answer?.relatedQuestions.length);
    expect(answer?.relatedQuestions).not.toContain(answer?.matchedQuestion);
  });

  it("understands everyday questions about locked paid features", () => {
    const answer = answerHelpQuestion(HELP_SECTIONS, "ازاي اقدر امنح مميزات مقفوله");

    expect(answer?.sectionId).toBe("licensing-features-branches");
    expect(answer?.matchedQuestion).toContain("ميزة مقفولة");
    expect(answer?.to).toBe("/settings");
  });

  it("answers that every extra branch needs its own activation", () => {
    const answer = answerHelpQuestion(HELP_SECTIONS, "عايز اضيف فرع تالت");

    expect(answer?.sectionId).toBe("licensing-features-branches");
    expect(answer?.answer).toContain("كودًا جديدًا");
  });

  it("understands stock transfer phrased with an Arabic dual", () => {
    const answer = answerHelpQuestion(HELP_SECTIONS, "إزاي أنقل مخزون بين فرعين؟");

    expect(answer?.sectionId).toBe("branches-pricing-purchasing");
    expect(answer?.matchedQuestion).toContain("فرع لفرع");
    expect(answer?.to).toBe("/branches");
  });
});

describe("HELP_SECTIONS content integrity", () => {
  it("has sections, each with a unique id and at least one item", () => {
    expect(HELP_SECTIONS.length).toBeGreaterThan(0);
    const ids = new Set<string>();
    for (const s of HELP_SECTIONS) {
      expect(s.title.trim()).not.toBe("");
      expect(s.items.length).toBeGreaterThan(0);
      expect(ids.has(s.id)).toBe(false);
      ids.add(s.id);
      for (const it of s.items) {
        expect(it.q.trim()).not.toBe("");
        expect(it.a.trim()).not.toBe("");
      }
    }
  });

  it("includes an alerts/errors reference section with no feature gate", () => {
    const errors = HELP_SECTIONS.find((s) => s.id === "alerts-errors");
    expect(errors).toBeDefined();
    expect(errors!.feature).toBeUndefined();
  });

  it("real content is searchable", () => {
    expect(searchHelp(HELP_SECTIONS, "كاش").length).toBeGreaterThan(0);
    expect(searchHelp(HELP_SECTIONS, "جرد").length).toBeGreaterThan(0);
  });

  it("covers the core AutoParts workflows with a substantial knowledge base", () => {
    const questionCount = HELP_SECTIONS.reduce((sum, section) => sum + section.items.length, 0);
      expect(questionCount).toBeGreaterThanOrEqual(100);
      expect(HELP_SECTIONS.map((section) => section.id)).toEqual(expect.arrayContaining([
        "vehicle-fitment",
        "oem-cross-reference",
        "scanning-pos",
        "garage-warranty",
        "branches-pricing-purchasing",
        "licensing-features-branches",
        "users-permissions",
        "data-files-printing",
      ]));
  });
});
