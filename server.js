import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import { config } from './config.js';
import {
  authLoginSchema,
  callRequestSchema,
  callResponseSchema,
  webrtcOfferAnswerSchema,
  iceCandidateSchema,
  hangupSchema,
  validateSocketPayload
} from './middleware/validator.js';
import {
  verifyFamilyPin,
  generateToken,
  verifyHttpAuth,
  verifySocketAuth
} from './middleware/auth.js';
import {
  apiRateLimiter,
  authRateLimiter,
  checkSocketRateLimit,
  cleanupSocketRateLimit
} from './middleware/rateLimiter.js';
import { generateTurnCredentials } from './services/turnService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// =============================================================================
// 1. الأمان والتحصين على مستوى تطبيق Express (Production Hardening)
// =============================================================================

// تفعيل ترويسات الأمان المتقدمة عبر Helmet مع تخصيص CSP لـ WebSockets و WebRTC
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline يسمح بتشغيل السكربتات الموثوقة محلياً
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        connectSrc: ["'self'", 'wss:', 'ws:', 'https:'],
        mediaSrc: ["'self'", 'blob:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        upgradeInsecureRequests: config.isProduction ? [] : null
      }
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true
        }
      : false
  })
);

// تحديد سياسة صارمة لـ CORS
const corsOptions = {
  origin: (origin, callback) => {
    // السماح بالطلبات الداخلية (مثل التطبيقات أو الطلبات بدون origin في مرحلة التطوير)
    if (!origin || config.allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS_ERROR: الوصول من هذا النطاق محظور'));
  },
  methods: ['GET', 'POST'],
  credentials: true
};
app.use(cors(corsOptions));

// قفل حجم مدخلات JSON لمنع هجمات الإغراق وتجاوز سعة الذاكرة (Memory Exhaustion)
app.use(express.json({ limit: '100kb' }));

// تقديم الملفات الثابتة للواجهة الأمامية
app.use(express.static(path.join(__dirname, 'public')));

// تطبيق Rate Limiting العام على كافة مسارات الـ API
app.use('/api/', apiRateLimiter);

// =============================================================================
// 2. نقاط النهاية للتحقق والمصادقة (REST API Endpoints)
// =============================================================================

/**
 * تسجيل الدخول عبر الرمز السري العائلي
 * محمي بـ Rate Limiter صارم لمنع هجمات التخمين Brute-Force
 */
app.post('/api/auth/login', authRateLimiter, async (req, res) => {
  try {
    const parseResult = authLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        success: false,
        error: parseResult.error.errors[0]?.message || 'بيانات الدخول غير مكتملة'
      });
    }

    const { pin, role, deviceId } = parseResult.data;

    // مطابقة الرمز السري مع الهاش المشفر
    const isPinValid = await verifyFamilyPin(pin);
    if (!isPinValid) {
      return res.status(401).json({
        success: false,
        error: 'الرمز السري غير صحيح. يرجى التأكد من الرمز والمحاولة مجدداً.'
      });
    }

    // إصدار JWT قصير الأجل وموقع رقمياً
    const token = generateToken({ role, deviceId });

    return res.json({
      success: true,
      message: 'تم التحقق بنجاح',
      token,
      user: {
        role,
        deviceId
      }
    });
  } catch (err) {
    console.error('[AUTH ERROR]:', err);
    return res.status(500).json({
      success: false,
      error: 'حدث خطأ في معالجة طلب المصادقة'
    });
  }
});

/**
 * الحصول على إعدادات STUN/TURN المؤقتة (Ephemeral Credentials)
 * لا يمكن الوصول إليه إلا بعد تقديم JWT صالح
 */
app.get('/api/turn-credentials', verifyHttpAuth, (req, res) => {
  try {
    const userId = `${req.user.role}-${req.user.deviceId}`;
    const credentials = generateTurnCredentials(userId);

    return res.json({
      success: true,
      ...credentials
    });
  } catch (err) {
    console.error('[TURN ERROR]:', err);
    return res.status(500).json({
      success: false,
      error: 'تعذر توليد بيانات اعتماد الترحيل'
    });
  }
});

