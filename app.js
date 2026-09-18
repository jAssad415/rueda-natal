import { I18N, SHORT_EN, SHORT_ES, SPANISH_COUNTRIES, NAME_EN_FIX } from "./i18n.js";

const canvas = document.getElementById("wheel");
const ctx = canvas.getContext("2d");
const fxCanvas = document.getElementById("fx");
const fxCtx = fxCanvas.getContext("2d");
const spinBtn = document.getElementById("spin");
const resultEl = document.getElementById("result");
const rankingEl = document.getElementById("ranking");
const searchEl = document.getElementById("search");
const statsEl = document.getElementById("stats");
const methodEl = document.getElementById("method");
const hintEl = document.getElementById("hint");
const hubKickerEl = document.getElementById("hub-kicker");
const hubLabelEl = document.getElementById("hub-label");

const LANG_KEY = "birth-wheel-lang";
let lang = "en";
let resultRevealed = false;

function t(path, vars) {
  const value = path.split(".").reduce((obj, key) => obj?.[key], I18N[lang]);
  if (typeof value !== "string") return path;
  return value.replace(/\{(\w+)\}/g, (_, key) => vars?.[key] ?? "");
}

function locale() {
  return lang === "es" ? "es" : "en";
}

function countryName(country) {
  if (lang === "en") {
    const raw = country.nameEn || country.name;
    return NAME_EN_FIX[raw] || raw;
  }
  return country.name;
}

async function detectLang() {
  try {
    const response = await fetch("https://get.geojs.io/v1/ip/country.json", { signal: AbortSignal.timeout(2500) });
    const geo = await response.json();
    const cc = String(geo.country || "").toUpperCase();
    if (SPANISH_COUNTRIES.has(cc)) return "es";
    if (cc) return "en";
  } catch {
    /* fall through */
  }
  return (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
}

function updateLangButtons() {
  for (const btn of document.querySelectorAll(".lang-switch [data-lang]")) {
    btn.setAttribute("aria-pressed", btn.dataset.lang === lang ? "true" : "false");
  }
}

function applyStaticCopy() {
  document.documentElement.lang = lang;
  document.title = t("documentTitle");
  document.getElementById("eyebrow").textContent = t("eyebrow");
  document.getElementById("brand").textContent = t("brand");
  document.getElementById("lede").textContent = t("lede");
  document.getElementById("wheel-panel").setAttribute("aria-label", t("wheelAria"));
  hubKickerEl.textContent = t("hubKicker");
  if (!spinning) {
    hubLabelEl.textContent = winner ? t("hubAgain") : t("hubSpin");
  }
  document.querySelector(".lang-switch").setAttribute("aria-label", t("langLabel"));
  document.getElementById("all-countries").textContent = t("allCountries");
  searchEl.placeholder = t("searchPlaceholder");
  if (spinning) {
    hintEl.textContent = t("hintSpinning");
  } else if (!winner) {
    hintEl.textContent = t("hintIdle");
    resultEl.innerHTML = `
      <p class="result-kicker">${t("resultEmptyKicker")}</p>
      <h2>${t("resultEmptyTitle")}</h2>
      <p class="result-copy">${t("resultEmptyCopy")}</p>
    `;
  }
  updateLangButtons();
}

function setLang(next, persist) {
  if (next !== "en" && next !== "es") return;
  lang = next;
  if (persist) localStorage.setItem(LANG_KEY, next);
  applyStaticCopy();
  if (data) {
    renderMethod();
    renderStats();
    renderRanking(searchEl.value);
    draw(rotation);
  }
  if (winner) renderResult(winner, { revealed: resultRevealed, replay: false });
}

const TWO_PI = Math.PI * 2;
const POINTER = -Math.PI / 2;
const REGION_HUES = {
  "South Asia": 28,
  "East Asia & Pacific": 48,
  "Sub-Saharan Africa ": 12,
  "Middle East, North Africa, Afghanistan & Pakistan": 33,
  "Latin America & Caribbean ": 150,
  "Europe & Central Asia": 210,
  "North America": 265,
};

let data = null;
let slices = [];
let rotation = 0;
let spinning = false;
let winner = null;
let maxBirths = 1;
let revealTimer = 0;
let audioCtx = null;
let rumbleNodes = null;
let modeAudioNodes = [];

function formatDecimal(n, digits) {
  const value = Number(n).toFixed(digits);
  return lang === "es" ? value.replace(".", ",") : value;
}

function formatInt(n) {
  return new Intl.NumberFormat(locale()).format(Math.round(n));
}

function formatPct(p, digits = 2) {
  const pct = p * 100;
  let value;
  if (pct >= 1) value = pct.toFixed(digits);
  else if (pct >= 0.01) value = pct.toFixed(3);
  else if (pct >= 0.0001) value = pct.toFixed(4);
  else value = "0.0001";
  if (lang === "es") value = value.replace(".", ",");
  return pct >= 0.0001 ? `${value}%` : `<${value}%`;
}

function shortName(country) {
  const name = countryName(country);
  const aliases = lang === "en" ? SHORT_EN : SHORT_ES;
  return aliases[name] || name;
}

function difficulty(hdi) {
  if (hdi == null) return null;
  if (hdi >= 0.9) return "easy";
  if (hdi >= 0.7) return "mid";
  if (hdi >= 0.55) return "hard";
  return "nightmare";
}

function modeLabel(mode) {
  return I18N[lang].modes[mode]?.label ?? "";
}

function oneIn(p) {
  return formatInt(1 / p);
}

function hueFor(country, index) {
  const base = REGION_HUES[country.region] ?? (index * 17) % 360;
  return (base + index * 3) % 360;
}

function flagUrl(iso2, w = 80) {
  return `https://flagcdn.com/w${w}/${iso2}.png`;
}

function wrapAngle(a) {
  a %= TWO_PI;
  if (a < 0) a += TWO_PI;
  return a;
}

function ensureAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audioCtx) audioCtx = new AC();
  if (audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}

