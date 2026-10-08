/**
 * محرك WebRTC للاتصال الصوتي والمرئي عالي الأمان ومقاوم للتقطيع
 * (WebRTC PeerConnection Engine with DTLS-SRTP & ICE Queueing)
 */

export class WebRTCConnection {
  constructor({ onRemoteStream, onConnectionStateChange, onIceCandidate }) {
    this.peerConnection = null;
    this.localStream = null;
    this.remoteStream = null;
    this.iceCandidateQueue = [];
    this.isRemoteDescriptionSet = false;
    this.currentFacingMode = 'user'; // 'user' (أمامية) أو 'environment' (خلفية)

    this.onRemoteStream = onRemoteStream;
    this.onConnectionStateChange = onConnectionStateChange;
    this.onIceCandidate = onIceCandidate;
  }

  // تهيئة مسارات الوسائط المحلية (الكاميرا والمايكروفون)
  async startLocalMedia(constraints = { video: true, audio: true }) {
    const defaultConstraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 },
        facingMode: this.currentFacingMode
      }
    };

    const finalConstraints = {
      audio: constraints.audio ? defaultConstraints.audio : false,
      video: constraints.video ? defaultConstraints.video : false
    };

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia(finalConstraints);
      return this.localStream;
    } catch (err) {
      console.error('[WEBRTC MEDIA ERROR] فشل الوصول إلى الكاميرا أو المايكروفون:', err);
      // إذا فشلت الكاميرا، نحاول تشغيل الصوت فقط كإجراء احتياطي
      if (constraints.video) {
        console.warn('جاري محاولة فتح تدفق الصوت فقط...');
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: defaultConstraints.audio,
          video: false
        });
        return this.localStream;
      }
      throw err;
    }
  }

  // تبديل الكاميرا (الأمامية / الخلفية) في الأجهزة الذكية
  async flipCamera() {
    if (!this.localStream) return;
    this.currentFacingMode = this.currentFacingMode === 'user' ? 'environment' : 'user';

    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.stop();
      this.localStream.removeTrack(videoTrack);
    }

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { exact: this.currentFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      const newVideoTrack = newStream.getVideoTracks()[0];
      this.localStream.addTrack(newVideoTrack);

      // استبدال المسار في اتصال الـ Peer دون قطع المكالمة (Renegotiation-less sender replace)
      if (this.peerConnection) {
        const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
          sender.replaceTrack(newVideoTrack);
        }
      }

      return this.localStream;
    } catch (err) {
      console.warn('تعذر التبديل للكاميرا الأخرى:', err);
      // الرجوع للوضع الأصلي
      this.currentFacingMode = 'user';
    }
  }

  // كتم أو تشغيل المايكروفون
  toggleAudio(enabled) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  // إيقاف أو تشغيل بث الفيديو
  toggleVideo(enabled) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
    }
  }

  // تهيئة اتصال الـ RTCPeerConnection مع خوادم ICE المشفرة
  initializePeerConnection(iceServers) {
    this.closePeerConnection();

    const rtcConfig = {
      iceServers: iceServers || [{ urls: 'stun:stun.l.google.com:19302' }],
      iceCandidatePoolSize: 10,
      bundlePolicy: 'max-bundle',
      rtcpMuxPolicy: 'require' // فرض دمج RTCP لمزيد من الأمان وتخفيض المنافذ
    };

    this.peerConnection = new RTCPeerConnection(rtcConfig);
    this.remoteStream = new MediaStream();
    this.isRemoteDescriptionSet = false;
    this.iceCandidateQueue = [];

    // إضافة المسارات الصوتية والمرئية المحلية للاتصال المشفر
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.localStream);
      });
    }

    // استقبال مسارات الصوت والصورة من الطرف الآخر
    this.peerConnection.ontrack = (event) => {
      event.streams[0].getTracks().forEach(track => {
        this.remoteStream.addTrack(track);
      });
      if (this.onRemoteStream) {
        this.onRemoteStream(this.remoteStream);
      }
    };

    // إرسال مرشحات ICE إلى خادم الإشارات
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.onIceCandidate) {
        this.onIceCandidate(event.candidate);
      }
    };

    // مراقبة جودة وحالة الاتصال المشفر
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log(`[WEBRTC STATE]: ${state}`);
      if (this.onConnectionStateChange) {
        this.onConnectionStateChange(state);
      }
    };

    this.peerConnection.oniceconnectionstatechange = () => {
      const iceState = this.peerConnection.iceConnectionState;
      console.log(`[WEBRTC ICE STATE]: ${iceState}`);
      if (iceState === 'failed') {
        // محاولة استئناف الاتصال تلقائياً (ICE Restart)
        this.restartIce();
      }
    };
  }

  // إنشاء وإرسال العرض (Create Offer)
  async createOffer() {
    if (!this.peerConnection) throw new Error('PeerConnection not initialized');

    const offer = await this.peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });

    await this.peerConnection.setLocalDescription(offer);
    return offer;
  }

  // معالجة العرض وإنشاء الإجابة (Handle Offer & Create Answer)
  async handleOfferAndCreateAnswer(offerSdp) {
    if (!this.peerConnection) throw new Error('PeerConnection not initialized');

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offerSdp));
    this.isRemoteDescriptionSet = true;
    await this.flushQueuedCandidates();

    const answer = await this.peerConnection.createAnswer();
    await this.peerConnection.setLocalDescription(answer);
    return answer;
  }

  // تثبيت الإجابة المستلمة (Set Remote Answer)
  async handleAnswer(answerSdp) {
    if (!this.peerConnection) return;

    await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answerSdp));
    this.isRemoteDescriptionSet = true;
    await this.flushQueuedCandidates();
  }

  // إضافة مرشح ICE مع التخزين المؤقت (Safe ICE Candidate Handling)
  async addIceCandidate(candidateData) {
    if (!candidateData || !candidateData.candidate) return;

    const candidate = new RTCIceCandidate(candidateData);

    if (this.peerConnection && this.isRemoteDescriptionSet) {
      try {
        await this.peerConnection.addIceCandidate(candidate);
      } catch (err) {
        console.warn('[ICE ERROR] فشل إضافة مرشح:', err);
      }
    } else {
      // تخزين المرشح مؤقتاً لحين تعيين remoteDescription وتفادي خطأ WebRTC الشهير
      this.iceCandidateQueue.push(candidate);
    }
  }

  async flushQueuedCandidates() {
    while (this.iceCandidateQueue.length > 0) {
      const candidate = this.iceCandidateQueue.shift();
      try {
        await this.peerConnection.addIceCandidate(candidate);
      } catch (err) {
        console.warn('[ICE FLUSH ERROR] فشل تفريغ مرشح مخزن:', err);
      }
    }
  }

  async restartIce() {
    if (!this.peerConnection) return;
    try {
      console.log('🔄 جاري محاولة إعادة تأسيس مسار ICE (ICE Restart)...');
      const offer = await this.peerConnection.createOffer({ iceRestart: true });
      await this.peerConnection.setLocalDescription(offer);
    } catch (err) {
      console.error('فشل الـ ICE Restart:', err);
    }
  }

  // إغلاق الاتصال وتحرير المايكروفون والكاميرا فوراً
  close() {
    this.closePeerConnection();

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        track.stop();
      });
      this.localStream = null;
    }
    this.remoteStream = null;
  }

  closePeerConnection() {
    if (this.peerConnection) {
      this.peerConnection.ontrack = null;
      this.peerConnection.onicecandidate = null;
      this.peerConnection.onconnectionstatechange = null;
      this.peerConnection.oniceconnectionstatechange = null;
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.isRemoteDescriptionSet = false;
    this.iceCandidateQueue = [];
  }
}
