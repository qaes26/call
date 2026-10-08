import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config.js';

export async function verifyFamilyPin(rawPin) {
  if (!rawPin || typeof rawPin !== 'string') return false;
  return await bcrypt.compare(rawPin, config.family.pinHash);
}

export function generateToken(payload) {
  return jwt.sign(
    {
      role: payload.role,
      deviceId: payload.deviceId,
      familyGroup: 'primary-family'
    },
    config.jwt.secret,
    {
      expiresIn: config.jwt.expiresIn,
      algorithm: 'HS256'
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
  try {
    const decoded = jwt.verify(token, config.jwt.secret);
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
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('AUTHENTICATION_ERROR: Token is required for secure signaling'));
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    if (!config.family.allowedRoles.includes(decoded.role)) {
      return next(new Error('AUTHENTICATION_ERROR: Invalid role assigned'));
    }
    socket.user = decoded;
    next();
  } catch (err) {
    return next(new Error('AUTHENTICATION_ERROR: Token expired or invalid signature'));
  }
}
