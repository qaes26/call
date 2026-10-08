/**
 * إدارة الأمان وبصمة الجهاز على مستوى متصفح العميل (Client-Side Security)
 */

export class SecurityManager {
  constructor() {
    this.tokenKey = 'my_parents_call_jwt';
    this.roleKey = 'my_parents_call_role';
    this.deviceKey = 'my_parents_call_device_id';
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

  // حفظ رمز JWT والدور
  saveSession(token, role) {
    sessionStorage.setItem(this.tokenKey, token);
    localStorage.setItem(this.roleKey, role); // حفظ الدور للملائمة
  }

  getToken() {
    return sessionStorage.getItem(this.tokenKey);
  }

  getSavedRole() {
    return localStorage.getItem(this.roleKey) || null;
  }

  clearSession() {
    sessionStorage.removeItem(this.tokenKey);
  }

  // التحقق من أن الصفحة تعمل في بيئة آمنة (HTTPS أو Localhost)
  // وهو متطلب أساسي في المتصفحات الحديثة للوصول إلى الكاميرا والمايكروفون
  checkSecureContext() {
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (!window.isSecureContext && !isLocal) {
      console.warn('[SECURITY WARNING] يجب تشغيل التطبيق عبر HTTPS للوصول إلى الكاميرا والمايكروفون وتفعيل DTLS-SRTP.');
      return false;
    }
    return true;
  }

  // طلب المصادقة من خادم الإشارات
  async authenticate(pin, role) {
    const deviceId = this.getOrCreateDeviceId();

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        pin,
        role,
        deviceId
      })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'فشل التحقق من الرمز السري');
    }

    this.saveSession(data.token, role);
    return data;
  }

  // جلب بيانات اعتماد STUN/TURN المؤقتة
  async fetchTurnCredentials() {
    const token = this.getToken();
    if (!token) throw new Error('غير مصرح: لا يوجد رمز مصادقة');

    const response = await fetch('/api/turn-credentials', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      throw new Error(data.error || 'تعذر الحصول على خوادم الاتصال');
    }

    return data.iceServers;
  }
}

export const securityManager = new SecurityManager();
