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
// TEMPORARY TEST ENDPOINTS FOR EMAIL SETUP
// ==============================================

// GET /auth/test-email - Test environment variables are loaded
// This endpoint checks if email-related environment variables are properly configured
// REMOVE THIS ENDPOINT BEFORE PRODUCTION DEPLOYMENT
router.get('/test-email', async (req, res) => {
  try {
    // Log environment variables to Railway logs for debugging
    console.log('=== EMAIL CONFIGURATION TEST ===');
    console.log('SMTP_HOST:', process.env.SMTP_HOST);
    console.log('SMTP_PORT:', process.env.SMTP_PORT);
    console.log('SMTP_USER:', process.env.SMTP_USER);
    console.log('FROM_EMAIL:', process.env.FROM_EMAIL);
    console.log('FROM_NAME:', process.env.FROM_NAME);
    console.log('SMTP_PASS configured:', !!process.env.SMTP_PASS);
    console.log('NODE_ENV:', process.env.NODE_ENV);
    console.log('================================');

    // Return configuration status to client
    res.json({ 
      success: true, 
      message: 'Environment variables test completed',
      configuration: {
        smtpConfigured: !!process.env.SMTP_USER,
        smtpHost: process.env.SMTP_HOST || 'not set',
        smtpPort: process.env.SMTP_PORT || 'not set',
        smtpUser: process.env.SMTP_USER || 'not set',
        fromEmail: process.env.FROM_EMAIL || 'not set',
        fromName: process.env.FROM_NAME || 'not set',
        passwordConfigured: !!process.env.SMTP_PASS,
        environment: process.env.NODE_ENV || 'development'
      },
      nextSteps: [
        'If smtpConfigured is false, add SMTP environment variables in Railway',
        'If smtpConfigured is true, proceed to install nodemailer dependency',
        'Then test actual email sending with /auth/test-send-email endpoint'
      ]
    });
  } catch (error) {
    console.error('Environment test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      message: 'Failed to test environment variables'
    });
  }
});

// GET /auth/test-send-email - Test actual email sending (add this after installing nodemailer)
// This endpoint attempts to send a test email using the configured SMTP settings
// REMOVE THIS ENDPOINT BEFORE PRODUCTION DEPLOYMENT
router.get('/test-send-email', async (req, res) => {
  try {
    // Check if nodemailer is available (will be installed in next step)
    let nodemailer;
    try {
      nodemailer = require('nodemailer');
    } catch (requireError) {
      return res.status(500).json({
        success: false,
        message: 'nodemailer not installed yet',
        instructions: 'Run: npm install nodemailer crypto',
        error: 'MODULE_NOT_FOUND'
      });
    }

    // Verify all required environment variables are set
    const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'FROM_EMAIL', 'FROM_NAME'];
    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Missing required environment variables',
        missingVariables: missingVars,
        instructions: 'Add these variables in Railway Dashboard → Variables'
      });
    }

    console.log('=== ATTEMPTING TEST EMAIL SEND ===');
    console.log('Using SMTP Host:', process.env.SMTP_HOST);
    console.log('Using SMTP User:', process.env.SMTP_USER);

    // Create transporter with current environment settings
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });

    // Test email content
    const testEmailOptions = {
      from: `"${process.env.FROM_NAME}" <${process.env.FROM_EMAIL}>`,
      to: 'wbowman@zipiq.com', // Will Bowman's email for testing
      subject: 'zipIQ Email Configuration Test',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">🎉 Email Configuration Successful!</h2>
          <p>Congratulations! Your zipIQ backend can now send emails.</p>
          <p><strong>Configuration Details:</strong></p>
          <ul>
            <li>SMTP Host: ${process.env.SMTP_HOST}</li>
            <li>SMTP Port: ${process.env.SMTP_PORT}</li>
            <li>From Email: ${process.env.FROM_EMAIL}</li>
            <li>Environment: ${process.env.NODE_ENV || 'development'}</li>
            <li>Test Time: ${new Date().toISOString()}</li>
          </ul>
          <p>You can now proceed with implementing the forgot password functionality.</p>
          <p><em>Remember to remove test endpoints before production!</em></p>
        </div>
      `
    };

    // Attempt to send test email
    const result = await transporter.sendMail(testEmailOptions);
    
    console.log('✅ Test email sent successfully!');
    console.log('Message ID:', result.messageId);
    console.log('==============================');

    res.json({ 
      success: true, 
      message: 'Test email sent successfully!',
      details: {
        messageId: result.messageId,
        from: testEmailOptions.from,
        to: testEmailOptions.to,
        smtpHost: process.env.SMTP_HOST,
        timestamp: new Date().toISOString()
      },
      instructions: [
        'Check your email inbox (and spam folder) for the test email',
        'If email received, your configuration is working correctly',
        'You can now proceed to implement forgot password functionality',
        'Remember to remove these test endpoints before production'
      ]
    });

  } catch (error) {
    console.error('❌ Email send test failed:', error);
    
    // Provide helpful error messages based on common issues
    let errorMessage = error.message;
    let suggestions = [];

    if (error.code === 'EAUTH') {
      errorMessage = 'SMTP Authentication failed';
      suggestions = [
        'Check your SMTP_USER and SMTP_PASS are correct',
        'For Gmail: Make sure you\'re using an App Password, not your regular password',
        'For SendGrid: Make sure SMTP_USER is "apikey" and SMTP_PASS is your API key'
      ];
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused to SMTP server';
      suggestions = [
        'Check your SMTP_HOST and SMTP_PORT are correct',
        'Make sure your Railway app can make outbound connections',
        'Verify the email service is not blocking Railway\'s IP addresses'
      ];
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Connection timed out';
      suggestions = [
        'SMTP server may be down or unreachable',
        'Check if Railway has any network restrictions',
        'Try a different SMTP service (SendGrid recommended)'
      ];
    }

    res.status(500).json({ 
      success: false, 
      error: errorMessage,
      errorCode: error.code || 'UNKNOWN_ERROR',
      suggestions: suggestions,
      configuration: {
        smtpHost: process.env.SMTP_HOST,
        smtpPort: process.env.SMTP_PORT,
        smtpUser: process.env.SMTP_USER,
        fromEmail: process.env.FROM_EMAIL
      }
    });
  }
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