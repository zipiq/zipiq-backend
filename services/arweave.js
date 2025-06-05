const Arweave = require('arweave');

class ArweaveService {
  constructor() {
    this.arweave = Arweave.init({
      host: process.env.ARWEAVE_HOST || 'arweave.net',
      port: process.env.ARWEAVE_PORT || 443,
      protocol: process.env.ARWEAVE_PROTOCOL || 'https'
    });
    
    this.uploadQueue = [];
    this.isProcessing = false;
    this.wallet = null;
    this.archivedItems = new Map(); // Track archived items
    
    console.log(`📦 Arweave Service initialized - ${process.env.ARWEAVE_PROTOCOL}://${process.env.ARWEAVE_HOST}:${process.env.ARWEAVE_PORT}`);
    
    // Initialize wallet and start processing queue
    this.initializeWallet();
    this.startQueueProcessor();
  }

  async initializeWallet() {
    try {
      // In production, load wallet from secure storage
      // For MVP, we'll generate a wallet (you'll need to fund it)
      if (!this.wallet) {
        console.log('🔑 Generating Arweave wallet...');
        this.wallet = await this.arweave.wallets.generate();
        
        const address = await this.arweave.wallets.jwkToAddress(this.wallet);
        console.log(`💳 Arweave wallet address: ${address}`);
        console.log('💰 Fund this wallet at: https://faucet.arweave.net/');
        
        // Check balance
        const balance = await this.arweave.wallets.getBalance(address);
        const ar = this.arweave.ar.winstonToAr(balance);
        console.log(`💰 Current balance: ${ar} AR`);
        
        if (parseFloat(ar) < 0.1) {
          console.log('⚠️  Low balance! Get free AR tokens from https://faucet.arweave.net/');
        }
      }
    } catch (error) {
      console.error('❌ Error initializing Arweave wallet:', error);
    }
  }

  async queueForArchival(data) {
    try {
      const queueItem = {
        id: `${data.streamId}_${data.chunkIndex}`,
        data: data.data,
        metadata: {
          streamId: data.streamId,
          chunkIndex: data.chunkIndex,
          timestamp: data.timestamp,
          userId: data.userId,
          ipfsHash: data.ipfsHash,
          size: data.data.length
        },
        attempts: 0,
        queuedAt: new Date().toISOString()
      };
      
      this.uploadQueue.push(queueItem);
      console.log(`📋 Queued for Arweave archival: ${queueItem.id} (Queue size: ${this.uploadQueue.length})`);
      
      // Start processing if not already running
      if (!this.isProcessing) {
        this.processQueue();
      }
      
      return true;
    } catch (error) {
      console.error('❌ Error queuing for archival:', error);
      throw new Error(`Failed to queue for archival: ${error.message}`);
    }
  }

  async processQueue() {
    if (this.isProcessing || this.uploadQueue.length === 0) {
      return;
    }
    
    this.isProcessing = true;
    console.log(`🔄 Processing Arweave upload queue (${this.uploadQueue.length} items)...`);
    
    while (this.uploadQueue.length > 0) {
      const item = this.uploadQueue.shift();
      
      try {
        await this.uploadToArweave(item);
        console.log(`✅ Successfully archived: ${item.id}`);
        
        // Mark as archived
        this.archivedItems.set(item.id, {
          transactionId: item.transactionId,
          archivedAt: new Date().toISOString(),
          metadata: item.metadata
        });
        
      } catch (error) {
        console.error(`❌ Failed to archive ${item.id}:`, error);
        
        item.attempts++;
        if (item.attempts < 3) {
          // Retry with exponential backoff
          const delay = Math.pow(2, item.attempts) * 5000; // 5s, 10s, 20s
          setTimeout(() => {
            this.uploadQueue.push(item);
            console.log(`🔄 Retrying ${item.id} in ${delay/1000}s (attempt ${item.attempts + 1}/3)`);
          }, delay);
        } else {
          console.error(`❌ Max retries exceeded for ${item.id}`);
        }
      }
      
      // Rate limiting - wait between uploads
      await this.sleep(2000); // 2 second delay between uploads
    }
    
    this.isProcessing = false;
    console.log('✅ Arweave upload queue processing completed');
  }

