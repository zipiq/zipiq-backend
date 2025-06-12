const { Pool } = require('pg');
const path = require('path');

// Database connection configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 20, // Maximum pool size
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Database initialization
const initializeDatabase = async () => {
  try {
    const client = await pool.connect();
    console.log('📁 Connected to PostgreSQL database');

    // Create users table with Web3 features
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255) UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name VARCHAR(255),
        last_name VARCHAR(255),
        wallet_address VARCHAR(255),
        is_verified BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        profile_image_url TEXT,
        bio TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login TIMESTAMP,
        verification_token TEXT,
        reset_password_token TEXT,
        reset_password_expires TIMESTAMP
      )
    `);
    console.log('✅ Users table ready');

    // Add password reset columns to existing users table
    await client.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS reset_password_token TEXT,
      ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMP
    `);
    console.log('✅ Password reset columns added to users table');

    // Add index for faster token lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_reset_token ON users(reset_password_token);
    `);
    console.log('✅ Password reset token index created');

    // Create streams table for tracking user streams
    await client.query(`
      CREATE TABLE IF NOT EXISTS streams (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        is_private BOOLEAN DEFAULT FALSE,
        status TEXT DEFAULT 'created',
        metadata_hash TEXT,
        chunk_count INTEGER DEFAULT 0,
        total_size BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      )
    `);
    console.log('✅ Streams table ready');

    // Create chunks table for tracking stream chunks
    await client.query(`
      CREATE TABLE IF NOT EXISTS chunks (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        ipfs_hash TEXT NOT NULL,
        arweave_tx_id TEXT,
        size BIGINT NOT NULL,
        timestamp BIGINT NOT NULL,
        uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        archived_at TIMESTAMP,
        status TEXT DEFAULT 'uploaded',
        FOREIGN KEY (stream_id) REFERENCES streams (id) ON DELETE CASCADE,
        UNIQUE(stream_id, chunk_index)
      )
    `);
    console.log('✅ Chunks table ready');

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
      CREATE INDEX IF NOT EXISTS idx_streams_user_id ON streams(user_id);
      CREATE INDEX IF NOT EXISTS idx_chunks_stream_id ON chunks(stream_id);
    `);
    console.log('✅ Database indexes ready');

    client.release();
  } catch (err) {
    console.error('❌ Error initializing database:', err.message);
    throw err;
  }
};

// Initialize database on startup
initializeDatabase().catch(console.error);

// Helper function to convert PostgreSQL callback style to SQLite-compatible style
const executeQuery = async (query, params = []) => {
  try {
    const result = await pool.query(query, params);
    return result;
  } catch (error) {
    throw error;
  }
};

