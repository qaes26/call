/**
 * إدارة الأمان والتشفير الشامل (E2EE) وتوثيق أفراد عائلة قيس
 * متوافق 100% مع Netlify بدون أي سيرفر
 */

// كلمات السر المحددة لكل فرد من أفراد العائلة
const FAMILY_MEMBERS_PINS = {
  father: {
    pin: '1973',
    name: 'الوالد الحبيب (أبي)'
  },
  mother: {
    pin: '332211',
    name: 'الوالدة الحبيبة (أمي)'
  },
  child: {
    pin: '20052006',
    name: 'قيس (الابن)'
  }
};

// البذرة العائلية المشتركة لتشفير المكالمات E2EE بين أفراد العائلة
const FAMILY_MASTER_SECRET = 'qais_family_secure_e2ee_call_v2026_salt_984321';

export class SecurityManager {
  constructor() {
    this.roleKey = 'my_parents_call_role';
    this.pinKey = 'my_parents_call_pin';
    this.deviceKey = 'my_parents_call_device_id';
    this.cryptoKey = null;
    this.roomHash = null;
  }

  // الحصول على معرف جهاز فريد وثابت للجهاز الحالي
  getOrCreateDeviceId() {
    let deviceId = localStorage.getItem(this.deviceKey);
    if (!deviceId) {
      if (window.crypto && crypto.randomUUID) {
        deviceId = 'dev_' + crypto.randomUUID();
      } else {
        deviceId = 'dev_' + Math.random().toString(36).substring(2) + Date.now().toString(36);
      }
      localStorage.setItem(this.deviceKey, deviceId);
    }
    return deviceId;
  }

  // حفظ الجلسة في المتصفح
  saveSession(pin, role) {
    sessionStorage.setItem(this.pinKey, pin);
    localStorage.setItem(this.roleKey, role);
  }

  getSavedPin() {
    return sessionStorage.getItem(this.pinKey) || null;
  }

  getSavedRole() {
    return localStorage.getItem(this.roleKey) || null;
  }

  clearSession() {
    sessionStorage.removeItem(this.pinKey);
    this.cryptoKey = null;
    this.roomHash = null;
  }

  // التحقق من بيئة العمل الآمنة (HTTPS)
  checkSecureContext() {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!window.isSecureContext && !isLocal) {
      console.warn('[SECURITY WARNING] يجب تشغيل التطبيق عبر HTTPS للوصول إلى الكاميرا والمايكروفون.');
      return false;
    }
    return true;
  }

  // تهيئة مفتاح التشفير العائلي AES-256-GCM (PBKDF2)
  async initCryptoKeys() {
    const enc = new TextEncoder();
    const baseBuffer = enc.encode(FAMILY_MASTER_SECRET);

    // استيراد المفتاح الأساسي
    const baseKey = await crypto.subtle.importKey(
      'raw',
      baseBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    const salt = enc.encode('qais_parents_salt_e2ee_2026');

    // اشتقاق مفتاح AES-GCM (256-bit) بـ 100,000 تكرار
    this.cryptoKey = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    // حساب المعرف المشفر لغرفة عائلة قيس (Room Hash)
    const roomBuffer = await crypto.subtle.digest(
      'SHA-256',
      enc.encode('room_qais_parents_family_call_2026')
    );
    
    const hashArray = Array.from(new Uint8Array(roomBuffer));
    this.roomHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 24);

    return {
      cryptoKey: this.cryptoKey,
      roomHash: this.roomHash
    };
  }

  // تشفير أي رسالة أو حزمة WebRTC قبل إرسالها (AES-256-GCM)
  async encryptPayload(dataObj) {
    if (!this.cryptoKey) await this.initCryptoKeys();

    const enc = new TextEncoder();
    const plainText = JSON.stringify(dataObj);
    const encodedData = enc.encode(plainText);

    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      this.cryptoKey,
      encodedData
    );

    const cipherArray = new Uint8Array(ciphertextBuffer);
    const combined = new Uint8Array(iv.length + cipherArray.length);
    combined.set(iv, 0);
    combined.set(cipherArray, iv.length);

    let binaryString = '';
    for (let i = 0; i < combined.length; i++) {
      binaryString += String.fromCharCode(combined[i]);
    }
    return btoa(binaryString);
  }

  // فك تشفير البيانات المستلمة (AES-256-GCM)
  async decryptPayload(base64Payload) {
    if (!this.cryptoKey) await this.initCryptoKeys();

    try {
      const binaryString = atob(base64Payload);
      const combined = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        combined[i] = binaryString.charCodeAt(i);
      }

      const iv = combined.slice(0, 12);
      const ciphertext = combined.slice(12);

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv },
        this.cryptoKey,
        ciphertext
      );

      const dec = new TextDecoder();
      const jsonString = dec.decode(decryptedBuffer);
      return JSON.parse(jsonString);
    } catch (err) {
      console.warn('[E2EE DECRYPT WARNING] تعذر فك تشفير الرسالة:', err);
      return null;
    }
  }

  // التحقق من الرمز السري الخاص بكل شخص
  async authenticate(enteredPin, role) {
    const member = FAMILY_MEMBERS_PINS[role];
    if (!member) {
      throw new Error('نوع الحساب المحدد غير صالح');
    }

    const cleanPin = String(enteredPin).trim();

    if (cleanPin !== member.pin) {
      throw new Error(`الرمز السري غير صحيح لحساب (${member.name}). يرجى التأكد من الرمز.`);
    }

    // تهيئة التشفير التام
    await this.initCryptoKeys();
    this.saveSession(cleanPin, role);

    return {
      success: true,
      role,
      name: member.name,
      roomHash: this.roomHash
    };
  }

  // قائمة خوادم STUN الموثوقة والعالمية المجانية
  getIceServers() {
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];
  }
}

export const securityManager = new SecurityManager();
