/**
 * Ross Bob's stroke planner.
 *
 * It reads pixels to plan discrete paths. No source-image pixels are copied to
 * the output canvas, and no generative-image API is involved.
 * Pure JavaScript so the planner can be tested without a browser.
 */

export const PRESETS = {
  studio: { label: "Studio", palette: 14, detail: 3, brush: 1, outline: 0.46, texture: 0.42 },
  pencil: { label: "Ink & pencil", palette: 7, detail: 4, brush: 0.70, outline: 0.96, texture: 0.28 },
  gouache: { label: "Gouache", palette: 12, detail: 2, brush: 1.40, outline: 0.15, texture: 0.63 },
  marker: { label: "Marker", palette: 9, detail: 2, brush: 1.65, outline: 0.52, texture: 0.20 }
};

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const rgbToHex = (c) => "#" + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("");
const colorGap = (a, b) => {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr * .85 + dg * dg * 1.25 + db * db * .9;
};

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function dimensions(source) {
  const { width, height, data } = source;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || !data || data.length < width * height * 4) {
    throw new TypeError("Expected RGBA image data with positive dimensions");
  }
  if (width * height > 800000) throw new RangeError("Image is too large for the planner");
  return { width, height, data };
}
function effectivePixel(data, p, background = [247, 244, 237]) {
  const a = data[p + 3] / 255;
  return [
    Math.round(data[p] * a + background[0] * (1 - a)),
    Math.round(data[p + 1] * a + background[1] * (1 - a)),
    Math.round(data[p + 2] * a + background[2] * (1 - a))
  ];
}

/** Median-cut color clustering preserves the dominant colors of the subject. */
export function extractPalette(source, count = 12) {
  const { width, height, data } = dimensions(source);
  const samples = [];
  const step = Math.max(1, Math.ceil(Math.sqrt(width * height / 16000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) samples.push(effectivePixel(data, (y * width + x) * 4));
  }
  let buckets = [samples];
  const limit = clamp(Math.round(count), 2, 24);
  while (buckets.length < limit) {
    let best = -1, spread = -1, axis = 0;
    buckets.forEach((bucket, index) => {
      if (bucket.length < 2) return;
      for (let channel = 0; channel < 3; channel++) {
        const vals = bucket.map(p => p[channel]);
        const range = Math.max(...vals) - Math.min(...vals);
        const score = range * Math.sqrt(bucket.length);
        if (score > spread) { spread = score; best = index; axis = channel; }
      }
    });
    if (best === -1) break;
    const chosen = buckets.splice(best, 1)[0].sort((a, b) => a[axis] - b[axis]);
    const middle = Math.floor(chosen.length / 2);
    buckets.push(chosen.slice(0, middle), chosen.slice(middle));
  }
  return buckets.map(bucket => [0,1,2].map(c => Math.round(bucket.reduce((s,p) => s + p[c], 0) / bucket.length)));
}
function nearestPalette(pixel, palette) {
  let best = 0, bestDistance = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const distance = colorGap(pixel, palette[i]);
    if (distance < bestDistance) { bestDistance = distance; best = i; }
  }
  return best;
}
/**
 * Detect a local shape tangent from RGB image gradients. Color-sensitive
 * structure detects boundaries even when two colors share luminance.
 */
function flowAt(pixels, width, height, x, y, direction) {
  if (width < 5 || height < 5) return { slope: 0, weight: 0 };
  const cx = clamp(Math.round(x), 2, width - 3), cy = clamp(Math.round(y), 2, height - 3);
  const l = pixels[cy * width + cx - 2], r = pixels[cy * width + cx + 2];
  const u = pixels[(cy - 2) * width + cx], d = pixels[(cy + 2) * width + cx];
  let xx = 0, xy = 0, yy = 0;
  for (let c = 0; c < 3; c++) {
    const gx = r[c] - l[c], gy = d[c] - u[c];
    xx += gx * gx; xy += gx * gy; yy += gy * gy;
  }
  const energy = xx + yy;
  if (energy < 90) return { slope: 0, weight: 0 };
  const normal = Math.atan2(2 * xy, xx - yy) * .5;
  let tx = -Math.sin(normal), ty = Math.cos(normal);
  if (tx * direction < 0) { tx = -tx; ty = -ty; }
  return {
    slope: clamp(ty / (Math.abs(tx) + .32), -1.1, 1.1),
    weight: clamp((Math.sqrt(energy) - 9) / 90, 0, 1)
  };
}

