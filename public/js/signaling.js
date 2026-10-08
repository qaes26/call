/**
 * عميل الإشارات المشفر فائق الاستقرار عبر بروتوكول WebSockets المشفر (WSS)
 * يعمل 100% على Netlify دون الحاجة لأي سيرفر خلفي (Serverless WebRTC Signaling)
 */

import { securityManager } from './security.js';

// قائمة خوادم الإشارات السحابية العامة فائقة السرعة والمجانية (مع التبديل التلقائي في حال تعطل أحدها)
const BROKER_URLS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081'
];

export class SignalingClient {
  constructor() {
    this.client = null;
    this.role = null;
    this.roomHash = null;
    this.deviceId = null;
    this.isConnected = false;
    this.currentBrokerIndex = 0;
    this.listeners = new Map();
    this.presenceTimer = null;
    this.lastPresenceMap = new Map(); // جهاز -> آخر وقت تواجد
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(callback);
  }

  emitEvent(event, data) {
    const cbs = this.listeners.get(event) || [];
    cbs.forEach(cb => {
      try {
        cb(data);
      } catch (err) {
        console.error(`[SIGNALING CALLBACK ERROR on '${event}']`, err);
      }
    });
  }

  connect(role, roomHash) {
    this.disconnect();

    this.role = role;
    this.roomHash = roomHash;
    this.deviceId = securityManager.getOrCreateDeviceId();

    const brokerUrl = BROKER_URLS[this.currentBrokerIndex];
    const clientId = `mpc_${this.role}_${Math.random().toString(36).substring(2, 8)}`;

    console.log(`📡 جاري الاتصال بقناة الإشارات المشفرة عبر (${brokerUrl})...`);

    if (typeof mqtt === 'undefined') {
      console.error('مكتبة MQTT غير متوفرة');
      this.emitEvent('connect_error', new Error('MQTT library missing'));
      return;
    }

    try {
      this.client = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        connectTimeout: 8000,
        reconnectPeriod: 3000,
        keepalive: 30
      });

      this.client.on('connect', () => {
        this.isConnected = true;
        console.log('✅ تم الاتصال بقناة الإشارات المشفرة بنجاح');

        // الاشتراك في قنوات العائلة المشفرة
        const presenceTopic = `myparentscall/${this.roomHash}/presence`;
        const peerTopic = `myparentscall/${this.roomHash}/peer/${this.role}`;

        this.client.subscribe([presenceTopic, peerTopic], { qos: 1 }, (err) => {
          if (!err) {
            this.emitEvent('connect');
            this.startPresenceHeartbeat();
          } else {
            console.error('خطأ أثناء الاشتراك في القنوات:', err);
          }
        });
      });

      this.client.on('message', async (topic, messageBuffer) => {
        await this.handleIncomingMessage(topic, messageBuffer.toString());
      });

      this.client.on('error', (err) => {
        console.warn('⚠️ خطأ في اتصال قناة الإشارات:', err);
        this.emitEvent('connect_error', err);
      });

      this.client.on('close', () => {
        if (this.isConnected) {
          this.isConnected = false;
          this.emitEvent('disconnect');
        }
      });

