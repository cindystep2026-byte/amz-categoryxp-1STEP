import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeBestsellerRows,
  selectLiteralTopRanks,
  summarizeFamilySales,
} from "../lib/ranking-sales.mjs";

test("normalizes live bestseller rows by position and removes duplicate ASIN rows", () => {
  const rows = normalizeBestsellerRows([
    { asin: "B000000003", position: 3, categoryUrl: "https://example/leaf" },
    { asin: "B000000001", position: 1, categoryUrl: "https://example/leaf" },
    { asin: "B000000001", position: 2, categoryUrl: "https://example/leaf" },
    { asin: "bad", position: 4, categoryUrl: "https://example/leaf" },
  ]);
  assert.deepEqual(rows.map(x => [x.asin, x.position]), [
    ["B000000001", 1],
    ["B000000003", 3],
  ]);
});

test("preserves Amazon's literal #1, #2, #3 even when ranks share a parent family", () => {
  const selected = selectLiteralTopRanks([
    { asin: "B000000001", position: 1, family_asins: ["B000000001", "B000000002"] },
    { asin: "B000000002", position: 2, family_asins: ["B000000001", "B000000002"] },
    { asin: "B000000003", position: 3, family_asins: ["B000000003"] },
    { asin: "B000000004", position: 4, family_asins: ["B000000004", "B000000005"] },
  ], 3);
  assert.deepEqual(selected.map(x => [x.asin, x.position]), [
    ["B000000001", 1],
    ["B000000002", 2],
    ["B000000003", 3],
  ]);
  assert.equal(selected[0].shared_family_with_rank, 2);
  assert.equal(selected[1].shared_family_with_rank, 1);
  assert.equal(selected[2].shared_family_with_rank, null);
});

test("sums every child ASIN label even when children belong to different categories", () => {
  const summary = summarizeFamilySales(
    ["B000000001", "B000000002", "B000000003"],
    new Map([
      ["B000000001", { monthlyPurchaseVolume: "6K+ bought in past month", bestsellerRanks: [{ category: "Mop Buckets" }] }],
      ["B000000002", { monthlyPurchaseVolume: "400+ bought in past month", bestsellerRanks: [{ category: "Automotive Buckets" }] }],
      ["B000000003", { monthlyPurchaseVolume: null, bestsellerRanks: [{ category: "Cleaning Kits" }] }],
    ]),
  );
  assert.equal(summary.sales_lower_bound, 6400);
  assert.equal(summary.family_size, 3);
  assert.equal(summary.fetched_count, 3);
  assert.equal(summary.visible_label_count, 2);
  assert.equal(summary.status, "partial_labels");
  assert.deepEqual(summary.evidence.map(x => x.categories), [
    ["Mop Buckets"], ["Automotive Buckets"], ["Cleaning Kits"],
  ]);
});
