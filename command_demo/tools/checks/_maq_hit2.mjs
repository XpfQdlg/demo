import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars","--window-size=1600,900"]});
const p = await b.newPage();
await p.setViewport({width:1600,height:900});
await p.goto("http://localhost:5179/cinematic.html?q=high",{waitUntil:"domcontentloaded",timeout:60000});
await new Promise(r=>setTimeout(r,22000));
const out = await p.evaluate(()=>{
  const c=window.__cine, THREE=window.__cine_three; const rc=new THREE.Raycaster(); const res=[];
  for(const [x,y] of [[300,400],[600,300],[900,250],[1400,400],[1100,800]]){
    rc.setFromCamera(new THREE.Vector2(x/800-1,-(y/450-1)),c.camera);
    const hit=rc.intersectObjects(c.scene.children,true).filter(h=>h.object.isMesh)[0];
    if(!hit){res.push({x,y,hit:null});continue;}
    const m=hit.object.material; const mm=Array.isArray(m)?m[0]:m;
    const chain=[]; let q=hit.object; while(q){chain.push(q.name||q.type); q=q.parent;}
    res.push({x,y,ypos:+hit.point.y.toFixed(1),geo:hit.object.geometry.type,color:mm.color?.getHexString?.(),map:!!mm.map,opacity:mm.opacity,transparent:mm.transparent,chain:chain.slice(0,4)});
  }
  return res;
});
console.log(JSON.stringify(out,null,1));
await b.close();
