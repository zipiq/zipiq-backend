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

// ==============================================
// PASSWORD RESET ENDPOINTS
// ==============================================

// POST /auth/forgot-password - Request password reset
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Valid email address is required'
      });
    }

    const { email } = req.body;

    // Find user by email
    UserModel.findByEmail(email, async (err, user) => {
      if (err) {
        console.error('Database error in forgot password:', err);
        return res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }

      // Always return success for security (don't reveal if email exists)
      const successResponse = {
        success: true,
        message: 'If an account with that email exists, we have sent a password reset link.'
      };

      if (!user) {
        // User doesn't exist, but don't reveal this information
        return res.json(successResponse);
      }

      try {
        // Generate secure reset token
        const crypto = require('crypto');
        const resetToken = crypto.randomBytes(32).toString('hex');
        
        // Set expiration time (1 hour from now)
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1);

        // Save token to database
        UserModel.setPasswordResetToken(email, resetToken, expiresAt, async (err, updatedUser) => {
          if (err) {
            console.error('Error saving reset token:', err);
            return res.status(500).json({
              success: false,
              message: 'Internal server error'
            });
          }

          try {
            // Send password reset email
            const nodemailer = require('nodemailer');
            
            const transporter = nodemailer.createTransport({
              host: process.env.SMTP_HOST,
              port: parseInt(process.env.SMTP_PORT),
              secure: false,
              auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
              }
            });

            // Create reset URL (you'll need to update this with your actual frontend URL)
            const resetUrl = `${process.env.FRONTEND_URL || 'https://zipiq.com'}/reset-password?token=${resetToken}`;

            const emailOptions = {
              from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
              to: email,
              subject: 'Reset Your zipIQ Password',
              html: createPasswordResetEmailHTML(user.username || 'there', resetUrl, resetToken)
            };

            await transporter.sendMail(emailOptions);
            
            console.log(`✅ Password reset email sent to ${email}`);
            res.json(successResponse);

          } catch (emailError) {
            console.error('Error sending password reset email:', emailError);
            // Still return success to user for security
            res.json(successResponse);
          }
        });

      } catch (tokenError) {
        console.error('Error generating reset token:', tokenError);
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// POST /auth/reset-password - Reset password with token
router.post('/reset-password', [
  body('token').isLength({ min: 1 }),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Valid token and password (minimum 8 characters) are required'
      });
    }

    const { token, password } = req.body;

    // Find user by reset token
    UserModel.findByResetToken(token, async (err, user) => {
      if (err) {
        console.error('Database error in reset password:', err);
        return res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token'
        });
      }

      try {
        // Hash new password
        const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 12;
        const newPasswordHash = await bcrypt.hash(password, saltRounds);

        // Update password and clear reset token
        UserModel.updatePasswordWithToken(token, newPasswordHash, (err, updatedUser) => {
          if (err) {
            console.error('Error updating password:', err);
            return res.status(500).json({
              success: false,
              message: 'Internal server error'
            });
          }

          if (!updatedUser) {
            return res.status(400).json({
              success: false,
              message: 'Invalid or expired reset token'
            });
          }

          console.log(`✅ Password successfully reset for user: ${updatedUser.email}`);
          
          res.json({
            success: true,
            message: 'Password has been reset successfully. You can now log in with your new password.'
          });
        });

      } catch (hashError) {
        console.error('Error hashing new password:', hashError);
        res.status(500).json({
          success: false,
          message: 'Internal server error'
        });
      }
    });

  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
});

// GET /auth/validate-reset-token/:token - Validate reset token
router.get('/validate-reset-token/:token', (req, res) => {
  const { token } = req.params;

  if (!token) {
    return res.status(400).json({
      success: false,
      message: 'Reset token is required'
    });
  }

  UserModel.findByResetToken(token, (err, user) => {
    if (err) {
      console.error('Database error in validate token:', err);
      return res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token'
      });
    }

    res.json({
      success: true,
      message: 'Reset token is valid',
      data: {
        email: user.email,
        expiresAt: user.reset_password_expires
      }
    });
  });
});

// ==============================================
// EMAIL TEMPLATE FUNCTION
// ==============================================

// Update your email template function in routes/auth.js
// Replace the existing createPasswordResetEmailHTML function with this:

function createPasswordResetEmailHTML(username, resetUrl, token) {
  // Extract just the token from the URL for mobile-friendly display
  const displayToken = token;
  
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="color: #333; margin-bottom: 10px;">Reset Your zipIQ Password</h1>
        <p style="color: #666; font-size: 16px;">We received a request to reset your password</p>
      </div>
      
      <div style="background-color: #f9f9f9; padding: 30px; border-radius: 10px; margin-bottom: 30px;">
        <p style="color: #333; font-size: 16px; margin-bottom: 20px;">Hi ${username},</p>
        <p style="color: #333; font-size: 16px; margin-bottom: 20px;">
          Someone requested a password reset for your zipIQ account. Use the reset code below in the zipIQ mobile app:
        </p>
        
        <!-- Mobile-Friendly Reset Code -->
        <div style="background-color: #f0f8ff; border: 2px solid #007bff; border-radius: 8px; padding: 20px; margin: 30px 0; text-align: center;">
          <p style="color: #333; font-size: 14px; font-weight: bold; margin-bottom: 10px;">RESET CODE:</p>
          <div style="background-color: white; padding: 15px; border-radius: 5px; border: 1px solid #ddd;">
            <span style="font-family: 'Courier New', monospace; font-size: 18px; font-weight: bold; color: #007bff; letter-spacing: 2px;">
              ${displayToken}
            </span>
          </div>
          <p style="color: #666; font-size: 12px; margin-top: 10px;">
            📱 <strong>Mobile users:</strong> Tap and hold to copy this code, then paste it in the zipIQ app
          </p>
        </div>
        
        <!-- Instructions for Mobile App -->
        <div style="background-color: #e8f5e8; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0;">
          <h3 style="color: #28a745; margin-top: 0;">How to reset your password:</h3>
          <ol style="color: #333; font-size: 14px; margin-bottom: 0;">
            <li>Open the zipIQ mobile app</li>
            <li>Tap "Forgot Password?" on the login screen</li>
            <li>Tap "Enter Reset Token Manually"</li>
            <li>Copy and paste the reset code above</li>
            <li>Enter your new password</li>
          </ol>
        </div>
        
        <!-- Web Option (for future use) -->
        <div style="text-align: center; margin: 30px 0;">
          <p style="color: #666; font-size: 14px; margin-bottom: 15px;">
            Or reset your password on the web:
          </p>
          <a href="${resetUrl}" 
             style="background-color: #007bff; color: white; padding: 12px 25px; 
                    text-decoration: none; border-radius: 5px; font-size: 14px; 
                    font-weight: bold; display: inline-block;">
            Reset Password Online
          </a>
        </div>
        
        <div style="border-top: 1px solid #ddd; padding-top: 20px; margin-top: 20px;">
          <p style="color: #d9534f; font-size: 14px; font-weight: bold; margin-bottom: 10px;">
            ⚠️ This reset code will expire in 1 hour
          </p>
          <p style="color: #666; font-size: 14px;">
            If you didn't request this password reset, please ignore this email. 
            Your password will remain unchanged.
          </p>
        </div>
      </div>
      
      <div style="text-align: center; color: #999; font-size: 12px; border-top: 1px solid #eee; padding-top: 20px;">
        <p>This email was sent by zipIQ Security System</p>
        <p>If you have questions, contact support at support@zipiq.com</p>
      </div>
    </div>
  `;
}

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