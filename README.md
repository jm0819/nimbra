# Nimbra

A scroll-driven product site for a fictional device brand, built as a front-end sample. Everything ships in one self-contained `index.html` that works offline.

Nimbra, its products, specs and prices are invented.

## What's in it

- **Scroll scenes.** A phone and a laptop built in CSS 3D. The phone turns and the laptop lid opens as you scroll.
- **Kinetic type.** Headline letters change weight and width with the scroll.
- **WebGL hero.** A fragment shader paints the moving background. It drops its own quality on slower machines.
- **Drawable tablet.** Canvas 2D drawing that follows pen pressure.
- **Earbud demo.** Live before-and-after waveforms driven by a noise-control slider.
- **Checkout maths.** The instalment calculation is written in WebAssembly.
- **Smooth wheel scrolling.** Mouse wheels glide; trackpads and touch keep their native feel.
- **Responsive and accessible.** Layouts for phones, tablets and laptops, and the page respects reduced-motion settings.

## Languages

HTML, CSS, JavaScript, React (JSX), GLSL, WebAssembly (WAT), SVG, Canvas 2D.

## Project layout

```
index.html          the built site: open it or deploy it
src/app.jsx         React components, scroll engine, shader, canvas code
src/styles.css      design tokens, 3D devices, responsive rules
src/monthly.wat     WebAssembly source for the instalment maths
build.js            bundles src/ into index.html
```

## Build

You only need this if you change `src/`.

```bash
npm install
npm run build      # writes dist/index.html; copy it to the repo root
```

The build compiles JSX with Babel and WAT with wabt, then inlines React 18.3.1 so the page needs no network. The fonts load from Google Fonts and fall back to system fonts when offline.

## Deploy on GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages**, set the source to the `main` branch and `/ (root)`, and save.
3. The site goes live at `https://<your-username>.github.io/<repo-name>/`.

## Credits

React © Meta Platforms, Inc., MIT licence. Its licence header is kept inside `index.html`.
