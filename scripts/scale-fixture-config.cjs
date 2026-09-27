"use strict";

const GENERATOR_VERSION = "phase10-v5";
const FIXED_SEED = 2654435769;
const YEARS = 6;

const FIXTURES = [
  { name: "scale-090k", minimumSalesInvoices: 90000, purchaseInvoices: 13500, customers: 40000, products: 12000, suppliers: 2250 },
  { name: "scale-120k", minimumSalesInvoices: 120000, purchaseInvoices: 18000, customers: 50000, products: 15000, suppliers: 3000 },
  { name: "scale-150k", minimumSalesInvoices: 150000, purchaseInvoices: 22500, customers: 60000, products: 19000, suppliers: 3750 },
  { name: "scale-180k", minimumSalesInvoices: 180000, purchaseInvoices: 27000, customers: 72000, products: 22500, suppliers: 4500 },
  { name: "scale-200k", minimumSalesInvoices: 200000, purchaseInvoices: 30000, customers: 80000, products: 25000, suppliers: 5000 },
  { name: "scale-250k", minimumSalesInvoices: 250000, purchaseInvoices: 37500, customers: 100000, products: 31250, suppliers: 6250 },
].map((fixture) => ({
  ...fixture,
  salesInvoices: Math.ceil(fixture.minimumSalesInvoices * 1.005),
  years: YEARS,
  seed: FIXED_SEED,
  branches: 3,
}));

module.exports = { GENERATOR_VERSION, FIXED_SEED, YEARS, FIXTURES };
