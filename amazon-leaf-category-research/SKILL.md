---
name: amazon-leaf-category-research
description: Research true Amazon leaf categories, combine Sorftime category metrics with live Amazon Best Sellers Top 1–Top 3 parent-family monthly purchase totals from Apify, and export a validated bilingual workbook. Use when ranking freshness, true leaf status, and complete variant-family sums matter.
---

# Amazon Leaf Category Research

## Objective

Produce an ordered, bilingual workbook containing every true Amazon leaf category under the requested root, Sorftime category metrics, and Amazon-visible monthly-purchase totals for each Top 1–Top 3 product family.

## Workflow

1. If the user has not already supplied them, ask one concise question for:
   - the Amazon marketplace, such as US, UK, Germany, or Japan; and
   - the root category to research, preferably its Amazon URL or Node ID together with its name.
   Do not ask again when these inputs are already clear.
2. Confirm the resolved marketplace, root-category name, URL or Node ID before collecting data.
3. Open the current Amazon Best Sellers/category navigation for that marketplace and root.
4. Recursively follow every child category until a node has no child-category list.
5. Treat Amazon's live navigation tree as the source of truth for leaf status. Never infer that a node is terminal merely because Sorftime has no data.
6. Preserve Amazon's displayed depth-first order and record the immediate child group under the requested root.
7. Record each leaf's English name, Chinese translation, full path, Amazon Node ID, and direct URL.
8. Query Sorftime for every Amazon leaf only for:
   - TOP100 Sales
   - 4 星及以上商品销量占比
   - 近 30 天类目退货率
9. Never use Sorftime Top ASIN fields for rank selection. They may lag Amazon's live ranking.
10. Run `scripts/fetch-apify-live-top3-sales.mjs`. It uses `junglee/amazon-bestsellers` to capture the leaf's current ranked candidates and `junglee/amazon-crawler` to identify families and fetch monthly-purchase labels.
11. Preserve Amazon's literal #1, #2, and #3. Do not require distinct parent families and never replace a shared-family rank with #4. When ranks share a family, keep both rows and record the overlap.
12. Preserve each chosen product's live position, starting ASIN, Best Sellers URL, and UTC observation timestamp as ranking evidence.
13. The script requests the Apify token through a macOS dialog on every run. It supports hidden manual entry or clipboard reading. Never request, paste, echo, log, persist, or place the token in a command argument, URL, conversation, report, or output file.
14. Show a separate confirmation before each paid pass with the maximum result count and estimated result charge. Canceling stops later paid stages without inventing values.
15. Keep Offers, Sellers, delivery-location lookup, `countryCode`, and `zipCode` disabled. Use the marketplace domain in each product URL and `proxyCountry: AUTO_SELECT_PROXY_COUNTRY`.
16. Export with `scripts/build-category-report.mjs`, passing the Apify output separately.

## Monthly-sales meaning

Top 1–Top 3 Sales are not Seller Central exact sales and are never Sorftime estimates. The rank comes from Amazon's live Best Sellers page at the recorded observation time. Each value is the sum of numeric lower bounds parsed from Amazon's public “N+ bought in past month” labels across the selected parent family.

- Deduplicate starting URLs and child-ASIN URLs before paid calls. A shared ASIN may contribute evidence to more than one ranked family but must be fetched only once per marketplace.
- Sum every child ASIN in the selected parent family even when individual children show different Amazon categories. Child-category membership is evidence only, never a filter.
- Preserve raw labels and per-ASIN fetch evidence in the Apify JSON.
- `not_fetched` means Apify did not return the page. `no_visible_label` means the page was fetched but Amazon displayed no monthly-purchase label. These are never interchangeable.
- A missing label is unknown, not zero. Sum visible labels as a lower bound and report coverage.
- If no fetched family member has a visible label, write N/A and state `Amazon无可见月销标签`.
- If a run is aborted or reaches a usage limit, preserve returned dataset rows, mark only genuinely missing pages as `Apify未抓取`, and report fetched/expected coverage.

## Required Output Columns

Use this exact order unless the user explicitly requests otherwise:

1. Amazon顺序
2. <根类目名称> 下一级分组
3. 一级类目
4. 二级类目
5. 末级节点
6. 末级节点中文翻译
7. Amazon Node ID
8. Amazon末级类目直达链接
9. TOP100 Sales
10. Top 1 Sales
11. Top 2 Sales
12. Top 3 Sales
13. 4 星及以上商品销量占比
14. 近 30 天类目退货率
15. 数据状态

Do not include “原表手工观察” unless the user explicitly asks for it.
Prefer the exact direct URL captured from Amazon. When it is absent, build it
from the selected marketplace domain, department slug, and Node ID. Make the
displayed URL clickable in Excel.

## Validation Gates

Before delivery, verify all of the following:

- Every Node ID is unique.
- Amazon顺序 is contiguous from 1 through the leaf count.
- No category with known children appears as a leaf.
- Every leaf has a Chinese translation.
- Every leaf has either Sorftime metrics or an explicit no-data status.
- Every non-N/A Top 1–Top 3 Sales value comes from Apify family evidence, never a Sorftime sales estimate.
- Every selected family has live Best Sellers position, source URL, starting ASIN, and observation timestamp.
- Top 1–Top 3 exactly match Amazon's live #1, #2, and #3. Shared parent families remain in their original positions and are explicitly marked.
- Every family records expected ASIN count, fetched count, visible-label count, summed lower bound, and an unambiguous status.
- Fetched pages without labels are not reported as Apify failures; missing labels and missing fetches are not converted to zero.
- Group counts sum to the total leaf count.
- Workbook row count equals leaf count plus one header row.
- Order matches Amazon navigation exactly.

For Car Care refreshes, use `references/car-care-tree.json` as a comparison baseline, but recheck Amazon for taxonomy changes. Update the baseline only when Amazon's current tree proves it changed.

## Script Usage

Run:

```powershell
node scripts/fetch-apify-live-top3-sales.mjs --tree <tree.json> --output <apify-family-sales.json> --marketplace-domain "www.amazon.com" --department-slug "automotive"
node scripts/build-category-report.mjs --metrics <sorftime.csv> --apify-sales <apify-family-sales.json> --tree <tree.json> --output <report.xlsx> --root-name "<root category>" --marketplace-domain "www.amazon.com" --department-slug "<department slug>"
```

The ranking stage always requests exactly three results per leaf. The confirmation dialog shows the maximum result charge before each paid stage.

The metrics CSV and Apify JSON are joined by `Amazon Node ID`. Old Sorftime Top Sales columns are ignored. Missing metrics remain N/A with an explicit reason.
The optional `direct_url` field in each tree record overrides URL construction.
