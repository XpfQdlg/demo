import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE=["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find(p=>fs.existsSync(p));
const b=await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars"]});
const p=await b.newPage(); await p.setViewport({width:1600,height:900});
await p.goto("http://localhost:5179/cinematic.html?scene=campus&q=low&look=maquette",{waitUntil:"domcontentloaded",timeout:60000});
for(let i=0;i<80;i++){
  await new Promise(r=>setTimeout(r,400));
  const hit=await p.evaluate(()=>!!document.querySelector(".dk-card.flash"));
  if(hit){await new Promise(r=>setTimeout(r,450));await p.screenshot({path:"shots/maq_flash.png"});console.log("flash at",i*0.4);break;}
}
await b.close();
