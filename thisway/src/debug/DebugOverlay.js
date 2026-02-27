/**
 * Debug overlay showing FPS counter and effect timeline graph.
 * Toggle with 'D' key or ?debug URL param.
 * Renders on a Canvas2D element positioned over the demo.
 *
 * Interactive: click/drag progress bar to seek, click play/pause button.
 */
export class DebugOverlay {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.visible = false;
    this.scrollY = 0;

    // FPS tracking
    this.frameTimes = [];
    this.lastFrameTime = 0;

    // Interaction callbacks (set via setCallbacks)
    this.onSeek = null;       // (timeMs) => void
    this.onPlayPause = null;  // () => void
    this.onPause = null;      // () => void
    this.onResume = null;     // () => void
    this.onToggleEffect = null; // (effectEntry) => void

    // Drag state for progress bar scrubbing
    this._dragging = false;
    this._wasPlayingBeforeDrag = false;
    this._lastDragTimeMs = 0;

    // Last known state for hit-testing
    this._duration = 172000;
    this._isPlaying = false;

    // Filter: show only active effects
    this._showActiveOnly = false;

    // Current time for copy-link
    this._currentTimeMs = 0;

    // Reference video overlay
    this._videoOverlay = this._createVideoOverlay();

    // Layout constants (recalculated on render, stored for hit-testing)
    this._progRect = { x: 8, y: 24, w: 100, h: 20 };
    this._playBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    this._filterBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    this._copyBtnRect = { x: 0, y: 0, w: 0, h: 0 };
    this._copyFlash = 0; // timestamp for "Copied!" flash
    this._displayedEffects = []; // last rendered effect list (for label click hit-testing)
    this._rowsY = 0;
    this._rowH = 16;
    this._labelW = 180;

