import { PRESETS, clamp, planPainting, paintStroke, strokePlanToSVG } from "./engine.js";

const $ = (id) => document.getElementById(id);
const drawing = $("drawing");
const ctx = drawing.getContext("2d", { alpha: false });
const reference = $("reference");
const refCtx = reference.getContext("2d", { willReadFrequently: true });
const pointer = $("brush-cursor");
const input = $("image-input");
const stage = $("canvas-stage");
const state = {
  source: null, name: "still-life", plan: null, preset: "studio",
  drawing: false, paused: false, index: 0, point: 1,
  frame: 0, lastTime: 0, remainder: 0, token: 0, startTime: 0
};

function labelSlider(sliderId, outputId, suffix = "") {
  const el = $(sliderId);
  $(outputId).textContent = el.value + suffix;
}
["detail", "palette", "humanize", "speed"].forEach(id => $(id).addEventListener("input", () => {
  const suffix = id === "humanize" ? "%" : id === "speed" ? "×" : "";
  labelSlider(id, id + "-value", suffix);
  if (id !== "speed") $("settings-note").textContent = "Settings updated. Paint again to apply.";
}));
function setStatus(message, type = "idle") {
  $("status-text").textContent = message;
  $("status-light").dataset.state = type;
}
function setProgress(value) {
  const p = clamp(value, 0, 100);
  $("progress-fill").style.width = p.toFixed(1) + "%";
  $("progress-text").textContent = Math.floor(p) + "%";
  $("progress-bar").setAttribute("aria-valuenow", String(Math.floor(p)));
}
function syncControls() {
  $("start-btn").disabled = !state.source || state.drawing;
  $("start-btn").textContent = state.plan ? "Paint again" : "Start painting";
  $("pause-btn").disabled = !state.drawing;
  $("pause-btn").textContent = state.paused ? "Resume" : "Pause";
  $("export-btn").disabled = !state.plan;
  $("replay-btn").disabled = !state.plan || state.drawing;
  $("settings-note").textContent = state.drawing ? "Brushes are moving on the actual canvas." : "Everything runs locally in your browser.";
}
function applyPreset(name) {
  if (!PRESETS[name]) return;
  state.preset = name;
  const p = PRESETS[name];
  document.querySelectorAll("[data-preset]").forEach(el => {
    const active = el.dataset.preset === name;
    el.classList.toggle("selected", active);
    el.setAttribute("aria-pressed", String(active));
  });
  $("palette").value = p.palette;
  $("detail").value = p.detail;
  $("humanize").value = Math.round(p.texture * 100);
  labelSlider("palette", "palette-value");
  labelSlider("detail", "detail-value");
  labelSlider("humanize", "humanize-value", "%");
  $("settings-note").textContent = p.label + " preset applied.";
}
document.querySelectorAll("[data-preset]").forEach(el => el.addEventListener("click", () => applyPreset(el.dataset.preset)));

function setCanvasSize(width, height) {
  drawing.width = reference.width = width;
  drawing.height = reference.height = height;
  stage.style.aspectRatio = width + "/" + height;
  $("reference-frame").style.aspectRatio = width + "/" + height;
  resetCanvas();
}
function resetCanvas() {
  ctx.fillStyle = state.plan?.paper || "#f6f2eb";
  ctx.fillRect(0, 0, drawing.width, drawing.height);
  pointer.hidden = true;
}
function abort() {
  state.token++;
  cancelAnimationFrame(state.frame);
  state.frame = 0;
  state.drawing = false;
  state.paused = false;
  state.index = 0;
  state.point = 1;
  state.remainder = 0;
}
function loadSource(canvas, name) {
  abort();
  const maxDimension = 450, scale = Math.min(1, maxDimension / Math.max(canvas.width, canvas.height));
  const width = Math.max(1, Math.round(canvas.width * scale));
  const height = Math.max(1, Math.round(canvas.height * scale));
  setCanvasSize(width, height);
  refCtx.clearRect(0, 0, width, height);
  refCtx.drawImage(canvas, 0, 0, width, height);
  state.source = refCtx.getImageData(0, 0, width, height);
  state.name = name.replace(/\.[^.]+$/, "").replace(/[^\w-]+/g, "-").slice(0, 55) || "painting";
  state.plan = null;
  $("image-name").textContent = name;
  $("image-size").textContent = width + " × " + height + " working pixels";
  $("source-badge").textContent = name === "Studio demo" ? "DEMO IMAGE" : "YOUR REFERENCE";
  $("palette-preview").innerHTML = "";
  $("stroke-count").textContent = "0";
  $("line-count").textContent = "0";
  setProgress(0);
  setStatus("Reference ready");
  syncControls();
}
async function openFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    setStatus("Please choose a supported image file.", "error");
    return;
  }
  if (file.size > 12 * 1024 * 1024) {
    setStatus("Image must be under 12 MB.", "error");
    return;
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("Invalid dimensions");
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    canvas.getContext("2d").drawImage(image, 0, 0);
    loadSource(canvas, file.name);
  } catch {
    setStatus("Could not open this image. Try PNG, JPG or WebP.", "error");
  } finally { URL.revokeObjectURL(url); input.value = ""; }
}
input.addEventListener("change", e => openFile(e.target.files?.[0]));
$("upload-btn").addEventListener("click", () => input.click());
$("change-btn").addEventListener("click", () => input.click());

