// LTX YouTube Extension - Content Script

const LOCAL_SERVER_URL = 'http://localhost:3847';

let panel = null;
let isGenerating = false;
let serverOnline = false;
let skipHealthCheck = false;
let settings = {
  ltxApiKey: '',
  autoSave: true,
  saveFolder: '~/Documents/ltx-youtube-extension',
};

// Retake state
let retakeVideoDuration = 0;
let retakeMode = 'replace_audio_and_video';

// Load settings from storage
chrome.storage.sync.get(['ltxApiKey', 'autoSave', 'saveFolder'], (result) => {
  if (result.ltxApiKey) settings.ltxApiKey = result.ltxApiKey;
  if (result.autoSave !== undefined) settings.autoSave = result.autoSave;
  if (result.saveFolder) settings.saveFolder = result.saveFolder;
});

// Check server health
async function checkServerHealth() {
  if (skipHealthCheck) return serverOnline;

  try {
    const response = await fetch(`${LOCAL_SERVER_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    serverOnline = response.ok;
  } catch {
    serverOnline = false;
  }
  updateServerStatus();
  return serverOnline;
}

function updateServerStatus() {
  const banner = document.getElementById('ltx-server-banner');
  const generateBtn = document.getElementById('ltx-generate');
  const statusDot = document.getElementById('ltx-server-status');

  if (!banner) return;

  if (serverOnline) {
    banner.style.display = 'none';
    if (generateBtn) generateBtn.disabled = isGenerating;
    if (statusDot) {
      statusDot.className = 'ltx-server-status ltx-server-online';
      statusDot.title = 'Server running';
    }
  } else {
    banner.style.display = 'block';
    if (generateBtn) generateBtn.disabled = true;
    if (statusDot) {
      statusDot.className = 'ltx-server-status ltx-server-offline';
      statusDot.title = 'Server offline';
    }
  }
}

// Check server health periodically
setInterval(checkServerHealth, 5000);

function getVideoId() {
  const url = new URL(window.location.href);
  return url.searchParams.get('v');
}

function getVideoUrl() {
  return `https://www.youtube.com/watch?v=${getVideoId()}`;
}

function getCurrentTime() {
  const video = document.querySelector('video');
  return video ? video.currentTime : 0;
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function parseTime(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] * 3600 + parts[1] * 60 + parts[2];
}

function createPanel() {
  if (panel) return panel;

  panel = document.createElement('div');
  panel.id = 'ltx-panel';
  panel.innerHTML = `
    <div class="ltx-header">
      <span class="ltx-title">LTX Video Generator</span>
        <span class="ltx-server-status" id="ltx-server-status" title="Server status"></span>
      <div class="ltx-header-actions">
        <button class="ltx-settings-btn" id="ltx-settings-btn" title="Settings">⚙️</button>
        <button class="ltx-close" id="ltx-close">×</button>
      </div>
    </div>

    <div id="ltx-settings-panel" class="ltx-settings-panel">
      <div class="ltx-row">
        <label>LTX API Key</label>
        <input type="password" id="ltx-api-key" placeholder="Your LTX API key">
      </div>
      <div class="ltx-row">
        <label>Save Folder</label>
        <input type="text" id="ltx-save-folder" placeholder="~/Documents/ltx-youtube-extension">
      </div>
      <div class="ltx-row ltx-checkbox-row">
        <label class="ltx-checkbox-label">
          <input type="checkbox" id="ltx-auto-save" checked>
          <span>Auto-save generated videos</span>
        </label>
      </div>
      <div class="ltx-row">
        <button id="ltx-save-settings" class="ltx-secondary">Save Settings</button>
      </div>
    </div>

    <div class="ltx-tabs">
      <button class="ltx-tab ltx-tab-active" id="ltx-tab-generate" data-tab="generate">Audio to Video</button>
      <button class="ltx-tab" id="ltx-tab-retake" data-tab="retake">Retake</button>
    </div>

    <div id="ltx-server-banner" class="ltx-server-banner">
      <div class="ltx-server-icon">⚠️</div>
      <div class="ltx-server-text">
        <strong>Server not running</strong>
        <p>Start the local server:</p>
        <code>cd path/to/ltx-youtube-extension/server && node index.js</code>
      </div>
    </div>

    <div class="ltx-tab-content" id="ltx-tab-content-generate">
      <div class="ltx-row ltx-time-section">
        <div class="ltx-time-header">
          <label>Time Range</label>
          <span class="ltx-current-time" id="ltx-current-time">0:00</span>
        </div>
        <div class="ltx-time-range">
          <div class="ltx-time-field">
            <input type="text" id="ltx-start" placeholder="0:00">
            <button id="ltx-set-start" title="Set start to current time (S)">Set</button>
          </div>
          <div class="ltx-time-bar">
            <div class="ltx-time-bar-fill" id="ltx-time-bar-fill"></div>
            <div class="ltx-time-bar-duration" id="ltx-time-bar-duration"></div>
          </div>
          <div class="ltx-time-field">
            <input type="text" id="ltx-end" placeholder="0:20">
            <button id="ltx-set-end" title="Set end to current time (E)">Set</button>
          </div>
        </div>
        <div class="ltx-time-hint" id="ltx-time-hint">Press <kbd>S</kbd> for start, <kbd>E</kbd> for end</div>
      </div>
      <div class="ltx-row">
        <label>Conditioning Image (optional)</label>
        <div class="ltx-image-input">
          <input type="file" id="ltx-image-file" accept="image/*" style="display:none">
          <input type="text" id="ltx-image-url" placeholder="Image URL or drop file">
          <button id="ltx-image-browse">Browse</button>
        </div>
        <div id="ltx-image-preview"></div>
      </div>
      <div class="ltx-row">
        <label>Prompt</label>
        <textarea id="ltx-prompt" placeholder="Describe the video style..."></textarea>
      </div>
      <div class="ltx-row ltx-actions">
        <button id="ltx-generate" class="ltx-primary">Generate Video</button>
        <button id="ltx-preview" class="ltx-secondary">Preview Audio</button>
      </div>
      <div id="ltx-status" class="ltx-status"></div>
      <div id="ltx-progress" class="ltx-progress" style="display:none">
        <div class="ltx-progress-bar" id="ltx-progress-bar"></div>
        <div class="ltx-progress-text" id="ltx-progress-text"></div>
      </div>
      <div id="ltx-result"></div>
    </div>

    <div class="ltx-tab-content ltx-tab-hidden" id="ltx-tab-content-retake">
      <div class="ltx-row ltx-time-section">
        <div class="ltx-time-header">
          <label>Video Range (from YouTube)</label>
          <span class="ltx-current-time" id="ltx-retake-current-time">0:00</span>
        </div>
        <div class="ltx-time-range">
          <div class="ltx-time-field">
            <input type="text" id="ltx-retake-vid-start" placeholder="0:00">
            <button id="ltx-set-retake-start" title="Set start (S)">Set</button>
          </div>
          <div class="ltx-time-bar">
            <div class="ltx-time-bar-fill ltx-valid" id="ltx-retake-vid-bar-fill" style="width:0"></div>
            <div class="ltx-time-bar-duration" id="ltx-retake-vid-duration"></div>
          </div>
          <div class="ltx-time-field">
            <input type="text" id="ltx-retake-vid-end" placeholder="0:20">
            <button id="ltx-set-retake-end" title="Set end (E)">Set</button>
          </div>
        </div>
        <div class="ltx-time-hint" id="ltx-retake-vid-hint">Select 2-20s of video to download</div>
      </div>

      <div class="ltx-row ltx-mask-section">
        <label>Mask Area (section to regenerate)</label>
        <div class="ltx-mask-range">
          <div class="ltx-time-field">
            <input type="text" id="ltx-mask-start" placeholder="0:00">
            <button id="ltx-set-mask-start" title="Set mask start (Shift+S)">Set</button>
          </div>
          <div class="ltx-mask-bar">
            <div class="ltx-mask-bar-bg" id="ltx-mask-bar-bg"></div>
            <div class="ltx-mask-bar-fill" id="ltx-mask-bar-fill"></div>
            <div class="ltx-mask-bar-duration" id="ltx-mask-duration"></div>
          </div>
          <div class="ltx-time-field">
            <input type="text" id="ltx-mask-end" placeholder="0:05">
            <button id="ltx-set-mask-end" title="Set mask end (Shift+E)">Set</button>
          </div>
        </div>
        <div class="ltx-mask-hint" id="ltx-mask-hint">Press <kbd>Shift+S</kbd> / <kbd>Shift+E</kbd> for mask</div>
      </div>

      <div class="ltx-row">
        <label>Mode</label>
        <div class="ltx-mode-buttons">
          <button class="ltx-mode-btn ltx-mode-active" data-mode="replace_audio_and_video">Both</button>
          <button class="ltx-mode-btn" data-mode="replace_video">Video Only</button>
          <button class="ltx-mode-btn" data-mode="replace_audio">Audio Only</button>
        </div>
      </div>
      <div class="ltx-row">
        <label>Prompt</label>
        <textarea id="ltx-retake-prompt" placeholder="Describe what should happen in the masked section..."></textarea>
      </div>
      <div class="ltx-row ltx-actions">
        <button id="ltx-do-retake" class="ltx-primary">Retake</button>
        <button id="ltx-preview-retake" class="ltx-secondary">Preview Range</button>
      </div>
      <div id="ltx-retake-status" class="ltx-status"></div>
      <div id="ltx-retake-progress" class="ltx-progress" style="display:none">
        <div class="ltx-progress-bar" id="ltx-retake-progress-bar"></div>
        <div class="ltx-progress-text" id="ltx-retake-progress-text"></div>
      </div>
      <div id="ltx-retake-result"></div>
    </div>
  `;

  document.body.appendChild(panel);
  setupEventListeners();
  loadSettingsToUI();
  checkServerHealth();
  return panel;
}

function loadSettingsToUI() {
  document.getElementById('ltx-api-key').value = settings.ltxApiKey || '';
  document.getElementById('ltx-save-folder').value = settings.saveFolder || '~/Documents/ltx-youtube-extension';
  document.getElementById('ltx-auto-save').checked = settings.autoSave !== false;
}

function setupEventListeners() {
  // Close button
  document.getElementById('ltx-close').addEventListener('click', () => {
    panel.classList.remove('ltx-visible');
  });

  // Settings toggle
  document.getElementById('ltx-settings-btn').addEventListener('click', () => {
    document.getElementById('ltx-settings-panel').classList.toggle('ltx-visible');
  });

  // Save settings
  document.getElementById('ltx-save-settings').addEventListener('click', () => {
    settings.ltxApiKey = document.getElementById('ltx-api-key').value;
    settings.saveFolder = document.getElementById('ltx-save-folder').value || '~/Documents/ltx-youtube-extension';
    settings.autoSave = document.getElementById('ltx-auto-save').checked;
    chrome.storage.sync.set(settings);
    document.getElementById('ltx-settings-panel').classList.remove('ltx-visible');
    setStatus('Settings saved', 'success');
  });

  // Tab switching
  document.querySelectorAll('.ltx-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.ltx-tab').forEach(t => t.classList.remove('ltx-tab-active'));
      document.querySelectorAll('.ltx-tab-content').forEach(c => c.classList.add('ltx-tab-hidden'));
      tab.classList.add('ltx-tab-active');
      document.getElementById(`ltx-tab-content-${tabName}`).classList.remove('ltx-tab-hidden');
    });
  });

  // Set time buttons
  document.getElementById('ltx-set-start').addEventListener('click', () => {
    document.getElementById('ltx-start').value = formatTime(getCurrentTime());
    updateDuration();
  });

  document.getElementById('ltx-set-end').addEventListener('click', () => {
    document.getElementById('ltx-end').value = formatTime(getCurrentTime());
    updateDuration();
  });

  // Time inputs (debounced)
  const debouncedUpdateDuration = debounce(updateDuration, 150);
  document.getElementById('ltx-start').addEventListener('input', debouncedUpdateDuration);
  document.getElementById('ltx-end').addEventListener('input', debouncedUpdateDuration);

  // Image file input
  const fileInput = document.getElementById('ltx-image-file');
  const urlInput = document.getElementById('ltx-image-url');
  const preview = document.getElementById('ltx-image-preview');

  document.getElementById('ltx-image-browse').addEventListener('click', () => {
    fileInput.click();
  });

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        urlInput.value = e.target.result;
        preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
      };
      reader.readAsDataURL(file);
    }
  });

  urlInput.addEventListener('change', () => {
    const url = urlInput.value;
    if (url && !url.startsWith('data:')) {
      preview.innerHTML = `<img src="${url}" alt="Preview" onerror="this.style.display='none'">`;
    }
  });

  // Drag and drop
  const imageInput = document.querySelector('.ltx-image-input');
  imageInput.addEventListener('dragover', (e) => {
    e.preventDefault();
    imageInput.classList.add('ltx-dragover');
  });
  imageInput.addEventListener('dragleave', () => {
    imageInput.classList.remove('ltx-dragover');
  });
  imageInput.addEventListener('drop', (e) => {
    e.preventDefault();
    imageInput.classList.remove('ltx-dragover');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e) => {
        urlInput.value = e.target.result;
        preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
      };
      reader.readAsDataURL(file);
    }
  });

  // Paste image from clipboard
  document.addEventListener('paste', (e) => {
    if (!panel?.classList.contains('ltx-visible')) return;

    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (e) => {
          urlInput.value = e.target.result;
          preview.innerHTML = `<img src="${e.target.result}" alt="Preview">`;
        };
        reader.readAsDataURL(file);
        break;
      }
    }
  });

  // Preview audio button
  document.getElementById('ltx-preview').addEventListener('click', previewAudio);

  // Generate button
  document.getElementById('ltx-generate').addEventListener('click', generateVideo);

  // === Retake tab event listeners ===

  // Retake video range buttons
  document.getElementById('ltx-set-retake-start').addEventListener('click', () => {
    document.getElementById('ltx-retake-vid-start').value = formatTime(getCurrentTime());
    updateRetakeVideoDuration();
  });

  document.getElementById('ltx-set-retake-end').addEventListener('click', () => {
    document.getElementById('ltx-retake-vid-end').value = formatTime(getCurrentTime());
    updateRetakeVideoDuration();
  });

  // Video range inputs (debounced)
  const debouncedUpdateRetakeVideo = debounce(updateRetakeVideoDuration, 150);
  document.getElementById('ltx-retake-vid-start').addEventListener('input', debouncedUpdateRetakeVideo);
  document.getElementById('ltx-retake-vid-end').addEventListener('input', debouncedUpdateRetakeVideo);

  // Mask Set buttons
  document.getElementById('ltx-set-mask-start').addEventListener('click', () => {
    document.getElementById('ltx-mask-start').value = formatTime(getCurrentTime());
    updateMaskRange();
  });

  document.getElementById('ltx-set-mask-end').addEventListener('click', () => {
    document.getElementById('ltx-mask-end').value = formatTime(getCurrentTime());
    updateMaskRange();
  });

  // Mask inputs (debounced)
  const debouncedUpdateMask = debounce(updateMaskRange, 150);
  document.getElementById('ltx-mask-start').addEventListener('input', debouncedUpdateMask);
  document.getElementById('ltx-mask-end').addEventListener('input', debouncedUpdateMask);

  // Mode buttons
  document.querySelectorAll('.ltx-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ltx-mode-btn').forEach(b => b.classList.remove('ltx-mode-active'));
      btn.classList.add('ltx-mode-active');
      retakeMode = btn.dataset.mode;
    });
  });

  // Preview retake range
  document.getElementById('ltx-preview-retake').addEventListener('click', () => {
    const startTime = parseTime(document.getElementById('ltx-retake-vid-start').value);
    const endTime = parseTime(document.getElementById('ltx-retake-vid-end').value);
    const video = document.querySelector('video');
    if (video) {
      video.currentTime = startTime;
      video.play();
      setTimeout(() => video.pause(), (endTime - startTime) * 1000);
    }
  });

  // Retake button
  document.getElementById('ltx-do-retake').addEventListener('click', doRetake);
}

