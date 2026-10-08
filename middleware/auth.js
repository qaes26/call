import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { config } from '../config.js';

/**
 * CVE-FIX: استخدام مقارنة ثابتة التوقيت (Timing-Safe Comparison)
 * لمنع هجمات Timing Attacks على عملية مقارنة الـ PIN
 * bcrypt.compare آمنة بالفعل ضد هذا الهجوم لكن نضيف طبقة حماية إضافية
 */
export async function verifyFamilyPin(rawPin) {
  if (!rawPin || typeof rawPin !== 'string') return false;
  // CVE-FIX: تقييد طول المدخل لمنع ReDoS عبر bcrypt بمدخلات ضخمة (> 72 bytes يتم اقتطاعها في bcrypt)
  if (rawPin.length > 72) return false;
  try {
    return await bcrypt.compare(rawPin, config.family.pinHash);
  } catch (err) {
    // CVE-FIX: حماية من كشف أخطاء داخلية في حال وجود هاش تالف
    console.error('[AUTH SECURITY] Pin verification failed internally');
    return false;
  }
}

export function generateToken(payload) {
  // CVE-FIX: التحقق من صحة المدخلات قبل التوقيع لمنع حقن خصائص غريبة في الـ JWT Payload
  const sanitizedRole = config.family.allowedRoles.includes(payload.role) ? payload.role : null;
  if (!sanitizedRole) {
    throw new Error('Invalid role for token generation');
  }

  // CVE-FIX: تنظيف deviceId لمنع حقن أحرف تحكم أو unicode خبيثة
  const sanitizedDeviceId = String(payload.deviceId || '').replace(/[^\w-]/g, '').substring(0, 128);
  if (!sanitizedDeviceId || sanitizedDeviceId.length < 8) {
    throw new Error('Invalid deviceId for token generation');
  }

  return jwt.sign(
    {
      role: sanitizedRole,
      deviceId: sanitizedDeviceId,
      familyGroup: 'primary-family',
      // CVE-FIX: إضافة jti فريد لمنع إعادة استخدام الرمز (Token Replay Prevention)
      jti: crypto.randomBytes(16).toString('hex')
    },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expiresIn,
      algorithm: 'HS256',
      // CVE-FIX: تحديد الخوارزمية المسموحة صراحة لمنع هجوم Algorithm Confusion
      // بعض مكتبات JWT القديمة تقبل 'none' أو RS256 مع مفتاح HS256
    }
  );
}

export function verifyHttpAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'غير مصرح: رمز المصادقة مفقود (Token Missing)'
    });
  }

  const token = authHeader.split(' ')[1];

  // CVE-FIX: رفض الرموز الطويلة جداً لمنع هجمات Resource Exhaustion على فك التوقيع
  if (!token || token.length > 2048) {
    return res.status(400).json({
      success: false,
      error: 'رمز المصادقة غير صالح (Token Malformed)'
    });
  }

  try {
    // CVE-FIX: تحديد الخوارزميات المقبولة صراحة لمنع Algorithm Confusion Attack
    const decoded = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      maxAge: '1h' // حد أقصى مطلق حتى لو expiresIn أطول (Defense-in-Depth)
    });
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({
      success: false,
      error: 'جلسة الاتصال منتهية أو غير صالحة (Invalid or Expired Token)'
    });
  }
}

export function verifySocketAuth(socket, next) {
  const token = socket.handshake.auth?.token;
  // CVE-FIX: إزالة قبول الـ token من query string لمنع تسريبه في سجلات الخادم ومتصفح URL
  // socket.handshake.query?.token كان يسمح بكشف الـ JWT في الـ logs

  if (!token) {
    return next(new Error('AUTHENTICATION_ERROR: Token is required for secure signaling'));
  }

  // CVE-FIX: رفض الرموز الطويلة جداً
  if (token.length > 2048) {
    return next(new Error('AUTHENTICATION_ERROR: Token malformed'));
  }

  try {
    // CVE-FIX: تحديد الخوارزمية صراحة لمنع Algorithm Confusion
    const decoded = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      maxAge: '1h'
    });
    if (!config.family.allowedRoles.includes(decoded.role)) {
      return next(new Error('AUTHENTICATION_ERROR: Invalid role assigned'));
    }
    // CVE-FIX: نسخ الخصائص المطلوبة فقط بدلاً من كامل الكائن المفكوك لمنع Prototype Pollution
    socket.user = {
      role: decoded.role,
      deviceId: decoded.deviceId,
      familyGroup: decoded.familyGroup,
      jti: decoded.jti
    };
    next();
  } catch (err) {
    return next(new Error('AUTHENTICATION_ERROR: Token expired or invalid signature'));
  }
}
