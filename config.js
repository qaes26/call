import dotenv from 'dotenv';
dotenv.config();

// ===========================================================================
// التحقق الصارم من وجود وقوة جميع المتغيرات البيئية الحساسة
// ===========================================================================
const requiredEnv = ['JWT_SECRET', 'FAMILY_PIN_HASH'];
for (const envVar of requiredEnv) {
  if (!process.env[envVar]) {
    console.error(`[CRITICAL SECURITY ERROR] Missing required environment variable: ${envVar}`);
    console.error('Please configure your .env file before starting the application.');
    process.exit(1);
  }
}

// CVE-FIX: فحص الحد الأدنى لطول مفتاح JWT (يجب ألا يقل عن 32 حرفاً = 256-bit)
if (process.env.JWT_SECRET.length < 32) {
  console.error('[CRITICAL SECURITY ERROR] JWT_SECRET must be at least 32 characters (256-bit) to resist brute-force attacks.');
  process.exit(1);
}

// CVE-FIX: فحص طول مفتاح TURN السري إذا كان مُعداً
if (process.env.TURN_STATIC_AUTH_SECRET && process.env.TURN_STATIC_AUTH_SECRET.length < 32) {
  console.error('[CRITICAL SECURITY ERROR] TURN_STATIC_AUTH_SECRET must be at least 32 characters.');
  process.exit(1);
}

// CVE-FIX: التحقق من صيغة JWT_EXPIRES_IN لمنع إدخال قيم غير آمنة (مثلاً: 999d)
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '15m';
const validExpiryPattern = /^\d{1,3}[smh]$/; // أرقام + s/m/h فقط (ثوانٍ/دقائق/ساعات)
if (!validExpiryPattern.test(jwtExpiresIn)) {
  console.error(`[SECURITY ERROR] JWT_EXPIRES_IN value "${jwtExpiresIn}" is invalid. Use format: 15m, 30m, 1h, 900s`);
  process.exit(1);
}

// CVE-FIX: التحقق من صحة المنفذ
const port = parseInt(process.env.PORT || '3000', 10);
if (isNaN(port) || port < 1 || port > 65535) {
  console.error('[CONFIG ERROR] PORT must be a valid number between 1 and 65535.');
  process.exit(1);
}

const _config = {
  port,
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  allowedOrigins: (process.env.ALLOWED_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0),
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: jwtExpiresIn
  },
  family: {
    pinHash: process.env.FAMILY_PIN_HASH,
    allowedRoles: Object.freeze(['father', 'mother', 'child'])
  },
  turn: {
    stunUrl: process.env.STUN_SERVER_URL || 'stun:stun.l.google.com:19302',
    turnUrl: process.env.TURN_SERVER_URL || '',
    turnTlsUrl: process.env.TURN_SERVER_TLS_URL || '',
    staticSecret: process.env.TURN_STATIC_AUTH_SECRET || '',
    ttlSeconds: Math.min(
      Math.max(parseInt(process.env.TURN_CREDENTIALS_TTL_SECONDS || '1800', 10), 60),
      7200 // CVE-FIX: حد أقصى ساعتين لمنع بيانات اعتماد طويلة الأمد
    )
  },
  rateLimit: {
    windowMinutes: parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    authMaxAttempts: Math.min(
      parseInt(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS || '5', 10),
      20 // CVE-FIX: حد أقصى لمنع تعيين قيمة مرتفعة تبطل الحماية
    )
  }
};

// CVE-FIX: تجميد الكائن لمنع التلاعب بالإعدادات أثناء التشغيل (Prototype Pollution / Runtime Tampering)
export const config = Object.freeze(_config);