function updateDuration() {
  const start = parseTime(document.getElementById('ltx-start').value);
  const end = parseTime(document.getElementById('ltx-end').value);
  const duration = end - start;
  const barDuration = document.getElementById('ltx-time-bar-duration');
  const barFill = document.getElementById('ltx-time-bar-fill');
  const hint = document.getElementById('ltx-time-hint');

  if (duration > 0) {
    barDuration.textContent = `${duration.toFixed(1)}s`;

    // Visual feedback for valid/invalid duration
    if (duration < 2 || duration > 22) {
      barFill.className = 'ltx-time-bar-fill ltx-invalid';
      hint.textContent = duration < 2 ? 'Too short (min 2s)' : 'Too long (max 22s)';
      hint.className = 'ltx-time-hint ltx-warning';
    } else {
      barFill.className = 'ltx-time-bar-fill ltx-valid';
      hint.innerHTML = 'Press <kbd>S</kbd> for start, <kbd>E</kbd> for end';
      hint.className = 'ltx-time-hint';
    }

    // Animate bar width based on duration (max at 22s)
    const pct = Math.min(100, (duration / 22) * 100);
    barFill.style.width = `${pct}%`;
  } else {
    barDuration.textContent = '';
    barFill.style.width = '0%';
    hint.innerHTML = 'Press <kbd>S</kbd> for start, <kbd>E</kbd> for end';
    hint.className = 'ltx-time-hint';
  }
}

