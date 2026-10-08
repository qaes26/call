import { z } from 'zod';

// CVE-FIX: إضافة .strict() على جميع المخططات لرفض أي خصائص إضافية غير معرّفة
// هذا يمنع Prototype Pollution و Mass Assignment عبر حقن __proto__ أو constructor
export const authLoginSchema = z.object({
  pin: z.string().min(4, 'الرمز السري يجب ألا يقل عن 4 أرقام').max(32),
  role: z.enum(['father', 'mother', 'child'], {
    errorMap: () => ({ message: 'الدور المحدد غير صالح' })
  }),
  deviceId: z.string().min(8).max(128)
    // CVE-FIX: تقييد الأحرف المسموحة في deviceId لمنع حقن أحرف تحكم و Unicode الخطيرة
    .regex(/^[\w-]+$/, 'معرف الجهاز يحتوي على أحرف غير مسموحة')
}).strict();

export const callRequestSchema = z.object({
  targetRole: z.enum(['father', 'mother', 'child']),
  hasVideo: z.boolean().default(true)
}).strict();

export const callResponseSchema = z.object({
  targetRole: z.enum(['father', 'mother', 'child']),
  accepted: z.boolean()
}).strict();

export const webrtcOfferAnswerSchema = z.object({
  targetRole: z.enum(['father', 'mother', 'child']),
  sdp: z.object({
    type: z.enum(['offer', 'answer']),
    // CVE-FIX: تقليل الحد الأقصى لحجم SDP لمنع هجمات Memory Exhaustion
    sdp: z.string().min(10).max(65536)
  }).strict()
}).strict();

export const iceCandidateSchema = z.object({
  targetRole: z.enum(['father', 'mother', 'child']),
  candidate: z.object({
    candidate: z.string().max(2048),
    sdpMid: z.string().max(32).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(10).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional()
  }).strict()
}).strict();

export const hangupSchema = z.object({
  targetRole: z.enum(['father', 'mother', 'child']).optional()
}).strict();

export function validateSocketPayload(schema, data) {
  // CVE-FIX: رفض المدخلات غير الكائنية (مثل: null, undefined, string, array)
  // هذا يمنع هجمات Prototype Pollution عبر إرسال أنواع بيانات غير متوقعة
  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'البيانات المرسلة يجب أن تكون كائن JSON صالح', data: null };
  }

  const result = schema.safeParse(data);
  if (!result.success) {
    // CVE-FIX: تحديد عدد الأخطاء المعروضة لمنع تسريب معلومات داخلية عبر رسائل الخطأ
    const errorMsg = result.error.errors
      .slice(0, 3)
      .map(e => `${e.path.join('.')}: ${e.message}`)
      .join(', ');
    return { valid: false, error: errorMsg, data: null };
  }
  return { valid: true, error: null, data: result.data };
}
