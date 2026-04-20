// ─────────────────────────────────────────────
//  YTImport — main.js
//  Open DevTools (F12 → Console) to follow the
//  full execution flow as the tool runs.
// ─────────────────────────────────────────────

let selectedTheme = 'dark';
let generatedHTML = '';

console.log('%c[YTImport] main.js loaded', 'color:#e8ff47;font-weight:bold');

// ── THEME SELECTION ──────────────────────────

function selectTheme(btn) {
  const previous = selectedTheme;
  selectedTheme = btn.dataset.theme;
  console.log(`[theme] changed: "${previous}" → "${selectedTheme}"`);
  document.querySelectorAll('.option-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// ── UI HELPERS ───────────────────────────────

function addStatus(msg, state = 'spin') {
  const area = document.getElementById('status-area');
  area.style.display = 'block';
  const line = document.createElement('div');
  line.className = 'status-line';
  const dot = document.createElement('div');
  dot.className = `status-dot ${state}`;
  line.appendChild(dot);
  line.appendChild(document.createTextNode(msg));
  area.appendChild(line);
  return dot;
}

function setStatus(dot, state) {
  dot.className = `status-dot ${state}`;
}

function showError(msg) {
  console.error('[error]', msg);
  const box = document.getElementById('error-box');
  box.textContent = '⚠ ' + msg;
  box.style.display = 'block';
}

// ── STEP 1: EXTRACT PLAYLIST ID ──────────────

function extractPlaylistId(rawUrl) {
  console.group('[step 1] extractPlaylistId');
  console.log('raw input:', rawUrl);

  const url = rawUrl.trim().replace(/\s+/g, '');
  console.log('cleaned input:', url);

  // Method A: URL API
  try {
    const u = new URL(url.startsWith('http') ? url : 'https://' + url);
    const list = u.searchParams.get('list');
    if (list && list.length > 5) {
      console.log('method: URL API → found:', list);
      console.groupEnd();
      return list;
    }
    console.log('method: URL API → no list param, trying regex fallback');
  } catch (e) {
    console.warn('method: URL API → parse failed:', e.message, '— falling back to regex');
  }

  // Method B: regex
  const m = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
  if (m && m[1].length > 5) {
    console.log('method: regex → found:', m[1]);
    console.groupEnd();
    return m[1];
  }

  // Method C: bare playlist ID
  const bare = url.match(/\b(PL[A-Za-z0-9_-]{16,}|UU[A-Za-z0-9_-]{16,}|FL[A-Za-z0-9_-]{16,}|RD[A-Za-z0-9_-]{10,})\b/);
  if (bare) {
    console.log('method: bare ID match → found:', bare[1]);
    console.groupEnd();
    return bare[1];
  }

  console.warn('all methods failed — no playlist ID found');
  console.groupEnd();
  return null;
}

// ── STEP 2: FETCH VIDEOS FROM API ────────────

async function fetchAllVideos(playlistId, apiKey) {
  console.group('[step 2] fetchAllVideos');
  console.log('playlistId:', playlistId);
  console.log('apiKey:', apiKey ? apiKey.slice(0, 6) + '••••••••' : '(empty)');

  const videos = [];
  let pageToken = '';
  let playlistTitle = '';
  let page = 0;

  console.time('fetch-all-pages');

  do {
    page++;
    const pageParam = pageToken ? `&pageToken=${pageToken}` : '';
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${playlistId}${pageParam}&key=${apiKey}`;

    console.group(`  page ${page}${pageToken ? ' (token: ' + pageToken.slice(0, 12) + '...)' : ''}`);
    console.log('  fetching:', url.replace(apiKey, apiKey.slice(0, 6) + '••••'));

    const res = await fetch(url);
    console.log('  HTTP status:', res.status, res.statusText);

    const data = await res.json();

    if (data.error) {
      console.error('  API error:', data.error.code, data.error.message);
      console.groupEnd();
      console.groupEnd();
      throw new Error(data.error.message);
    }

    const itemCount = data.items ? data.items.length : 0;
    console.log('  items on this page:', itemCount);
    console.log('  nextPageToken:', data.nextPageToken || '(none — last page)');

    if (!playlistTitle && itemCount > 0) {
      playlistTitle = data.items[0].snippet.channelTitle || 'Course';
      console.log('  channel title (fallback):', playlistTitle);
    }

    let skipped = 0;
    for (const item of (data.items || [])) {
      const s = item.snippet;
      if (s.resourceId && s.resourceId.videoId && s.title !== 'Deleted video' && s.title !== 'Private video') {
        videos.push({
          videoId: s.resourceId.videoId,
          title: s.title,
          description: (s.description || '').slice(0, 200),
          thumbnail: (s.thumbnails && s.thumbnails.medium && s.thumbnails.medium.url) ||
                     (s.thumbnails && s.thumbnails.default && s.thumbnails.default.url) || '',
          position: s.position
        });
      } else {
        skipped++;
        console.warn('  skipped item:', s.title, '(deleted or private)');
      }
    }

    if (skipped > 0) console.warn('  skipped', skipped, 'deleted/private video(s)');
    console.log('  running total:', videos.length, 'valid videos');
    console.groupEnd();

    pageToken = data.nextPageToken || '';
  } while (pageToken);

  console.timeEnd('fetch-all-pages');
  console.log('total pages fetched:', page);
  console.log('total valid videos:', videos.length);
  console.log('video list:', videos.map(v => '[' + v.position + '] ' + v.title));
  console.groupEnd();

  return { videos, playlistTitle };
}

// ── STEP 3: FETCH PLAYLIST TITLE ─────────────

async function fetchPlaylistTitle(playlistId, apiKey) {
  console.group('[step 3] fetchPlaylistTitle');
  console.log('fetching official title for playlist:', playlistId);

  const url = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${apiKey}`;
  const res = await fetch(url);
  const data = await res.json();
  const title = (data.items && data.items[0] && data.items[0].snippet && data.items[0].snippet.title) || '';

  console.log('resolved title:', title || '(not found)');
  console.groupEnd();
  return title;
}

// ── STEP 4: BUILD COURSE HTML ─────────────────

function buildCourseHTML(videos, courseTitle, theme, playlistId) {
  console.group('[step 4] buildCourseHTML');
  console.log('course title:', courseTitle);
  console.log('theme:', theme);
  console.log('video count:', videos.length);
  console.log('playlistId:', playlistId);
  console.time('build-html');

  const themes = {
    dark: {
      bg: '#0f0f0f', sidebar: '#111111', surface: '#1a1a1a',
      border: '#242424', text: '#e8e8e8', muted: '#666',
      accent: '#3b82f6', accentHover: '#2563eb',
      active: 'rgba(59,130,246,0.12)', activeText: '#93c5fd',
      headerBg: '#111111', scrollbar: '#2a2a2a',
      checkBg: '#14532d', checkText: '#4ade80',
      playerChrome: '#181818', progressTrack: '#333'
    },
    light: {
      bg: '#f0f2f5', sidebar: '#ffffff', surface: '#ffffff',
      border: '#e2e5ea', text: '#111827', muted: '#6b7280',
      accent: '#2563eb', accentHover: '#1d4ed8',
      active: '#dbeafe', activeText: '#1e40af',
      headerBg: '#ffffff', scrollbar: '#d1d5db',
      checkBg: '#dcfce7', checkText: '#15803d',
      playerChrome: '#1a1a1a', progressTrack: '#444'
    },
    minimal: {
      bg: '#f9f9f9', sidebar: '#ffffff', surface: '#ffffff',
      border: '#ebebeb', text: '#1a1a1a', muted: '#aaa',
      accent: '#1a1a1a', accentHover: '#333',
      active: '#f3f4f6', activeText: '#111',
      headerBg: '#ffffff', scrollbar: '#e0e0e0',
      checkBg: '#f0fdf4', checkText: '#15803d',
      playerChrome: '#111111', progressTrack: '#555'
    }
  };

  const t = themes[theme] || themes.dark;
  if (!themes[theme]) console.warn('unknown theme "%s", falling back to dark', theme);

  const escapedTitle = courseTitle.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const videoCount = videos.length;
  const firstVideoId = videos[0] ? videos[0].videoId : '';
  const firstTitle = (videos[0] ? videos[0].title : '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lessonItems = videos.map((v, i) => `
    <div class="lesson-item${i === 0 ? ' active' : ''}" id="item-${i}" onclick="loadLesson(${i})">
      <div class="lesson-left">
        <div class="lesson-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="lesson-thumb">
          <img src="${v.thumbnail}" alt="" loading="lazy" onerror="this.style.display='none'">
          <div class="play-overlay">&#9654;</div>
        </div>
      </div>
      <div class="lesson-info">
        <div class="lesson-title">${v.title.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      </div>
      <div class="lesson-check" id="check-${i}">&#10003;</div>
    </div>`).join('');

  const videoData = JSON.stringify(videos.map(v => ({ videoId: v.videoId, title: v.title })));

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapedTitle}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: ${t.bg};
    --sidebar: ${t.sidebar};
    --border: ${t.border};
    --text: ${t.text};
    --muted: ${t.muted};
    --accent: ${t.accent};
    --accent-h: ${t.accentHover};
    --active: ${t.active};
    --active-text: ${t.activeText};
    --header-bg: ${t.headerBg};
    --scrollbar: ${t.scrollbar};
    --check-bg: ${t.checkBg};
    --check-text: ${t.checkText};
    --player-chrome: ${t.playerChrome};
    --progress-track: ${t.progressTrack};
  }

  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: 'Inter', sans-serif; overflow: hidden; }

  /* ── HEADER ── */
  .course-header {
    height: 52px; background: var(--header-bg);
    border-bottom: 1px solid var(--border);
    display: flex; align-items: center; justify-content: space-between;
    padding: 0 20px; gap: 16px; flex-shrink: 0; z-index: 10; position: relative;
  }
  .header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .menu-toggle {
    background: none; border: none; color: var(--text); cursor: pointer;
    padding: 4px; flex-shrink: 0; display: flex; align-items: center;
  }
  .course-title { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .progress-wrap { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .progress-bar-bg { width: 100px; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .progress-bar-fill { height: 100%; background: var(--accent); border-radius: 2px; transition: width 0.4s ease; width: 0%; }
  .progress-text { font-size: 11px; color: var(--muted); white-space: nowrap; }
  .reset-btn {
    font-size: 11px; color: var(--muted); background: none;
    border: 1px solid var(--border); padding: 3px 10px; border-radius: 5px;
    cursor: pointer; font-family: inherit; transition: all 0.15s;
  }
  .reset-btn:hover { border-color: var(--accent); color: var(--accent); }

  /* ── LAYOUT: sidebar LEFT, player RIGHT ── */
  .course-body {
    display: flex; flex-direction: row;
    height: calc(100vh - 52px); overflow: hidden;
  }

  /* ── LEFT SIDEBAR ── */
  .sidebar {
    width: 320px; flex-shrink: 0; background: var(--sidebar);
    border-right: 1px solid var(--border);
    display: flex; flex-direction: column; overflow: hidden;
    transition: width 0.25s ease, opacity 0.25s ease;
  }
  .sidebar.collapsed { width: 0; opacity: 0; pointer-events: none; }
  .sidebar-head { padding: 14px 14px 10px; border-bottom: 1px solid var(--border); flex-shrink: 0; }
  .sidebar-head-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
  .sidebar-label { font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted); }
  .lesson-count { font-size: 11px; color: var(--muted); }
  .sidebar-search {
    width: 100%; background: var(--bg); border: 1px solid var(--border);
    border-radius: 6px; padding: 7px 11px; color: var(--text);
    font-size: 12px; font-family: inherit; outline: none; transition: border-color 0.15s;
  }
  .sidebar-search:focus { border-color: var(--accent); }
  .sidebar-search::placeholder { color: var(--muted); }
  .lesson-list { overflow-y: auto; flex: 1; padding: 6px; }
  .lesson-list::-webkit-scrollbar { width: 3px; }
  .lesson-list::-webkit-scrollbar-track { background: transparent; }
  .lesson-list::-webkit-scrollbar-thumb { background: var(--scrollbar); border-radius: 2px; }

  /* ── LESSON ITEMS ── */
  .lesson-item {
    display: flex; align-items: center; gap: 9px; padding: 8px;
    border-radius: 7px; cursor: pointer; transition: background 0.1s; margin-bottom: 1px;
  }
  .lesson-item:hover { background: var(--active); }
  .lesson-item.active { background: var(--active); }
  .lesson-item.hidden { display: none; }
  .lesson-left { display: flex; align-items: center; gap: 7px; flex-shrink: 0; }
  .lesson-num { font-size: 10px; color: var(--muted); width: 18px; text-align: center; font-weight: 500; flex-shrink: 0; }
  .lesson-item.active .lesson-num { color: var(--accent); font-weight: 600; }
  .lesson-thumb {
    width: 72px; height: 41px; border-radius: 4px; overflow: hidden;
    background: var(--border); flex-shrink: 0; position: relative;
  }
  .lesson-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .play-overlay {
    position: absolute; inset: 0; background: rgba(0,0,0,0.45);
    display: flex; align-items: center; justify-content: center;
    font-size: 11px; color: #fff; opacity: 0; transition: opacity 0.12s;
  }
  .lesson-item:hover .play-overlay,
  .lesson-item.active .play-overlay { opacity: 1; }
  .lesson-info { flex: 1; min-width: 0; }
  .lesson-title {
    font-size: 12px; font-weight: 500; line-height: 1.4; color: var(--text);
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .lesson-item.active .lesson-title { color: var(--active-text); }
  .lesson-check {
    width: 17px; height: 17px; border-radius: 50%; background: var(--check-bg);
    color: var(--check-text); font-size: 8px; display: none;
    align-items: center; justify-content: center; flex-shrink: 0; font-weight: 700;
  }
  .lesson-check.visible { display: flex; }

  /* ── PLAYER PANE (right) ── */
  .player-pane {
    flex: 1; display: flex; flex-direction: column;
    background: var(--bg); overflow: hidden; min-width: 0;
  }

  /* ── RESPONSIVE IFRAME PLAYER (16:9) ── */
  /*
   * No videojs-youtube plugin — avoids the postMessage origin error (153).
   * We use youtube-nocookie.com with enablejsapi=0 so no IFrame API
   * postMessage handshake is attempted at all. Pure embed, zero JS comms.
   */
  .player-wrap {
    position: relative;
    width: 100%;
    padding-top: 56.25%;   /* 16 : 9 */
    background: #000;
    flex-shrink: 0;
    overflow: hidden;
  }
  .player-wrap iframe {
    position: absolute;
    top: 0; left: 0;
    width: 100%;
    height: 100%;
    border: none;
    display: block;
  }

  /* ── Video.js-style chrome bar below iframe ── */
  .vjs-chrome {
    background: var(--player-chrome);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    height: 36px;
    flex-shrink: 0;
  }
  .vjs-chrome-btn {
    background: none; border: none; color: #ccc; cursor: pointer;
    padding: 0; display: flex; align-items: center; font-size: 13px;
    transition: color 0.15s;
  }
  .vjs-chrome-btn:hover { color: #fff; }
  .vjs-chrome-btn svg { width: 16px; height: 16px; }
  .vjs-progress {
    flex: 1; height: 3px; background: var(--progress-track);
    border-radius: 2px; overflow: visible; position: relative; cursor: pointer;
  }
  .vjs-progress-fill {
    height: 100%; background: var(--accent); border-radius: 2px;
    width: 0%; transition: width 0.3s linear; pointer-events: none;
  }
  .vjs-time { font-size: 11px; color: #aaa; white-space: nowrap; user-select: none; }
  .vjs-spacer { flex: 1; }

  /* ── PLAYER META ── */
  .player-meta { padding: 16px 20px; overflow-y: auto; flex: 1; }
  .now-playing-label {
    font-size: 10px; font-weight: 600; color: var(--accent);
    letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px;
  }
  .now-playing-title { font-size: 17px; font-weight: 600; line-height: 1.4; margin-bottom: 14px; }
  .nav-btns { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .nav-btn {
    padding: 7px 16px; border: 1px solid var(--border); border-radius: 7px;
    background: none; color: var(--text); font-size: 13px; font-family: inherit;
    cursor: pointer; transition: all 0.15s;
  }
  .nav-btn:hover { border-color: var(--accent); color: var(--accent); }
  .nav-btn:disabled { opacity: 0.3; cursor: not-allowed; }
  .mark-done-btn {
    margin-left: auto; padding: 7px 16px; border-radius: 7px; border: none;
    background: var(--accent); color: #fff; font-size: 13px; font-family: inherit;
    font-weight: 600; cursor: pointer; transition: background 0.15s;
  }
  .mark-done-btn:hover { background: var(--accent-h); }
  .mark-done-btn.done { background: var(--check-bg); color: var(--check-text); }

  /* ── MOBILE ── */
  @media (max-width: 768px) {
    html, body { overflow: auto; }
    .course-body { flex-direction: column; height: auto; }
    .sidebar {
      width: 100% !important; opacity: 1 !important; pointer-events: auto !important;
      border-right: none; border-top: 1px solid var(--border); max-height: 44vh; order: 2;
    }
    .sidebar.collapsed { max-height: 0; overflow: hidden; }
    .player-pane { order: 1; }
    .progress-wrap { display: none; }
    .player-meta { padding: 12px 14px; }
    .now-playing-title { font-size: 14px; }
  }
</style>
</head>
<body>

<header class="course-header">
  <div class="header-left">
    <button class="menu-toggle" onclick="toggleSidebar()" aria-label="Toggle lesson list">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
    <span class="course-title">${escapedTitle}</span>
  </div>
  <div class="progress-wrap">
    <div class="progress-bar-bg"><div class="progress-bar-fill" id="prog-fill"></div></div>
    <span class="progress-text" id="prog-text">0 / ${videoCount} done</span>
    <button class="reset-btn" onclick="resetProgress()">Reset</button>
  </div>
</header>

<div class="course-body">

  <!-- LEFT — lesson list -->
  <aside class="sidebar" id="sidebar">
    <div class="sidebar-head">
      <div class="sidebar-head-top">
        <span class="sidebar-label">Course lessons</span>
        <span class="lesson-count">${videoCount} videos</span>
      </div>
      <input class="sidebar-search" type="text" placeholder="Search lessons..." oninput="filterLessons(this.value)">
    </div>
    <div class="lesson-list">${lessonItems}</div>
  </aside>

  <!-- RIGHT — player -->
  <main class="player-pane">

    <!-- Responsive 16:9 nocookie iframe — no IFrame API, no postMessage, no Error 153 -->
    <div class="player-wrap">
      <iframe
        id="yt-iframe"
        src="https://www.youtube-nocookie.com/embed/${firstVideoId}?rel=0&modestbranding=1&enablejsapi=0&color=white&iv_load_policy=3"
        allowfullscreen
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        referrerpolicy="strict-origin-when-cross-origin"
        title="${firstTitle}">
      </iframe>
    </div>

    <!-- Video.js-styled chrome bar (purely decorative / navigation — real controls are inside YouTube iframe) -->
    <div class="vjs-chrome">
      <button class="vjs-chrome-btn" onclick="prevLesson()" id="prev-btn" title="Previous lesson">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/>
        </svg>
      </button>
      <button class="vjs-chrome-btn" onclick="nextLesson()" id="next-btn" title="Next lesson">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/>
        </svg>
      </button>
      <div class="vjs-progress" title="Course progress">
        <div class="vjs-progress-fill" id="vjs-prog"></div>
      </div>
      <span class="vjs-time" id="vjs-count">0 / ${videoCount}</span>
    </div>

    <div class="player-meta">
      <div class="now-playing-label">Now playing</div>
      <div class="now-playing-title" id="current-title">${firstTitle}</div>
      <div class="nav-btns">
        <button class="nav-btn" id="prev-btn-meta" onclick="prevLesson()" disabled>&#8592; Previous</button>
        <button class="nav-btn" id="next-btn-meta" onclick="nextLesson()">Next &#8594;</button>
        <button class="mark-done-btn" id="done-btn" onclick="toggleDone()">Mark as done</button>
      </div>
    </div>

  </main>
</div>

<script>
  var VIDEOS = ${videoData};
  var STORAGE_KEY = 'ytcourse_${playlistId}';
  var current = 0;
  var completed = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'));

  /* Build nocookie embed URL — enablejsapi=0 kills postMessage entirely */
  function embedUrl(videoId) {
    return 'https://www.youtube-nocookie.com/embed/' + videoId
      + '?rel=0&modestbranding=1&enablejsapi=0&color=white&iv_load_policy=3&autoplay=1';
  }

  function loadLesson(i) {
    console.log('[course] loadLesson →', i, ':', VIDEOS[i] ? VIDEOS[i].title : '?');
    current = i;
    var v = VIDEOS[i];

    /* Swap iframe src — no JS API needed, no postMessage, no Error 153 */
    var iframe = document.getElementById('yt-iframe');
    iframe.src = embedUrl(v.videoId);
    iframe.title = v.title;

    document.getElementById('current-title').textContent = v.title;
    updateActive(i);
    updateChrome(i);

    document.getElementById('prev-btn-meta').disabled = (i === 0);
    document.getElementById('next-btn-meta').disabled = (i === VIDEOS.length - 1);

    var doneBtn = document.getElementById('done-btn');
    doneBtn.textContent = completed.has(i) ? '✓ Completed' : 'Mark as done';
    doneBtn.className = 'mark-done-btn' + (completed.has(i) ? ' done' : '');

    var el = document.getElementById('item-' + i);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function updateActive(i) {
    document.querySelectorAll('.lesson-item').forEach(function(el) { el.classList.remove('active'); });
    var el = document.getElementById('item-' + i);
    if (el) el.classList.add('active');
  }

  function updateChrome(i) {
    var pct = VIDEOS.length ? Math.round((i / (VIDEOS.length - 1)) * 100) : 0;
    document.getElementById('vjs-prog').style.width = pct + '%';
    document.getElementById('vjs-count').textContent = (i + 1) + ' / ' + VIDEOS.length;
    var prevBtn = document.getElementById('prev-btn');
    var nextBtn = document.getElementById('next-btn');
    if (prevBtn) prevBtn.style.opacity = (i === 0) ? '0.3' : '1';
    if (nextBtn) nextBtn.style.opacity = (i === VIDEOS.length - 1) ? '0.3' : '1';
  }

  function prevLesson() {
    console.log('[course] prevLesson — current:', current);
    if (current > 0) loadLesson(current - 1);
  }

  function nextLesson() {
    console.log('[course] nextLesson — current:', current);
    if (current < VIDEOS.length - 1) loadLesson(current + 1);
  }

  function toggleDone() {
    var wasDone = completed.has(current);
    if (wasDone) { completed.delete(current); } else { completed.add(current); }
    console.log('[course] toggleDone — lesson', current, ':', wasDone ? 'unmarked' : 'marked complete');
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...completed]));
    var doneBtn = document.getElementById('done-btn');
    doneBtn.textContent = completed.has(current) ? '✓ Completed' : 'Mark as done';
    doneBtn.className = 'mark-done-btn' + (completed.has(current) ? ' done' : '');
    var check = document.getElementById('check-' + current);
    if (check) check.classList.toggle('visible', completed.has(current));
    updateProgress();
  }

  function updateProgress() {
    var pct = VIDEOS.length ? Math.round(completed.size / VIDEOS.length * 100) : 0;
    console.log('[course] progress:', completed.size + '/' + VIDEOS.length, '(' + pct + '%)');
    document.getElementById('prog-fill').style.width = pct + '%';
    document.getElementById('prog-text').textContent = completed.size + ' / ' + VIDEOS.length + ' done';
  }

  function resetProgress() {
    if (!confirm('Reset all progress?')) return;
    console.log('[course] resetProgress — clearing all');
    completed.clear();
    localStorage.removeItem(STORAGE_KEY);
    document.querySelectorAll('.lesson-check').forEach(function(c) { c.classList.remove('visible'); });
    updateProgress();
    document.getElementById('done-btn').textContent = 'Mark as done';
    document.getElementById('done-btn').className = 'mark-done-btn';
  }

  function filterLessons(q) {
    var query = q.toLowerCase();
    var visible = 0;
    VIDEOS.forEach(function(v, i) {
      var el = document.getElementById('item-' + i);
      var matches = v.title.toLowerCase().includes(query);
      if (el) el.classList.toggle('hidden', !matches);
      if (matches) visible++;
    });
    console.log('[course] filterLessons("' + q + '") — ' + visible + ' results');
  }

  function toggleSidebar() {
    var sb = document.getElementById('sidebar');
    sb.classList.toggle('collapsed');
    console.log('[course] sidebar toggled —', sb.classList.contains('collapsed') ? 'hidden' : 'visible');
  }

  function init() {
    console.log('[course] init — total lessons:', VIDEOS.length);
    console.log('[course] restored progress from localStorage:', [...completed]);
    completed.forEach(function(i) {
      var c = document.getElementById('check-' + i);
      if (c) c.classList.add('visible');
    });
    updateProgress();
    updateChrome(0);
    console.log('[course] ready');
  }

  init();
<\/script>
</body>
</html>`;

  console.timeEnd('build-html');
  const sizeKb = Math.round(new Blob([html]).size / 1024);
  console.log('output size:', sizeKb + 'KB');
  console.groupEnd();
  return html;
}

// ── STEP 5: MAIN GENERATE FLOW ────────────────

async function generate() {
  console.group('%c[YTImport] generate() started', 'color:#e8ff47;font-weight:bold');
  console.time('total-generate');

  const url = document.getElementById('playlist-url').value.trim();
  const apiKey = document.getElementById('api-key').value.trim();
  const customTitle = document.getElementById('course-title').value.trim();

  console.log('inputs:', {
    url,
    apiKey: apiKey ? apiKey.slice(0, 6) + '••••••••' : '(empty)',
    customTitle: customTitle || '(none — will auto-detect)',
    theme: selectedTheme
  });

  document.getElementById('error-box').style.display = 'none';
  document.getElementById('result-area').style.display = 'none';
  document.getElementById('status-area').innerHTML = '';
  document.getElementById('status-area').style.display = 'none';

  if (!url) {
    console.warn('validation failed: no URL provided');
    showError('Please enter a YouTube playlist URL.');
    console.groupEnd();
    return;
  }
  if (!apiKey) {
    console.warn('validation failed: no API key provided');
    showError('Please enter your YouTube Data API v3 key. Get one free at console.cloud.google.com');
    console.groupEnd();
    return;
  }

  const playlistId = extractPlaylistId(url);
  if (!playlistId) {
    console.warn('validation failed: could not extract playlist ID');
    showError('Could not find a playlist ID. Supported: playlist?list=PL... or watch?v=xx&list=PL... or paste the ID directly.');
    console.groupEnd();
    return;
  }

  console.log('playlist ID resolved:', playlistId);

  const btn = document.getElementById('gen-btn');
  btn.disabled = true;

  let dot1 = addStatus('Connecting to YouTube API...');
  let dot2, dot3;

  try {
    let { videos, playlistTitle } = await fetchAllVideos(playlistId, apiKey);
    setStatus(dot1, 'done');

    try {
      const pt = await fetchPlaylistTitle(playlistId, apiKey);
      if (pt) {
        console.log('[title] using official playlist title:', pt);
        playlistTitle = pt;
      }
    } catch (e) {
      console.warn('[title] could not fetch playlist title, using fallback:', e.message);
    }

    const finalTitle = customTitle || playlistTitle || 'My Course';
    console.log('[title] final course title:', finalTitle,
      customTitle ? '(from user input)' : playlistTitle ? '(from API)' : '(default fallback)');

    dot2 = addStatus('Fetched ' + videos.length + ' videos — building course page...');
    setStatus(dot2, 'done');

    dot3 = addStatus('Generating HTML + CSS...');
    await new Promise(r => setTimeout(r, 60));

    generatedHTML = buildCourseHTML(videos, finalTitle, selectedTheme, playlistId);
    setStatus(dot3, 'done');

    const kb = Math.round(new Blob([generatedHTML]).size / 1024);
    document.getElementById('result-subtitle').textContent = videos.length + ' lessons · ~' + kb + 'KB';
    document.getElementById('result-area').style.display = 'block';

    console.timeEnd('total-generate');
    console.log('%c[YTImport] course generated successfully', 'color:#47ff8a;font-weight:bold');
    console.log('summary:', { lessons: videos.length, sizeKb: kb, theme: selectedTheme, title: finalTitle });

  } catch (err) {
    console.error('[YTImport] generation failed:', err);
    if (dot1) setStatus(dot1, 'err');
    if (dot2) setStatus(dot2, 'err');
    if (dot3) setStatus(dot3, 'err');
    showError(err.message || 'Something went wrong. Check your API key and playlist URL.');
  } finally {
    btn.disabled = false;
    console.groupEnd();
  }
}

// ── STEP 6: DOWNLOAD / PREVIEW ────────────────

function downloadCourse() {
  if (!generatedHTML) { console.warn('[download] no HTML generated yet'); return; }
  const sizeKb = Math.round(new Blob([generatedHTML]).size / 1024);
  console.log('[download] triggering file download — size:', sizeKb + 'KB');
  const blob = new Blob([generatedHTML], { type: 'text/html' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'course.html';
  a.click();
  console.log('[download] done');
}

function previewCourse() {
  if (!generatedHTML) { console.warn('[preview] no HTML generated yet'); return; }
  console.log('[preview] opening course in new tab');
  const blob = new Blob([generatedHTML], { type: 'text/html' });
  window.open(URL.createObjectURL(blob), '_blank');
}

// ── EVENT LISTENERS ───────────────────────────

document.getElementById('playlist-url').addEventListener('keydown', function(e) {
  if (e.key === 'Enter') {
    console.log('[input] Enter key pressed — triggering generate()');
    generate();
  }
});
