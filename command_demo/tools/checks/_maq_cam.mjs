import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1600,900"]});
const p = await b.newPage();
await p.setViewport({width:1600,height:900});
await p.goto("http://localhost:5179/cinematic.html?q=high",{waitUntil:"domcontentloaded",timeout:60000});
await new Promise(r=>setTimeout(r,24000));
const shots = [
  {d:560, phi:0.62, exp:0.9,  sun:3.4, hemi:0.7, near:500, far:1800},
  {d:620, phi:0.58, exp:0.95, sun:3.0, hemi:0.6, near:600, far:2000},
  {d:480, phi:0.66, exp:0.88, sun:3.8, hemi:0.65, near:420, far:1600},
];
for (let i=0;i<shots.length;i++){
  const s=shots[i];
  await p.evaluate((s)=>{
    const c=window.__cine;
    c.distance=s.d; c.phi=s.phi;
    c.renderer.toneMappingExposure=s.exp;
    c.sun.intensity=s.sun; c.hemi.intensity=s.hemi;
    c.set_fog(0xe6e0d1, s.near, s.far);
  }, s);
  await new Promise(r=>setTimeout(r,1600));
  await p.screenshot({path:`shots/maq_cam_${i}.png`});
}
await b.close();
