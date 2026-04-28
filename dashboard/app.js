const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const LANG_COLORS = {
  Python: '#3776ab', JavaScript: '#f7df1e', TypeScript: '#3178c6',
  Go: '#00add8', Rust: '#dea584', HTML: '#e34c26', CSS: '#563d7c',
  SCSS: '#c6538c', Markdown: '#5478b3', JSON: '#cbcb41',
  YAML: '#cb171e', Shell: '#89e051', TOML: '#9c4221', SQL: '#e38c00',
  Vue: '#41b883', Svelte: '#ff3e00', Java: '#b07219', Kotlin: '#a97bff',
  Swift: '#fa7343', C: '#555555', 'C++': '#f34b7d', Ruby: '#cc342d',
  PHP: '#4f5d95', Other: '#888',
};
const langColor = l => LANG_COLORS[l] || '#888';

const fmt = {
  num: n => new Intl.NumberFormat().format(n || 0),
  date: d => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
  ago: ts => {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - ts * 1000) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    if (s < 86400) return `${Math.floor(s/3600)}h ago`;
    if (s < 86400 * 30) return `${Math.floor(s/86400)}d ago`;
    return `${Math.floor(s/86400/30)}mo ago`;
  },
  bytes: n => {
    if (n < 1024) return n + ' B';
    if (n < 1024*1024) return (n/1024).toFixed(1) + ' KB';
    return (n/1024/1024).toFixed(1) + ' MB';
  },
};

const state = {
  data: null,
  charts: {},
  currentDrawer: null,
  projectCache: {},
  filter: 'all',
  sort: 'recent',
  paletteSel: 0,
  paletteItems: [],
};

// === Lifecycle ===
async function init() {
  startClock();
  await load();
  connectStream();
  setupKeyboard();
  setupSearch();
  setupFilters();
  setupPalette();
  setInterval(refreshTimes, 30000);
}

async function load() {
  try {
    const r = await fetch('/api/data', { cache: 'no-store' });
    if (!r.ok) throw new Error();
    state.data = await r.json();
    render();
    setLive(true);
  } catch (e) {
    console.error('load failed', e);
    setLive(false);
  }
  loadQuota();
}

async function loadQuota() {
  try {
    const r = await fetch('/api/quota', { cache: 'no-store' });
    if (!r.ok) return;
    const q = await r.json();
    state.quota = q;        // cache for the drilldown modal
    renderQuota(q);
  } catch (e) {
    // non-fatal — telemetry is best-effort
  }
}

let es = null;
function connectStream() {
  if (es) try { es.close(); } catch {}
  try {
    es = new EventSource('/api/stream');
    es.addEventListener('data', (e) => {
      try {
        state.data = JSON.parse(e.data);
        render();
        setLive(true);
      } catch (err) { console.error('parse', err); }
    });
    es.onerror = () => setLive(false);
    es.onopen = () => setLive(true);
  } catch { setLive(false); }
}

function reconnect() { load(); connectStream(); }

function setLive(on) {
  const pill = $('#live-pill');
  if (!pill) return;
  if (on) pill.classList.remove('offline');
  else pill.classList.add('offline');
  $('#live-text').textContent = on ? 'BUILDING' : 'IDLE';
}

// === Render ===
function render() {
  if (!state.data) return;
  const d = state.data;
  renderTicker(d);
  renderHero(d);
  renderCalendar(d);
  renderLangChart(d);
  renderVelocityChart(d);
  renderHeatmap(d);
  renderProjects(d);
  renderCommitFeed(d);
  renderSessionLog(d);
  attachActivityDrilldowns();
}

function renderTicker(d) {
  const stats = d.cross_stats;
  const items = [
    { label: 'Projects', value: stats.total_projects },
    { label: 'Shipped', value: `${stats.completed_projects}/${stats.total_projects}` },
    { label: 'Commits', value: fmt.num(stats.total_commits), accent: true },
    { label: 'Lines', value: fmt.num(stats.total_lines) },
    { label: 'Files', value: stats.total_files },
    { label: 'Languages', value: stats.languages.length },
    { label: 'Streak', value: `${d.streak}d`, accent: d.streak > 0 },
    { label: 'Today', value: `${d.today_commits}c`, accent: d.today_commits > 0 },
    { label: '7d', value: `${d.week_commits}c` },
    { label: '+', value: fmt.num(stats.total_additions) },
    { label: '−', value: fmt.num(stats.total_deletions) },
  ];
  $('#ticker-inner').innerHTML = items.map((it, i) => `
    <div class="ticker-item ${it.accent ? 'accent' : ''}">${it.label} <strong>${it.value}</strong></div>
    ${i < items.length - 1 ? '<div class="ticker-sep"></div>' : ''}
  `).join('');
}

const _prevNums = {};
function animateNumber(id, target, formatter = fmt.num) {
  const el = $(`#${id}`);
  if (!el) return;
  const from = _prevNums[id] || 0;
  if (from === target) { el.textContent = formatter(target); return; }
  const start = performance.now();
  const dur = 700;
  const ease = t => 1 - Math.pow(1 - t, 3);
  function tick(now) {
    const t = Math.min(1, (now - start) / dur);
    const v = Math.round(from + (target - from) * ease(t));
    el.textContent = formatter(v);
    if (t < 1) requestAnimationFrame(tick);
    else _prevNums[id] = target;
  }
  requestAnimationFrame(tick);
}

function renderHero(d) {
  const active = d.active;
  const stats = d.cross_stats;
  const heroEl = $('#hero-main');
  if (active) {
    const completedArr = Array.isArray(active.completed) ? active.completed : [];
    const nextStepsArr = Array.isArray(active.next_steps) ? active.next_steps : [];
    const total = completedArr.length + nextStepsArr.length;
    const pct = total > 0 ? Math.round(100 * completedArr.length / total) : 0;
    const isShipped = active.live_signal === 'last_shipped' || active.status === 'SHIPPED';
    const isLiveBuild = active.live_signal === 'recent_git' || active.status === 'IN_PROGRESS' || active.status === 'ACTIVE';

    let eyebrow, sub, badgeClass;
    if (isShipped) {
      // No active build — show last ship as a positive idle state.
      eyebrow = `Last shipped · ${fmt.ago(active.last_activity)}`;
      sub = `${active.commit_count || 0} commits · ${fmt.num(active.total_lines || stats.total_additions || 0)} lines · run <code class="hero-code">./start.sh</code> to begin a new build`;
      badgeClass = 'shipped';
    } else if (isLiveBuild) {
      eyebrow = `Live activity · last touched ${fmt.ago(active.last_activity)}`;
      sub = `${escapeHtml(active.in_progress || 'Polishing')} · ${active.commit_count || 0} commits so far`;
      badgeClass = 'building';
    } else {
      eyebrow = `Now building · Session ${active.session || 1}`;
      sub = escapeHtml(active.in_progress || 'Setting up project structure');
      badgeClass = 'building';
    }

    heroEl.innerHTML = `
      <div class="hero-eyebrow hero-eyebrow-${badgeClass}">${escapeHtml(eyebrow)}</div>
      <div class="hero-headline">${escapeHtml(active.name)}</div>
      <div class="hero-sub">${sub}</div>
      ${isShipped ? '' : `
        <div class="hero-progress">
          <div class="hero-progress-label">
            <span>Build progress</span>
            <span>${completedArr.length} / ${total} steps · ${pct}%</span>
          </div>
          <div class="hero-progress-bar">
            <div class="hero-progress-fill" style="width:${pct}%"></div>
          </div>
        </div>
      `}
    `;
    heroEl.onclick = () => openDrawer(active.name);
    heroEl.style.cursor = 'pointer';
  } else {
    heroEl.innerHTML = `
      <div class="hero-eyebrow">Idle</div>
      <div class="hero-headline">No project running</div>
      <div class="hero-sub">Run <code class="hero-code">./start.sh</code> to begin a new build.</div>
    `;
    heroEl.onclick = null;
    heroEl.style.cursor = 'default';
  }

  $('#stat-projects').textContent = stats.total_projects;
  animateNumber('stat-completed', stats.completed_projects, n => n);
  animateNumber('stat-commits', stats.total_commits);
  animateNumber('stat-additions', stats.total_additions);
  animateNumber('stat-streak', d.streak, n => n);

  // Stat cards are clickable — each opens a contextual detail modal.
  const streakCard = $('#stat-streak-card');
  const shippedCard = $('#stat-shipped-card');
  const commitsCard = $('#stat-commits-card');
  if (streakCard) { streakCard.classList.add('clickable'); streakCard.onclick = () => openStatDetail('streak'); }
  if (shippedCard) { shippedCard.classList.add('clickable'); shippedCard.onclick = () => openStatDetail('shipped'); }
  if (commitsCard) { commitsCard.classList.add('clickable'); commitsCard.onclick = () => openStatDetail('commits'); }
}

function renderCalendar(d) {
  const wrap = $('#calendar');
  const monthsEl = $('#cal-months');
  const cal = d.streak_calendar;
  if (!cal || !cal.length) return;

  const weeks = [];
  let cur = [];
  const firstWeekday = (cal[0].weekday + 1) % 7;
  for (let i = 0; i < firstWeekday; i++) cur.push(null);
  for (const day of cal) {
    cur.push(day);
    if (cur.length === 7) { weeks.push(cur); cur = []; }
  }
  if (cur.length) {
    while (cur.length < 7) cur.push(null);
    weeks.push(cur);
  }

  const max = Math.max(1, ...cal.map(c => c.count));
  const lvl = n => {
    if (!n) return '';
    const r = n / max;
    if (r < 0.25) return 'l1';
    if (r < 0.5) return 'l2';
    if (r < 0.75) return 'l3';
    return 'l4';
  };

  wrap.innerHTML = weeks.map(w => `
    <div class="cal-week">
      ${w.map(day => day
        ? `<div class="cal-day ${lvl(day.count)} ${day.count ? 'has-data' : ''}" data-date="${day.date}" data-count="${day.count}" data-tip="${day.date}: ${day.count} commits${day.count ? ' — click for details' : ''}"></div>`
        : `<div class="cal-day" style="visibility:hidden"></div>`).join('')}
    </div>
  `).join('');

  // Click handler: open day detail modal for any day with activity.
  $$('.cal-day.has-data', wrap).forEach(el => {
    el.addEventListener('click', () => openDayDetail(el.dataset.date));
  });

  // Auto-anchor the calendar to today. Scroll position survives SSE re-renders
  // via CSS direction:rtl on the scroll container (see style.css). The JS here
  // is a defensive fallback for browsers that don't honor the RTL anchor.
  const calWrap = wrap.closest('.calendar-wrap');
  if (calWrap) {
    const pin = () => { calWrap.scrollLeft = calWrap.scrollWidth; };
    requestAnimationFrame(pin);
    setTimeout(pin, 60);
  }

  // Month labels — one slot per week column (15px gap-aligned), label at first week of each month
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let lastMonth = -1;
  monthsEl.innerHTML = weeks.map(w => {
    const firstDay = w.find(x => x);
    let label = '';
    if (firstDay) {
      const m = new Date(firstDay.date).getMonth();
      if (m !== lastMonth) { label = monthNames[m]; lastMonth = m; }
    }
    return `<span class="cal-month-slot">${label}</span>`;
  }).join('');

  const total = cal.reduce((s, c) => s + c.count, 0);
  const active = cal.filter(c => c.count > 0).length;
  $('#cal-summary').textContent = `${total} commits · ${active} active days`;

  attachTooltips(wrap);
}

function renderLangChart(d) {
  const host = document.querySelector('.chart-wrap canvas#chart-lang')?.parentElement;
  if (!host) return;
  const langs = (d.cross_stats.languages || [])
    .filter(l => l.lines > 0)
    .slice(0, 8);
  if (state.charts.lang) { state.charts.lang.destroy(); state.charts.lang = null; }

  // Swap the <canvas> for a custom SVG viz. Idempotent across re-renders.
  host.innerHTML = '';
  host.classList.add('lang-viz');

  if (!langs.length) {
    host.innerHTML = '<div class="empty-state">No languages detected.</div>';
    $('#lang-summary').textContent = '';
    return;
  }

  const totalLines = langs.reduce((s, l) => s + l.lines, 0);

  // Stacked proportional bar (top) + ranked legend (below) with bar fills that
  // animate on mount. All counts map to `lines` — bytes and file-counts lose
  // signal when language density varies.
  const segs = langs.map(l => {
    const pct = (l.lines / totalLines) * 100;
    return `<div class="lang-seg" style="flex:${Math.max(0.5, pct)};background:${l.color}"
                 data-tip="${escapeHtml(l.lang)}: ${fmt.num(l.lines)} lines (${pct.toFixed(1)}%)"></div>`;
  }).join('');

  const rows = langs.map((l, i) => {
    const pct = (l.lines / totalLines) * 100;
    return `
      <div class="lang-row" style="--i:${i};--lang-color:${l.color}">
        <span class="lang-dot"></span>
        <span class="lang-name">${escapeHtml(l.lang)}</span>
        <span class="lang-bar"><span style="width:${pct}%"></span></span>
        <span class="lang-count">${fmt.num(l.lines)}</span>
        <span class="lang-pct">${pct.toFixed(0)}%</span>
      </div>
    `;
  }).join('');

  host.innerHTML = `
    <div class="lang-stack" role="img" aria-label="Language breakdown by lines">
      ${segs}
    </div>
    <div class="lang-list">${rows}</div>
  `;

  attachTooltips(host);
  $('#lang-summary').textContent = `${langs.length} langs · ${fmt.num(totalLines)} lines`;
}

