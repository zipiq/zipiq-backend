// Updated ipfs.js - Conditional import to avoid Railway deployment errors
class IPFSService {
  constructor() {
    this.client = null;
    this.chunkStore = new Map();
    this.streamStore = new Map();
    this.connected = false;
    
    // Initialize IPFS client conditionally
    this.initializeIPFS();
  }

  async initializeIPFS() {
    try {
      // Check if IPFS should be enabled
      const ipfsEnabled = process.env.IPFS_ENABLED === 'true';
      const isProduction = process.env.NODE_ENV === 'production';
      const hasIPFSConfig = process.env.IPFS_HOST && process.env.IPFS_HOST !== 'disabled';
      
      if (!ipfsEnabled || !hasIPFSConfig) {
        console.log('⚠️ IPFS disabled - using mock storage for deployment');
        return;
      }

      // Dynamic import to avoid Railway errors
      const { create } = await import('ipfs-http-client');
      
      this.client = create({
        host: process.env.IPFS_HOST || 'localhost',
        port: parseInt(process.env.IPFS_PORT) || 5001,
        protocol: process.env.IPFS_PROTOCOL || 'http',
        timeout: 30000, // 30 second timeout
        headers: process.env.IPFS_API_KEY ? {
          'Authorization': `Bearer ${process.env.IPFS_API_KEY}`
        } : undefined
      });
      
      // Test connection
      await this.client.id();
      this.connected = true;
      
      console.log(`🌐 IPFS Service connected - ${process.env.IPFS_PROTOCOL}://${process.env.IPFS_HOST}:${process.env.IPFS_PORT}`);
    } catch (error) {
      console.log(`⚠️ IPFS connection failed: ${error.message}`);
      console.log('📦 Using mock storage for video chunks');
      this.connected = false;
    }
  }

  async uploadChunk(buffer, metadata) {
    // Always use mock storage if IPFS not connected
    if (!this.connected) {
      return this.mockUploadChunk(buffer, metadata);
    }
    
    try {
      console.log(`📤 Uploading chunk ${metadata.chunkIndex} to IPFS...`);
      
      const result = await this.client.add(buffer, {
        progress: (bytes) => {
          // Optional: report progress
        }
      });

      const ipfsHash = result.cid.toString();
      
      const chunkData = {
        ipfsHash,
        streamId: metadata.streamId,
        chunkIndex: metadata.chunkIndex,
        timestamp: metadata.timestamp,
        userId: metadata.userId,
        size: buffer.length,
        mimetype: metadata.mimetype,
        uploadedAt: new Date().toISOString()
      };
      
      this.chunkStore.set(`${metadata.streamId}_${metadata.chunkIndex}`, chunkData);
      await this.updateStreamChunks(metadata.streamId, chunkData);
      
      console.log(`✅ Chunk uploaded to IPFS: ${ipfsHash}`);
      
      return {
        hash: ipfsHash,
        size: buffer.length,
        uploadedAt: chunkData.uploadedAt
      };
      
    } catch (error) {
      console.error('❌ IPFS upload error, falling back to mock storage:', error);
      return this.mockUploadChunk(buffer, metadata);
    }
  }