// Debounce helper
function debounce(fn, delay = 100) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Live current time display
let lastTimeText = '';
function updateCurrentTimeDisplay() {
  const currentTime = formatTime(getCurrentTime());
  if (currentTime === lastTimeText) return; // Skip if unchanged
  lastTimeText = currentTime;

  const generateEl = document.getElementById('ltx-current-time');
  const retakeEl = document.getElementById('ltx-retake-current-time');

  if (generateEl) generateEl.textContent = currentTime;
  if (retakeEl) retakeEl.textContent = currentTime;
}

// Update current time every 250ms when panel is open
setInterval(() => {
  if (panel?.classList.contains('ltx-visible')) {
    updateCurrentTimeDisplay();
  }
}, 250);

function previewAudio() {
  const startTime = parseTime(document.getElementById('ltx-start').value);
  const endTime = parseTime(document.getElementById('ltx-end').value);

  const video = document.querySelector('video');
  if (video) {
    video.currentTime = startTime;
    video.play();
    setTimeout(() => {
      video.pause();
    }, (endTime - startTime) * 1000);
  }
}

function setStatus(message, type = 'info') {
  const status = document.getElementById('ltx-status');
  status.textContent = message;
  status.className = `ltx-status ltx-status-${type}`;
}

function setProgress(percent, text) {
  const progressEl = document.getElementById('ltx-progress');
  const barEl = document.getElementById('ltx-progress-bar');
  const textEl = document.getElementById('ltx-progress-text');

  if (percent === null) {
    progressEl.style.display = 'none';
  } else {
    progressEl.style.display = 'block';
    barEl.style.width = `${percent}%`;
    textEl.textContent = text || `${percent}%`;
  }
}

