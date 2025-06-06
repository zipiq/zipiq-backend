require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const http = require('http');

// Import routes
const authRoutes = require('./routes/auth');
const streamRoutes = require('./routes/stream');

// Import middleware
const { authenticateToken } = require('./middleware/auth');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

// ==============================================
// MIDDLEWARE SETUP
// ==============================================

// Security headers
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.MAX_REQUESTS_PER_WINDOW) || 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', limiter);

// UPDATED CORS configuration - Fix for iOS mobile app
const corsOptions = {
  origin: function (origin, callback) {
    // Always allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      console.log('🔍 CORS: Allowing request with no origin (mobile app)');
      return callback(null, true);
    }
    
    // Get allowed origins from environment variable
    const allowedOrigins = process.env.ALLOWED_ORIGINS 
      ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
      : ['*'];
    
    console.log('🔍 CORS: Checking origin:', origin);
    console.log('🔍 CORS: Allowed origins:', allowedOrigins);
    
    // Always allow if wildcard is set
    if (allowedOrigins.includes('*')) {
      console.log('✅ CORS: Allowing all origins (wildcard)');
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      console.log('✅ CORS: Origin allowed');
      return callback(null, true);
    }
    
    // For development, be more permissive
    if (process.env.NODE_ENV !== 'production') {
      console.log('✅ CORS: Development mode - allowing origin');
      return callback(null, true);
    }
    
    console.log('❌ CORS: Origin not allowed');
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  optionsSuccessStatus: 200,
  // Explicitly allow common headers that iOS might send
  allowedHeaders: [
    'Origin',
    'X-Requested-With', 
    'Content-Type', 
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma',
    'User-Agent',
    'DNT',
    'If-Modified-Since',
    'Keep-Alive',
    'X-CustomHeader'
  ],
  // Allow all common HTTP methods
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH']
};

app.use(cors(corsOptions));

// Add preflight handling for all routes
app.options('*', cors(corsOptions));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Enhanced request logging with CORS debugging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  const ip = req.ip || req.connection.remoteAddress;
  const origin = req.get('Origin') || 'no-origin';
  const userAgent = req.get('User-Agent') || 'no-user-agent';
  
  console.log(`${timestamp} - ${req.method} ${req.path}`);
  console.log(`   IP: ${ip}`);
  console.log(`   Origin: ${origin}`);
  console.log(`   User-Agent: ${userAgent.substring(0, 100)}...`);
  
  // Log request headers for debugging
  if (req.method === 'OPTIONS') {
    console.log('🔍 PREFLIGHT REQUEST - Headers:', JSON.stringify(req.headers, null, 2));
  }
  
  next();
});

// ==============================================
// SOCKET.IO SETUP (WebRTC Signaling)
// ==============================================

const io = new Server(server, {
  cors: corsOptions,
  transports: ['websocket', 'polling']
});

// WebRTC signaling for live streaming
const rooms = new Map();
const peers = new Map();

io.on('connection', (socket) => {
  console.log(`🔗 Peer connected: ${socket.id}`);
  
  // Join streaming room
  socket.on('join-room', (roomId, peerId) => {
    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    
    rooms.get(roomId).add(peerId);
    peers.set(socket.id, { roomId, peerId });
    
    // Notify other peers
    socket.to(roomId).emit('peer-joined', peerId);
    socket.join(roomId);
    
    // Send existing peers
    const existingPeers = Array.from(rooms.get(roomId))
      .filter(id => id !== peerId);
    socket.emit('existing-peers', existingPeers);
    
    console.log(`👥 Peer ${peerId} joined room ${roomId} (${rooms.get(roomId).size} total peers)`);
  });
  
  // WebRTC signaling
  socket.on('signal', (targetPeer, signalData) => {
    const peer = peers.get(socket.id);
    if (peer) {
      socket.to(peer.roomId).emit('signal', peer.peerId, targetPeer, signalData);
    }
  });
  
  // Content announcement
  socket.on('content-available', (contentHash, metadata) => {
    const peer = peers.get(socket.id);
    if (peer) {
      socket.to(peer.roomId).emit('content-available', {
        hash: contentHash,
        peer: peer.peerId,
        metadata: metadata,
        timestamp: Date.now()
      });
      console.log(`📡 Content announced: ${contentHash} from ${peer.peerId}`);
    }
  });
  
  // Handle disconnection
  socket.on('disconnect', () => {
    const peer = peers.get(socket.id);
    if (peer) {
      const room = rooms.get(peer.roomId);
      if (room) {
        room.delete(peer.peerId);
        if (room.size === 0) {
          rooms.delete(peer.roomId);
        }
      }
      socket.to(peer.roomId).emit('peer-left', peer.peerId);
      peers.delete(socket.id);
      console.log(`👋 Peer ${peer.peerId} left room ${peer.roomId}`);
    }
  });
});

// ==============================================
// API ROUTES
// ==============================================