/**
 * Form-aware curved gesture. Stroke pressure has a light landing, a full
 * body and a fine lift-off; the bend comes from local image structure.
 */
function interpolateStroke(x1, y1, x2, y2, rand, amount, brushWidth, pixels, imageWidth, imageHeight, region) {
  const dx = x2 - x1, dy = y2 - y1, length = Math.hypot(dx, dy);
  const direction = dx < 0 ? -1 : 1;
  const f1 = flowAt(pixels, imageWidth, imageHeight, x1 + dx * .3, y1 + dy * .3, direction);
  const f2 = flowAt(pixels, imageWidth, imageHeight, x1 + dx * .7, y1 + dy * .7, direction);
  const bow1 = f1.slope * length * .20 * f1.weight;
  const bow2 = f2.slope * length * .20 * f2.weight;
  const gesture = (rand() - .5) * (1.4 + amount * 2.5);
  const phase = rand() * Math.PI * 2;
  const maxBend = Math.min(length * .26, Math.max(1.2, brushWidth * 2.3));
  const n = Math.max(2, Math.ceil(length / 5));
  const points = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, envelope = Math.sin(Math.PI * t);
    const flowBend = bow1 * (1 - t) + bow2 * t;
    const curl = (bow2 - bow1) * Math.sin(Math.PI * 2 * t) * .21;
    const freehand = gesture * Math.sin(Math.PI * t * 1.32) +
      amount * .3 * Math.sin(3.1 * Math.PI * t + phase) * envelope;
    const bend = clamp((flowBend + curl + freehand) * envelope, -maxBend, maxBend);
    const x = x1 + dx * t, baseY = y1 + dy * t;
    let y = clamp(baseY + bend, 0, imageHeight - 1);
    // Bend inside the chosen color region instead of bleeding into neighbors.
    if (region && !region(clamp(Math.round(x), 0, imageWidth - 1), Math.round(y))) {
      for (const factor of [.6, .3, 0]) {
        const candidate = clamp(baseY + bend * factor, 0, imageHeight - 1);
        if (region(clamp(Math.round(x), 0, imageWidth - 1), Math.round(candidate))) { y = candidate; break; }
      }
    }
    const pressure = clamp(.24 + .82 * Math.pow(envelope, .65) +
      .1 * Math.sin(2 * Math.PI * t + phase) * envelope +
      .04 * Math.sin(Math.PI * t * 3) * envelope, .16, 1.15);
    points.push({x: +x.toFixed(2), y: +y.toFixed(2), p: +pressure.toFixed(3)});
  }
  return points;
}

function localContrast(colors, width, x, y, height) {
  const pos = y * width + x;
  const x1 = colors[pos - 1], x2 = colors[pos + 1];
  const y1 = colors[pos - width], y2 = colors[pos + width];
  if (x1 === x2 && y1 === y2) return 0;
  return Math.max(colorGap(x1, x2), colorGap(y1, y2));
}

