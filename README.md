# LTX YouTube Extension

A Chrome extension for generating AI videos from YouTube content using the [LTX Video API](https://ltx.video).

## Features

### Audio to Video
- Extract audio segments from any YouTube video (2-22 seconds)
- Generate AI video synchronized to the audio
- Optionally provide a conditioning image and/or text prompt

### Retake
- Download video segments from YouTube (2-21 seconds)
- Select a mask area within the video (2-16 seconds) to regenerate
- Choose what to replace: audio + video, video only, or audio only

### General
- Keyboard shortcuts for fast time selection (S/E for range, Shift+S/E for mask)
- Image input via URL, file browser, clipboard paste, or drag-drop
- Auto-save generated videos to a local folder
- YouTube content caching for faster subsequent requests
- Dark theme UI that overlays on YouTube

## Requirements

- [Node.js](https://nodejs.org/) (v18+)
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - for downloading YouTube content
- [ffmpeg](https://ffmpeg.org/) - for audio/video processing
- [LTX Video API key](https://ltx.video)

### Installing Dependencies (macOS)

```bash
brew install yt-dlp ffmpeg
```

## Setup

### 1. Install the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension/` folder from this repo

### 2. Start the Local Server

The extension requires a local server to handle YouTube downloads and API proxying (due to CORS restrictions).

#### Option A: Run manually (for testing)

```bash
cd server
npm install  # first time only
node index.js
```

#### Option B: Run as background service (recommended)

Run the server automatically on login without holding a terminal open:

1. **Edit the plist file** to match your setup:
   ```bash
   # Open the file and update paths if needed
   nano server/com.ltx.youtube-server.plist
   ```

   Update these values:
   - Path to `node` (run `which node` to find yours)
   - Path to `index.js` (where you cloned this repo)

2. **Install the LaunchAgent:**
   ```bash
   cp server/com.ltx.youtube-server.plist ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.ltx.youtube-server.plist
   ```

3. **Verify it's running:**
   ```bash
   curl http://localhost:3847/health
   # Should return: {"status":"ok"}
   ```

**Managing the service:**

```bash
# View logs
tail -f ~/Library/Logs/ltx-youtube-server.log

# Restart (after updating code)
launchctl stop com.ltx.youtube-server

# Stop completely
launchctl unload ~/Library/LaunchAgents/com.ltx.youtube-server.plist

# Start again
launchctl load ~/Library/LaunchAgents/com.ltx.youtube-server.plist
```

The server runs on `http://localhost:3847`.

### 3. Configure the Extension

1. Go to any YouTube video page
2. Click the 🎬 button (bottom right) or press `Alt+L`
3. Click the ⚙️ settings button
4. Enter your LTX API key
5. Optionally configure the auto-save folder (default: `~/Documents/ltx-youtube-extension`)

## Usage

### Audio to Video Tab

1. Play the YouTube video to the desired start point
2. Press `S` to set start time, seek forward, press `E` to set end time
3. (Optional) Add a conditioning image via URL, file, paste, or drag-drop
4. (Optional) Enter a text prompt describing the desired video style
5. Click "Generate Video"

### Retake Tab

1. Set the video range using `S` and `E` keys (what to download from YouTube)
2. Set the mask range using `Shift+S` and `Shift+E` (what portion to regenerate)
3. Select the mode (replace both, video only, or audio only)
4. Enter a prompt describing what should happen in the masked section
5. Click "Retake"

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Alt+L` | Toggle extension panel |
| `S` | Set start time to current video position |
| `E` | Set end time to current video position |
| `Shift+S` | Set mask start (Retake tab only) |
| `Shift+E` | Set mask end (Retake tab only) |

## File Structure

```
ltx-youtube-extension/
├── extension/
│   ├── manifest.json    # Chrome extension manifest
│   ├── content.js       # Main extension logic
│   ├── styles.css       # UI styles
│   └── icon*.png        # Extension icons
├── server/
│   ├── index.js                      # Local proxy server
│   ├── package.json
│   └── com.ltx.youtube-server.plist  # macOS LaunchAgent config
└── README.md
```

## How It Works

1. **Extension** runs as a content script on YouTube pages, providing the UI
2. **Local Server** handles:
   - Downloading YouTube audio/video via `yt-dlp`
   - Trimming segments via `ffmpeg`
   - Proxying requests to LTX API (avoiding CORS issues)
   - Saving generated videos to disk
3. **LTX API** generates the AI video content

## Caching

Downloaded YouTube content is cached in `~/.ltx-cache/` to speed up subsequent requests for the same video. Audio and video are cached separately.

To clear the cache:
```bash
rm -rf ~/.ltx-cache/*
```

## Troubleshooting

### "Server not running" error

**If running manually:** Make sure the server is running: `cd server && node index.js`

**If using LaunchAgent:**
```bash
# Check if the service is loaded
launchctl list | grep ltx

# Check logs for errors
tail -50 ~/Library/Logs/ltx-youtube-server.log

# Common fixes:
# 1. Wrong node path - run `which node` and update the plist
# 2. Wrong index.js path - update to match your repo location
# 3. Reload after fixing:
launchctl unload ~/Library/LaunchAgents/com.ltx.youtube-server.plist
launchctl load ~/Library/LaunchAgents/com.ltx.youtube-server.plist
```

### AV1 codec errors
Some YouTube videos use AV1 which may not decode on all systems. The server attempts to download H.264 format, but if you see AV1 errors, try clearing the cache and retrying.

### Videos not saving
1. Check that auto-save is enabled in settings
2. Verify the save folder path is valid
3. Check browser console for errors

## License

MIT
