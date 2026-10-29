const { useState, useEffect, useRef, useCallback } = React;

/* ============ math ============ */
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const seg = (p, a, b) => clamp((p - a) / (b - a));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const fadeWin = (p, a, b, f = 0.07) => Math.min(seg(p, a, a + f), 1 - seg(p, b - f, b));
const q = (v, step) => Math.round(v / step) * step;
const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const COARSE = window.matchMedia("(pointer: coarse)").matches;
const money = n => "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

/* ============ frame loop: every subscriber reads first, then all write ============
   Reading layout after a write forces the browser to recalculate layout mid-frame.
   Splitting the two phases keeps it to one layout pass per frame. */
const SKIP = null;
const subs = new Set();
let queued = false;
function flush() {
  queued = false;
  const list = [...subs];
  const data = list.map(s => s.read());
  for (let i = 0; i < list.length; i++) if (data[i] !== SKIP) list[i].write(data[i]);
}
function request() { if (!queued && !smooth.running) { queued = true; requestAnimationFrame(flush); } }
function useFrame(read, write) {
  const r = useRef(null);
  r.current = { read, write };
  useEffect(() => {
    const s = { read: () => r.current.read(), write: d => r.current.write(d) };
    subs.add(s); request();
    return () => subs.delete(s);
  }, []);
}
function measure(el) {
  if (!el) return SKIP;
  const r = el.getBoundingClientRect(), vh = window.innerHeight;
  if (r.bottom <= 0 || r.top >= vh) return SKIP;
  const t = r.height - vh;
  return { p: t <= 0 ? 0 : clamp(-r.top / t), top: r.top, vh };
}

/* ============ smooth wheel scrolling ============
   Mouse wheels (especially on Windows) jump 100px per notch. We ease toward the
   target instead, and update every scene in the same frame as the scroll. */
const smooth = (() => {
  const api = { running: false, enabled: !REDUCED && !COARSE, to: null };
  let target = 0, cur = 0, last = 0, token = 0, ease0 = 0.885;
  const maxY = () => document.documentElement.scrollHeight - window.innerHeight;
  function tick(id, t) {
    if (id !== token) return;
    const dt = last ? Math.min(t - last, 48) : 16.7;
    last = t;
    cur += (target - cur) * (1 - Math.pow(ease0, dt / 16.7));
    if (Math.abs(target - cur) < 0.35) cur = target;
    window.scrollTo(0, cur);
    flush();
    if (cur !== target) requestAnimationFrame(tt => tick(id, tt));
    else { api.running = false; last = 0; }
  }
  function start() {
    if (api.running) return;
    api.running = true; last = 0;
    const id = ++token;
    requestAnimationFrame(t => tick(id, t));
  }
  function stop() { token++; api.running = false; last = 0; }
  function scrollable(el, dy) {
    for (; el && el !== document.body && el.nodeType === 1; el = el.parentElement) {
      const s = getComputedStyle(el);
      if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) {
        if ((dy > 0 && el.scrollTop + el.clientHeight < el.scrollHeight - 1) || (dy < 0 && el.scrollTop > 0)) return true;
      }
    }
    return false;
  }
  api.to = y => {
    y = clamp(y, 0, maxY());
    if (!api.enabled) { window.scrollTo({ top: y, behavior: REDUCED ? "auto" : "smooth" }); return; }
    if (!api.running) cur = window.scrollY;
    target = y; start();
  };
  if (api.enabled) {
    window.addEventListener("wheel", e => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || scrollable(e.target, e.deltaY)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1;
      // Trackpads (Mac, Windows precision pads) send many small pixel deltas with their own
      // momentum, so they get a light touch. Mouse wheels send big notches and get more easing.
      const pad = e.deltaMode === 0 && Math.abs(e.deltaY) < 50 && !Number.isInteger(e.deltaY / 100) && !Number.isInteger(e.deltaY / 120);
      ease0 = pad ? 0.6 : 0.885;
      if (!api.running) cur = target = window.scrollY;
      target = clamp(target + e.deltaY * unit, 0, maxY());
      start();
    }, { passive: false });
    window.addEventListener("scroll", () => { if (!api.running) cur = target = window.scrollY; }, { passive: true });
    window.addEventListener("keydown", e => { if (/^(Arrow|Page|Home|End| )/.test(e.key)) stop(); });
    window.addEventListener("pointerdown", e => { if (e.target === document.documentElement) stop(); });
    window.addEventListener("resize", () => { if (api.running) target = clamp(target, 0, maxY()); });
  }
  return api;
})();
window.addEventListener("scroll", request, { passive: true });
window.addEventListener("resize", request);
function goTo(id) {
  const el = id === "top" ? null : document.getElementById(id);
  smooth.to(el ? el.getBoundingClientRect().top + window.scrollY : 0);
}
document.addEventListener("click", e => {
  const a = e.target.closest && e.target.closest('a[href^="#"]');
  if (!a) return;
  e.preventDefault();
  goTo(a.getAttribute("href").slice(1) || "top");
});

/* ============ WebAssembly: instalment maths ============ */
const WASM_B64 = "__WASM_BASE64__";
let wasmMonthly = null;
try {
  const bytes = Uint8Array.from(atob(WASM_B64), c => c.charCodeAt(0));
  wasmMonthly = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.monthly;
} catch (e) { wasmMonthly = null; }
function monthly(price, months, apr) {
  if (wasmMonthly) return wasmMonthly(price, months, apr);
  const r = apr / 12;
  if (!r) return price / months;
  const f = Math.pow(1 + r, months);
  return (price * r * f) / (f - 1);
}

/* ============ GLSL: hero light field ============ */
const VERT = `attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }`;
const FRAG = `
precision mediump float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_mouse; uniform float u_scroll;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  p += (u_mouse - 0.5) * 0.18;
  float t = u_time * 0.045;
  vec2 q = vec2(fbm(p * 1.5 + t), fbm(p * 1.5 + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p * 2.0 + 4.0 * q + vec2(1.7, 9.2) + t * 1.4), fbm(p * 2.0 + 4.0 * q + vec2(8.3, 2.8) - t));
  float f = fbm(p * 1.7 + 4.0 * r);
  vec3 navy = vec3(0.031, 0.043, 0.098);
  vec3 peri = vec3(0.62, 0.70, 1.0);
  vec3 ember = vec3(1.0, 0.52, 0.38);
  vec3 col = mix(navy, peri * 0.5, smoothstep(0.38, 0.95, f));
  col = mix(col, ember * 0.55, smoothstep(0.58, 1.0, r.x) * 0.5);
  col += peri * 0.22 * pow(length(q), 3.0);
  float d = length((gl_FragCoord.xy / u_res - u_mouse) * vec2(u_res.x / u_res.y, 1.0));
  col += peri * 0.08 * smoothstep(0.45, 0.0, d);
  col *= 1.0 - 0.7 * u_scroll;
  col *= mix(0.55, 1.0, smoothstep(1.25, 0.2, length(p)));
  gl_FragColor = vec4(col, 1.0);
}`;

