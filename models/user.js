const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, '..', process.env.DATABASE_PATH || 'data/zipiq.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Error opening database:', err.message);
  } else {
    console.log('📁 Connected to SQLite database:', dbPath);
  }
});

// Create users table with Web3 features
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      wallet_address TEXT,
      is_verified BOOLEAN DEFAULT 0,
      is_active BOOLEAN DEFAULT 1,
      profile_image_url TEXT,
      bio TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      verification_token TEXT,
      reset_password_token TEXT,
      reset_password_expires DATETIME
    )
  `, (err) => {
    if (err) {
      console.error('❌ Error creating users table:', err.message);
    } else {
      console.log('✅ Users table ready');
    }
  });

  // Create streams table for tracking user streams
  db.run(`
    CREATE TABLE IF NOT EXISTS streams (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      is_private BOOLEAN DEFAULT 0,
      status TEXT DEFAULT 'created',
      metadata_hash TEXT,
      chunk_count INTEGER DEFAULT 0,
      total_size INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `, (err) => {
    if (err) {
      console.error('❌ Error creating streams table:', err.message);
    } else {
      console.log('✅ Streams table ready');
    }
  });

  // Create chunks table for tracking stream chunks
  db.run(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      stream_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      ipfs_hash TEXT NOT NULL,
      arweave_tx_id TEXT,
      size INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      archived_at DATETIME,
      status TEXT DEFAULT 'uploaded',
      FOREIGN KEY (stream_id) REFERENCES streams (id) ON DELETE CASCADE,
      UNIQUE(stream_id, chunk_index)
    )
  `, (err) => {
    if (err) {
      console.error('❌ Error creating chunks table:', err.message);
    } else {
      console.log('✅ Chunks table ready');
    }
  });
});

// User model methods
const UserModel = {
  // Create a new user
  create: (userData, callback) => {
    const { email, username, passwordHash, firstName, lastName } = userData;
    const sql = `
      INSERT INTO users (email, username, password_hash, first_name, last_name)
      VALUES (?, ?, ?, ?, ?)
    `;
    db.run(sql, [email, username, passwordHash, firstName || null, lastName || null], function(err) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, { id: this.lastID, ...userData });
      }
    });
  },

  // Find user by email
  findByEmail: (email, callback) => {
    const sql = 'SELECT * FROM users WHERE email = ? AND is_active = 1';
    db.get(sql, [email], callback);
  },

  // Find user by username
  findByUsername: (username, callback) => {
    const sql = 'SELECT * FROM users WHERE username = ? AND is_active = 1';
    db.get(sql, [username], callback);
  },

  // Find user by ID
  findById: (id, callback) => {
    const sql = 'SELECT * FROM users WHERE id = ? AND is_active = 1';
    db.get(sql, [id], callback);
  },

  // Check if email or username exists
  checkExists: (email, username, callback) => {
    const sql = 'SELECT id FROM users WHERE (email = ? OR username = ?) AND is_active = 1';
    db.get(sql, [email, username], callback);
  },

  // Update user last login
  updateLastLogin: (userId, callback) => {
    const sql = 'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?';
    db.run(sql, [userId], callback);
  },

  // Get user profile (excluding sensitive data)
  getProfile: (userId, callback) => {
    const sql = `
      SELECT id, email, username, first_name, last_name, wallet_address, 
             is_verified, profile_image_url, bio, created_at, last_login
      FROM users 
      WHERE id = ? AND is_active = 1
    `;
    db.get(sql, [userId], callback);
  },

  // Update user profile
  updateProfile: (userId, updateData, callback) => {
    const fields = [];
    const values = [];
    
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updateData[key]);
      }
    });
    
    if (fields.length === 0) {
      return callback(new Error('No fields to update'), null);
    }
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(userId);
    
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    db.run(sql, values, callback);
  },

  // Get user statistics
  getUserStats: (userId, callback) => {
    const sql = `
      SELECT 
        u.id,
        u.username,
        u.created_at,
        COUNT(s.id) as total_streams,
        COALESCE(SUM(s.chunk_count), 0) as total_chunks,
        COALESCE(SUM(s.total_size), 0) as total_size
      FROM users u
      LEFT JOIN streams s ON u.id = s.user_id
      WHERE u.id = ? AND u.is_active = 1
      GROUP BY u.id
    `;
    db.get(sql, [userId], callback);
  }
};

