#!/usr/bin/env node
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 3847;
const LTX_API_URL = 'https://api.ltx.video/v1/audio-to-video';
const LTX_RETAKE_URL = 'https://api.ltx.video/v1/retake';
const CACHE_DIR = path.join(os.homedir(), '.ltx-cache');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function runCommand(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr || error.message));
      else resolve(stdout);
    });
  });
}

const server = http.createServer(async (req, res) => {
  console.log(`${req.method} ${req.url}`);

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check endpoint
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  // Save video to disk
  if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { videoBase64, folder, filename } = JSON.parse(body);

        // Expand ~ to home directory
        let saveFolder = folder.replace(/^~/, os.homedir());

        // Ensure folder exists
        if (!fs.existsSync(saveFolder)) {
          fs.mkdirSync(saveFolder, { recursive: true });
        }

        // Generate unique filename if needed
        let finalFilename = filename;
        let filePath = path.join(saveFolder, finalFilename);
        let counter = 1;
        while (fs.existsSync(filePath)) {
          const ext = path.extname(filename);
          const base = path.basename(filename, ext);
          finalFilename = `${base}_${counter}${ext}`;
          filePath = path.join(saveFolder, finalFilename);
          counter++;
        }

        // Decode base64 and save
        const videoBuffer = Buffer.from(videoBase64, 'base64');
        fs.writeFileSync(filePath, videoBuffer);

        console.log(`Saved video to ${filePath}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, path: filePath, filename: finalFilename }));

      } catch (err) {
        console.error('Save error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // LTX API proxy
  if (req.method === 'POST' && req.url === '/ltx') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let responded = false;

      const sendError = (status, message) => {
        if (responded) return;
        responded = true;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      };

      try {
        const { apiKey, ...payload } = JSON.parse(body);
        console.log('Proxying to LTX API...');
        console.log('Payload keys:', Object.keys(payload));
        console.log('audio_uri length:', payload.audio_uri?.length);
        console.log('image_uri:', payload.image_uri ? 'provided' : 'none');
        console.log('prompt:', payload.prompt || 'none');

        const postData = JSON.stringify(payload);
        const url = new URL(LTX_API_URL);

        console.log('Request size:', Math.round(Buffer.byteLength(postData) / 1024), 'KB');

        const proxyReq = https.request({
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          timeout: 300000, // 5 min timeout
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'Authorization': `Bearer ${apiKey}`,
          },
        }, (proxyRes) => {
          console.log('LTX API response:', proxyRes.statusCode);

          if (responded) return;

          if (proxyRes.statusCode !== 200) {
            let errorBody = '';
            proxyRes.on('data', chunk => errorBody += chunk);
            proxyRes.on('end', () => {
              console.error('LTX API error body:', errorBody);
              sendError(proxyRes.statusCode, errorBody);
            });
            return;
          }

          responded = true;
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
          });
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          console.error('LTX proxy error:', err.message);
          sendError(502, `Proxy error: ${err.message}`);
        });

        proxyReq.on('timeout', () => {
          console.error('LTX proxy timeout');
          proxyReq.destroy();
          sendError(504, 'Request timeout');
        });

        proxyReq.write(postData);
        proxyReq.end();
        console.log('Request sent, waiting for response...');

      } catch (err) {
        console.error('LTX proxy error:', err.message);
        sendError(500, err.message);
      }
    });
    return;
  }

  // LTX Retake API proxy
  if (req.method === 'POST' && req.url === '/retake') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      let responded = false;

      const sendError = (status, message) => {
        if (responded) return;
        responded = true;
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      };

      try {
        const { apiKey, ...payload } = JSON.parse(body);
        console.log('Proxying to LTX Retake API...');
        console.log('Payload keys:', Object.keys(payload));
        console.log('video_uri length:', payload.video_uri?.length);
        console.log('start_time:', payload.start_time);
        console.log('duration:', payload.duration);
        console.log('mode:', payload.mode);
        console.log('prompt:', payload.prompt || 'none');

        const postData = JSON.stringify(payload);
        const url = new URL(LTX_RETAKE_URL);

        console.log('Request size:', Math.round(Buffer.byteLength(postData) / 1024), 'KB');

        const proxyReq = https.request({
          hostname: url.hostname,
          path: url.pathname,
          method: 'POST',
          timeout: 300000,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'Authorization': `Bearer ${apiKey}`,
          },
        }, (proxyRes) => {
          console.log('LTX Retake API response:', proxyRes.statusCode);

          if (responded) return;

          if (proxyRes.statusCode !== 200) {
            let errorBody = '';
            proxyRes.on('data', chunk => errorBody += chunk);
            proxyRes.on('end', () => {
              console.error('LTX Retake API error body:', errorBody);
              sendError(proxyRes.statusCode, errorBody);
            });
            return;
          }

          responded = true;
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': proxyRes.headers['content-type'] || 'application/octet-stream',
          });
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          console.error('LTX Retake proxy error:', err.message);
          sendError(502, `Proxy error: ${err.message}`);
        });

        proxyReq.on('timeout', () => {
          console.error('LTX Retake proxy timeout');
          proxyReq.destroy();
          sendError(504, 'Request timeout');
        });

        proxyReq.write(postData);
        proxyReq.end();
        console.log('Retake request sent, waiting for response...');

      } catch (err) {
        console.error('LTX Retake proxy error:', err.message);
        sendError(500, err.message);
      }
    });
    return;
  }

  // Video extraction for retake
  if (req.method === 'POST' && req.url === '/video') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltx-vid-'));

      try {
        const { videoId, startTime, endTime } = JSON.parse(body);
        const duration = endTime - startTime;
        const url = `https://www.youtube.com/watch?v=${videoId}`;
        const cachedVideo = path.join(CACHE_DIR, `${videoId}.mp4`);
        const outputFile = path.join(tmpDir, 'video.mp4');

        console.log(`Extracting video ${startTime}s-${endTime}s from ${videoId}...`);

        // Check cache first
        if (fs.existsSync(cachedVideo)) {
          console.log('Using cached video');
        } else {
          console.log('Downloading video from YouTube...');
          // Download H.264 video (avoid AV1 which may not decode on all systems)
          await runCommand(`yt-dlp -f "bestvideo[height<=1080][vcodec^=avc1]+bestaudio/best[height<=1080]" --merge-output-format mp4 -o "${cachedVideo}" "${url}"`);
          console.log('Download complete, cached');
        }

        // Trim to segment with re-encoding for precise cuts
        console.log('Trimming...');
        await runCommand(`ffmpeg -y -i "${cachedVideo}" -ss ${startTime} -t ${duration} -c:v libx264 -c:a aac -preset fast "${outputFile}"`);
        console.log('Trim complete, encoding...');

        const videoData = fs.readFileSync(outputFile);
        const base64 = videoData.toString('base64');

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ video: `data:video/mp4;base64,${base64}` }));
        console.log('Done, sent', Math.round(base64.length / 1024), 'KB');

      } catch (err) {
        console.error('Video extraction error:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      } finally {
        // Cleanup
        fs.rm(tmpDir, { recursive: true }, () => {});
      }
    });
    return;
  }

  // Audio extraction
  if (req.method !== 'POST' || req.url !== '/audio') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ltx-'));

    try {
      const { videoId, startTime, endTime } = JSON.parse(body);
      const duration = endTime - startTime;
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const cachedAudio = path.join(CACHE_DIR, `${videoId}.mp3`);
      const audioFile = path.join(tmpDir, 'audio.mp3');

      console.log(`Extracting ${startTime}s-${endTime}s from ${videoId}...`);

      // Check cache first
      if (fs.existsSync(cachedAudio)) {
        console.log('Using cached audio');
      } else {
        console.log('Downloading from YouTube...');
        await runCommand(`yt-dlp -x --audio-format mp3 -o "${cachedAudio}" "${url}"`);
        console.log('Download complete, cached');
      }

      // Trim to segment
      console.log('Trimming...');
      await runCommand(`ffmpeg -y -i "${cachedAudio}" -ss ${startTime} -t ${duration} -acodec libmp3lame -ar 44100 "${audioFile}"`);
      console.log('Trim complete, encoding...');

      const audioData = fs.readFileSync(audioFile);
      const base64 = audioData.toString('base64');

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ audio: `data:audio/mpeg;base64,${base64}` }));
      console.log('Done, sent', Math.round(base64.length / 1024), 'KB');

    } catch (err) {
      console.error('Error:', err.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    } finally {
      // Cleanup
      fs.rm(tmpDir, { recursive: true }, () => {});
    }
  });
});

// Handle uncaught errors to prevent crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err.message);
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err.message);
});

server.listen(PORT, () => {
  console.log(`LTX audio server running on http://localhost:${PORT}`);
  console.log(`Cache directory: ${CACHE_DIR}`);
});