function useShader(canvasRef, secRef, mouse) {
  useEffect(() => {
    const c = canvasRef.current;
    let gl = null;
    try { gl = c.getContext("webgl", { antialias: false, alpha: false, powerPreference: "low-power" }); } catch (e) {}
    if (!gl) return;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(prog, n);
    const uRes = U("u_res"), uTime = U("u_time"), uMouse = U("u_mouse"), uScroll = U("u_scroll");
    // Quality adapts: renders at 30 fps, and drops resolution further if frames run slow.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let scale = 0.42 * Math.min(1, 1.5 / dpr) * (window.innerWidth < 700 ? 1.3 : 1), slow = 0, samples = 0, prevT = 0, lastDraw = 0;
    function size() {
      c.width = Math.max(1, (c.clientWidth * scale) | 0);
      c.height = Math.max(1, (c.clientHeight * scale) | 0);
      gl.viewport(0, 0, c.width, c.height);
    }
    const t0 = performance.now();
    let raf = 0, visible = true, sp = 0;
    function draw(t) {
      gl.uniform2f(uRes, c.width, c.height);
      gl.uniform1f(uTime, REDUCED ? 8 : (t - t0) / 1000);
      gl.uniform2f(uMouse, mouse.current.x, 1 - mouse.current.y);
      gl.uniform1f(uScroll, sp);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    function loop(t) {
      if (!visible || REDUCED) return;
      raf = requestAnimationFrame(loop);
      if (prevT) {
        const dt = t - prevT;
        if (samples < 24) { samples++; if (dt > 24) slow++; }
        else if (samples === 24) { samples++; if (slow > 6) { scale = 0.28; size(); } }
      }
      prevT = t;
      if (t - lastDraw < 31) return; // ~30 fps on any refresh rate: the light drifts slowly, so it looks the same
      lastDraw = t;
      const r = secRef.current.getBoundingClientRect();
      sp = clamp(-r.top / Math.max(1, r.height - window.innerHeight));
      if (sp > 0.985) return;
      draw(t);
    }
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      cancelAnimationFrame(raf); prevT = 0;
      if (visible) raf = requestAnimationFrame(loop);
    });
    io.observe(secRef.current);
    const onResize = () => { size(); draw(performance.now()); };
    window.addEventListener("resize", onResize);
    size(); draw(performance.now());
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); io.disconnect(); window.removeEventListener("resize", onResize); };
  }, []);
}

/* ============ data ============ */
const PRODUCTS = {
  pebble: { name: "Pebble 2", kind: "Phone", price: 799, line: "Two equal cameras in a phone that fits one hand.",
    specs: { Display: "6.3 in OLED, up to 2,400 nits", Weight: "171 g", Battery: "31 h video", Chip: "Nimbra N4", Storage: "128 GB to 1 TB", Finishes: "Basalt, Tide, Clay, Frost" },
    storage: [["128 GB", 0], ["256 GB", 100], ["512 GB", 300], ["1 TB", 500]],
    finishes: [["Basalt", "#2B2D31"], ["Tide", "#55748F"], ["Clay", "#B9704F"], ["Frost", "#D3D7DC"]] },
  atlas: { name: "Atlas 14", kind: "Laptop", price: 1299, line: "Thirty-six hours between charges, 1.19 kg to carry.",
    specs: { Display: "14.2 in mini-LED, 1,000 nits", Weight: "1.19 kg", Battery: "22 h video", Chip: "Nimbra N5", Storage: "512 GB to 4 TB", Finishes: "Graphite, Sand" },
    storage: [["512 GB", 0], ["1 TB", 200], ["2 TB", 600], ["4 TB", 1200]],
    finishes: [["Graphite", "#4A4F57"], ["Sand", "#CDBFA8"]] },
  canvas: { name: "Canvas 11", kind: "Tablet", price: 549, line: "Paper-matte glass and a stylus that keeps up.",
    specs: { Display: "11 in LCD, matte, 600 nits", Weight: "462 g", Battery: "12 h", Chip: "Nimbra N3", Storage: "128 GB to 1 TB", Finishes: "Fog, Moss" },
    storage: [["128 GB", 0], ["256 GB", 100], ["512 GB", 300], ["1 TB", 500]],
    finishes: [["Fog", "#B9C0C6"], ["Moss", "#6E7F63"]] },
  orbit: { name: "Orbit", kind: "Earbuds", price: 179, line: "Noise control that listens before it cancels.",
    specs: { Display: "None", Weight: "4.6 g per bud", Battery: "8 h, 34 h with case", Chip: "Nimbra A1 audio", Storage: "None", Finishes: "Chalk, Ink" },
    storage: [["Standard", 0]],
    finishes: [["Chalk", "#ECE8E1"], ["Ink", "#2A2E35"]] },
  loop: { name: "Loop", kind: "Watch", price: 299, line: "A week of battery on a round screen you can read in sun.",
    specs: { Display: "1.4 in round OLED, 2,000 nits", Weight: "31 g", Battery: "7 days", Chip: "Nimbra W2", Storage: "32 GB", Finishes: "Steel, Rust, Bone" },
    storage: [["40 mm", 0], ["44 mm", 30]],
    finishes: [["Steel", "#A9AEB4"], ["Rust", "#A4553A"], ["Bone", "#E2DACB"]] },
};
const ORDER = ["pebble", "atlas", "canvas", "orbit", "loop"];

/* ============ small parts ============ */
function Mark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="10.4" ry="4.4" fill="none" stroke="currentColor" strokeWidth="1.6" transform="rotate(-28 12 12)" />
    </svg>
  );
}
function Bud({ color, side }) {
  return (
    <span className={"bud bud--" + side} style={{ "--c": color }}>
      <span className="bud-tip"></span>
      <span className="bud-body"><span className="bud-ring"></span><span className="bud-pad"></span></span>
    </span>
  );
}
function Mini({ id, color }) {
  const c = color || PRODUCTS[id].finishes[0][1];
  const style = { "--c": c };
  if (id === "pebble") return <div className="mini-phone" style={style}><span className="mini-cam"><i></i><i></i></span><span className="mini-sheen"></span></div>;
  if (id === "atlas") return <div className="mini-lap" style={style}><div className="mini-lid"><span></span></div><div className="mini-base"></div></div>;
  if (id === "canvas") return <div className="mini-tab" style={style}><span></span></div>;
  if (id === "orbit") return <div className="mini-buds"><Bud color={c} side="l" /><Bud color={c} side="r" /></div>;
  return (
    <div className="mini-watch" style={style}>
      <span className="band band--t"></span><span className="band band--b"></span>
      <span className="case"><span className="face"><b>10:08</b><i></i></span></span><span className="crown"></span>
    </div>
  );
}
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 20000); return () => clearInterval(t); }, []);
  return now;
}

