import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { asinFrom, normalizeBestsellerRows, selectLiteralTopRanks, summarizeFamilySales } from "./lib/ranking-sales.mjs";

const API="https://api.apify.com/v2";
const BESTSELLERS_ACTOR="junglee~amazon-bestsellers";
const PRODUCT_ACTOR="junglee~amazon-crawler";
const BESTSELLER_RESULT_PRICE=0.0032;
const PRODUCT_RESULT_PRICE=0.005;
const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,x)=>{if(v.startsWith("--"))a.push([v.slice(2),x[i+1]]);return a;},[]));
if(!args.tree||!args.output)throw new Error("Usage: node fetch-apify-live-top3-sales.mjs --tree <tree.json> --output <json> [--candidate-limit 10] [--marketplace-domain www.amazon.com] [--department-slug automotive]");

const tree=JSON.parse(await fs.readFile(args.tree,"utf8"));
if(!Array.isArray(tree)||!tree.length)throw new Error("tree.json 必须是非空数组");
const candidateLimit=3;
const domain=args["marketplace-domain"]||tree[0].marketplace_domain||"www.amazon.com";
const department=args["department-slug"]||tree[0].department_slug||String(tree[0].level1||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
const leaves=tree.map(row=>({node_id:String(row.node_id),category_url:row.direct_url||`https://${domain}/gp/bestsellers/${department}/${row.node_id}`}));

function confirm(message){try{execFileSync("osascript",["-e",`display dialog ${JSON.stringify(message)} buttons {"取消", "继续"} default button "继续" cancel button "取消" with icon caution`],{stdio:["ignore","pipe","ignore"]});}catch{throw new Error("用户取消 Apify 抓取");}}

confirm(`Apify 实时榜单阶段：${leaves.length} 个末级类目，每个最多 ${candidateLimit} 个候选。按当前起价估算，最高结果费约 $${(leaves.length*candidateLimit*BESTSELLER_RESULT_PRICE).toFixed(3)}。是否继续？`);
let token;
try{
  const script=`set chosenButton to button returned of (display dialog "请选择 Apify API Token 输入方式。Token 仅保存在本次进程内存中。" buttons {"取消", "手动输入", "从剪贴板读取"} default button "从剪贴板读取" cancel button "取消")
if chosenButton is "从剪贴板读取" then
return the clipboard as text
else
return text returned of (display dialog "请输入 Apify API Token" default answer "" with hidden answer buttons {"取消", "确定"} default button "确定" cancel button "取消")
end if`;
  token=execFileSync("osascript",["-e",script],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
}catch{throw new Error("用户取消 Apify Token 输入");}
if(!token)throw new Error("Apify API Token 不能为空");
const headers={Authorization:`Bearer ${token}`,"Content-Type":"application/json"};

async function api(path,options={}){const response=await fetch(`${API}${path}`,{...options,headers:{...headers,...options.headers}});if(!response.ok)throw new Error(`Apify API ${response.status}: ${await response.text()}`);return response.json();}
async function readDataset(id){const all=[];for(let offset=0;;offset+=1000){const page=await api(`/datasets/${id}/items?clean=true&format=json&offset=${offset}&limit=1000`);all.push(...page);if(page.length<1000)break;}return all.filter(row=>!row.error);}
async function runActor(actor,input){const started=await api(`/acts/${actor}/runs`,{method:"POST",body:JSON.stringify(input)});const id=started.data.id;let run=started.data;while(!["SUCCEEDED","FAILED","ABORTED","TIMED-OUT"].includes(run.status)){await new Promise(resolve=>setTimeout(resolve,3000));run=(await api(`/actor-runs/${id}`)).data;}const rows=await readDataset(run.defaultDatasetId);if(run.status==="FAILED"&&!rows.length)throw new Error(`Apify run ${id} failed without usable rows`);return{rows,run:{id,status:run.status,statusMessage:run.statusMessage||"",datasetId:run.defaultDatasetId,usageTotalUsd:run.usageTotalUsd??null}};}
const productInput=urls=>({categoryOrProductUrls:urls.map(url=>({url})),maxItemsPerStartUrl:1,maxProductVariantsAsSeparateResults:0,maxOffers:0,scrapeSellers:false,scrapeProductVariantPrices:false,scrapeProductDetails:true,proxyCountry:"AUTO_SELECT_PROXY_COUNTRY",locationDeliverableRoutes:[]});

const rankingRun=await runActor(BESTSELLERS_ACTOR,{categoryUrls:leaves.map(x=>x.category_url),maxItemsPerStartUrl:candidateLimit,depthOfCrawl:1,detailedInformation:false,useCaptchaSolver:false});
const candidatesByNode=new Map();
for(const leaf of leaves)candidatesByNode.set(leaf.node_id,normalizeBestsellerRows(rankingRun.rows,leaf.category_url).slice(0,candidateLimit));
const candidateRows=leaves.flatMap(leaf=>candidatesByNode.get(leaf.node_id).map(row=>({...row,node_id:leaf.node_id})));
const candidateUrls=[...new Set(candidateRows.map(row=>`https://${domain}/dp/${row.asin}`))];
if(!candidateUrls.length)throw new Error("Apify 实时榜单未返回任何有效 ASIN");
confirm(`Apify 父体识别阶段：榜单返回 ${candidateRows.length} 个候选，去重后需抓取 ${candidateUrls.length} 个 ASIN。预计最高结果费约 $${(candidateUrls.length*PRODUCT_RESULT_PRICE).toFixed(3)}。是否继续？`);
const discoveryRun=await runActor(PRODUCT_ACTOR,productInput(candidateUrls));
const discoveryByAsin=new Map();
for(const item of discoveryRun.rows){const inputAsin=asinFrom(item.input||item.unNormalizedProductUrl||item.originalAsin||item.asin);if(inputAsin)discoveryByAsin.set(inputAsin,item);}

const selectedByNode=new Map();
for(const leaf of leaves){const enriched=candidatesByNode.get(leaf.node_id).map(candidate=>{const item=discoveryByAsin.get(candidate.asin);const family=[candidate.asin,...(item?.variantAsins||[])];return{...candidate,family_asins:[...new Set(family.map(asinFrom).filter(Boolean))]};});selectedByNode.set(leaf.node_id,selectLiteralTopRanks(enriched,3));}
const selected=leaves.flatMap(leaf=>selectedByNode.get(leaf.node_id).map(row=>({...row,node_id:leaf.node_id})));
const detailUrls=[...new Set(selected.flatMap(row=>row.family_asins).map(asin=>`https://${domain}/dp/${asin}`))];
if(!detailUrls.length)throw new Error("未能识别任何实时 Top 父体");
confirm(`Apify 月销汇总阶段：已选出 ${selected.length} 个实时排名父体，需抓取 ${detailUrls.length} 个不重复子 ASIN。预计最高结果费约 $${(detailUrls.length*PRODUCT_RESULT_PRICE).toFixed(3)}。不同子 ASIN 所属类目不同也会相加。是否继续？`);
const detailRun=await runActor(PRODUCT_ACTOR,productInput(detailUrls));
const detailByAsin=new Map();
for(const item of detailRun.rows){const inputAsin=asinFrom(item.input||item.unNormalizedProductUrl||item.originalAsin||item.asin);if(inputAsin)detailByAsin.set(inputAsin,item);}

const observedAt=new Date().toISOString();
const nodes=leaves.map(leaf=>{const chosen=selectedByNode.get(leaf.node_id);const families=chosen.map((candidate,index)=>({rank:index+1,amazon_bestseller_position:candidate.position,starting_asin:candidate.asin,shared_family_with_rank:candidate.shared_family_with_rank,ranking_title:candidate.title,ranking_source_url:leaf.category_url,ranking_observed_at:observedAt,family_asins:candidate.family_asins,...summarizeFamilySales(candidate.family_asins,detailByAsin)}));while(families.length<3)families.push(null);const expected=families.filter(Boolean).reduce((n,f)=>n+f.family_size,0),fetched=families.filter(Boolean).reduce((n,f)=>n+f.fetched_count,0),visible=families.filter(Boolean).reduce((n,f)=>n+f.visible_label_count,0);let status;if(!families.some(Boolean))status="Apify实时榜单无数据";else if(families.filter(Boolean).length<3)status=`Apify实时榜单不足 Top 3 (${families.filter(Boolean).length}/3)`;else if(fetched<expected)status=`Apify未完全抓取 (${fetched}/${expected})；Amazon可见月销标签 ${visible}/${expected}`;else if(visible<expected)status=`Apify已完整抓取 (${fetched}/${expected})；Amazon可见月销标签 ${visible}/${expected}`;else status=`Apify已完整抓取 (${fetched}/${expected})；Amazon月销标签完整`;return{"Amazon Node ID":leaf.node_id,families,status};});
const output={metadata:{ranking_source:"Amazon Best Sellers via junglee/amazon-bestsellers",ranking_observed_at:observedAt,candidate_limit:candidateLimit,bestseller_run:rankingRun.run,discovery_run:discoveryRun.run,detail_run:detailRun.run},nodes};
await fs.writeFile(args.output,JSON.stringify(output,null,2)+"\n",{mode:0o600});
console.log(JSON.stringify({output:args.output,node_count:nodes.length,live_ranked_families:selected.length,distinct_detail_asins:detailUrls.length,ranking_run_status:rankingRun.run.status,discovery_run_status:discoveryRun.run.status,detail_run_status:detailRun.run.status}));
