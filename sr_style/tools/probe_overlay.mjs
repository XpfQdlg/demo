import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe","C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p)=>fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader","--use-angle=swiftshader","--window-size=1600,900"] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto("http://localhost:5180/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r)=>setTimeout(r,26000));
await page.keyboard.press("Digit2");
await page.waitForFunction(()=>!!window.__scan?.on,{timeout:20000});
await page.evaluate(()=>{window.__scan.radius=24;});
await new Promise((r)=>setTimeout(r,2500));
await page.screenshot({ path: "shots/cmp_overlay_on.png" });
/* 只关掉地面扫描层，看青色是不是它染的 */
await page.evaluate(()=>{window.__scan.overlay.visible=false;});
await new Promise((r)=>setTimeout(r,2500));
await page.screenshot({ path: "shots/cmp_overlay_off.png" });
/* 再把材质注入整个关掉（u_scan_on=0），看原始地面 */
await page.evaluate(()=>{window.__scan.uniforms.u_scan_on.value=0;});
await new Promise((r)=>setTimeout(r,2500));
await page.screenshot({ path: "shots/cmp_all_off.png" });
await browser.close();
