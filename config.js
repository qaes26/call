import dotenv from 'dotenv';
dotenv.config();

const requiredEnv = ['JWT_SECRET', 'FAMILY_PIN_HASH'];
for (const envVar of requiredEnv) {
  if (!process.env[envVar]) {
    console.error(`[CRITICAL SECURITY ERROR] Missing required environment variable: ${envVar}`);
    console.error('Please configure your .env file before starting the application.');
    process.exit(1);
  }
}

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  allowedOrigins: (process.env.ALLOWED_ORIGIN || 'http://localhost:3000')
    .split(',')
    .map(origin => origin.trim()),
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '15m'
  },
  family: {
    pinHash: process.env.FAMILY_PIN_HASH,
    allowedRoles: ['father', 'mother', 'child']
  },
  turn: {
    stunUrl: process.env.STUN_SERVER_URL || 'stun:stun.l.google.com:19302',
    turnUrl: process.env.TURN_SERVER_URL || '',
    turnTlsUrl: process.env.TURN_SERVER_TLS_URL || '',
    staticSecret: process.env.TURN_STATIC_AUTH_SECRET || '',
    ttlSeconds: parseInt(process.env.TURN_CREDENTIALS_TTL_SECONDS || '1800', 10)
  },
  rateLimit: {
    windowMinutes: parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES || '15', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
    authMaxAttempts: parseInt(process.env.AUTH_RATE_LIMIT_MAX_ATTEMPTS || '5', 10)
  }
};
