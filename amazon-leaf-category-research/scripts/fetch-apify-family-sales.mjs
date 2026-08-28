import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";

const ACTOR = "junglee~amazon-crawler";
const API = "https://api.apify.com/v2";
const RESULT_PRICE_USD = 0.005;
const args = Object.fromEntries(process.argv.slice(2).reduce((a,v,i,x)=>{if(v.startsWith("--")) a.push([v.slice(2),x[i+1]]); return a;},[]));
if (!args["top-products"] || !args.output) throw new Error("Usage: node fetch-apify-family-sales.mjs --top-products <json> --output <json>");

const inputs = JSON.parse(await fs.readFile(args["top-products"], "utf8"));
if (!Array.isArray(inputs) || !inputs.length) throw new Error("top-products.json 必须是非空数组");
const jobs=[];
for (const row of inputs) {
  const asins=(row.top_asins || []).slice(0,3);
  if (!row.node_id) throw new Error("每条记录必须有 node_id");
  asins.forEach((asin,index)=>{if(asin) jobs.push({node_id:String(row.node_id),rank:index+1,asin:String(asin).trim().toUpperCase(),domain:row.marketplace_domain || "www.amazon.com"});});
}
if (!jobs.length) throw new Error("没有可抓取的 Top 1–Top 3 ASIN");

function confirm(message) {
  try {
    execFileSync("osascript",["-e",`display dialog ${JSON.stringify(message)} buttons {"取消", "继续"} default button "继续" cancel button "取消" with icon caution`],{stdio:["ignore","pipe","ignore"]});
  } catch { throw new Error("用户取消 Apify 抓取"); }
}

const initialUrls=[...new Set(jobs.map(j=>`https://${j.domain}/dp/${j.asin}`))];
confirm(`Apify 第 1 阶段：抓取 ${initialUrls.length} 个不重复 Top ASIN 以发现父体变体。按 $${RESULT_PRICE_USD.toFixed(3)}/结果估算，最高结果费约 $${(initialUrls.length*RESULT_PRICE_USD).toFixed(3)}。是否继续？`);

let token;
try {
  const tokenScript=`
set chosenButton to button returned of (display dialog "请选择 Apify API Token 输入方式。Token 仅保存在本次进程内存中。" buttons {"取消", "手动输入", "从剪贴板读取"} default button "从剪贴板读取" cancel button "取消")
if chosenButton is "从剪贴板读取" then
  return the clipboard as text
else
  return text returned of (display dialog "请输入 Apify API Token" default answer "" with hidden answer buttons {"取消", "确定"} default button "确定" cancel button "取消")
end if`;
  token=execFileSync("osascript",["-e",tokenScript],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
} catch { throw new Error("用户取消 Apify Token 输入"); }
if (!token) throw new Error("Apify API Token 不能为空");
const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};