      this.client.on('offline', () => {
        this.tryNextBroker();
      });

    } catch (err) {
      console.error('فشل بدء اتصال الإشارات:', err);
      this.tryNextBroker();
    }
  }

  tryNextBroker() {
    this.currentBrokerIndex = (this.currentBrokerIndex + 1) % BROKER_URLS.length;
    console.log(`جاري تجربة خادم إشارات بديل: ${BROKER_URLS[this.currentBrokerIndex]}`);
  }

  // إرسال نبضات التواجد (Presence Heartbeat)
  startPresenceHeartbeat() {
    if (this.presenceTimer) clearInterval(this.presenceTimer);

    const sendPing = async () => {
      if (!this.isConnected) return;
      await this.sendDirectMessage('presence', {
        type: 'presence_ping',
        role: this.role,
        deviceId: this.deviceId,
        timestamp: Date.now()
      }, true); // نشر على قناة التواجد العامة للغرفة
    };

    sendPing();
    this.presenceTimer = setInterval(sendPing, 4000);

    // فحص دوري للأجهزة التي انقطع اتصالها
    setInterval(() => {
      this.evaluatePresence();
    }, 3000);
  }

  evaluatePresence() {
    const now = Date.now();
    const presenceStatus = {
      father: false,
      mother: false,
      child: false
    };

    for (const [key, record] of this.lastPresenceMap.entries()) {
      if (now - record.timestamp < 10000) { // نشط خلال آخر 10 ثوانٍ
        presenceStatus[record.role] = true;
      }
    }

    this.emitEvent('presence-update', presenceStatus);
  }

  // إرسال رسالة مشفرة إلى طرف معين أو للغرفة كاملة
  async sendDirectMessage(targetRole, payload, isPresence = false) {
    if (!this.client || !this.isConnected) return;

    try {
      const fullPayload = {
        ...payload,
        fromRole: this.role,
        fromDevice: this.deviceId,
        timestamp: Date.now()
      };

      // تشفير الرسالة بالكامل باستخدام AES-256-GCM ومفتاح الـ PIN
      const encryptedBase64 = await securityManager.encryptPayload(fullPayload);

      const topic = isPresence 
        ? `myparentscall/${this.roomHash}/presence`
        : `myparentscall/${this.roomHash}/peer/${targetRole}`;

      this.client.publish(topic, encryptedBase64, { qos: 1 });
    } catch (err) {
      console.error('[SIGNALING SEND ERROR]', err);
    }
  }

  // معالجة الرسائل المستلمة وفك تشفيرها
  async handleIncomingMessage(topic, cipherText) {
    try {
      const data = await securityManager.decryptPayload(cipherText);
      if (!data) return; // فشل فك التشفير (PIN مختلف أو بيانات تالفة)

      // تجاهل الرسائل الصادرة من نفس الجهاز
      if (data.fromDevice === this.deviceId) return;

      if (data.type === 'presence_ping') {
        this.lastPresenceMap.set(`${data.role}_${data.deviceId}`, {
          role: data.role,
          timestamp: data.timestamp || Date.now()
        });
        this.evaluatePresence();
        return;
      }

      // تحويل الرسائل لأحداث متطابقة
      switch (data.type) {
        case 'call_request':
          this.emitEvent('incoming-call', {
            callerRole: data.fromRole,
            callerName: data.callerName,
            callerDeviceId: data.fromDevice
          });
          break;

        case 'call_accepted':
          this.emitEvent('call-accepted', {
            targetRole: data.fromRole,
            targetDeviceId: data.fromDevice
          });
          break;

        case 'call_rejected':
          this.emitEvent('call-rejected', {
            targetRole: data.fromRole,
            reason: data.reason || 'تم رفض المكالمة'
          });
          break;

        case 'webrtc_offer':
          this.emitEvent('webrtc-offer', {
            fromRole: data.fromRole,
            sdp: data.sdp
          });
          break;

        case 'webrtc_answer':
          this.emitEvent('webrtc-answer', {
            fromRole: data.fromRole,
            sdp: data.sdp
          });
          break;

        case 'ice_candidate':
          this.emitEvent('ice-candidate', {
            fromRole: data.fromRole,
            candidate: data.candidate
          });
          break;

        case 'call_hangup':
          this.emitEvent('call-ended', {
            fromRole: data.fromRole,
            reason: data.reason || 'تم إنهاء المكالمة'
          });
          break;

        default:
          break;
      }
    } catch (err) {
      console.error('[SIGNALING MESSAGE PROCESSING ERROR]', err);
    }
  }

  // دوال الإرسال المباشرة لمطابقة واجهة التطبيق
  emit(event, data = {}) {
    switch (event) {
      case 'call-user':
        this.sendDirectMessage(data.targetRole, {
          type: 'call_request',
          callerName: data.callerName
        });
        break;

      case 'accept-call':
        this.sendDirectMessage(data.targetRole, {
          type: 'call_accepted'
        });
        break;

      case 'reject-call':
        this.sendDirectMessage(data.targetRole, {
          type: 'call_rejected',
          reason: data.reason
        });
        break;

      case 'webrtc-offer':
        this.sendDirectMessage(data.targetRole, {
          type: 'webrtc_offer',
          sdp: data.sdp
        });
        break;

      case 'webrtc-answer':
        this.sendDirectMessage(data.targetRole, {
          type: 'webrtc_answer',
          sdp: data.sdp
        });
        break;

      case 'ice-candidate':
        this.sendDirectMessage(data.targetRole, {
          type: 'ice_candidate',
          candidate: data.candidate
        });
        break;

      case 'hangup-call':
        if (data.targetRole) {
          this.sendDirectMessage(data.targetRole, {
            type: 'call_hangup',
            reason: 'انتهت المكالمة'
          });
        }
        break;

      default:
        break;
    }
  }

  disconnect() {
    if (this.presenceTimer) {
      clearInterval(this.presenceTimer);
      this.presenceTimer = null;
    }
    if (this.client) {
      try {
        this.client.end(true);
      } catch (e) {}
      this.client = null;
    }
    this.isConnected = false;
    this.lastPresenceMap.clear();
  }
}

export const signalingClient = new SignalingClient();