// === Retake functions ===

function setRetakeStatus(message, type = 'info') {
  const status = document.getElementById('ltx-retake-status');
  status.textContent = message;
  status.className = `ltx-status ltx-status-${type}`;
}

function setRetakeProgress(percent, text) {
  const progressEl = document.getElementById('ltx-retake-progress');
  const barEl = document.getElementById('ltx-retake-progress-bar');
  const textEl = document.getElementById('ltx-retake-progress-text');

  if (percent === null) {
    progressEl.style.display = 'none';
  } else {
    progressEl.style.display = 'block';
    barEl.style.width = `${percent}%`;
    textEl.textContent = text || `${percent}%`;
  }
}

function updateRetakeVideoDuration() {
  const start = parseTime(document.getElementById('ltx-retake-vid-start').value);
  const end = parseTime(document.getElementById('ltx-retake-vid-end').value);
  const duration = end - start;
  const barDuration = document.getElementById('ltx-retake-vid-duration');
  const barFill = document.getElementById('ltx-retake-vid-bar-fill');
  const hint = document.getElementById('ltx-retake-vid-hint');

  retakeVideoDuration = duration > 0 ? duration : 0;

  if (duration > 0) {
    barDuration.textContent = `${duration.toFixed(1)}s`;

    // Valid duration for retake is 2-21s (API limit)
    if (duration < 2 || duration > 21) {
      barFill.className = 'ltx-time-bar-fill ltx-invalid';
      hint.textContent = duration < 2 ? 'Too short (min 2s)' : 'Too long (max 21s)';
      hint.className = 'ltx-time-hint ltx-warning';
    } else {
      barFill.className = 'ltx-time-bar-fill ltx-valid';
      hint.textContent = `Video range: ${formatTime(start)} - ${formatTime(end)}`;
      hint.className = 'ltx-time-hint';
    }

    // Bar width based on duration (max at 21s)
    const pct = Math.min(100, (duration / 21) * 100);
    barFill.style.width = `${pct}%`;
  } else {
    barDuration.textContent = '';
    barFill.style.width = '0%';
    hint.textContent = 'Select 2-21s of video to download';
    hint.className = 'ltx-time-hint';
  }

  // Update mask range when video duration changes
  updateMaskRange();
}

