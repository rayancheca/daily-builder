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

const state = { data: null, charts: {}, currentDrawer: null, projectCache: {} };

// === Lifecycle ===
async function init() {
  await load();
  connectStream();
  setupKeyboard();
  setupSearch();
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
  $('#live-text').textContent = on ? 'LIVE' : 'OFFLINE';
}

// === Render ===
function render() {
  if (!state.data) return;
  const d = state.data;
  renderHero(d);
  renderCalendar(d);
  renderLangChart(d);
  renderVelocityChart(d);
  renderHeatmap(d);
  renderProjects(d);
  renderCommitFeed(d);
  renderSessionLog(d);
}

function renderHero(d) {
  const active = d.active;
  const stats = d.cross_stats;
  const heroEl = $('#hero-main');
  if (active) {
    const total = active.completed.length + active.next_steps.length;
    const pct = total > 0 ? Math.round(100 * active.completed.length / total) : 0;
    heroEl.innerHTML = `
      <div class="hero-eyebrow">Now Building · Session ${active.session}</div>
      <div class="hero-headline">${escapeHtml(active.name)}</div>
      <div class="hero-sub">${escapeHtml(active.in_progress || 'Setting up project structure')}</div>
      <div class="hero-progress">
        <div class="hero-progress-label">
          <span>Progress</span>
          <span>${active.completed.length} / ${total} steps · ${pct}%</span>
        </div>
        <div class="hero-progress-bar">
          <div class="hero-progress-fill" style="width:${pct}%"></div>
        </div>
      </div>
    `;
    heroEl.onclick = () => openDrawer(active.name);
  } else {
    heroEl.innerHTML = `
      <div class="hero-eyebrow">Idle</div>
      <div class="hero-headline">No project running</div>
      <div class="hero-sub">Run <code style="background:var(--bg3);padding:2px 8px;border-radius:4px;font-family:var(--font-mono);font-size:13px">./start.sh</code> to begin a new build.</div>
    `;
    heroEl.onclick = null;
  }

  $('#stat-projects').textContent = stats.total_projects;
  $('#stat-completed').textContent = stats.completed_projects;
  $('#stat-commits').textContent = fmt.num(stats.total_commits);
  $('#stat-additions').textContent = fmt.num(stats.total_additions);
  $('#stat-streak').textContent = d.streak;
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
        ? `<div class="cal-day ${lvl(day.count)}" data-tip="${day.date}: ${day.count} commits"></div>`
        : `<div class="cal-day" style="visibility:hidden"></div>`).join('')}
    </div>
  `).join('');

  // Month labels (above each new month start)
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let labels = [];
  let lastMonth = -1;
  weeks.forEach((w) => {
    const firstDay = w.find(x => x);
    if (firstDay) {
      const m = new Date(firstDay.date).getMonth();
      if (m !== lastMonth) {
        labels.push(monthNames[m]);
        lastMonth = m;
      } else {
        labels.push('');
      }
    } else labels.push('');
  });
  monthsEl.innerHTML = labels.map(l => `<span style="width:15px;display:inline-block">${l}</span>`).join('');

  const total = cal.reduce((s, c) => s + c.count, 0);
  const active = cal.filter(c => c.count > 0).length;
  $('#cal-summary').textContent = `${total} commits · ${active} active days`;

  attachTooltips(wrap);
}

function renderLangChart(d) {
  const ctx = $('#chart-lang').getContext('2d');
  const langs = (d.cross_stats.languages || []).slice(0, 10);
  if (state.charts.lang) state.charts.lang.destroy();
  if (!langs.length) return;
  state.charts.lang = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: langs.map(l => l.lang),
      datasets: [{
        data: langs.map(l => l.count),
        backgroundColor: langs.map(l => l.color),
        borderColor: 'oklch(11% 0.008 250)',
        borderWidth: 2,
        hoverOffset: 10,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '68%',
      plugins: {
        legend: {
          position: 'right',
          labels: {
            color: '#aaa',
            font: { size: 11, family: 'JetBrains Mono' },
            padding: 14,
            boxWidth: 10,
            boxHeight: 10,
            usePointStyle: true,
            pointStyle: 'rectRounded',
          },
        },
        tooltip: {
          backgroundColor: 'oklch(15% 0.005 250)',
          borderColor: 'oklch(28% 0.014 250)',
          borderWidth: 1,
          titleFont: { family: 'JetBrains Mono', size: 11 },
          bodyFont: { family: 'JetBrains Mono', size: 11 },
          padding: 10,
        },
      },
    },
  });
  $('#lang-summary').textContent = `${langs.length} langs`;
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
  const projects = [...(d.projects || [])].sort((a, b) => (b.last_modified || 0) - (a.last_modified || 0));
  $('#proj-count').textContent = `${projects.length} total`;
  wrap.innerHTML = projects.map(p => {
    const isActive = p.status !== 'COMPLETE';
    const total = p.completed.length + p.next_steps.length;
    const pct = total > 0 ? Math.round(100 * p.completed.length / total) : 0;
    const tagline = p.description || p.in_progress || '—';
    return `
      <div class="project-card ${isActive ? 'active' : ''}" data-name="${escapeAttr(p.name)}">
        <div class="pc-header">
          <div class="pc-name">${escapeHtml(p.name)}</div>
          <div class="pc-status ${isActive ? 'in-progress' : 'complete'}">${isActive ? 'BUILDING' : 'SHIPPED'}</div>
        </div>
        <div class="pc-tagline">${escapeHtml(tagline)}</div>
        <div class="pc-progress"><div class="pc-progress-fill" style="width:${pct}%"></div></div>
        <div class="pc-stats">
          <div class="pc-stat">⎇ <strong>${p.commit_count}</strong></div>
          <div class="pc-stat add">+<strong>${fmt.num(p.additions)}</strong></div>
          <div class="pc-stat del">−<strong>${fmt.num(p.deletions)}</strong></div>
          <div class="pc-stat pct">${pct}%</div>
        </div>
      </div>
    `;
  }).join('');
  $$('.project-card', wrap).forEach(el => {
    el.addEventListener('click', () => openDrawer(el.dataset.name));
  });
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
    if (!r.ok) throw new Error();
    const data = await r.json();
    state.projectCache[name] = data;
    renderDrawer(data);
  } catch {
    $('#drawer-body').innerHTML = '<div style="color:var(--red); padding: 20px;">Failed to load project details</div>';
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

  $('#drawer-actions').innerHTML = `
    ${p.github ? `<a class="icon-btn" href="${p.github}" target="_blank" rel="noopener" title="Open on GitHub">↗</a>` : ''}
    <button class="icon-btn" onclick="closeDrawer()" title="Close (Esc)">✕</button>
  `;

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
  if (tab === 'overview') body.innerHTML = drawerOverview(p);
  else if (tab === 'commits') body.innerHTML = drawerCommits(p);
  else if (tab === 'files') body.innerHTML = drawerFiles(p);
  else if (tab === 'languages') body.innerHTML = drawerLangs(p);
  else if (tab === 'readme') body.innerHTML = drawerReadme(p);

  if (tab === 'commits') {
    $$('.commit-row', body).forEach(el => {
      el.addEventListener('click', () => openCommit(p.name, el.dataset.sha));
    });
  }
  if (tab === 'files') {
    $$('.tree-node-file', body).forEach(el => {
      el.addEventListener('click', () => openFile(p.name, el.dataset.path));
    });
  }
}

function drawerOverview(p) {
  const total = p.completed.length + p.next_steps.length;
  const pct = total > 0 ? Math.round(100 * p.completed.length / total) : 0;
  const cleanColor = p.git_status.clean ? 'var(--green)' : 'var(--amber)';
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

    <div class="dr-section">
      <div class="dr-section-title">Progress</div>
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:20px">
        <div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.1em">
          <span>${p.completed.length} / ${total} steps</span>
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
            ${p.git_status.clean ? '✓ Clean' : `◉ ${p.git_status.modified.length + p.git_status.untracked.length} changed`}
          </div>
        </div>
        <div style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:18px">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:0.12em">Modified · Untracked</div>
          <div style="font-size:18px;font-weight:700;margin-top:8px;color:var(--text0)">
            ${p.git_status.modified.length} <span style="color:var(--text3)">·</span> ${p.git_status.untracked.length}
          </div>
        </div>
      </div>
    </div>

    ${p.completed.length ? `
      <div class="dr-section">
        <div class="dr-section-title">Completed Steps · ${p.completed.length}</div>
        ${p.completed.slice().reverse().slice(0, 12).map((s, i) => `
          <div class="step-row">
            <span class="step-num done">✓</span>
            <span class="step-text">${escapeHtml(s)}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}

    ${p.next_steps.length ? `
      <div class="dr-section">
        <div class="dr-section-title">Next Steps · ${p.next_steps.length}</div>
        ${p.next_steps.map((s, i) => `
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
  let html = escapeHtml(md);
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (m, lang, code) => `<pre><code>${code}</code></pre>`);
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]*?<\/li>(?:\n<li>[\s\S]*?<\/li>)*)/g, m => `<ul>${m.replace(/\n/g,'')}</ul>`);
  html = html.split(/\n\n+/).map(para => {
    if (para.match(/^<(h\d|ul|ol|pre|blockquote)/)) return para;
    if (!para.trim()) return '';
    return `<p>${para.replace(/\n/g, '<br>')}</p>`;
  }).join('\n');
  return html;
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
    if (e.key === 'Escape') {
      if ($('#modal-card').classList.contains('open')) closeModal();
      else if ($('#drawer').classList.contains('open')) closeDrawer();
    }
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT') {
      e.preventDefault();
      $('#search-input')?.focus();
    }
  });
}

function setupSearch() {
  const input = $('#search-input');
  if (!input) return;
  input.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    $$('.project-card').forEach(card => {
      const name = card.dataset.name.toLowerCase();
      const text = card.textContent.toLowerCase();
      card.style.display = (name.includes(q) || text.includes(q)) ? '' : 'none';
    });
  });
}

window.reconnect = reconnect;
window.closeDrawer = closeDrawer;
window.closeModal = closeModal;
init();
