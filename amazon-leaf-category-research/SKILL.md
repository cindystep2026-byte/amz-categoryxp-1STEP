---
name: amazon-leaf-category-research
description: Crawl any requested Amazon root category to its true leaf nodes, preserve Amazon navigation order, cross-check and collect Sorftime category metrics, add Chinese leaf-name translations, and export a validated Excel workbook. Use when parent nodes must be excluded and Sorftime no-data categories must still be retained.
---

# Amazon Leaf Category Research

## Objective

Produce an ordered, bilingual workbook containing every true Amazon leaf category under the requested root and the corresponding Sorftime metrics.

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
8. Query Sorftime for every Amazon leaf and collect:
   - TOP100 Sales
   - Top 1 Sales
   - Top 2 Sales
   - Top 3 Sales
   - 4 星及以上商品销量占比
   - 近 30 天类目退货率
9. If Sorftime has no result, retain the leaf and write N/A for all metrics with status 暂无相关数据.
10. Export with `scripts/build-category-report.mjs`.

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
15. Sorftime状态

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
- Group counts sum to the total leaf count.
- Workbook row count equals leaf count plus one header row.
- Order matches Amazon navigation exactly.

For Car Care refreshes, use `references/car-care-tree.json` as a comparison baseline, but recheck Amazon for taxonomy changes. Update the baseline only when Amazon's current tree proves it changed.

## Script Usage

Run:

```powershell
node scripts/build-category-report.mjs --metrics <sorftime.csv> --tree <tree.json> --output <report.xlsx> --root-name "<root category>" --marketplace-domain "www.amazon.com" --department-slug "<department slug>"
```

The metrics CSV is joined by `Amazon Node ID`. Extra source columns are ignored. Missing metric rows are retained as N/A.
The optional `direct_url` field in each tree record overrides URL construction.