function traceEdges(rgb, width, height, threshold, rand, strokeWidth, opacity, maxStrokes) {
  const mask = new Uint8Array(width * height);
  // Compare actual composited colors rather than palette IDs; otherwise
  // unrelated but similarly quantized areas create artificial boundaries.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const left = rgb[p-1], right = rgb[p+1], up = rgb[p-width], down = rgb[p+width];
      const d = Math.max(colorGap(left, right), colorGap(up, down));
      if (d > threshold * threshold * 3) mask[p] = 1;
    }
  }
  const strokes = [], visited = new Uint8Array(mask.length);
  const dirs = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];
  const stride = Math.max(1, Math.floor(Math.min(width, height) / 260));
  for (let y = 2; y < height-2 && strokes.length < maxStrokes; y += stride) {
    for (let x = 2; x < width-2 && strokes.length < maxStrokes; x += stride) {
      let p = y * width + x;
      if (!mask[p] || visited[p]) continue;
      let cx = x, cy = y, vx = 0, vy = 0;
      const points = [];
      for (let step = 0; step < 120; step++) {
        p = cy * width + cx;
        if (visited[p] || !mask[p]) break;
        visited[p] = 1;
        if (step % 2 === 0) points.push({ x: cx, y: cy, p: .75 + .19 * rand() });
        let next = null, score = -1e6;
        for (const [dx,dy] of dirs) {
          const nx = cx+dx, ny = cy+dy;
          if (nx < 1 || ny < 1 || nx >= width-1 || ny >= height-1) continue;
          const np = ny * width + nx;
          if (!mask[np] || visited[np]) continue;
          const continuity = vx*dx + vy*dy;
          const s = continuity * 3 + rand() * .24 - (dx !== 0 && dy !== 0 ? .12 : 0);
          if (s > score) { score = s; next = [nx,ny,dx,dy]; }
        }
        if (!next) break;
        [cx,cy,vx,vy] = next;
      }
      if (points.length >= 4) {
        const phase = rand() * Math.PI * 2;
        const shaped = points.map((p, i) => {
          const t = i / (points.length - 1), lift = Math.pow(Math.sin(Math.PI * t), .52);
          return {x: p.x, y: p.y, p: +clamp(.18 + .86 * lift + .07 * lift * Math.sin(phase + t * Math.PI * 3), .16, 1.1).toFixed(3)};
        });
        strokes.push({
          kind: "contour", color: "#27252a", alpha: opacity,
          width: strokeWidth * (.72 + rand()*.35), points: shaped
        });
      }
    }
  }
  return strokes;
}

/**
 * Convert an RGBA raster into an ordered drawing program.
 * Settings: palette, detail (1-5), brush, outline, texture, seed.
 */
