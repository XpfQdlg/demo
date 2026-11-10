import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars"]});
const p = await b.newPage();
await p.setViewport({width:1600,height:900});
await p.goto("https://blog.srlove.top/aegis/",{waitUntil:"networkidle2",timeout:60000});
await new Promise(r=>setTimeout(r,3000));
console.log(await p.evaluate(()=>{
  const t=document.querySelector(".dk-name");
  const cs=t?getComputedStyle(t):null;
  return {
    status: document.fonts.status,
    check400: document.fonts.check("400 16px NotoSC"),
    check600: document.fonts.check("600 16px NotoSC"),
    fam: cs?.fontFamily,
    weight: cs?.fontWeight,
    size: cs?.fontSize,
    text: t?.textContent,
    w: t?.getBoundingClientRect().width,
    sw: t?.scrollWidth,
    fonts: [...document.fonts].map(f=>({family:f.family,weight:f.weight,status:f.status})).slice(0,6),
  };
}));
await b.close();
