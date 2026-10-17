/*
 * Ported from Riff's audio-engine.js (https://github.com/rootscripts/riff, commit 935ae2d).
 * MIT License — Copyright (c) 2026 rootscripts. See THIRD_PARTY_NOTICES.md.
 *
 * TypeScript port of RiffAudioEngine: a Web Audio graph on top of one <audio> element
 * (HQ enhancer chain, 3-band + 10-band EQ, reverb, echo, distortion, speed/pitch,
 * fade gain for smooth play/pause + crossfade, analyser, idle-suspend, offline render).
 * Muse changes: typed, `canRoute` guard (iOS / cross-origin / YouTube-embed engines keep
 * the element untouched), `ready` flag, settings clamp helpers. Logic is otherwise Riff's.
 */

export type HqEngine = 'hqmusic-3' | 'glyphs-7B' | 'fyro1.1';
export interface HqSettings { engine: HqEngine; preset: string; vocal: number; air: number; bass: number }
export interface AudioSettings {
  speed: number; speedPitch: number; pitch: number; reverb: number; distortion: number;
  volume: number; echo: number; eq: { low: number; mid: number; high: number }; eqBands: number[];
}
export const EQ_BAND_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const defaultAudioSettings = (): AudioSettings => ({
  speed: 1.0, speedPitch: 1.0, pitch: 0, reverb: 0, distortion: 0, volume: 1.0, echo: 0,
  eq: { low: 0, mid: 0, high: 0 }, eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
});
export const defaultHqSettings = (): HqSettings => ({ engine: 'hqmusic-3', preset: 'studio', vocal: 0, air: 0, bass: 0 });

type AnyCtx = BaseAudioContext;

export class RiffAudioEngine {
  ctx: AudioContext | null = null;
  mediaSource: MediaElementAudioSourceNode | null = null;
  graphInitialized = false;

  stdInput: GainNode | null = null;
  dryGain: GainNode | null = null;
  distortionNode: WaveShaperNode | null = null;
  distortionGain: GainNode | null = null;
  delayNode: DelayNode | null = null;
  delayFeedback: GainNode | null = null;
  delayGain: GainNode | null = null;
  convolverNode: ConvolverNode | null = null;
  reverbGain: GainNode | null = null;

  hqInput: GainNode | null = null;
  hqCompressor: DynamicsCompressorNode | null = null;
  hqBass: BiquadFilterNode | null = null;
  hqVocal: BiquadFilterNode | null = null;
  hqAir: BiquadFilterNode | null = null;
  hqSaturation: WaveShaperNode | null = null;
  hqLimiter: DynamicsCompressorNode | null = null;

  eqLow: BiquadFilterNode | null = null;
  eqMid: BiquadFilterNode | null = null;
  eqHigh: BiquadFilterNode | null = null;
  eqBands: BiquadFilterNode[] = [];

  masterGain: GainNode | null = null;
  analyserNode: AnalyserNode | null = null;
  fadeGain: GainNode | null = null;
  bus: GainNode | null = null;
  private _analyserConnected = false;
  private _suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private _attachedElement: HTMLMediaElement | null = null;
  private _routingState: string | null = null;

  hqEnabled = false;
  hqSettings: HqSettings = defaultHqSettings();
  audioSettings: AudioSettings = defaultAudioSettings();
  isMuted = false;
  volume = 0.85;

  /** True once the element is routed through Web Audio (effects/EQ/fades/analyser live). */
  get ready() { return this.graphInitialized && !!this.ctx; }

  _createReverbImpulse(ctx: AnyCtx) {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * 0.6);
    const impulse = ctx.createBuffer(2, len, rate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    for (let i = 0; i < len; i++) {
      const decay = Math.exp(-i / (rate * 0.15));
      left[i] = (Math.random() * 2 - 1) * decay;
      right[i] = (Math.random() * 2 - 1) * decay;
    }
    return impulse;
  }

