import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1920,1080"]});
const p = await b.newPage();
await p.setViewport({width:1920,height:1080});
await p.goto("http://localhost:5179/cinematic.html?scene=campus&q=medium&look=night",{waitUntil:"domcontentloaded",timeout:60000});
await new Promise(r=>setTimeout(r,24000));
const out = await p.evaluate(() => {
  const c = window.__cine;
  const THREE = window.__cine_three;
  const ray = new THREE.Raycaster();
  const pts = [[1300,500],[1240,560],[1420,700],[1450,820],[900,700]];
  const res=[];
  for(const [x,y] of pts){
    ray.setFromCamera(new THREE.Vector2(x/innerWidth*2-1, -(y/innerHeight*2-1)), c.camera);
    const hits = ray.intersectObjects(c.scene.children, true).filter(h=>h.object.isMesh);
    const h = hits[0];
    res.push(h ? {x,y,yhit:+h.point.y.toFixed(2),color:h.object.material.color?.getHexString?.(),map:!!h.object.material.map,type:h.object.material.type,name:h.object.name,parent:h.object.parent?.name} : {x,y,miss:true});
  }
  return res;
});
console.log(out);
await b.close();
