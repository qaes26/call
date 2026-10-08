import { securityManager } from './security.js';
import { signalingClient } from './signaling.js';
import { WebRTCConnection } from './webrtc.js';
import { callSound } from './audio.js';

// نصوص وترجمة الأدوار باللغة العربية المخصصة لعائلة قيس
const ROLE_NAMES = {
  father: 'الوالد الحبيب (أبي)',
  mother: 'الوالدة الحبيبة (أمي)',
  child: 'قيس (الابن)'
};

const ROLE_AVATARS = {
  father: '👨',
  mother: '👵',
  child: '👦'
};

class FamilyCallApp {
  constructor() {
    this.currentRole = null;
    this.webrtc = null;
    this.activeCallTarget = null;
    this.pendingIncomingCall = null;
    this.callTimerInterval = null;
    this.callSeconds = 0;
    this.isMicMuted = false;
    this.isVideoOff = false;
    this.wakeLock = null;

    this.presence = {
      father: false,
      mother: false,
      child: false
    };

    this.cacheDOMElements();
    this.bindEvents();
    this.init();
  }

  cacheDOMElements() {
    // الشاشات
    this.authScreen = document.getElementById('authScreen');
    this.mainScreen = document.getElementById('mainScreen');
    this.childDashboard = document.getElementById('childDashboard');
    this.parentDashboard = document.getElementById('parentDashboard');
    
    // شريط الرأس
    this.roleBadge = document.getElementById('roleBadge');
    this.connectionBadge = document.getElementById('connectionBadge');
    this.btnSwitchProfile = document.getElementById('btnSwitchProfile');
    
    // نموذج المصادقة
    this.authForm = document.getElementById('authForm');
    this.pinInput = document.getElementById('pinInput');
    this.btnLogin = document.getElementById('btnLogin');
    this.btnTogglePin = document.getElementById('btnTogglePin');
    
    // عناصر الشاشة الرئيسية
    this.parentGreetingTitle = document.getElementById('parentGreetingTitle');
    this.fatherStatusBadge = document.getElementById('fatherStatusBadge');
    this.motherStatusBadge = document.getElementById('motherStatusBadge');
    this.childStatusBadge = document.getElementById('childStatusBadge');
    
    this.btnCallFather = document.getElementById('btnCallFather');
    this.btnCallMother = document.getElementById('btnCallMother');
    this.btnParentCallChild = document.getElementById('btnParentCallChild');

    // نوافذ الاتصال
    this.outgoingCallModal = document.getElementById('outgoingCallModal');
    this.outgoingAvatar = document.getElementById('outgoingAvatar');
    this.outgoingTargetName = document.getElementById('outgoingTargetName');
    this.btnCancelCall = document.getElementById('btnCancelCall');

    this.incomingCallModal = document.getElementById('incomingCallModal');
    this.incomingCallerName = document.getElementById('incomingCallerName');
    this.incomingCallerAvatar = document.getElementById('incomingCallerAvatar');
    this.btnAcceptCall = document.getElementById('btnAcceptCall');
    this.btnRejectCall = document.getElementById('btnRejectCall');

    // شاشة المكالمة الجارية الكاملة
    this.activeCallScreen = document.getElementById('activeCallScreen');
    this.remoteVideo = document.getElementById('remoteVideo');
    this.localVideo = document.getElementById('localVideo');
    this.remoteVideoPlaceholder = document.getElementById('remoteVideoPlaceholder');
    this.callTimer = document.getElementById('callTimer');
    this.peerNameHeader = document.getElementById('peerNameHeader');
    this.localMuteIndicator = document.getElementById('localMuteIndicator');

    // أزرار التحكم بالمكالمة
    this.btnToggleMic = document.getElementById('btnToggleMic');
    this.btnToggleCam = document.getElementById('btnToggleCam');
    this.btnFlipCam = document.getElementById('btnFlipCam');
    this.btnHangup = document.getElementById('btnHangup');

    // التنبيه العائم
    this.toastBox = document.getElementById('toastNotification');
    this.toastText = document.getElementById('toastText');
  }