    // Style
    this.canvas.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      width: 100%;
      pointer-events: none;
      z-index: 1000;
    `;
    this.canvas.style.display = 'none';
    document.body.appendChild(this.canvas);

    // Scroll handling
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.scrollY = Math.max(0, this.scrollY + e.deltaY);
    }, { passive: false });

    // Mouse interaction
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    // Track drag globally so releasing outside the overlay still keeps the
    // dropped position and resumes from there.
    document.addEventListener('mousemove', (e) => this._onMouseMove(e));
    document.addEventListener('mouseup', () => this._onMouseUp());

    // Cursor styling
    this._lastPlayheadX = 0;
    this.canvas.addEventListener('mousemove', (e) => {
      if (this._dragging) {
        this.canvas.style.cursor = 'ew-resize';
        return;
      }
      const pos = this._canvasPos(e);
      if (this._hitPlayhead(pos)) {
        this.canvas.style.cursor = 'ew-resize';
      } else if (this._hitTimeline(pos) || this._hitPlayBtn(pos) || this._hitFilterBtn(pos) || this._hitCopyBtn(pos) || this._hitLabel(pos) >= 0) {
        this.canvas.style.cursor = 'pointer';
      } else {
        this.canvas.style.cursor = 'default';
      }
    });

    // Resize
    this._onResize = () => this._resize();
    window.addEventListener('resize', this._onResize);
    this._resize();
  }

  /**
   * Set interaction callbacks.
   * @param {object} callbacks
   * @param {Function} callbacks.onSeek - (timeMs) => void
   * @param {Function} callbacks.onPlayPause - () => void
   */
  setCallbacks({ onSeek, onPlayPause, onPause, onResume, onToggleEffect }) {
    this.onSeek = onSeek;
    this.onPlayPause = onPlayPause;
    this.onPause = onPause;
    this.onResume = onResume;
    this.onToggleEffect = onToggleEffect;
  }

  _canvasPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _hitTimeline(pos) {
    const r = this._progRect;
    // Entire timeline column: from progress bar top to canvas bottom
    return pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y;
  }

  _hitPlayhead(pos) {
    const r = this._progRect;
    // Within 6px of the playhead line, from progress bar top downward
    return pos.y >= r.y && Math.abs(pos.x - this._lastPlayheadX) <= 6;
  }

  _hitPlayBtn(pos) {
    const r = this._playBtnRect;
    return r.w > 0 && pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h;
  }

  _hitFilterBtn(pos) {
    const r = this._filterBtnRect;
    return r.w > 0 && pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h;
  }

  _hitCopyBtn(pos) {
    const r = this._copyBtnRect;
    return r.w > 0 && pos.x >= r.x && pos.x <= r.x + r.w && pos.y >= r.y && pos.y <= r.y + r.h;
  }

  _seekFromX(px) {
    const r = this._progRect;
    const frac = Math.max(0, Math.min(1, (px - r.x) / r.w));
    const timeMs = frac * this._duration;
    this._lastDragTimeMs = timeMs;
    if (this.onSeek) this.onSeek(timeMs);
  }

  _hitLabel(pos) {
    if (pos.x > this._labelW || pos.y < this._rowsY) return -1;
    const row = Math.floor((pos.y - this._rowsY + this.scrollY) / this._rowH);
    if (row >= 0 && row < this._displayedEffects.length) return row;
    return -1;
  }

  _onMouseDown(e) {
    const pos = this._canvasPos(e);
    if (this._hitCopyBtn(pos)) {
      this._copyTimeLink();
    } else if (this._hitTimeline(pos)) {
      this._dragging = true;
      this._wasPlayingBeforeDrag = this._isPlaying;
      // Pause while dragging
      if (this._isPlaying && this.onPause) this.onPause();
      this._seekFromX(pos.x);
    } else if (this._hitFilterBtn(pos)) {
      this._showActiveOnly = !this._showActiveOnly;
      this.scrollY = 0;
    } else if (this._hitPlayBtn(pos)) {
      if (this.onPlayPause) this.onPlayPause();
    } else {
      const row = this._hitLabel(pos);
      if (row >= 0 && this.onToggleEffect) {
        this.onToggleEffect(this._displayedEffects[row]);
      }
    }
  }

  _copyTimeLink() {
    const t = Math.round(this._currentTimeMs);
    const url = new URL(window.location.href);
    url.searchParams.set('t', t);
    url.searchParams.set('debug', '');
    navigator.clipboard.writeText(url.toString()).then(() => {
      this._copyFlash = performance.now();
    }).catch(() => {
      // Fallback: update URL bar without navigation
      window.history.replaceState(null, '', url.toString());
      this._copyFlash = performance.now();
    });
  }

  _onMouseMove(e) {
    if (!this._dragging) return;
    const pos = this._canvasPos(e);
    this._seekFromX(pos.x);
  }

  _onMouseUp() {
    if (this._dragging) {
      this._dragging = false;
      // Resume only if it was playing before the drag.
      // No extra onSeek here — the last mousemove/mousedown already seeked
      // to _lastDragTimeMs. Re-seeking risks using a stale value if the mouse
      // drifted outside the progress bar region.
      if (this._wasPlayingBeforeDrag && this.onResume) this.onResume();
    }
  }

  _createVideoOverlay() {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      width: 320px;
      height: 180px;
      z-index: 1001;
      display: none;
      border: 2px solid #0f0;
      background: #000;
      box-shadow: 0 2px 12px rgba(0,0,0,0.7);
    `;

    const video = document.createElement('video');
    video.src = 'thisway.mp4';
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.style.cssText = 'width: 100%; height: 100%; display: block; object-fit: contain;';
    wrapper.appendChild(video);

    // Resize handle (bottom-right corner)
    const resizeHandle = document.createElement('div');
    resizeHandle.style.cssText = `
      position: absolute;
      bottom: 0;
      right: 0;
      width: 16px;
      height: 16px;
      cursor: nwse-resize;
      background: linear-gradient(135deg, transparent 50%, #0f0 50%);
      opacity: 0.7;
    `;
    wrapper.appendChild(resizeHandle);