// Health check endpoint
app.get('/api/v1/health', async (req, res) => {
  try {
    const IPFSService = require('./services/ipfs');
    const ArweaveService = require('./services/arweave');
    
    const ipfsHealth = await IPFSService.healthCheck();
    const arweaveHealth = await ArweaveService.healthCheck();
    
    res.json({ 
      status: 'OK', 
      message: 'zipIQ API is running',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      services: {
        ipfs: ipfsHealth,
        arweave: arweaveHealth,
        webrtc: {
          status: 'healthy',
          activeRooms: rooms.size,
          connectedPeers: peers.size
        }
      }
    });
  } catch (error) {
    console.error('❌ Health check error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Health check failed',
      error: error.message
    });
  }
});

// Authentication routes
app.use('/api/v1/auth', authRoutes);

// Streaming routes (protected)
app.use('/api/v1/stream', streamRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to zipIQ API - Censorship-Resistant Live Streaming',
    version: '1.0.0',
    documentation: '/api/v1/docs',
    health: '/api/v1/health',
    services: {
      authentication: '/api/v1/auth',
      streaming: '/api/v1/stream',
      webrtc: 'WebSocket connection available'
    },
    features: [
      'Decentralized live streaming',
      'IPFS content storage',
      'Arweave permanent archival',
      'WebRTC peer-to-peer streaming',
      'Censorship-resistant architecture'
    ]
  });
});

// ==============================================
// ADMIN ENDPOINTS (Optional)
// ==============================================

// Get system statistics (protected)
app.get('/api/v1/admin/stats', authenticateToken, async (req, res) => {
  try {
    const IPFSService = require('./services/ipfs');
    const ArweaveService = require('./services/arweave');
    
    const ipfsStats = IPFSService.getStorageStats();
    const arweaveStats = ArweaveService.getQueueStats();
    
    res.json({
      success: true,
      stats: {
        ipfs: ipfsStats,
        arweave: arweaveStats,
        webrtc: {
          activeRooms: rooms.size,
          connectedPeers: peers.size,
          roomDetails: Array.from(rooms.entries()).map(([roomId, peers]) => ({
            roomId,
            peerCount: peers.size
          }))
        },
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          nodeVersion: process.version,
          environment: process.env.NODE_ENV
        }
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve stats',
      error: error.message
    });
  }
});

// ==============================================
// ERROR HANDLING
// ==============================================

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint not found',
    code: 'ENDPOINT_NOT_FOUND',
    path: req.originalUrl,
    availableEndpoints: [
      'GET /api/v1/health',
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/register',
      'POST /api/v1/stream/upload-chunk',
      'GET /api/v1/stream/:streamId/status'
    ]
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  
  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(err.status || 500).json({
    success: false,
    message: isDevelopment ? err.message : 'Internal server error',
    code: 'INTERNAL_ERROR',
    ...(isDevelopment && { stack: err.stack })
  });
});

// ==============================================
// GRACEFUL SHUTDOWN
// ==============================================

const shutdown = (signal) => {
  console.log(`\n💡 Received ${signal}, shutting down gracefully...`);
  
  server.close(() => {
    console.log('🔴 HTTP server closed');
    
    // Close socket.io server
    io.close(() => {
      console.log('🔴 Socket.IO server closed');
      
      // Additional cleanup
      rooms.clear();
      peers.clear();
      
      console.log('✅ Graceful shutdown completed');
      process.exit(0);
    });
  });
  
  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('⚠️  Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ==============================================
// START SERVER
// ==============================================

server.listen(PORT, () => {
  console.log('\n🚀 zipIQ Backend Server Starting...');
  console.log('='.repeat(60));
  console.log(`📱 App: zipIQ - Censorship-Resistant Live Streaming`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🚪 Port: ${PORT}`);
  console.log(`📍 Local URL: http://localhost:${PORT}`);
  console.log(`🔗 API Base: http://localhost:${PORT}/api/v1`);
  console.log(`❤️  Health Check: http://localhost:${PORT}/api/v1/health`);
  console.log(`🔐 Auth Endpoints: http://localhost:${PORT}/api/v1/auth`);
  console.log(`📺 Stream Endpoints: http://localhost:${PORT}/api/v1/stream`);
  console.log(`🌐 WebRTC Signaling: WebSocket on port ${PORT}`);
  console.log('='.repeat(60));
  console.log('✅ Server is ready to accept connections');
  console.log('📋 Available Services:');
  console.log('   • User Authentication (JWT)');
  console.log('   • Live Video Streaming (WebRTC)');
  console.log('   • IPFS Content Storage');
  console.log('   • Arweave Permanent Archival');
  console.log('   • Censorship-Resistant Distribution');
  console.log('\n💡 Next Steps:');
  console.log('   1. Update your iOS app baseURL to this server');
  console.log('   2. Test authentication endpoints');
  console.log('   3. Test live streaming functionality');
  console.log('   4. Deploy to Akash Network for decentralization');
  console.log('\n🔧 CORS Configuration:');
  console.log('   • Mobile apps (no origin): ✅ Allowed');
  console.log('   • Development mode: ✅ Permissive');
  console.log('   • Preflight requests: ✅ Handled');
  console.log('   • Custom headers: ✅ Supported\n');
});

module.exports = { app, server, io };