function noiseBuffer(ctx, seconds) {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) data[i] = Math.random() * 2 - 1;
  return buf;
}

function stopSpinAudio() {
  if (!rumbleNodes) return;
  try { rumbleNodes.noise.stop(); } catch {
    /* already stopped */
  }
  rumbleNodes = null;
}

function startSpinAudio(durationMs) {
  const ctx = ensureAudio();
  if (!ctx) return;
  stopSpinAudio();
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx, 1.1);
  noise.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 380;
  filter.Q.value = 0.65;
  const gain = ctx.createGain();
  const t = ctx.currentTime;
  const dur = durationMs / 1000;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05, t + 0.15);
  gain.gain.exponentialRampToValueAtTime(0.012, t + dur * 0.62);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  noise.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  noise.start();
  rumbleNodes = { noise, gain, filter };
}

function playWheelTick(vol) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  const n = 280;
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 1600 + Math.random() * 1100;
  filter.Q.value = 5.5;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(Math.min(0.24, 0.07 + vol * 0.22), t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.032);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(t);
}

function playWheelStop() {
  stopSpinAudio();
  const ctx = ensureAudio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(210, t);
  osc.frequency.exponentialRampToValueAtTime(52, t + 0.2);
  gain.gain.setValueAtTime(0.14, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.26);
}

function stopModeAudio() {
  for (const node of modeAudioNodes) {
    try { node.stop(); } catch {
      /* already stopped */
    }
  }
  modeAudioNodes = [];
}

function trackAudio(node) {
  modeAudioNodes.push(node);
  return node;
}

function playTone(ctx, { type = "sine", freq, t, dur, vol, attack = 0.012, slide }) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t + dur);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.03);
  trackAudio(osc);
}

function playNoise(ctx, { t, dur, vol, type = "highpass", freq = 1800, q = 0.8, attack = 0.03 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, Math.max(0.25, dur));
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);
  src.start(t);
  src.stop(t + dur + 0.05);
  trackAudio(src);
}

