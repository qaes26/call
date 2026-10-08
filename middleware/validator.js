import { z } from 'zod';

export const authLoginSchema = z.object({
  pin: z.string().min(4, 'الرمز السري يجب ألا يقل عن 4 أرقام').max(32),
  role: z.enum(['father', 'mother', 'child'], {
    errorMap: () => ({ message: 'الدور المحدد غير صالح' })
  }),
  deviceId: z.string().min(8).max(128)
});

export const callRequestSchema = z.object({
  targetRole: z.enum(['father', 'mother', 'child']),
  hasVideo: z.boolean().default(true)
});

export const callResponseSchema = z.object({
  targetRole: z.enum(['father', 'mother', 'child']),
  accepted: z.boolean()
});

export const webrtcOfferAnswerSchema = z.object({
  targetRole: z.enum(['father', 'mother', 'child']),
  sdp: z.object({
    type: z.enum(['offer', 'answer']),
    sdp: z.string().min(10).max(200000)
  })
});

export const iceCandidateSchema = z.object({
  targetRole: z.enum(['father', 'mother', 'child']),
  candidate: z.object({
    candidate: z.string().max(5000),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().nullable().optional(),
    usernameFragment: z.string().nullable().optional()
  })
});

export const hangupSchema = z.object({
  targetRole: z.enum(['father', 'mother', 'child']).optional()
});

export function validateSocketPayload(schema, data) {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errorMsg = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    return { valid: false, error: errorMsg, data: null };
  }
  return { valid: true, error: null, data: result.data };
}
