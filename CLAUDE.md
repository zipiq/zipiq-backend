# zipIQ Backend - Claude Context

**Project:** zipIQ - Censorship-Resistant Live Streaming Platform  
**Version:** 1.0.0  
**Last Updated:** December 13, 2024  
**Environment:** Production (Railway), Development (Local)

---

## 🎯 Project Overview

zipIQ is a decentralized live streaming platform that combines:
- **WebRTC P2P streaming** for real-time video delivery
- **IPFS content storage** for distributed file sharing
- **Arweave blockchain** for permanent content archival
- **JWT authentication** with PostgreSQL user management

### Core Value Proposition
- **Censorship-resistant** streaming infrastructure
- **Decentralized storage** with dual IPFS/Arweave strategy
- **Peer-to-peer delivery** reducing server bandwidth costs
- **Permanent archival** ensuring content survival

---

## 📊 Current Status

### Production Deployment
- **Platform:** Railway (railway.app)
- **Database:** PostgreSQL (hosted)
- **Domain:** TBD
- **Status:** MVP deployed, functional but needs hardening

### Key Metrics (Estimated)
- **User Base:** Early stage (< 100 users)
- **Storage:** Mock IPFS + Arweave queue system
- **Performance:** Handles basic streaming workloads
- **Uptime:** Basic monitoring, no SLA

---

## 🏗️ Technology Stack

### Backend
- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Database:** PostgreSQL with connection pooling
- **Authentication:** JWT with bcryptjs
- **Real-time:** Socket.IO for WebRTC signaling

### Storage Systems
- **IPFS:** Currently MOCK implementation (⚠️ CRITICAL ISSUE)
- **Arweave:** Functional with queue-based uploads
- **Local Storage:** Temporary chunk storage in uploads/

### Security & Infrastructure
- **CORS:** Configured for mobile apps
- **Rate Limiting:** Express-rate-limit
- **Security Headers:** Helmet middleware
- **Input Validation:** express-validator

---

## 🚨 Critical Issues (IMMEDIATE ATTENTION)

### 1. Mock IPFS in Production ⚠️ CRITICAL
- **Issue:** No real distributed storage
- **Impact:** Defeats decentralization purpose
- **Solution:** Replace with Pinata/Infura or local IPFS node
- **Priority:** P0 - Blocking

### 2. Single Arweave Wallet ⚠️ HIGH
- **Issue:** Single point of failure for archival
- **Impact:** Wallet compromise stops all uploads
- **Solution:** Multi-wallet rotation strategy
- **Priority:** P1 - High

### 3. In-Memory Queue Storage ⚠️ HIGH
- **Issue:** Queue lost on server restart
- **Impact:** Failed uploads not recoverable
- **Solution:** Redis implementation
- **Priority:** P1 - High

### 4. No Production Monitoring ⚠️ HIGH
- **Issue:** No visibility into system health
- **Impact:** Issues go undetected
- **Solution:** Prometheus + Grafana setup
- **Priority:** P1 - High

---

## 🎯 Immediate Priorities (Next 2 Weeks)

### Week 1: Core Infrastructure
1. **Replace Mock IPFS** - Implement real IPFS integration
2. **Add Redis Queue** - Persistent queue for Arweave uploads
3. **Basic Monitoring** - Health endpoints and logging

### Week 2: Reliability
1. **Multi-wallet Strategy** - Backup Arweave wallets
2. **Error Recovery** - Retry mechanisms and graceful degradation
3. **Database Migrations** - Version controlled schema changes

---

## 📁 Key Files & Locations

### Core Application
- `server.js` - Main Express application and Socket.IO setup
- `package.json` - Dependencies and scripts

### API Routes
- `routes/auth.js` - User authentication (login, register, password reset)
- `routes/stream.js` - Video streaming endpoints (upload, status, chunks)

