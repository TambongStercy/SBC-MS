# NSFW.js Deployment Guide - Free & Open Source Content Moderation

## Overview

NSFW.js is a **free, open-source** TensorFlow.js-based solution for detecting pornographic content in images. Unlike Sightengine (~$45/month), NSFW.js runs **locally on your VPS at zero cost**.

### Why NSFW.js?

✅ **FREE** - No API costs, unlimited usage
✅ **90-93% Accuracy** - Comparable to paid services
✅ **Self-Hosted** - Full control, no external dependencies
✅ **Native Node.js** - No Python bridge required
✅ **Privacy-First** - Images never leave your server
✅ **Resource Efficient** - Runs on standard VPS (2-4GB RAM)

---

## Quick Start

### Option 1: Direct Installation (Linux VPS - Recommended)

On your **production Linux VPS**, NSFW.js installs without issues:

```bash
cd chat-service
npm install nsfwjs @tensorflow/tfjs-node
```

Update `.env`:
```bash
CONTENT_MODERATION_ENABLED=true
CONTENT_MODERATION_PROVIDER=nsfwjs
```

That's it! The service will automatically use NSFW.js for content moderation.

### Option 2: Docker Deployment (All Platforms)

For development on Windows or containerized deployments, use Docker:

```yaml
# docker-compose.yml (add to your existing file)
services:
  chat-service:
    build:
      context: ./chat-service
      dockerfile: Dockerfile
    environment:
      - CONTENT_MODERATION_ENABLED=true
      - CONTENT_MODERATION_PROVIDER=nsfwjs
    # ... other config
```

---

## Installation Details

### System Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 2 GB | 4 GB |
| CPU | 2 cores | 4 cores |
| Storage | 500 MB | 1 GB |
| OS | Linux (Ubuntu 20.04+) | Ubuntu 22.04 LTS |

### Linux VPS Installation

```bash
# 1. Navigate to chat service
cd /path/to/chat-service

# 2. Install dependencies
npm install nsfwjs @tensorflow/tfjs-node

# 3. Verify installation
node -e "require('@tensorflow/tfjs-node'); console.log('TensorFlow OK')"

# 4. Configure environment
cp .env.example .env
nano .env  # Set CONTENT_MODERATION_PROVIDER=nsfwjs

# 5. Start service
npm run dev
```

### Docker Installation

```dockerfile
# chat-service/Dockerfile
FROM node:18-alpine

# Install Python and build tools for TensorFlow.js
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Build TypeScript
RUN npm run build

EXPOSE 3008

CMD ["npm", "start"]
```

```bash
# Build and run
docker-compose up chat-service --build
```

---

## Configuration

### Environment Variables

```bash
# Enable content moderation
CONTENT_MODERATION_ENABLED=true

# Select provider (nsfwjs is free, self-hosted)
CONTENT_MODERATION_PROVIDER=nsfwjs

# Thresholds (0.0 to 1.0)
MODERATION_BLOCK_THRESHOLD=0.85  # Block if score > 0.85
MODERATION_WARN_THRESHOLD=0.60   # Warn if score > 0.60
```

### Threshold Tuning

NSFW.js classifies images into 5 categories:
- **Porn**: Explicit sexual content (pornography)
- **Hentai**: Animated pornographic content
- **Sexy**: Sexually suggestive but not explicit
- **Drawing**: Non-sexual drawings
- **Neutral**: Safe for work content

**Recommended thresholds:**

| Use Case | Block Threshold | Warn Threshold |
|----------|----------------|----------------|
| **Strict** (Family-friendly) | 0.70 | 0.50 |
| **Balanced** (Default) | 0.85 | 0.60 |
| **Lenient** (Adult community) | 0.95 | 0.80 |

Example scores:
- Explicit porn image: Porn=0.95, Sexy=0.04, Neutral=0.01 → **BLOCKED**
- Suggestive selfie: Sexy=0.65, Neutral=0.30, Porn=0.05 → **WARNED**
- Normal photo: Neutral=0.90, Drawing=0.08, Sexy=0.02 → **ALLOWED**

---

## Windows Development Setup

### Problem

On Windows, `@tensorflow/tfjs-node` requires Visual Studio Build Tools, which causes installation failures.

### Solutions

#### Solution A: Use Docker (Recommended)

```bash
# Install Docker Desktop
# https://www.docker.com/products/docker-desktop

# Run services in containers
docker-compose up
```

#### Solution B: Install Build Tools (Advanced)

```powershell
# Install Visual Studio 2022 Build Tools
# Download: https://visualstudio.microsoft.com/downloads/

# Install "Desktop development with C++" workload

# Then install NSFW.js
npm install nsfwjs @tensorflow/tfjs-node
```

#### Solution C: Develop Without Moderation Locally

```bash
# .env.local
CONTENT_MODERATION_ENABLED=false
```

Deploy with moderation enabled on Linux VPS.

