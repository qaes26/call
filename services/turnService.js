import crypto from 'crypto';
import { config } from '../config.js';

/**
 * توليد بيانات اعتماد مؤقتة (Ephemeral TURN Credentials)
 * متوافقة مع معيار CoTURN REST API / RFC 5766
 * 
 * المبدأ الأمني:
 * لا يتم مشاركة المفتاح السري أبداً مع العميل.
 * يتم توليد اسم مستخدم يحتوي على وقت انتهاء الصلاحية،
 * وكلمة مرور مشفرة بـ HMAC-SHA1 تنتهي تلقائياً بمجرد انقضاء المهلة.
 */
export function generateTurnCredentials(userId = 'guest') {
  const iceServers = [];

  // دائماً إضافة خادم STUN لاكتشاف IP العام P2P مجاناً
  if (config.turn.stunUrl) {
    iceServers.push({
      urls: config.turn.stunUrl
    });
  }

  // إذا تم إعداد سيرفر TURN والمفتاح السري
  if (config.turn.turnUrl && config.turn.staticSecret) {
    const expiryTimestamp = Math.floor(Date.now() / 1000) + config.turn.ttlSeconds;
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    const username = `${expiryTimestamp}:${sanitizedUserId}`;

    const hmac = crypto.createHmac('sha1', config.turn.staticSecret);
    hmac.update(username);
    const credential = hmac.digest('base64');

    const turnUrls = [config.turn.turnUrl];
    if (config.turn.turnTlsUrl) {
      turnUrls.push(config.turn.turnTlsUrl);
    }

    iceServers.push({
      urls: turnUrls,
      username: username,
      credential: credential
    });
  }

  return {
    iceServers,
    ttl: config.turn.ttlSeconds,
    issuedAt: new Date().toISOString()
  };
}