function renderVelocityChart(d) {
  const ctx = $('#chart-velocity').getContext('2d');
  const v = d.velocity || [];
  if (state.charts.velocity) state.charts.velocity.destroy();
  if (!v.length) return;
  const labels = v.map(x => fmt.date(x.date));
  state.charts.velocity = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Commits',
        data: v.map(x => x.count),
        backgroundColor: ctx => {
          const value = ctx.raw || 0;
          if (!value) return 'rgba(255,255,255,0.04)';
          const grad = ctx.chart.ctx.createLinearGradient(0, 0, 0, 240);
          grad.addColorStop(0, 'oklch(80% 0.18 220)');
          grad.addColorStop(1, 'oklch(60% 0.20 270)');
          return grad;
        },
        borderRadius: 4,
        borderSkipped: false,
        maxBarThickness: 22,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'oklch(15% 0.005 250)',
          borderColor: 'oklch(28% 0.014 250)',
          borderWidth: 1,
          titleFont: { family: 'JetBrains Mono', size: 11 },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
          padding: 10,
          callbacks: {
            label: ctx => ` ${ctx.raw} commits`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#555', font: { size: 9, family: 'JetBrains Mono' }, maxTicksLimit: 12 },
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)' },
          ticks: { color: '#555', font: { size: 9, family: 'JetBrains Mono' } },
          beginAtZero: true,
        },
      },
    },
  });
  const total = v.reduce((s, x) => s + x.count, 0);
  $('#vel-summary').textContent = `${total} commits / 30d`;
}

function renderHeatmap(d) {
  const wrap = $('#heatmap');
  const grid = d.heatmap || [];
  if (!grid.length) return;
  const max = Math.max(1, ...grid.flat());
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  let html = '';
  for (let h = 0; h < 24; h++) {
    html += '<div class="heatmap-col">';
    for (let dow = 0; dow < 7; dow++) {
      const v = grid[dow][h];
      const a = v / max;
      const bg = v > 0
        ? `oklch(${50 + a*32}% ${0.10 + a*0.12} ${250 - a*30})`
        : 'var(--bg3)';
      const glow = a > 0.7 ? `box-shadow: 0 0 6px oklch(${50 + a*32}% ${0.10 + a*0.12} ${250 - a*30});` : '';
      html += `<div class="hm-cell" style="background:${bg};${glow}" data-tip="${days[dow]} ${String(h).padStart(2,'0')}:00 — ${v} commits"></div>`;
    }
    html += '</div>';
  }
  wrap.innerHTML = html;
  attachTooltips(wrap);
}

