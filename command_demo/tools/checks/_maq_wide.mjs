import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1600,900"]});
const p = await b.newPage();
await p.setViewport({width:1600,height:900});
await p.goto("http://localhost:5179/cinematic.html?q=high",{waitUntil:"domcontentloaded",timeout:60000});
await new Promise(r=>setTimeout(r,22000));
const shots=[
 {d:620,phi:0.72,exp:0.9,sun:3.6,hemi:0.55},
 {d:700,phi:0.78,exp:0.86,sun:4.0,hemi:0.5},
];
for(let i=0;i<shots.length;i++){const s=shots[i];await p.evaluate((s)=>{const c=window.__cine;c.distance=s.d;c.phi=s.phi;c.renderer.toneMappingExposure=s.exp;c.sun.intensity=s.sun;c.hemi.intensity=s.hemi;},s);await new Promise(r=>setTimeout(r,1800));await p.screenshot({path:`shots/maq_wide_${i}.png`});}
await b.close();
