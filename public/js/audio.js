/**
 * مولد نغمات الرنين الصوتي باستخدام Web Audio API المدمجة بالمتصفح
 * الميزة: يعمل تلقائياً دون الحاجة لتحميل ملفات mp3 خارجية قد تفشل في التحميل
 */
class CallSoundSynthesizer {
  constructor() {
    this.audioCtx = null;
    this.ringInterval = null;
    this.isPlaying = false;
  }

  init() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  // نغمة رنين للمكالمات الواردة (نغمة موسيقية هادئة ومبهجة تناسب كبار السن)
  startIncomingRing() {
    this.init();
    if (this.isPlaying) return;
    this.isPlaying = true;

    // نمط الاهتزاز للهواتف الذكية
    if (navigator.vibrate) {
      navigator.vibrate([600, 400, 600, 400, 1000]);
    }

    const playMelody = () => {
      if (!this.isPlaying || !this.audioCtx) return;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      const now = this.audioCtx.currentTime;

      notes.forEach((freq, idx) => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.25);

        gain.gain.setValueAtTime(0, now + idx * 0.25);
        gain.gain.linearRampToValueAtTime(0.3, now + idx * 0.25 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.25 + 0.35);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now + idx * 0.25);
        osc.stop(now + idx * 0.25 + 0.4);
      });
    };

    playMelody();
    this.ringInterval = setInterval(() => {
      if (this.isPlaying) {
        playMelody();
        if (navigator.vibrate) {
          navigator.vibrate([600, 400, 600, 400, 1000]);
        }
      }
    }, 2500);
  }

  // نغمة رنين أثناء انتظار رد الطرف الآخر (Outgoing Ringback Tone)
  startOutgoingRing() {
    this.init();
    if (this.isPlaying) return;
    this.isPlaying = true;

    const playTone = () => {
      if (!this.isPlaying || !this.audioCtx) return;
      const now = this.audioCtx.currentTime;

      // نغمة رنين هاتفية قياسية (440Hz + 480Hz)
      const freqs = [440, 480];
      freqs.forEach(freq => {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.setValueAtTime(0.12, now + 1.2);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 1.3);

        osc.connect(gain);
        gain.connect(this.audioCtx.destination);

        osc.start(now);
        osc.stop(now + 1.35);
      });
    };

    playTone();
    this.ringInterval = setInterval(() => {
      if (this.isPlaying) playTone();
    }, 3000);
  }

  // نغمة تأكيد فتح الخط وبدء المكالمة
  playConnectedChime() {
    this.stopAll();
    this.init();
    if (!this.audioCtx) return;

    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.15); // A5

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  // نغمة إنهاء المكالمة
  playHangupChime() {
    this.stopAll();
    this.init();
    if (!this.audioCtx) return;

    const now = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(400, now);
    osc.frequency.linearRampToValueAtTime(200, now + 0.25);

    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

    osc.connect(gain);
    gain.connect(this.audioCtx.destination);

    osc.start(now);
    osc.stop(now + 0.3);
  }

  // إيقاف جميع الأصوات والاهتزاز
  stopAll() {
    this.isPlaying = false;
    if (this.ringInterval) {
      clearInterval(this.ringInterval);
      this.ringInterval = null;
    }
    if (navigator.vibrate) {
      navigator.vibrate(0);
    }
  }
}

export const callSound = new CallSoundSynthesizer();