function renderProjects(d) {
  const wrap = $('#project-grid');
  let projects = [...(d.projects || [])];
  if (state.filter === 'building') projects = projects.filter(p => (p.authoritative_status || (p.status === 'COMPLETE' ? 'shipped' : 'building')) === 'building');
  if (state.filter === 'shipped') projects = projects.filter(p => p.status === 'COMPLETE' || p.authoritative_status === 'shipped');
  if (state.filter === 'stalled') projects = projects.filter(p => p.stalled);
  const sorters = {
    recent: (a, b) => (b.last_modified || 0) - (a.last_modified || 0),
    commits: (a, b) => b.commit_count - a.commit_count,
    lines: (a, b) => (b.additions - b.deletions) - (a.additions - a.deletions),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  projects.sort(sorters[state.sort] || sorters.recent);
  $('#proj-count').textContent = `${projects.length} ${projects.length === 1 ? 'project' : 'projects'}`;
  if (!projects.length) {
    wrap.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:48px 24px;color:var(--text3);font-size:13px">
      <div style="font-size:32px;opacity:0.4;margin-bottom:12px">∅</div>
      No projects match this filter
    </div>`;
    return;
  }
  wrap.innerHTML = projects.map(p => {
    const live = p.live_signal === 'recent_git';
    const auth = p.authoritative_status || (p.status === 'COMPLETE' ? 'shipped' : 'building');
    const stalled = Boolean(p.stalled);
    const shipped = auth === 'shipped';
    const building = !shipped && !stalled;
    const isActive = building || live;

    // Progress from server (git-derived, not state.md-derived).
    const completed = typeof p.progress_completed === 'number' ? p.progress_completed : (p.completed || []).length;
    const total = typeof p.progress_total === 'number' && p.progress_total > 0 ? p.progress_total : null;
    const pct = total ? Math.min(100, Math.round(100 * completed / total)) : (shipped ? 100 : Math.min(100, completed * 5));
    const progressText = p.progress_display || (total ? `${completed}/${total}` : `${completed} commits`);

    const tagline = p.description || p.in_progress || '—';
    const ago = p.last_commit ? fmt.ago(p.last_commit) : '—';

    let pill, pillClass;
    if (live) { pill = 'ACTIVE'; pillClass = 'in-progress live'; }
    else if (stalled) { pill = 'STALLED'; pillClass = 'stalled'; }
    else if (building) { pill = 'BUILDING'; pillClass = 'in-progress'; }
    else { pill = 'SHIPPED'; pillClass = 'complete'; }

    const evalChip = renderEvalChip(p.evaluation);

    return `
      <div class="project-card ${isActive ? 'active' : ''} ${live ? 'live' : ''} ${stalled ? 'stalled' : ''}" data-name="${escapeAttr(p.name)}">
        ${p.github ? `<a class="pc-gh" href="${p.github}" target="_blank" rel="noopener" onclick="event.stopPropagation()" title="Open on GitHub">↗</a>` : ''}
        <div class="pc-header">
          <div class="pc-name">${escapeHtml(p.name)}</div>
          <div class="pc-status ${pillClass}">${live ? '<span class="pc-status-dot"></span>' : ''}${pill}</div>
        </div>
        <div class="pc-tagline">${escapeHtml(tagline)}</div>
        <div class="pc-progress"><div class="pc-progress-fill" style="width:${pct}%"></div></div>
        <div class="pc-stats">
          <div class="pc-stat" data-tip="${progressText}">⎇ <strong>${completed}</strong>${total ? `<span class="pc-stat-sub">/${total}</span>` : ''}</div>
          <div class="pc-stat add" data-tip="lines added">+<strong>${fmt.num(p.additions)}</strong></div>
          <div class="pc-stat del" data-tip="lines removed">−<strong>${fmt.num(p.deletions)}</strong></div>
          ${evalChip}
          <div class="pc-stat pct" data-tip="${ago}">${ago}</div>
        </div>
      </div>
    `;
  }).join('');
  $$('.project-card', wrap).forEach(el => {
    el.addEventListener('click', () => openDrawer(el.dataset.name));
  });
  attachTooltips(wrap);
}

function renderCommitFeed(d) {
  const wrap = $('#commit-feed');
  const commits = d.recent_commits || [];
  if (!commits.length) {
    wrap.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:24px;text-align:center">No commits yet</div>';
    return;
  }
  wrap.innerHTML = commits.map(c => `
    <div class="feed-item" data-proj="${escapeAttr(c.project)}" data-sha="${c.sha}">
      <div class="feed-icon commit">⎇</div>
      <div class="feed-body">
        <div class="feed-title">${escapeHtml(c.subject)}</div>
        <div class="feed-meta">
          <span class="feed-meta-tag">${escapeHtml(c.project)}</span>
          <span>${fmt.ago(c.timestamp)}</span>
          <span class="commit-add">+${c.additions}</span>
          <span class="commit-del">−${c.deletions}</span>
        </div>
      </div>
    </div>
  `).join('');
  $$('.feed-item', wrap).forEach(el => {
    el.addEventListener('click', () => openCommit(el.dataset.proj, el.dataset.sha));
  });
}

function renderSessionLog(d) {
  const wrap = $('#session-log');
  const logs = (d.session_log || []).slice().reverse();
  if (!logs.length) {
    wrap.innerHTML = '<div style="color:var(--text3);font-size:12px;padding:24px;text-align:center">No sessions yet</div>';
    return;
  }
  const icons = { error: '!', new: '✦', resume: '↻', start: '●', end: '◆' };
  wrap.innerHTML = logs.slice(0, 60).map(l => `
    <div class="log-entry ${l.type}">
      <div class="feed-icon ${l.type}">${icons[l.type] || '·'}</div>
      <div class="log-entry-text">
        <div class="log-entry-msg">${escapeHtml(l.message)}</div>
        <div class="log-entry-time">${l.date} · ${l.time}</div>
      </div>
    </div>
  `).join('');
}

// === Drawer ===
async function openDrawer(name) {
  state.currentDrawer = name;
  $('#scrim').classList.add('open');
  $('#drawer').classList.add('open');
  $('#drawer-title').textContent = name;
  $('#drawer-sub').textContent = 'loading…';
  $('#drawer-tabs').innerHTML = '';
  $('#drawer-actions').innerHTML = `<button class="icon-btn" onclick="closeDrawer()">✕</button>`;
  $('#drawer-body').innerHTML = `
    <div class="dr-mini-grid">
      ${[1,2,3,4].map(() => '<div class="skel" style="height:70px"></div>').join('')}
    </div>
    <div class="skel" style="height:300px"></div>
  `;
  try {
    const r = await fetch(`/api/project?name=${encodeURIComponent(name)}`);
    if (!r.ok) throw new Error(`fetch returned ${r.status}`);
    const data = await r.json();
    state.projectCache[name] = data;
    renderDrawer(data);
  } catch (err) {
    console.error('[drawer] failed to load', name, err);
    $('#drawer-body').innerHTML = `<div style="color:var(--red); padding: 20px;">
      <div style="font-weight:700;margin-bottom:6px">Failed to load project details</div>
      <div style="font-family:var(--font-mono);font-size:11px;color:var(--text2);white-space:pre-wrap">${escapeHtml(String(err && err.stack || err))}</div>
    </div>`;
  }
}

function closeDrawer() {
  state.currentDrawer = null;
  $('#scrim').classList.remove('open');
  $('#drawer').classList.remove('open');
}

function renderDrawer(p) {
  $('#drawer-title').textContent = p.name;
  const days = (p.first_commit && p.last_commit)
    ? Math.max(1, Math.ceil((p.last_commit - p.first_commit) / 86400))
    : 0;
  const status = p.status === 'COMPLETE' ? 'SHIPPED' : 'BUILDING';
  $('#drawer-sub').innerHTML = `
    <span style="color:${p.status==='COMPLETE'?'var(--green)':'var(--amber)'}">● ${status}</span>
    &nbsp;·&nbsp; ${p.commit_count} commits
    &nbsp;·&nbsp; ${fmt.num(p.total_lines)} lines
    &nbsp;·&nbsp; ${p.total_files} files
    &nbsp;·&nbsp; ${days}d active
    &nbsp;·&nbsp; on ${p.branch || 'main'}
  `;

  const shipped = p.status === 'COMPLETE' || p.authoritative_status === 'shipped';
  $('#drawer-actions').innerHTML = `
    <button class="action-btn resume" data-action="resume" data-name="${escapeAttr(p.name)}" title="Open Terminal and resume this project">▶ Resume</button>
    <button class="action-btn polish" data-action="polish" data-name="${escapeAttr(p.name)}" title="Run finishing pass — README, polish, tests">◆ Polish</button>
    <button class="action-btn evaluate" data-action="evaluate" data-name="${escapeAttr(p.name)}" title="Run evaluator now">✓ Evaluate</button>
    <button class="action-btn archive" data-action="archive" data-name="${escapeAttr(p.name)}" title="Move to _archive/ (reversible)">⊘ Archive</button>
    ${p.github ? `<a class="icon-btn" href="${p.github}" target="_blank" rel="noopener" title="Open on GitHub">↗</a>` : ''}
    <button class="icon-btn" onclick="closeDrawer()" title="Close (Esc)">✕</button>
  `;
  $$('#drawer-actions .action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      handleProjectAction(btn.dataset.action, btn.dataset.name, btn);
    });
  });

  const tabs = ['overview', 'commits', 'files', 'languages', 'readme'];
  $('#drawer-tabs').innerHTML = tabs.map((t, i) =>
    `<div class="drawer-tab ${i === 0 ? 'active' : ''}" data-tab="${t}">${t}</div>`
  ).join('');
  $$('.drawer-tab').forEach(el => {
    el.addEventListener('click', () => {
      $$('.drawer-tab').forEach(t => t.classList.remove('active'));
      el.classList.add('active');
      renderDrawerTab(el.dataset.tab, p);
    });
  });
  renderDrawerTab('overview', p);
}

function renderDrawerTab(tab, p) {
  const body = $('#drawer-body');
  body.scrollTop = 0;
  if (tab === 'overview') {
    body.innerHTML = drawerOverview(p);
    renderProjectSparkline(p);
  }
  else if (tab === 'commits') body.innerHTML = drawerCommits(p);
  else if (tab === 'files') body.innerHTML = drawerFiles(p);
  else if (tab === 'languages') body.innerHTML = drawerLangs(p);
  else if (tab === 'readme') body.innerHTML = drawerReadme(p);

  if (tab === 'commits') {
    $$('.commit-row', body).forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.classList.contains('commit-sha')) {
          copyToClipboard(el.dataset.sha);
          showToast('success', `${el.dataset.sha.slice(0,12)} copied`);
          return;
        }
        openCommit(p.name, el.dataset.sha);
      });
    });
  }
  if (tab === 'files') {
    $$('.tree-node-file', body).forEach(el => {
      el.addEventListener('click', () => openFile(p.name, el.dataset.path));
    });
  }
}

function renderProjectSparkline(p) {
  const canvas = $('#dr-spark');
  if (!canvas) return;
  const today = new Date();
  const days = 30;
  const buckets = Array(days).fill(0);
  const labels = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - (days - 1 - i));
    labels.push(d.toISOString().slice(0, 10));
  }
  (p.commits || []).forEach(c => {
    const d = new Date(c.timestamp * 1000).toISOString().slice(0, 10);
    const idx = labels.indexOf(d);
    if (idx >= 0) buckets[idx]++;
  });
  if (state.charts.spark) state.charts.spark.destroy();
  const ctx = canvas.getContext('2d');
  state.charts.spark = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(l => fmt.date(l)),
      datasets: [{
        data: buckets,
        backgroundColor: ctx => {
          const v = ctx.raw || 0;
          if (!v) return 'rgba(255,255,255,0.04)';
          const grad = ctx.chart.ctx.createLinearGradient(0, 0, 0, 140);
          grad.addColorStop(0, 'oklch(82% 0.18 220)');
          grad.addColorStop(1, 'oklch(60% 0.20 270)');
          return grad;
        },
        borderRadius: 3,
        maxBarThickness: 14,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'oklch(15% 0.005 250)',
          borderColor: 'oklch(28% 0.014 250)',
          borderWidth: 1,
          titleFont: { family: 'JetBrains Mono', size: 11 },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
          padding: 8,
          callbacks: { label: ctx => ` ${ctx.raw} commits` },
        },
      },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: true },
      },
    },
  });
}

function drawerOverview(p) {
  // Defensive: payloads from /api/project may legitimately omit fields
  // when the underlying repo is mid-state (no git history, no state.md,
  // working tree never touched). Coerce everything before computing.
  const completedArr = Array.isArray(p.completed) ? p.completed : [];
  const nextStepsArr = Array.isArray(p.next_steps) ? p.next_steps : [];
  const gitStatus = p.git_status || { clean: true, modified: [], added: [], untracked: [] };
  const modifiedArr = Array.isArray(gitStatus.modified) ? gitStatus.modified : [];
  const untrackedArr = Array.isArray(gitStatus.untracked) ? gitStatus.untracked : [];
  const total = completedArr.length + nextStepsArr.length;
  const pct = total > 0 ? Math.round(100 * completedArr.length / total) : 0;
  const cleanColor = gitStatus.clean ? 'var(--green)' : 'var(--amber)';
  return `
    <div class="dr-mini-grid">
      <div class="dr-mini">
        <div class="dr-mini-label">Lines</div>
        <div class="dr-mini-value">${fmt.num(p.total_lines)}</div>
      </div>
      <div class="dr-mini">
        <div class="dr-mini-label">Files</div>
        <div class="dr-mini-value">${p.total_files}</div>
      </div>
      <div class="dr-mini">
        <div class="dr-mini-label">Commits</div>
        <div class="dr-mini-value">${p.commit_count}</div>
      </div>
      <div class="dr-mini">
        <div class="dr-mini-label">Sessions</div>
        <div class="dr-mini-value">${p.session}</div>
      </div>
    </div>

    <div class="dr-chart-tile">
      <div class="dr-chart-tile-header">
        <div class="dr-section-title" style="margin-bottom:0">Commit Timeline</div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text3)">
          ${p.first_commit ? `${fmt.ago(p.first_commit)} → ${fmt.ago(p.last_commit)}` : 'no commits yet'}
        </div>
      </div>
      <div class="dr-chart-wrap"><canvas id="dr-spark"></canvas></div>
    </div>

    <div class="dr-section">
      <div class="dr-section-title">Progress</div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:20px">
        <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.1em">
          <span>${completedArr.length} / ${total} steps</span>
          <span>${pct}%</span>
        </div>
        <div class="hero-progress-bar"><div class="hero-progress-fill" style="width:${pct}%"></div></div>
      </div>
    </div>

    <div class="dr-section">
      <div class="dr-section-title">Git Status</div>
      <div style="display:flex;gap:14px">
        <div style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:18px">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:0.12em">Working tree</div>
          <div style="font-size:18px;font-weight:700;margin-top:8px;color:${cleanColor}">
            ${gitStatus.clean ? '✓ Clean' : `◉ ${modifiedArr.length + untrackedArr.length} changed`}
          </div>
        </div>
        <div style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:18px">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:0.12em">Modified · Untracked</div>
          <div style="font-size:18px;font-weight:700;margin-top:8px;color:var(--text0)">
            ${modifiedArr.length} <span style="color:var(--text3)">·</span> ${untrackedArr.length}
          </div>
        </div>
      </div>
    </div>

    ${completedArr.length ? `
      <div class="dr-section">
        <div class="dr-section-title">Completed Steps · ${completedArr.length}</div>
        ${completedArr.slice().reverse().slice(0, 12).map((s, i) => `
          <div class="step-row">
            <span class="step-num done">✓</span>
            <span class="step-text">${escapeHtml(s)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${nextStepsArr.length ? `
      <div class="dr-section">
        <div class="dr-section-title">Next Steps · ${nextStepsArr.length}</div>
        ${nextStepsArr.map((s, i) => `
          <div class="step-row">
            <span class="step-num todo">${i+1}.</span>
            <span class="step-text">${escapeHtml(s)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;
}

function drawerCommits(p) {
  if (!p.commits || !p.commits.length) {
    return '<div style="color:var(--text3); padding: 24px; text-align: center;">No commits yet</div>';
  }
  return `
    <div class="commit-list">
      ${p.commits.map(c => `
        <div class="commit-row" data-sha="${c.sha}">
          <div class="commit-info">
            <div class="commit-subject">${escapeHtml(c.subject)}</div>
            <div class="commit-meta">${escapeHtml(c.author)} · ${fmt.ago(c.timestamp)} · ${c.files_changed} files</div>
          </div>
          <div class="commit-stats">
            <span class="commit-add">+${c.additions}</span>
            <span class="commit-del">−${c.deletions}</span>
          </div>
          <div class="commit-sha">${c.short}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function drawerFiles(p) {
  if (!p.file_tree || !p.file_tree.children || !p.file_tree.children.length) {
    return '<div style="color:var(--text3); padding: 24px; text-align: center;">No files</div>';
  }
  return `<div class="tree">${p.file_tree.children.map(c => renderTreeChild(c, '')).join('')}</div>`;
}

function renderTreeChild(node, parentPath) {
  const fullPath = parentPath ? `${parentPath}/${node.name}` : node.name;
  if (node.type === 'file') {
    return `
      <div class="tree-node tree-node-file" data-path="${escapeAttr(fullPath)}">
        <span class="tree-icon">·</span>
        <span class="tree-lang-dot" style="background:${langColor(node.lang)}"></span>
        <span class="tree-name">${escapeHtml(node.name)}</span>
        <span class="tree-size">${fmt.bytes(node.size || 0)}</span>
      </div>
    `;
  }
  return `
    <div>
      <div class="tree-node tree-node-dir">
        <span class="tree-icon">▾</span>
        <span class="tree-name">${escapeHtml(node.name)}/</span>
        <span class="tree-size">${(node.children || []).length} items</span>
      </div>
      <div class="tree-children">
        ${(node.children || []).map(c => renderTreeChild(c, fullPath)).join('')}
      </div>
    </div>
  `;
}

function drawerLangs(p) {
  if (!p.languages || !p.languages.length) {
    return '<div style="color:var(--text3); padding: 24px; text-align: center;">No languages detected</div>';
  }
  const total = p.languages.reduce((s, l) => s + l.lines, 0);
  return `
    <div class="dr-mini-grid">
      <div class="dr-mini">
        <div class="dr-mini-label">Total Lines</div>
        <div class="dr-mini-value">${fmt.num(total)}</div>
      </div>
      <div class="dr-mini">
        <div class="dr-mini-label">Languages</div>
        <div class="dr-mini-value">${p.languages.length}</div>
      </div>
      <div class="dr-mini">
        <div class="dr-mini-label">Top</div>
        <div class="dr-mini-value" style="font-size:18px;color:${p.languages[0].color}">${p.languages[0].lang}</div>
      </div>
      <div class="dr-mini">
        <div class="dr-mini-label">Avg / file</div>
        <div class="dr-mini-value">${Math.round(total / Math.max(1, p.total_files))}</div>
      </div>
    </div>
    <div class="dr-section">
      <div class="dr-section-title">Breakdown</div>
      <div class="lang-bars">
        ${p.languages.map(l => {
          const pct = total ? (l.lines / total) * 100 : 0;
          return `
            <div class="lang-row">
              <span class="lang-dot" style="background:${l.color}"></span>
              <span class="lang-name">${l.lang}</span>
              <div class="lang-bar-wrap"><div class="lang-bar-fill" style="width:${pct}%; background:${l.color}"></div></div>
              <span class="lang-pct">${fmt.num(l.lines)} L · ${pct.toFixed(1)}%</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
}

function drawerReadme(p) {
  if (!p.readme) {
    return '<div style="color:var(--text3); padding: 40px; text-align: center;">No README found</div>';
  }
  return `<div class="readme">${renderMarkdown(p.readme)}</div>`;
}

function renderMarkdown(md) {
  // Stash code blocks first so their contents aren't mangled
  const blocks = [];
  let text = md.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    blocks.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
    return `\u0000BLOCK${blocks.length - 1}\u0000`;
  });

  // Process line-by-line for block grouping
  const lines = text.split('\n');
  const out = [];
  let listType = null;
  let listItems = [];
  const flushList = () => {
    if (listItems.length) {
      out.push(`<${listType}>${listItems.join('')}</${listType}>`);
      listItems = [];
    }
    listType = null;
  };
  for (let line of lines) {
    const ulMatch = line.match(/^[-*]\s+(.+)/);
    const olMatch = line.match(/^\d+\.\s+(.+)/);
    if (ulMatch) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(`<li>${inlineMd(ulMatch[1])}</li>`);
      continue;
    }
    if (olMatch) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(`<li>${inlineMd(olMatch[1])}</li>`);
      continue;
    }
    flushList();
    if (/^###\s+/.test(line)) { out.push(`<h3>${inlineMd(line.replace(/^###\s+/,''))}</h3>`); continue; }
    if (/^##\s+/.test(line))  { out.push(`<h2>${inlineMd(line.replace(/^##\s+/,''))}</h2>`); continue; }
    if (/^#\s+/.test(line))   { out.push(`<h1>${inlineMd(line.replace(/^#\s+/,''))}</h1>`); continue; }
    if (/^>\s+/.test(line))   { out.push(`<blockquote>${inlineMd(line.replace(/^>\s+/,''))}</blockquote>`); continue; }
    if (/^---+$/.test(line))  { out.push('<hr>'); continue; }
    if (line.trim()) out.push(`<p>${inlineMd(line)}</p>`);
    else out.push('');
  }
  flushList();
  let html = out.join('\n');
  html = html.replace(/\u0000BLOCK(\d+)\u0000/g, (_, i) => blocks[+i]);
  return html;
}

function inlineMd(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t;
}

// === Modal ===
async function openCommit(projectName, sha) {
  showModal(`commit ${sha.slice(0,7)} · ${projectName}`, '<div class="skel" style="height:300px"></div>');
  try {
    const r = await fetch(`/api/commit?proj=${encodeURIComponent(projectName)}&sha=${encodeURIComponent(sha)}`);
    const data = await r.json();
    if (data.error) {
      $('#modal-body').innerHTML = `<div style="color:var(--red); padding: 20px;">${data.error}</div>`;
      return;
    }
    $('#modal-body').innerHTML = `<pre class="code-block">${highlightDiff(data.diff || '')}</pre>`;
  } catch {
    $('#modal-body').innerHTML = '<div style="color:var(--red); padding: 20px;">Failed to load diff</div>';
  }
}

async function openFile(projectName, path) {
  showModal(path, '<div class="skel" style="height:300px"></div>');
  try {
    const r = await fetch(`/api/file?proj=${encodeURIComponent(projectName)}&path=${encodeURIComponent(path)}`);
    const data = await r.json();
    if (data.error) {
      $('#modal-body').innerHTML = `<div style="color:var(--text3); padding: 24px; text-align: center;">
        <div style="font-size:14px;margin-bottom:8px">${data.error}</div>
        ${data.size ? `<div style="font-family:var(--font-mono);font-size:11px;color:var(--text2)">${fmt.bytes(data.size)}</div>` : ''}
      </div>`;
      return;
    }
    $('#modal-body').innerHTML = `
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text3);margin-bottom:12px;display:flex;justify-content:space-between">
        <span>${escapeHtml(data.path)}</span>
        <span>${data.lang} · ${fmt.bytes(data.size)}</span>
      </div>
      <pre class="code-block">${escapeHtml(data.content)}</pre>
    `;
  } catch {
    $('#modal-body').innerHTML = '<div style="color:var(--red); padding: 20px;">Failed to load file</div>';
  }
}

function highlightDiff(diff) {
  return escapeHtml(diff).split('\n').map(line => {
    if (line.startsWith('+') && !line.startsWith('+++')) return `<span class="add">${line}</span>`;
    if (line.startsWith('-') && !line.startsWith('---')) return `<span class="del">${line}</span>`;
    if (line.startsWith('@@')) return `<span class="hunk">${line}</span>`;
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')) {
      return `<span class="meta">${line}</span>`;
    }
    return line;
  }).join('\n');
}

function showModal(title, html) {
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  $('#modal-scrim').classList.add('open');
  $('#modal-card').classList.add('open');
}

function closeModal() {
  $('#modal-scrim').classList.remove('open');
  $('#modal-card').classList.remove('open');
}

// === Helpers ===
function attachTooltips(root) {
  $$('[data-tip]', root).forEach(el => {
    el.addEventListener('mouseenter', (e) => showTip(e, el.dataset.tip));
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('mousemove', moveTip);
  });
}

let tipEl = null;
function showTip(e, text) {
  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'tip';
    document.body.appendChild(tipEl);
  }
  tipEl.textContent = text;
  tipEl.classList.add('show');
  moveTip(e);
}
function moveTip(e) {
  if (!tipEl) return;
  const x = e.clientX + 14;
  const y = e.clientY + 14;
  tipEl.style.left = Math.min(window.innerWidth - 240, x) + 'px';
  tipEl.style.top = Math.min(window.innerHeight - 40, y) + 'px';
}
function hideTip() {
  if (tipEl) tipEl.classList.remove('show');
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const inInput = ['INPUT','TEXTAREA'].includes(document.activeElement.tagName);

    if (e.key === 'Escape') {
      if ($('#palette').classList.contains('open')) { closePalette(); return; }
      if ($('#modal-card').classList.contains('open')) { closeModal(); return; }
      if ($('#drawer').classList.contains('open')) { closeDrawer(); return; }
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      openPalette();
      return;
    }
    if (e.key === '/' && !inInput) {
      e.preventDefault();
      openPalette();
      return;
    }
    // drawer tab nav with arrows when drawer is open and not in input
    if ($('#drawer').classList.contains('open') && !inInput && !$('#palette').classList.contains('open')) {
      const tabs = $$('.drawer-tab');
      const idx = tabs.findIndex(t => t.classList.contains('active'));
      if (e.key === 'ArrowRight' && idx < tabs.length - 1) { tabs[idx+1].click(); e.preventDefault(); }
      if (e.key === 'ArrowLeft' && idx > 0) { tabs[idx-1].click(); e.preventDefault(); }
    }
    // palette nav
    if ($('#palette').classList.contains('open')) {
      if (e.key === 'ArrowDown') { e.preventDefault(); movePalette(1); }
      if (e.key === 'ArrowUp') { e.preventDefault(); movePalette(-1); }
      if (e.key === 'Enter') { e.preventDefault(); selectPalette(); }
    }
  });
}

function setupSearch() {
  const input = $('#search-input');
  if (!input) return;
  // turn the topbar search into a palette trigger
  input.addEventListener('focus', () => {
    input.blur();
    openPalette();
  });
  $('#search-trigger').addEventListener('click', () => openPalette());
}

function setupFilters() {
  $$('.filter-pill').forEach(el => {
    el.addEventListener('click', () => {
      $$('.filter-pill').forEach(p => p.classList.remove('active'));
      el.classList.add('active');
      state.filter = el.dataset.status;
      if (state.data) renderProjects(state.data);
    });
  });
  const sel = $('#sort-select');
  if (sel) sel.addEventListener('change', () => {
    state.sort = sel.value;
    if (state.data) renderProjects(state.data);
  });
}

// === Live clock ===
function startClock() {
  const update = () => {
    const el = $('#clock');
    if (!el) return;
    const d = new Date();
    const day = d.toLocaleDateString(undefined, { weekday: 'short' });
    const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    el.innerHTML = `<span class="tc-day">${day} ${date}</span><span class="tc-time">${time}</span>`;
  };
  update();
  setInterval(update, 1000);
}

// === Toast ===
function showToast(type, message, ms = 2400) {
  const stack = $('#toast-stack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = { success: '✓', error: '!', info: 'i' }[type] || '·';
  el.innerHTML = `<div class="toast-icon">${icon}</div><div>${escapeHtml(message)}</div>`;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 300);
  }, ms);
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// === Command palette ===
function openPalette() {
  $('#palette-scrim').classList.add('open');
  $('#palette').classList.add('open');
  $('#palette-input').value = '';
  state.paletteSel = 0;
  buildPalette('');
  setTimeout(() => $('#palette-input').focus(), 50);
}
function closePalette() {
  $('#palette-scrim').classList.remove('open');
  $('#palette').classList.remove('open');
}
function setupPalette() {
  const input = $('#palette-input');
  input.addEventListener('input', (e) => {
    state.paletteSel = 0;
    buildPalette(e.target.value);
  });
}
function buildPalette(q) {
  if (!state.data) return;
  q = q.toLowerCase().trim();
  const items = [];
  for (const p of state.data.projects || []) {
    const score = q ? (p.name.toLowerCase().includes(q) ? 1 : (p.description||'').toLowerCase().includes(q) ? 0.5 : 0) : 1;
    if (score > 0) {
      items.push({
        kind: 'project',
        title: p.name,
        sub: p.description || p.in_progress || '—',
        action: () => { closePalette(); openDrawer(p.name); },
      });
    }
  }
  for (const c of state.data.recent_commits || []) {
    const score = q ? (c.subject.toLowerCase().includes(q) ? 1 : 0) : (q ? 0 : 0.3);
    if (score > 0) {
      items.push({
        kind: 'commit',
        title: c.subject,
        sub: `${c.project} · ${c.short} · ${fmt.ago(c.timestamp)}`,
        action: () => { closePalette(); openCommit(c.project, c.sha); },
      });
    }
  }
  state.paletteItems = items.slice(0, 30);
  renderPalette();
}
function renderPalette() {
  const wrap = $('#palette-results');
  if (!state.paletteItems.length) {
    wrap.innerHTML = '<div class="palette-empty">No matches</div>';
    return;
  }
  const icons = { project: '◉', commit: '⎇', file: '·' };
  wrap.innerHTML = state.paletteItems.map((it, i) => `
    <div class="palette-item ${i === state.paletteSel ? 'selected' : ''}" data-i="${i}">
      <div class="palette-item-icon">${icons[it.kind] || '·'}</div>
      <div class="palette-item-body">
        <div class="palette-item-title">${escapeHtml(it.title)}</div>
        <div class="palette-item-sub">${escapeHtml(it.sub)}</div>
      </div>
      <div class="palette-item-kind">${it.kind}</div>
    </div>
  `).join('');
  $$('.palette-item', wrap).forEach(el => {
    el.addEventListener('click', () => {
      state.paletteSel = parseInt(el.dataset.i, 10);
      selectPalette();
    });
    el.addEventListener('mouseenter', () => {
      state.paletteSel = parseInt(el.dataset.i, 10);
      $$('.palette-item').forEach(p => p.classList.remove('selected'));
      el.classList.add('selected');
    });
  });
}
function movePalette(d) {
  const n = state.paletteItems.length;
  if (!n) return;
  state.paletteSel = (state.paletteSel + d + n) % n;
  renderPalette();
  const sel = $('.palette-item.selected');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function selectPalette() {
  const it = state.paletteItems[state.paletteSel];
  if (it) it.action();
}

// === Refresh time-ago strings without re-rendering everything ===
function refreshTimes() {
  if (state.data) renderCommitFeed(state.data);
}

// === Scroll-reveal animation for tiles ===
// Adds .revealed class when a tile enters the viewport. One-shot per element.
// Runs once at startup + after each render pass (idempotent via data-revealed).
function setupScrollReveal() {
  if (!('IntersectionObserver' in window)) {
    // Older browsers: just mark everything revealed immediately.
    $$('.tile, .stat-card').forEach(el => el.classList.add('revealed'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        io.unobserve(entry.target);
      }
    }
  }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });

  const observe = () => {
    $$('.tile:not([data-reveal-observed]), .stat-card:not([data-reveal-observed])').forEach((el, i) => {
      el.dataset.revealObserved = '1';
      el.style.setProperty('--reveal-delay', `${Math.min(i * 40, 400)}ms`);
      io.observe(el);
    });
  };
  observe();
  // Re-observe any new tiles that appear after a render pass.
  const mo = new MutationObserver(() => observe());
  mo.observe(document.body, { childList: true, subtree: true });
}