  _makeDistortionCurve(amount = 0) {
    const n = 256;
    const curve = new Float32Array(n);
    const k = amount * 2.5;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = k <= 0 ? x : ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  _makeHarmonicCurve(amount = 0) {
    const n = 256;
    const curve = new Float32Array(n);
    const k = amount * 0.02;
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = x - k * Math.pow(x, 3);
    }
    return curve;
  }

  init(audioElement: HTMLMediaElement) {
    if (!audioElement) return;
    if (this.ctx) {
      if (!audioElement.paused && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } else {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC({ latencyHint: 'playback' });
    }
    const ctx = this.ctx!;

    if (this._attachedElement !== audioElement) {
      this._attachedElement = audioElement;
      audioElement.addEventListener('play', () => this.resumeAudioContext());
      audioElement.addEventListener('pause', () => this.suspendAudioContextDebounced(5000));
      audioElement.addEventListener('ended', () => this.suspendAudioContextDebounced(5000));
    }

    if (!this.graphInitialized) {
      try {
        this.mediaSource = ctx.createMediaElementSource(audioElement);
        this.stdInput = ctx.createGain();
        this.hqInput = ctx.createGain();
        this.hqCompressor = ctx.createDynamicsCompressor();
        this.hqBass = ctx.createBiquadFilter(); this.hqBass.type = 'lowshelf'; this.hqBass.frequency.value = 80;
        this.hqVocal = ctx.createBiquadFilter(); this.hqVocal.type = 'peaking'; this.hqVocal.frequency.value = 2500; this.hqVocal.Q.value = 1.2;
        this.hqAir = ctx.createBiquadFilter(); this.hqAir.type = 'highshelf'; this.hqAir.frequency.value = 9000;
        this.hqSaturation = ctx.createWaveShaper(); this.hqSaturation.oversample = '4x';
        this.hqLimiter = ctx.createDynamicsCompressor();
        this.hqLimiter.threshold.value = -1; this.hqLimiter.knee.value = 0; this.hqLimiter.ratio.value = 20;
        this.hqLimiter.attack.value = 0.005; this.hqLimiter.release.value = 0.05;
        this.hqInput.connect(this.hqCompressor); this.hqCompressor.connect(this.hqBass); this.hqBass.connect(this.hqVocal);
        this.hqVocal.connect(this.hqAir); this.hqAir.connect(this.hqSaturation); this.hqSaturation.connect(this.hqLimiter);

        this.dryGain = ctx.createGain(); this.dryGain.gain.value = 1.0;
        this.distortionNode = ctx.createWaveShaper(); this.distortionNode.oversample = 'none'; this.distortionNode.curve = this._makeDistortionCurve(0);
        this.distortionGain = ctx.createGain(); this.distortionGain.gain.value = 0.0;
        this.delayNode = ctx.createDelay(1.0); this.delayNode.delayTime.value = 0.3;
        this.delayFeedback = ctx.createGain(); this.delayFeedback.gain.value = 0.35;
        this.delayGain = ctx.createGain(); this.delayGain.gain.value = 0.0;
        this.delayNode.connect(this.delayFeedback); this.delayFeedback.connect(this.delayNode); this.delayNode.connect(this.delayGain);
        this.convolverNode = ctx.createConvolver(); this.convolverNode.buffer = this._createReverbImpulse(ctx);
        this.reverbGain = ctx.createGain(); this.reverbGain.gain.value = 0.0;

        this.masterGain = ctx.createGain();
        this.analyserNode = ctx.createAnalyser(); this.analyserNode.fftSize = 128; this.analyserNode.smoothingTimeConstant = 0.8;

        this.eqLow = ctx.createBiquadFilter(); this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 200;
        this.eqMid = ctx.createBiquadFilter(); this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 1000; this.eqMid.Q.value = 0.9;
        this.eqHigh = ctx.createBiquadFilter(); this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 4000;
        this.eqLow.connect(this.eqMid); this.eqMid.connect(this.eqHigh);
        this.eqBands = EQ_BAND_FREQS.map((f) => { const node = ctx.createBiquadFilter(); node.type = 'peaking'; node.frequency.value = f; node.Q.value = 1.1; node.gain.value = 0; return node; });
        this.eqHigh.connect(this.eqBands[0]);
        for (let i = 0; i < this.eqBands.length - 1; i++) this.eqBands[i].connect(this.eqBands[i + 1]);

        this.bus = ctx.createGain();
        this.fadeGain = ctx.createGain(); this.fadeGain.gain.value = 1.0;
        this.masterGain.connect(this.fadeGain);
        this.fadeGain.connect(ctx.destination);

        this.graphInitialized = true;
        this._updateRouting();
      } catch (e) {
        console.warn('[AudioEngine] Graph initialization notice:', e);
      }
    }
    this.applySettings();
    if (audioElement.paused) this.suspendAudioContextDebounced(5000);
  }

  _isEqActive() {
    const s = this.audioSettings;
    if (s.eq && (s.eq.low !== 0 || s.eq.mid !== 0 || s.eq.high !== 0)) return true;
    return Array.isArray(s.eqBands) && s.eqBands.some((v) => v !== 0);
  }

  _updateRouting() {
    if (!this.graphInitialized || !this.mediaSource) return;
    const s = this.audioSettings;
    const isEqOn = this._isEqActive();
    const isReverbOn = (s.reverb || 0) > 0;
    const isEchoOn = (s.echo || 0) > 0;
    const isDistortionOn = (s.distortion || 0) > 0;
    const isHqOn = !!this.hqEnabled;
    const stateKey = `${isHqOn}_${isEqOn}_${isReverbOn}_${isEchoOn}_${isDistortionOn}`;
    if (this._routingState === stateKey) { this._applyHqParams(); return; }
    this._routingState = stateKey;
    try {
      this.mediaSource.disconnect(); this.stdInput!.disconnect(); this.hqLimiter!.disconnect(); this.bus!.disconnect(); this.dryGain!.disconnect();
      if (this.eqBands.length) this.eqBands[this.eqBands.length - 1].disconnect();
      this.distortionNode!.disconnect(); this.distortionGain!.disconnect(); this.delayGain!.disconnect(); this.convolverNode!.disconnect(); this.reverbGain!.disconnect();
    } catch {}
    const inputNode = isHqOn ? this.hqLimiter! : this.stdInput!;
    this.mediaSource.connect(isHqOn ? this.hqInput! : this.stdInput!);
    if (isEqOn) { inputNode.connect(this.eqLow!); this.eqBands[this.eqBands.length - 1].connect(this.bus!); }
    else inputNode.connect(this.bus!);
    this.bus!.connect(this.dryGain!); this.dryGain!.connect(this.masterGain!);
    if (isDistortionOn) { this.bus!.connect(this.distortionNode!); this.distortionNode!.connect(this.distortionGain!); this.distortionGain!.connect(this.masterGain!); }
    if (isEchoOn) { this.bus!.connect(this.delayNode!); this.delayGain!.connect(this.masterGain!); }
    if (isReverbOn) { this.bus!.connect(this.convolverNode!); this.convolverNode!.connect(this.reverbGain!); this.reverbGain!.connect(this.masterGain!); }
    this._applyHqParams();
  }

  flushEffects() {
    if (!this.graphInitialized || !this.ctx) return;
    try {
      if (this.delayNode) {
        const dt = this.delayNode.delayTime.value;
        const fb = this.delayFeedback ? this.delayFeedback.gain.value : 0.35;
        try { this.delayNode.disconnect(); this.delayFeedback?.disconnect(); } catch {}
        this.delayNode = this.ctx.createDelay(1.0); this.delayNode.delayTime.value = dt;
        this.delayFeedback = this.ctx.createGain(); this.delayFeedback.gain.value = fb;
        this.delayNode.connect(this.delayFeedback); this.delayFeedback.connect(this.delayNode);
        if (this.delayGain) this.delayNode.connect(this.delayGain);
      }
      if (this.convolverNode) {
        try { this.convolverNode.disconnect(); } catch {}
        this.convolverNode = this.ctx.createConvolver(); this.convolverNode.buffer = this._createReverbImpulse(this.ctx);
        if (this.reverbGain) this.convolverNode.connect(this.reverbGain);
      }
      this._routingState = null;
      this._updateRouting();
    } catch {}
  }

  setHqEnabled(enabled: boolean) {
    this.hqEnabled = enabled;
    if (this.graphInitialized) { this._updateRouting(); this._applyHqParams(); }
  }
  setHqSettings(settings: Partial<HqSettings>) {
    Object.assign(this.hqSettings, settings);
    if (this.graphInitialized) this._applyHqParams();
  }

  _applyHqParams() {
    if (!this.hqCompressor) return;
    if (!this.hqEnabled) {
      const ctx = this.ctx;
      if (ctx) {
        this.hqBass?.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        this.hqVocal?.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        this.hqAir?.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      }
      return;
    }
    let baseBass = 0; const baseVocal = 0; let baseAir = 0; let satAmount = 0;
    this.hqCompressor.threshold.value = -12; this.hqCompressor.knee.value = 10; this.hqCompressor.ratio.value = 1.5;
    this.hqCompressor.attack.value = 0.01; this.hqCompressor.release.value = 0.1;
    switch (this.hqSettings.engine) {
      case 'hqmusic-3': satAmount = 0.5; break;
      case 'glyphs-7B': satAmount = 0.2; baseAir = 2.5; this.hqAir!.frequency.value = 9000; break;
      case 'fyro1.1': satAmount = 0.2; baseBass = 3.0; this.hqBass!.frequency.value = 80; this.hqCompressor.ratio.value = 2.0; break;
    }
    this.hqSaturation!.curve = this._makeHarmonicCurve(satAmount);
    this.hqBass!.gain.value = Math.max(-4, Math.min(4, baseBass + this.hqSettings.bass * 0.08));
    this.hqVocal!.gain.value = Math.max(-4, Math.min(4, baseVocal + this.hqSettings.vocal * 0.08));
    this.hqAir!.gain.value = Math.max(-4, Math.min(4, baseAir + this.hqSettings.air * 0.08));
  }

  setAudioSettings(settings: Partial<AudioSettings>) {
    Object.assign(this.audioSettings, settings);
    this.applySettings();
  }

  setEq(eq: Partial<AudioSettings['eq']>) {
    if (!eq) return;
    if (!this.audioSettings.eq) this.audioSettings.eq = { low: 0, mid: 0, high: 0 };
    const clamp = (v: any) => Math.max(-12, Math.min(12, typeof v === 'number' ? v : 0));
    if (eq.low !== undefined) this.audioSettings.eq.low = clamp(eq.low);
    if (eq.mid !== undefined) this.audioSettings.eq.mid = clamp(eq.mid);
    if (eq.high !== undefined) this.audioSettings.eq.high = clamp(eq.high);
    if (this.eqLow) this.eqLow.gain.value = this.audioSettings.eq.low;
    if (this.eqMid) this.eqMid.gain.value = this.audioSettings.eq.mid;
    if (this.eqHigh) this.eqHigh.gain.value = this.audioSettings.eq.high;
    if (this.graphInitialized) this._updateRouting();
  }

  setEqBands(gains: number[]) {
    if (!Array.isArray(gains)) return;
    if (!Array.isArray(this.audioSettings.eqBands)) this.audioSettings.eqBands = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const clamp = (v: any) => Math.max(-12, Math.min(12, typeof v === 'number' ? v : 0));
    for (let i = 0; i < 10; i++) {
      const val = clamp(gains[i]);
      this.audioSettings.eqBands[i] = val;
      const b = this.eqBands[i];
      if (b) { if (this.ctx) b.gain.setTargetAtTime(val, this.ctx.currentTime, 0.02); else b.gain.value = val; }
    }
    if (this.graphInitialized) this._updateRouting();
  }

  setVolume(volume: number, isMuted: boolean) {
    this.volume = volume; this.isMuted = isMuted;
    this._applyMasterVolume();
  }

  /** Speed/pitch go to the element (works everywhere, iOS included); the rest needs the graph. */
  applySettings(audioElement?: HTMLMediaElement) {
    const s = this.audioSettings;
    if (audioElement) {
      const el = audioElement as any;
      if (s.speedPitch !== 1.0 || s.pitch !== 0) {
        el.preservesPitch = false; el.webkitPreservesPitch = false; el.mozPreservesPitch = false;
        audioElement.playbackRate = s.speedPitch * Math.pow(2, s.pitch / 12);
      } else {
        el.preservesPitch = true; el.webkitPreservesPitch = true; el.mozPreservesPitch = true;
        audioElement.playbackRate = s.speed;
      }
    }
    if (s.eq) this.setEq(s.eq);
    if (s.eqBands) this.setEqBands(s.eqBands);
    if (this.reverbGain) this.reverbGain.gain.value = s.reverb / 100;
    if (this.delayGain) this.delayGain.gain.value = s.echo / 100;
    if (this.distortionNode && this.distortionGain) {
      if (s.distortion > 0) {
        this.distortionNode.curve = this._makeDistortionCurve(s.distortion);
        this.distortionGain.gain.value = (s.distortion / 100) * 0.75;
        if (this.dryGain) this.dryGain.gain.value = 1.0 - (s.distortion / 100) * 0.4;
      } else {
        this.distortionGain.gain.value = 0.0;
        if (this.dryGain) this.dryGain.gain.value = 1.0;
      }
    }
    if (this.graphInitialized) this._updateRouting();
    this._applyMasterVolume();
  }

  /** Muse: playback-rate half of applySettings (no graph writes). */
  applyRate(audioElement: HTMLMediaElement) {
    const s = this.audioSettings, el = audioElement as any;
    const shifted = s.speedPitch !== 1.0 || s.pitch !== 0;
    el.preservesPitch = !shifted; el.webkitPreservesPitch = !shifted; el.mozPreservesPitch = !shifted;
    audioElement.playbackRate = shifted ? s.speedPitch * Math.pow(2, s.pitch / 12) : s.speed;
  }

  _applyMasterVolume() {
    const vol = this.isMuted ? 0 : this.volume;
    if (this.masterGain) this.masterGain.gain.value = vol * this.audioSettings.volume;
  }

  isModified() {
    const s = this.audioSettings;
    const eqMod = s.eq ? s.eq.low !== 0 || s.eq.mid !== 0 || s.eq.high !== 0 : false;
    const eqBandsMod = Array.isArray(s.eqBands) ? s.eqBands.some((v) => v !== 0) : false;
    return s.speed !== 1.0 || s.speedPitch !== 1.0 || s.pitch !== 0 || s.reverb !== 0 || s.distortion !== 0 || s.volume !== 1.0 || s.echo !== 0 || eqMod || eqBandsMod;
  }

  fadeOut(durationSec = 0.25) {
    if (this.masterGain && this.ctx) {
      const current = this.masterGain.gain.value;
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(Math.max(0.001, current), this.ctx.currentTime);
      this.masterGain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + durationSec);
    }
  }