    // Close button
    const closeBtn = document.createElement('div');
    closeBtn.textContent = 'x';
    closeBtn.style.cssText = `
      position: absolute;
      top: -1px;
      left: -1px;
      width: 18px;
      height: 18px;
      background: #c00;
      color: #fff;
      font: bold 12px monospace;
      text-align: center;
      line-height: 18px;
      cursor: pointer;
      z-index: 1;
    `;
    wrapper.appendChild(closeBtn);
    closeBtn.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      wrapper.style.display = 'none';
      this._videoVisible = false;
    });

    // Drag to move (from wrapper, excluding resize handle)
    let dragState = null;
    wrapper.addEventListener('mousedown', (e) => {
      if (e.target === resizeHandle || e.target === closeBtn) return;
      e.preventDefault();
      dragState = { type: 'move', startX: e.clientX, startY: e.clientY,
        origLeft: wrapper.offsetLeft, origTop: wrapper.offsetTop };
    });

    resizeHandle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragState = { type: 'resize', startX: e.clientX, startY: e.clientY,
        origW: wrapper.offsetWidth, origH: wrapper.offsetHeight };
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragState) return;
      if (dragState.type === 'move') {
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        wrapper.style.left = `${dragState.origLeft + dx}px`;
        wrapper.style.top = `${dragState.origTop + dy}px`;
        wrapper.style.right = 'auto';
      } else if (dragState.type === 'resize') {
        const dx = e.clientX - dragState.startX;
        const dy = e.clientY - dragState.startY;
        const newW = Math.max(160, dragState.origW + dx);
        const newH = Math.max(90, dragState.origH + dy);
        wrapper.style.width = `${newW}px`;
        wrapper.style.height = `${newH}px`;
      }
    });

    document.addEventListener('mouseup', () => { dragState = null; });

    document.body.appendChild(wrapper);

    this._videoEl = video;
    this._videoWrapper = wrapper;
    this._videoVisible = false;
    this._lastVideoSync = 0;
    return wrapper;
  }

  _syncVideo(timeMs, isPlaying) {
    if (!this._videoEl || !this._videoVisible) return;
    const timeSec = Math.max(0, timeMs / 1000 - 0.13);

    // Only hard-seek if time drifts more than 0.3s (avoid constant seeking)
    if (Math.abs(this._videoEl.currentTime - timeSec) > 0.3) {
      this._videoEl.currentTime = timeSec;
    }

    if (isPlaying && this._videoEl.paused) {
      this._videoEl.play().catch(() => {});
    } else if (!isPlaying && !this._videoEl.paused) {
      this._videoEl.pause();
    }
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = window.innerWidth;
    const h = Math.floor(window.innerHeight * 0.4);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.displayWidth = w;
    this.displayHeight = h;
  }

  toggle() {
    if (this.visible) this.hide();
    else this.show();
  }

  show() {
    this.visible = true;
    this.canvas.style.display = 'block';
    this.canvas.style.pointerEvents = 'auto';
  }

  hide() {
    this.visible = false;
    this.canvas.style.display = 'none';
    this.canvas.style.pointerEvents = 'none';
    this.hideVideo();
  }

  toggleVideo() {
    if (this._videoVisible) this.hideVideo();
    else this.showVideo();
  }

  showVideo() {
    this._videoVisible = true;
    this._videoWrapper.style.display = 'block';
    // Sync immediately
    this._syncVideo(this._currentTimeMs, this._isPlaying);
  }

  hideVideo() {
    this._videoVisible = false;
    this._videoWrapper.style.display = 'none';
    if (this._videoEl && !this._videoEl.paused) this._videoEl.pause();
  }

  /**
   * Call each frame from the main loop.
   * @param {number} timeMs - Current demo time in ms
   * @param {Array} effects - Array of DemoFXEntry objects
   * @param {number} duration - Total demo duration in ms
   * @param {boolean} isPlaying - Whether the demo is currently playing
   */
  update(timeMs, effects, duration, isPlaying) {
    this._duration = duration;
    this._isPlaying = isPlaying;
    this._currentTimeMs = timeMs;

    // Sync reference video (even if timeline panel is hidden, video may be visible)
    this._syncVideo(timeMs, isPlaying);

    if (!this.visible) return;

    // FPS calculation
    const now = performance.now();
    if (this.lastFrameTime > 0) {
      this.frameTimes.push(now - this.lastFrameTime);
      if (this.frameTimes.length > 60) this.frameTimes.shift();
    }
    this.lastFrameTime = now;

    const avgFrameTime = this.frameTimes.length > 0
      ? this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length
      : 16.67;
    const fps = Math.round(1000 / avgFrameTime);

    const ctx = this.ctx;
    const W = this.displayWidth;
    const H = this.displayHeight;

    // Clear
    ctx.clearRect(0, 0, W, H);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.fillRect(0, 0, W, H);

    ctx.font = '12px monospace';
    const HEADER_H = 28;
    const PROGRESS_H = 20;
    const ROW_H = 16;
    const LABEL_W = 180;
    const BAR_X = LABEL_W + 4;
    const BAR_W = W - BAR_X - 8;

    // Sort effects by startTime
    const sorted = [...effects].sort((a, b) => a.startTime - b.startTime);

    // Count active effects
    const activeCount = sorted.filter(e => timeMs >= e.startTime && timeMs <= e.endTime).length;

    // --- Header with play/pause button ---
    const btnSize = 16;
    const btnX = 8;
    const btnY = (HEADER_H - btnSize) / 2;
    this._playBtnRect = { x: btnX, y: btnY, w: btnSize, h: btnSize };

    // Draw play/pause icon
    ctx.fillStyle = '#aaa';
    if (isPlaying) {
      // Pause icon (two bars)
      ctx.fillRect(btnX + 2, btnY + 2, 4, btnSize - 4);
      ctx.fillRect(btnX + 10, btnY + 2, 4, btnSize - 4);
    } else {
      // Play icon (triangle)
      ctx.beginPath();
      ctx.moveTo(btnX + 3, btnY + 2);
      ctx.lineTo(btnX + btnSize - 2, btnY + btnSize / 2);
      ctx.lineTo(btnX + 3, btnY + btnSize - 2);
      ctx.closePath();
      ctx.fill();
    }

    // Header text (offset to right of button)
    ctx.fillStyle = '#aaa';
    const headerText = `FPS: ${fps}  |  ${(timeMs / 1000).toFixed(1)}s / ${(duration / 1000).toFixed(1)}s  |  ${activeCount} active  |  ${sorted.length} total`;
    const headerTextX = btnX + btnSize + 8;
    ctx.fillText(headerText, headerTextX, HEADER_H - 8);

    // Filter toggle button (after header text)
    const filterLabel = this._showActiveOnly ? '[Active]' : '[All]';
    const filterX = headerTextX + ctx.measureText(headerText).width + 12;
    const filterW = ctx.measureText(filterLabel).width + 8;
    const filterH = 16;
    const filterY = (HEADER_H - filterH) / 2;
    this._filterBtnRect = { x: filterX, y: filterY, w: filterW, h: filterH };

    ctx.fillStyle = this._showActiveOnly ? '#0a0' : '#333';
    ctx.fillRect(filterX, filterY, filterW, filterH);
    ctx.fillStyle = this._showActiveOnly ? '#fff' : '#888';
    ctx.fillText(filterLabel, filterX + 4, filterY + filterH - 3);

    // Copy link button
    const isCopied = this._copyFlash > 0 && (now - this._copyFlash) < 1500;
    const copyLabel = isCopied ? 'Copied!' : 'Copy Link';
    const copyX = filterX + filterW + 8;
    const copyW = ctx.measureText(copyLabel).width + 8;
    this._copyBtnRect = { x: copyX, y: filterY, w: copyW, h: filterH };
    ctx.fillStyle = isCopied ? '#070' : '#333';
    ctx.fillRect(copyX, filterY, copyW, filterH);
    ctx.fillStyle = isCopied ? '#0f0' : '#888';
    ctx.fillText(copyLabel, copyX + 4, filterY + filterH - 3);

    // --- Progress bar (aligned with effect bars) ---
    const progY = HEADER_H;
    const progX = BAR_X;
    const progW = BAR_W;
    this._progRect = { x: progX, y: progY, w: progW, h: PROGRESS_H };

    // Track
    ctx.fillStyle = '#222';
    ctx.fillRect(progX, progY, progW, PROGRESS_H);

    // Filled portion
    const progFrac = Math.min(1, timeMs / duration);
    ctx.fillStyle = '#0a0';
    ctx.fillRect(progX, progY, progW * progFrac, PROGRESS_H);

    // Time labels on progress bar
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.fillText('0s', progX + 2, progY + PROGRESS_H - 3);
    const durLabel = `${(duration / 1000).toFixed(0)}s`;
    ctx.fillText(durLabel, progX + progW - ctx.measureText(durLabel).width - 2, progY + PROGRESS_H - 3);
    ctx.font = '12px monospace';

    // --- Effect rows ---
    const rowsY = HEADER_H + PROGRESS_H + 4;
    const displayed = this._showActiveOnly
      ? sorted.filter(e => timeMs >= e.startTime && timeMs <= e.endTime)
      : sorted;
    this._displayedEffects = displayed;
    this._rowsY = rowsY;
    this._rowH = ROW_H;
    this._labelW = LABEL_W;
    const maxScroll = Math.max(0, displayed.length * ROW_H - (H - rowsY));
    this.scrollY = Math.min(this.scrollY, maxScroll);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, rowsY, W, H - rowsY);
    ctx.clip();

    for (let i = 0; i < displayed.length; i++) {
      const e = displayed[i];
      const y = rowsY + i * ROW_H - this.scrollY;

      if (y + ROW_H < rowsY || y > H) continue; // off-screen

      const isActive = timeMs >= e.startTime && timeMs <= e.endTime;
      const isDisabled = !!e.disabled;

      // Label: FX class name (dimmed + strikethrough if disabled)
      ctx.fillStyle = isDisabled ? '#844' : (isActive ? '#0f0' : '#666');
      const fxName = (e.fx && e.fx.name) || e.name;
      ctx.fillText(fxName, 4, y + ROW_H - 3);
      if (isDisabled) {
        const tw = ctx.measureText(fxName).width;
        ctx.strokeStyle = '#844';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(4, y + ROW_H / 2);
        ctx.lineTo(4 + tw, y + ROW_H / 2);
        ctx.stroke();
      }

      // Bar background
      ctx.fillStyle = '#111';
      ctx.fillRect(BAR_X, y + 1, BAR_W, ROW_H - 2);

      // Effect bar (reddish tint if disabled, brighter than normal inactive)
      const x0 = BAR_X + (e.startTime / duration) * BAR_W;
      const x1 = BAR_X + (e.endTime / duration) * BAR_W;
      ctx.fillStyle = isDisabled ? '#533' : (isActive ? '#0c0' : '#334');
      ctx.fillRect(x0, y + 1, Math.max(1, x1 - x0), ROW_H - 2);
    }

    ctx.restore();

    // --- Unified playhead line (progress bar + effect rows) ---
    const phX = BAR_X + progFrac * BAR_W;
    this._lastPlayheadX = phX;
    ctx.strokeStyle = '#f00';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(phX, progY);
    ctx.lineTo(phX, H);
    ctx.stroke();

    // Playhead knob on progress bar
    ctx.beginPath();
    ctx.arc(phX, progY + PROGRESS_H / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#f44';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
