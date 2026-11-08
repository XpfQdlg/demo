import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE, headless:"new",
  args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1600,900"]});
const p = await b.newPage();
await p.setViewport({width:1600,height:900});
await p.goto("http://localhost:5179/cinematic.html?scene=campus", {waitUntil:"domcontentloaded", timeout:60000});
await new Promise(r=>setTimeout(r,26000));
for (const [name,v] of Object.entries(JSON.parse(process.argv[2]))) {
  await p.evaluate((v)=>{const c=window.__cine; c.theta=v.theta; c.phi=v.phi; c.distance=v.d;}, v);
  await new Promise(r=>setTimeout(r,1500));
  await p.screenshot({path:`shots/wide_${name}.png`});
  console.log("shot", name);
}
await b.close();