function playEasyFanfare(ctx, t) {
  playNoise(ctx, { t, dur: 0.1, vol: 0.16, type: "highpass", freq: 2600, attack: 0.004 });
  const notes = [523.25, 659.25, 783.99, 1046.5];
  notes.forEach((freq, i) => {
    playTone(ctx, { type: "triangle", freq, t: t + 0.08 + i * 0.09, dur: 0.55, vol: 0.09 });
    playTone(ctx, { type: "sine", freq: freq * 2, t: t + 0.08 + i * 0.09, dur: 0.32, vol: 0.03 });
  });
  playNoise(ctx, { t: t + 0.12, dur: 1.15, vol: 0.055, type: "bandpass", freq: 1700, q: 0.7, attack: 0.05 });
}

function playMidSound(ctx, t) {
  playNoise(ctx, { t, dur: 0.09, vol: 0.08, type: "bandpass", freq: 420, q: 1.2, attack: 0.006 });
  playTone(ctx, { type: "sine", freq: 261.63, t: t + 0.04, dur: 0.7, vol: 0.1 });
  playTone(ctx, { type: "triangle", freq: 392.0, t: t + 0.18, dur: 0.7, vol: 0.07 });
  playTone(ctx, { type: "sine", freq: 329.63, t: t + 0.46, dur: 0.85, vol: 0.06 });
}

function playHardStorm(ctx, t) {
  playNoise(ctx, { t, dur: 2.4, vol: 0.07, type: "highpass", freq: 1600, q: 0.55, attack: 0.12 });
  playNoise(ctx, { t: t + 0.28, dur: 0.9, vol: 0.18, type: "lowpass", freq: 140, q: 0.6, attack: 0.04 });
  playTone(ctx, { type: "sine", freq: 70, t: t + 0.3, dur: 1.1, vol: 0.12, slide: 32 });
  playNoise(ctx, { t: t + 1.15, dur: 0.55, vol: 0.11, type: "lowpass", freq: 90, q: 0.8, attack: 0.02 });
}

function playNightmareSound(ctx, t) {
  const thump = (at) => {
    playTone(ctx, { type: "sine", freq: 88, t: at, dur: 0.22, vol: 0.2, attack: 0.006, slide: 28 });
    playNoise(ctx, { t: at, dur: 0.16, vol: 0.07, type: "lowpass", freq: 90, q: 0.8, attack: 0.004 });
  };
  thump(t);
  thump(t + 0.2);
  thump(t + 0.92);
  thump(t + 1.12);
  playNoise(ctx, { t, dur: 2.6, vol: 0.05, type: "bandpass", freq: 380, q: 0.45, attack: 0.2 });
  playTone(ctx, { type: "sawtooth", freq: 55, t: t + 0.08, dur: 2.2, vol: 0.035, attack: 0.18 });
  playTone(ctx, { type: "sawtooth", freq: 58.7, t: t + 0.08, dur: 2.2, vol: 0.028, attack: 0.18 });
}

function playModeSound(mode) {
  const ctx = ensureAudio();
  if (!ctx || !mode) return;
  stopModeAudio();
  const t = ctx.currentTime + 0.03;
  if (mode === "easy") playEasyFanfare(ctx, t);
  else if (mode === "mid") playMidSound(ctx, t);
  else if (mode === "hard") playHardStorm(ctx, t);
  else if (mode === "nightmare") playNightmareSound(ctx, t);
}

let fxItems = [];
let fxRaf = 0;
let fxUntil = 0;

function resizeFx() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fxCanvas.width = Math.round(window.innerWidth * dpr);
  fxCanvas.height = Math.round(window.innerHeight * dpr);
  fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function stopFx() {
  cancelAnimationFrame(fxRaf);
  fxRaf = 0;
  fxItems = [];
  fxUntil = 0;
  fxCtx.setTransform(1, 0, 0, 1, 0, 0);
  fxCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
  document.body.classList.remove("easy-mode", "mid-mode", "hard-mode", "nightmare-mode");
  resultEl.classList.remove("easy", "mid", "hard", "nightmare");
  stopModeAudio();
}