---

## Performance Optimization

### 1. Model Caching

The NSFW.js model is ~5MB and loaded once at startup:

```typescript
// Automatically cached after first load
const model = await nsfw.load();
```

**Startup time**: ~1-2 seconds
**Memory usage**: ~150-300 MB after model load
**Processing time**: 200-500ms per image on CPU

### 2. Memory Management

**CRITICAL**: Dispose of tensors to prevent memory leaks:

```typescript
const image = await tf.node.decodeImage(buffer, 3);
const predictions = await model.classify(image);
image.dispose(); // ← IMPORTANT: Prevents memory leak
```

Our implementation automatically handles this.

### 3. Concurrent Processing

The service handles multiple images in parallel. Limit concurrency to avoid memory issues:

```typescript
// In production, limit to 2-4 concurrent classifications
const queue = new PQueue({ concurrency: 2 });
```

### 4. Caching Results

Cache moderation results to avoid re-processing:

```typescript
// Redis cache (optional optimization)
const cacheKey = `moderation:${sha256(imageUrl)}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

// Moderate and cache result
const result = await moderate(imageUrl);
await redis.setex(cacheKey, 86400, JSON.stringify(result)); // 24h cache
```

---

## Monitoring

### Health Check

```bash
# Test if NSFW.js is working
curl http://localhost:3008/health
```

Expected response:
```json
{
  "status": "healthy",
  "moderation": {
    "enabled": true,
    "provider": "nsfwjs",
    "available": true
  }
}
```

### Metrics to Track

1. **Classification time** (should be < 1 second)
2. **Memory usage** (should stabilize after warmup)
3. **Block rate** (% of images blocked)
4. **Error rate** (should be < 1%)

### Logging

```bash
# View moderation logs
tail -f logs/chat-service.log | grep "moderation"

# Count blocked images today
grep "blocked due to" logs/chat-service.log | grep $(date +%Y-%m-%d) | wc -l
```

---

## Testing

### Test Image Classification

```bash
# 1. Create test script
cat > test-nsfw.js << 'EOF'
const tf = require('@tensorflow/tfjs-node');
const nsfw = require('nsfwjs');
const axios = require('axios');

async function test() {
  console.log('Loading model...');
  const model = await nsfw.load();

  console.log('Downloading test image...');
  const imageUrl = 'https://example.com/test-image.jpg';
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const imageBuffer = Buffer.from(response.data);

  console.log('Classifying...');
  const image = await tf.node.decodeImage(imageBuffer, 3);
  const predictions = await model.classify(image);
  image.dispose();

  console.log('Results:', predictions);
}

test();
EOF

# 2. Run test
node test-nsfw.js
```

### Expected Output

```javascript
[
  { className: 'Neutral', probability: 0.92 },
  { className: 'Drawing', probability: 0.05 },
  { className: 'Sexy', probability: 0.02 },
  { className: 'Porn', probability: 0.01 },
  { className: 'Hentai', probability: 0.00 }
]
```

### Unit Tests

```typescript
// test/nsfw-moderation.test.ts
import { nsfwModerationService } from '../src/services/nsfw-moderation.service';

describe('NSFW Moderation', () => {
  it('should allow safe images', async () => {
    const result = await nsfwModerationService.classifyImage(
      'https://example.com/safe-image.jpg'
    );
    expect(result.action).toBe('allow');
  });

  it('should block explicit content', async () => {
    // Use NSFW.js test images
    const result = await nsfwModerationService.classifyImage(
      'https://raw.githubusercontent.com/infinitered/nsfwjs/master/examples/example_nsfw.jpg'
    );
    expect(result.action).toBe('block');
  });
});
```

---

## Troubleshooting

### Issue: "Cannot find module '@tensorflow/tfjs-node'"

**Cause**: TensorFlow.js not installed or build failed

**Solution**:
```bash
# On Linux VPS
npm install @tensorflow/tfjs-node --build-from-source

# On Windows (use Docker instead)
docker-compose up chat-service
```

### Issue: High memory usage

**Cause**: Tensor memory leaks

**Solution**: Ensure `image.dispose()` is called after classification (already implemented)

### Issue: Slow classification (> 2 seconds per image)

**Cause**: CPU bottleneck or large images

**Solutions**:
1. Resize images before classification (max 224x224)
2. Use smaller NSFW.js model variant
3. Add more CPU cores to VPS

### Issue: Model download fails

**Cause**: Network issues or Google Storage blocked

**Solution**: Host model locally
```bash
# Download model
wget https://github.com/infinitered/nsfwjs/releases/download/v2.4.0/mobilenet_v2_mid.tar.gz
tar -xzf mobilenet_v2_mid.tar.gz -C ./models/nsfw

