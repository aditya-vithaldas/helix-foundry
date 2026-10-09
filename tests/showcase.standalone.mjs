// Dependency-free regression checks against the actual TypeScript modules.
// Run: node --experimental-vm-modules --test tests/showcase.standalone.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { SourceTextModule, SyntheticModule, createContext } from "node:vm";
import { createHash } from "node:crypto";

const root = new URL("../", import.meta.url);
const context = createContext({ Date, Map, Set, WeakMap, Promise, Number, String, JSON, Error });
async function moduleAt(path) {
  const source = await readFile(new URL(path, root), "utf8");
  return new SourceTextModule(stripTypeScriptTypes(source), { context });
}
function synthetic(exports) {
  return new SyntheticModule(Object.keys(exports), function() {
    for (const [key, value] of Object.entries(exports)) this.setExport(key, value);
  }, { context });
}
const calculations = await moduleAt("apps/api/src/showcase-calculations.ts");
await calculations.link(() => { throw Error("Unexpected import"); });
await calculations.evaluate();
const { showcaseWindow, measureChange, relativeChange } = calculations.namespace;

test("Monday-start complete weeks, Sunday boundary and year rollover", () => {
  const friday = showcaseWindow(new Date("2026-10-09T09:00:00Z"));
  assert.equal(friday.weekStart, "2026-09-28");
  assert.equal(friday.weekEnd, "2026-10-05");
  assert.equal(friday.previousStart, "2026-09-21");
  assert.equal(friday.baselineStart, "2026-08-31");
  assert.equal(showcaseWindow(new Date("2026-10-11T23:59:59Z")).weekEnd, "2026-10-05");
  assert.equal(showcaseWindow(new Date("2026-10-12T00:00:00Z")).weekEnd, "2026-10-12");
  assert.equal(showcaseWindow(new Date("2027-01-01T00:00:00Z")).weekStart, "2026-12-21");
});
test("threshold, zero denominators and baseline comparisons", () => {
  assert.equal(measureChange(109, 100, 100).notable, false);
  assert.equal(measureChange(110, 100, 100).notable, true);
  assert.equal(measureChange(0, 0, null).notable, false);
  assert.equal(measureChange(5, 0, null).changePercent, null);
  assert.equal(measureChange(5, 0, null).notable, true);
  assert.equal(measureChange(80, 100, 100).baselinePercent, -20);
  assert.equal(relativeChange(-80, -100), 20);
});

const records = new Map();
let queries = 0, fail = false, race = false, row;
const dataset = {id:"orders", name:"Orders", kind:"dataset", data:{
  activeVersion:"v1", profile:{columns:[
    {name:"created_at",type:"TIMESTAMP"}, {name:"revenue",type:"DOUBLE"},
  ]},
}};
const spec = { title:"Revenue", why:"Revenue", kind:"kpi", datasetId:"orders",
  measure:"sum", column:"revenue", timeColumn:"created_at", format:"currency", scale:"none" };
const store = {
  async get(_scope, id) { return records.get(id); },
};
const tx = {
  async get(id) { return records.get(id); },
  update(old, data) { const r={...old,data}; records.set(old.id,r); return r; },
  put(r) { records.set(r.id,r); return r; },
};
const showcaseModule = await moduleAt("apps/api/src/showcase.ts");
const mocks = {
  "../../../packages/shared/src/index.js": synthetic({datasetTable:id=>"ds_"+id}),
  "../unused": synthetic({}),
  "./metrics.js": synthetic({
    METRICS_ID:"home_metrics",
    metricsDatasets:async()=>[dataset],
    computedSpecs:()=>[spec],
    noun:d=>d.name,
    compileMetric:s=>s.column && !dataset.data.profile.columns.some(c=>c.name===s.column) ? {error:"unknown column"} : {sql:"validated"},
  }),
  "./datasets.js": synthetic({queryDatasets:async()=>{
    queries++;
    if(fail) throw Error("Executor unavailable");
    const version=dataset.data.activeVersion;
    if(race) dataset.data.activeVersion="raced";
    return {rows:[row],citations:[{version}]};
  }}),
  "./discovery.js": synthetic({q:s=>'"'+s.replaceAll('"','""')+'"',lit:s=>"'"+s.replaceAll("'","''")+"'"}),
  "./security.js": synthetic({digest:s=>createHash("sha256").update(s).digest("hex")}),
  "./store.js": synthetic({transaction:async(_store,_scope,fn)=>fn(tx),resource:(_scope,kind,name,data,id)=>({kind,name,data,id})}),
  "./showcase-calculations.js": calculations,
};
await showcaseModule.link(path => {
  if(!mocks[path]) throw Error("Unexpected import: "+path);
  return mocks[path];
});
await showcaseModule.evaluate();
const {proactiveShowcase, weeklySql} = showcaseModule.namespace;
const now=new Date("2026-10-09T09:00:00Z");
const reset=()=>{
  records.clear(); queries=0; fail=false; race=false; dataset.data.activeVersion="v1";
  row={current:80,previous:100,baseline:90,firstDate:"2026-08-01",lastDate:"2026-10-08"};
};
test("SQL uses exclusive boundaries and averages four separate weekly aggregates", () => {
  const sql=weeklySql({...spec,measure:"avg",scale:"cents"},dataset,showcaseWindow(now));
  assert.match(sql, /"__ts" < TIMESTAMP '2026-10-05'/);
  assert.match(sql, /avg\(TRY_CAST/);
  assert.equal((sql.match(/AS DOUBLE/g)||[]).length,6);
  assert.match(sql,/\/ 4.0 AS baseline/);
  assert.equal(weeklySql({...spec,column:"invented"},dataset,showcaseWindow(now)),undefined);
});
test("cached reports rerun on snapshot changes and suppress unchanged findings", async()=>{
  reset();
  const first=await proactiveShowcase(store,"w",now);
  assert.equal(first.findings.length,1);
  assert.equal(first.findings[0].changePercent,-20);
  assert.equal(first.findings[0].changed,true);
  await proactiveShowcase(store,"w",now);
  assert.equal(queries,1);
  dataset.data.activeVersion="v2";
  const second=await proactiveShowcase(store,"w",now);
  assert.equal(queries,2);
  assert.equal(second.findings[0].changed,false);
  assert.equal(second.findings[0].version,"v2");
});
test("failed refresh preserves the last successful evidence and backs off", async()=>{
  reset();
  const first=await proactiveShowcase(store,"w",now);
  dataset.data.activeVersion="v2"; fail=true;
  const failed=await proactiveShowcase(store,"w",now);
  assert.equal(failed.stale,true);
  assert.equal(failed.findings[0].version,first.findings[0].version);
  await proactiveShowcase(store,"w",now);
  assert.equal(queries,2);
  fail=false;
  const recovered=await proactiveShowcase(store,"w",new Date(now.getTime()+61000));
  assert.equal(recovered.error,undefined);
  assert.equal(recovered.findings[0].version,"v2");
});
test("insufficient history and unchanged metrics never invent highlights", async()=>{
  reset(); row.firstDate="2026-09-30";
  assert.equal((await proactiveShowcase(store,"w",now)).status,"insufficient");
  reset(); row.current=100;
  const report=await proactiveShowcase(store,"w",now);
  assert.equal(report.status,"ready");
  assert.equal(report.findings.length,0);
});
test("snapshot races preserve the previous report", async()=>{
  reset(); await proactiveShowcase(store,"w",now);
  dataset.data.activeVersion="v2"; race=true;
  const report=await proactiveShowcase(store,"w",now);
  assert.equal(report.stale,true);
  assert.equal(report.findings[0].version,"v1");
});