  fadeIn(durationSec = 0.35) {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      const targetVol = (this.isMuted ? 0 : this.volume) * this.audioSettings.volume;
      this.masterGain.gain.exponentialRampToValueAtTime(Math.max(0.001, targetVol), this.ctx.currentTime + durationSec);
    }
  }

  getAnalyserNode() { return this.analyserNode; }

  setAnalyserEnabled(enabled: boolean) {
    const active = !!enabled;
    if (this._analyserConnected === active) return;
    this._analyserConnected = active;
    if (!this.masterGain || !this.analyserNode || !this.ctx) return;
    try {
      if (active) this.masterGain.connect(this.analyserNode);
      else {
        try { this.masterGain.disconnect(this.analyserNode); }
        catch { this.masterGain.disconnect(); this.masterGain.connect(this.fadeGain || this.ctx.destination); }
      }
    } catch {}
  }

  suspendAudioContextDebounced(delayMs = 5000) {
    if (this._suspendTimer) clearTimeout(this._suspendTimer);
    this._suspendTimer = setTimeout(() => {
      this._suspendTimer = null;
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    }, delayMs);
  }

  resumeAudioContext() {
    if (this._suspendTimer) { clearTimeout(this._suspendTimer); this._suspendTimer = null; }
    if (this.ctx && this.ctx.state === 'suspended') return this.ctx.resume().catch(() => {});
  }

  setHidden(hidden: boolean) {
    if (this.analyserNode) this.analyserNode.fftSize = hidden ? 32 : 128;
    if (hidden) this.setAnalyserEnabled(false);
  }

  getFrequencyData(buffer: Uint8Array<ArrayBuffer>) {
    if (!this._analyserConnected) this.setAnalyserEnabled(true);
    this.analyserNode?.getByteFrequencyData(buffer);
  }
  getTimeDomainData(buffer: Uint8Array<ArrayBuffer>) {
    if (!this._analyserConnected) this.setAnalyserEnabled(true);
    this.analyserNode?.getByteTimeDomainData(buffer);
  }

  isLiveStream(audioElement: HTMLMediaElement) {
    if (!audioElement) return false;
    const dur = audioElement.duration;
    return !isFinite(dur) || isNaN(dur);
  }

  /** Offline render of a decoded buffer through the same chain (Riff's export path). */
  async renderOffline(sourceBuffer: AudioBuffer, settingsOverride?: AudioSettings, hqOverride?: HqSettings) {
    const s = settingsOverride || { ...this.audioSettings };
    const hq = hqOverride || { ...this.hqSettings };
    const useHq = this.hqEnabled;
    const speedFactor = s.speedPitch !== 1.0 || s.pitch !== 0 ? s.speedPitch * Math.pow(2, s.pitch / 12) : s.speed;
    const outputLength = Math.ceil(sourceBuffer.length / Math.max(0.1, speedFactor));
    const offline = new OfflineAudioContext(sourceBuffer.numberOfChannels, outputLength, sourceBuffer.sampleRate);
    const src = offline.createBufferSource(); src.buffer = sourceBuffer; src.playbackRate.value = speedFactor;
    const cl = (v: number | undefined) => Math.max(-12, Math.min(12, v || 0));
    const eqL = offline.createBiquadFilter(); eqL.type = 'lowshelf'; eqL.frequency.value = 200; eqL.gain.value = cl(s.eq?.low);
    const eqM = offline.createBiquadFilter(); eqM.type = 'peaking'; eqM.frequency.value = 1000; eqM.Q.value = 0.9; eqM.gain.value = cl(s.eq?.mid);
    const eqH = offline.createBiquadFilter(); eqH.type = 'highshelf'; eqH.frequency.value = 4000; eqH.gain.value = cl(s.eq?.high);
    eqL.connect(eqM); eqM.connect(eqH);
    let tail: AudioNode = eqH;
    if (Array.isArray(s.eqBands)) {
      const bands = EQ_BAND_FREQS.map((f, i) => { const b = offline.createBiquadFilter(); b.type = 'peaking'; b.frequency.value = f; b.Q.value = 1.1; b.gain.value = cl(s.eqBands[i]); return b; });
      tail.connect(bands[0]); for (let i = 0; i < bands.length - 1; i++) bands[i].connect(bands[i + 1]); tail = bands[bands.length - 1];
    }
    const master = offline.createGain(); master.gain.value = s.volume;
    if (useHq) {
      const comp = offline.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 10; comp.ratio.value = hq.engine === 'fyro1.1' ? 2.0 : 1.5; comp.attack.value = 0.01; comp.release.value = 0.1;
      const bass = offline.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 80; bass.gain.value = Math.max(-4, Math.min(4, (hq.engine === 'fyro1.1' ? 3.0 : 0) + hq.bass * 0.08));
      const vocal = offline.createBiquadFilter(); vocal.type = 'peaking'; vocal.frequency.value = 2500; vocal.Q.value = 1.2; vocal.gain.value = Math.max(-4, Math.min(4, hq.vocal * 0.08));
      const air = offline.createBiquadFilter(); air.type = 'highshelf'; air.frequency.value = 9000; air.gain.value = Math.max(-4, Math.min(4, (hq.engine === 'glyphs-7B' ? 2.5 : 0) + hq.air * 0.08));
      const sat = offline.createWaveShaper(); sat.oversample = '4x'; sat.curve = this._makeHarmonicCurve(hq.engine === 'hqmusic-3' ? 0.5 : 0.2);
      const limiter = offline.createDynamicsCompressor(); limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.005; limiter.release.value = 0.05;
      src.connect(comp); comp.connect(bass); bass.connect(vocal); vocal.connect(air); air.connect(sat); sat.connect(limiter); limiter.connect(eqL);
      tail.connect(master);
    } else {
      const dry = offline.createGain();
      const distNode = offline.createWaveShaper(); distNode.oversample = 'none';
      const distGain = offline.createGain();
      const delay = offline.createDelay(1.0); delay.delayTime.value = 0.3;
      const feedback = offline.createGain(); feedback.gain.value = 0.35;
      const echoGain = offline.createGain();
      const conv = offline.createConvolver(); conv.buffer = this._createReverbImpulse(offline);
      const revGain = offline.createGain();
      revGain.gain.value = s.reverb / 100; echoGain.gain.value = s.echo / 100;
      distNode.curve = this._makeDistortionCurve(s.distortion > 0 ? s.distortion : 0);
      distGain.gain.value = s.distortion > 0 ? (s.distortion / 100) * 0.75 : 0;
      dry.gain.value = s.distortion > 0 ? 1.0 - (s.distortion / 100) * 0.4 : 1.0;
      src.connect(eqL); delay.connect(feedback); feedback.connect(delay);
      tail.connect(dry); dry.connect(master);
      tail.connect(distNode); distNode.connect(distGain); distGain.connect(master);
      tail.connect(delay); delay.connect(echoGain); echoGain.connect(master);
      tail.connect(conv); conv.connect(revGain); revGain.connect(master);
    }
    master.connect(offline.destination);
    src.start(0);
    return offline.startRendering();
  }

  audioBufferToWav(buffer: AudioBuffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const channels: Float32Array[] = [];
    for (let i = 0; i < numChannels; i++) channels.push(buffer.getChannelData(i));
    const length = channels[0].length;
    const blockAlign = numChannels * 2;
    const dataSize = length * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);
    const ws = (o: number, str: string) => { for (let i = 0; i < str.length; i++) view.setUint8(o + i, str.charCodeAt(i)); };
    ws(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ws(8, 'WAVE'); ws(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * blockAlign, true); view.setUint16(32, blockAlign, true); view.setUint16(34, 16, true);
    ws(36, 'data'); view.setUint32(40, dataSize, true);
    let off = 44;
    for (let i = 0; i < length; i++) for (let ch = 0; ch < numChannels; ch++) {
      const smp = Math.max(-1, Math.min(1, channels[ch][i]));
      view.setInt16(off, smp < 0 ? smp * 0x8000 : smp * 0x7fff, true); off += 2;
    }
    return new Blob([ab], { type: 'audio/wav' });
  }
}
