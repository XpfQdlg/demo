import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader"]});
const p = await b.newPage();
await p.goto("https://blog.srlove.top/aegis/",{waitUntil:"networkidle2",timeout:60000});
console.log(await p.evaluate(()=>{
  const deck=document.querySelector("#deck");
  const root=getComputedStyle(document.documentElement);
  const rules=[];
  for(const sh of document.styleSheets){ try{ for(const r of sh.cssRules){ if(r.selectorText && r.selectorText.includes("#deck")) rules.push(r.cssText.slice(0,200)); } }catch(e){} }
  return {deckFont:getComputedStyle(deck).fontFamily, varFont:root.getPropertyValue("--font"), rules:rules.slice(0,4), link:[...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.href)};
}));
await b.close();
