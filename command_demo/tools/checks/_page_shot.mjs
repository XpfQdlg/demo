/* 通用截图：node tools/checks/_page_shot.mjs <url> <out> [w] [h] */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = ["C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].find((p) => fs.existsSync(p));
const [url, out, w = "1180", h = "820"] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: EDGE, headless: "new", args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--hide-scrollbars"] });
const p = await b.newPage();
await p.setViewport({ width: Number(w), height: Number(h) });
const logs = [];
p.on("console", (m) => logs.push(`${m.type()}: ${m.text()}`));
p.on("pageerror", (e) => logs.push(`pageerror: ${e.message}`));
await p.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
await new Promise((r) => setTimeout(r, 2500));
await p.screenshot({ path: out });
console.log(logs.join("\n") || "no console");
await b.close();