function updateMaskRange() {
  const vidStart = parseTime(document.getElementById('ltx-retake-vid-start').value);
  const vidEnd = parseTime(document.getElementById('ltx-retake-vid-end').value);
  const maskStart = parseTime(document.getElementById('ltx-mask-start').value);
  const maskEnd = parseTime(document.getElementById('ltx-mask-end').value);

  const maskDuration = maskEnd - maskStart;
  const barFill = document.getElementById('ltx-mask-bar-fill');
  const durationText = document.getElementById('ltx-mask-duration');
  const hint = document.getElementById('ltx-mask-hint');

  if (maskDuration > 0 && retakeVideoDuration > 0) {
    durationText.textContent = `${maskDuration.toFixed(1)}s`;

    const isValidDuration = maskDuration >= 2 && maskDuration <= 16;
    const isWithinVideo = maskStart >= vidStart && maskEnd <= vidEnd;

    if (!isValidDuration) {
      barFill.className = 'ltx-mask-bar-fill ltx-invalid';
      hint.textContent = maskDuration < 2 ? 'Min mask duration is 2s' : 'Max mask duration is 16s';
      hint.className = 'ltx-mask-hint ltx-warning';
    } else if (!isWithinVideo) {
      barFill.className = 'ltx-mask-bar-fill ltx-invalid';
      hint.textContent = `Mask must be within video range (${formatTime(vidStart)} - ${formatTime(vidEnd)})`;
      hint.className = 'ltx-mask-hint ltx-warning';
    } else {
      barFill.className = 'ltx-mask-bar-fill ltx-valid';
      hint.innerHTML = `Regenerating ${formatTime(maskStart)} - ${formatTime(maskEnd)} <kbd>Shift+S</kbd>/<kbd>Shift+E</kbd>`;
      hint.className = 'ltx-mask-hint';
    }

    // Position the mask bar relative to the video range
    if (retakeVideoDuration > 0) {
      const relativeStart = maskStart - vidStart;
      const leftPct = (relativeStart / retakeVideoDuration) * 100;
      const widthPct = (maskDuration / retakeVideoDuration) * 100;
      barFill.style.left = `${Math.max(0, leftPct)}%`;
      barFill.style.width = `${Math.min(widthPct, 100 - Math.max(0, leftPct))}%`;
    }
  } else {
    durationText.textContent = '';
    barFill.style.width = '0%';
    barFill.style.left = '0%';
    hint.innerHTML = 'Press <kbd>Shift+S</kbd> / <kbd>Shift+E</kbd> for mask';
    hint.className = 'ltx-mask-hint';
  }
}

