const { create } = require('ipfs-http-client');

class IPFSService {
  constructor() {
    this.client = create({
      host: process.env.IPFS_HOST || 'localhost',
      port: process.env.IPFS_PORT || 5001,
      protocol: process.env.IPFS_PROTOCOL || 'http'
    });
    
    this.chunkStore = new Map(); // In-memory store for chunk metadata
    this.streamStore = new Map(); // In-memory store for stream metadata
    
    console.log(`🌐 IPFS Service initialized - ${process.env.IPFS_PROTOCOL}://${process.env.IPFS_HOST}:${process.env.IPFS_PORT}`);
  }

  async uploadChunk(buffer, metadata) {
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
    try {
      const jsonString = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(jsonString, 'utf8');
      
      const result = await this.client.add(buffer);
      const hash = result.cid.toString();
      
      console.log(`📝 JSON uploaded to IPFS: ${hash}`);
      return hash;
      
    } catch (error) {
      console.error('❌ IPFS JSON upload error:',