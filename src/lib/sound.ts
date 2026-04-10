type SoundCue = 'player_joined' | 'countdown_tick' | 'time_low' | 'round_end';

let audioCtx: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  return audioCtx;
}

function beep(
  ctx: AudioContext,
  frequency: number,
  startAt: number,
  duration: number,
  type: OscillatorType = 'sine',
  volume = 0.05,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, startAt);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

export function unlockAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') {
    void ctx.resume();
  }
}

export function playSoundCue(cue: SoundCue) {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === 'suspended') return;

  const t0 = ctx.currentTime + 0.01;

  switch (cue) {
    case 'player_joined':
      beep(ctx, 620, t0, 0.08, 'triangle', 0.035);
      beep(ctx, 860, t0 + 0.1, 0.09, 'triangle', 0.04);
      break;
    case 'countdown_tick':
      beep(ctx, 760, t0, 0.07, 'square', 0.03);
      break;
    case 'time_low':
      beep(ctx, 520, t0, 0.07, 'square', 0.04);
      beep(ctx, 430, t0 + 0.09, 0.07, 'square', 0.04);
      break;
    case 'round_end':
      beep(ctx, 680, t0, 0.08, 'sine', 0.04);
      beep(ctx, 860, t0 + 0.1, 0.1, 'sine', 0.045);
      break;
    default:
      break;
  }
}

