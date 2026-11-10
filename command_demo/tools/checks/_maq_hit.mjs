import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1600,900"]});
const p = await b.newPage();
await p.setViewport({width:1600,height:900});
await p.goto("http://localhost:5179/cinematic.html?q=high",{waitUntil:"domcontentloaded",timeout:60000});
await new Promise(r=>setTimeout(r,22000));
const out = await p.evaluate(()=>{
  const c=window.__cine, THREE=window.__cine_three;
  const rc=new THREE.Raycaster(); const n=new THREE.Vector2(1000/800-1, -(650/450-1));
  rc.setFromCamera(n,c.camera);
  const hit=rc.intersectObjects(c.scene.children,true).filter(h=>h.object.isMesh)[0];
  if(!hit) return null;
  const o=hit.object, m=o.material;
  const chain=[]; let q=o; while(q){chain.push(q.name||q.type);q=q.parent;}
  return {name:o.name, geo:o.geometry.type, mat:m.type, mapName:m.map?.name, mapImg:!!m.map?.image,
    size:m.map?.image?[m.map.image.width,m.map.image.height]:null, chain,
    pos:o.position.toArray(), scale:o.scale.toArray(), y:hit.point.y};
});
console.log(JSON.stringify(out,null,1));
await b.close();
