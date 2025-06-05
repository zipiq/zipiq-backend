const { create } = require('ipfs-http-client');

class IPFSService {
  constructor() {
    try {
      // Only try to connect if IPFS is enabled
      if (process.env.IPFS_HOST === 'disabled' || process.env.NODE_ENV === 'production') {
        throw new Error('IPFS disabled for testing');
      }
      
      this.client = create({
        host: process.env.IPFS_HOST || 'localhost',
        port: process.env.IPFS_PORT || 5001,
        protocol: process.env.IPFS_PROTOCOL || 'http'
      });
      
      this.chunkStore = new Map();
      this.streamStore = new Map();
      this.connected = true;
      
      console.log(`🌐 IPFS Service initialized - ${process.env.IPFS_PROTOCOL}://${process.env.IPFS_HOST}:${process.env.IPFS_PORT}`);
    } catch (error) {
      console.log('⚠️ IPFS not available, using mock storage for testing');
      this.connected = false;
      this.chunkStore = new Map();
      this.streamStore = new Map();
    }
  }

  async uploadChunk(buffer, metadata) {
    // Handle case when IPFS is not connected
    if (!this.connected) {
      console.log(`📤 Mock uploading chunk ${metadata.chunkIndex}...`);
      
      // Create mock IPFS hash
      const mockHash = `QmMock${Date.now()}${Math.random().toString(36).substr(2, 9)}`;
      
      const chunkData = {
        ipfsHash: mockHash,
        streamId: metadata.streamId,
        chunkIndex: metadata.chunkIndex,
        timestamp: metadata.timestamp,
        userId: metadata.userId,
        size: buffer.length,
        mimetype: metadata.mimetype,
        uploadedAt: new Date().toISOString()
      };
      
      this.chunkStore.set(`${metadata.streamId}_${metadata.chunkIndex}`, chunkData);
      
      // Update stream metadata
      await this.updateStreamChunks(metadata.streamId, chunkData);
      
      console.log(`✅ Mock chunk stored: ${mockHash}`);
      
      return {
        hash: mockHash,
        size: buffer.length,
        uploadedAt: chunkData.uploadedAt
      };
    }
    
    // Original IPFS upload code (when connected)
    try {
      console.log(`📤 Uploading chunk ${metadata.chunkIndex} to IPFS...`);
      
      // Add file to IPFS
      const result = await this.client.add(buffer, {
        progress: (bytes) => {
          // Optional: report progress
          // console.log(`Upload progress: ${bytes} bytes`);
        }
      });

      const ipfsHash = result.cid.toString();
      
      // Store chunk metadata
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
      
      // Update stream metadata
      await this.updateStreamChunks(metadata.streamId, chunkData);
      
      console.log(`✅ Chunk uploaded to IPFS: ${ipfsHash}`);
      
      return {
        hash: ipfsHash,
        size: buffer.length,
        uploadedAt: chunkData.uploadedAt
      };
      
    } catch (error) {
      console.error('❌ IPFS upload error:', error);
      throw new Error(`IPFS upload failed: ${error.message}`);
    }
  }

