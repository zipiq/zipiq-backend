# zipIQ Backend Architecture

**Version:** 1.0  
**Last Updated:** December 13, 2024  
**Status:** Production MVP

---

## 🏗️ System Overview

zipIQ implements a **censorship-resistant live streaming platform** using a hybrid architecture that combines traditional web technologies with decentralized storage networks.

### Core Design Principles
1. **Decentralization First** - No single point of failure for content
2. **Peer-to-Peer Delivery** - Direct streaming between users
3. **Permanent Archival** - Immutable storage on blockchain
4. **Developer Friendly** - Clear APIs and service boundaries

---

## 📐 Architecture Diagram

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   iOS/Mobile    │    │   Web Clients   │    │  Other Apps     │
│     Apps        │    │                 │    │                 │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │      CORS / Security      │
                    │     Rate Limiting         │
                    └─────────────┬─────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │    Express.js Server      │
                    │      + Socket.IO          │
                    └─────────────┬─────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                       │                        │
┌───────▼──────┐    ┌───────────▼────────┐    ┌─────────▼────────┐
│     Auth     │    │      Stream        │    │     WebRTC       │
│   Routes     │    │     Routes         │    │   Signaling      │
└───────┬──────┘    └───────────┬────────┘    └─────────┬────────┘
        │                       │                       │
┌───────▼──────┐    ┌───────────▼────────┐    ┌─────────▼────────┐
│     User     │    │      IPFS          │    │    P2P Video     │
│    Model     │    │    Service         │    │    Streaming     │
└───────┬──────┘    └───────────┬────────┘    └──────────────────┘
        │                       │
┌───────▼──────┐    ┌───────────▼────────┐
│ PostgreSQL   │    │     Arweave        │
│  Database    │    │    Service         │
└──────────────┘    └───────────┬────────┘
                                │
                    ┌───────────▼────────┐
                    │   Arweave Network  │
                    │  (Blockchain)      │
                    └────────────────────┘
```

---

## 🔧 Component Architecture

### 1. **API Gateway Layer**

**Location:** `server.js` (lines 18-148)

**Responsibilities:**
- CORS configuration for mobile/web clients
- Rate limiting to prevent abuse
- Security headers (Helmet middleware)
- Request logging and monitoring

**Key Features:**
- Railway-specific proxy configuration
- Mobile app CORS support (no-origin requests)
- Configurable rate limits via environment
- Comprehensive request logging

```javascript
// Rate limiting with Railway proxy support
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  trustProxy: 'loopback, linklocal, uniquelocal'
});
```

### 2. **Authentication System**

**Location:** `routes/auth.js`, `middleware/auth.js`, `models/user.js`

**Architecture Pattern:** JWT + Refresh Token Strategy

**Components:**
- **JWT Middleware** (`middleware/auth.js`) - Token validation
- **Auth Routes** (`routes/auth.js`) - Login, register, password reset
- **User Model** (`models/user.js`) - Database operations

**Features:**
- Stateless JWT authentication
- Refresh token rotation
- Secure password reset with email
- User profile management
- PostgreSQL integration

```javascript
// JWT Token Structure
{
  "userId": "123",
  "iat": 1702468800,
  "exp": 1702555200
}
```

### 3. **Streaming Engine**

**Location:** `routes/stream.js`, `server.js` (Socket.IO section)

**Architecture Pattern:** Hybrid Upload + P2P Delivery

**Components:**
- **Chunk Upload API** - REST endpoints for video chunks
- **WebRTC Signaling** - Socket.IO for peer connections
- **Stream Management** - Metadata and status tracking

**Data Flow:**
1. Client uploads video chunks via REST API
2. Chunks stored in IPFS and queued for Arweave
3. Stream metadata stored in PostgreSQL
4. WebRTC signaling coordinates P2P connections
5. Peers stream directly to each other

### 4. **Storage Services**

#### IPFS Service (`services/ipfs.js`)
**Current Status:** Mock Implementation ⚠️

**Intended Architecture:**
- Content-addressed storage for video chunks
- Distributed network for global delivery
- Pinning strategy for content persistence

**Mock Features (Development Only):**
- Local file storage simulation
- Hash generation mimicking IPFS
- Basic chunk management

#### Arweave Service (`services/arweave.js`)
**Status:** Production Ready ✅

**Architecture:**
- Queue-based upload system
- Wallet management for transactions
- Retry mechanism with exponential backoff
- Cost estimation and balance monitoring

**Features:**
```javascript
// Arweave Upload Queue
{
  id: "streamId_chunkIndex",
  data: Buffer,
  metadata: {
    streamId, chunkIndex, timestamp,
    userId, ipfsHash, size
  },
  attempts: 0,
  queuedAt: "2024-12-13T..."
}
```

### 5. **Database Layer**

**Technology:** PostgreSQL with connection pooling

**Schema Design:**
```sql
-- Users table with Web3 features
users (
  id SERIAL PRIMARY KEY,
  email VARCHAR UNIQUE,
  username VARCHAR UNIQUE,
  password_hash TEXT,
  wallet_address VARCHAR,  -- For future Web3 integration
  is_verified BOOLEAN,
  reset_password_token TEXT,
  created_at TIMESTAMP
)

