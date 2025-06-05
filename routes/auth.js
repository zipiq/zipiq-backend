const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { UserModel } = require('../models/user');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Helper function to generate JWT (matches your iOS expectations)
const generateToken = (userId, expiresIn = process.env.JWT_EXPIRES_IN) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn });
};

// Helper function to format response (matches your iOS AuthResponse model)
const formatAuthResponse = (success, token, refreshToken, user, message = null) => {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);
  
  return {
    success,
    token,
    refreshToken,
    user: user ? {
      id: user.id.toString(),
      email: user.email,
      username: user.username,
      firstName: user.first_name,
      lastName: user.last_name,
      createdAt: user.created_at,
      isVerified: !!user.is_verified
    } : null,
    message,
    expiresAt: expiresAt.toISOString()
  };
};

// POST /auth/login - Matches your iOS AuthRequest model
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 1 })
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(
        formatAuthResponse(false, null, null, null, 'Invalid email or password')
      );
    }

    const { email, password } = req.body;

    // Find user by email
    UserModel.findByEmail(email, async (err, user) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json(
          formatAuthResponse(false, null, null, null, 'Internal server error')
        );
      }

      if (!user) {
        return res.status(401).json(
          formatAuthResponse(false, null, null, null, 'Invalid email or password')
        );
      }

      try {
        // Check password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
          return res.status(401).json(
            formatAuthResponse(false, null, null, null, 'Invalid email or password')
          );
        }

        // Generate tokens
        const token = generateToken(user.id);
        const refreshToken = generateToken(user.id, process.env.JWT_REFRESH_EXPIRES_IN);

        // Update last login
        UserModel.updateLastLogin(user.id, (err) => {
          if (err) console.error('Error updating last login:', err);
        });

        // Return success response (matches iOS AuthResponse)
        res.json(formatAuthResponse(true, token, refreshToken, user, 'Login successful'));

      } catch (error) {
        console.error('Password comparison error:', error);
        res.status(500).json(
          formatAuthResponse(false, null, null, null, 'Authentication error')
        );
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json(
      formatAuthResponse(false, null, null, null, 'Internal server error')
    );
  }
});

// POST /auth/register - Matches your iOS SignupRequest model
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('username').isLength({ min: 3, max: 20 }).matches(/^[a-zA-Z0-9_]+$/),
  body('password').isLength({ min: 8 }),
  body('firstName').optional().isLength({ max: 50 }),
  body('lastName').optional().isLength({ max: 50 })
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json(
        formatAuthResponse(false, null, null, null, 'Invalid input data')
      );
    }

    const { email, username, password, firstName, lastName } = req.body;

    // Check if user already exists
    UserModel.checkExists(email, username, async (err, existingUser) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json(
          formatAuthResponse(false, null, null, null, 'Internal server error')
        );
      }

      if (existingUser) {
        return res.status(409).json(
          formatAuthResponse(false, null, null, null, 'User with this email or username already exists')
        );
      }

      try {
        // Hash password
        const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user
        const userData = {
          email: email,
          username: username,
          passwordHash: passwordHash,
          firstName: firstName || null,
          lastName: lastName || null
        };

        UserModel.create(userData, (err, user) => {
          if (err) {
            console.error('Error creating user:', err);
            return res.status(500).json(
              formatAuthResponse(false, null, null, null, 'Failed to create user')
            );
          }

          // Generate tokens
          const token = generateToken(user.id);
          const refreshToken = generateToken(user.id, process.env.JWT_REFRESH_EXPIRES_IN);

          // Get user profile for response
          UserModel.getProfile(user.id, (err, profile) => {
            if (err) {
              console.error('Error retrieving user profile:', err);
              return res.status(500).json(
                formatAuthResponse(false, null, null, null, 'User created but failed to retrieve profile')
              );
            }

            // Return success response (matches iOS AuthResponse)
            res.status(201).json(
              formatAuthResponse(true, token, refreshToken, profile, 'Account created successfully')
            );
          });
        });
      } catch (hashError) {
        console.error('Error hashing password:', hashError);
        res.status(500).json(
          formatAuthResponse(false, null, null, null, 'Password processing error')
        );
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json(
      formatAuthResponse(false, null, null, null, 'Internal server error')
    );
  }
});

// POST /auth/refresh - Matches your iOS RefreshTokenRequest model
router.post('/refresh', [
  body('refreshToken').isLength({ min: 1 })
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(401).json(
        formatAuthResponse(false, null, null, null, 'Refresh token required')
      );
    }

    const { refreshToken } = req.body;

    jwt.verify(refreshToken, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(403).json(
          formatAuthResponse(false, null, null, null, 'Invalid refresh token')
        );
      }

      // Get user to include in response
      UserModel.getProfile(decoded.userId, (err, user) => {
        if (err || !user) {
          return res.status(404).json(
            formatAuthResponse(false, null, null, null, 'User not found')
          );
        }

        // Generate new tokens
        const newToken = generateToken(decoded.userId);
        const newRefreshToken = generateToken(decoded.userId, process.env.JWT_REFRESH_EXPIRES_IN);

        // Return new tokens (matches iOS AuthResponse)
        res.json(
          formatAuthResponse(true, newToken, newRefreshToken, user, 'Tokens refreshed successfully')
        );
      });
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(403).json(
      formatAuthResponse(false, null, null, null, 'Token refresh failed')
    );
  }
});

// POST /auth/logout - Matches your iOS expectations
router.post('/logout', authenticateToken, (req, res) => {
  // In production, you would invalidate the token in a blacklist
  // For now, return success (client will delete the token)
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

// GET /auth/profile - For your iOS getCurrentUser method
router.get('/profile', authenticateToken, (req, res) => {
  UserModel.getProfile(req.user.id, (err, profile) => {
    if (err) {
      console.error('Error retrieving profile:', err);
      return res.status(500).json({
        success: false,
        message: 'Failed to retrieve profile'
      });
    }

    if (!profile) {
      return res.status(404).json({
        success: false,
        message: 'Profile not found'
      });
    }

    // Format response to match iOS expectations
    res.json({
      success: true,
      user: {
        id: profile.id.toString(),
        email: profile.email,
        username: profile.username,
        firstName: profile.first_name,
        lastName: profile.last_name,
        createdAt: profile.created_at,
        isVerified: !!profile.is_verified
      }
    });
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'zipIQ Authentication API',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

module.exports = router;