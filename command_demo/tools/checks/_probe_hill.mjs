import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE, headless:"new",
  args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1280,720"]});
const p = await b.newPage();
await p.goto("http://localhost:5179/cinematic.html?scene=campus", {waitUntil:"domcontentloaded", timeout:60000});
await new Promise(r=>setTimeout(r,26000));
const r = await p.evaluate(()=>{
  const c=window.__cine;
  const out={meshes:0, merged:[]};
  c.scene.traverse(o=>{
    if(!o.isMesh) return;
    out.meshes++;
    o.geometry.computeBoundingBox();
    const bb=o.geometry.boundingBox;
    out.merged.push({
      n:(o.name||"").slice(0,22),
      bb:[[+bb.min.x.toFixed(0),+bb.min.y.toFixed(0),+bb.min.z.toFixed(0)],
          [+bb.max.x.toFixed(0),+bb.max.y.toFixed(0),+bb.max.z.toFixed(0)]],
    });
  });
  out.merged.sort((a,b)=>(b.bb[1][1]-b.bb[0][1])-(a.bb[1][1]-a.bb[0][1]));
  out.merged = out.merged.slice(0,6);
  return out;
});
console.log(JSON.stringify(r,null,1).slice(0,1200));
await b.close();