async function doRetake() {
  if (isGenerating) return;

  if (!settings.ltxApiKey) {
    setRetakeStatus('Please set your LTX API key in settings', 'error');
    return;
  }

  const videoId = getVideoId();
  const vidStart = parseTime(document.getElementById('ltx-retake-vid-start').value);
  const vidEnd = parseTime(document.getElementById('ltx-retake-vid-end').value);
  const vidDuration = vidEnd - vidStart;

  const maskStartGlobal = parseTime(document.getElementById('ltx-mask-start').value);
  const maskEndGlobal = parseTime(document.getElementById('ltx-mask-end').value);
  const maskDuration = maskEndGlobal - maskStartGlobal;
  // Calculate relative offset within the downloaded video segment
  const maskStartRelative = maskStartGlobal - vidStart;
  const prompt = document.getElementById('ltx-retake-prompt').value;

  // Video range validation
  if (vidDuration < 2 || vidDuration > 21) {
    setRetakeStatus('Video range must be 2-21 seconds', 'error');
    return;
  }

  // Mask validation
  if (maskDuration < 2 || maskDuration > 16) {
    setRetakeStatus('Mask duration must be 2-16 seconds', 'error');
    return;
  }
  if (maskStartGlobal < vidStart || maskEndGlobal > vidEnd) {
    setRetakeStatus('Mask must be within video range', 'error');
    return;
  }

  isGenerating = true;
  skipHealthCheck = true;
  document.getElementById('ltx-do-retake').disabled = true;

  try {
    // 1. Download video from YouTube
    setRetakeStatus('Downloading video from YouTube...', 'info');
    setRetakeProgress(10, 'Downloading video...');

    const videoResponse = await fetch(`${LOCAL_SERVER_URL}/video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, startTime: vidStart, endTime: vidEnd }),
    });

    if (!videoResponse.ok) {
      const err = await videoResponse.json().catch(() => ({}));
      throw new Error(err.error || `Server error: ${videoResponse.status}`);
    }

    setRetakeProgress(40, 'Processing video...');
    const videoData = await videoResponse.json();
    const videoDataUri = videoData.video; // data:video/mp4;base64,...

    setRetakeProgress(50, 'Calling LTX Retake API...');

    // 2. Call retake API
    const body = {
      apiKey: settings.ltxApiKey,
      video_uri: videoDataUri,
      start_time: maskStartRelative,
      duration: maskDuration,
      mode: retakeMode,
    };

    if (prompt) {
      body.prompt = prompt;
    }

    const response = await fetch(`${LOCAL_SERVER_URL}/retake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Retake API error: ${response.status} - ${error}`);
    }

    setRetakeProgress(90, 'Receiving video...');

    const videoBlob = await response.blob();
    const videoUrl = URL.createObjectURL(videoBlob);

    setRetakeProgress(100, 'Saving...');
    await showRetakeResult(videoUrl, videoBlob);

  } catch (error) {
    console.error('Retake error:', error);
    setRetakeStatus(`Error: ${error.message}`, 'error');
    setRetakeProgress(null);
  } finally {
    isGenerating = false;
    skipHealthCheck = false;
    document.getElementById('ltx-do-retake').disabled = false;
  }
}

async function saveVideoToFolder(videoBlob, prefix = 'ltx-video') {
  if (!settings.autoSave) return null;

  try {
    // Convert blob to base64
    const reader = new FileReader();
    const base64 = await new Promise((resolve, reject) => {
      reader.onload = () => {
        const dataUrl = reader.result;
        // Remove the data:video/mp4;base64, prefix
        resolve(dataUrl.split(',')[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(videoBlob);
    });

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${prefix}_${timestamp}.mp4`;

    const response = await fetch(`${LOCAL_SERVER_URL}/save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoBase64: base64,
        folder: settings.saveFolder,
        filename: filename,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Save failed');
    }

    const result = await response.json();
    return result.path;
  } catch (err) {
    console.error('Auto-save error:', err.message);
    return null;
  }
}

async function showRetakeResult(videoUrl, videoBlob) {
  setRetakeStatus('Retake complete!', 'success');
  setRetakeProgress(null);

  // Auto-save if enabled
  const savedPath = await saveVideoToFolder(videoBlob, 'ltx-retake');

  const result = document.getElementById('ltx-retake-result');
  result.innerHTML = `
    <video controls autoplay src="${videoUrl}"></video>
    <div class="ltx-result-actions">
      <a href="${videoUrl}" download="ltx-retake.mp4" class="ltx-download ltx-download-primary">⬇ Download</a>
      <button id="ltx-retake-again">Retake Again</button>
    </div>
    ${savedPath
      ? `<div class="ltx-result-saved">Saved to ${savedPath}</div>`
      : (settings.autoSave ? '<div class="ltx-result-warning">Auto-save failed - download manually</div>' : '<div class="ltx-result-warning">Auto-save disabled - download to keep</div>')}
  `;

  // Scroll result into view
  result.scrollIntoView({ behavior: 'smooth', block: 'end' });

  document.getElementById('ltx-retake-again').addEventListener('click', () => {
    result.innerHTML = '';
    setRetakeStatus('', 'info');
    doRetake();
  });
}

// Fetch audio from local server
async function fetchAudioFromServer(videoId, startTime, endTime) {
  setStatus('Extracting audio (this may take a moment)...', 'info');
  setProgress(10, 'Downloading from YouTube...');

  try {
    // No timeout - yt-dlp can take a while
    const response = await fetch(`${LOCAL_SERVER_URL}/audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ videoId, startTime, endTime }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Server error: ${response.status}`);
    }

    setProgress(40, 'Processing audio...');
    const data = await response.json();
    setProgress(50, 'Audio extracted');

    return data.audio; // Already a data URI
  } catch (err) {
    console.error('Fetch error details:', err);
    if (err.message === 'Failed to fetch') {
      throw new Error('Failed to connect to server. Check console for details.');
    }
    throw err;
  }
}

// Call LTX API via local proxy
async function callLtxApi(audioDataUri, imageUrl, prompt) {
  setStatus('Calling LTX API...', 'info');
  setProgress(60, 'Generating video...');

  const body = {
    apiKey: settings.ltxApiKey,
    audio_uri: audioDataUri,
    model: 'ltx-2-pro',
    resolution: '1920x1080',
  };

  if (imageUrl) {
    body.image_uri = imageUrl;
  }
  if (prompt) {
    body.prompt = prompt;
  }

  const response = await fetch(`${LOCAL_SERVER_URL}/ltx`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LTX API error: ${response.status} - ${error}`);
  }

  setProgress(95, 'Receiving video...');

  // Response is video binary
  const videoBlob = await response.blob();
  return videoBlob;
}

