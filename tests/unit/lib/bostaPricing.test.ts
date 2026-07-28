import { describe, expect, it } from "vitest";
import { extractBostaPricingRows } from "../../../src/lib/bostaPricing";

describe("Bosta pricing plan parser", () => {
  it("reads zone, service, package size and cost from the official price matrix", () => {
    const rows = extractBostaPricingRows({
      data: {
        prices: [
          {
            dropoffSectorId: 1,
            dropoffSectorName: "Cairo & Giza",
            dropoffSectorNameArabic: "القاهرة والجيزة",
            tierServiceTypes: [
              {
                typeName: "SEND",
                tierSizes: [
                  { sizeName: "Normal", cost: "97.00" },
                  { sizeName: "Large", cost: 102 },
                ],
              },
            ],
          },
        ],
      },
    });

    expect(rows).toEqual([
      {
        id: "1:SEND:NORMAL",
        route: "القاهرة والجيزة",
        size: "صغير ومتوسط",
        service: "توصيل",
        amount: 97,
      },
      {
        id: "1:SEND:LARGE",
        route: "القاهرة والجيزة",
        size: "كبير (L)",
        service: "توصيل",
        amount: 102,
      },
    ]);
  });

  it("does not expose tier metadata and COD rules as region prices", () => {
    const rows = extractBostaPricingRows({
      data: {
        tier: {
          cost: 37,
          zeroCodDiscount: { amount: 0 },
          extraCodFee: {
            percentage: 0.01,
            codAmount: 2_000,
            minimumFeeAmount: 0,
          },
          expediteFee: { percentage: 0.01 },
        },
      },
    });

    expect(rows).toEqual([]);
  });

  it("uses the configured Arabic sector label when the API omits its name", () => {
    const rows = extractBostaPricingRows({
      prices: [
        {
          dropoffSectorId: 7,
          tierServiceTypes: [
            {
              typeName: "RTO",
              tierSizes: [{ sizeName: "Heavy Bulky", cost: 150 }],
            },
          ],
        },
      ],
    });

    expect(rows[0]).toMatchObject({
      route: "سيناء والوادي الجديد",
      size: "ضخم ثقيل",
      service: "إرجاع الشحنة",
      amount: 150,
    });
  });

  it("never exposes untranslated carrier service codes", () => {
    const rows = extractBostaPricingRows({
      prices: [
        {
          dropoffSectorId: 1,
          tierServiceTypes: [
            {
              typeName: "SIGN_AND_RETURN_OTHER_DAY",
              tierSizes: [{ sizeName: "Normal", cost: 50 }],
            },
            {
              typeName: "UNKNOWN_CARRIER_CODE",
              tierSizes: [{ sizeName: "UNKNOWN_SIZE", cost: 75 }],
            },
          ],
        },
      ],
    });

    expect(rows.map((row) => row.service)).toEqual([
      "توقيع وإرجاع في يوم لاحق",
      "خدمة شحن خاصة",
    ]);
    expect(rows[1].size).toBe("حجم مخصص");
  });
});
