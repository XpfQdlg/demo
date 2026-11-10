import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const b = await puppeteer.launch({executablePath:EDGE,headless:"new",args:["--enable-unsafe-swiftshader","--use-angle=swiftshader","--hide-scrollbars"]});
// phone
const ph = await b.newPage(); const perr=[]; ph.on("pageerror",e=>perr.push(e.message));
await ph.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
await ph.goto("https://blog.srlove.top/aegis/phone",{waitUntil:"networkidle2",timeout:60000});
await new Promise(r=>setTimeout(r,800));
await ph.screenshot({path:"shots/deployed_phone.png"});
console.log("phone", await ph.evaluate(()=>({cta:!!document.querySelector("#join-cta"), screen:document.querySelector(".screen.is-on")?.id, errs:0})), perr.slice(0,3));
// tablet
const tb = await b.newPage(); const terr=[]; tb.on("pageerror",e=>terr.push(e.message));
await tb.setViewport({width:1180,height:820});
await tb.goto("https://blog.srlove.top/aegis/tablet",{waitUntil:"networkidle2",timeout:60000});
await new Promise(r=>setTimeout(r,2500));
await tb.screenshot({path:"shots/deployed_tablet.png"});
console.log("tablet", await tb.evaluate(()=>({models:document.querySelectorAll(".model").length, health:document.querySelector(".health")?.textContent?.trim()})), terr.slice(0,3));
await b.close();