async function generateVideo() {
  if (isGenerating) return;

  // Validate settings
  if (!settings.ltxApiKey) {
    setStatus('Please set your LTX API key in settings', 'error');
    return;
  }

  const videoId = getVideoId();
  const startTime = parseTime(document.getElementById('ltx-start').value);
  const endTime = parseTime(document.getElementById('ltx-end').value);
  const imageUrl = document.getElementById('ltx-image-url').value;
  const prompt = document.getElementById('ltx-prompt').value;

  // Validation
  const duration = endTime - startTime;
  if (duration < 2) {
    setStatus('Segment must be at least 2 seconds', 'error');
    return;
  }
  if (duration > 22) {
    setStatus('Segment must be 22 seconds or less', 'error');
    return;
  }
  if (!imageUrl && !prompt) {
    setStatus('Provide an image or prompt', 'error');
    return;
  }

  isGenerating = true;
  skipHealthCheck = true;
  document.getElementById('ltx-generate').disabled = true;

  try {
    // 1. Fetch and trim audio from local server
    const audioDataUri = await fetchAudioFromServer(videoId, startTime, endTime);

    // 2. Call LTX API
    const videoBlob = await callLtxApi(audioDataUri, imageUrl, prompt);
    const resultVideoUrl = URL.createObjectURL(videoBlob);

    // 3. Show result
    setProgress(100, 'Saving...');
    await showResult(resultVideoUrl, videoBlob);

  } catch (error) {
    console.error('Generation error:', error);
    setStatus(`Error: ${error.message}`, 'error');
    setProgress(null);
  } finally {
    isGenerating = false;
    skipHealthCheck = false;
    document.getElementById('ltx-generate').disabled = false;
  }
}

