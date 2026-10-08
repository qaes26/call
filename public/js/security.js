/**
 * إدارة الأمان والتشفير الشامل (E2EE) وحساب المفاتيح على المتصفح مباشرة
 * مصمم ليعمل 100% على Netlify بدون الحاجة لأي خادم وسيط
 */

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

  // اشتقاق مفتاح التشفير AES-256-GCM ومعرف الغرفة من الرمز السري العائلي (PBKDF2)
  async initCryptoFromPin(pin) {
    const enc = new TextEncoder();
    const pinBuffer = enc.encode(String(pin).trim());

    // 1. توليد مفتاح أساسي من الـ PIN
    const baseKey = await crypto.subtle.importKey(
      'raw',
      pinBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );

    // ملح ثابت للمشروع لضمان اشتقاق نفس المفتاح بين أفراد نفس العائلة
    const salt = enc.encode('my_parents_call_salt_v1_2026_e2ee');

    // 2. اشتقاق مفتاح AES-GCM (256 بت) مع 100,000 تكرار لمقاومة التخمين
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

    // 3. حساب معرف فريد ومشفر لغرفة العائلة (SHA-256 Hash)
    const roomBuffer = await crypto.subtle.digest(
      'SHA-256',
      enc.encode(`room_${String(pin).trim()}_my_parents_call`)
    );
    
    // تحويل الـ Hash إلى سلسلة نصية
    const hashArray = Array.from(new Uint8Array(roomBuffer));
    this.roomHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 24);

    return {
      cryptoKey: this.cryptoKey,
      roomHash: this.roomHash
    };
  }

  // تشفير أي رسالة أو بيانات قبل إرسالها عبر قناة الإشارات (AES-256-GCM)
  async encryptPayload(dataObj) {
    if (!this.cryptoKey) throw new Error('مفتاح التشفير غير مهيأ');

    const enc = new TextEncoder();
    const plainText = JSON.stringify(dataObj);
    const encodedData = enc.encode(plainText);

    // توليد IV (Initialization Vector) عشوائي لكل رسالة
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      this.cryptoKey,
      encodedData
    );

    // تحويل البيانات المشفرة إلى Base64 لنقلها بأمان
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
    if (!this.cryptoKey) throw new Error('مفتاح التشفير غير مهيأ');

    try {
      const binaryString = atob(base64Payload);
      const combined = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        combined[i] = binaryString.charCodeAt(i);
      }

      // استخراج الـ IV (أول 12 بايت) والبيانات المشفرة
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
      console.warn('[E2EE DECRYPT WARNING] تعذر فك تشفير الرسالة (ربما تم إرسالها برمز PIN مختلف):', err);
      return null;
    }
  }

  // المصادقة المحلية المباشرة على المتصفح
  async authenticate(pin, role) {
    if (!pin || pin.length < 4) {
      throw new Error('الرجاء إدخال رمز سري عائلي صحيح مكون من 4 أرقام أو أكثر');
    }

    // تهيئة التشفير التام
    await this.initCryptoFromPin(pin);
    this.saveSession(pin, role);

    return {
      success: true,
      role,
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
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' }
    ];
  }
}

export const securityManager = new SecurityManager();
