export type SoundType = 'message' | 'notification' | 'match' | 'success' | 'error' | 'vybePlus';
export type SoundPreferences = {
  enabled: boolean;
  messageSoundEnabled: boolean;
  notificationSoundEnabled: boolean;
  matchSoundEnabled: boolean;
  actionSoundEnabled: boolean;
  vybePlusSoundEnabled: boolean;
  volume: number;
};

export const defaultSoundPreferences: SoundPreferences = {
  enabled: true,
  messageSoundEnabled: true,
  notificationSoundEnabled: true,
  matchSoundEnabled: true,
  actionSoundEnabled: true,
  vybePlusSoundEnabled: true,
  volume: 0.5,
};

const preferenceKey: Record<SoundType, keyof SoundPreferences> = {
  message: 'messageSoundEnabled', notification: 'notificationSoundEnabled', match: 'matchSoundEnabled',
  success: 'actionSoundEnabled', error: 'actionSoundEnabled', vybePlus: 'vybePlusSoundEnabled',
};
const cooldownMs: Record<SoundType, number> = { message: 700, notification: 1800, match: 3000, success: 900, error: 1200, vybePlus: 3000 };
const notes: Record<SoundType, Array<[number, number, OscillatorType]>> = {
  message: [[660, 0.075, 'sine'], [880, 0.09, 'sine']],
  notification: [[740, 0.07, 'sine'], [988, 0.08, 'sine']],
  match: [[523, 0.09, 'sine'], [659, 0.09, 'sine'], [784, 0.14, 'sine']],
  success: [[784, 0.07, 'sine'], [1046, 0.09, 'sine']],
  error: [[330, 0.12, 'triangle'], [294, 0.10, 'sine']],
  vybePlus: [[523, 0.08, 'sine'], [659, 0.08, 'sine'], [784, 0.09, 'sine'], [1046, 0.16, 'sine']],
};

class SoundManager {
  private preferences: SoundPreferences = { ...defaultSoundPreferences };
  private loaded = false;
  private context: AudioContext | null = null;
  private lastPlayed = new Map<SoundType, number>();
  private playedEvents = new Set<string>();
  private pendingTypes: SoundType[] = [];
  private busyUntil = 0;
  private queueTimer = 0;
  private unlockInstalled = false;

  getPreferences() { return { ...this.preferences }; }
  isLoaded() { return this.loaded; }
  setPreferences(preferences: SoundPreferences) {
    this.preferences = { ...defaultSoundPreferences, ...preferences, volume: Math.min(1, Math.max(0, Number(preferences.volume) || 0)) };
    this.loaded = true;
  }
  async load() {
    try {
      const response = await fetch('/api/account/audio-preferences', { credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) return;
      this.setPreferences(await response.json() as SoundPreferences);
    } catch { /* Audio remains silent until account preferences are available. */ }
  }
  installUnlock() {
    if (this.unlockInstalled || typeof window === 'undefined') return;
    this.unlockInstalled = true;
    const unlock = () => {
      this.unlockAudio();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true, passive: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true, passive: true });
  }
  private unlockAudio() {
    try {
      const Constructor = window.AudioContext;
      if (!Constructor) return;
      this.context ??= new Constructor();
      if (this.context.state === 'suspended') void this.context.resume().then(() => this.flushPending());
      else this.flushPending();
    } catch { /* Browser audio is optional and must never interrupt the app. */ }
  }
  play(type: SoundType, eventId?: string) {
    if (!this.loaded || !this.preferences.enabled || !this.preferences[preferenceKey[type]] || this.preferences.volume <= 0) return;
    if (eventId) {
      const key = `${type}:${eventId}`;
      if (this.playedEvents.has(key)) return;
      this.playedEvents.add(key);
      if (this.playedEvents.size > 500) this.playedEvents = new Set([...this.playedEvents].slice(-250));
    }
    const now = Date.now();
    if (now - (this.lastPlayed.get(type) ?? 0) < cooldownMs[type]) return;
    if (!this.context || this.context.state !== 'running') { this.queuePending(type); this.unlockAudio(); return; }
    this.playTone(type);
  }
  private queuePending(type: SoundType) {
    if (this.pendingTypes.includes(type)) return;
    if (this.pendingTypes.length >= 6) this.pendingTypes.shift();
    this.pendingTypes.push(type);
  }
  private flushPending() {
    if (!this.pendingTypes.length || !this.context || this.context.state !== 'running') return;
    const wait = this.busyUntil - Date.now();
    if (wait > 0) { window.clearTimeout(this.queueTimer); this.queueTimer = window.setTimeout(() => this.flushPending(), wait + 20); return; }
    const type = this.pendingTypes.shift()!;
    this.playTone(type);
    if (this.pendingTypes.length) {
      window.clearTimeout(this.queueTimer);
      this.queueTimer = window.setTimeout(() => this.flushPending(), Math.max(20, this.busyUntil - Date.now() + 20));
    }
  }
  private playTone(type: SoundType) {
    const context = this.context;
    if (!context || context.state !== 'running') return;
    if (Date.now() < this.busyUntil) {
      this.queuePending(type); window.clearTimeout(this.queueTimer); this.queueTimer = window.setTimeout(() => this.flushPending(), this.busyUntil - Date.now() + 20);
      return;
    }
    const now = context.currentTime;
    const volume = this.preferences.volume * 0.12;
    this.lastPlayed.set(type, Date.now());
    let offset = 0;
    for (const [frequency, duration, waveform] of notes[type]) {
      const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.type = waveform; oscillator.frequency.setValueAtTime(frequency, now + offset);
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), now + offset + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + duration);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(now + offset); oscillator.stop(now + offset + duration + 0.01);
      offset += duration * 0.72;
    }
    this.busyUntil = Date.now() + offset * 1000;
  }
}

export const soundManager = new SoundManager();