/* ============ header ============ */
function Header({ bag }) {
  const bar = useRef(null);
  useFrame(
    () => { const max = document.documentElement.scrollHeight - window.innerHeight; return max > 0 ? window.scrollY / max : 0; },
    v => { if (bar.current) bar.current.style.transform = `scaleX(${v.toFixed(4)})`; }
  );
  const links = [["pebble", "Pebble"], ["atlas", "Atlas"], ["canvas", "Canvas"], ["orbit", "Orbit"], ["lineup", "Lineup"], ["compare", "Compare"], ["built", "How it's built"]];
  return (
    <header className="hdr">
      <div className="wrap hdr-in">
        <a className="brand" href="#top"><Mark />Nimbra</a>
        <nav className="nav" aria-label="Products">{links.map(([id, l]) => <a key={id} href={"#" + id}>{l}</a>)}</nav>
        <a className="bag" href="#buy" aria-label={`Bag, ${bag} ${bag === 1 ? "item" : "items"}`}>Bag <span className="bag-n">{bag}</span></a>
      </div>
      <div className="hdr-bar" ref={bar}></div>
    </header>
  );
}

/* ============ hero ============ */
const HEADLINE = "Four new things to hold.";
function Hero() {
  const sec = useRef(null), cv = useRef(null), h1 = useRef(null);
  const spans = useRef([]), cache = useRef([]);
  const mouse = useRef({ x: 0.5, y: 0.45, on: false });
  useShader(cv, sec, mouse);
  useEffect(() => {
    spans.current = [...h1.current.querySelectorAll(".ch")];
    const move = e => {
      if (e.pointerType === "touch") return;
      mouse.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight, on: true };
      request();
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, []);
  useFrame(
    () => {
      const m = measure(sec.current);
      if (!m) return SKIP;
      const { on } = mouse.current;
      const centers = on && m.p < 0.5 ? spans.current.map(s => { const b = s.getBoundingClientRect(); return [(b.left + b.width / 2) / window.innerWidth, (b.top + b.height / 2) / window.innerHeight]; }) : null;
      return { p: m.p, centers };
    },
    ({ p, centers }) => {
      sec.current.style.setProperty("--p", p.toFixed(4));
      const { x, y } = mouse.current;
      spans.current.forEach((s, i) => {
        let w = 740 - p * 520, wd = 100 - p * 25;
        if (centers) {
          const k = clamp(1 - Math.hypot((centers[i][0] - x) * 1.6, centers[i][1] - y) * 3.4);
          w -= k * 500; wd -= k * 22;
        }
        w = q(clamp(w, 200, 800), 20); wd = q(clamp(wd, 75, 100), 2);
        const key = w * 1000 + wd;
        if (cache.current[i] !== key) { cache.current[i] = key; s.style.fontVariationSettings = `"wght" ${w}, "wdth" ${wd}, "opsz" 96`; }
      });
    }
  );
  return (
    <section className="scene hero" ref={sec} data-scene="night" id="top" aria-label="Nimbra autumn 2026 lineup">
      <div className="stick">
        <canvas className="gl" ref={cv} aria-hidden="true"></canvas>
        <div className="wrap hero-in">
          <p className="eyebrow">Nimbra · Autumn 2026</p>
          <h1 ref={h1} aria-label={HEADLINE}>
            {HEADLINE.split(" ").map((w, i) => (
              <span className="word" key={i} aria-hidden="true">{[...w].map((ch, j) => <span className="ch" key={j}>{ch}</span>)}</span>
            ))}
          </h1>
          <div className="hero-row">
            <p className="lede">A phone with two equal cameras. A laptop that lasts a day and a half. A tablet you can draw on right here. And earbuds that listen first.</p>
            <div className="hero-ctas"><a className="btn btn--solid" href="#buy">Buy</a><a className="btn" href="#pebble">Start the tour</a></div>
          </div>
        </div>
        <div className="scroll-hint" aria-hidden="true"></div>
      </div>
    </section>
  );
}

/* ============ Pebble 2 (phone) ============ */
const LAYERS = [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6];
function StatusIcons() {
  return (
    <svg className="status-ic" viewBox="0 0 44 12" aria-hidden="true">
      <rect x="0" y="8" width="2.6" height="4" rx=".6" fill="currentColor" /><rect x="4" y="5.5" width="2.6" height="6.5" rx=".6" fill="currentColor" />
      <rect x="8" y="3" width="2.6" height="9" rx=".6" fill="currentColor" /><rect x="12" y="0.5" width="2.6" height="11.5" rx=".6" fill="currentColor" opacity=".4" />
      <rect x="20.5" y="1.5" width="19" height="9" rx="2.6" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".6" />
      <rect x="22.3" y="3.3" width="12" height="5.4" rx="1.4" fill="currentColor" /><rect x="40.8" y="4.3" width="1.6" height="3.4" rx=".8" fill="currentColor" opacity=".6" />
    </svg>
  );
}
function Phone({ finish, innerRef }) {
  const now = useClock();
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M/i, "");
  const date = now.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="phone" ref={innerRef} style={{ "--finish": finish }} role="img" aria-label="Pebble 2 phone, turning as you scroll">
      {LAYERS.map(z => <span className="pl" key={z} style={{ transform: `translateZ(${z}px)`, "--lt": z === 0 ? 1 : 0 }}></span>)}
      <span className="pbtn" style={{ top: "21%", height: "7%" }}></span>
      <span className="pbtn" style={{ top: "31%", height: "12%" }}></span>
      <div className="pf pf-front">
        <div className="screen">
          <div className="wall"></div>
          <div className="status"><span>Nimbra</span><StatusIcons /></div>
          <span className="punch"></span>
          <div className="clock">{time}</div>
          <div className="date">{date}</div>
          <div className="notif">
            <span className="notif-ic"></span>
            <span className="notif-t"><b>Photos</b><span>Your October album is ready</span></span>
            <span className="notif-when">now</span>
          </div>
          <div className="widgets">
            <div className="wd"><b>2 days</b><span>battery left</span></div>
            <div className="wd"><b>48 + 48</b><span>megapixels</span></div>
          </div>
        </div>
        <span className="glass"></span>
      </div>
      <div className="pf pf-back">
        <div className="cam">
          <span className="lens"></span><span className="lens"></span>
          <span className="flash"></span><span className="mic"></span>
        </div>
        <span className="engrave">48 MP · 48 MP 5×</span>
        <span className="back-mark"><Mark size={24} /></span>
        <span className="glass"></span>
      </div>
    </div>
  );
}

