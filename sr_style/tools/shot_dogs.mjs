import puppeteer from "puppeteer-core";
import fs from "node:fs";
const EDGE = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({
  executablePath: EDGE, headless: "new",
  args: ["--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--window-size=1600,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto("http://localhost:5180/cinematic.html?scene=campus", { waitUntil: "domcontentloaded", timeout: 60000 });
await new Promise((r) => setTimeout(r, 26000));
for (const [key, name] of [["Digit2", "dog2"], ["Digit3", "dog3"], ["Digit4", "person1"]]) {
  await page.keyboard.press(key);
  await page.waitForFunction(() => !!window.__scan?.on, { timeout: 20000 });
  await page.evaluate(() => (window.__scan.radius = 24));
  await new Promise((r) => setTimeout(r, 3000));
  await page.screenshot({ path: `shots/near_${name}.png` });
  await page.keyboard.press("KeyG");
  await new Promise((r) => setTimeout(r, 2000));
}
console.log("errors:", errs.slice(0, 4));
await browser.close();
