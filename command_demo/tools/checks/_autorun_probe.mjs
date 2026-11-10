import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1600,900"]});
const p = await b.newPage();
const errs=[]; p.on("pageerror",e=>errs.push(e.message));
await p.setViewport({width:1600,height:900});
await p.goto("http://localhost:5179/cinematic.html?scene=campus&q=low&look=night",{waitUntil:"domcontentloaded",timeout:60000});
const at = async (ms, name) => {
  await new Promise(r=>setTimeout(r,ms));
  const st = await p.evaluate(()=>({
    scene: document.querySelector(".tab.on")?.dataset.scene,
    overlay: document.querySelector("#visitorToast")?.classList.contains("on"),
    title: document.querySelector("#visitorTitle")?.textContent,
    feed: document.querySelector("#feed")?.innerText?.split("\n").slice(2,6).join(" | "),
  }));
  console.log(name, st);
  await p.screenshot({path:`shots/autorun_${name}.png`});
};
await at(52000,"a");
await at(30000,"b");
await at(35000,"c");
console.log("errors", errs);
await b.close();
