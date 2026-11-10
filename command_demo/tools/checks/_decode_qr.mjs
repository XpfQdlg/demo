import fs from "node:fs";
import { PNG } from "pngjs";
import jsQR from "jsqr";
const png = PNG.sync.read(fs.readFileSync("shots/deployed.png"));
const { width, height, data } = png;
const qr = jsQR(new Uint8ClampedArray(data), width, height);
console.log(qr ? qr.data : "NO QR");
