// ipfs.js - Pure Mock Implementation (No IPFS dependencies)
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class MockIPFSService {
  constructor() {
    this.chunkStore = new Map();
    this.streamStore = new Map();
    this.mockStorage = new Map(); // Simulates IPFS content storage
    this.connected = true; // Always "connected" for mock
    this.nodeId = `mock-node-${crypto.randomBytes(4).toString('hex')}`;
    
    // Create uploads directory for temporary file storage
    this.uploadsDir = path.join(process.cwd(), 'uploads');
    this.ensureUploadsDirectory();
    
    console.log('🎭 Mock IPFS Service initialized - No external dependencies');
    console.log(`📁 Mock storage directory: ${this.uploadsDir}`);
  }

  ensureUploadsDirectory() {
    try {
      if (!fs.existsSync(this.uploadsDir)) {
        fs.mkdirSync(this.uploadsDir, { recursive: true });
        console.log(`📁 Created uploads directory: ${this.uploadsDir}`);
      }
    } catch (error) {
      console.error('❌ Failed to create uploads directory:', error);
    }
  }

  // Generate a realistic-looking IPFS hash
  generateMockHash(data) {
    const hash = crypto.createHash('sha256');
    
    if (Buffer.isBuffer(data)) {
      hash.update(data);
    } else if (typeof data === 'string') {
      hash.update(data, 'utf8');
    } else {
      hash.update(JSON.stringify(data), 'utf8');
    }
    
    // Add timestamp for uniqueness
    hash.update(Date.now().toString());
    
    // Create a mock IPFS hash format (Qm...)
    const digest = hash.digest('hex');
    return `Qm${digest.substr(0, 44)}`; // Standard IPFS hash length
  }

  // Store data locally and return mock hash
  async storeDataLocally(buffer, filename = null) {
    try {
      const mockHash = this.generateMockHash(buffer);
      
      // Store in memory
      this.mockStorage.set(mockHash, {
        data: buffer,
        filename: filename,
        size: buffer.length,
        storedAt: new Date().toISOString(),
        mimetype: this.guessMimeType(filename)
      });
      
      // Optionally store to disk for persistence
      if (filename) {
        const filePath = path.join(this.uploadsDir, `${mockHash}-${filename}`);
        fs.writeFileSync(filePath, buffer);
      }
      
      return mockHash;
    } catch (error) {
      console.error('❌ Error storing mock data:', error);
      throw error;
    }
  }

  guessMimeType(filename) {
    if (!filename) return 'application/octet-stream';
    
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes = {
      '.mp4': 'video/mp4',
      '.mov': 'video/quicktime',
      '.avi': 'video/x-msvideo',
      '.webm': 'video/webm',
      '.mkv': 'video/x-matroska',
      '.json': 'application/json',
      '.txt': 'text/plain',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }

  async uploadChunk(buffer, metadata) {
    try {
      console.log(`📤 Mock uploading chunk ${metadata.chunkIndex} for stream ${metadata.streamId}...`);
      
      // Generate mock IPFS hash
      const mockHash = this.generateMockHash(buffer);
      
      // Store the chunk data
      await this.storeDataLocally(buffer, `chunk-${metadata.chunkIndex}-${metadata.streamId}.bin`);
      
      const chunkData = {
        ipfsHash: mockHash,
        streamId: metadata.streamId,
        chunkIndex: metadata.chunkIndex,
        timestamp: metadata.timestamp,
        userId: metadata.userId,
        size: buffer.length,
        mimetype: metadata.mimetype || 'video/mp4',
        uploadedAt: new Date().toISOString(),
        isMock: true,
        localPath: path.join(this.uploadsDir, `${mockHash}-chunk-${metadata.chunkIndex}-${metadata.streamId}.bin`)
      };
      
      // Store chunk metadata
      this.chunkStore.set(`${metadata.streamId}_${metadata.chunkIndex}`, chunkData);
      
      // Update stream metadata
      await this.updateStreamChunks(metadata.streamId, chunkData);
      
      console.log(`✅ Mock chunk uploaded: ${mockHash} (${buffer.length} bytes)`);
      
      return {
        hash: mockHash,
        size: buffer.length,
        uploadedAt: chunkData.uploadedAt,
        isMock: true
      };
      
    } catch (error) {
      console.error('❌ Mock upload error:', error);
      throw new Error(`Mock upload failed: ${error.message}`);
    }
  }

  async uploadJSON(data) {
    try {
      console.log('📝 Mock uploading JSON data...');
      
      const jsonString = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(jsonString, 'utf8');
      const mockHash = await this.storeDataLocally(buffer, 'metadata.json');
      
      console.log(`✅ Mock JSON uploaded: ${mockHash}`);
      return mockHash;
      
    } catch (error) {
      console.error('❌ Mock JSON upload error:', error);
      throw new Error(`Mock JSON upload failed: ${error.message}`);
    }
  }

  async uploadFile(filePath, originalName = null) {
    try {
      console.log(`📤 Mock uploading file: ${filePath}`);
      
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }
      
      const buffer = fs.readFileSync(filePath);
      const filename = originalName || path.basename(filePath);
      const mockHash = await this.storeDataLocally(buffer, filename);
      
      console.log(`✅ Mock file uploaded: ${mockHash} (${buffer.length} bytes)`);
      
      return {
        hash: mockHash,
        size: buffer.length,
        filename: filename,
        uploadedAt: new Date().toISOString(),
        isMock: true
      };
      
    } catch (error) {
      console.error('❌ Mock file upload error:', error);
      throw new Error(`Mock file upload failed: ${error.message}`);
    }
  }

  async getStreamChunks(streamId) {
    try {
      const chunks = [];
      for (const [key, chunkData] of this.chunkStore.entries()) {
        if (chunkData.streamId === streamId) {
          chunks.push(chunkData);
        }
      }
      
      // Sort by chunk index
      chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      
      console.log(`📋 Retrieved ${chunks.length} chunks for stream ${streamId}`);
      return chunks;
    } catch (error) {
      console.error('❌ Error retrieving stream chunks:', error);
      throw new Error(`Failed to retrieve chunks: ${error.message}`);
    }
  }

  async getStreamMetadata(streamId) {
    try {
      const metadata = this.streamStore.get(streamId) || null;
      console.log(`📋 Retrieved metadata for stream ${streamId}:`, metadata ? 'Found' : 'Not found');
      return metadata;
    } catch (error) {
      console.error('❌ Error retrieving stream metadata:', error);
      throw new Error(`Failed to retrieve stream metadata: ${error.message}`);
    }
  }

  async getUserStreams(userId) {
    try {
      const userStreams = [];
      for (const [streamId, streamData] of this.streamStore.entries()) {
        if (streamData.userId === userId && streamData.status !== 'deleted') {
          userStreams.push(streamData);
        }
      }
      
      // Sort by creation date (newest first)
      userStreams.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      
      console.log(`📋 Retrieved ${userStreams.length} streams for user ${userId}`);
      return userStreams;
    } catch (error) {
      console.error('❌ Error retrieving user streams:', error);
      throw new Error(`Failed to retrieve user streams: ${error.message}`);
    }
  }

  async updateStreamChunks(streamId, chunkData) {
    try {
      let streamMetadata = this.streamStore.get(streamId);
      
      if (!streamMetadata) {
        // Create new stream metadata
        streamMetadata = {
          id: streamId,
          userId: chunkData.userId,
          title: `Mock Stream ${streamId.slice(0, 8)}`,
          description: 'Mock IPFS stream for testing',
          createdAt: new Date().toISOString(),
          status: 'active',
          chunks: [],
          isMock: true,
          totalSize: 0,
          duration: 0
        };
      }
      
      // Add or update chunk
      const existingChunkIndex = streamMetadata.chunks.findIndex(
        c => c.chunkIndex === chunkData.chunkIndex
      );
      
      if (existingChunkIndex >= 0) {
        // Update existing chunk
        const oldSize = streamMetadata.chunks[existingChunkIndex].size;
        streamMetadata.chunks[existingChunkIndex] = chunkData;
        streamMetadata.totalSize = streamMetadata.totalSize - oldSize + chunkData.size;
      } else {
        // Add new chunk
        streamMetadata.chunks.push(chunkData);
        streamMetadata.totalSize += chunkData.size;
      }
      
      // Sort chunks by index
      streamMetadata.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      
      // Update metadata
      streamMetadata.lastModified = new Date().toISOString();
      streamMetadata.chunkCount = streamMetadata.chunks.length;
      
      // Estimate duration (assuming ~1 second per chunk)
      streamMetadata.duration = streamMetadata.chunks.length;
      
      // Store updated metadata
      this.streamStore.set(streamId, streamMetadata);
      
      console.log(`📝 Updated stream ${streamId}: ${streamMetadata.chunks.length} chunks, ${streamMetadata.totalSize} bytes`);
      
      return streamMetadata;
    } catch (error) {
      console.error('❌ Error updating stream chunks:', error);
      throw new Error(`Failed to update stream: ${error.message}`);
    }
  }

  async retrieveData(hash) {
    try {
      console.log(`📥 Mock retrieving data: ${hash}`);
      
      const storedData = this.mockStorage.get(hash);
      
      if (!storedData) {
        console.log(`⚠️ Mock data not found for hash: ${hash}`);
        // Return placeholder data
        return Buffer.from(`Mock data for hash ${hash} (not found)`, 'utf8');
      }
      
      console.log(`✅ Mock retrieved ${storedData.size} bytes for hash: ${hash}`);
      return storedData.data;
      
    } catch (error) {
      console.error('❌ Mock retrieval error:', error);
      return Buffer.from(`Mock data retrieval error: ${error.message}`, 'utf8');
    }
  }

  async pin(hash) {
    console.log(`📌 Mock pinning: ${hash}`);
    // In a mock implementation, we just log it
    const storedData = this.mockStorage.get(hash);
    if (storedData) {
      storedData.pinned = true;
      storedData.pinnedAt = new Date().toISOString();
      console.log(`✅ Mock pinned: ${hash}`);
    } else {
      console.log(`⚠️ Cannot pin non-existent hash: ${hash}`);
    }
  }

  async unpin(hash) {
    console.log(`📌 Mock unpinning: ${hash}`);
    const storedData = this.mockStorage.get(hash);
    if (storedData) {
      storedData.pinned = false;
      storedData.unpinnedAt = new Date().toISOString();
      console.log(`✅ Mock unpinned: ${hash}`);
    } else {
      console.log(`⚠️ Cannot unpin non-existent hash: ${hash}`);
    }
  }

  async getNodeInfo() {
    return {
      nodeId: this.nodeId,
      version: 'mock-ipfs-v1.0.0',
      peerCount: Math.floor(Math.random() * 50) + 10, // Random peer count for realism
      addresses: [
        `/ip4/127.0.0.1/tcp/4001/p2p/${this.nodeId}`,
        `/ip6/::1/tcp/4001/p2p/${this.nodeId}`
      ],
      isMock: true,
      uptime: Date.now() - process.uptime() * 1000
    };
  }

  async healthCheck() {
    try {
      const nodeInfo = await this.getNodeInfo();
      
      // Mock health check with test data
      const testData = Buffer.from('zipIQ mock health check', 'utf8');
      const testHash = await this.storeDataLocally(testData, 'health-check.txt');
      const retrieved = await this.retrieveData(testHash);
      const isValid = retrieved.toString() === 'zipIQ mock health check';
      
      return {
        status: isValid ? 'healthy' : 'degraded',
        nodeId: nodeInfo.nodeId,
        version: nodeInfo.version,
        peerCount: nodeInfo.peerCount,
        lastCheck: new Date().toISOString(),
        isMock: true,
        storageStats: this.getStorageStats()
      };
    } catch (error) {
      console.error('❌ Mock health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        lastCheck: new Date().toISOString(),
        isMock: true
      };
    }
  }

  async cleanupOldChunks(olderThanDays = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      let cleanedCount = 0;
      
      // Clean up chunk store
      for (const [key, chunkData] of this.chunkStore.entries()) {
        const chunkDate = new Date(chunkData.uploadedAt);
        
        if (chunkDate < cutoffDate) {
          // Remove from mock storage
          this.mockStorage.delete(chunkData.ipfsHash);
          
          // Remove local file if it exists
          if (chunkData.localPath && fs.existsSync(chunkData.localPath)) {
            try {
              fs.unlinkSync(chunkData.localPath);
            } catch (err) {
              console.log(`⚠️ Could not delete local file: ${chunkData.localPath}`);
            }
          }
          
          // Remove from chunk store
          this.chunkStore.delete(key);
          cleanedCount++;
        }
      }
      
      // Clean up orphaned mock storage
      for (const [hash, data] of this.mockStorage.entries()) {
        const dataDate = new Date(data.storedAt);
        if (dataDate < cutoffDate) {
          this.mockStorage.delete(hash);
        }
      }
      
      console.log(`🧹 Mock cleanup completed: ${cleanedCount} chunks removed`);
      return cleanedCount;
    } catch (error) {
      console.error('❌ Error during mock cleanup:', error);
      throw new Error(`Mock cleanup failed: ${error.message}`);
    }
  }

  getStorageStats() {
    const totalChunks = this.chunkStore.size;
    const totalStreams = this.streamStore.size;
    const totalMockData = this.mockStorage.size;
    
    let totalSize = 0;
    let pinnedCount = 0;
    const chunksByStream = new Map();
    
    // Calculate chunk statistics
    for (const [key, chunkData] of this.chunkStore.entries()) {
      totalSize += chunkData.size;
      
      if (!chunksByStream.has(chunkData.streamId)) {
        chunksByStream.set(chunkData.streamId, 0);
      }
      chunksByStream.set(chunkData.streamId, chunksByStream.get(chunkData.streamId) + 1);
    }
    
    // Count pinned items
    for (const [hash, data] of this.mockStorage.entries()) {
      if (data.pinned) {
        pinnedCount++;
      }
    }
    
    return {
      connected: this.connected,
      isMock: true,
      totalChunks,
      totalStreams,
      totalMockData,
      totalSize,
      pinnedCount,
      averageChunkSize: totalChunks > 0 ? Math.round(totalSize / totalChunks) : 0,
      chunksPerStream: totalStreams > 0 ? Math.round(totalChunks / totalStreams) : 0,
      uploadsDirectory: this.uploadsDir,
      memoryUsage: process.memoryUsage(),
      nodeId: this.nodeId
    };
  }

  // Utility method to list all stored hashes
  listAllHashes() {
    return Array.from(this.mockStorage.keys());
  }

  // Utility method to get detailed info about a hash
  getHashInfo(hash) {
    const data = this.mockStorage.get(hash);
    if (!data) return null;
    
    return {
      hash,
      size: data.size,
      filename: data.filename,
      mimetype: data.mimetype,
      storedAt: data.storedAt,
      pinned: data.pinned || false,
      pinnedAt: data.pinnedAt,
      unpinnedAt: data.unpinnedAt
    };
  }
}

// Export as singleton
module.exports = new MockIPFSService();