### Business Logic
- `services/ipfs.js` - **MOCK IPFS service (NEEDS REPLACEMENT)**
- `services/arweave.js` - Arweave blockchain storage with queue

### Data Layer
- `models/user.js` - PostgreSQL user model with auth methods
- `middleware/auth.js` - JWT authentication middleware

### Documentation
- `docs/architecture.md` - System architecture overview
- `docs/current-issues.md` - Detailed problem analysis
- `zipiq-architecture-analysis.pdf` - Comprehensive analysis report

---

## 🔧 Development Workflow

### Local Setup
```bash
npm install
cp .env.example .env  # Configure environment
npm run dev           # Start with nodemon
```

### Key Commands
```bash
npm start                    # Production start
npm run dev                  # Development with auto-reload
npm run cleanup             # Clean old IPFS chunks
```

### Environment Variables (Required)
```bash
DATABASE_URL=postgresql://...           # PostgreSQL connection
JWT_SECRET=...                         # JWT signing secret
SMTP_HOST=...                          # Email service
ARWEAVE_HOST=arweave.net              # Arweave network
ALLOWED_ORIGINS=*                      # CORS origins
```

---

## 🔍 Common Tasks & Context

### When Working on IPFS Integration
- Current implementation is 100% mock (services/ipfs.js)
- Need to replace with real IPFS node or Pinata service
- Maintain same interface for backward compatibility
- Test with actual content addressing and retrieval

### When Working on Arweave Features
- Service is functional but uses single wallet (security risk)
- Queue processing works but lacks persistence
- Cost estimation and balance monitoring needed
- Transaction confirmation tracking required

### When Working on Authentication
- JWT implementation is solid with refresh tokens
- Password reset functionality complete with email
- User model supports Web3 features (wallet_address)
- Missing: Social auth, 2FA, session management

### When Working on Streaming
- WebRTC signaling through Socket.IO is functional
- Chunk upload/storage pipeline works end-to-end
- Missing: Stream quality controls, bandwidth optimization
- Health check endpoints provide good diagnostics

---

## 🚀 Future Roadmap (Post-MVP)

### Phase 2: Scaling (Months 1-2)
- Container orchestration (Docker/Kubernetes)
- Multi-region deployment
- Advanced caching with Redis
- Performance optimization

### Phase 3: Features (Months 3-6)
- Live chat integration
- Content moderation tools
- Analytics and metrics
- Mobile app SDK

### Phase 4: Monetization (Months 6-12)
- Token economics integration
- Creator revenue sharing
- Premium streaming features
- Enterprise APIs

---

## 💡 Helpful Context for Claude

### Architecture Patterns Used
- **RESTful API** design with clear resource separation
- **Service layer** pattern for business logic isolation
- **Middleware pattern** for cross-cutting concerns
- **Queue pattern** for async processing

### Code Style & Conventions
- **Callback-style** database operations (legacy, consider Promise migration)
- **Express middleware** chaining for request processing
- **Environment-based configuration** for deployment flexibility
- **Comprehensive error handling** with appropriate HTTP codes

### Testing & Quality
- **No automated tests** currently (needs implementation)
- **Manual testing** via health endpoints
- **Basic input validation** with express-validator
- **Security best practices** with Helmet and rate limiting

---

## 📞 Getting Help

### When You Need To:
1. **Understand the codebase** → Start with server.js, then routes/
2. **Fix IPFS issues** → Focus on services/ipfs.js replacement
3. **Debug Arweave** → Check services/arweave.js queue processing
4. **Add new features** → Follow existing patterns in routes/
5. **Deploy changes** → Railway auto-deploys from main branch

### Quick Diagnostic Commands
```bash
# Check application health
curl http://localhost:3000/api/v1/health

# View queue status
curl http://localhost:3000/api/v1/admin/stats

# Test authentication
curl -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"testpassword"}'
```

---

**Remember:** This is a production system with real users. Test thoroughly before deploying, and prioritize reliability over new features.