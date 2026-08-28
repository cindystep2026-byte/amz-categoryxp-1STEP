export function asinFrom(value) {
  const match=String(value || "").match(/\/dp\/([A-Z0-9]{10})|\b([A-Z0-9]{10})\b/i);
  return (match?.[1] || match?.[2] || "").toUpperCase();
}

export function parseMonthlyPurchaseLabel(label) {
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

export function normalizeBestsellerRows(rows, categoryUrl=null) {
  const seen=new Set(), output=[];
  const sorted=[...rows].sort((a,b)=>Number(a.position ?? a.bestsellerPageData?.position ?? Infinity)-Number(b.position ?? b.bestsellerPageData?.position ?? Infinity));
  for (const row of sorted) {
    const asin=asinFrom(row.asin || row.url || row.input);
    const position=Number(row.position ?? row.bestsellerPageData?.position);
    const sourceUrl=row.categoryUrl || row.bestsellerPageData?.categoryUrl || row.input || null;
    if (!asin || !Number.isFinite(position) || seen.has(asin)) continue;
    if (categoryUrl && sourceUrl && normalizeUrl(sourceUrl)!==normalizeUrl(categoryUrl)) continue;
    seen.add(asin);
    output.push({asin,position,title:row.name || row.title || null,product_url:row.url || null,category_url:sourceUrl});
  }
  return output;
}

function normalizeUrl(value) {
  try { const u=new URL(value); return `${u.hostname}${u.pathname}`.replace(/\/$/,"").toLowerCase(); }
  catch { return String(value || "").replace(/\/$/,"").toLowerCase(); }
}

export function selectLiteralTopRanks(candidates, limit=3) {
  const selected=[...candidates].sort((a,b)=>a.position-b.position).slice(0,limit).map(candidate=>({
    ...candidate,
    family_asins:[...new Set([candidate.asin,...(candidate.family_asins || [])].map(asinFrom).filter(Boolean))],
    shared_family_with_rank:null,
  }));
  for(let i=0;i<selected.length;i++)for(let j=i+1;j<selected.length;j++){
    const right=new Set(selected[j].family_asins);
    if(selected[i].family_asins.some(asin=>right.has(asin))){
      selected[i].shared_family_with_rank=selected[j].position;
      selected[j].shared_family_with_rank=selected[i].position;
    }
  }
  return selected;
}

export function summarizeFamilySales(familyAsins, detailByAsin) {
  const evidence=[...new Set(familyAsins.map(asinFrom).filter(Boolean))].map(asin=>{
    const item=detailByAsin.get(asin), raw=item?.monthlyPurchaseVolume ?? null;
    const categories=(item?.bestsellerRanks || []).map(rank=>rank?.category).filter(Boolean);
    return {asin,fetched:Boolean(item),monthly_purchase_label:raw,sales_lower_bound:parseMonthlyPurchaseLabel(raw),categories,status:!item?"not_fetched":raw?"visible_label":"no_visible_label"};
  });
  const fetched=evidence.filter(x=>x.fetched), visible=evidence.filter(x=>Number.isFinite(x.sales_lower_bound));
  let status;
  if (!fetched.length) status="not_fetched";
  else if (fetched.length<evidence.length) status="partial_fetch";
  else if (!visible.length) status="no_visible_labels";
  else if (visible.length<evidence.length) status="partial_labels";
  else status="complete";
  return {family_size:evidence.length,fetched_count:fetched.length,visible_label_count:visible.length,sales_lower_bound:visible.length?visible.reduce((sum,x)=>sum+x.sales_lower_bound,0):null,status,evidence};
}
