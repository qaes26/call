import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMinutes * 60 * 1000,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  // CVE-FIX: استخدام عنوان IP الحقيقي خلف Reverse Proxy بدلاً من IP الوسيط
  // بدون هذا الإعداد يتم مشاركة Rate Limit بين جميع المستخدمين خلف Nginx/Cloudflare
  validate: { trustProxy: false }, // Express 5 يتعامل مع trust proxy تلقائياً
  message: {
    success: false,
    error: 'تم تجاوز الحد المسموح من الطلبات، يرجى المحاولة لاحقاً.'
  }
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: config.rateLimit.authMaxAttempts, // 5 محاولات لمنع تخمين الرمز السري
  standardHeaders: true,
  legacyHeaders: false,
  // CVE-FIX: تفعيل skipFailedRequests=false (الافتراضي) لعد المحاولات الفاشلة فقط
  skipSuccessfulRequests: true, // CVE-FIX: عدم احتساب تسجيلات الدخول الناجحة ضمن الحد
  message: {
    success: false,
    error: 'تم حظر المحاولات المتكررة لحماية الحساب. يرجى الانتظار 15 دقيقة.'
  }
});

// ===========================================================================
// Socket-level rate limiting with disconnection on persistent abuse
// ===========================================================================
const socketActivityMap = new Map();

// CVE-FIX: تسريب الذاكرة (Memory Leak) - تنظيف تلقائي دوري لسجلات الـ Sockets المنتهية
const CLEANUP_INTERVAL_MS = 60 * 1000; // كل دقيقة
setInterval(() => {
  const now = Date.now();
  for (const [socketId, record] of socketActivityMap.entries()) {
    // حذف أي سجل أقدم من 30 ثانية بدون نشاط (Socket مقطوع لم يتم تنظيفه)
    if (now - record.lastActivity > 30000) {
      socketActivityMap.delete(socketId);
    }
  }
}, CLEANUP_INTERVAL_MS);

export function checkSocketRateLimit(socketId, maxEvents = 40, windowMs = 5000) {
  const now = Date.now();
  let userRecord = socketActivityMap.get(socketId);

  if (!userRecord || now - userRecord.startTime > windowMs) {
    userRecord = { startTime: now, count: 1, lastActivity: now, violations: 0 };
    socketActivityMap.set(socketId, userRecord);
    return true;
  }

  userRecord.count += 1;
  userRecord.lastActivity = now;

  if (userRecord.count > maxEvents) {
    // CVE-FIX: تتبع عدد الانتهاكات المتكررة لقطع الاتصال نهائياً عند التكرار
    userRecord.violations = (userRecord.violations || 0) + 1;
    return false;
  }

  return true;
}

// CVE-FIX: دالة للتحقق ما إذا كان يجب فصل المستخدم بسبب انتهاك متكرر
export function shouldDisconnectSocket(socketId) {
  const record = socketActivityMap.get(socketId);
  // فصل الاتصال بعد 5 انتهاكات متكررة (هجوم صريح)
  return record && record.violations >= 5;
}

export function cleanupSocketRateLimit(socketId) {
  socketActivityMap.delete(socketId);
}
