import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1200,700"] });
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 700 });
const errs=[]; p.on("pageerror", e=>errs.push("ERR "+e.message)); p.on("console", m=>m.type()==="error"&&errs.push("CON "+m.text().slice(0,140)));
await p.goto("http://localhost:5179/cinematic.html?scene=campus", { waitUntil:"domcontentloaded", timeout:60000 });
await new Promise(r=>setTimeout(r,28000));
const probe = async () => p.evaluate(() => {
  const scene = window.__cine.scene;
  const crowd = scene.getObjectByName("crowd");
  const first = crowd?.children[0];
  return {
    crowd: crowd ? crowd.children.length : 0,
    first: first ? [Number(first.position.x.toFixed(2)), Number(first.position.z.toFixed(2))] : null,
    markers: scene.getObjectByName("markers")?.children.length ?? 0,
    roots: scene.children.filter(o=>o.name).map(o=>o.name),
    props: (()=>{const out=[];scene.traverse(o=>{if(o.userData?.scenario_kind)out.push(o.userData.scenario_kind+'@'+o.position.x.toFixed(0)+','+o.position.z.toFixed(0));});return out;})(),
  };
});
const a = await probe();
await new Promise(r=>setTimeout(r,4000));
const c = await probe();
console.log("t1", JSON.stringify(a));
console.log("t2", JSON.stringify(c));
console.log("errors", errs.slice(0,3));
await b.close();