function tickFx(now) {
  const w = window.innerWidth;
  const h = window.innerHeight;
  fxCtx.clearRect(0, 0, w, h);
  for (const p of fxItems) {
    p.x += p.vx;
    p.y += p.vy;
    p.rot += p.vr || 0;
    if (p.kind === "ribbon") {
      fxCtx.save();
      fxCtx.translate(p.x, p.y);
      fxCtx.rotate(p.rot);
      fxCtx.fillStyle = p.color;
      fxCtx.fillRect(-p.thick / 2, 0, p.thick, p.len);
      fxCtx.restore();
      if (p.y > h + 80) {
        p.y = -p.len;
        p.x = Math.random() * w;
      }
    } else if (p.kind === "bit") {
      fxCtx.save();
      fxCtx.translate(p.x, p.y);
      fxCtx.rotate(p.rot);
      fxCtx.fillStyle = p.color;
      fxCtx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6);
      fxCtx.restore();
      if (p.y > h + 20) {
        p.y = -10;
        p.x = Math.random() * w;
      }
    } else if (p.kind === "rain") {
      fxCtx.strokeStyle = `rgba(160,170,185,${p.a})`;
      fxCtx.lineWidth = 1;
      fxCtx.beginPath();
      fxCtx.moveTo(p.x, p.y);
      fxCtx.lineTo(p.x + p.vx * 3, p.y + p.len);
      fxCtx.stroke();
      if (p.y > h + 20) {
        p.y = -20;
        p.x = Math.random() * w;
      }
    } else {
      const shade = document.body.classList.contains("nightmare-mode")
        ? `rgba(38,32,26,${p.a})`
        : `rgba(180,170,160,${p.a})`;
      fxCtx.fillStyle = shade;
      fxCtx.beginPath();
      fxCtx.arc(p.x, p.y, p.s, 0, TWO_PI);
      fxCtx.fill();
      if (p.y > h + 10) {
        p.y = -6;
        p.x = Math.random() * w;
      }
    }
  }
  if (now < fxUntil) {
    fxRaf = requestAnimationFrame(tickFx);
  } else if (fxItems.some((p) => p.kind === "ash" || p.kind === "rain")) {
    fxRaf = requestAnimationFrame(tickFx);
  } else {
    fxCtx.clearRect(0, 0, w, h);
    fxRaf = 0;
  }
}

function startEasyFx() {
  stopFx();
  resizeFx();
  const w = window.innerWidth;
  const colors = ["#e2c27a", "#f0d59a", "#ff8fab", "#7ce7c4", "#89b4fa", "#fff4d6"];
  for (let i = 0; i < 64; i += 1) {
    fxItems.push({
      kind: "ribbon",
      x: Math.random() * w,
      y: -80 + Math.random() * (window.innerHeight * 0.55),
      vy: 2.4 + Math.random() * 3.6,
      vx: -1.4 + Math.random() * 2.8,
      len: 50 + Math.random() * 80,
      thick: 4 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vr: -0.14 + Math.random() * 0.28,
      color: colors[i % colors.length],
    });
  }
  for (let i = 0; i < 80; i += 1) {
    fxItems.push({
      kind: "bit",
      x: Math.random() * w,
      y: -40 + Math.random() * (window.innerHeight * 0.45),
      vy: 2.2 + Math.random() * 5,
      vx: -2 + Math.random() * 4,
      s: 4 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: -0.25 + Math.random() * 0.5,
      color: colors[i % colors.length],
    });
  }
  document.body.classList.add("easy-mode");
  resultEl.classList.add("easy");
  fxUntil = performance.now() + 8000;
  fxRaf = requestAnimationFrame(tickFx);
}

function startMidFx() {
  stopFx();
  resizeFx();
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < 40; i += 1) {
    fxItems.push({
      kind: "ash",
      x: Math.random() * w,
      y: Math.random() * h,
      vy: 0.2 + Math.random() * 0.5,
      vx: -0.15 + Math.random() * 0.3,
      s: 1 + Math.random() * 1.6,
      a: 0.08 + Math.random() * 0.16,
    });
  }
  document.body.classList.add("mid-mode");
  resultEl.classList.add("mid");
  fxUntil = performance.now() + 6000;
  fxRaf = requestAnimationFrame(tickFx);
}

