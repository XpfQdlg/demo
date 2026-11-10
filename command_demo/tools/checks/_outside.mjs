import fs from "node:fs";
const P=JSON.parse(fs.readFileSync("src/map/data/map_package.json","utf8"));
const poly=P.zones.campus.polygon;
function inside(x,y){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const [xi,yi]=poly[i],[xj,yj]=poly[j];if(((yi>y)!==(yj>y))&&(x<(xj-xi)*(y-yi)/(yj-yi)+xi))c=!c;}return c;}
let out=[];for(const b of P.buildings){if(!b.polygon)continue;const xs=b.polygon.map(p=>p[0]),ys=b.polygon.map(p=>p[1]);const cx=(Math.min(...xs)+Math.max(...xs))/2,cy=(Math.min(...ys)+Math.max(...ys))/2;if(!inside(cx,cy))out.push([b.id,b.height_m,Math.round(cx),Math.round(cy)]);}
console.log("outside",out.length);console.log(out.filter(o=>o[1]>1).slice(0,20));