  async uploadToArweave(item) {
    try {
      if (!this.wallet) {
        throw new Error('Arweave wallet not initialized');
      }
      
      console.log(`📤 Uploading to Arweave: ${item.id} (${item.data.length} bytes)`);
      
      // Create transaction
      const transaction = await this.arweave.createTransaction({
        data: item.data
      }, this.wallet);
      
      // Add tags for metadata
      transaction.addTag('App-Name', 'zipIQ');
      transaction.addTag('App-Version', '1.0.0');
      transaction.addTag('Content-Type', 'video/chunk');
      transaction.addTag('Stream-ID', item.metadata.streamId);
      transaction.addTag('Chunk-Index', item.metadata.chunkIndex.toString());
      transaction.addTag('Timestamp', item.metadata.timestamp.toString());
      transaction.addTag('User-ID', item.metadata.userId);
      transaction.addTag('IPFS-Hash', item.metadata.ipfsHash);
      transaction.addTag('Original-Size', item.metadata.size.toString());
      transaction.addTag('Upload-Date', new Date().toISOString());
      
      // Sign transaction
      await this.arweave.transactions.sign(transaction, this.wallet);
      
      // Submit transaction
      const response = await this.arweave.transactions.post(transaction);
      
      if (response.status === 200) {
        item.transactionId = transaction.id;
        console.log(`✅ Arweave transaction submitted: ${transaction.id}`);
        
        // Verify transaction was accepted
        const status = await this.arweave.transactions.getStatus(transaction.id);
        console.log(`📊 Transaction status: ${status.status}`);
        
        return transaction.id;
      } else {
        throw new Error(`Arweave upload failed with status: ${response.status}`);
      }
      
    } catch (error) {
      console.error('❌ Arweave upload error:', error);
      throw error;
    }
  }

  async getStreamStatus(streamId) {
    try {
      let archivedCount = 0;
      const transactions = [];
      
      for (const [itemId, archivedItem] of this.archivedItems.entries()) {
        if (archivedItem.metadata.streamId === streamId) {
          archivedCount++;
          transactions.push({
            id: archivedItem.transactionId,
            chunkIndex: archivedItem.metadata.chunkIndex,
            archivedAt: archivedItem.archivedAt,
            size: archivedItem.metadata.size
          });
        }
      }
      
      return {
        streamId,
        archivedCount,
        transactions: transactions.sort((a, b) => a.chunkIndex - b.chunkIndex)
      };
    } catch (error) {
      console.error('❌ Error getting stream status:', error);
      throw new Error(`Failed to get stream status: ${error.message}`);
    }
  }

  async getTransactionData(transactionId) {
    try {
      console.log(`📥 Retrieving data from Arweave: ${transactionId}`);
      
      const data = await this.arweave.transactions.getData(transactionId, {
        decode: true,
        string: false
      });
      
      console.log(`✅ Retrieved ${data.length} bytes from Arweave`);
      return data;
    } catch (error) {
      console.error('❌ Error retrieving from Arweave:', error);
      throw new Error(`Failed to retrieve from Arweave: ${error.message}`);
    }
  }

  async getTransactionStatus(transactionId) {
    try {
      const status = await this.arweave.transactions.getStatus(transactionId);
      return {
        transactionId,
        status: status.status,
        confirmed: status.confirmed
      };
    } catch (error) {
      console.error('❌ Error getting transaction status:', error);
      throw new Error(`Failed to get transaction status: ${error.message}`);
    }
  }

  async healthCheck() {
    try {
      // Check network info
      const networkInfo = await this.arweave.network.getInfo();
      
      // Check wallet balance if available
      let balance = null;
      let address = null;
      
      if (this.wallet) {
        address = await this.arweave.wallets.jwkToAddress(this.wallet);
        const balanceWinston = await this.arweave.wallets.getBalance(address);
        balance = this.arweave.ar.winstonToAr(balanceWinston);
      }
      
      return {
        status: 'healthy',
        network: {
          height: networkInfo.height,
          blocks: networkInfo.blocks,
          peers: networkInfo.peers
        },
        wallet: {
          address,
          balance: balance ? `${balance} AR` : 'Not available'
        },
        queue: {
          pending: this.uploadQueue.length,
          archived: this.archivedItems.size
        },
        lastCheck: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Arweave health check failed:', error);
      return {
        status: 'unhealthy',
        error: error.message,
        lastCheck: new Date().toISOString()
      };
    }
  }

  startQueueProcessor() {
    // Process queue every 30 seconds
    setInterval(() => {
      if (!this.isProcessing && this.uploadQueue.length > 0) {
        this.processQueue();
      }
    }, 30000);
    
    console.log('🔄 Arweave queue processor started (30s interval)');
  }

  // Utility function for delays
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Get cost estimate for data
  async getCostEstimate(dataSize) {
    try {
      const price = await this.arweave.transactions.getPrice(dataSize);
      const ar = this.arweave.ar.winstonToAr(price);
      
      return {
        winston: price,
        ar: ar,
        usd: parseFloat(ar) * 50 // Approximate AR price in USD
      };
    } catch (error) {
      console.error('❌ Error getting cost estimate:', error);
      throw new Error(`Failed to get cost estimate: ${error.message}`);
    }
  }

  // Get queue statistics
  getQueueStats() {
    const totalPending = this.uploadQueue.length;
    const totalArchived = this.archivedItems.size;
    
    let totalPendingSize = 0;
    for (const item of this.uploadQueue) {
      totalPendingSize += item.data.length;
    }
    
    let totalArchivedSize = 0;
    for (const [id, item] of this.archivedItems.entries()) {
      totalArchivedSize += item.metadata.size;
    }
    
    return {
      pending: {
        count: totalPending,
        size: totalPendingSize
      },
      archived: {
        count: totalArchived,
        size: totalArchivedSize
      },
      isProcessing: this.isProcessing
    };
  }
}

module.exports = new ArweaveService();