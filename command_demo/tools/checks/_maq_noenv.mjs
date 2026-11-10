import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1600,900"]});
const p = await b.newPage();
await p.setViewport({width:1600,height:900});
await p.goto("http://localhost:5179/cinematic.html?q=high",{waitUntil:"domcontentloaded",timeout:60000});
await new Promise(r=>setTimeout(r,22000));
const n = await p.evaluate(()=>{
  const c=window.__cine; c.renderer.toneMappingExposure=0.9; c.sun.intensity=3.4; c.hemi.intensity=0.6;
  let n=0; c.scene.traverse(o=>{ const m=o.material; if(!m||Array.isArray(m)) return; const col=m.color?.getHexString?.(); if(["d9d3c4","8ea36f","1a1e23","24262a","1d1210","cfc7b6"].includes(col)){m.envMapIntensity=0;n++;} });
  return n;
});
await new Promise(r=>setTimeout(r,1500));
await p.screenshot({path:"shots/maq_noenv.png"});
console.log("ground materials", n);
await b.close();