function startHardFx() {
  stopFx();
  resizeFx();
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < 70; i += 1) {
    fxItems.push({
      kind: "rain",
      x: Math.random() * w,
      y: Math.random() * h,
      vy: 4 + Math.random() * 5,
      vx: -0.4,
      len: 10 + Math.random() * 16,
      a: 0.12 + Math.random() * 0.22,
    });
  }
  document.body.classList.add("hard-mode");
  resultEl.classList.add("hard");
  fxUntil = performance.now() + 10000;
  fxRaf = requestAnimationFrame(tickFx);
}

function startNightmareFx() {
  stopFx();
  resizeFx();
  const w = window.innerWidth;
  const h = window.innerHeight;
  for (let i = 0; i < 220; i += 1) {
    fxItems.push({
      kind: "ash",
      x: Math.random() * w,
      y: Math.random() * h,
      vy: 0.18 + Math.random() * 0.7,
      vx: -0.35 + Math.random() * 0.7,
      s: 0.6 + Math.random() * 2.4,
      a: 0.12 + Math.random() * 0.4,
    });
  }
  document.body.classList.add("nightmare-mode");
  resultEl.classList.add("nightmare");
  fxUntil = performance.now() + 20000;
  fxRaf = requestAnimationFrame(tickFx);
}

function applyMode(mode) {
  if (mode === "easy") startEasyFx();
  else if (mode === "mid") startMidFx();
  else if (mode === "hard") startHardFx();
  else if (mode === "nightmare") startNightmareFx();
  else stopFx();
}

function hdiCopy(country) {
  if (country.hdi == null) return t("hdiMissing");
  const mode = difficulty(country.hdi);
  return t("hdiChip", {
    hdi: formatDecimal(country.hdi, 3),
    mode: modeLabel(mode),
    year: country.hdiYear,
  });
}

function prepareSlices(countries) {
  let angle = POINTER;
  return countries.map((country, index) => {
    const sweep = country.probability * TWO_PI;
    const slice = {
      ...country,
      start: angle,
      end: angle + sweep,
      mid: angle + sweep / 2,
      sweep,
      hue: hueFor(country, index),
    };
    angle += sweep;
    return slice;
  });
}

function pickWeighted() {
  const r = Math.random();
  let acc = 0;
  for (const slice of slices) {
    acc += slice.probability;
    if (r <= acc) return slice;
  }
  return slices[slices.length - 1];
}

function resizeCanvas() {
  const size = canvas.getBoundingClientRect().width;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(size * dpr);
  canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw(rotation);
  resizeFx();
}