  async uploadJSON(data) {
    if (!this.connected) {
      // Mock JSON upload
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
      throw new Error(`IPFS JSON upload failed: ${error.message}`);
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
      
      // Sort by creation date (newest first)
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
        // Create new stream metadata if it doesn't exist
        streamMetadata = {
          id: streamId,
          userId: chunkData.userId,
          title: `Stream ${streamId.slice(0, 8)}`,
          description: '',
          createdAt: new Date().toISOString(),
          status: 'active',
          chunks: []
        };
      }
      
      // Add chunk to stream metadata
      const existingChunkIndex = streamMetadata.chunks.findIndex(
        c => c.chunkIndex === chunkData.chunkIndex
      );
      
      if (existingChunkIndex >= 0) {
        // Update existing chunk
        streamMetadata.chunks[existingChunkIndex] = chunkData;
      } else {
        // Add new chunk
        streamMetadata.chunks.push(chunkData);
      }
      
      // Sort chunks by index
      streamMetadata.chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      
      // Update last modified
      streamMetadata.lastModified = new Date().toISOString();
      
      // Store updated metadata
      this.streamStore.set(streamId, streamMetadata);
      
      return streamMetadata;
    } catch (error) {
      console.error('❌ Error updating stream chunks:', error);
      throw new Error(`Failed to update stream: ${error.message}`);
    }
  }

  async retrieveData(hash) {
    if (!this.connected) {
      // Mock retrieval - return empty buffer for testing
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
      throw new Error(`IPFS retrieval failed: ${error.message}`);
    }
  }

  async pin(hash) {
    if (!this.connected) {
      console.log(`📌 Mock pinning: ${hash}`);
      return;
    }
    
    try {
      console.log(`📌 Pinning to IPFS: ${hash}`);
      await this.client.pin.add(hash);
      console.log(`✅ Successfully pinned: ${hash}`);
    } catch (error) {
      console.error('❌ IPFS pinning error:', error);
      throw new Error(`IPFS pinning failed: ${error.message}`);
    }
  }

  async unpin(hash) {
    if (!this.connected) {
      console.log(`📌 Mock unpinning: ${hash}`);
      return;
    }
    
    try {
      console.log(`📌 Unpinning from IPFS: ${hash}`);
      await this.client.pin.rm(hash);
      console.log(`✅ Successfully unpinned: ${hash}`);
    } catch (error) {
      console.error('❌ IPFS unpinning error:', error);
      // Don't throw error for unpinning failures
      console.log(`⚠️ Unpinning failed (non-critical): ${hash}`);
    }
  }

  async getNodeInfo() {
    if (!this.connected) {
      return {
        nodeId: 'mock-node-id',
        version: 'mock-version',
        peerCount: 0,
        addresses: []
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
        addresses: id.addresses
      };
    } catch (error) {
      console.error('❌ Error getting IPFS node info:', error);
      throw new Error(`Failed to get node info: ${error.message}`);
    }
  }

  async healthCheck() {
    try {
      if (!this.connected) {
        return {
          status: 'mock',
          message: 'IPFS disabled - using mock storage for testing',
          nodeId: 'mock-node',
          version: 'disabled',
          peerCount: 0,
          lastCheck: new Date().toISOString()
        };
      }
      
      // Test basic connectivity
      const nodeInfo = await this.getNodeInfo();
      
      // Test upload/retrieval
      const testData = Buffer.from('zipIQ health check', 'utf8');
      const result = await this.client.add(testData);
      const hash = result.cid.toString();
      
      // Verify we can retrieve it
      const retrieved = await this.retrieveData(hash);
      const isValid = retrieved.toString() === 'zipIQ health check';
      
      // Clean up test data
      await this.unpin(hash);
      
      return {
        status: isValid ? 'healthy' : 'degraded',
        nodeId: nodeInfo.nodeId,
        version: nodeInfo.version,
        peerCount: nodeInfo.peerCount,
        lastCheck: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ IPFS health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        lastCheck: new Date().toISOString()
      };
    }
  }

  // Cleanup old chunks (for storage management)
  async cleanupOldChunks(olderThanDays = 30) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
      
      let cleanedCount = 0;
      
      for (const [key, chunkData] of this.chunkStore.entries()) {
        const chunkDate = new Date(chunkData.uploadedAt);
        
        if (chunkDate < cutoffDate) {
          // Unpin from IPFS (but don't delete - it may still be available)
          if (this.connected) {
            await this.unpin(chunkData.ipfsHash);
          }
          
          // Remove from memory store
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

  // Get storage statistics
  getStorageStats() {
    const totalChunks = this.chunkStore.size;
    const totalStreams = this.streamStore.size;
    
    let totalSize = 0;
    const chunksByStream = new Map();
    
    for (const [key, chunkData] of this.chunkStore.entries()) {
      totalSize += chunkData.size;
      
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
      averageChunkSize: totalChunks > 0 ? Math.round(totalSize / totalChunks) : 0,
      chunksPerStream: totalStreams > 0 ? Math.round(totalChunks / totalStreams) : 0,
      memoryUsage: process.memoryUsage()
    };
  }
}

module.exports = new IPFSService();