const drop = $("upload-zone");
["dragenter", "dragover"].forEach(type => drop.addEventListener(type, e => {
  e.preventDefault(); drop.classList.add("dragging");
}));
["dragleave", "drop"].forEach(type => drop.addEventListener(type, e => {
  e.preventDefault(); drop.classList.remove("dragging");
}));
drop.addEventListener("drop", e => openFile(e.dataTransfer.files[0]));

function demoImage() {
  const c = document.createElement("canvas");
  c.width = 760; c.height = 560;
  const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, 760, 560);
  bg.addColorStop(0, "#f0e5d6"); bg.addColorStop(1, "#d0d9cc");
  g.fillStyle = bg; g.fillRect(0,0,760,560);
  g.fillStyle = "#c5afa0"; g.fillRect(0,405,760,155);
  g.fillStyle = "#a89a92"; g.beginPath();g.ellipse(405,475,220,31,0,0,Math.PI*2);g.fill();
  g.fillStyle = "#37483e";g.beginPath();g.moveTo(325,255);g.bezierCurveTo(275,143,331,95,360,77);g.bezierCurveTo(390,162,383,205,347,279);g.fill();
  g.fillStyle = "#60735a";g.beginPath();g.moveTo(359,218);g.bezierCurveTo(428,123,505,156,495,179);g.bezierCurveTo(449,246,395,251,359,218);g.fill();
  g.fillStyle="#9c6355";g.beginPath();g.moveTo(305,244);g.lineTo(424,244);g.lineTo(395,423);g.quadraticCurveTo(362,451,333,421);g.closePath();g.fill();
  g.fillStyle="#c38467";g.fillRect(300,234,130,22);
  g.fillStyle="#a65c35";g.beginPath();g.ellipse(485,391,80,78,-.1,0,Math.PI*2);g.fill();
  g.fillStyle="#d98540";g.beginPath();g.ellipse(477,386,66,71,.1,0,Math.PI*2);g.fill();
  g.fillStyle="#eeb15f";g.beginPath();g.ellipse(459,366,25,39,.25,0,Math.PI*2);g.fill();
  g.fillStyle="#405b44";g.beginPath();g.moveTo(477,324);g.quadraticCurveTo(491,285,532,303);g.quadraticCurveTo(526,335,477,324);g.fill();
  g.fillStyle="#704d3f";g.fillRect(475,304,5,25);
  g.fillStyle="#efd1a8";g.beginPath();g.ellipse(245,411,73,45,-.22,0,Math.PI*2);g.fill();
  g.fillStyle="#c98c64";g.beginPath();g.ellipse(249,409,52,31,-.2,0,Math.PI*2);g.fill();
  return c;
}
$("demo-btn").addEventListener("click", () => loadSource(demoImage(), "Studio demo"));