function draw(rot) {
  const size = canvas.getBoundingClientRect().width;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.46;
  ctx.clearRect(0, 0, size, size);

  ctx.save();
  ctx.translate(cx, cy);

  ctx.beginPath();
  ctx.arc(0, 0, radius + 18, 0, TWO_PI);
  ctx.fillStyle = "#1b140a";
  ctx.fill();
  ctx.strokeStyle = "#e2c27a";
  ctx.lineWidth = 10;
  ctx.stroke();

  ctx.save();
  ctx.rotate(rot);
  for (const slice of slices) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius, slice.start, slice.end);
    ctx.closePath();
    const sat = winner && winner.iso3 === slice.iso3 ? 78 : 58;
    const light = winner && winner.iso3 === slice.iso3 ? 58 : 42;
    ctx.fillStyle = `hsl(${slice.hue} ${sat}% ${light}%)`;
    ctx.fill();
    if (slice.sweep > 0.018) {
      ctx.strokeStyle = "rgba(10,13,22,0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  for (const slice of slices) {
    if (slice.sweep < 0.11) continue;
    const labelR = radius * 0.66;
    const mid = wrapAngle(slice.mid);
    const flip = mid > Math.PI / 2 && mid < (3 * Math.PI) / 2;
    ctx.save();
    ctx.rotate(slice.mid);
    if (flip) ctx.rotate(Math.PI);
    ctx.fillStyle = "#f8f1e3";
    ctx.font = `600 ${Math.max(11, Math.min(16, slice.sweep * 42))}px Figtree, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(shortName(slice), flip ? -labelR : labelR, 0, radius * 0.4);
    ctx.restore();
  }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, 64, 0, TWO_PI);
  ctx.fillStyle = "#0a0d16";
  ctx.fill();

  ctx.restore();
}

function easeOutQuint(t) {
  return 1 - (1 - t) ** 5;
}

function targetRotationFor(slice) {
  const desired = wrapAngle(POINTER - slice.mid);
  const current = wrapAngle(rotation);
  const delta = wrapAngle(desired - current);
  const extraTurns = 7 + Math.floor(Math.random() * 4);
  return rotation + extraTurns * TWO_PI + delta;
}

function animateSpin(toRotation, duration, landed) {
  const from = rotation;
  const start = performance.now();
  const pegStep = TWO_PI / 64;
  let lastPeg = Math.floor(from / pegStep);
  spinning = true;
  spinBtn.disabled = true;
  stopFx();
  startSpinAudio(duration);
  hintEl.textContent = t("hintSpinning");

  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    rotation = from + (toRotation - from) * easeOutQuint(t);
    const peg = Math.floor(rotation / pegStep);
    if (peg !== lastPeg) {
      playWheelTick(0.28 + (1 - t) * 0.72);
      lastPeg = peg;
    }
    draw(rotation);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      playWheelStop();
      rotation = toRotation;
      spinning = false;
      spinBtn.disabled = false;
      hubLabelEl.textContent = t("hubAgain");
      showResult(landed);
      draw(rotation);
    }
  }
  requestAnimationFrame(frame);
}

function resultRestHtml(country, mode) {
  const info = mode ? I18N[lang].modes[mode] : null;
  const destiny = info
    ? `<p class="destiny ${mode}"><strong>${info.title}</strong><span>${info.copy}</span></p>`
    : "";
  const hdiHtml = country.hdi == null
    ? `<p class="hdi-chip">${t("hdiMissing")}</p>`
    : `<p class="hdi-chip ${mode}"><i></i>${hdiCopy(country)}</p>`;
  return `
    ${destiny}
    ${hdiHtml}
    <p class="result-copy">
      ${t("probability", { pct: formatPct(country.probability), oneIn: oneIn(country.probability) })}
    </p>
    <div class="metrics">
      <div class="metric"><span>${t("metricBirths")}</span><strong>${formatInt(country.births)}</strong></div>
      <div class="metric"><span>${t("metricPop")}</span><strong>${formatInt(country.population)}</strong></div>
      <div class="metric"><span>${t("metricCbr")}</span><strong>${formatDecimal(country.cbr, 1)} ‰</strong></div>
      <div class="metric"><span>${t("metricHdi")}</span><strong>${country.hdi == null ? t("hdiNone") : formatDecimal(country.hdi, 3)}</strong></div>
    </div>
  `;
}

function fillResultShell(country) {
  const name = countryName(country);
  resultEl.classList.remove("easy", "mid", "hard", "nightmare");
  resultEl.innerHTML = `
    <div class="result-main">
      <div class="result-identity">
        <p class="result-kicker">${t("bornIn")}</p>
        <img class="result-flag" alt="${t("flagAlt", { name })}" src="${flagUrl(country.iso2, 160)}" />
        <h2>${name}</h2>
      </div>
    </div>
    <div class="result-rest"></div>
  `;
  hintEl.textContent = t("hintLanded", { name, pct: formatPct(country.probability) });
  hubLabelEl.textContent = t("hubAgain");
}

function revealResultDetails(country, mode) {
  const main = resultEl.querySelector(".result-main");
  const rest = resultEl.querySelector(".result-rest");
  if (!rest) return;
  if (mode) resultEl.classList.add(mode);
  if (mode === "nightmare" && main && !main.querySelector(".result-skull")) {
    main.insertAdjacentHTML("beforeend", `<img class="result-skull" src="assets/skull.png" alt="${t("skullAlt")}" />`);
  }
  rest.innerHTML = resultRestHtml(country, mode);
  requestAnimationFrame(() => rest.classList.add("is-in"));
}

function renderResult(country, { revealed = false, replay = true } = {}) {
  winner = country;
  const mode = difficulty(country.hdi);
  document.body.classList.add("winner");
  fillResultShell(country);
  if (revealed) {
    resultRevealed = true;
    revealResultDetails(country, mode);
    return;
  }
  if (!replay) return;
  resultRevealed = false;
  clearTimeout(revealTimer);
  stopFx();
  ensureAudio();
  revealTimer = setTimeout(() => {
    resultRevealed = true;
    applyMode(mode);
    playModeSound(mode);
    revealResultDetails(country, mode);
  }, 1100);
}

function showResult(country) {
  renderResult(country, { revealed: false, replay: true });
}

function renderMethod() {
  methodEl.textContent = t("method", { source: t("source") });
}

function renderStats() {
  statsEl.innerHTML = `
    <div class="stat"><b>${data.count}</b><span>${t("statsCountries")}</span></div>
    <div class="stat"><b>${formatInt(data.totalBirths)}</b><span>${t("statsBirths")}</span></div>
    <div class="stat"><b>${formatPct(slices[0].probability, 1)}</b><span>${t("statsIs", { name: countryName(slices[0]) })}</span></div>
  `;
}

function renderRanking(filter = "") {
  const q = filter.trim().toLowerCase();
  const rows = slices.filter((c) =>
    !q || countryName(c).toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.nameEn.toLowerCase().includes(q)
  );
  rankingEl.innerHTML = rows.map((c, i) => {
    const width = (c.births / maxBirths) * 100;
    const hdiText = c.hdi == null
      ? t("hdiNone")
      : t("rankHdi", { hdi: formatDecimal(c.hdi, 3), mode: modeLabel(difficulty(c.hdi)) });
    return `
      <li data-iso="${c.iso3}">
        <span>${q ? "" : i + 1}</span>
        <img alt="" src="${flagUrl(c.iso2, 40)}" />
        <div class="rank-name">
          <strong>${countryName(c)}</strong>
          <div class="bar"><i style="width:${width}%"></i></div>
        </div>
        <div class="rank-meta">
          <span class="rank-pct">${formatPct(c.probability)}</span>
          <span class="rank-hdi">${hdiText}</span>
        </div>
      </li>
    `;
  }).join("");
}

function spin() {
  if (spinning || !slices.length) return;
  clearTimeout(revealTimer);
  winner = null;
  ensureAudio();
  const landed = pickWeighted();
  animateSpin(targetRotationFor(landed), 6800 + Math.random() * 1400, landed);
}

async function init() {
  const saved = localStorage.getItem(LANG_KEY);
  if (saved === "en" || saved === "es") lang = saved;
  else lang = await detectLang();
  applyStaticCopy();

  const response = await fetch("./data/countries.json");
  data = await response.json();
  slices = prepareSlices(data.countries);
  maxBirths = slices[0].births;
  renderMethod();
  renderStats();
  renderRanking();
  resizeCanvas();
}

spinBtn.addEventListener("click", spin);
searchEl.addEventListener("input", () => renderRanking(searchEl.value));
window.addEventListener("resize", resizeCanvas);
document.querySelector(".lang-switch").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-lang]");
  if (btn) setLang(btn.dataset.lang, true);
});
rankingEl.addEventListener("click", (event) => {
  const row = event.target.closest("li");
  if (!row || spinning) return;
  const country = slices.find((c) => c.iso3 === row.dataset.iso);
  if (!country) return;
  winner = country;
  rotation = POINTER - country.mid;
  draw(rotation);
  showResult(country);
});

init().catch((err) => {
  hintEl.textContent = t("loadError");
  console.error(err);
});