// User model methods (keeping same interface as SQLite version)
const UserModel = {
  // Create a new user
  create: async (userData, callback) => {
    try {
      const { email, username, passwordHash, firstName, lastName } = userData;
      const query = `
        INSERT INTO users (email, username, password_hash, first_name, last_name)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, email, username, first_name, last_name, created_at
      `;
      const result = await executeQuery(query, [email, username, passwordHash, firstName || null, lastName || null]);
      const user = result.rows[0];
      callback(null, { id: user.id, ...userData });
    } catch (err) {
      callback(err, null);
    }
  },

  // Find user by email
  findByEmail: async (email, callback) => {
    try {
      const query = 'SELECT * FROM users WHERE email = $1 AND is_active = TRUE';
      const result = await executeQuery(query, [email]);
      callback(null, result.rows[0] || null);
    } catch (err) {
      callback(err, null);
    }
  },

  // Find user by username
  findByUsername: async (username, callback) => {
    try {
      const query = 'SELECT * FROM users WHERE username = $1 AND is_active = TRUE';
      const result = await executeQuery(query, [username]);
      callback(null, result.rows[0] || null);
    } catch (err) {
      callback(err, null);
    }
  },

  // Find user by ID
  findById: async (id, callback) => {
    try {
      const query = 'SELECT * FROM users WHERE id = $1 AND is_active = TRUE';
      const result = await executeQuery(query, [id]);
      callback(null, result.rows[0] || null);
    } catch (err) {
      callback(err, null);
    }
  },

  // Check if email or username exists
  checkExists: async (email, username, callback) => {
    try {
      const query = 'SELECT id FROM users WHERE (email = $1 OR username = $2) AND is_active = TRUE';
      const result = await executeQuery(query, [email, username]);
      callback(null, result.rows[0] || null);
    } catch (err) {
      callback(err, null);
    }
  },

  // Update user last login
  updateLastLogin: async (userId, callback) => {
    try {
      const query = 'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1';
      await executeQuery(query, [userId]);
      callback(null);
    } catch (err) {
      callback(err);
    }
  },

  // Get user profile (excluding sensitive data)
  getProfile: async (userId, callback) => {
    try {
      const query = `
        SELECT id, email, username, first_name, last_name, wallet_address, 
               is_verified, profile_image_url, bio, created_at, last_login
        FROM users 
        WHERE id = $1 AND is_active = TRUE
      `;
      const result = await executeQuery(query, [userId]);
      callback(null, result.rows[0] || null);
    } catch (err) {
      callback(err, null);
    }
  },

  // Update user profile
  updateProfile: async (userId, updateData, callback) => {
    try {
      const fields = [];
      const values = [];
      let paramCounter = 1;
      
      Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined) {
          fields.push(`${key} = $${paramCounter}`);
          values.push(updateData[key]);
          paramCounter++;
        }
      });
      
      if (fields.length === 0) {
        return callback(new Error('No fields to update'), null);
      }
      
      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(userId);
      
      const query = `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramCounter}`;
      await executeQuery(query, values);
      callback(null);
    } catch (err) {
      callback(err);
    }
  },

  // Get user statistics
  getUserStats: async (userId, callback) => {
    try {
      const query = `
        SELECT 
          u.id,
          u.username,
          u.created_at,
          COUNT(s.id) as total_streams,
          COALESCE(SUM(s.chunk_count), 0) as total_chunks,
          COALESCE(SUM(s.total_size), 0) as total_size
        FROM users u
        LEFT JOIN streams s ON u.id = s.user_id
        WHERE u.id = $1 AND u.is_active = TRUE
        GROUP BY u.id, u.username, u.created_at
      `;
      const result = await executeQuery(query, [userId]);
      callback(null, result.rows[0] || null);
    } catch (err) {
      callback(err, null);
    }
  },

  // ==============================================
  // PASSWORD RESET METHODS
  // ==============================================

  // Set password reset token for a user
  setPasswordResetToken: async (email, token, expiresAt, callback) => {
    try {
      const query = `
        UPDATE users 
        SET reset_password_token = $1, 
            reset_password_expires = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE email = $3 AND is_active = TRUE
        RETURNING id, email, username, first_name, last_name
      `;
      const result = await executeQuery(query, [token, expiresAt, email]);
      
      if (result.rows.length === 0) {
        return callback(new Error('User not found'), null);
      }
      
      callback(null, result.rows[0]);
    } catch (err) {
      console.error('Error setting password reset token:', err);
      callback(err, null);
    }
  },

  // Find user by valid reset token (not expired)
  findByResetToken: async (token, callback) => {
    try {
      const query = `
        SELECT id, email, username, first_name, last_name, 
               reset_password_token, reset_password_expires
        FROM users 
        WHERE reset_password_token = $1 
        AND reset_password_expires > CURRENT_TIMESTAMP 
        AND is_active = TRUE
      `;
      const result = await executeQuery(query, [token]);
      callback(null, result.rows[0] || null);
    } catch (err) {
      console.error('Error finding user by reset token:', err);
      callback(err, null);
    }
  },

  // Update password using reset token and clear the token
  updatePasswordWithToken: async (token, newPasswordHash, callback) => {
    try {
      const query = `
        UPDATE users 
        SET password_hash = $1, 
            reset_password_token = NULL, 
            reset_password_expires = NULL,
            updated_at = CURRENT_TIMESTAMP
        WHERE reset_password_token = $2 
        AND reset_password_expires > CURRENT_TIMESTAMP 
        AND is_active = TRUE
        RETURNING id, email, username, first_name, last_name
      `;
      const result = await executeQuery(query, [newPasswordHash, token]);
      
      if (result.rows.length === 0) {
        return callback(new Error('Invalid or expired reset token'), null);
      }
      
      callback(null, result.rows[0]);
    } catch (err) {
      console.error('Error updating password with token:', err);
      callback(err, null);
    }
  },

  // Clean up expired reset tokens (optional - for maintenance)
  cleanupExpiredResetTokens: async (callback) => {
    try {
      const query = `
        UPDATE users 
        SET reset_password_token = NULL, 
            reset_password_expires = NULL
        WHERE reset_password_expires < CURRENT_TIMESTAMP 
        AND reset_password_token IS NOT NULL
      `;
      const result = await executeQuery(query);
      console.log(`Cleaned up ${result.rowCount} expired reset tokens`);
      callback(null, result.rowCount);
    } catch (err) {
      console.error('Error cleaning up expired tokens:', err);
      callback(err, null);
    }
  }

};