-- Streams metadata
streams (
  id TEXT PRIMARY KEY,      -- UUID
  user_id INTEGER REFERENCES users(id),
  title TEXT,
  description TEXT,
  status TEXT DEFAULT 'created',
  metadata_hash TEXT,       -- IPFS hash of full metadata
  chunk_count INTEGER,
  total_size BIGINT
)

-- Individual video chunks
chunks (
  id TEXT PRIMARY KEY,
  stream_id TEXT REFERENCES streams(id),
  chunk_index INTEGER,
  ipfs_hash TEXT,          -- Content address
  arweave_tx_id TEXT,      -- Blockchain transaction
  size BIGINT,
  timestamp BIGINT,        -- Video timestamp
  status TEXT DEFAULT 'uploaded'
)
```

### 6. **Real-time Communication**

**Technology:** Socket.IO + WebRTC

**Architecture Pattern:** Signaling Server + P2P Streams

**Components:**
- **Room Management** - Organize peers by stream
- **Signal Relay** - WebRTC offer/answer/ICE exchange
- **Peer Discovery** - Connect viewers to streamers

**WebRTC Flow:**
```javascript
// 1. Join Room
socket.emit('join-room', roomId, peerId);

// 2. Signal Exchange
socket.emit('signal', targetPeer, { 
  type: 'offer', 
  sdp: localDescription 
});

// 3. Direct P2P Connection
// Video streams directly between peers
```

---

## 🔄 Data Flow Patterns

### Video Upload Flow
```
Mobile App → Express API → IPFS Service → Arweave Queue
     ↓            ↓            ↓              ↓
  UI Update → PostgreSQL → Mock Storage → Blockchain
```

### Authentication Flow
```
Login Request → Validation → Database → JWT Generation → Response
     ↓             ↓           ↓           ↓              ↓
  Credentials → Hash Check → User Data → Token Pair → Client Storage
```

### Live Streaming Flow
```
Streamer → WebRTC Signaling → Socket.IO → Viewers
    ↓           ↓                ↓           ↓
