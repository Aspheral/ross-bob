import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS, clamp, extractPalette, planPainting, strokePlanToSVG, paintStroke, ribbonGeometry } from "../src/engine.js";

function fixture(width=64,height=48) {
  const data = new Uint8ClampedArray(width*height*4);
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    const p=(y*width+x)*4;
    const color=x<width/2 ? [210,110,66] : [66,115,154];
    data[p]=color[0]; data[p+1]=color[1]; data[p+2]=color[2]; data[p+3]=255;
  }
  return {width,height,data};
}

test("presets and scalar helpers exist", () => {
  assert.equal(Object.keys(PRESETS).length,4);
  assert.equal(clamp(42,1,5),5);
});
test("extracts a bounded palette", () => {
  const colors=extractPalette(fixture(),6);
  assert.ok(colors.length>=2 && colors.length<=6);
  assert.ok(colors.every(rgb => rgb.length===3 && rgb.every(c=>c>=0 && c<=255)));
});
test("produces an ordered, replayable paint program", () => {
  const plan=planPainting(fixture(),{palette:6,detail:3,outline:.8,texture:.3,seed:1});
  assert.equal(plan.width,64);
  assert.equal(plan.height,48);
  assert.ok(plan.stats.paints>0);
  assert.ok(plan.strokes.length>0);
  assert.ok(plan.strokes.every(s=>s.points.length>=2 && s.width>0 && s.alpha>0));
  assert.ok(plan.strokes.some(s=>s.kind==="paint"));
  assert.ok(plan.palette.every(c=>/^#[0-9a-f]{6}$/i.test(c)));
  const svg=strokePlanToSVG(plan);
  assert.match(svg,/<svg /);
  assert.match(svg,/<path /);
  assert.ok(!svg.includes("<image"));
});
test("identical inputs generate identical strokes", () => {
  const image=fixture(22,19);
  const options={palette:4,detail:2,texture:.5,outline:0,seed:9};
  assert.deepEqual(planPainting(image,options),planPainting(image,options));
});
test("clear failure for invalid images", () => {
  assert.throws(()=>planPainting({width:0,height:4,data:[]}),TypeError);
});
test("pressure renderer writes vector-style canvas commands", () => {
  const calls=[];
  const ctx=new Proxy({}, {
    get(_,name){if(name==="save"||name==="restore"||name==="beginPath"||name==="moveTo"||name==="lineTo"||name==="quadraticCurveTo"||name==="closePath"||name==="arc"||name==="fill")return (...args)=>calls.push([name,args]);return undefined;},
    set(){return true;}
  });
  paintStroke(ctx,{color:"#fff",alpha:1,width:4,points:[{x:0,y:0,p:1},{x:10,y:10,p:.8}]});
  assert.ok(calls.some(([name])=>name==="fill"));
});


test("brush gestures visibly curve and change pressure from landing to release", () => {
  const plan=planPainting(fixture(90,58),{palette:5,detail:3,texture:.75,outline:.2,seed:23});
  const paint=plan.strokes.filter(s=>s.kind==="paint" && s.points.length>=6);
  assert.ok(paint.length>0);
  assert.ok(paint.some(s=>{
    const [a,b]=[s.points[0],s.points.at(-1)];
    return s.points.slice(1,-1).some((p,i)=>{
      const t=(i+1)/(s.points.length-1);
      return Math.abs(p.y - (a.y + (b.y - a.y)*t))>.25;
    });
  }),"at least one stroke should bend away from its endpoint chord");
  assert.ok(paint.some(s=>s.points[Math.floor(s.points.length/2)].p > s.points[0].p * 2));
  assert.ok(paint.every(s=>s.points.every(p=>p.x>=0 && p.x<plan.width && p.y>=0 && p.y<plan.height)));
});

test("SVG uses curved pressure silhouettes and distinct point radii", () => {
  const stroke={kind:"paint",color:"#123456",alpha:.7,width:8,points:[
    {x:5,y:5,p:.25},{x:15,y:10,p:1.1},{x:25,y:5,p:.15}
  ]};
  const g=ribbonGeometry(stroke);
  assert.ok(g.radii[1]>g.radii[0]*3);
  assert.ok(g.radii[1]>g.radii[2]*4);
  const svg=strokePlanToSVG({width:30,height:20,paper:"#ffffff",strokes:[stroke]});
  assert.match(svg,/ Q /);
  assert.match(svg,/ A /);
  assert.match(svg,/fill-opacity="0.7"/);
  assert.ok(!svg.includes("stroke-width="),"the exported shape must taper, not use a uniform outline width");
});

test("Canvas paints a curved pressure ribbon with quadratic geometry", () => {
  const calls=[];
  const ctx=new Proxy({}, {
    get(_,name){if(["save","restore","beginPath","moveTo","lineTo","quadraticCurveTo","arc","closePath","fill"].includes(name))return (...args)=>calls.push([name,args]);return undefined;},
    set(){return true;}
  });
  paintStroke(ctx,{color:"#abcdef",alpha:.8,width:7,points:[
    {x:1,y:1,p:.2},{x:8,y:5,p:1},{x:17,y:9,p:.6},{x:22,y:7,p:.2}
  ]});
  assert.ok(calls.some(([name])=>name==="quadraticCurveTo"));
  assert.ok(calls.filter(([name])=>name==="arc").length===2);
  assert.ok(calls.some(([name])=>name==="fill"));
});
