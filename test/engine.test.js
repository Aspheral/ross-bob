import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS, clamp, extractPalette, planPainting, strokePlanToSVG, paintStroke } from "../src/engine.js";

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
    get(_,name){if(name==="save"||name==="restore"||name==="beginPath"||name==="moveTo"||name==="lineTo"||name==="stroke"||name==="arc"||name==="fill")return (...args)=>calls.push([name,args]);return undefined;},
    set(){return true;}
  });
  paintStroke(ctx,{color:"#fff",alpha:1,width:4,points:[{x:0,y:0,p:1},{x:10,y:10,p:.8}]});
  assert.ok(calls.some(([name])=>name==="stroke"));
});