function PebbleScene() {
  const sec = useRef(null), phone = useRef(null), caps = useRef([]);
  const finishes = PRODUCTS.pebble.finishes;
  const [fi, setFi] = useState(0);
  useFrame(
    () => measure(sec.current),
    ({ p }) => {
      if (!phone.current) return;
      const a = ease(seg(p, 0.02, 0.42)), b = seg(p, 0.42, 0.66), c = ease(seg(p, 0.66, 0.96));
      const ry = -22 + a * 202 + c * 160;
      const lift = Math.sin(b * Math.PI);
      phone.current.style.transform = `rotateX(${(lift * 12).toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) scale(${(1 + lift * 0.16).toFixed(3)})`;
      phone.current.style.setProperty("--gx", (((ry % 360) + 360) % 360 / 360 * 160 - 30).toFixed(1) + "%");
      const ranges = [[-0.2, 0.36], [0.34, 0.68], [0.66, 1.2]];
      caps.current.forEach((n, i) => {
        if (!n) return;
        const o = fadeWin(p, ranges[i][0], ranges[i][1]);
        n.style.opacity = o.toFixed(3);
        n.style.transform = `translate3d(0,${((1 - o) * 26).toFixed(1)}px,0)`;
        n.style.visibility = o < 0.02 ? "hidden" : "visible";
      });
    }
  );
  return (
    <section className="scene" ref={sec} data-scene="ember" id="pebble" style={{ height: "430vh" }}>
      <div className="stick">
        <div className="wrap split">
          <div className="caps">
            <div className="cap" ref={n => (caps.current[0] = n)}>
              <p className="eyebrow">Pebble 2 · Phone</p>
              <h2 className="h2">Small enough for one hand. Again.</h2>
              <p className="lede">A 6.3-inch display in a body 2 mm narrower than last year, with the edges rounded where your fingers actually rest.</p>
            </div>
            <div className="cap" ref={n => (caps.current[1] = n)}>
              <p className="eyebrow">Camera</p>
              <h2 className="h2">Two cameras. Both 48 megapixels.</h2>
              <p className="lede">The main and the 5× telephoto share the same sensor, so a zoomed shot looks like it came from the main camera, not a smaller second one.</p>
            </div>
            <div className="cap" ref={n => (caps.current[2] = n)}>
              <p className="eyebrow">Battery and finish</p>
              <h2 className="h2">31 hours of video. Four finishes.</h2>
              <p className="lede">Recycled aluminium in Basalt, Tide, Clay and Frost. Pick one below and the phone changes. From $799.</p>
            </div>
          </div>
          <div className="stage3d">
            <div className="floor-glow" aria-hidden="true"></div>
            <Phone finish={finishes[fi][1]} innerRef={phone} />
            <div className="swatches" role="group" aria-label="Pebble 2 finish">
              {finishes.map(([n, c], i) => <button key={n} className="sw" style={{ "--c": c }} aria-pressed={fi === i} aria-label={n} onClick={() => setFi(i)}></button>)}
              <span className="sw-name">{finishes[fi][0]}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============ kinetic type ============ */
const KIN = ["Lighter than last year", "Brighter than it needs to be", "Lasts longer than your day"];
function Kinetic() {
  const sec = useRef(null), lines = useRef([]), letters = useRef([]), cache = useRef([]);
  useEffect(() => { letters.current = lines.current.map(l => [...l.querySelectorAll(".k")]); }, []);
  useFrame(
    () => measure(sec.current),
    ({ p }) => {
      lines.current.forEach((ln, i) => {
        const x = i % 2 ? -48 + p * 40 : -p * 42;
        ln.style.transform = `translate3d(${x.toFixed(2)}%,0,0)`;
        const c = cache.current[i] || (cache.current[i] = []);
        letters.current[i].forEach((s, j) => {
          const w = q(480 + 320 * Math.sin(j * 0.33 + p * 13 + i * 1.7), 40);
          const wd = q(88 + 12 * Math.cos(j * 0.27 + p * 9 + i), 4);
          const key = w * 1000 + wd;
          if (c[j] !== key) { c[j] = key; s.style.fontVariationSettings = `"wght" ${w}, "wdth" ${wd}, "opsz" 96`; }
        });
      });
    }
  );
  return (
    <section className="scene kinetic" ref={sec} data-scene="night" aria-label="Lighter than last year. Brighter than it needs to be. Lasts longer than your day.">
      <div className="stick">
        <div className="kin-stage" aria-hidden="true">
          {KIN.map((t, i) => (
            <div className="kin-line" key={t} ref={n => (lines.current[i] = n)}>
              {[0, 1].map(r => (
                <React.Fragment key={r}>
                  {[...t].map((ch, j) => <span className="k" key={j}>{ch === " " ? " " : ch}</span>)}
                  <span className="dot"></span>
                </React.Fragment>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ============ Atlas 14 (laptop) ============ */
const KB_ROWS = [
  Array(14).fill(1),
  [...Array(13).fill(1), 1.5],
  [1.5, ...Array(13).fill(1)],
  [1.8, ...Array(11).fill(1), 1.7],
  [2.3, ...Array(10).fill(1), 2.2],
  [1, 1, 1, 1.3, 4.9, 1.3, 1, 1, 1, 1],
];
const HIST = [3, 5, 8, 12, 18, 26, 34, 40, 44, 41, 36, 30, 27, 29, 34, 42, 50, 46, 35, 22, 14, 9, 6, 4];
function StudioApp({ time }) {
  return (
    <div className="studio">
      <div className="menubar"><Mark size={10} /><b>Studio</b><span>File</span><span>Edit</span><span>Image</span><span className="mb-r">{time}</span></div>
      <div className="st-body">
        <aside className="st-side">
          <span className="st-label">October</span>
          {["a", "b", "c", "d", "e"].map((k, i) => <span key={k} className={"thumb thumb--" + k + (i === 0 ? " on" : "")}></span>)}
        </aside>
        <div className="st-photo">
          <span className="sun"></span><span className="ridge ridge--1"></span><span className="ridge ridge--2"></span><span className="ridge ridge--3"></span><span className="water"></span>
          <span className="st-cap">IMG_2026_1031 · 48 MP · ƒ/1.8</span>
        </div>
        <aside className="st-panel">
          <span className="st-label">Histogram</span>
          <div className="hist">{HIST.map((h, i) => <i key={i} style={{ height: h * 2 + "%" }}></i>)}</div>
          {[["Exposure", 58], ["Warmth", 72], ["Shadows", 34], ["Grain", 18]].map(([n, v]) => (
            <div className="st-slider" key={n}><span>{n}</span><span className="track"><i style={{ width: v + "%" }}></i></span></div>
          ))}
        </aside>
      </div>
    </div>
  );
}

function AtlasScene() {
  const sec = useRef(null), lid = useRef(null), glow = useRef(null), caps = useRef([]), nums = useRef([]);
  const now = useClock();
  const STATS = [[22, 0, " h", "video playback"], [1.19, 2, " kg", "weight"], [14.2, 1, " in", "display"], [1000, 0, "", "nits sustained"]];
  useFrame(
    () => measure(sec.current),
    ({ p }) => {
      if (!lid.current) return;
      const open = ease(seg(p, 0.12, 0.5));
      lid.current.style.transform = `rotateX(${(-88 + open * 96).toFixed(2)}deg)`;
      glow.current.style.opacity = seg(p, 0.38, 0.52).toFixed(3);
      const ranges = [[-0.2, 0.38], [0.36, 0.7], [0.68, 1.2]];
      caps.current.forEach((n, i) => {
        if (!n) return;
        const o = fadeWin(p, ranges[i][0], ranges[i][1]);
        n.style.opacity = o.toFixed(3);
        n.style.transform = `translate3d(0,${((1 - o) * 22).toFixed(1)}px,0)`;
        n.style.visibility = o < 0.02 ? "hidden" : "visible";
      });
      const k = ease(seg(p, 0.7, 0.88));
      nums.current.forEach((n, i) => {
        if (!n) return;
        const [v, dp, unit] = STATS[i];
        const t = (v * k).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp }) + unit;
        if (n.textContent !== t) n.textContent = t;
      });
    }
  );
  return (
    <section className="scene atlas" ref={sec} data-scene="graphite" id="atlas">
      <div className="stick">
        <div className="wrap lap-split">
          <div className="lap-caps">
            <div className="cap" ref={n => (caps.current[0] = n)}>
              <p className="eyebrow">Atlas 14 · Laptop</p>
              <h2 className="h2">Closed, it's 11 millimetres.</h2>
              <p className="lede">Keep scrolling to open it.</p>
            </div>
            <div className="cap" ref={n => (caps.current[1] = n)}>
              <p className="eyebrow">Display</p>
              <h2 className="h2">14.2 inches of mini-LED.</h2>
              <p className="lede">1,000 nits sustained and 1,600 at peak for HDR, with an optional matte finish for bright rooms.</p>
            </div>
            <div className="cap" ref={n => (caps.current[2] = n)}>
              <p className="eyebrow">Battery · from $1,299</p>
              <div className="stats">{STATS.map((s, i) => <div className="stat" key={s[3]}><b ref={n => (nums.current[i] = n)}>0</b><span>{s[3]}</span></div>)}</div>
            </div>
          </div>
          <div className="lap-stage">
            <div className="lap" role="img" aria-label="Atlas 14 laptop, opening as you scroll">
              <div className="lid" ref={lid}>
                <span className="lid-layer" style={{ transform: "translateZ(-1px)" }}></span>
                <span className="lid-layer" style={{ transform: "translateZ(0px)" }}></span>
                <span className="lid-layer" style={{ transform: "translateZ(1px)" }}></span>
                <div className="lid-f">
                  <span className="webcam"></span>
                  <div className="lscreen">
                    <div className="lscreen-on" ref={glow}><StudioApp time={now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} /></div>
                  </div>
                  <span className="glass"></span>
                </div>
                <div className="lid-b"><span className="lid-mark"><Mark size={46} /></span></div>
              </div>
              <div className="deck">
                <span className="floor"></span>
                <span className="hinge"></span>
                <span className="grille grille--l"></span><span className="grille grille--r"></span>
                <div className="kb">
                  {KB_ROWS.map((row, r) => (
                    <div className={"kb-row" + (r === 0 ? " kb-fn" : "")} key={r}>
                      {row.map((w, i) => <i key={i} style={{ flexGrow: w }}></i>)}
                    </div>
                  ))}
                </div>
                <span className="pad"></span>
                <span className="lip"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============ Canvas 11 (tablet you can draw on) ============ */
const INKS = [["Ink", "#1E2126"], ["Ember", "#E8643F"], ["Tide", "#3F74A8"], ["Moss", "#5E8A4F"]];
const SIZES = [["Fine", 2.5], ["Medium", 5], ["Bold", 10]];
const PAPERS = [["Paper", "paper"], ["Grid", "grid"], ["Slate", "slate"]];

function seedStrokes() {
  const wave = { color: "#3F74A8", size: 5, erase: false, pts: [] };
  for (let i = 0; i <= 60; i++) { const t = i / 60; wave.pts.push([0.12 + t * 0.5, 0.62 + Math.sin(t * Math.PI * 3) * 0.08, 0.3 + 0.6 * Math.sin(t * Math.PI)]); }
  const loop = { color: "#E8643F", size: 4, erase: false, pts: [] };
  for (let i = 0; i <= 90; i++) { const t = i / 90, a = t * Math.PI * 2 * 1.15; loop.pts.push([0.75 + Math.cos(a) * 0.09 * (1 - t * 0.25), 0.4 + Math.sin(a) * 0.13 * (1 - t * 0.25), 0.4 + 0.5 * t]); }
  return [wave, loop];
}
function drawStroke(ctx, s, w, h, from = 1) {
  const pts = s.pts;
  ctx.globalCompositeOperation = s.erase ? "destination-out" : "source-over";
  ctx.strokeStyle = s.color; ctx.lineCap = "round"; ctx.lineJoin = "round";
  if (pts.length === 1) {
    ctx.beginPath(); ctx.arc(pts[0][0] * w, pts[0][1] * h, s.size * 0.6, 0, Math.PI * 2);
    ctx.fillStyle = s.color; ctx.fill(); ctx.globalCompositeOperation = "source-over"; return;
  }
  for (let i = Math.max(1, from); i < pts.length; i++) {
    const [x0, y0, p0] = pts[i - 1], [x1, y1, p1] = pts[i];
    const prev = pts[i - 2] || pts[i - 1];
    ctx.lineWidth = s.size * (s.erase ? 3 : 0.35 + ((p0 + p1) / 2) * 1.3);
    ctx.beginPath();
    ctx.moveTo(((prev[0] + x0) / 2) * w, ((prev[1] + y0) / 2) * h);
    ctx.quadraticCurveTo(x0 * w, y0 * h, ((x0 + x1) / 2) * w, ((y0 + y1) / 2) * h);
    ctx.stroke();
  }
  ctx.globalCompositeOperation = "source-over";
}

function CanvasScene() {
  const sec = useRef(null), tablet = useRef(null), cv = useRef(null);
  const strokes = useRef(seedStrokes()), live = useRef(null);
  const [ink, setInk] = useState(1);
  const [size, setSize] = useState(1);
  const [erase, setErase] = useState(false);
  const [paper, setPaper] = useState(0);
  const [touched, setTouched] = useState(false);
  const [count, setCount] = useState(2);

  const redraw = useCallback(() => {
    const c = cv.current; if (!c) return;
    const ctx = c.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const d = c.width / c.clientWidth;
    ctx.scale(d, d);
    strokes.current.forEach(s => drawStroke(ctx, s, c.clientWidth, c.clientHeight));
  }, []);
  useEffect(() => {
    const c = cv.current;
    const fit = () => { const d = Math.min(window.devicePixelRatio || 1, 2); c.width = c.clientWidth * d; c.height = c.clientHeight * d; redraw(); };
    const ro = new ResizeObserver(fit); ro.observe(c); fit();
    return () => ro.disconnect();
  }, [redraw]);
  useFrame(
    () => { const m = measure(sec.current); return m ? ease(clamp((m.vh - m.top) / (m.vh * 0.8))) : SKIP; },
    k => tablet.current && tablet.current.style.setProperty("--in", k.toFixed(3))
  );

  function pt(e) {
    const r = cv.current.getBoundingClientRect();
    const pressure = e.pointerType === "pen" ? e.pressure : e.pressure > 0 && e.pressure !== 0.5 ? e.pressure : 0.55;
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, pressure];
  }
  function down(e) {
    cv.current.setPointerCapture(e.pointerId);
    const s = { color: INKS[ink][1], size: SIZES[size][1], erase, pts: [pt(e)] };
    strokes.current.push(s); live.current = s;
    if (!touched) setTouched(true);
    drawStroke(cv.current.getContext("2d"), s, cv.current.clientWidth, cv.current.clientHeight);
  }
  function move(e) {
    const s = live.current; if (!s) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const before = s.pts.length;
    events.forEach(ev => s.pts.push(pt(ev)));
    drawStroke(cv.current.getContext("2d"), s, cv.current.clientWidth, cv.current.clientHeight, before);
  }
  function up() { if (live.current) { live.current = null; setCount(strokes.current.length); } }
  function undo() { strokes.current.pop(); setCount(strokes.current.length); redraw(); }
  function clear() { strokes.current = []; setCount(0); redraw(); }

  return (
    <section className="canvas-sec" ref={sec} data-scene="moss" id="canvas">
      <div className="wrap">
        <div className="tab-head">
          <div><p className="eyebrow">Canvas 11 · Tablet</p><h2 className="h2">Go on, draw on it.</h2></div>
          <p className="lede">Paper-matte glass and a stylus with 4,096 pressure levels. Here your mouse, finger or pen stands in for the stylus. If your device reports pressure, line weight follows it.</p>
        </div>
        <div className="tablet-wrap">
          <div className="tablet" ref={tablet}>
            <span className="tab-cam"></span>
            <div className={"tab-screen " + PAPERS[paper][1] + (PAPERS[paper][1] === "slate" ? " slate-bg" : "")}>
              <canvas ref={cv} className="pad-canvas" aria-label="Drawing area" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}></canvas>
              <span className="pad-hint" style={{ opacity: touched ? 0 : 1 }}>Draw anywhere on the screen</span>
            </div>
            <span className="stylus" aria-hidden="true"><i style={{ background: erase ? "#ddd" : INKS[ink][1] }}></i></span>
          </div>
        </div>
        <div className="tools">
          <div className="tool-group" role="group" aria-label="Ink colour">
            <span className="label">Ink</span>
            {INKS.map(([n, c], i) => <button key={n} className="sw" style={{ "--c": c }} aria-label={n} aria-pressed={!erase && ink === i} onClick={() => { setInk(i); setErase(false); }}></button>)}
          </div>
          <div className="tool-group" role="group" aria-label="Brush size">
            <span className="label">Size</span>
            {SIZES.map(([n, s], i) => (
              <button key={n} className="opt" aria-label={n} aria-pressed={size === i} onClick={() => setSize(i)} style={{ width: 40, padding: 0 }}>
                <span className="size-dot" style={{ width: s + 3, height: s + 3 }}></span>
              </button>
            ))}
          </div>
          <div className="tool-group">
            <button className="opt" aria-pressed={erase} onClick={() => setErase(v => !v)}>Eraser</button>
            <button className="opt" onClick={undo} disabled={!count}>Undo</button>
            <button className="opt" onClick={clear} disabled={!count}>Clear</button>
          </div>
          <div className="tool-group" role="group" aria-label="Background">
            <span className="label">Page</span>
            {PAPERS.map(([n], i) => <button key={n} className="opt" aria-pressed={paper === i} onClick={() => setPaper(i)}>{n}</button>)}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============ Orbit (earbuds): before/after waveforms ============ */
function noiseAt(x, t) {
  return Math.sin(x * 0.11 + t * 3.1) * 0.35 + Math.sin(x * 0.37 - t * 5.3) * 0.25 + Math.sin(x * 0.83 + t * 9.7) * 0.18
    + Math.sin(x * 1.91 - t * 13.1) * 0.12 + (Math.sin(x * 12.9898 + Math.floor(t * 30) * 78.233) * 43758.5453 % 1) * 0.22;
}
function voiceAt(x, t) {
  const env = Math.max(0, Math.sin(x * 0.018 - t * 1.6)) ** 2 * (0.55 + 0.45 * Math.sin(x * 0.05 - t * 2.2));
  return env * Math.sin(x * 0.42 - t * 11) * 0.85;
}
function Waves({ level }) {
  const cv = useRef(null), lv = useRef(level), drawRef = useRef(null);
  lv.current = level;
  useEffect(() => {
    const c = cv.current, ctx = c.getContext("2d");
    let raf = 0, vis = false, calm = lv.current / 100;
    const fit = () => { const d = Math.min(window.devicePixelRatio || 1, 2); c.width = c.clientWidth * d; c.height = c.clientHeight * d; };
    function lane(y0, hh, fn, color, width) {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      for (let x = 0; x <= c.width; x += 3) { const v = fn(x); x ? ctx.lineTo(x, y0 + v * hh) : ctx.moveTo(x, y0 + v * hh); }
      ctx.stroke();
    }
    function draw(t, snap) {
      calm = snap ? lv.current / 100 : calm + (lv.current / 100 - calm) * 0.12;
      const w = c.width, h = c.height, d = w / c.clientWidth, s = t / 1000;
      ctx.clearRect(0, 0, w, h);
      const amp = h * 0.16, y1 = h * 0.27, y2 = h * 0.76;
      ctx.globalAlpha = 0.25; ctx.strokeStyle = "#F3EFE7"; ctx.lineWidth = d;
      [y1, y2].forEach(y => { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); });
      ctx.globalAlpha = 1;
      const X = x => x / d;
      lane(y1, amp, x => noiseAt(X(x), s) * 0.8 + voiceAt(X(x), s) * 0.5, "rgba(255,139,102,.9)", 1.6 * d);
      const keep = Math.pow(1 - calm, 1.6);
      lane(y2, amp, x => noiseAt(X(x), s) * 0.8 * keep, "rgba(255,139,102,.55)", 1.2 * d);
      lane(y2, amp, x => voiceAt(X(x), s) * 0.9 + noiseAt(X(x), s) * 0.8 * keep, "#A9C4FF", 2 * d);
    }
    drawRef.current = draw;
    function loop(t) { draw(t); if (vis && !REDUCED) raf = requestAnimationFrame(loop); }
    const io = new IntersectionObserver(([e]) => { vis = e.isIntersecting; cancelAnimationFrame(raf); if (vis && !REDUCED) raf = requestAnimationFrame(loop); });
    io.observe(c);
    const ro = new ResizeObserver(() => { fit(); draw(performance.now(), true); }); ro.observe(c);
    fit(); draw(performance.now(), true);
    return () => { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); };
  }, []);
  useEffect(() => { if (REDUCED && drawRef.current) drawRef.current(4000, true); }, [level]);
  return <canvas ref={cv} className="waves" aria-hidden="true"></canvas>;
}

function OrbitScene() {
  const [level, setLevel] = useState(70);
  const [color, setColor] = useState(0);
  const mode = level < 15 ? "Off" : level < 75 ? "Adaptive" : "Full";
  const db = Math.round(level * 0.42);
  const fin = PRODUCTS.orbit.finishes;
  return (
    <section className="orbit-sec" data-scene="night" id="orbit">
      <div className="wrap orbit-grid">
        <div>
          <p className="eyebrow">Orbit · Earbuds · $179</p>
          <h2 className="h2">Noise control that listens first.</h2>
          <p className="lede">Six microphones sample the room 48,000 times a second and cancel only the noise, so a voice calling your name still gets through. Drag the slider and watch what reaches your ear.</p>
          <div className="slider-box">
            <label htmlFor="anc">Noise control <output htmlFor="anc">{mode} · −{db} dB</output></label>
            <input id="anc" type="range" min="0" max="100" value={level} onChange={e => setLevel(+e.target.value)} style={{ "--v": level + "%" }} />
            <div className="ticks" aria-hidden="true"><span>Off</span><span>Adaptive</span><span>Full</span></div>
          </div>
          <div className="opts" role="group" aria-label="Orbit finish" style={{ marginTop: 24 }}>
            {fin.map(([n, c], i) => <button key={n} className="opt" aria-pressed={color === i} onClick={() => setColor(i)}><span className="dotc" style={{ background: c }}></span>{n}</button>)}
          </div>
        </div>
        <div className="orbit-card">
          <div className="buds-stage" aria-hidden="true">
            <Bud color={fin[color][1]} side="l" /><Bud color={fin[color][1]} side="r" />
            <span className="case" style={{ "--c": fin[color][1] }}><span className="case-led" style={{ opacity: 0.3 + level / 140 }}></span></span>
          </div>
          <div className="wave-box">
            <span className="wave-lbl wave-lbl--a">Around you <b>traffic, wind, a voice</b></span>
            <span className="wave-lbl wave-lbl--b">In your ear <b>{level < 15 ? "everything" : level < 75 ? "the voice, most noise removed" : "the voice only"}</b></span>
            <Waves level={level} />
          </div>
          <p className="sr" aria-live="polite">Noise control {mode}, reducing outside noise by {db} decibels.</p>
        </div>
      </div>
    </section>
  );
}

/* ============ lineup (horizontal scroll) ============ */
function Lineup({ onCompare }) {
  const sec = useRef(null), track = useRef(null), view = useRef(null);
  useFrame(
    () => { const m = measure(sec.current); if (!m || !track.current) return SKIP; return { p: m.p, max: Math.max(0, track.current.scrollWidth - view.current.clientWidth) }; },
    ({ p, max }) => { track.current.style.transform = `translate3d(${(-ease(p) * max).toFixed(1)}px,0,0)`; }
  );
  return (
    <section className="scene lineup" ref={sec} data-scene="dusk" id="lineup">
      <div className="stick">
        <div className="line-stage">
          <div className="wrap"><p className="eyebrow">The lineup</p><h2 className="h2" style={{ marginBottom: 0 }}>Five devices. One charger.</h2></div>
          <div className="track-view" ref={view}>
            <div className="track" ref={track}>
              {ORDER.map(id => {
                const p = PRODUCTS[id];
                return (
                  <article className="card" key={id} style={{ "--c": p.finishes[0][1] }}>
                    <div className="card-art"><Mini id={id} /></div>
                    <div className="card-body">
                      <p className="eyebrow">{p.kind}</p>
                      <h3>{p.name}</h3>
                      <p>{p.line}</p>
                      <div className="card-row"><span className="price">From {money(p.price)}</span><button className="opt" onClick={() => onCompare(id)}>Compare</button></div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============ compare ============ */
function Compare({ pair, setPair }) {
  const [a, b] = pair;
  const keys = Object.keys(PRODUCTS[a].specs);
  const pick = (i, v) => setPair(p => (i === 0 ? [v, p[1]] : [p[0], v]));
  return (
    <section className="plain" data-scene="dusk" id="compare">
      <div className="wrap">
        <p className="eyebrow">Compare</p>
        <h2 className="h2">Put any two side by side.</h2>
        <p className="lede">Rows that differ stay bright. Rows that match fade back.</p>
        <div className="cmp-pick">
          {[a, b].map((id, i) => (
            <div className="select" key={i}>
              <label className="sr" htmlFor={"cmp-" + i}>{i ? "Second" : "First"} device</label>
              <select id={"cmp-" + i} value={id} onChange={e => pick(i, e.target.value)}>
                {ORDER.map(o => <option key={o} value={o}>{PRODUCTS[o].name} · {PRODUCTS[o].kind}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="cmp-tbl">
          <div className="cmp-arts" aria-hidden="true"><div></div><div><Mini id={a} /></div><div><Mini id={b} /></div></div>
          <table>
            <caption className="sr">{PRODUCTS[a].name} compared with {PRODUCTS[b].name}</caption>
            <tbody>
              <tr className={PRODUCTS[a].price !== PRODUCTS[b].price ? "diff" : ""}><th scope="row">Price</th><td>From {money(PRODUCTS[a].price)}</td><td>From {money(PRODUCTS[b].price)}</td></tr>
              {keys.map(k => { const va = PRODUCTS[a].specs[k], vb = PRODUCTS[b].specs[k]; return <tr key={k} className={va !== vb ? "diff" : ""}><th scope="row">{k}</th><td>{va}</td><td>{vb}</td></tr>; })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

/* ============ buy (maths in WebAssembly) ============ */
const PLANS = [["full", "Pay in full", 1, 0], ["12", "12 months at 0% APR", 12, 0], ["24", "24 months at 6.9% APR", 24, 0.069]];
function Buy({ onAdd }) {
  const [id, setId] = useState("pebble");
  const [st, setSt] = useState(0);
  const [fi, setFi] = useState(0);
  const [plan, setPlan] = useState(1);
  const p = PRODUCTS[id];
  const total = p.price + p.storage[Math.min(st, p.storage.length - 1)][1];
  const [, label, n, apr] = PLANS[plan];
  const per = n === 1 ? total : monthly(total, n, apr);
  const color = p.finishes[Math.min(fi, p.finishes.length - 1)];
  function choose(next) { setId(next); setSt(0); setFi(0); }
  return (
    <section className="plain" data-scene="dusk" id="buy">
      <div className="wrap">
        <p className="eyebrow">Buy</p>
        <h2 className="h2">Make it yours.</h2>
        <div className="buy">
          <div className="buy-art" style={{ "--c": color[1] }} aria-hidden="true"><div className="card-art"><Mini id={id} color={color[1]} /></div></div>
          <div className="steps">
            <div className="step"><h3>Device</h3>
              <div className="opts" role="group" aria-label="Device">{ORDER.map(o => <button key={o} className="opt" aria-pressed={id === o} onClick={() => choose(o)}>{PRODUCTS[o].name}</button>)}</div>
            </div>
            <div className="step"><h3>Finish <span>· {color[0]}</span></h3>
              <div className="opts" role="group" aria-label="Finish">{p.finishes.map(([nm, c], i) => <button key={nm} className="sw" style={{ "--c": c, width: 34, height: 34 }} aria-label={nm} aria-pressed={fi === i} onClick={() => setFi(i)}></button>)}</div>
            </div>
            {p.storage.length > 1 && (
              <div className="step"><h3>{id === "loop" ? "Case size" : "Storage"}</h3>
                <div className="opts" role="group" aria-label="Storage">{p.storage.map(([nm, add], i) => <button key={nm} className="opt" aria-pressed={st === i} onClick={() => setSt(i)}>{nm}{add ? <small>+{money(add)}</small> : null}</button>)}</div>
              </div>
            )}
            <div className="step"><h3>Payment</h3>
              <div className="plan" role="group" aria-label="Payment">
                {PLANS.map(([k, lbl, months, r], i) => (
                  <button key={k} className="opt" aria-pressed={plan === i} onClick={() => setPlan(i)}>
                    <b>{lbl}</b><span>{months === 1 ? money(total) : money(Math.round(monthly(total, months, r) * 100) / 100) + "/mo"}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="total">
              <div>
                <small>{n === 1 ? "Total" : label}</small>
                <b aria-live="polite">{n === 1 ? money(total) : money(Math.round(per * 100) / 100) + "/mo"}</b>
                {n > 1 && <small>{money(Math.round(per * n * 100) / 100)} in total</small>}
                <div><span className="wasm-chip"><i></i>{wasmMonthly ? "Instalments computed in WebAssembly" : "Instalments computed in JavaScript"}</span></div>
              </div>
              <button className="btn btn--solid" onClick={() => onAdd(`${p.name}, ${color[0]}`)}>Add to bag</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============ how it's built ============ */
const LANGS = [
  ["HTML", "The structure: every section, heading, button and label, with ARIA roles so screen readers can follow the 3D scenes.", `<section id="pebble" data-scene="ember">`],
  ["CSS", "The 3D. The phone is 13 stacked layers that form a solid body; the laptop lid hinges with rotateX. Animated colour tokens fade the page between scenes.", `@property --bg { syntax: "<color>"; }\ntransform: rotateX(-88deg);`],
  ["JavaScript", "A smooth scroller eases mouse-wheel jumps, and one frame loop reads all positions first, then writes, so layout runs once per frame.", `const data = subs.map(s => s.read());\nsubs.forEach((s, i) => s.write(data[i]));`],
  ["React (JSX)", "Components and state: finishes, compare pairs, the bag. Compiled ahead of time, then inlined so the file needs no build tools.", `const [fi, setFi] = useState(0);`],
  ["GLSL", "A fragment shader on your graphics card paints the moving light behind the headline, and lowers its own resolution on slow machines.", `vec2 q = vec2(fbm(p + t),\n  fbm(p + vec2(5.2, 1.3) - t));`],
  ["WebAssembly", "The instalment maths, written in WebAssembly text format and compiled to a 156-byte binary stored inside the page.", `(f64.mul (local.get $f)\n  (f64.add (f64.const 1) (local.get $r)))`],
  ["SVG", "The Nimbra mark and the phone's status icons, crisp at any size.", `<ellipse rx="10.4" ry="4.4"\n  transform="rotate(-28 12 12)"/>`],
  ["Canvas 2D", "The tablet's pressure-aware drawing surface and the earbud waveforms, drawn pixel by pixel.", `ctx.quadraticCurveTo(x0, y0,\n  (x0 + x1) / 2, (y0 + y1) / 2);`],
];
function Built() {
  return (
    <section className="plain" data-scene="night" id="built">
      <div className="wrap">
        <p className="eyebrow">How it's built</p>
        <h2 className="h2">Eight languages, one file.</h2>
        <p className="lede">Everything on this page ships inside a single HTML file. Save it, open it offline, and it still works.</p>
        <div className="langs">{LANGS.map(([n, d, code]) => <div className="lang" key={n}><h3>{n}</h3><p>{d}</p><code>{code}</code></div>)}</div>
        <p className="note">Languages like Python, PHP or Java run on servers, so they can't live inside one HTML file. A browser runs HTML, CSS, JavaScript, GLSL on the GPU, and WebAssembly. Anything else, such as C, C++ or Rust, reaches the browser by compiling to WebAssembly.</p>
      </div>
    </section>
  );
}

/* ============ app ============ */
function App() {
  const [bag, setBag] = useState(0);
  const [pair, setPair] = useState(["pebble", "canvas"]);
  const [toasts, setToasts] = useState([]);
  const toast = useCallback(msg => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, msg }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3600);
  }, []);
  useEffect(() => {
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) document.documentElement.dataset.scene = e.target.dataset.scene; }), { rootMargin: "-50% 0px -50% 0px" });
    document.querySelectorAll("[data-scene]").forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);
  function compareWith(id) {
    setPair(([a, b]) => (id === a ? [a, b] : [a, id]));
    goTo("compare");
  }
  return (
    <>
      <Header bag={bag} />
      <main>
        <Hero />
        <PebbleScene />
        <Kinetic />
        <AtlasScene />
        <CanvasScene />
        <OrbitScene />
        <Lineup onCompare={compareWith} />
        <Compare pair={pair} setPair={setPair} />
        <Buy onAdd={label => { setBag(b => b + 1); toast(`Added ${label} to your bag. This is a sample store, so nothing is charged.`); }} />
        <Built />
      </main>
      <footer className="ftr">
        <div className="wrap ftr-in">
          <span className="brand" style={{ fontSize: 16 }}><Mark size={18} />Nimbra</span>
          <span>Nimbra is a fictional brand. Every product, spec and price here is invented for this front-end design sample.</span>
        </div>
      </footer>
      <div className="toasts" aria-live="polite">{toasts.map(t => <div className="toast" key={t.id}>{t.msg}</div>)}</div>
    </>
  );
}

document.documentElement.dataset.scene = "night";
ReactDOM.createRoot(document.getElementById("root")).render(<App />);
