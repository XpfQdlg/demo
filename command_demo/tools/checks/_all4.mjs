import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE, headless:"new",
  args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1600,900"]});
for (const sc of ["campus","community","forest","subway"]) {
  const p = await b.newPage();
  await p.setViewport({width:1600,height:900});
  const errs=[]; p.on("pageerror",e=>errs.push("ERR "+e.message));
  p.on("console",m=>{ if(m.type()==="error") errs.push("C "+m.text().slice(0,140)); });
  await p.goto(`http://localhost:5179/cinematic.html?scene=${sc}`, {waitUntil:"domcontentloaded", timeout:60000});
  await new Promise(r=>setTimeout(r,26000));
  await p.screenshot({path:`shots/scene_${sc}.png`});
  console.log("shot", sc, errs.length?("| "+errs.slice(0,2).join(" / ")):"| clean");
  await p.close();
}
await b.close();