async function showResult(videoUrl, videoBlob) {
  setStatus('Video generated!', 'success');
  setProgress(null);

  // Auto-save if enabled
  const savedPath = await saveVideoToFolder(videoBlob, 'ltx-audio2video');

  const result = document.getElementById('ltx-result');
  result.innerHTML = `
    <video controls autoplay src="${videoUrl}"></video>
    <div class="ltx-result-actions">
      <a href="${videoUrl}" download="ltx-video.mp4" class="ltx-download ltx-download-primary">⬇ Download</a>
      <button id="ltx-regenerate">Regenerate</button>
    </div>
    ${savedPath
      ? `<div class="ltx-result-saved">Saved to ${savedPath}</div>`
      : (settings.autoSave ? '<div class="ltx-result-warning">Auto-save failed - download manually</div>' : '<div class="ltx-result-warning">Auto-save disabled - download to keep</div>')}
  `;

  // Scroll result into view
  result.scrollIntoView({ behavior: 'smooth', block: 'end' });

  document.getElementById('ltx-regenerate').addEventListener('click', () => {
    result.innerHTML = '';
    setStatus('', 'info');
    generateVideo();
  });
}

// Create toggle button
function createToggleButton() {
  const btn = document.createElement('button');
  btn.id = 'ltx-toggle';
  btn.innerHTML = '🎬';
  btn.title = 'LTX Video Generator (Alt+L)';
  btn.addEventListener('click', () => {
    createPanel();
    panel.classList.toggle('ltx-visible');
  });
  document.body.appendChild(btn);
}

// Initialize
createToggleButton();

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  // Alt+L to toggle panel
  if (e.altKey && e.key === 'l') {
    createPanel();
    panel.classList.toggle('ltx-visible');
    return;
  }

  // Only handle shortcuts when panel is visible and not typing in an input
  if (!panel?.classList.contains('ltx-visible')) return;
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // Check which tab is active
  const isRetakeTab = document.getElementById('ltx-tab-content-retake')?.classList.contains('ltx-tab-hidden') === false;

  // Shift+S/E for mask selection (retake tab only)
  if (e.shiftKey && isRetakeTab) {
    if (e.key === 'S') {
      e.preventDefault();
      document.getElementById('ltx-mask-start').value = formatTime(getCurrentTime());
      updateMaskRange();
      return;
    } else if (e.key === 'E') {
      e.preventDefault();
      document.getElementById('ltx-mask-end').value = formatTime(getCurrentTime());
      updateMaskRange();
      return;
    }
  }

  // S/E for time range selection
  if (e.key === 's' || e.key === 'S') {
    e.preventDefault();
    if (isRetakeTab) {
      document.getElementById('ltx-retake-vid-start').value = formatTime(getCurrentTime());
      updateRetakeVideoDuration();
    } else {
      document.getElementById('ltx-start').value = formatTime(getCurrentTime());
      updateDuration();
    }
  } else if (e.key === 'e' || e.key === 'E') {
    e.preventDefault();
    if (isRetakeTab) {
      document.getElementById('ltx-retake-vid-end').value = formatTime(getCurrentTime());
      updateRetakeVideoDuration();
    } else {
      document.getElementById('ltx-end').value = formatTime(getCurrentTime());
      updateDuration();
    }
  }
});