// Stream model methods
const StreamModel = {
  // Create a new stream
  create: (streamData, callback) => {
    const { id, userId, title, description, isPrivate, metadataHash } = streamData;
    const sql = `
      INSERT INTO streams (id, user_id, title, description, is_private, metadata_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.run(sql, [id, userId, title, description, isPrivate ? 1 : 0, metadataHash], function(err) {
      if (err) {
        callback(err, null);
      } else {
        callback(null, { id, ...streamData });
      }
    });
  },

  // Find stream by ID
  findById: (streamId, callback) => {
    const sql = 'SELECT * FROM streams WHERE id = ?';
    db.get(sql, [streamId], callback);
  },

  // Get user's streams
  findByUserId: (userId, callback) => {
    const sql = `
      SELECT s.*, COUNT(c.id) as chunk_count, COALESCE(SUM(c.size), 0) as total_size
      FROM streams s
      LEFT JOIN chunks c ON s.id = c.stream_id
      WHERE s.user_id = ?
      GROUP BY s.id
      ORDER BY s.created_at DESC
    `;
    db.all(sql, [userId], callback);
  },

  // Update stream
  update: (streamId, updateData, callback) => {
    const fields = [];
    const values = [];
    
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        fields.push(`${key} = ?`);
        values.push(updateData[key]);
      }
    });
    
    if (fields.length === 0) {
      return callback(new Error('No fields to update'), null);
    }
    
    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(streamId);
    
    const sql = `UPDATE streams SET ${fields.join(', ')} WHERE id = ?`;
    db.run(sql, values, callback);
  }
};

// Chunk model methods
const ChunkModel = {
  // Create a new chunk
  create: (chunkData, callback) => {
    const { id, streamId, chunkIndex, ipfsHash, size, timestamp } = chunkData;
    const sql = `
      INSERT INTO chunks (id, stream_id, chunk_index, ipfs_hash, size, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.run(sql, [id, streamId, chunkIndex, ipfsHash, size, timestamp], function(err) {
      if (err) {
        callback(err, null);
      } else {
        // Update stream chunk count and total size
        ChunkModel.updateStreamStats(streamId, () => {});
        callback(null, { id, ...chunkData });
      }
    });
  },

  // Find chunks by stream ID
  findByStreamId: (streamId, callback) => {
    const sql = `
      SELECT * FROM chunks 
      WHERE stream_id = ? 
      ORDER BY chunk_index ASC
    `;
    db.all(sql, [streamId], callback);
  },

  // Update chunk with Arweave transaction ID
  updateArweaveStatus: (chunkId, arweaveTxId, callback) => {
    const sql = `
      UPDATE chunks 
      SET arweave_tx_id = ?, archived_at = CURRENT_TIMESTAMP, status = 'archived'
      WHERE id = ?
    `;
    db.run(sql, [arweaveTxId, chunkId], callback);
  },

  // Update stream statistics
  updateStreamStats: (streamId, callback) => {
    const sql = `
      UPDATE streams 
      SET 
        chunk_count = (SELECT COUNT(*) FROM chunks WHERE stream_id = ?),
        total_size = (SELECT COALESCE(SUM(size), 0) FROM chunks WHERE stream_id = ?),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `;
    db.run(sql, [streamId, streamId, streamId], callback);
  },

  // Get chunk statistics
  getStreamStats: (streamId, callback) => {
    const sql = `
      SELECT 
        COUNT(*) as total_chunks,
        COALESCE(SUM(size), 0) as total_size,
        COUNT(CASE WHEN arweave_tx_id IS NOT NULL THEN 1 END) as archived_chunks,
        MIN(timestamp) as start_time,
        MAX(timestamp) as end_time
      FROM chunks 
      WHERE stream_id = ?
    `;
    db.get(sql, [streamId], callback);
  }
};

module.exports = { db, UserModel, StreamModel, ChunkModel };