# Load from local path
const model = await nsfw.load('./models/nsfw/', { type: 'graph' });
```

---

## Cost Comparison

### NSFW.js (Self-Hosted) vs Sightengine (API)

| Metric | NSFW.js | Sightengine |
|--------|---------|-------------|
| **Setup Cost** | $0 | $0 |
| **Monthly Cost (10K images)** | $0 | $15 |
| **Monthly Cost (100K images)** | $0 | $100 |
| **Monthly Cost (1M images)** | $0 | $500 |
| **VPS RAM Overhead** | +300 MB | 0 MB |
| **Accuracy** | 90-93% | 95%+ |
| **Processing Time** | 200-500ms | 100-200ms |
| **Privacy** | Full control | Images sent to API |
| **Maintenance** | Self-hosted | Managed service |

**Break-even point**: If you process > 1000 images/month, NSFW.js is more cost-effective.

For your use case (potentially thousands of statuses daily), NSFW.js will save **hundreds of dollars per month**.

---

## Production Checklist

### Pre-Deployment

- [ ] Install `nsfwjs` and `@tensorflow/tfjs-node` on production server
- [ ] Set `CONTENT_MODERATION_ENABLED=true`
- [ ] Set `CONTENT_MODERATION_PROVIDER=nsfwjs`
- [ ] Configure thresholds for your community standards
- [ ] Test with sample images
- [ ] Verify memory usage is acceptable
- [ ] Set up monitoring and alerts

### Post-Deployment

- [ ] Monitor block/warn rates for first 24 hours
- [ ] Adjust thresholds if needed
- [ ] Review flagged content for false positives
- [ ] Document any edge cases
- [ ] Set up automated alerts for service errors

### Ongoing Maintenance

- [ ] Weekly: Review flagged content
- [ ] Monthly: Analyze block rates and adjust thresholds
- [ ] Quarterly: Update NSFW.js to latest version
- [ ] As needed: Tune thresholds based on user feedback

---

## Advanced: Video Moderation

For video content, extract frames and classify each:

```typescript
import ffmpeg from 'fluent-ffmpeg';

async function moderateVideo(videoPath: string): Promise<ModerationResult> {
  // Extract frames at 25%, 50%, 75%
  const frames = await extractFrames(videoPath, [0.25, 0.5, 0.75]);

  // Classify each frame
  const results = await Promise.all(
    frames.map(frame => nsfwModerationService.classifyImage(frame))
  );

  // Use highest NSFW score
  const maxScore = Math.max(...results.map(r => r.details.nudity));

  return {
    isAppropriate: maxScore < 0.85,
    action: maxScore > 0.85 ? 'block' : (maxScore > 0.60 ? 'warn' : 'allow'),
    details: { nudity: maxScore }
  };
}
```

---

## Migration from Sightengine

If currently using Sightengine:

1. **Parallel Testing** (Week 1)
   ```bash
   # Run both services, compare results
   CONTENT_MODERATION_PROVIDER=nsfwjs
   # Log differences
   ```

2. **Threshold Calibration** (Week 2)
   - Compare block rates between services
   - Adjust NSFW.js thresholds to match
   - Review false positives/negatives

3. **Gradual Rollout** (Week 3)
   - 10% traffic to NSFW.js
   - 50% traffic after validation
   - 100% after confidence established

4. **Sightengine Deprecation** (Week 4)
   - Stop Sightengine subscription
   - Remove Sightengine code
   - Celebrate cost savings! 🎉

---

## Support & Resources

### Documentation
- [NSFW.js GitHub](https://github.com/infinitered/nsfwjs)
- [TensorFlow.js Docs](https://www.tensorflow.org/js)
- [NSFW.js Examples](https://github.com/infinitered/nsfwjs/tree/master/examples)

### Community
- [NSFW.js Issues](https://github.com/infinitered/nsfwjs/issues)
- [TensorFlow.js Forum](https://discuss.tensorflow.org/)

### Alternative Models
- [Yahoo Open NSFW](https://github.com/yahoo/open_nsfw) - Original model
- [NudeNet](https://github.com/notAI-tech/NudeNet) - Python, higher accuracy
- [nsfw_detector](https://pypi.org/project/nsfw-detector/) - Python alternative

---

## Summary

**NSFW.js is the recommended solution for your use case:**

✅ **Zero cost** - No API fees, unlimited usage
✅ **High accuracy** - 90-93% detection rate
✅ **Easy deployment** - Native Node.js, works on Linux VPS
✅ **Privacy-first** - All processing done locally
✅ **Production-ready** - Used by many platforms

**Total savings**: ~$50-500/month compared to Sightengine

**Setup time**: 30 minutes on Linux VPS

**Maintenance**: Minimal, set-it-and-forget-it

For production deployment, simply:
1. Install on your Linux VPS: `npm install nsfwjs @tensorflow/tfjs-node`
2. Set `CONTENT_MODERATION_PROVIDER=nsfwjs`
3. Deploy and enjoy free content moderation! 🚀
