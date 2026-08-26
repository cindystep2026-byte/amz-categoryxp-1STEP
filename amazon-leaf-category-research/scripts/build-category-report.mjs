import fs from "node:fs/promises";
import path from "node:path";
import { Workbook, SpreadsheetFile } from "@oai/artifact-tool";

const args = Object.fromEntries(process.argv.slice(2).reduce((a,v,i,x)=>{if(v.startsWith("--")) a.push([v.slice(2),x[i+1]]); return a;},[]));
if (!args.metrics || !args.tree || !args.output) {
  throw new Error("Usage: node build-category-report.mjs --metrics <csv> --tree <json> --output <xlsx> [--root-name <name>] [--marketplace-domain www.amazon.com] [--department-slug automotive]");
}
const parseCsvLine = (s) => [...s.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => m[1].replaceAll('""','"'));
const csvLines = (await fs.readFile(args.metrics, "utf8")).trim().split(/\r?\n/);
const matrix = csvLines.map(parseCsvLine);
const headers = matrix[0];
const records = matrix.slice(1).map(row => Object.fromEntries(headers.map((h,i)=>[h,row[i] ?? ""])));
const byNode = new Map(records.map(r => [String(r["Amazon Node ID"]), r]));
const tree = JSON.parse(await fs.readFile(args.tree, "utf8"));
if (!Array.isArray(tree) || tree.length === 0) throw new Error("tree.json 必须包含至少一个末级节点");
const rootName=args["root-name"] || tree[0].root_name || tree[0].level2 || tree[0].level1 || "根类目";
const marketplaceDomain=args["marketplace-domain"] || tree[0].marketplace_domain || "www.amazon.com";
const departmentSlug=args["department-slug"] || tree[0].department_slug || String(tree[0].level1 || "").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
if (!departmentSlug && !tree.every(x=>x.direct_url)) throw new Error("缺少 department slug；请传入 --department-slug，或为每个节点提供 direct_url");

const seen = new Set();
tree.forEach((x,i) => {
  if (x.amazon_order !== i + 1) throw new Error(`Amazon顺序不连续：第 ${i+1} 项`);
  if (!x.node_id || seen.has(String(x.node_id))) throw new Error(`Node ID 缺失或重复：${x.node_id}`);
  if (!x.leaf_name_zh) throw new Error(`缺少中文翻译：${x.leaf_name}`);
  seen.add(String(x.node_id));
});

const metricNames=["TOP100 Sales","Top 1 Sales","Top 2 Sales","Top 3 Sales","4 星及以上商品销量占比","近 30 天类目退货率"];
const columns=["Amazon顺序",`${rootName} 下一级分组`,"一级类目","二级类目","末级节点","末级节点中文翻译","Amazon Node ID","Amazon末级类目直达链接",...metricNames,"Sorftime状态"];
const rows=[columns];
for (const x of tree) {
  const r=byNode.get(String(x.node_id));
  const values=r ? metricNames.map(k=>r[k] || "N/A") : metricNames.map(()=>"N/A");
  const status=r?.["Sorftime状态"] || "暂无相关数据";
  rows.push([x.amazon_order,x.group,x.level1,x.level2,x.leaf_name,x.leaf_name_zh,String(x.node_id),"",...values,status]);
}

const wb=Workbook.create();
const sh=wb.worksheets.add("Amazon末级类目");
sh.showGridLines=false;
sh.getRangeByIndexes(0,0,rows.length,columns.length).values=rows;
const links=tree.map(x=>{
  const url=x.direct_url || `https://${marketplaceDomain}/gp/bestsellers/${departmentSlug}/${x.node_id}`;
  return [`=HYPERLINK("${url}","${url}")`];
});
sh.getRangeByIndexes(1,7,tree.length,1).formulas=links;
sh.freezePanes.freezeRows(1);
sh.freezePanes.freezeColumns(2);
sh.getRangeByIndexes(0,0,1,columns.length).format={fill:"#1F4E78",font:{bold:true,color:"#FFFFFF"},wrapText:true,verticalAlignment:"center"};
sh.getRangeByIndexes(0,0,rows.length,columns.length).format.borders={preset:"all",style:"thin",color:"#D9E2F3"};
sh.getRangeByIndexes(1,0,rows.length-1,1).format.numberFormat="0";
sh.getRangeByIndexes(1,8,rows.length-1,4).format.numberFormat="#,##0";
sh.getRangeByIndexes(1,12,rows.length-1,2).format.numberFormat="0.00%";
sh.getRangeByIndexes(1,7,tree.length,1).format={font:{color:"#0563C1",underline:"single"}};
const widths=[12,30,15,14,42,30,20,58,16,16,16,16,24,22,18];
for(let i=0;i<columns.length;i++) sh.getRangeByIndexes(0,i,rows.length,1).format.columnWidth=widths[i];
sh.getRangeByIndexes(0,0,rows.length,columns.length).format.rowHeight=22;
sh.getRangeByIndexes(0,0,1,columns.length).format.rowHeight=38;

const inspection=await wb.inspect({kind:"table",range:`Amazon末级类目!A1:O${Math.min(rows.length,12)}`,include:"values,formulas",tableMaxRows:12,tableMaxCols:15,maxChars:7000});
console.log(inspection.ndjson);
await fs.mkdir(path.dirname(args.output),{recursive:true});
const out=await SpreadsheetFile.exportXlsx(wb);
await out.save(args.output);
console.log(JSON.stringify({output:args.output,leaf_count:tree.length,row_count:rows.length,column_count:columns.length}));
