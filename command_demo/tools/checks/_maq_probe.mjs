import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE=["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const b=await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars"]});
const p=await b.newPage(); await p.setViewport({width:1200,height:700});
await p.goto("http://localhost:5179/cinematic.html?scene=campus&q=low&look=maquette",{waitUntil:"domcontentloaded",timeout:60000});
await new Promise(r=>setTimeout(r,22000));
console.log(await p.evaluate(()=>{
  const c=window.__cine; let n=0, vis=0, names=[];
  c.scene.traverse(o=>{ if(o.name) names.push(o.name); if(o.name==="distant_town"){n++; if(o.visible)vis++;} });
  return {town:n, vis, names:names.slice(0,20), fog:[c.scene.fog?.near,c.scene.fog?.far,c.scene.fog?.color?.getHexString()]};
}));
await b.close();
