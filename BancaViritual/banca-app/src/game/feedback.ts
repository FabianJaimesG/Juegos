// Sonido (blip de caja registradora) y voz (es-ES), como en la Banca original.

let audioCtx: AudioContext | null = null;

/** Pequeño "blip" de caja registradora con el oscilador de Web Audio. */
export function blip() {
  try {
    audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const ctx = audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.08);
    gain.gain.setValueAtTime(0.001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    /* audio no disponible */
  }
}

/** Lee un texto en voz alta (español), limpiando símbolos no hablables. */
export function speak(text: string) {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const clean = text
      .replace(/→/g, ' a ')
      .replace(/↔/g, ' con ')
      .replace(/·/g, '. ')
      .replace(/🎲|➕|✖️|🔁|🚫|💰|🏠|🏨|🏦|🟢/g, '')
      .trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'es-ES';
    const voice = synth.getVoices().find((v) => v.lang.startsWith('es'));
    if (voice) u.voice = voice;
    synth.cancel();
    synth.speak(u);
  } catch {
    /* síntesis no disponible */
  }
}