function showPalette(colors) {
  $("palette-preview").replaceChildren(...colors.map(c => {
    const swatch=document.createElement("span");swatch.className="swatch";
    swatch.style.backgroundColor=c;swatch.title=c;return swatch;
  }));
}
function paintLine(stroke, a, b) {
  paintStroke(ctx, { ...stroke, points: [a,b] });
  pointer.style.left = (100*b.x/drawing.width) + "%";
  pointer.style.top = (100*b.y/drawing.height) + "%";
  pointer.hidden = false;
}
function speedInSegments() {
  const values = [0, 95, 270, 720, 1900, 4800];
  return values[Number($("speed").value)] || 720;
}
function tick(now, token) {
  if (token!==state.token || !state.drawing || state.paused) return;
  const dt=Math.min(.08,(now-state.lastTime)/1000 || .016);
  state.lastTime=now;
  let budget=state.remainder + dt*speedInSegments();
  const strokes=state.plan.strokes;
  let safety=0;
  while(budget>=1 && state.index<strokes.length && safety<1800) {
    const s=strokes[state.index];
    const i=state.point;
    if (i < s.points.length) {
      paintLine(s,s.points[i-1],s.points[i]);
      state.point++;
    } else if (s.points.length === 1) {
      paintStroke(ctx,s); state.point++;
    }
    if (state.point >= s.points.length) { state.index++; state.point=1; }
    budget-=1;safety++;
  }
  state.remainder=Math.min(budget, 1600);
  const fraction=state.index/Math.max(1,strokes.length);
  setProgress(fraction*100);
  $("stroke-count").textContent=state.index.toLocaleString();
  if(state.index>=strokes.length) {
    state.drawing=false; state.paused=false; pointer.hidden=true;
    setProgress(100);setStatus("Painting finished", "success");
    syncControls();return;
  }
  state.frame=requestAnimationFrame(t=>tick(t,token));
}
function replay() {
  if (!state.plan) return;
  abort();resetCanvas();
  state.drawing=true;
  state.lastTime=performance.now();
  state.startTime=state.lastTime;
  setProgress(0);setStatus("Ross Bob is painting", "active");syncControls();
  state.frame=requestAnimationFrame(t=>tick(t,state.token));
}
$("start-btn").addEventListener("click", async () => {
  if (!state.source || state.drawing) return;
  abort();
  setStatus("Planning layers and brush strokes", "active");
  $("start-btn").disabled=true;
  await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
  const token=state.token;
  try {
    const p=PRESETS[state.preset], settings={
      palette:Number($("palette").value),
      detail:Number($("detail").value),
      brush:p.brush,
      texture:Number($("humanize").value)/100,
      outline:p.outline,
      seed: 7319
    };
    const result=planPainting(state.source,settings);
    if (token!==state.token) return;
    state.plan=result;
    $("line-count").textContent=result.stats.contours.toLocaleString();
    $("planned-count").textContent=result.strokes.length.toLocaleString();
    showPalette(result.palette);
    replay();
  } catch (error) {
    console.error(error);
    setStatus("Planning failed. Try a smaller image.", "error");
    syncControls();
  }
});
$("pause-btn").addEventListener("click", () => {
  if (!state.drawing) return;
  state.paused=!state.paused;
  if (state.paused) {
    cancelAnimationFrame(state.frame);pointer.hidden=true;setStatus("Painting paused");
  } else {
    state.lastTime=performance.now();setStatus("Ross Bob is painting", "active");
    state.frame=requestAnimationFrame(t=>tick(t,state.token));
  }
  syncControls();
});
$("replay-btn").addEventListener("click", replay);
$("reset-btn").addEventListener("click", () => {
  abort();state.plan=null;resetCanvas();setProgress(0);
  $("stroke-count").textContent="0";$("line-count").textContent="0";$("planned-count").textContent="0";
  setStatus("Canvas cleared");syncControls();
});

function downloadFile(name, blob) {
  const url=URL.createObjectURL(blob), link=document.createElement("a");
  link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function exportFile(type) {
  const p=state.plan;
  if (!p) return;
  const basename="ross-bob-"+state.name;
  if(type==="svg") {
    downloadFile(basename+".svg",new Blob([strokePlanToSVG(p)],{type:"image/svg+xml;charset=utf-8"}));
  } else if(type==="json") {
    downloadFile(basename+"-strokes.json",new Blob([JSON.stringify(p)],{type:"application/json"}));
  } else {
    const scale=3, canvas=document.createElement("canvas");
    canvas.width=p.width*scale;canvas.height=p.height*scale;
    const g=canvas.getContext("2d");g.scale(scale,scale);
    g.fillStyle=p.paper;g.fillRect(0,0,p.width,p.height);
    for (const s of p.strokes) paintStroke(g,s);
    canvas.toBlob(blob => blob && downloadFile(basename+".png",blob),"image/png");
  }
  $("export-menu").hidden=true;
}
$("export-btn").addEventListener("click", () => { $("export-menu").hidden=!$("export-menu").hidden; });
document.querySelectorAll("[data-export]").forEach(el => el.addEventListener("click", () => exportFile(el.dataset.export)));
document.addEventListener("click", event => {
  if (!$("export-wrap").contains(event.target)) $("export-menu").hidden=true;
});

applyPreset("studio");
labelSlider("speed","speed-value","×");
loadSource(demoImage(),"Studio demo");
