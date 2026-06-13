// =========================================================================
// Datable — SPA core (router / rendering / progress / theme)
// =========================================================================
import { renderPlayground, runInPlayground } from './playground.js';

const BASE = new URL('../', import.meta.url).href; // site root (js/ の親) — GitHub Pages のサブパスでも安全
const $ = (sel, el = document) => el.querySelector(sel);
const app = $('#app');

const state = {
  manifest: null,
  lessons: [],          // flat list with part context
  lessonCache: new Map(),
  mermaid: null,
};

// ---------- storage helpers ----------
const STORE_DONE = 'datable:done';
const STORE_THEME = 'datable:theme';
const getDone = () => { try { return new Set(JSON.parse(localStorage.getItem(STORE_DONE) || '[]')); } catch { return new Set(); } };
const setDone = (set) => localStorage.setItem(STORE_DONE, JSON.stringify([...set]));
const toggleDone = (id) => { const s = getDone(); s.has(id) ? s.delete(id) : s.add(id); setDone(s); return s.has(id); };

// ---------- theme ----------
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(STORE_THEME, t);
  const use = $('#themeBtn use');
  if (use) use.setAttribute('href', t === 'dark' ? '#i-sun' : '#i-moon');
}
function initTheme() {
  const saved = localStorage.getItem(STORE_THEME);
  const t = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(t);
}