Upload Chunks → Room Join → Signal Relay → P2P Connection
```

---

## 🚀 Performance Characteristics

### Scalability
- **Horizontal:** Stateless design enables load balancing
- **Database:** Connection pooling with configurable limits
- **WebRTC:** P2P reduces server bandwidth requirements
- **Storage:** Distributed IPFS + permanent Arweave

### Bottlenecks
- **Sequential Processing:** Chunks uploaded one at a time
- **Single Thread:** No worker processes for heavy operations
- **Database:** All operations on main connection pool
- **Queue:** In-memory storage limits reliability

### Optimization Opportunities
- **Redis Caching:** Frequent metadata queries
- **CDN Integration:** Global content delivery
- **Worker Processes:** Parallel chunk processing
- **Database Sharding:** User-based partitioning

---

## 🔒 Security Architecture

### Authentication Security
- **JWT Tokens:** Stateless with configurable expiration
- **Password Hashing:** bcrypt with salt rounds
- **Refresh Tokens:** Rotation for enhanced security
- **Rate Limiting:** Per-IP request throttling

### Data Security
- **Input Validation:** express-validator for all endpoints
- **SQL Injection:** Parameterized queries throughout
- **CORS Configuration:** Strict origin validation
- **Security Headers:** Helmet middleware protection

### Infrastructure Security
- **Environment Variables:** Secure secrets management
- **HTTPS Enforcement:** Production SSL termination
- **Database SSL:** Encrypted connections in production
- **File Upload Limits:** Prevent DoS via large files

---

## 🌐 Deployment Architecture

### Current: Railway Platform
```
Internet → Railway Edge → Node.js App → PostgreSQL
                ↓              ↓
        Load Balancer → Container → Database
```

### Recommended: Multi-Service
```
CDN → Load Balancer → API Servers → Database Cluster
  ↓        ↓             ↓              ↓
Cache → Rate Limiting → Queue Workers → Redis
```

---

## 🔧 Integration Points

### External Services
- **SMTP Email:** Password reset notifications
- **Arweave Network:** Blockchain storage
- **IPFS Network:** Distributed file storage (planned)
- **PostgreSQL:** Primary database

### Internal APIs
- **Health Endpoints:** `/api/v1/health` system diagnostics
- **Admin Endpoints:** `/api/v1/admin/stats` internal metrics
- **Auth APIs:** Standard login/register/reset flows
- **Stream APIs:** Upload, status, chunk management

### WebSocket Events
```javascript
// Client → Server
'join-room'         // Enter streaming room
'signal'            // WebRTC signaling data
'content-available' // Announce new chunks

// Server → Client  
'peer-joined'       // New viewer connected
'peer-left'         // Viewer disconnected
'existing-peers'    // List current viewers
'content-available' // New content announcement
```

---

## 📊 Monitoring & Observability

### Current Monitoring
- **Health Checks:** Basic service status
- **Request Logging:** Express middleware logging
- **Error Handling:** Comprehensive error responses
- **Queue Stats:** Arweave upload queue metrics

### Missing Monitoring ⚠️
- **Application Metrics:** Response times, throughput
- **Database Metrics:** Connection pool, query performance
- **Storage Metrics:** IPFS/Arweave usage and costs
- **Business Metrics:** User engagement, stream quality

### Recommended Metrics
```javascript
// Application
http_request_duration_seconds
http_requests_total
active_connections

// Business
streams_created_total
chunks_uploaded_total
users_registered_total
arweave_cost_total

// Infrastructure
database_connections_active
ipfs_storage_used_bytes
queue_depth
```

---

## 🔮 Future Architecture Considerations

### Microservices Migration
- **Auth Service:** Independent authentication
- **Stream Service:** Video processing and storage
- **Signaling Service:** WebRTC coordination
- **Analytics Service:** Metrics and insights

### Event-Driven Architecture
- **Message Queue:** RabbitMQ or Apache Kafka
- **Event Sourcing:** Immutable event log
- **CQRS:** Separate read/write models
- **Saga Pattern:** Distributed transactions

### Infrastructure Evolution
- **Kubernetes:** Container orchestration
- **Service Mesh:** Istio for service communication
- **Multi-Region:** Global deployment
- **Edge Computing:** Content delivery optimization

---

This architecture provides a solid foundation for censorship-resistant streaming while maintaining familiar web development patterns. The key innovation is the dual storage strategy (IPFS + Arweave) combined with P2P delivery for optimal performance and resilience.