  bindEvents() {
    // تبديل إظهار الرمز السري
    this.btnTogglePin.addEventListener('click', () => {
      this.triggerHaptic(15);
      this.pinInput.type = this.pinInput.type === 'password' ? 'text' : 'password';
    });

    // تسجيل الدخول
    this.btnLogin.addEventListener('click', () => {
      this.triggerHaptic(25);
      this.handleLogin();
    });
    this.pinInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.triggerHaptic(25);
        this.handleLogin();
      }
    });

    // تبديل الحساب
    this.btnSwitchProfile.addEventListener('click', () => {
      this.triggerHaptic(20);
      this.switchProfile();
    });

    // أزرار بدء الاتصال
    this.btnCallFather.addEventListener('click', () => {
      this.triggerHaptic(40);
      this.startCall('father');
    });
    this.btnCallMother.addEventListener('click', () => {
      this.triggerHaptic(40);
      this.startCall('mother');
    });
    this.btnParentCallChild.addEventListener('click', () => {
      this.triggerHaptic(50);
      this.startCall('child');
    });

    // إلغاء الاتصال الصادر
    this.btnCancelCall.addEventListener('click', () => {
      this.triggerHaptic(30);
      this.cancelOutgoingCall();
    });

    // الرد على المكالمة الواردة أو رفضها
    this.btnAcceptCall.addEventListener('click', () => {
      this.triggerHaptic(60);
      this.acceptIncomingCall();
    });
    this.btnRejectCall.addEventListener('click', () => {
      this.triggerHaptic(30);
      this.rejectIncomingCall();
    });

    // أزرار المكالمة الجارية
    this.btnHangup.addEventListener('click', () => {
      this.triggerHaptic(50);
      this.hangupCall();
    });
    this.btnToggleMic.addEventListener('click', () => {
      this.triggerHaptic(20);
      this.toggleMic();
    });
    this.btnToggleCam.addEventListener('click', () => {
      this.triggerHaptic(20);
      this.toggleCam();
    });
    this.btnFlipCam.addEventListener('click', () => {
      this.triggerHaptic(30);
      this.flipCam();
    });
  }

  // اهتزاز لمسي خفيف للهاتف
  triggerHaptic(duration = 20) {
    if (navigator.vibrate) {
      try { navigator.vibrate(duration); } catch (e) {}
    }
  }

  // إبقاء شاشة الهاتف مضاءة أثناء المكالمة
  async acquireWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
      } catch (err) {
        console.warn('WakeLock غير مفعل:', err);
      }
    }
  }

  releaseWakeLock() {
    if (this.wakeLock) {
      try { this.wakeLock.release(); } catch (e) {}
      this.wakeLock = null;
    }
  }

  async init() {
    securityManager.checkSecureContext();

    // تسجيل Service Worker للتثبيت كتطبيق أصلي PWA
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }

    const savedPin = securityManager.getSavedPin();
    const savedRole = securityManager.getSavedRole();

    if (savedPin && savedRole) {
      try {
        const authData = await securityManager.authenticate(savedPin, savedRole);
        this.currentRole = savedRole;
        this.showMainScreen();
        this.connectSignalingServer(savedRole, authData.roomHash);
      } catch (err) {
        console.error('فشل استرجاع الجلسة السابقة:', err);
        this.showAuthScreen();
      }
    } else {
      this.showAuthScreen();
    }
  }

  showToast(message, duration = 4000) {
    this.toastText.textContent = message;
    this.toastBox.classList.add('show');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toastBox.classList.remove('show');
    }, duration);
  }

  showAuthScreen() {
    this.authScreen.classList.add('active');
    this.mainScreen.classList.remove('active');
    this.roleBadge.textContent = 'غير مسجل';
    this.setConnectionState(false);
  }

  showMainScreen() {
    this.authScreen.classList.remove('active');
    this.mainScreen.classList.add('active');

    this.roleBadge.textContent = ROLE_NAMES[this.currentRole] || this.currentRole;

    if (this.currentRole === 'child') {
      this.childDashboard.style.display = 'flex';
      this.parentDashboard.style.display = 'none';
    } else {
      this.childDashboard.style.display = 'none';
      this.parentDashboard.style.display = 'flex';
      this.parentGreetingTitle.textContent = this.currentRole === 'father' 
        ? 'أهلاً بك يا أبي الغالي 👨' 
        : 'أهلاً بك يا أمي الحبيبة 👵';
    }
  }

  async handleLogin() {
    const selectedRoleInput = document.querySelector('input[name="userRole"]:checked');
    const role = selectedRoleInput ? selectedRoleInput.value : 'child';
    const pin = this.pinInput.value.trim();

    if (!pin) {
      this.showToast('يرجى إدخال الرمز السري الخاص بك');
      this.pinInput.focus();
      return;
    }

    this.btnLogin.disabled = true;
    this.btnLogin.textContent = 'جاري التحقق والتفعيل...';

    try {
      const data = await securityManager.authenticate(pin, role);
      this.currentRole = role;
      this.pinInput.value = '';
      this.showMainScreen();
      this.connectSignalingServer(role, data.roomHash);
      this.showToast(`مرحباً بك! تم التفعيل بنجاح كـ ${data.name}`);
    } catch (err) {
      console.error('[LOGIN ERROR]:', err);
      this.showToast(err.message || 'فشل تسجيل الدخول');
    } finally {
      this.btnLogin.disabled = false;
      this.btnLogin.innerHTML = `<span>تسجيل الدخول والتفعيل</span> <span class="arrow-icon">⬅️</span>`;
    }
  }

  switchProfile() {
    if (confirm('هل تريد تسجيل الخروج وتغيير هوية المستخدم؟')) {
      signalingClient.disconnect();
      securityManager.clearSession();
      this.currentRole = null;
      this.showAuthScreen();
    }
  }

  // ===========================================================================
  // خادم الإشارات المشفر E2EE
  // ===========================================================================
  connectSignalingServer(role, roomHash) {
    signalingClient.connect(role, roomHash);

    signalingClient.on('connect', () => {
      this.setConnectionState(true);
      console.log('✅ متصل بقناة الإشارات المشفرة بنجاح');
    });

    signalingClient.on('connect_error', (err) => {
      this.setConnectionState(false);
      console.error('❌ خطأ في اتصال قناة الإشارات:', err);
    });

    signalingClient.on('disconnect', () => {
      this.setConnectionState(false);
    });

    // تحديث حالة ظهور وتواجد أفراد العائلة
    signalingClient.on('presence-update', (presenceData) => {
      this.presence = presenceData;
      this.updatePresenceUI();
    });

    // استقبال مكالمة واردة
    signalingClient.on('incoming-call', (data) => {
      this.handleIncomingCall(data);
    });

    // تم قبول المكالمة من الطرف الآخر
    signalingClient.on('call-accepted', (data) => {
      this.handleCallAccepted(data);
    });

    // تم رفض المكالمة
    signalingClient.on('call-rejected', (data) => {
      this.handleCallRejected(data);
    });

    // استقبال عروض وإجابات WebRTC
    signalingClient.on('webrtc-offer', (data) => {
      this.handleRemoteOffer(data);
    });

    signalingClient.on('webrtc-answer', (data) => {
      this.handleRemoteAnswer(data);
    });

    signalingClient.on('ice-candidate', (data) => {
      this.handleRemoteIceCandidate(data);
    });

    // انتهاء المكالمة
    signalingClient.on('call-ended', (data) => {
      this.handleCallEnded(data);
    });
  }

  setConnectionState(isConnected) {
    if (isConnected) {
      this.connectionBadge.className = 'badge-status connected';
      this.connectionBadge.querySelector('.status-text').textContent = 'متصل';
    } else {
      this.connectionBadge.className = 'badge-status disconnected';
      this.connectionBadge.querySelector('.status-text').textContent = 'غير متصل';
    }
  }

  updatePresenceUI() {
    // تحديث كارت الوالد
    if (this.fatherStatusBadge) {
      if (this.presence.father) {
        this.fatherStatusBadge.className = 'live-status-pill online';
        this.fatherStatusBadge.querySelector('.status-label').textContent = 'متاح الآن';
      } else {
        this.fatherStatusBadge.className = 'live-status-pill offline';
        this.fatherStatusBadge.querySelector('.status-label').textContent = 'غير متصل';
      }
    }

    // تحديث كارت الوالدة
    if (this.motherStatusBadge) {
      if (this.presence.mother) {
        this.motherStatusBadge.className = 'live-status-pill online';
        this.motherStatusBadge.querySelector('.status-label').textContent = 'متاحة الآن';
      } else {
        this.motherStatusBadge.className = 'live-status-pill offline';
        this.motherStatusBadge.querySelector('.status-label').textContent = 'غير متصلة';
      }
    }

    // تحديث شارة قيس في وضع الوالدين
    if (this.childStatusBadge) {
      if (this.presence.child) {
        this.childStatusBadge.className = 'live-status-pill online';
        this.childStatusBadge.querySelector('.status-label').textContent = 'قيس متاح الآن 🟢';
      } else {
        this.childStatusBadge.className = 'live-status-pill offline';
        this.childStatusBadge.querySelector('.status-label').textContent = 'قيس غير متصل حالياً';
      }
    }
  }

  // ===========================================================================
  // بدء وإدارة دورة حياة المكالمة (Call Lifecycle Management)
  // ===========================================================================

  async prepareWebRTC() {
    if (!this.webrtc) {
      this.webrtc = new WebRTCConnection({
        onRemoteStream: (stream) => {
          this.remoteVideo.srcObject = stream;
          this.remoteVideoPlaceholder.classList.add('hidden');
        },
        onConnectionStateChange: (state) => {
          console.log(`[WEBRTC CONNECTION STATE]: ${state}`);
          if (state === 'connected') {
            console.log('✅ تم الاتصال المباشر بنجاح عبر الإنترنت/4G');
          } else if (state === 'failed') {
            console.warn('⚠️ محاولة إعادة الربط (ICE Restart)...');
            if (this.webrtc) this.webrtc.restartIce();
          }
        },
        onIceCandidate: (candidate) => {
          if (this.activeCallTarget && candidate) {
            signalingClient.emit('ice-candidate', {
              targetRole: this.activeCallTarget,
              candidate: candidate.toJSON ? candidate.toJSON() : candidate
            });
          }
        }
      });
    }

    // فتح الكاميرا والمايكروفون
    const localStream = await this.webrtc.startLocalMedia({ video: true, audio: true });
    this.localVideo.srcObject = localStream;

    // جلب خوادم STUN و TURN المشفرة (تتخطى شبكات 4G و NAT)
    const iceServers = securityManager.getIceServers();
    this.webrtc.initializePeerConnection(iceServers);

    // تفريغ أي مرشحات ICE وصلت مبكراً
    if (this.earlyIceCandidatesQueue && this.earlyIceCandidatesQueue.length > 0) {
      for (const cand of this.earlyIceCandidatesQueue) {
        await this.webrtc.addIceCandidate(cand);
      }
      this.earlyIceCandidatesQueue = [];
    }
  }

  // 1. بدء الاتصال (Caller)
  async startCall(targetRole) {
    if (!signalingClient.isConnected) {
      this.showToast('أنت غير متصل بالشبكة حالياً، يرجى الانتظار ثوانٍ.');
      return;
    }

    this.activeCallTarget = targetRole;

    try {
      this.outgoingAvatar.textContent = ROLE_AVATARS[targetRole] || '👤';
      this.outgoingTargetName.textContent = `جاري الاتصال بـ ${ROLE_NAMES[targetRole] || targetRole}...`;
      this.outgoingCallModal.classList.add('active');

      callSound.startOutgoingRing();

      // إعداد الوسائط مسبقاً لجعل الرد فورياً وبدون أي تأخير
      await this.prepareWebRTC();

      // إرسال طلب المكالمة المشفر عبر قناة الإشارات
      signalingClient.emit('call-user', {
        targetRole,
        callerName: ROLE_NAMES[this.currentRole] || this.currentRole
      });
    } catch (err) {
      console.error('[START CALL ERROR]:', err);
      callSound.stopAll();
      this.outgoingCallModal.classList.remove('active');
      this.showToast('تعذر فتح الكاميرا أو المايكروفون. يرجى إعطاء الصلاحية للمتصفح.');
      this.cleanupWebRTC();
    }
  }

  cancelOutgoingCall() {
    callSound.stopAll();
    this.outgoingCallModal.classList.remove('active');
    if (this.activeCallTarget) {
      signalingClient.emit('hangup-call', { targetRole: this.activeCallTarget });
    }
    this.cleanupWebRTC();
    this.activeCallTarget = null;
  }

  // 2. معالجة المكالمة الواردة (Callee)
  handleIncomingCall(data) {
    // إذا كان مشغولاً بمكالمة أخرى
    if (this.activeCallTarget) {
      signalingClient.emit('reject-call', {
        targetRole: data.callerRole,
        reason: 'الخط مشغول بمكالمة أخرى'
      });
      return;
    }

    this.pendingIncomingCall = data;
    this.activeCallTarget = data.callerRole;

    this.incomingCallerAvatar.textContent = ROLE_AVATARS[data.callerRole] || '👤';
    this.incomingCallerName.textContent = `مكالمة واردة من ${ROLE_NAMES[data.callerRole] || data.callerRole}`;
    this.incomingCallModal.classList.add('active');

    callSound.startIncomingRing();
  }

  // قبول المكالمة الواردة
  async acceptIncomingCall() {
    callSound.stopAll();
    callSound.playConnectedChime();
    this.incomingCallModal.classList.remove('active');

    try {
      await this.prepareWebRTC();

      // إرسال إشعار القبول إلى المتصل
      signalingClient.emit('accept-call', {
        targetRole: this.activeCallTarget
      });

      this.showActiveCallScreen();
    } catch (err) {
      console.error('[ACCEPT CALL ERROR]:', err);
      this.showToast('تعذر تشغيل الكاميرا للرد على المكالمة');
      this.rejectIncomingCall();
    }
  }

  // رفض المكالمة الواردة
  rejectIncomingCall() {
    callSound.stopAll();
    this.incomingCallModal.classList.remove('active');

    if (this.activeCallTarget) {
      signalingClient.emit('reject-call', {
        targetRole: this.activeCallTarget,
        reason: 'تم رفض المكالمة'
      });
    }

    this.cleanupWebRTC();
    this.activeCallTarget = null;
    this.pendingIncomingCall = null;
  }

  // 3. المتصل يتلقى إشعار القبول ويبدأ الـ Offer
  async handleCallAccepted(data) {
    callSound.stopAll();
    callSound.playConnectedChime();
    this.outgoingCallModal.classList.remove('active');

    this.showActiveCallScreen();

    try {
      if (!this.webrtc || !this.webrtc.peerConnection) {
        await this.prepareWebRTC();
      }

      // تفريغ أي مرشحات وصلت قبل تجهيز الـ Offer
      if (this.earlyIceCandidatesQueue && this.earlyIceCandidatesQueue.length > 0) {
        for (const cand of this.earlyIceCandidatesQueue) {
          await this.webrtc.addIceCandidate(cand);
        }
        this.earlyIceCandidatesQueue = [];
      }

      const offer = await this.webrtc.createOffer();
      signalingClient.emit('webrtc-offer', {
        targetRole: this.activeCallTarget,
        sdp: offer
      });
    } catch (err) {
      console.error('[OFFER CREATION ERROR]:', err);
      this.showToast('حدث خطأ في تأسيس اتصال الوسائط');
      this.hangupCall();
    }
  }

  handleCallRejected(data) {
    callSound.stopAll();
    callSound.playHangupChime();
    this.outgoingCallModal.classList.remove('active');
    this.showToast(data.reason || 'تم رفض المكالمة من الطرف الآخر');
    this.cleanupWebRTC();
    this.activeCallTarget = null;
  }

  // تبادل حزم SDP المشفرة
  async handleRemoteOffer(data) {
    try {
      if (!this.webrtc || !this.webrtc.peerConnection) {
        await this.prepareWebRTC();
      }
      const answer = await this.webrtc.handleOfferAndCreateAnswer(data.sdp);
      signalingClient.emit('webrtc-answer', {
        targetRole: data.fromRole,
        sdp: answer
      });

      // تفريغ المرشحات بعد استلام العرض
      if (this.earlyIceCandidatesQueue && this.earlyIceCandidatesQueue.length > 0) {
        for (const cand of this.earlyIceCandidatesQueue) {
          await this.webrtc.addIceCandidate(cand);
        }
        this.earlyIceCandidatesQueue = [];
      }
    } catch (err) {
      console.error('[HANDLE OFFER ERROR]:', err);
    }
  }

  async handleRemoteAnswer(data) {
    try {
      await this.webrtc.handleAnswer(data.sdp);

      // تفريغ المرشحات بعد تثبيت الإجابة
      if (this.earlyIceCandidatesQueue && this.earlyIceCandidatesQueue.length > 0) {
        for (const cand of this.earlyIceCandidatesQueue) {
          await this.webrtc.addIceCandidate(cand);
        }
        this.earlyIceCandidatesQueue = [];
      }
    } catch (err) {
      console.error('[HANDLE ANSWER ERROR]:', err);
    }
  }

  async handleRemoteIceCandidate(data) {
    try {
      if (!this.webrtc || !this.webrtc.peerConnection) {
        if (!this.earlyIceCandidatesQueue) this.earlyIceCandidatesQueue = [];
        this.earlyIceCandidatesQueue.push(data.candidate);
        return;
      }
      await this.webrtc.addIceCandidate(data.candidate);
    } catch (err) {
      console.error('[HANDLE ICE ERROR]:', err);
    }
  }

  // إنهاء المكالمة
  hangupCall() {
    callSound.playHangupChime();

    if (this.activeCallTarget) {
      signalingClient.emit('hangup-call', { targetRole: this.activeCallTarget });
    }

    this.handleCallEnded({ fromRole: this.activeCallTarget });
  }

  handleCallEnded(data) {
    callSound.stopAll();
    this.outgoingCallModal.classList.remove('active');
    this.incomingCallModal.classList.remove('active');
    this.activeCallScreen.classList.remove('active');

    this.stopCallTimer();
    this.releaseWakeLock();
    this.cleanupWebRTC();
    this.activeCallTarget = null;
    this.pendingIncomingCall = null;

    this.showToast('انتهت المكالمة');
  }

  cleanupWebRTC() {
    this.earlyIceCandidatesQueue = [];
    if (this.webrtc) {
      this.webrtc.close();
      this.webrtc = null;
    }
    if (this.localVideo) this.localVideo.srcObject = null;
    if (this.remoteVideo) this.remoteVideo.srcObject = null;
  }

  // ===========================================================================
  // التحكم داخل المكالمة والشاشات
  // ===========================================================================

  showActiveCallScreen() {
    this.peerNameHeader.textContent = ROLE_NAMES[this.activeCallTarget] || this.activeCallTarget;
    this.activeCallScreen.classList.add('active');
    this.startCallTimer();
    this.acquireWakeLock();
    
    // إعادة تعيين أزرار التحكم
    this.isMicMuted = false;
    this.isVideoOff = false;
    this.btnToggleMic.classList.remove('muted');
    this.btnToggleCam.classList.remove('off');
    this.localMuteIndicator.classList.add('hidden');
  }

  startCallTimer() {
    this.stopCallTimer();
    this.callSeconds = 0;
    this.callTimer.textContent = '00:00';

    this.callTimerInterval = setInterval(() => {
      this.callSeconds += 1;
      const mins = String(Math.floor(this.callSeconds / 60)).padStart(2, '0');
      const secs = String(this.callSeconds % 60).padStart(2, '0');
      this.callTimer.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  stopCallTimer() {
    if (this.callTimerInterval) {
      clearInterval(this.callTimerInterval);
      this.callTimerInterval = null;
    }
  }

  toggleMic() {
    if (!this.webrtc) return;
    this.isMicMuted = !this.isMicMuted;
    this.webrtc.toggleAudio(!this.isMicMuted);

    if (this.isMicMuted) {
      this.btnToggleMic.classList.add('muted');
      this.btnToggleMic.querySelector('.btn-icon-symbol').textContent = '🔇';
      this.localMuteIndicator.classList.remove('hidden');
    } else {
      this.btnToggleMic.classList.remove('muted');
      this.btnToggleMic.querySelector('.btn-icon-symbol').textContent = '🎙️';
      this.localMuteIndicator.classList.add('hidden');
    }
  }

  toggleCam() {
    if (!this.webrtc) return;
    this.isVideoOff = !this.isVideoOff;
    this.webrtc.toggleVideo(!this.isVideoOff);

    if (this.isVideoOff) {
      this.btnToggleCam.classList.add('off');
      this.btnToggleCam.querySelector('.btn-icon-symbol').textContent = '🚫';
    } else {
      this.btnToggleCam.classList.remove('off');
      this.btnToggleCam.querySelector('.btn-icon-symbol').textContent = '📹';
    }
  }

  async flipCam() {
    if (!this.webrtc) return;
    this.btnFlipCam.style.transform = 'rotate(180deg)';
    await this.webrtc.flipCamera();
    setTimeout(() => {
      this.btnFlipCam.style.transform = 'none';
    }, 300);
  }
}

// تشغيل التطبيق بمجرد اكتمال تحميل الصفحة
window.addEventListener('DOMContentLoaded', () => {
  window.app = new FamilyCallApp();
});