// ---------- toast ----------
let toastTimer;
function toast(msg) {
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

// ---------- icon helper ----------
const icon = (id, cls = '') => `<svg class="${cls}"><use href="#${id}"/></svg>`;

// ---------- manifest ----------
async function loadManifest() {
  if (state.manifest) return state.manifest;
  const res = await fetch(`${BASE}content/manifest.json`);
  state.manifest = await res.json();
  state.lessons = [];
  state.manifest.parts.forEach((part, pi) => {
    part.lessons.forEach((l) => state.lessons.push({ ...l, partId: part.id, partTitle: part.title, partIndex: pi }));
  });
  return state.manifest;
}

// =========================================================================
// Markdown rendering
// =========================================================================
function preprocessCallouts(md) {
  const stash = [];
  const re = /^:::(insight|tip|warning|antipattern|example)[ \t]*(.*)$\n([\s\S]*?)^:::[ \t]*$/gm;
  const out = md.replace(re, (_, type, title, body) => {
    const ico = { insight: 'i-bulb', tip: 'i-check', warning: 'i-alert', antipattern: 'i-x-circle', example: 'i-code' }[type];
    const inner = marked.parse(body.trim());
    const head = title.trim() ? `<div class="ctitle">${escapeHtml(title.trim())}</div>` : '';
    const html = `<div class="callout ${type}"><span class="ico">${icon(ico)}</span>${head}${inner}</div>`;
    stash.push(html);
    return `\n\n%%CALLOUT_${stash.length - 1}%%\n\n`;
  });
  return { md: out, stash };
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMarkdown(md) {
  const { md: pre, stash } = preprocessCallouts(md);
  let html = marked.parse(pre);
  stash.forEach((h, i) => { html = html.replace(`<p>%%CALLOUT_${i}%%</p>`, h); });
  return html;
}

// post-process a rendered .prose element: code blocks, mermaid, copy/run, headings
function enhanceProse(root) {
  // code blocks
  root.querySelectorAll('pre > code').forEach((code) => {
    const pre = code.parentElement;
    const langClass = [...code.classList].find((c) => c.startsWith('language-'));
    const lang = langClass ? langClass.replace('language-', '') : '';
    if (lang === 'mermaid') {
      const div = document.createElement('div');
      div.className = 'mermaid';
      // mermaid11 はラベル内 "1. xxx" を markdown の番号付きリストと誤認する。
      // 半角ピリオドを全角に変えればリスト判定を回避でき、括弧等の構文も壊さない。
      div.textContent = code.textContent.replace(/(\d+)\.[ \t]+/g, '$1． ');
      pre.replaceWith(div);
      return;
    }
    try { if (window.hljs) hljs.highlightElement(code); } catch {}
    const wrap = document.createElement('div');
    wrap.className = 'code-wrap';
    pre.replaceWith(wrap);
    wrap.appendChild(pre);
    const copy = document.createElement('button');
    copy.className = 'copy-btn'; copy.textContent = 'コピー';
    copy.addEventListener('click', () => { navigator.clipboard.writeText(code.textContent); toast('コピーしました'); });
    wrap.appendChild(copy);
    if (lang === 'sql') {
      const btn = document.createElement('button');
      btn.className = 'try-sql';
      btn.innerHTML = `${icon('i-play')} Playgroundで実行`;
      btn.addEventListener('click', () => { sessionStorage.setItem('datable:trysql', code.textContent.trim()); location.hash = '#/playground'; });
      wrap.after(btn);
    }
  });
  // headings → ids for TOC
  const heads = [];
  root.querySelectorAll('h2, h3').forEach((h, i) => {
    const id = 'h-' + i + '-' + slug(h.textContent);
    h.id = id;
    heads.push({ id, text: h.textContent, level: h.tagName === 'H2' ? 2 : 3 });
  });
  return heads;
}

const slug = (s) => s.toLowerCase().replace(/[^\w぀-ヿ一-龯]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

async function runMermaid(root) {
  const nodes = root.querySelectorAll('.mermaid');
  if (!nodes.length) return;
  if (!state.mermaid) {
    state.mermaid = (await import('https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs')).default;
  }
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  state.mermaid.initialize({
    startOnLoad: false,
    theme: dark ? 'dark' : 'neutral',
    themeVariables: { primaryColor: '#6d5efc', primaryTextColor: dark ? '#eef1f8' : '#1a1d29', lineColor: dark ? '#5b6486' : '#8b91a8', fontFamily: 'Inter, Noto Sans JP, sans-serif' },
    flowchart: { curve: 'basis' },
  });
  try { await state.mermaid.run({ nodes: [...nodes] }); } catch (e) { console.warn('mermaid', e); }
}

// =========================================================================
// Sidebar
// =========================================================================
function renderSidebar(activeId) {
  const done = getDone();
  const total = state.lessons.length;
  const doneCount = state.lessons.filter((l) => done.has(l.id)).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;
  const C = 2 * Math.PI * 22;
  const offset = C * (1 - pct / 100);

  const parts = state.manifest.parts.map((part, pi) => {
    const lessons = part.lessons.map((l) => {
      const isDone = done.has(l.id);
      const active = l.id === activeId ? 'active' : '';
      return `<a class="lesson-link ${isDone ? 'done' : ''} ${active}" href="#/learn/${l.id}" data-title="${escapeHtml(l.title)}">
        <span class="check">${icon('i-check')}</span>
        <span class="ltitle">${escapeHtml(l.title)}</span>
        <span class="lmin">${l.minutes}分</span>
      </a>`;
    }).join('');
    return `<div class="part" data-part="${part.id}">
      <div class="part-head"><span class="pnum">${pi}</span><span class="ptitle">${escapeHtml(part.title)}</span></div>
      ${lessons}
    </div>`;
  }).join('');

  return `<aside class="sidebar" id="sidebar">
    <div class="progress-card">
      <div class="ring" style="--p:${pct}">
        <svg width="52" height="52" viewBox="0 0 52 52">
          <circle class="bg" cx="26" cy="26" r="22" fill="none" stroke-width="5"/>
          <circle class="fg" cx="26" cy="26" r="22" fill="none" stroke-width="5" stroke-dasharray="${C}" stroke-dashoffset="${offset}"/>
        </svg>
        <span class="pct">${pct}%</span>
      </div>
      <div class="progress-meta"><strong>学習の進捗</strong><span>${doneCount} / ${total} レッスン完了</span></div>
    </div>
    <div class="nav-search">${icon('i-search')}<input type="search" id="navSearch" placeholder="レッスンを検索…" autocomplete="off"/></div>
    <nav id="lessonNav">${parts}</nav>
  </aside>`;
}

function wireSidebar() {
  const input = $('#navSearch');
  if (input) input.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    $('#lessonNav').querySelectorAll('.part').forEach((part) => {
      let visible = 0;
      part.querySelectorAll('.lesson-link').forEach((a) => {
        const match = a.dataset.title.toLowerCase().includes(q);
        a.classList.toggle('hidden', !match); if (match) visible++;
      });
      part.classList.toggle('hidden', visible === 0);
    });
  });
}

// =========================================================================
// Views
// =========================================================================
function viewHome() {
  const m = state.manifest;
  const total = state.lessons.length;
  const totalMin = state.lessons.reduce((a, l) => a + l.minutes, 0);

  const fmodes = [
    { n: '失敗モード 1', t: '作ったけど使われない', d: 'せっかく作ったテーブルもダッシュボードも、誰にも知られず使われないまま放置される。', rx: '発見可能性・利用者起点・信頼', l: '50-discoverability' },
    { n: '失敗モード 2', t: '価値がチームに閉じる', d: '作った本人にしか使えない。仕様は頭の中、他チームは指標を再発明してしまう。', rx: 'セルフサーブ・セマンティック層', l: '51-self-serve' },
    { n: '失敗モード 3', t: '想定外の使い方をされる', d: '定義や粒度が曖昧なまま広まり、誤った数字が独り歩きして意思決定を歪める。', rx: 'データ契約・ガバナンス', l: '52-governance' },
    { n: '失敗モード 4', t: '使われすぎて変更できない', d: '依存が増えすぎて、もう怖くて誰も触れない。改善が止まり、技術的負債が固定化する。', rx: 'バージョニング・安定IF', l: '53-versioning' },
  ];

  const curric = m.parts.map((p, i) => `
    <div class="curric-card">
      <span class="cnum">${i}</span>
      <h3>${escapeHtml(p.title)}</h3>
      <div class="ctag">${escapeHtml(p.tagline)}</div>
      <ul>${p.lessons.map((l) => `<li><a href="#/learn/${l.id}">${escapeHtml(l.title)}</a></li>`).join('')}</ul>
    </div>`).join('');

  return `<div class="home">
    <section class="hero">
      <span class="eyebrow"><span class="dot"></span>完全無料・登録不要・ブラウザだけで完結</span>
      <h1>腐らない<span class="grad">データ基盤</span>を、<br>ゼロから実装できるように。</h1>
      <p class="lead">${escapeHtml(m.site.subtitle)}。誰でも入口に立てて、修了する頃には「作ったけど使われない／チームに閉じる／想定外に使われる／変更できない」を防ぐ設計が手に馴染みます。</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#/learn/00-welcome">学習をはじめる ${icon('i-arrow-right')}</a>
        <a class="btn btn-ghost" href="#/playground">${icon('i-play')} Playgroundを触る</a>
      </div>
      <div class="hero-stats">
        <div class="stat"><strong>${m.parts.length}</strong><span>パート</span></div>
        <div class="stat"><strong>${total}</strong><span>レッスン</span></div>
        <div class="stat"><strong>${Math.round(totalMin / 60 * 10) / 10}h</strong><span>学習時間</span></div>
        <div class="stat"><strong>SQL</strong><span>ブラウザ実行</span></div>
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>データ基盤が「腐る」4つの失敗モード</h2>
        <p>多くの基盤はこのどれかで価値を失います。このコースは、4つすべてに処方箋を持って臨みます。</p>
      </div>
      <div class="fmode-grid">
        ${fmodes.map((f) => `<a class="fmode" href="#/learn/${f.l}">
          <div class="fnum">${f.n}</div>
          <h3>「${f.t}」</h3>
          <p>${f.d}</p>
          <div class="rx">処方： <b>${f.rx}</b></div>
        </a>`).join('')}
      </div>
    </section>

    <section class="section">
      <div class="section-head">
        <h2>カリキュラム</h2>
        <p>基礎から始まり、モデリング・パイプライン・品質を経て、「腐らせない設計」と実践演習へ。</p>
      </div>
      <div class="curric-grid">${curric}</div>
    </section>

    <div class="cta-band">
      <h2>手を動かして学ぼう</h2>
      <p>ブラウザ内のSQL Playgroundで、サンプルのECデータを使って今すぐクエリを試せます。</p>
      <a class="btn btn-ghost" href="#/playground">${icon('i-play')} Playgroundを開く</a>
    </div>

    <footer class="site-footer"><div class="inner">
      <span>© Datable — 腐らないデータ基盤コース</span>
      <span><a href="https://github.com/kenta-suzuki-coconala" target="_blank" rel="noopener">GitHub</a> ・ MIT License</span>
    </div></footer>
  </div>`;
}

async function loadLesson(id) {
  if (state.lessonCache.has(id)) return state.lessonCache.get(id);
  const res = await fetch(`${BASE}content/lessons/${id}.md`);
  if (!res.ok) throw new Error('not found');
  const md = await res.text();
  state.lessonCache.set(id, md);
  return md;
}

async function viewLesson(id) {
  const idx = state.lessons.findIndex((l) => l.id === id);
  if (idx < 0) { return `<div class="content"><div class="content-inner"><h1>レッスンが見つかりません</h1><p><a href="#/">ホームへ戻る</a></p></div></div>`; }
  const l = state.lessons[idx];
  const prev = state.lessons[idx - 1];
  const next = state.lessons[idx + 1];
  let md;
  try { md = await loadLesson(id); }
  catch { return `<div class="content"><div class="content-inner"><h1>${escapeHtml(l.title)}</h1><div class="callout warning"><span class="ico">${icon('i-alert')}</span><p>このレッスンはまだ準備中です。</p></div></div></div>`; }

  const done = getDone().has(id);
  const body = renderMarkdown(md);

  return `
    ${renderSidebar(id)}
    <div class="content"><div class="content-inner">
      <div class="lesson-header">
        <div class="crumb"><span class="pn">PART ${l.partIndex} · ${escapeHtml(l.partTitle)}</span></div>
        <div class="lesson-meta">
          <span class="pill">${icon('i-clock')} 約${l.minutes}分</span>
        </div>
      </div>
      <article class="prose" id="prose">${body}</article>
      <div class="lesson-footer">
        <div class="complete-row">
          <button class="btn-complete ${done ? 'done' : ''}" id="completeBtn">${icon('i-check')} <span>${done ? '完了済み' : 'このレッスンを完了にする'}</span></button>
        </div>
        <div class="pager">
          ${prev ? `<a class="prev" href="#/learn/${prev.id}"><div class="dir">← 前へ</div><div class="ttl">${escapeHtml(prev.title)}</div></a>` : `<a class="prev disabled"><div class="dir">← 前へ</div><div class="ttl">—</div></a>`}
          ${next ? `<a class="next" href="#/learn/${next.id}"><div class="dir">次へ →</div><div class="ttl">${escapeHtml(next.title)}</div></a>` : `<a class="next disabled"><div class="dir">次へ →</div><div class="ttl">コース完了！</div></a>`}
        </div>
      </div>
    </div></div>
    <aside class="toc-aside" id="tocAside"></aside>`;
}

// =========================================================================
// Router
// =========================================================================
function setActiveTopnav(route) {
  $('#topnav').querySelectorAll('a').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
}

async function render() {
  await loadManifest();
  const hash = location.hash || '#/';
  closeMobileNav();

  if (hash === '#/' || hash === '') {
    setActiveTopnav('home');
    app.className = '';
    app.innerHTML = viewHome();
    window.scrollTo(0, 0);
    return;
  }
  if (hash.startsWith('#/playground')) {
    setActiveTopnav('playground');
    app.className = '';
    app.innerHTML = `<div class="pg-wrap" id="pgRoot"></div>`;
    await renderPlayground($('#pgRoot'), { BASE, icon, toast });
    window.scrollTo(0, 0);
    return;
  }
  if (hash.startsWith('#/learn/')) {
    setActiveTopnav('learn');
    const id = decodeURIComponent(hash.replace('#/learn/', ''));
    app.className = 'layout';
    app.innerHTML = await viewLesson(id);
    window.scrollTo(0, 0);
    wireSidebar();
    const prose = $('#prose');
    if (prose) {
      const heads = enhanceProse(prose);
      buildToc(heads);
      await runMermaid(prose);
      // pending try-sql request handled in playground view; nothing here
    }
    const cbtn = $('#completeBtn');
    if (cbtn) cbtn.addEventListener('click', () => {
      const nowDone = toggleDone(id);
      cbtn.classList.toggle('done', nowDone);
      $('#completeBtn span').textContent = nowDone ? '完了済み' : 'このレッスンを完了にする';
      toast(nowDone ? '完了にしました 🎉' : '未完了に戻しました');
      // refresh sidebar progress
      const sb = $('#sidebar');
      if (sb) sb.outerHTML = renderSidebar(id);
      wireSidebar();
    });
    return;
  }
  // fallback
  location.hash = '#/';
}

function buildToc(heads) {
  const aside = $('#tocAside');
  if (!aside || !heads.length) { if (aside) aside.remove(); return; }
  aside.innerHTML = `<div class="toc-title">このページの内容</div>` +
    heads.map((h) => `<a href="#${h.id}" class="${h.level === 3 ? 'h3' : ''}" data-id="${h.id}">${escapeHtml(h.text)}</a>`).join('');
  aside.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    document.getElementById(a.dataset.id)?.scrollIntoView({ behavior: 'smooth' });
  }));
  // scroll spy
  const links = new Map([...aside.querySelectorAll('a')].map((a) => [a.dataset.id, a]));
  const obs = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) {
        links.forEach((a) => a.classList.remove('active'));
        links.get(en.target.id)?.classList.add('active');
      }
    });
  }, { rootMargin: '-80px 0px -70% 0px' });
  heads.forEach((h) => { const el = document.getElementById(h.id); if (el) obs.observe(el); });
}

// ---------- mobile nav ----------
function openMobileNav() { $('#sidebar')?.classList.add('open'); $('#scrim')?.classList.add('open'); }
function closeMobileNav() { $('#sidebar')?.classList.remove('open'); $('#scrim')?.classList.remove('open'); }

// =========================================================================
// Boot
// =========================================================================
function boot() {
  initTheme();
  if (window.marked) marked.setOptions({ breaks: false, gfm: true });
  $('#themeBtn').addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    applyTheme(cur === 'dark' ? 'light' : 'dark');
    if (location.hash.startsWith('#/learn/')) render(); // refresh mermaid theme
  });
  $('#menuBtn').addEventListener('click', () => {
    const open = $('#sidebar')?.classList.contains('open');
    open ? closeMobileNav() : openMobileNav();
  });
  $('#scrim').addEventListener('click', closeMobileNav);
  window.addEventListener('hashchange', render);
  render();
}

// expose for inline use if needed
window.runInPlayground = runInPlayground;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