// === Drawer scroll shadow ===
function setupDrawerScroll() {
  const body = $('#drawer-body');
  if (!body) return;
  body.addEventListener('scroll', () => {
    const scrolled = body.scrollTop > 4;
    $('#drawer .drawer-header')?.classList.toggle('scrolled', scrolled);
    $('#drawer .drawer-tabs')?.classList.toggle('scrolled', scrolled);
  });
}

// === Evaluation chip ===
function renderEvalChip(ev) {
  if (!ev || typeof ev.score !== 'number') return '';
  const score = ev.score;
  let cls = 'eval-low';
  if (score >= 90) cls = 'eval-great';
  else if (score >= 75) cls = 'eval-good';
  else if (score >= 60) cls = 'eval-ok';
  return `<div class="pc-stat eval ${cls}" data-tip="Evaluation score (heuristic: ${ev.heuristic_score ?? '—'}${ev.llm_score != null ? `, LLM: ${ev.llm_score}` : ''})">★ <strong>${score}</strong></div>`;
}

// === Project action buttons ===
async function handleProjectAction(action, name, btn) {
  if (!action || !name) return;

  if (action === 'archive') {
    if (!confirm(`Archive "${name}"? It will be moved to _archive/ (reversible).`)) return;
  }

  const originalText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '…';
  }

  try {
    const r = await fetch(`/api/project/${encodeURIComponent(name)}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const data = await r.json();
    if (!r.ok || data.ok === false) {
      throw new Error(data.error || `${action} failed`);
    }
    toast(`${actionLabel(action)} — ${name}`, 'success');
    if (action === 'evaluate' && data.evaluation) {
      toast(`Score: ${data.evaluation.score}/100`, 'info');
    }
    if (action === 'archive') {
      closeDrawer();
      load();
    }
  } catch (err) {
    toast(`Failed: ${err.message || action}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

function actionLabel(action) {
  return ({ resume: 'Terminal opened', polish: 'Polish session opened', evaluate: 'Evaluated', archive: 'Archived' })[action] || action;
}

// === Toast helper ===
function toast(message, kind = 'info') {
  const stack = $('#toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  }, 3500);
}

// === Token Usage tile ===
// Pure information, no quota / ceiling concept. The user has Max — there's no
// billing. This tile shows what the Claude Code transcripts say you've used.
function renderQuota(q) {
  const el = $('#quota-tile');
  if (!el) return;
  if (q.error) {
    el.innerHTML = `<div class="tile-header"><div class="tile-title">Token Usage</div></div><div class="quota-empty">unavailable</div>`;
    return;
  }
  const weekly = q.weekly || {};
  const all = q.all_time || {};

  const weeklyTotal = weekly.total_tokens || 0;
  const weeklyMsgs = weekly.messages || 0;

  // Per-project top 3 for the week
  const perProj = Object.entries(q.per_project || {})
    .filter(([_, v]) => (v.total_tokens || 0) > 0)
    .sort((a, b) => (b[1].total_tokens || 0) - (a[1].total_tokens || 0))
    .slice(0, 5);

  // Stacked bar: proportions of input/output/cache-write/cache-read
  const segments = [
    { key: 'input',      val: weekly.input_tokens || 0,          color: 'var(--cyan)',   label: 'Input' },
    { key: 'output',     val: weekly.output_tokens || 0,         color: 'var(--green)',  label: 'Output' },
    { key: 'cache_w',    val: weekly.cache_creation_tokens || 0, color: 'var(--amber)',  label: 'Cache write' },
    { key: 'cache_r',    val: weekly.cache_read_tokens || 0,     color: 'var(--purple)', label: 'Cache read' },
  ];
  const segTotal = segments.reduce((s, x) => s + x.val, 0) || 1;

  el.innerHTML = `
    <div class="tile-header">
      <div class="tile-title">Token Usage · 7d</div>
      <div class="tile-sub">${fmt.num(weeklyMsgs)} messages across ${Object.keys(q.per_project || {}).length} projects</div>
    </div>
    <div class="usage-body">
      <div class="usage-big">
        <div class="usage-big-num">${fmt.num(weeklyTotal)}</div>
        <div class="usage-big-label">tokens this week</div>
      </div>
      <div class="usage-bar" role="img" aria-label="Token breakdown">
        ${segments.map(s => `
          <div class="usage-bar-seg"
               style="flex:${Math.max(0.001, s.val/segTotal)};background:${s.color}"
               data-tip="${s.label}: ${fmt.num(s.val)} (${Math.round(s.val/segTotal*100)}%)"></div>
        `).join('')}
      </div>
      <div class="usage-legend">
        ${segments.map(s => `
          <div class="usage-legend-item">
            <span class="usage-dot" style="background:${s.color}"></span>
            <span class="usage-legend-label">${s.label}</span>
            <span class="usage-legend-val">${fmt.num(s.val)}</span>
          </div>
        `).join('')}
      </div>
      ${perProj.length ? `
        <div class="usage-projects">
          <div class="usage-projects-title">Top projects · 7d</div>
          ${perProj.map(([name, v]) => {
            const pct = Math.round((v.total_tokens || 0) / weeklyTotal * 100);
            return `
              <div class="usage-project-row" data-name="${escapeAttr(name)}">
                <span class="usage-project-name">${escapeHtml(name)}</span>
                <span class="usage-project-bar"><span style="width:${pct}%"></span></span>
                <span class="usage-project-pct">${pct}%</span>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}
      <div class="usage-footer">
        <span>All-time: ${fmt.num(all.total_tokens || 0)}</span>
        <span class="usage-footer-dot">·</span>
        <span>${fmt.num(all.messages || 0)} msgs</span>
      </div>
    </div>
  `;

  // Per-project row click → open project drawer
  $$('.usage-project-row', el).forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => openDrawer(row.dataset.name));
  });
  attachTooltips(el);
}

// === Wishlist panel ===
async function openWishlist() {
  $('#wishlist-scrim')?.classList.add('open');
  $('#wishlist-panel')?.classList.add('open');
  await refreshWishlist();
}

function closeWishlist() {
  $('#wishlist-scrim')?.classList.remove('open');
  $('#wishlist-panel')?.classList.remove('open');
}

async function refreshWishlist() {
  const list = $('#wishlist-list');
  if (!list) return;
  list.innerHTML = '<div class="wishlist-empty">loading…</div>';
  try {
    const r = await fetch('/api/wishlist', { cache: 'no-store' });
    const data = await r.json();
    renderWishlistItems(data);
  } catch {
    list.innerHTML = '<div class="wishlist-empty">failed to load</div>';
  }
}

function renderWishlistItems(data) {
  const list = $('#wishlist-list');
  if (!list) return;
  const unused = data.unused || [];
  const used = data.used || [];

  if (!unused.length && !used.length) {
    list.innerHTML = '<div class="wishlist-empty">No ideas yet. Add one above.</div>';
    return;
  }

  const unusedHtml = unused.map(item => `
    <div class="wishlist-item">
      <span class="wishlist-item-text">${escapeHtml(item)}</span>
      <button class="wishlist-remove" data-item="${escapeAttr(item)}" title="Remove">×</button>
    </div>
  `).join('');

  const usedHtml = used.map(item => `
    <div class="wishlist-item used">
      <span class="wishlist-item-text">${escapeHtml(item)}</span>
    </div>
  `).join('');

  list.innerHTML = `
    <div class="wishlist-section">
      <div class="wishlist-section-title">Unused · ${unused.length}</div>
      ${unusedHtml || '<div class="wishlist-empty">none</div>'}
    </div>
    ${used.length ? `
      <div class="wishlist-section">
        <div class="wishlist-section-title">Used · ${used.length}</div>
        ${usedHtml}
      </div>
    ` : ''}
  `;

  $$('.wishlist-remove', list).forEach(btn => {
    btn.addEventListener('click', async () => {
      const item = btn.dataset.item;
      btn.disabled = true;
      try {
        await fetch('/api/wishlist', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item }),
        });
        refreshWishlist();
      } catch {
        btn.disabled = false;
        toast('Failed to remove', 'error');
      }
    });
  });
}