  mockUploadChunk(buffer, metadata) {
    console.log(`📤 Mock uploading chunk ${metadata.chunkIndex}...`);
    
    const mockHash = `QmMock${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
    
    const chunkData = {
      ipfsHash: mockHash,
      streamId: metadata.streamId,
      chunkIndex: metadata.chunkIndex,
      timestamp: metadata.timestamp,
      userId: metadata.userId,
      size: buffer.length,
      mimetype: metadata.mimetype,
      uploadedAt: new Date().toISOString(),
      isMock: true // Flag to identify mock data
    };
    
    this.chunkStore.set(`${metadata.streamId}_${metadata.chunkIndex}`, chunkData);
    this.updateStreamChunks(metadata.streamId, chunkData);
    
    console.log(`✅ Mock chunk stored: ${mockHash}`);
    
    return {
      hash: mockHash,
      size: buffer.length,
      uploadedAt: chunkData.uploadedAt,
      isMock: true
    };
  }

  async uploadJSON(data) {
    if (!this.connected) {
      const mockHash = `QmJsonMock${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
      console.log(`📝 Mock JSON uploaded: ${mockHash}`);
      return mockHash;
    }
    
    try {
      const jsonString = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(jsonString, 'utf8');
      
      const result = await this.client.add(buffer);
      const hash = result.cid.toString();
      
      console.log(`📝 JSON uploaded to IPFS: ${hash}`);
      return hash;
      
    } catch (error) {
      console.error('❌ IPFS JSON upload error:', error);
      const mockHash = `QmJsonMock${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
      return mockHash;
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
      
      chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      return chunks;
    } catch (error) {
      console.error('❌ Error retrieving stream chunks:', error);
      throw new Error(`Failed to retrieve chunks: ${error.message}`);
    }
  }

  async getStreamMetadata(streamId) {
    try {
      return this.streamStore.get(streamId) || null;
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
      
      userStreams.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
        streamMetadata = {
          id: streamId,
          userId: chunkData.userId,
          title: `Stream ${streamId.slice(0, 8)}`,
          description: '',
          createdAt: new Date().toISOString(),
          status: 'active',
          chunks: [],
          isMock: !this.connected
        };
      }
      
      const existingChunkIndex = streamMetadata.chunks.findIndex(
        c => c.chunkIndex === chunkData.chunkIndex
      );
      
      if (existingChunkIndex >= 0) {
        streamMetadata.chunks[existingChunkIndex] = chunkData;
      } else {
        streamMetadata.chunks.push(chunkData);
      }
      
      streamMetadata.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      streamMetadata.lastModified = new Date().toISOString();
      
      this.streamStore.set(streamId, streamMetadata);
      return streamMetadata;
    } catch (error) {
      console.error('❌ Error updating stream chunks:', error);
      throw new Error(`Failed to update stream: ${error.message}`);
    }
  }

  async retrieveData(hash) {
    if (!this.connected || hash.startsWith('QmMock')) {
      console.log(`📥 Mock retrieving data: ${hash}`);
      return Buffer.from('Mock data for testing', 'utf8');
    }
    
    try {
      console.log(`📥 Retrieving data from IPFS: ${hash}`);
      
      const chunks = [];
      for await (const chunk of this.client.cat(hash)) {
        chunks.push(chunk);
      }
      
      const buffer = Buffer.concat(chunks);
      console.log(`✅ Retrieved ${buffer.length} bytes from IPFS`);
      
      return buffer;
    } catch (error) {
      console.error('❌ IPFS retrieval error:', error);
      return Buffer.from('Mock data (retrieval failed)', 'utf8');
    }
  }

  async pin(hash) {
    if (!this.connected || hash.startsWith('QmMock')) {
      console.log(`📌 Mock pinning: ${hash}`);
      return;
    }
    
    try {
      console.log(`📌 Pinning to IPFS: ${hash}`);
      await this.client.pin.add(hash);
      console.log(`✅ Successfully pinned: ${hash}`);
    } catch (error) {
      console.error('❌ IPFS pinning error:', error);
    }
  }

  async unpin(hash) {
    if (!this.connected || hash.startsWith('QmMock')) {
      console.log(`📌 Mock unpinning: ${hash}`);
      return;
    }
    
    try {
      console.log(`📌 Unpinning from IPFS: ${hash}`);
      await this.client.pin.rm(hash);
      console.log(`✅ Successfully unpinned: ${hash}`);
    } catch (error) {
      console.error('❌ IPFS unpinning error (non-critical):', error);
    }
  }

  async getNodeInfo() {
    if (!this.connected) {
      return {
        nodeId: 'mock-node-id',
        version: 'mock-version',
        peerCount: 0,
        addresses: [],
        isMock: true
      };
    }
    
    try {
      const id = await this.client.id();
      const version = await this.client.version();
      const peers = await this.client.swarm.peers();
      
      return {
        nodeId: id.id,
        version: version.version,
        peerCount: peers.length,
        addresses: id.addresses,
        isMock: false
      };
    } catch (error) {
      console.error('❌ Error getting IPFS node info:', error);
      return {
        nodeId: 'error-node-id',
        version: 'error',
        peerCount: 0,
        addresses: [],
        error: error.message,
        isMock: true
      };
    }
  }

  async healthCheck() {
    try {
      if (!this.connected) {
        return {
          status: 'mock',
          message: 'IPFS disabled - using mock storage for deployment',
          nodeId: 'mock-node',
          version: 'disabled',
          peerCount: 0,
          lastCheck: new Date().toISOString(),
          isMock: true
        };
      }
      
      const nodeInfo = await this.getNodeInfo();
      const testData = Buffer.from('zipIQ health check', 'utf8');
      const result = await this.client.add(testData);
      const hash = result.cid.toString();
      
      const retrieved = await this.retrieveData(hash);
      const isValid = retrieved.toString() === 'zipIQ health check';
      
      await this.unpin(hash);
      
      return {
        status: isValid ? 'healthy' : 'degraded',
        nodeId: nodeInfo.nodeId,
        version: nodeInfo.version,
        peerCount: nodeInfo.peerCount,
        lastCheck: new Date().toISOString(),
        isMock: false
      };
    } catch (error) {
      console.error('❌ IPFS health check failed:', error);
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
      
      for (const [key, chunkData] of this.chunkStore.entries()) {
        const chunkDate = new Date(chunkData.uploadedAt);
        
        if (chunkDate < cutoffDate) {
          if (this.connected && !chunkData.ipfsHash.startsWith('QmMock')) {
            await this.unpin(chunkData.ipfsHash);
          }
          
          this.chunkStore.delete(key);
          cleanedCount++;
        }
      }
      
      console.log(`🧹 Cleaned up ${cleanedCount} old chunks`);
      return cleanedCount;
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
      throw new Error(`Cleanup failed: ${error.message}`);
    }
  }

  getStorageStats() {
    const totalChunks = this.chunkStore.size;
    const totalStreams = this.streamStore.size;
    
    let totalSize = 0;
    let mockChunks = 0;
    const chunksByStream = new Map();
    
    for (const [key, chunkData] of this.chunkStore.entries()) {
      totalSize += chunkData.size;
      
      if (chunkData.isMock || chunkData.ipfsHash.startsWith('QmMock')) {
        mockChunks++;
      }
      
      if (!chunksByStream.has(chunkData.streamId)) {
        chunksByStream.set(chunkData.streamId, 0);
      }
      chunksByStream.set(chunkData.streamId, chunksByStream.get(chunkData.streamId) + 1);
    }
    
    return {
      connected: this.connected,
      totalChunks,
      totalStreams,
      totalSize,
      mockChunks,
      realChunks: totalChunks - mockChunks,
      averageChunkSize: totalChunks > 0 ? Math.round(totalSize / totalChunks) : 0,
      chunksPerStream: totalStreams > 0 ? Math.round(totalChunks / totalStreams) : 0,
      memoryUsage: process.memoryUsage()
    };
  }
}

module.exports = new IPFSService();