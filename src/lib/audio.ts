/**
 * Generative ambient audio engine for CipherRoom.
 * Uses Web Audio API — no assets, fully synthesized.
 * Toggleable, low volume, designed to feel like an open analog channel.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let ambientNodes: { stop: () => void } | null = null;
let enabled = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0;
    masterGain.connect(ctx.destination);
  }
  return ctx;
}

export function isAudioEnabled() {
  return enabled;
}

export async function enableAudio() {
  const c = getCtx();
  if (!c || !masterGain) return;
  if (c.state === "suspended") await c.resume();
  enabled = true;
  masterGain.gain.cancelScheduledValues(c.currentTime);
  masterGain.gain.linearRampToValueAtTime(0.18, c.currentTime + 0.4);
  startAmbient();
}

export function disableAudio() {
  enabled = false;
  if (!ctx || !masterGain) return;
  masterGain.gain.cancelScheduledValues(ctx.currentTime);
  masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
  setTimeout(() => {
    ambientNodes?.stop();
    ambientNodes = null;
  }, 400);
}

function startAmbient() {
  if (!ctx || !masterGain || ambientNodes) return;

  // Pink-ish noise hiss
  const bufferSize = 2 * ctx.sampleRate;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  let lastOut = 0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    lastOut = (lastOut + 0.02 * white) / 1.02;
    data[i] = lastOut * 3.5;
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = true;

  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.value = 800;
  noiseFilter.Q.value = 0.6;

  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.14;
  noise.connect(noiseFilter).connect(noiseGain).connect(masterGain);
  noise.start();

  // Slow sine drone
  const drone = ctx.createOscillator();
  drone.type = "sine";
  drone.frequency.value = 55;
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.06;
  drone.connect(droneGain).connect(masterGain);
  drone.start();

  // Slowly modulate the bandpass for "tuning" feel
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 240;
  lfo.connect(lfoGain).connect(noiseFilter.frequency);
  lfo.start();

  ambientNodes = {
    stop: () => {
      try { noise.stop(); } catch { /* */ }
      try { drone.stop(); } catch { /* */ }
      try { lfo.stop(); } catch { /* */ }
    },
  };
}

/** Short mechanical click — for keystrokes. */
export function clickSound() {
  if (!enabled) return;
  const c = getCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(1800 + Math.random() * 400, now);
  const g = c.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.05, now + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.05);
}

/** Soft shortwave ping — for incoming messages. */
export function pingSound() {
  if (!enabled) return;
  const c = getCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(420, now + 0.45);
  const g = c.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.18, now + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.6);

  // Harmonic
  const o2 = c.createOscillator();
  o2.type = "sine";
  o2.frequency.setValueAtTime(1320, now);
  const g2 = c.createGain();
  g2.gain.setValueAtTime(0, now);
  g2.gain.linearRampToValueAtTime(0.06, now + 0.02);
  g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
  o2.connect(g2).connect(masterGain);
  o2.start(now);
  o2.stop(now + 0.45);
}

/** Low alert sweep — for warnings. */
export function alertSound() {
  if (!enabled) return;
  const c = getCtx();
  if (!c || !masterGain) return;
  const now = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(220, now);
  osc.frequency.linearRampToValueAtTime(110, now + 0.4);
  const g = c.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.14, now + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
  osc.connect(g).connect(masterGain);
  osc.start(now);
  osc.stop(now + 0.55);
}