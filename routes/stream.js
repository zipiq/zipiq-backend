const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../middleware/auth');
const IPFSService = require('../services/ipfs');
const ArweaveService = require('../services/arweave');

const router = express.Router();

// Configure multer for video chunk uploads
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB max chunk size
  }
});

// POST /stream/upload-chunk - Upload video chunk to IPFS + queue for Arweave
router.post('/upload-chunk', authenticateToken, upload.single('chunk'), async (req, res) => {
  try {
    const { buffer, mimetype, originalname } = req.file || {};
    const { streamId, chunkIndex, timestamp } = req.body;

    if (!buffer) {
      return res.status(400).json({
        success: false,
        message: 'No video chunk provided'
      });
    }

    if (!streamId || chunkIndex === undefined || !timestamp) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: streamId, chunkIndex, timestamp'
      });
    }

    console.log(`📦 Processing chunk ${chunkIndex} for stream ${streamId}`);

    // Upload to IPFS
    const ipfsResult = await IPFSService.uploadChunk(buffer, {
      streamId,
      chunkIndex: parseInt(chunkIndex),
      timestamp: parseInt(timestamp),
      userId: req.user.id,
      mimetype: mimetype || 'video/quicktime',
      originalname: originalname || `chunk_${chunkIndex}.mov`
    });

    // Queue for Arweave archival
    await ArweaveService.queueForArchival({
      data: buffer,
      ipfsHash: ipfsResult.hash,
      streamId,
      chunkIndex: parseInt(chunkIndex),
      timestamp: parseInt(timestamp),
      userId: req.user.id
    });

    res.json({
      success: true,
      ipfsHash: ipfsResult.hash,
      size: buffer.length,
      arweaveQueued: true,
      chunkIndex: parseInt(chunkIndex),
      uploadTime: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Chunk upload error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload chunk',
      error: error.message
    });
  }
});

// GET /stream/:streamId/chunks - Get list of chunks for a stream
router.get('/:streamId/chunks', async (req, res) => {
  try {
    const { streamId } = req.params;
    
    // Get chunks from IPFS service
    const chunks = await IPFSService.getStreamChunks(streamId);
    
    res.json({
      success: true,
      streamId,
      chunks: chunks.map(chunk => ({
        chunkIndex: chunk.chunkIndex,
        ipfsHash: chunk.ipfsHash,
        timestamp: chunk.timestamp,
        size: chunk.size,
        arweaveStatus: chunk.arweaveStatus || 'pending'
      }))
    });

  } catch (error) {
    console.error('❌ Error retrieving chunks:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve stream chunks'
    });
  }
});

// GET /stream/:streamId/status - Get stream status
router.get('/:streamId/status', async (req, res) => {
  try {
    const { streamId } = req.params;
    
    // Get stream metadata
    const chunks = await IPFSService.getStreamChunks(streamId);
    const arweaveStatus = await ArweaveService.getStreamStatus(streamId);
    
    const totalChunks = chunks.length;
    const archivedChunks = arweaveStatus.archivedCount || 0;
    const totalSize = chunks.reduce((sum, chunk) => sum + chunk.size, 0);
    
    res.json({
      success: true,
      streamId,
      status: {
        totalChunks,
        archivedChunks,
        archivalProgress: totalChunks > 0 ? (archivedChunks / totalChunks) : 0,
        totalSize,
        startTime: chunks.length > 0 ? Math.min(...chunks.map(c => c.timestamp)) : null,
        lastUpdate: chunks.length > 0 ? Math.max(...chunks.map(c => c.timestamp)) : null,
        ipfsNodes: chunks.length,
        arweaveTransactions: arweaveStatus.transactions || []
      }
    });

  } catch (error) {
    console.error('❌ Error getting stream status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get stream status'
    });
  }
});

// POST /stream/create - Create new stream
router.post('/create', authenticateToken, async (req, res) => {
  try {
    const streamId = uuidv4();
    const { title, description, isPrivate = false } = req.body;
    
    // Create stream metadata
    const streamMetadata = {
      id: streamId,
      userId: req.user.id,
      title: title || `Stream ${streamId.slice(0, 8)}`,
      description: description || '',
      isPrivate,
      createdAt: new Date().toISOString(),
      status: 'created',
      chunks: []
    };

    // Store metadata in IPFS
    const metadataHash = await IPFSService.uploadJSON(streamMetadata);
    
    console.log(`📺 Created new stream: ${streamId}`);
    
    res.json({
      success: true,
      stream: {
        id: streamId,
        title: streamMetadata.title,
        description: streamMetadata.description,
        metadataHash,
        createdAt: streamMetadata.createdAt,
        status: 'created'
      }
    });

  } catch (error) {
    console.error('❌ Error creating stream:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create stream'
    });
  }
});

// GET /stream/user/:userId - Get user's streams
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Only allow users to see their own streams (for now)
    if (req.user.id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Get user's streams from IPFS
    const streams = await IPFSService.getUserStreams(userId);
    
    res.json({
      success: true,
      streams: streams.map(stream => ({
        id: stream.id,
        title: stream.title,
        description: stream.description,
        createdAt: stream.createdAt,
        chunkCount: stream.chunks ? stream.chunks.length : 0,
        status: stream.status
      }))
    });

  } catch (error) {
    console.error('❌ Error retrieving user streams:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve streams'
    });
  }
});

// DELETE /stream/:streamId - Delete stream (mark as deleted, don't actually delete from IPFS/Arweave)
router.delete('/:streamId', authenticateToken, async (req, res) => {
  try {
    const { streamId } = req.params;
    
    // Verify ownership
    const streamMetadata = await IPFSService.getStreamMetadata(streamId);
    if (!streamMetadata || streamMetadata.userId !== req.user.id) {
      return res.status(404).json({
        success: false,
        message: 'Stream not found or access denied'
      });
    }
    
    // Mark as deleted (but don't actually delete from IPFS/Arweave)
    streamMetadata.status = 'deleted';
    streamMetadata.deletedAt = new Date().toISOString();
    
    // Update metadata
    await IPFSService.uploadJSON(streamMetadata);
    
    console.log(`🗑️ Marked stream as deleted: ${streamId}`);
    
    res.json({
      success: true,
      message: 'Stream marked as deleted'
    });

  } catch (error) {
    console.error('❌ Error deleting stream:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete stream'
    });
  }
});

// GET /stream/health - Health check for streaming service
router.get('/health', async (req, res) => {
  try {
    const ipfsHealth = await IPFSService.healthCheck();
    const arweaveHealth = await ArweaveService.healthCheck();
    
    res.json({
      success: true,
      service: 'zipIQ Streaming API',
      timestamp: new Date().toISOString(),
      services: {
        ipfs: ipfsHealth,
        arweave: arweaveHealth
      },
      version: '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Health check failed',
      error: error.message
    });
  }
});

module.exports = router;