export function planPainting(source, settings = {}) {
  const { width, height, data } = dimensions(source);
  const detail = clamp(Number(settings.detail) || 3, 1, 5);
  const paletteSize = clamp(Number(settings.palette) || 12, 2, 24);
  const brush = clamp(Number(settings.brush) || 1, .5, 2.5);
  const texture = clamp(Number(settings.texture) || 0, 0, 1);
  const outline = clamp(Number(settings.outline) || 0, 0, 1);
  const rand = seededRandom(Number.isFinite(settings.seed) ? settings.seed : 8675309);
  const palette = extractPalette(source, paletteSize);
  const pixels = new Array(width*height);
  const indices = new Uint8Array(width*height);
  const frequency = new Array(palette.length).fill(0);
  for (let p = 0; p < width*height; p++) {
    const pixel = effectivePixel(data, p*4);
    pixels[p] = pixel;
    const k = nearestPalette(pixel, palette);
    indices[p] = k;
    frequency[k]++;
  }
  // Small speckles are resolved before planning broad color regions.
  const smoothed = indices.slice();
  for (let y=1; y<height-1; y++) for (let x=1; x<width-1; x++) {
    const p = y*width+x, k=indices[p];
    const a=indices[p-1], b=indices[p+1], c=indices[p-width], d=indices[p+width];
    if (a===b && a===c && a===d && a!==k) smoothed[p]=a;
  }
  const gap = clamp((8.8 - detail*1.2)*brush, 2.2, 13);
  const spacing = gap*.70;
  const maxLength = clamp(30 + detail*12, 28, 105);
  const jitter = texture*gap*.24;
  const strokes = [];
  const maxFill = 15000;
  const rowCount = Math.ceil(height / spacing);
  for (let row=0; row<rowCount && strokes.length<maxFill; row++) {
    const y = clamp(Math.round((row + .48)*spacing), 0, height-1);
    const direction = row % 2 ? -1 : 1;
    let x = direction===1 ? 0 : width-1;
    while (x>=0 && x<width && strokes.length<maxFill) {
      const start=x, index=smoothed[y*width+x];
      let length=0;
      while (x>=0 && x<width && smoothed[y*width+x]===index && length<maxLength) { x+=direction; length++; }
      const end=x-direction;
      if (length < 1) continue;
      const offset=(rand()-.5)*jitter*1.5;
      const y1=clamp(y+offset,0,height-1), y2=clamp(y-offset*.35,0,height-1);
      strokes.push({
        kind:"paint", color:rgbToHex(palette[index]),
        width:gap*(.94 + rand()*.18),
        alpha:clamp(.88 + rand()*.12,0,1),
        points:interpolateStroke(start,y1,end,y2,rand,jitter,gap,pixels,width,height,(px,py)=>smoothed[py*width+px]===index)
      });
    }
  }
  const edgeBudget = outline > .05 ? Math.min(2800, Math.round(width*height / 50)) : 0;
  if (edgeBudget) strokes.push(...traceEdges(
    pixels,width,height,clamp(94-detail*8,50,150),rand,
    clamp(1.5 + (detail-3)*-.18, .7, 2.6),
    clamp(outline*.88,0,1),edgeBudget
  ));
  const [backgroundIndex] = frequency.map((count,i)=>[count,i]).sort((a,b)=>b[0]-a[0]).map(x=>x[1]);
  return {
    version:2, width,height,
    paper:"#f6f2eb",
    dominantColor:rgbToHex(palette[backgroundIndex]),
    palette:palette.map(rgbToHex),
    strokes,
    stats:{ paints:strokes.filter(s=>s.kind==="paint").length, contours:strokes.filter(s=>s.kind==="contour").length }
  };
}

/** Replayable, pressure-aware stroke rasterization, also used by PNG export. */
export function paintStroke(ctx, stroke, pointLimit = stroke.points.length) {
  const pts=stroke.points, limit=Math.min(pts.length,pointLimit);
  if (!limit) return;
  ctx.save();
  ctx.strokeStyle=stroke.color;
  ctx.fillStyle=stroke.color;
  ctx.globalAlpha=stroke.alpha;
  ctx.lineCap="round";
  ctx.lineJoin="round";
  if (limit===1 || (limit===2 && pts[0].x===pts[1].x && pts[0].y===pts[1].y)) {
    ctx.beginPath();
    ctx.arc(pts[0].x,pts[0].y,stroke.width*pts[0].p*.5,0,Math.PI*2);
    ctx.fill();
  } else {
    for (let i=1;i<limit;i++) {
      ctx.beginPath();
      ctx.lineWidth=stroke.width*(pts[i-1].p+pts[i].p)*.5;
      ctx.moveTo(pts[i-1].x,pts[i-1].y);
      ctx.lineTo(pts[i].x,pts[i].y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function strokePlanToSVG(plan) {
  if (!plan || !Array.isArray(plan.strokes)) throw new TypeError("Invalid drawing plan");
  const escape=(s)=>String(s).replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");
  const paths=plan.strokes.map(s=>{
    const path=s.points.map((p,i)=>(i?"L":"M")+p.x+" "+p.y).join(" ");
    return '<path d="'+escape(path)+'" fill="none" stroke="'+escape(s.color)+'" stroke-width="'+s.width.toFixed(2)+'" stroke-opacity="'+s.alpha.toFixed(3)+'" stroke-linecap="round" stroke-linejoin="round"/>';
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+plan.width+' '+plan.height+'" width="'+plan.width+'" height="'+plan.height+'">\n<rect width="100%" height="100%" fill="'+escape(plan.paper)+'"/>\n'+paths.join("\n")+'\n</svg>';
}