// Stream model methods
const StreamModel = {
  // Create a new stream
  create: async (streamData, callback) => {
    try {
      const { id, userId, title, description, isPrivate, metadataHash } = streamData;
      const query = `
        INSERT INTO streams (id, user_id, title, description, is_private, metadata_hash)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      const result = await executeQuery(query, [id, userId, title, description, isPrivate ? true : false, metadataHash]);
      callback(null, { id, ...streamData });
    } catch (err) {
      callback(err, null);
    }
  },

  // Find stream by ID
  findById: async (streamId, callback) => {
    try {
      const query = 'SELECT * FROM streams WHERE id = $1';
      const result = await executeQuery(query, [streamId]);
      callback(null, result.rows[0] || null);
    } catch (err) {
      callback(err, null);
    }
  },

  // Get user's streams
  findByUserId: async (userId, callback) => {
    try {
      const query = `
        SELECT s.*, COUNT(c.id) as chunk_count, COALESCE(SUM(c.size), 0) as total_size
        FROM streams s
        LEFT JOIN chunks c ON s.id = c.stream_id
        WHERE s.user_id = $1
        GROUP BY s.id, s.user_id, s.title, s.description, s.is_private, s.status, s.metadata_hash, s.chunk_count, s.total_size, s.created_at, s.updated_at
        ORDER BY s.created_at DESC
      `;
      const result = await executeQuery(query, [userId]);
      callback(null, result.rows);
    } catch (err) {
      callback(err, null);
    }
  },

  // Update stream
  update: async (streamId, updateData, callback) => {
    try {
      const fields = [];
      const values = [];
      let paramCounter = 1;
      
      Object.keys(updateData).forEach(key => {
        if (updateData[key] !== undefined) {
          fields.push(`${key} = $${paramCounter}`);
          values.push(updateData[key]);
          paramCounter++;
        }
      });
      
      if (fields.length === 0) {
        return callback(new Error('No fields to update'), null);
      }
      
      fields.push(`updated_at = CURRENT_TIMESTAMP`);
      values.push(streamId);
      
      const query = `UPDATE streams SET ${fields.join(', ')} WHERE id = $${paramCounter}`;
      await executeQuery(query, values);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }
};

// Chunk model methods
const ChunkModel = {
  // Create a new chunk
  create: async (chunkData, callback) => {
    try {
      const { id, streamId, chunkIndex, ipfsHash, size, timestamp } = chunkData;
      const query = `
        INSERT INTO chunks (id, stream_id, chunk_index, ipfs_hash, size, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `;
      await executeQuery(query, [id, streamId, chunkIndex, ipfsHash, size, timestamp]);
      
      // Update stream chunk count and total size
      ChunkModel.updateStreamStats(streamId, () => {});
      callback(null, { id, ...chunkData });
    } catch (err) {
      callback(err, null);
    }
  },

  // Find chunks by stream ID
  findByStreamId: async (streamId, callback) => {
    try {
      const query = `
        SELECT * FROM chunks 
        WHERE stream_id = $1 
        ORDER BY chunk_index ASC
      `;
      const result = await executeQuery(query, [streamId]);
      callback(null, result.rows);
    } catch (err) {
      callback(err, null);
    }
  },

  // Update chunk with Arweave transaction ID
  updateArweaveStatus: async (chunkId, arweaveTxId, callback) => {
    try {
      const query = `
        UPDATE chunks 
        SET arweave_tx_id = $1, archived_at = CURRENT_TIMESTAMP, status = 'archived'
        WHERE id = $2
      `;
      await executeQuery(query, [arweaveTxId, chunkId]);
      callback(null);
    } catch (err) {
      callback(err);
    }
  },

  // Update stream statistics
  updateStreamStats: async (streamId, callback) => {
    try {
      const query = `
        UPDATE streams 
        SET 
          chunk_count = (SELECT COUNT(*) FROM chunks WHERE stream_id = $1),
          total_size = (SELECT COALESCE(SUM(size), 0) FROM chunks WHERE stream_id = $2),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
      `;
      await executeQuery(query, [streamId, streamId, streamId]);
      callback(null);
    } catch (err) {
      callback(err);
    }
  },

  // Get chunk statistics
  getStreamStats: async (streamId, callback) => {
    try {
      const query = `
        SELECT 
          COUNT(*) as total_chunks,
          COALESCE(SUM(size), 0) as total_size,
          COUNT(CASE WHEN arweave_tx_id IS NOT NULL THEN 1 END) as archived_chunks,
          MIN(timestamp) as start_time,
          MAX(timestamp) as end_time
        FROM chunks 
        WHERE stream_id = $1
      `;
      const result = await executeQuery(query, [streamId]);
      callback(null, result.rows[0] || null);
    } catch (err) {
      callback(err, null);
    }
  }
};

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('🔄 Shutting down PostgreSQL connection pool...');
  await pool.end();
  console.log('✅ PostgreSQL connection pool closed');
  process.exit(0);
});

// Export database pool for direct queries if needed
const db = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect()
};

module.exports = { db, UserModel, StreamModel, ChunkModel };