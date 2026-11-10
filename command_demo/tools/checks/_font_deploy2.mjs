import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader"]});
const p = await b.newPage();
await p.goto("https://blog.srlove.top/aegis/?v="+Date.now(),{waitUntil:"networkidle2",timeout:60000});
await new Promise(r=>setTimeout(r,1500));
console.log(await p.evaluate(()=>({
  links:[...document.querySelectorAll('link[rel=stylesheet]')].map(l=>l.href),
  varFont:getComputedStyle(document.documentElement).getPropertyValue('--font'),
  deckFont:getComputedStyle(document.querySelector('#deck')).fontFamily,
  cssText: (()=>{for(const sh of document.styleSheets){try{if(sh.href&&sh.href.includes('cinematic')) return sh.cssRules.length;}catch(e){}}return -1;})(),
})));
await b.close();