/**
 * فحص صحة النظام (Health Check)
 */
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// توجيه أي مسار غير معرّف إلى الواجهة الأمامية (متوافق مع Express 5)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================================================
// 3. خادم الإشارات المشفر والفوري (Real-Time Secure WebRTC Signaling)
// =============================================================================

const io = new SocketIOServer(server, {
  cors: corsOptions,
  maxHttpBufferSize: 1e6, // أقصى حجم 1MB للحزمة الواحدة
  pingTimeout: 20000,
  pingInterval: 10000
});

// اعتراض الاتصال للتحقق الأمني من الـ JWT قبل قبول الـ Handshake
io.use(verifySocketAuth);

// جدول المستخدمين المتصلين في الوقت الفعلي
// المفتاح هو الدور (father, mother, child) لضمان حصرية الاتصال العائلي
const activeFamilyMembers = new Map();

function getFamilyPresence() {
  const presence = {
    father: false,
    mother: false,
    child: false
  };
  for (const [role] of activeFamilyMembers.entries()) {
    if (presence[role] !== undefined) {
      presence[role] = true;
    }
  }
  return presence;
}

io.on('connection', (socket) => {
  const { role, deviceId } = socket.user;
  const familyRoom = 'primary-family-room';

  // التحقق من تجاوز الـ Rate Limit على مستوى الـ Socket
  const ensureRateLimit = () => {
    const isAllowed = checkSocketRateLimit(socket.id);
    if (!isAllowed) {
      socket.emit('security-alert', {
        message: 'تم تعليق الإرسال مؤقتاً بسبب تدفق رسائل غير طبيعي (Flood Prevention).'
      });
      return false;
    }
    return true;
  };

  // تسجيل اتصال المستخدم الجديد وعزل أي جلسة قديمة لنفس الدور
  const existingSession = activeFamilyMembers.get(role);
  if (existingSession && existingSession.socketId !== socket.id) {
    // إشعار الجلسة القديمة بالانفصال لمنع التكرار
    io.to(existingSession.socketId).emit('session-replaced', {
      message: 'تم تسجيل الدخول من جهاز آخر لنفس الحساب.'
    });
  }

  activeFamilyMembers.set(role, {
    socketId: socket.id,
    role,
    deviceId,
    connectedAt: Date.now()
  });

  socket.join(familyRoom);
  console.log(`[SECURE SIGNALING] متصل جديد: ${role} (${socket.id}) - جهاز: ${deviceId}`);

  // إرسال تحديث الحضور لجميع أفراد العائلة فوراً
  io.to(familyRoom).emit('presence-update', getFamilyPresence());

  // ---------------------------------------------------------------------------
  // أحداث الاتصال والتحكم بالنداء (Call Initiation & Signaling)
  // ---------------------------------------------------------------------------

  // طلب بدء مكالمة
  socket.on('call-request', (payload) => {
    if (!ensureRateLimit()) return;

    const validation = validateSocketPayload(callRequestSchema, payload);
    if (!validation.valid) {
      return socket.emit('call-error', { message: validation.error });
    }

    const { targetRole, hasVideo } = validation.data;
    const targetSession = activeFamilyMembers.get(targetRole);

    if (!targetSession) {
      return socket.emit('call-rejected', {
        targetRole,
        reason: 'الطرف الآخر غير متصل بالإنترنت حالياً'
      });
    }

    // إرسال إشعار الرنين للطرف المستهدف
    io.to(targetSession.socketId).emit('incoming-call', {
      fromRole: role,
      hasVideo
    });
  });

  // الرد على المكالمة (قبول أو رفض)
  socket.on('call-response', (payload) => {
    if (!ensureRateLimit()) return;

    const validation = validateSocketPayload(callResponseSchema, payload);
    if (!validation.valid) {
      return socket.emit('call-error', { message: validation.error });
    }

    const { targetRole, accepted } = validation.data;
    const callerSession = activeFamilyMembers.get(targetRole);

    if (callerSession) {
      if (accepted) {
        io.to(callerSession.socketId).emit('call-accepted', { fromRole: role });
      } else {
        io.to(callerSession.socketId).emit('call-rejected', {
          fromRole: role,
          reason: 'تم رفض المكالمة من الطرف الآخر'
        });
      }
    }
  });

  // تبادل حزمة العرض (WebRTC Offer)
  socket.on('webrtc-offer', (payload) => {
    if (!ensureRateLimit()) return;

    const validation = validateSocketPayload(webrtcOfferAnswerSchema, payload);
    if (!validation.valid) {
      return socket.emit('call-error', { message: validation.error });
    }

    const { targetRole, sdp } = validation.data;
    const targetSession = activeFamilyMembers.get(targetRole);

    if (targetSession) {
      io.to(targetSession.socketId).emit('webrtc-offer', {
        fromRole: role,
        sdp
      });
    }
  });

  // تبادل حزمة الإجابة (WebRTC Answer)
  socket.on('webrtc-answer', (payload) => {
    if (!ensureRateLimit()) return;

    const validation = validateSocketPayload(webrtcOfferAnswerSchema, payload);
    if (!validation.valid) {
      return socket.emit('call-error', { message: validation.error });
    }

    const { targetRole, sdp } = validation.data;
    const targetSession = activeFamilyMembers.get(targetRole);

    if (targetSession) {
      io.to(targetSession.socketId).emit('webrtc-answer', {
        fromRole: role,
        sdp
      });
    }
  });

  // تبادل مرشحات المسار والشبكة (ICE Candidates)
  socket.on('ice-candidate', (payload) => {
    if (!ensureRateLimit()) return;

    const validation = validateSocketPayload(iceCandidateSchema, payload);
    if (!validation.valid) {
      return socket.emit('call-error', { message: validation.error });
    }

    const { targetRole, candidate } = validation.data;
    const targetSession = activeFamilyMembers.get(targetRole);

    if (targetSession) {
      io.to(targetSession.socketId).emit('ice-candidate', {
        fromRole: role,
        candidate
      });
    }
  });

  // إنهاء المكالمة (Hangup)
  socket.on('call-hangup', (payload) => {
    const validation = validateSocketPayload(hangupSchema, payload || {});
    const targetRole = validation.valid ? validation.data.targetRole : null;

    if (targetRole) {
      const targetSession = activeFamilyMembers.get(targetRole);
      if (targetSession) {
        io.to(targetSession.socketId).emit('call-ended', { fromRole: role });
      }
    } else {
      // إشعار كافة أفراد العائلة بإنهاء الجلسة
      socket.to(familyRoom).emit('call-ended', { fromRole: role });
    }
  });

  // انقطاع الاتصال
  socket.on('disconnect', () => {
    console.log(`[SECURE SIGNALING] انقطع اتصال: ${role} (${socket.id})`);
    cleanupSocketRateLimit(socket.id);

    const current = activeFamilyMembers.get(role);
    if (current && current.socketId === socket.id) {
      activeFamilyMembers.delete(role);
      // إشعار الآخرين بإنهاء أي مكالمة جارية
      socket.to(familyRoom).emit('call-ended', { fromRole: role, reason: 'انقطع الاتصال' });
      // بث تحديث الحضور المتبقي
      io.to(familyRoom).emit('presence-update', getFamilyPresence());
    }
  });
});

// =============================================================================
// 4. تشغيل الخادم
// =============================================================================
server.listen(config.port, () => {
  console.log(`=============================================================`);
  console.log(`🚀 خادم إشارات تطبيق "أبوي وأمي" يعمل بنجاح`);
  console.log(`📍 الرابط: http://localhost:${config.port}`);
  console.log(`🛡️ وضع التشغيل: ${config.nodeEnv}`);
  console.log(`🔒 تشفير الـ JWT و DTLS-SRTP: مفعّل`);
  console.log(`⏱️ صلاحية الرمز المؤقت: ${config.jwt.expiresIn}`);
  console.log(`=============================================================`);
});
