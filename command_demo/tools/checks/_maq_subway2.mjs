import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE=["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const b=await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars"]});
const p=await b.newPage(); await p.setViewport({width:1000,height:600});
await p.goto("http://localhost:5179/cinematic.html?scene=subway&q=low&look=maquette",{waitUntil:"domcontentloaded",timeout:60000});
await new Promise(r=>setTimeout(r,14000));
console.log(await p.evaluate(()=>{const c=window.__cine;let n=0,withMap=0,cols={};c.scene.traverse(o=>{if(!o.isMesh||!o.material)return;n++;if(o.material.map)withMap++;const h=o.material.color?.getHexString?.();if(h)cols[h]=(cols[h]||0)+1;});return {n,withMap,cols,exposure:c.renderer.toneMappingExposure,sun:c.sun.intensity,hemi:c.hemi.intensity};}));
await b.close();