async function addWishlistItem() {
  const input = $('#wishlist-input');
  if (!input) return;
  const item = input.value.trim();
  if (!item) return;
  input.disabled = true;
  try {
    await fetch('/api/wishlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item }),
    });
    input.value = '';
    refreshWishlist();
  } catch {
    toast('Failed to add', 'error');
  } finally {
    input.disabled = false;
    input.focus();
  }
}

// === Day detail ===
async function openDayDetail(dateStr) {
  if (!dateStr) return;
  openModalEmpty(`Activity · ${dateStr}`);
  try {
    const r = await fetch(`/api/day?date=${encodeURIComponent(dateStr)}`, { cache: 'no-store' });
    const data = await r.json();
    if (data.error || !data.projects || !data.projects.length) {
      $('#modal-body').innerHTML = `<div class="empty-state">No commits on ${escapeHtml(dateStr)}.</div>`;
      return;
    }
    renderDayDetail(data);
  } catch {
    $('#modal-body').innerHTML = '<div class="empty-state err">Failed to load day detail.</div>';
  }
}

function renderDayDetail(data) {
  const t = data.totals || {};
  const timeline = data.timeline || [];
  const hourly = data.hourly || [];
  const maxHour = Math.max(1, ...hourly);

  const hourBars = hourly.map((n, h) => `
    <div class="day-hour" style="--i:${h}" data-tip="${String(h).padStart(2, '0')}:00 — ${n} commits">
      <div class="day-hour-bar" style="--h:${Math.round((n / maxHour) * 100)}%;--i:${h}"></div>
      <div class="day-hour-label">${h % 6 === 0 ? String(h).padStart(2, '0') : ''}</div>
    </div>
  `).join('');

  const timelineItems = timeline.map((c, i) => {
    const dt = new Date(c.timestamp * 1000);
    const hh = String(dt.getHours()).padStart(2, '0');
    const mm = String(dt.getMinutes()).padStart(2, '0');
    return `
      <div class="timeline-item" style="--i:${i}" data-sha="${c.sha}" data-proj="${escapeAttr(c.project)}">
        <div class="timeline-time">${hh}:${mm}</div>
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div class="timeline-subject">${escapeHtml(c.subject)}</div>
          <div class="timeline-meta">
            <span class="timeline-proj">${escapeHtml(c.project)}</span>
            <span class="timeline-stat add">+${fmt.num(c.additions)}</span>
            <span class="timeline-stat del">−${fmt.num(c.deletions)}</span>
            <span class="timeline-files">${c.files_changed} file${c.files_changed === 1 ? '' : 's'}</span>
            <span class="timeline-sha">${c.short}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  const projectRows = (data.projects || []).map(p => `
    <div class="day-proj-row" data-name="${escapeAttr(p.name)}">
      <span class="day-proj-name">${escapeHtml(p.name)}</span>
      <span class="day-proj-commits">${p.commit_count} commits</span>
      <span class="day-proj-stat add">+${fmt.num(p.additions)}</span>
      <span class="day-proj-stat del">−${fmt.num(p.deletions)}</span>
    </div>
  `).join('');

  $('#modal-body').innerHTML = `
    <div class="day-summary">
      <div class="day-summary-item">
        <div class="day-summary-num">${t.commits || 0}</div>
        <div class="day-summary-label">commits</div>
      </div>
      <div class="day-summary-item">
        <div class="day-summary-num add">+${fmt.num(t.additions || 0)}</div>
        <div class="day-summary-label">additions</div>
      </div>
      <div class="day-summary-item">
        <div class="day-summary-num del">−${fmt.num(t.deletions || 0)}</div>
        <div class="day-summary-label">deletions</div>
      </div>
      <div class="day-summary-item">
        <div class="day-summary-num">${t.files || 0}</div>
        <div class="day-summary-label">files touched</div>
      </div>
    </div>

    <div class="day-section-title">By hour</div>
    <div class="day-hours">${hourBars}</div>

    <div class="day-section-title">Timeline · ${timeline.length} commits</div>
    <div class="day-timeline">${timelineItems}</div>

    <div class="day-section-title">Projects</div>
    <div class="day-projects">${projectRows}</div>
  `;

  // Click a timeline commit → open commit diff viewer (reuses existing /api/commit)
  $$('.timeline-item', $('#modal-body')).forEach(row => {
    row.addEventListener('click', () => {
      const sha = row.dataset.sha;
      const proj = row.dataset.proj;
      if (sha && proj) openCommitDiff(proj, sha);
    });
  });
  $$('.day-proj-row', $('#modal-body')).forEach(row => {
    row.addEventListener('click', () => openDrawer(row.dataset.name));
  });
  attachTooltips($('#modal-body'));
}

async function openCommitDiff(proj, sha) {
  try {
    const r = await fetch(`/api/commit?proj=${encodeURIComponent(proj)}&sha=${encodeURIComponent(sha)}`);
    if (!r.ok) return;
    const data = await r.json();
    if (!data || !data.diff) return;
    openModalEmpty(`${proj} · ${sha.substring(0, 7)}`);
    $('#modal-body').innerHTML = `<pre class="commit-diff">${escapeHtml(data.diff)}</pre>`;
  } catch {}
}

// === Stat card drill-downs ===
function openStatDetail(which) {
  const d = state.data;
  if (!d) return;
  if (which === 'streak') return renderStreakDetail(d);
  if (which === 'shipped') return renderShippedDetail(d);
  if (which === 'commits') return renderCommitsDetail(d);
}

function renderStreakDetail(d) {
  openModalEmpty(`Streak · ${d.streak} day${d.streak === 1 ? '' : 's'}`);
  const cal = d.streak_calendar || [];
  const last60 = cal.slice(-60);
  const max = Math.max(1, ...last60.map(c => c.count));

  const bars = last60.map((day, i) => {
    const h = Math.round((day.count / max) * 100);
    return `
      <div class="streak-col" style="--i:${i}" data-tip="${day.date}: ${day.count} commits" data-date="${day.date}" data-count="${day.count}">
        <div class="streak-col-bar" style="--h:${h}%"></div>
        <div class="streak-col-day">${day.date.slice(-2)}</div>
      </div>
    `;
  }).join('');

  $('#modal-body').innerHTML = `
    <div class="stat-detail-intro">
      You've committed on ${d.streak} day${d.streak === 1 ? '' : 's'} in a row.
      Last 60 days below — click any bar to see that day's activity.
    </div>
    <div class="streak-chart">${bars}</div>
  `;

  $$('.streak-col', $('#modal-body')).forEach(col => {
    if (Number(col.dataset.count) > 0) {
      col.style.cursor = 'pointer';
      col.addEventListener('click', () => openDayDetail(col.dataset.date));
    }
  });
  attachTooltips($('#modal-body'));
}

function renderShippedDetail(d) {
  const shipped = (d.projects || []).filter(p =>
    p.status === 'COMPLETE' || p.authoritative_status === 'shipped'
  );
  openModalEmpty(`Shipped · ${shipped.length} project${shipped.length === 1 ? '' : 's'}`);

  const rows = shipped.map((p, i) => {
    const ev = p.evaluation || {};
    const score = typeof ev.score === 'number' ? ev.score : null;
    const scoreCls = score == null ? '' : score >= 90 ? 'eval-great' : score >= 75 ? 'eval-good' : score >= 60 ? 'eval-ok' : 'eval-low';
    return `
      <div class="shipped-row" style="--i:${i}" data-name="${escapeAttr(p.name)}">
        <div class="shipped-name">
          ${escapeHtml(p.name)}
          ${score != null ? `<span class="shipped-eval ${scoreCls}">★ ${score}</span>` : ''}
        </div>
        <div class="shipped-desc">${escapeHtml(p.description || p.in_progress || '—')}</div>
        <div class="shipped-meta">
          <span>⎇ ${p.commit_count}</span>
          <span class="add">+${fmt.num(p.additions)}</span>
          <span class="del">−${fmt.num(p.deletions)}</span>
          ${p.github ? `<a href="${p.github}" target="_blank" rel="noopener" onclick="event.stopPropagation()">GitHub ↗</a>` : ''}
        </div>
      </div>
    `;
  }).join('');

  $('#modal-body').innerHTML = `
    <div class="stat-detail-intro">Every project that reached COMPLETE. Click any row to open details.</div>
    <div class="shipped-list">${rows || '<div class="empty-state">No shipped projects yet.</div>'}</div>
  `;

  $$('.shipped-row', $('#modal-body')).forEach(r => {
    r.addEventListener('click', () => {
      closeModal();
      openDrawer(r.dataset.name);
    });
  });
}

function renderCommitsDetail(d) {
  const velocity = d.velocity || [];
  const stats = d.cross_stats || {};
  openModalEmpty(`Commits · ${fmt.num(stats.total_commits || 0)} total`);

  const max = Math.max(1, ...velocity.map(v => v.count));
  const bars = velocity.map((v, i) => {
    const h = Math.round((v.count / max) * 100);
    return `
      <div class="velocity-col" style="--i:${i}" data-tip="${v.date}: ${v.count} commits" data-date="${v.date}" data-count="${v.count}">
        <div class="velocity-col-bar" style="--h:${h}%"></div>
      </div>
    `;
  }).join('');

  const recent = (d.recent_commits || []).slice(0, 30).map(c => {
    const dt = new Date(c.timestamp * 1000);
    const ago = fmt.ago(c.timestamp);
    return `
      <div class="recent-commit" data-sha="${c.sha}" data-proj="${escapeAttr(c.project)}">
        <div class="recent-commit-subject">${escapeHtml(c.subject)}</div>
        <div class="recent-commit-meta">
          <span>${escapeHtml(c.project)}</span>
          <span>${ago}</span>
          <span class="add">+${fmt.num(c.additions)}</span>
          <span class="del">−${fmt.num(c.deletions)}</span>
          <span class="recent-commit-sha">${c.short}</span>
        </div>
      </div>
    `;
  }).join('');

  $('#modal-body').innerHTML = `
    <div class="stat-detail-intro">Last 30 days of commit velocity. Click any bar for that day's details.</div>
    <div class="velocity-chart">${bars}</div>
    <div class="day-section-title">Recent commits</div>
    <div class="recent-commits">${recent}</div>
  `;

  $$('.velocity-col', $('#modal-body')).forEach(col => {
    if (Number(col.dataset.count) > 0) {
      col.style.cursor = 'pointer';
      col.addEventListener('click', () => openDayDetail(col.dataset.date));
    }
  });
  $$('.recent-commit', $('#modal-body')).forEach(r => {
    r.addEventListener('click', () => openCommitDiff(r.dataset.proj, r.dataset.sha));
  });
  attachTooltips($('#modal-body'));
}

// Generic modal opener used by all the detail views above.
function openModalEmpty(title) {
  $('#modal-scrim').classList.add('open');
  $('#modal-card').classList.add('open');
  $('#modal-title').innerHTML = `<div class="modal-title-text">${escapeHtml(title)}</div>`;
  $('#modal-body').innerHTML = '<div class="empty-state">Loading…</div>';
}

// =====================================================================
// Activity tile drilldowns
// =====================================================================
// Each Activity tile now opens a rich detail modal with extra charts,
// toggles, and clickable rows. Wired by attachActivityDrilldowns()
// which is idempotent and called on every render so dynamically-added
// tiles still get handlers.

function attachActivityDrilldowns() {
  const tiles = [
    { id: 'quota-tile', open: openQuotaDetail },
    { sel: '.tile-title', match: t => t.textContent.trim().startsWith('Activity Calendar'), open: () => openCalendarDetail() },
    { sel: '.tile-title', match: t => t.textContent.trim() === 'Languages', open: () => openLanguagesDetail() },
    { sel: '.tile-title', match: t => t.textContent.trim().startsWith('Velocity'), open: () => openVelocityDetail() },
    { sel: '.tile-title', match: t => t.textContent.trim() === 'When you build', open: () => openHeatmapDetail() },
    { sel: '.tile-title', match: t => t.textContent.trim() === 'Recent Commits', open: () => openCommitsLogDetail() },
  ];
  tiles.forEach(spec => {
    let tile = null;
    if (spec.id) {
      tile = document.getElementById(spec.id);
    } else if (spec.sel && spec.match) {
      const cand = $$(spec.sel).find(spec.match);
      tile = cand?.closest('.tile');
    }
    if (!tile || tile.dataset.drilldownWired) return;
    tile.dataset.drilldownWired = '1';
    tile.classList.add('tile-clickable');
    tile.addEventListener('click', (e) => {
      // Skip if click landed on an inner clickable child (commit row, project row)
      if (e.target.closest('.feed-item, .quota-row, button, a')) return;
      spec.open();
    });
  });
}

async function openQuotaDetail() {
  let q = state.quota;
  if (!q) {
    openModalEmpty('Token Usage · loading…');
    try {
      const r = await fetch('/api/quota', { cache: 'no-store' });
      q = r.ok ? await r.json() : null;
      state.quota = q;
    } catch { q = null; }
    if (!q) {
      $('#modal-body').innerHTML = '<div class="empty-state">Could not load quota data.</div>';
      return;
    }
  }
  openModalEmpty(`Token Usage · ${fmt.num(q.weekly?.total_tokens || 0)} this week`);
  const w = q.weekly || {};
  const a = q.all_time || {};
  const pp = q.per_project || {};
  const top = Object.entries(pp)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => (b.total_tokens || 0) - (a.total_tokens || 0))
    .slice(0, 8);
  const maxProj = Math.max(1, ...top.map(p => p.total_tokens || 0));
  // Anthropic Sonnet 4.6: $3/M input, $15/M output, $3.75/M cache write, $0.30/M cache read
  const cost = (v) => (
    (v.input_tokens || 0) * 3 / 1_000_000 +
    (v.output_tokens || 0) * 15 / 1_000_000 +
    (v.cache_creation_tokens || 0) * 3.75 / 1_000_000 +
    (v.cache_read_tokens || 0) * 0.30 / 1_000_000
  );
  $('#modal-body').innerHTML = `
    <div class="dr-mini-grid">
      <div class="dr-mini"><div class="dr-mini-label">This Week</div><div class="dr-mini-value">${fmt.num(w.total_tokens || 0)}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Messages</div><div class="dr-mini-value">${fmt.num(w.messages || 0)}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">All-time</div><div class="dr-mini-value">${fmt.num(a.total_tokens || 0)}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Est. cost / wk</div><div class="dr-mini-value">$${cost(w).toFixed(2)}</div></div>
    </div>

    <div class="dr-section">
      <div class="dr-section-title">This week — token mix</div>
      <div class="quota-mix">
        ${[
          ['Input', w.input_tokens, 'oklch(72% 0.18 250)'],
          ['Output', w.output_tokens, 'oklch(70% 0.20 270)'],
          ['Cache write', w.cache_creation_tokens, 'oklch(74% 0.18 200)'],
          ['Cache read', w.cache_read_tokens, 'oklch(76% 0.18 160)'],
        ].map(([label, v, color]) => {
          const total = w.total_tokens || 1;
          const pct = ((v || 0) / total) * 100;
          return `
            <div class="quota-mix-row">
              <div class="quota-mix-label"><span class="quota-mix-dot" style="background:${color}"></span>${label}</div>
              <div class="quota-mix-bar"><div style="width:${pct}%;background:${color}"></div></div>
              <div class="quota-mix-value">${fmt.num(v || 0)}</div>
              <div class="quota-mix-pct">${pct.toFixed(1)}%</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>

    <div class="dr-section">
      <div class="dr-section-title">Top projects · by burn</div>
      <div class="quota-projects">
        ${top.map((p, i) => {
          const pct = ((p.total_tokens || 0) / maxProj) * 100;
          return `
            <div class="quota-proj-row" data-name="${escapeAttr(p.name)}" style="--i:${i}">
              <div class="quota-proj-name">${escapeHtml(p.name)}</div>
              <div class="quota-proj-bar"><div style="width:${pct}%"></div></div>
              <div class="quota-proj-value">${fmt.num(p.total_tokens || 0)}</div>
              <div class="quota-proj-cost">$${cost(p).toFixed(2)}</div>
            </div>
          `;
        }).join('')}
      </div>
    </div>
  `;
  $$('.quota-proj-row').forEach(el => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      closeModal();
      setTimeout(() => openDrawer(el.dataset.name), 200);
    });
  });
}

function openCalendarDetail() {
  const d = state.data;
  if (!d) return;
  const cal = d.streak_calendar || [];
  const last90 = cal.slice(-90);
  const max = Math.max(1, ...last90.map(c => c.count));
  const totalCommits = last90.reduce((s, c) => s + c.count, 0);
  const activeDays = last90.filter(c => c.count > 0).length;
  const longestStreak = (() => {
    let best = 0, cur = 0;
    for (const day of cal) { if (day.count > 0) { cur++; best = Math.max(best, cur); } else cur = 0; }
    return best;
  })();
  openModalEmpty(`Activity · ${cal.length} days tracked`);
  $('#modal-body').innerHTML = `
    <div class="dr-mini-grid">
      <div class="dr-mini"><div class="dr-mini-label">Last 90d</div><div class="dr-mini-value">${totalCommits}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Active days</div><div class="dr-mini-value">${activeDays}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Current streak</div><div class="dr-mini-value">${d.streak}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Longest streak</div><div class="dr-mini-value">${longestStreak}</div></div>
    </div>
    <div class="dr-section">
      <div class="dr-section-title">Last 90 days · click any day</div>
      <div class="streak-chart">
        ${last90.map((day, i) => {
          const h = Math.round((day.count / max) * 100);
          return `<div class="streak-col" style="--i:${i}" data-tip="${day.date}: ${day.count} commits" data-date="${day.date}" data-count="${day.count}"><div class="streak-col-bar" style="--h:${Math.max(h, day.count > 0 ? 4 : 0)}%"></div><div class="streak-col-day">${day.date.slice(-2)}</div></div>`;
        }).join('')}
      </div>
    </div>
  `;
  $$('.streak-col', $('#modal-body')).forEach(col => {
    if (Number(col.dataset.count) > 0) {
      col.style.cursor = 'pointer';
      col.addEventListener('click', () => openDayDetail(col.dataset.date));
    }
  });
  attachTooltips($('#modal-body'));
}

function openLanguagesDetail() {
  const langs = (state.data?.cross_stats?.languages) || [];
  if (!langs.length) return;
  openModalEmpty('Languages · portfolio breakdown');
  let mode = 'lines';
  const total = (key) => langs.reduce((s, l) => s + (l[key] || 0), 0);
  const render = () => {
    const totalLines = total('lines');
    const totalFiles = total('count');
    const display = langs.slice(0, 12);
    const denom = total(mode === 'lines' ? 'lines' : 'count');
    $('#modal-body').innerHTML = `
      <div class="lang-mode-tabs">
        <button class="lang-tab ${mode === 'lines' ? 'active' : ''}" data-mode="lines">Lines of code</button>
        <button class="lang-tab ${mode === 'files' ? 'active' : ''}" data-mode="files">File count</button>
      </div>
      <div class="dr-mini-grid">
        <div class="dr-mini"><div class="dr-mini-label">Languages</div><div class="dr-mini-value">${langs.length}</div></div>
        <div class="dr-mini"><div class="dr-mini-label">Total LOC</div><div class="dr-mini-value">${fmt.num(totalLines)}</div></div>
        <div class="dr-mini"><div class="dr-mini-label">Total files</div><div class="dr-mini-value">${fmt.num(totalFiles)}</div></div>
        <div class="dr-mini"><div class="dr-mini-label">Top</div><div class="dr-mini-value" style="color:${langs[0]?.color || '#fff'};font-size:18px">${langs[0]?.lang || '—'}</div></div>
      </div>
      <div class="dr-section">
        <div class="dr-section-title">Distribution</div>
        <div class="lang-bars">
          ${display.map(l => {
            const v = mode === 'lines' ? (l.lines || 0) : (l.count || 0);
            const pct = denom ? (v / denom) * 100 : 0;
            return `
              <div class="lang-row">
                <span class="lang-dot" style="background:${l.color}"></span>
                <span class="lang-name">${escapeHtml(l.lang)}</span>
                <div class="lang-bar-wrap"><div class="lang-bar-fill" style="width:${pct}%; background:${l.color}"></div></div>
                <span class="lang-pct">${fmt.num(v)} ${mode === 'lines' ? 'L' : 'files'} · ${pct.toFixed(1)}%</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    $$('.lang-tab').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
  };
  render();
}

function openVelocityDetail() {
  const v = state.data?.velocity || [];
  if (!v.length) return;
  openModalEmpty(`Velocity · last ${v.length} days`);
  const counts = v.map(d => d.count);
  const totalCommits = counts.reduce((s, n) => s + n, 0);
  const max = Math.max(1, ...counts);
  const peakDay = v.reduce((best, d) => (d.count > best.count ? d : best), { count: 0, date: '' });
  // 7-day rolling avg
  const rolling = counts.map((_, i) => {
    const slice = counts.slice(Math.max(0, i - 6), i + 1);
    return slice.reduce((s, n) => s + n, 0) / slice.length;
  });
  const rollMax = Math.max(1, ...rolling);
  const half = Math.floor(v.length / 2);
  const recent = counts.slice(half).reduce((s, n) => s + n, 0);
  const prior = counts.slice(0, half).reduce((s, n) => s + n, 0);
  const delta = prior ? Math.round(((recent - prior) / prior) * 100) : 0;
  $('#modal-body').innerHTML = `
    <div class="dr-mini-grid">
      <div class="dr-mini"><div class="dr-mini-label">Total commits</div><div class="dr-mini-value">${totalCommits}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Per day avg</div><div class="dr-mini-value">${(totalCommits / v.length).toFixed(1)}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Peak day</div><div class="dr-mini-value" style="font-size:18px">${peakDay.count}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Δ vs. prior</div><div class="dr-mini-value" style="color:${delta >= 0 ? 'var(--green)' : 'var(--amber)'}">${delta >= 0 ? '+' : ''}${delta}%</div></div>
    </div>
    <div class="dr-section">
      <div class="dr-section-title">Daily commits · 7-day rolling overlay</div>
      <div class="velocity-detail">
        <svg viewBox="0 0 ${v.length * 22} 240" preserveAspectRatio="none" style="width:100%;height:240px">
          ${v.map((d, i) => {
            const h = (d.count / max) * 200;
            const x = i * 22;
            return `<rect x="${x + 2}" y="${220 - h}" width="18" height="${h}" rx="3" fill="url(#velgrad)" data-tip="${d.date}: ${d.count} commits" data-date="${d.date}" data-count="${d.count}" class="vel-bar"/>`;
          }).join('')}
          <defs>
            <linearGradient id="velgrad" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="oklch(78% 0.18 220)"/>
              <stop offset="100%" stop-color="oklch(58% 0.20 270)"/>
            </linearGradient>
          </defs>
          <polyline points="${rolling.map((r, i) => `${i * 22 + 11},${220 - (r / rollMax) * 200}`).join(' ')}"
            fill="none" stroke="oklch(82% 0.16 320)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
        </svg>
      </div>
    </div>
  `;
  $$('.vel-bar', $('#modal-body')).forEach(bar => {
    if (Number(bar.dataset.count) > 0) {
      bar.style.cursor = 'pointer';
      bar.addEventListener('click', () => openDayDetail(bar.dataset.date));
    }
  });
  attachTooltips($('#modal-body'));
}

function openHeatmapDetail() {
  const hm = state.data?.heatmap;
  if (!hm) return;
  openModalEmpty('When you build · 7d × 24h');
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let max = 0, peakHour = 0, peakDay = 0;
  hm.forEach((row, di) => row.forEach((v, hi) => {
    if (v > max) { max = v; peakHour = hi; peakDay = di; }
  }));
  const totalByHour = Array(24).fill(0);
  const totalByDay = Array(7).fill(0);
  hm.forEach((row, di) => row.forEach((v, hi) => { totalByHour[hi] += v; totalByDay[di] += v; }));
  // Deep work stretches: per day, count runs of >=3 consecutive nonzero hours
  let stretches = 0;
  hm.forEach(row => {
    let run = 0;
    row.forEach(v => { if (v > 0) { run++; if (run === 3) stretches++; } else run = 0; });
  });
  const cellHtml = hm.map((row, di) => row.map((v, hi) => {
    const intensity = max ? v / max : 0;
    const cls = intensity === 0 ? 'l0' : intensity < 0.25 ? 'l1' : intensity < 0.5 ? 'l2' : intensity < 0.75 ? 'l3' : 'l4';
    return `<div class="hmcell ${cls}" data-tip="${days[di]} ${String(hi).padStart(2,'0')}:00 — ${v} commits"></div>`;
  }).join('')).join('');
  $('#modal-body').innerHTML = `
    <div class="dr-mini-grid">
      <div class="dr-mini"><div class="dr-mini-label">Peak hour</div><div class="dr-mini-value">${String(peakHour).padStart(2,'0')}:00</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Peak day</div><div class="dr-mini-value" style="font-size:22px">${days[peakDay]}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Deep-work stretches</div><div class="dr-mini-value">${stretches}</div></div>
      <div class="dr-mini"><div class="dr-mini-label">Total commits</div><div class="dr-mini-value">${totalByHour.reduce((s, n) => s + n, 0)}</div></div>
    </div>
    <div class="dr-section">
      <div class="dr-section-title">Heatmap</div>
      <div class="hm-detail">
        <div class="hm-day-labels">${days.map(d => `<div>${d}</div>`).join('')}</div>
        <div class="hm-grid">${cellHtml}</div>
        <div class="hm-hour-labels">${[0,3,6,9,12,15,18,21].map(h => `<div>${String(h).padStart(2,'0')}</div>`).join('')}</div>
      </div>
    </div>
    <div class="dr-section">
      <div class="dr-section-title">Hour distribution</div>
      <div class="hm-hours">
        ${totalByHour.map((v, i) => {
          const pct = Math.max(...totalByHour) ? (v / Math.max(...totalByHour)) * 100 : 0;
          return `<div class="hm-hour-col"><div class="hm-hour-fill" style="height:${pct}%"></div><div class="hm-hour-label">${String(i).padStart(2,'0')}</div></div>`;
        }).join('')}
      </div>
    </div>
  `;
  attachTooltips($('#modal-body'));
}

function openCommitsLogDetail() {
  const commits = state.data?.recent_commits || [];
  openModalEmpty(`Recent Commits · ${commits.length}`);
  const projects = Array.from(new Set(commits.map(c => c.project)));
  let projFilter = 'all';
  const render = () => {
    const list = projFilter === 'all' ? commits : commits.filter(c => c.project === projFilter);
    $('#modal-body').innerHTML = `
      <div class="commit-filter-row">
        <button class="filter-pill ${projFilter === 'all' ? 'active' : ''}" data-proj="all">All · ${commits.length}</button>
        ${projects.map(p => `<button class="filter-pill ${projFilter === p ? 'active' : ''}" data-proj="${escapeAttr(p)}">${escapeHtml(p)}</button>`).join('')}
      </div>
      <div class="commit-list" style="max-height:540px;overflow-y:auto">
        ${list.map(c => `
          <div class="commit-row" data-proj="${escapeAttr(c.project)}" data-sha="${escapeAttr(c.sha)}">
            <div class="commit-info">
              <div class="commit-subject">${escapeHtml(c.subject)}</div>
              <div class="commit-meta">${escapeHtml(c.project)} · ${escapeHtml(c.author)} · ${fmt.ago(c.timestamp)} · ${c.files_changed} files</div>
            </div>
            <div class="commit-stats">
              <span class="commit-add">+${c.additions}</span>
              <span class="commit-del">−${c.deletions}</span>
            </div>
            <div class="commit-sha">${c.short}</div>
          </div>
        `).join('')}
      </div>
    `;
    $$('.commit-filter-row .filter-pill').forEach(b => b.addEventListener('click', () => { projFilter = b.dataset.proj; render(); }));
    $$('.commit-row', $('#modal-body')).forEach(row => {
      row.style.cursor = 'pointer';
      row.addEventListener('click', () => openCommitDiff(row.dataset.proj, row.dataset.sha));
    });
  };
  render();
}

window.reconnect = reconnect;
window.closeDrawer = closeDrawer;
window.closeModal = closeModal;
window.closePalette = closePalette;
window.openWishlist = openWishlist;
window.closeWishlist = closeWishlist;
window.addWishlistItem = addWishlistItem;
window.openDayDetail = openDayDetail;
init();
setupDrawerScroll();
setupScrollReveal();

/* ============================================================ */
/* === HF v2: rail nav, persistent reveal, tilt, ripple,  === */
/* ===        number ticker, wishlist counts, drag       === */
/* ============================================================ */

(() => {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // === A. Section rail navigation ============================
  const railBtns = Array.from(document.querySelectorAll('.rail-btn[data-target]'));
  const railIndicator = document.getElementById('rail-indicator');
  const sections = railBtns.map(b => document.getElementById(b.dataset.target)).filter(Boolean);

  function moveIndicator(btn) {
    if (!railIndicator || !btn) return;
    const top = btn.offsetTop;
    const height = btn.offsetHeight;
    railIndicator.style.top = `${top + 6}px`;
    railIndicator.style.height = `${height - 12}px`;
    railIndicator.classList.add('show');
  }

  function setActiveRail(targetId, scroll = true) {
    railBtns.forEach(b => {
      const on = b.dataset.target === targetId;
      b.classList.toggle('active', on);
      if (on) {
        b.setAttribute('aria-current', 'page');
        moveIndicator(b);
      } else {
        b.removeAttribute('aria-current');
      }
    });
    if (scroll) {
      const target = document.getElementById(targetId);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  railBtns.forEach(btn => {
    btn.addEventListener('click', () => setActiveRail(btn.dataset.target));
  });

  // === B. Scroll-driven section tracking + persistent reveal =
  const revealTargets = document.querySelectorAll('.tile, .stat-card, .hero-main, .section-head');
  revealTargets.forEach(el => el.classList.add('reveal'));

  if (!prefersReducedMotion && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          e.target.classList.remove('out');
        } else if (e.boundingClientRect.top > 0) {
          // Scrolled past below-the-fold — keep "out" so re-entry plays again.
          e.target.classList.remove('in');
          e.target.classList.add('out');
        }
        // We deliberately don't toggle "out" when scrolling above viewport;
        // that way reading flow upward isn't strobing animations.
      }
    }, { threshold: [0, 0.12], rootMargin: '0px 0px -10% 0px' });
    revealTargets.forEach(el => io.observe(el));
  } else {
    revealTargets.forEach(el => el.classList.add('in'));
  }

  // Section-in-view tracker for the rail
  if (sections.length) {
    const sio = new IntersectionObserver((entries) => {
      // Pick the entry with the largest intersection ratio.
      let best = null;
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
      }
      if (best) setActiveRail(best.target.id, false);
    }, { threshold: [0.2, 0.4, 0.6], rootMargin: '-80px 0px -40% 0px' });
    sections.forEach(s => sio.observe(s));
    // Initial position
    if (railBtns[0]) requestAnimationFrame(() => moveIndicator(railBtns[0]));
  }

  // === C. 3D tilt + spotlight follow =========================
  const tiltEls = document.querySelectorAll('[data-tilt]');
  const TILT_MAX = 6; // degrees

  function attachTilt(el) {
    if (prefersReducedMotion) return;
    el.addEventListener('pointermove', (ev) => {
      if (el.classList.contains('dragging')) return;
      const r = el.getBoundingClientRect();
      const px = (ev.clientX - r.left) / r.width;
      const py = (ev.clientY - r.top) / r.height;
      const rx = (0.5 - py) * 2 * TILT_MAX;
      const ry = (px - 0.5) * 2 * TILT_MAX;
      el.style.setProperty('--mx', `${px * 100}%`);
      el.style.setProperty('--my', `${py * 100}%`);
      el.style.setProperty('--tilt-x', `${rx}deg`);
      el.style.setProperty('--tilt-y', `${ry}deg`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--tilt-x', '0deg');
      el.style.setProperty('--tilt-y', '0deg');
    });
  }
  tiltEls.forEach(attachTilt);

  // === D. Click ripple ========================================
  function attachRipple(el) {
    el.addEventListener('pointerdown', (ev) => {
      if (el.classList.contains('dragging')) return;
      const r = el.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const size = Math.max(r.width, r.height) * 0.4;
      const ripple = document.createElement('span');
      ripple.className = 'ripple';
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.style.width = `${size}px`;
      ripple.style.height = `${size}px`;
      el.appendChild(ripple);
      // overflow:hidden via tile already; for stat-card add it
      el.style.overflow = el.style.overflow || 'hidden';
      setTimeout(() => ripple.remove(), 700);
    });
  }
  document.querySelectorAll('.tile, .stat-card, .hero-main').forEach(attachRipple);

  // === E. Number ticker for stat values =======================
  // Animate from previous numeric value to new one with eased interp.
  // Set a `_ticking` flag while animating so the MutationObserver below
  // ignores our own intermediate writes (otherwise rolling numbers look
  // like new targets and the ticker recurses to 0).
  const tickedEls = new WeakMap();
  function tickTo(el, target) {
    const raw = (target == null) ? '0' : String(target);
    const numMatch = raw.replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    if (!numMatch) {
      el._ticking = true; el.textContent = raw; el._ticking = false;
      return;
    }
    const goal = parseFloat(numMatch[0]);
    const prev = tickedEls.get(el) || 0;
    if (goal === prev) {
      el._ticking = true; el.textContent = raw; el._ticking = false;
      return;
    }
    if (prefersReducedMotion) {
      el._ticking = true; el.textContent = raw; el._ticking = false;
      tickedEls.set(el, goal);
      return;
    }
    const start = performance.now();
    const dur = 900;
    const isInt = !raw.includes('.');
    el.classList.add('flash');
    el._ticking = true;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const cur = prev + (goal - prev) * eased;
      el.textContent = isInt ? Math.round(cur).toLocaleString() : cur.toFixed(1);
      if (t < 1) requestAnimationFrame(tick);
      else {
        el.textContent = raw;
        el._ticking = false;
        tickedEls.set(el, goal);
        setTimeout(() => el.classList.remove('flash'), 800);
      }
    };
    requestAnimationFrame(tick);
  }

  // Watch the existing render() path which writes textContent directly,
  // and route those updates through the ticker. Skip intermediate
  // writes the ticker itself produced. Wishlist counts call tickTo
  // explicitly from loadWishlistCounts() — they don't need the observer.
  const tickerTargets = ['stat-streak', 'stat-completed', 'stat-projects', 'stat-commits', 'stat-additions'];
  tickerTargets.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    let last = el.textContent;
    const mo = new MutationObserver(() => {
      if (el._ticking) return;
      const v = el.textContent;
      if (v === last || v === '—') return;
      last = v;
      tickTo(el, v);
    });
    mo.observe(el, { childList: true, characterData: true, subtree: true });
  });

  // === F. Wishlist counts + preview ===========================
  async function loadWishlistCounts() {
    try {
      const r = await fetch('/api/wishlist', { cache: 'no-store' });
      if (!r.ok) return;
      const d = await r.json();
      const unused = (d.unused || []).length;
      const used = (d.used || []).length;
      const curated = (d.curated || []).length;
      const setNum = (id, n) => {
        const el = document.getElementById(id);
        if (!el) return;
        tickTo(el, String(n));
      };
      setNum('wcount-unused', unused);
      setNum('wcount-used', used);
      setNum('wcount-curated', curated);

      const preview = document.getElementById('wishlist-preview');
      if (preview) {
        const items = [];
        (d.unused || []).slice(0, 4).forEach(t => items.push({ kind: 'unused', text: t }));
        (d.curated || []).slice(0, 6).forEach(t => items.push({ kind: 'curated', text: t }));

        // Pull a short lead (≤ 60 chars or up to first ":" / "." / "—")
        // so the eye catches the IDEA before the prose. Helps the long
        // ones (LLM-generated 6-sentence blocks) read like cards instead
        // of paragraphs.
        const splitLead = (text) => {
          const trimmed = String(text || '').trim();
          if (!trimmed) return { lead: '', rest: '' };
          // Strip a leading "1. " / "- " enumeration if present
          const cleaned = trimmed.replace(/^\s*(?:\d+\.\s*|[-*•]\s*)/, '');
          const m = cleaned.match(/^([^.:—\n]{4,80})\s*[.:—]\s+(.+)$/s);
          if (m) return { lead: m[1].trim(), rest: m[2].trim() };
          if (cleaned.length <= 80) return { lead: cleaned, rest: '' };
          return { lead: cleaned.slice(0, 70).trim() + '…', rest: cleaned.slice(70).trim() };
        };

        preview.innerHTML = items.length
          ? items.map(it => {
              const { lead, rest } = splitLead(it.text);
              return `<div class="wishlist-preview-item ${it.kind}" title="${escapeAttr(it.text)}">
                <span class="dot"></span>
                <div class="body">
                  ${lead ? `<span class="lead">${escapeHtml(lead)}</span>` : ''}
                  ${rest ? escapeHtml(rest) : ''}
                </div>
              </div>`;
            }).join('')
          : '<div class="wishlist-preview-item"><span class="dot" style="background:var(--text3)"></span><div class="body">Wishlist is empty — click to add an idea.</div></div>';

        // Mark cards whose body actually overflowed (clamping kicked in)
        // so the fade-gradient only appears when there's hidden content.
        requestAnimationFrame(() => {
          preview.querySelectorAll('.wishlist-preview-item').forEach(card => {
            const body = card.querySelector('.body');
            if (body && body.scrollHeight > body.clientHeight + 1) {
              card.classList.add('is-clamped');
            }
          });
        });
      }
    } catch (e) { /* non-fatal */ }
  }
  loadWishlistCounts();
  setInterval(loadWishlistCounts, 15000);

  // Refresh after add/remove via existing wishlist drawer.
  const origRefreshWishlist = window.refreshWishlist;
  if (typeof origRefreshWishlist === 'function') {
    window.refreshWishlist = async function() {
      await origRefreshWishlist.apply(this, arguments);
      loadWishlistCounts();
    };
  }

  // Helper escape (the existing app.js has one, but we make sure we have one here)
  function escapeHtml(s) {
    const map = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
    return String(s).replace(/[&<>"']/g, c => map[c]);
  }

  // === G. Drag-to-reorder with FLIP + magnetic neighbors ======
  // didDrag is checked by the global capture-phase click suppressor below
  // so dropping a card does NOT also fire its click handler (open drawer).
  // A clean click without movement leaves didDrag false → click goes through.
  const DRAG_THRESHOLD = 6; // px
  let dragging = null;
  let dragStart = null;
  let dragOffset = null;
  let didDrag = false;
  let lastNeighbors = new Set();

  function onPointerDown(ev) {
    if (!document.body.classList.contains('playmode')) return;
    const tile = ev.currentTarget;
    if (ev.target.closest('button, a, input, select, textarea, .filter-pill, .sort-control, kbd')) return;
    dragging = tile;
    didDrag = false;
    const r = tile.getBoundingClientRect();
    dragStart = { x: ev.clientX, y: ev.clientY };
    dragOffset = { x: ev.clientX - r.left, y: ev.clientY - r.top, w: r.width, h: r.height };
    tile.classList.add('dragging');
    tile.style.position = 'relative';
    tile.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }
  function onPointerMove(ev) {
    if (!dragging) return;
    const dx = ev.clientX - dragStart.x;
    const dy = ev.clientY - dragStart.y;
    if (!didDrag && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      didDrag = true;
    }
    dragging.style.transform = `translate(${dx}px, ${dy}px) scale(1.04) rotate(${dx * 0.02}deg)`;

    // Magnetic lean on neighbors within 200px
    const draggedRect = dragging.getBoundingClientRect();
    const draggedCenter = {
      x: draggedRect.left + draggedRect.width / 2,
      y: draggedRect.top + draggedRect.height / 2,
    };
    const newNeighbors = new Set();
    document.querySelectorAll('[data-tilt]').forEach(other => {
      if (other === dragging) return;
      const r = other.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.hypot(cx - draggedCenter.x, cy - draggedCenter.y);
      if (dist < 280) {
        newNeighbors.add(other);
        const sign = cx < draggedCenter.x ? 'lean-left' : 'lean-right';
        other.classList.add(sign);
        other.classList.remove(sign === 'lean-left' ? 'lean-right' : 'lean-left');
      }
    });
    // Clear old neighbors that are no longer near
    lastNeighbors.forEach(n => {
      if (!newNeighbors.has(n)) n.classList.remove('lean-left', 'lean-right');
    });
    lastNeighbors = newNeighbors;
  }
  function onPointerUp(ev) {
    if (!dragging) return;
    const tile = dragging;
    const tileRect = tile.getBoundingClientRect();
    const tileCenter = { x: tileRect.left + tileRect.width / 2, y: tileRect.top + tileRect.height / 2 };

    // FLIP swap: find the closest in-row neighbor and exchange DOM positions.
    // Only swap within the same .grid-row so layout flow is preserved.
    let swapTarget = null;
    if (didDrag) {
      const candidates = Array.from(lastNeighbors)
        .filter(n => n.parentElement === tile.parentElement)
        .map(n => {
          const r = n.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          return { el: n, dist: Math.hypot(cx - tileCenter.x, cy - tileCenter.y), rect: r };
        })
        .sort((a, b) => a.dist - b.dist);
      // Only swap if the dragged tile center actually crossed into the
      // neighbor's bounding box (not just nearby) — prevents accidental
      // swaps from small wiggles.
      if (candidates.length) {
        const top = candidates[0];
        const r = top.rect;
        const overlap = tileCenter.x >= r.left && tileCenter.x <= r.right
                     && tileCenter.y >= r.top && tileCenter.y <= r.bottom;
        if (overlap) swapTarget = top.el;
      }
    }

    if (swapTarget) {
      // Record FIRST positions (before DOM mutation)
      const targetFirstRect = swapTarget.getBoundingClientRect();

      // Reset the drag transform and position so the in-flow rect is real
      tile.style.transform = '';
      tile.style.position = '';
      tile.classList.remove('dragging');

      // Capture dragged tile's in-flow rect AFTER reset, BEFORE DOM swap
      const tileFirstRect = tile.getBoundingClientRect();

      // DOM swap: insert tile before target, target before tile's old slot
      // Use a placeholder to handle adjacency cleanly.
      const parent = tile.parentElement;
      const placeholder = document.createComment('swap');
      parent.insertBefore(placeholder, tile);
      parent.insertBefore(tile, swapTarget);
      parent.insertBefore(swapTarget, placeholder);
      parent.removeChild(placeholder);

      // LAST positions (after swap) — animate INVERT → PLAY for both
      const animateSwap = (el, fromRect) => {
        const lastRect = el.getBoundingClientRect();
        const dx = fromRect.left - lastRect.left;
        const dy = fromRect.top - lastRect.top;
        if (dx === 0 && dy === 0) return;
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        // Force reflow so the browser registers the transform start state
        // before transitioning to identity.
        // eslint-disable-next-line no-unused-expressions
        el.offsetHeight;
        el.style.transition = 'transform 480ms cubic-bezier(0.16, 1, 0.3, 1)';
        el.style.transform = '';
        setTimeout(() => { el.style.transition = ''; }, 500);
      };
      animateSwap(tile, tileFirstRect);
      animateSwap(swapTarget, targetFirstRect);
    } else {
      // No valid target — spring back to original slot
      tile.style.transition = 'transform 520ms cubic-bezier(0.16, 1, 0.3, 1)';
      tile.style.transform = '';
      setTimeout(() => {
        tile.style.transition = '';
        tile.style.position = '';
      }, 540);
      tile.classList.remove('dragging');
    }

    lastNeighbors.forEach(n => n.classList.remove('lean-left', 'lean-right'));
    lastNeighbors = new Set();
    dragging = null;
    // didDrag stays true through the synthesized click that follows
    // pointerup. Reset on the next macrotask so future clicks aren't
    // permanently suppressed.
    if (didDrag) {
      setTimeout(() => { didDrag = false; }, 0);
    }
  }

  document.querySelectorAll('[data-tilt]').forEach(tile => {
    tile.addEventListener('pointerdown', onPointerDown);
    tile.addEventListener('pointermove', onPointerMove);
    tile.addEventListener('pointerup', onPointerUp);
    tile.addEventListener('pointercancel', onPointerUp);
  });

  // Capture-phase click suppressor: kills the synthesized click that
  // follows a drag-then-release on the same element. Pure clicks
  // (no movement) leave didDrag false and pass through untouched.
  document.addEventListener('click', (ev) => {
    if (didDrag) {
      ev.stopPropagation();
      ev.preventDefault();
    }
  }, true);

  // === H. Playful mode toggle =================================
  const playToggle = document.getElementById('playmode-toggle');
  if (playToggle) {
    playToggle.addEventListener('click', () => {
      document.body.classList.toggle('playmode');
      playToggle.classList.toggle('active');
    });
  }
})();
