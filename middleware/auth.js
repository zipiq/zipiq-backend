const jwt = require('jsonwebtoken');
const { UserModel } = require('../models/user');

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ 
      success: false, 
      message: 'Access token required',
      code: 'TOKEN_MISSING'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          success: false, 
          message: 'Token expired',
          code: 'TOKEN_EXPIRED'
        });
      } else if (err.name === 'JsonWebTokenError') {
        return res.status(403).json({ 
          success: false, 
          message: 'Invalid token',
          code: 'TOKEN_INVALID'
        });
      } else {
        return res.status(403).json({ 
          success: false, 
          message: 'Token verification failed',
          code: 'TOKEN_VERIFICATION_FAILED'
        });
      }
    }

    // Verify user still exists and is active
    UserModel.findById(decoded.userId, (err, user) => {
      if (err) {
        return res.status(500).json({
          success: false,
          message: 'Database error during authentication'
        });
      }

      if (!user || !user.is_active) {
        return res.status(401).json({
          success: false,
          message: 'User not found or inactive',
          code: 'USER_NOT_FOUND'
        });
      }

      req.user = {
        id: user.id,
        email: user.email,
        username: user.username,
        isVerified: !!user.is_verified
      };
      next();
    });
  });
};

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      req.user = null;
    } else {
      req.user = decoded;
    }
    next();
  });
};

const requireVerified = (req, res, next) => {
  if (!req.user.isVerified) {
    return res.status(403).json({
      success: false,
      message: 'Email verification required',
      code: 'EMAIL_NOT_VERIFIED'
    });
  }
  next();
};

module.exports = { 
  authenticateToken, 
  optionalAuth, 
  requireVerified 
};