import rateLimit from 'express-rate-limit';
import { config } from '../config.js';

export const apiRateLimiter = rateLimit({
  windowMs: config.rateLimit.windowMinutes * 60 * 1000,
  max: config.rateLimit.maxRequests,
  standardHeaders: true,
  legacyHeaders: false,
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
  message: {
    success: false,
    error: 'تم حظر المحاولات المتكررة لحماية الحساب. يرجى الانتظار 15 دقيقة.'
  }
});

// Socket-level rate limiting to prevent signaling flooding & DoS attacks
const socketActivityMap = new Map();

export function checkSocketRateLimit(socketId, maxEvents = 40, windowMs = 5000) {
  const now = Date.now();
  let userRecord = socketActivityMap.get(socketId);

  if (!userRecord || now - userRecord.startTime > windowMs) {
    userRecord = { startTime: now, count: 1 };
    socketActivityMap.set(socketId, userRecord);
    return true;
  }

  userRecord.count += 1;
  if (userRecord.count > maxEvents) {
    return false; // Rate limit exceeded
  }

  return true;
}

export function cleanupSocketRateLimit(socketId) {
  socketActivityMap.delete(socketId);
}
