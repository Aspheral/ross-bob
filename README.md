# Ross Bob 🎨

**A digital art studio that actually draws.**

Ross Bob is an experimental, browser-based painting system. Give it a reference image and watch it construct a new picture from an ordered sequence of individual brush strokes. It doesn't paste the source image onto the canvas or request a one-shot image from a text-to-image model.

> **Current stage: v0.2, curved-brush prototype.** The working engine uses deterministic computer vision and hand-coded heuristics, **not a trained neural-network painter**. A learned vision and stroke-planning model is on the roadmap. We want the name "AI artist" to be earned, not just put on a label.

## Try it

**[Open the studio](https://ross-bob.vercel.app)** · [Source code](https://github.com/Aspheral/ross-bob)

The studio includes an original demo still life, so you can try it without uploading anything.

1. Choose an image (PNG, JPG, WebP, GIF, or BMP) or use the demo.
2. Choose **Studio**, **Ink & pencil**, **Gouache**, or **Marker**.
3. Adjust detail, number of paint colors, and variation between strokes.
4. Click **Start painting**. Use **Pause**, **Replay**, and brush-speed controls to inspect how Ross Bob draws.
5. Export the finished painting as PNG, editable SVG paths, or a JSON brushstroke program.

Image analysis is fully local. Your reference file stays in your browser.

## How it works

Unlike a typical image-generation interface, Ross Bob's output is an actual **drawing program**:

```text
Reference image
     │
     ▼
Scale to a manageable working canvas
     │
     ▼
Study colors → median-cut palette
     │
     ▼
Map color regions & smooth isolated pixels
     │
     ▼
Estimate local color-edge direction and plan curved, pressure-varied gestures
     │
     ▼
Trace contrast boundaries for optional linework
     │
     ▼
Replay strokes on a clean canvas
     │
     ├── PNG  (raster image)
     ├── SVG  (editable paths)
     └── JSON (replayable stroke instructions)
```

Each stroke has its own color, opacity, base width, sequence position, and a series of pressure-tagged points. The planner now estimates color-sensitive image tangents to bend paint gestures around visible structure, while the brush applies asymmetric pressure: light entry, fuller middle, and tapered lift-off. Contours taper too. Playback animates these curved ribbons segment by segment, and the visible cursor changes size with pressure.

**Current limitation:** The planner still chooses most fill strokes from horizontal color runs, even though their paths now curve with local image gradients. It cannot yet reason about whole objects (like deciding to draw a leaf from stem to tip or placing eyes based on anatomy). Subject-aware gestures, realistic velocity and a learned painter are future milestones.

## Project layout

| Path | Purpose |
| --- | --- |
| `index.html` | Studio shell and accessible controls |
| `styles.css` | Responsive studio visual system |
| `src/engine.js` | Pure stroke planner, palette reduction, contour extraction, rasterizer and SVG exporter |
| `src/main.js` | File handling, playback, settings and downloads |
| `test/engine.test.js` | Pure Node tests for palette, planning, determinism, export and rendering |

The prototype uses **vanilla JavaScript, Canvas 2D, and ES modules**. No browser framework, image generation backend, or API keys are required.

## Run locally

Use Node.js 20 or later to run the tests:

```bash
git clone https://github.com/Aspheral/ross-bob.git
cd ross-bob
npm test
```

To serve the studio locally, run either:

```bash
python3 -m http.server 3000
# Then visit http://localhost:3000
```

or any other static HTTP server that supports ES modules. Opening `index.html` via `file://` is not recommended because browser module security restrictions vary.

## Deploy

The repository is linked to Vercel. The site is a **static HTML/CSS/JS** application. Vercel can serve it directly without environment variables or a custom build command. Commits to the production branch trigger production deployments; pull requests receive previews if enabled in the linked Vercel project.

## Privacy, performance, and exports

- Images are processed on the client and aren't uploaded or stored on a server.
- Input images are limited to 12 MB and scaled to a maximum working dimension of 450 pixels to keep planning responsive.
- PNG export renders the full plan at **3× the working canvas size**.
- SVG export contains filled, editable pressure-ribbon paths, with curved sides and actual variable width. No fixed-width stroke approximation is used.
- JSON export contains the ordered drawing plan and is suitable for future import, replay, editing or model-training experiments.
- Detailed images and gradients can become color-banded or need more strokes than a human would use. This is a prototype, not a faithful professional illustration tool.

## Roadmap

- [x] Real stroke-by-stroke painting, without compositing a final reference image
- [x] Region-aware palette reduction and outlines
- [x] Curved pressure ribbons, tapered lift-offs and playback controls
- [x] PNG / SVG / JSON export
- [x] Local-only processing and a responsive studio
- [ ] Subject and object segmentation
- [x] Image-gradient-guided bending for color strokes
- [ ] Full directional flow-field brush planning, semantic contours and object-aware gestures
- [ ] Variable stroke velocity, natural lift-offs, richer brush-tip simulation
- [ ] Editable layers, undo/redo and a timeline of drawing actions
- [ ] Model-assisted planning with human-drawn stroke datasets, trained/evaluated openly
- [ ] Larger-canvas tiling, better color consistency and custom brushes

## Contributing

Bug reports, algorithm ideas, reference test cases and improvements are welcome. Please include a description of the expected visual outcome when suggesting changes. If you add a planner feature, keep it testable without a browser where practical.

This project is experimental. No open-source license has been selected yet; please contact the repository owner before reusing the source in another project.