async function api(path, options={}) {
  const response=await fetch(`${API}${path}`,{...options,headers:{...headers,...options.headers}});
  if (!response.ok) throw new Error(`Apify API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function readDataset(datasetId) {
  const all=[];
  for(let offset=0;;offset+=1000) {
    const page=await api(`/datasets/${datasetId}/items?clean=true&format=json&offset=${offset}&limit=1000`);
    all.push(...page);
    if(page.length<1000) break;
  }
  return all.filter(item=>!item.error);
}

async function runActor(urls) {
  const started=await api(`/acts/${ACTOR}/runs`,{method:"POST",body:JSON.stringify({
    categoryOrProductUrls:urls.map(url=>({url})), maxItemsPerStartUrl:1,
    maxProductVariantsAsSeparateResults:0, maxOffers:0, scrapeSellers:false,
    scrapeProductVariantPrices:false, scrapeProductDetails:true,
    proxyCountry:"AUTO_SELECT_PROXY_COUNTRY", locationDeliverableRoutes:[]
  })});
  const runId=started.data.id;
  let run=started.data;
  while (!["SUCCEEDED","FAILED","ABORTED","TIMED-OUT"].includes(run.status)) {
    await new Promise(resolve=>setTimeout(resolve,3000));
    run=(await api(`/actor-runs/${runId}`)).data;
  }
  const rows=await readDataset(run.defaultDatasetId);
  if (run.status === "FAILED" && !rows.length) throw new Error(`Apify run ${runId} failed without usable rows`);
  return {rows,run:{id:runId,status:run.status,statusMessage:run.statusMessage || "",datasetId:run.defaultDatasetId,usageTotalUsd:run.usageTotalUsd ?? null}};
}

function asinFrom(value) {
  const m=String(value || "").match(/\/dp\/([A-Z0-9]{10})|\b([A-Z0-9]{10})\b/i);
  return (m?.[1] || m?.[2] || "").toUpperCase();
}

function parseLabel(label) {
  if (!label) return null;
  const match=String(label).replace(/\u00a0/g," ").match(/([\d.,]+)\s*([KkMm万])?/);
  if (!match) return null;
  const raw=match[1], suffix=(match[2] || "").toUpperCase();
  let value=suffix ? Number(raw.replace(/,/g,".")) : /^\d{1,3}([.,]\d{3})+$/.test(raw) ? Number(raw.replace(/[.,]/g,"")) : Number(raw.replace(/,/g,""));
  if (!Number.isFinite(value)) return null;
  if (suffix === "K") value*=1000;
  if (suffix === "M") value*=1000000;
  if (suffix === "万") value*=10000;
  return Math.floor(value);
}

const initialRun=await runActor(initialUrls);
const initialByInput=new Map(initialRun.rows.map(item=>[asinFrom(item.input || item.unNormalizedProductUrl || item.originalAsin || item.asin),item]));
const families=jobs.map(job=>{
  const item=initialByInput.get(job.asin) || initialRun.rows.find(x=>x.asin===job.asin || x.originalAsin===job.asin);
  const family=[job.asin,...(item?.variantAsins || [])].map(asin=>String(asin).toUpperCase());
  return {...job,family_asins:[...new Set(family)]};
});
const variantJobs=new Map();
for (const family of families) for (const asin of family.family_asins) variantJobs.set(`${family.domain}|${asin}`,`https://${family.domain}/dp/${asin}`);
const variantUrls=[...variantJobs.values()];
confirm(`Apify 第 2 阶段：已发现 ${variantUrls.length} 个不重复父体/子体 ASIN。按 $${RESULT_PRICE_USD.toFixed(3)}/结果估算，最高结果费约 $${(variantUrls.length*RESULT_PRICE_USD).toFixed(3)}。是否继续？`);
const detailRun=await runActor(variantUrls);
const detailByAsin=new Map(detailRun.rows.map(item=>[String(item.asin || item.originalAsin || "").toUpperCase(),item]));

const byNode=new Map(inputs.map(row=>[String(row.node_id),{"Amazon Node ID":String(row.node_id),families:Array(3).fill(null)}]));
for (const family of families) {
  const evidence=family.family_asins.map(asin=>{
    const item=detailByAsin.get(asin), raw=item?.monthlyPurchaseVolume ?? null;
    return {asin,fetched:Boolean(item),monthly_purchase_label:raw,sales_lower_bound:parseLabel(raw),status:!item?"not_fetched":raw?"visible_label":"no_visible_label"};
  });
  const fetched=evidence.filter(x=>x.fetched), visible=evidence.filter(x=>Number.isFinite(x.sales_lower_bound));
  let status;
  if (!fetched.length) status="not_fetched";
  else if (fetched.length<evidence.length) status="partial_fetch";
  else if (!visible.length) status="no_visible_labels";
  else if (visible.length<evidence.length) status="partial_labels";
  else status="complete";
  byNode.get(family.node_id).families[family.rank-1]={rank:family.rank,starting_asin:family.asin,family_asins:family.family_asins,family_size:evidence.length,fetched_count:fetched.length,visible_label_count:visible.length,sales_lower_bound:visible.length?visible.reduce((sum,x)=>sum+x.sales_lower_bound,0):null,status,evidence};
}
for (const row of byNode.values()) {
  const fs=row.families.filter(Boolean), expected=fs.reduce((n,f)=>n+f.family_size,0), fetched=fs.reduce((n,f)=>n+f.fetched_count,0), visible=fs.reduce((n,f)=>n+f.visible_label_count,0);
  if (!fs.length) row.status="Apify无Top ASIN";
  else if (fetched<expected) row.status=`Apify未完全抓取 (${fetched}/${expected})；Amazon可见月销标签 ${visible}/${expected}`;
  else if (!visible) row.status=`Apify已抓取 (${fetched}/${expected})；Amazon无可见月销标签`;
  else if (visible<expected) row.status=`Apify已完整抓取 (${fetched}/${expected})；Amazon可见月销标签 ${visible}/${expected}`;
  else row.status=`Apify已完整抓取 (${fetched}/${expected})；Amazon月销标签完整`;
}
const output={metadata:{actor:ACTOR,generated_at:new Date().toISOString(),initial_run:initialRun.run,detail_run:detailRun.run,distinct_initial_asins:initialUrls.length,distinct_variant_asins:variantUrls.length},nodes:[...byNode.values()]};
await fs.writeFile(args.output,JSON.stringify(output,null,2)+"\n",{mode:0o600});
console.log(JSON.stringify({output:args.output,node_count:byNode.size,top_asin_count:jobs.length,distinct_initial_asins:initialUrls.length,distinct_variant_asins:variantUrls.length,detail_rows:detailRun.rows.length,detail_run_status:detailRun.run.status}));
