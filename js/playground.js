// =========================================================================
// Datable — In-browser SQL Playground (sql.js / SQLite WASM)
// =========================================================================

const SQLJS_VERSION = '1.10.3';
const SQLJS_BASE = `https://cdn.jsdelivr.net/npm/sql.js@${SQLJS_VERSION}/dist/`;

const SCHEMA = [
  { name: 'customers', desc: '顧客（ソース生データ）', cols: [['customer_id', 'INT'], ['name', 'TEXT'], ['country', 'TEXT'], ['signup_date', 'DATE']] },
  { name: 'products', desc: '商品マスタ', cols: [['product_id', 'INT'], ['name', 'TEXT'], ['category', 'TEXT'], ['price', 'REAL']] },
  { name: 'orders', desc: '注文ヘッダ', cols: [['order_id', 'INT'], ['customer_id', 'INT'], ['order_date', 'DATE'], ['status', 'TEXT']] },
  { name: 'order_items', desc: '注文明細（粒度: 1明細）', cols: [['order_item_id', 'INT'], ['order_id', 'INT'], ['product_id', 'INT'], ['quantity', 'INT'], ['unit_price', 'REAL']] },
  { name: 'events', desc: '行動ログ（view/add_to_cart/purchase）', cols: [['event_id', 'INT'], ['customer_id', 'INT'], ['event_type', 'TEXT'], ['event_time', 'DATETIME']] },
];

const EXAMPLES = [
  { label: '① まずは注文を覗く', sql: 'SELECT * FROM orders LIMIT 20;' },
  {
    label: '② カテゴリ別の売上（completedのみ）',
    sql: `SELECT p.category,
       ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue,
       COUNT(DISTINCT o.order_id)                 AS order_count
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products    p  ON p.product_id = oi.product_id
WHERE o.status = 'completed'
GROUP BY p.category
ORDER BY revenue DESC;`,
  },
  {
    label: '③ 優良顧客トップ10',
    sql: `SELECT c.customer_id, c.name, c.country,
       COUNT(DISTINCT o.order_id) AS orders,
       ROUND(SUM(oi.quantity * oi.unit_price), 2) AS spent
FROM customers c
JOIN orders      o  ON o.customer_id = c.customer_id AND o.status = 'completed'
JOIN order_items oi ON oi.order_id = o.order_id
GROUP BY c.customer_id, c.name, c.country
ORDER BY spent DESC
LIMIT 10;`,
  },
  {
    label: '④ 月次売上の推移',
    sql: `SELECT substr(o.order_date, 1, 7) AS month,
       ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.status = 'completed'
GROUP BY month
ORDER BY month;`,
  },
  {
    label: '⑤ 行動ファネル（view→cart→purchase）',
    sql: `SELECT event_type, COUNT(*) AS events, COUNT(DISTINCT customer_id) AS users
FROM events
GROUP BY event_type
ORDER BY events DESC;`,
  },
  {
    label: '⑥ 国 × カテゴリのクロス集計',
    sql: `SELECT c.country, p.category,
       ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue
FROM orders o
JOIN customers   c  ON c.customer_id = o.customer_id
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products    p  ON p.product_id = oi.product_id
WHERE o.status = 'completed'
GROUP BY c.country, p.category
ORDER BY c.country, revenue DESC;`,
  },
  {
    label: '⑦ スター・スキーマを組む（marts層を作る）',
    sql: `-- 生データから「提供層(marts)」のスター・スキーマを組み立てる例。
-- ディメンション
CREATE VIEW IF NOT EXISTS dim_customer AS
SELECT customer_id AS customer_key, name, country, signup_date FROM customers;

CREATE VIEW IF NOT EXISTS dim_product AS
SELECT product_id AS product_key, name, category, price FROM products;

-- ファクト（粒度: 注文明細）。集計しやすい数値だけを持たせる。
CREATE VIEW IF NOT EXISTS fct_order_items AS
SELECT oi.order_item_id,
       o.order_id,
       o.customer_id        AS customer_key,
       oi.product_id        AS product_key,
       o.order_date,
       o.status,
       oi.quantity,
       oi.unit_price,
       oi.quantity * oi.unit_price AS line_amount
FROM order_items oi
JOIN orders o ON o.order_id = oi.order_id;

-- 組んだスターを使えば、分析はシンプルになる
SELECT d.category,
       ROUND(SUM(f.line_amount), 2) AS revenue
FROM fct_order_items f
JOIN dim_product d ON d.product_key = f.product_key
WHERE f.status = 'completed'
GROUP BY d.category
ORDER BY revenue DESC;`,
  },
  {
    label: '⑧ 増分処理の発想（指定日以降だけ）',
    sql: `-- 「前回の高水位(watermark)以降」だけを処理する増分パターンの感覚をつかむ。
SELECT o.order_date,
       COUNT(DISTINCT o.order_id) AS new_orders,
       ROUND(SUM(oi.quantity * oi.unit_price), 2) AS revenue
FROM orders o
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.order_date >= '2025-10-01'   -- ← この高水位を進めていくのが増分処理
  AND o.status = 'completed'
GROUP BY o.order_date
ORDER BY o.order_date;`,
  },
];

let SQL = null;          // sql.js module
let db = null;           // database instance
let seedSql = null;      // cached seed
let ctxRef = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('script load failed: ' + src));
    document.head.appendChild(s);
  });
}

async function ensureDb(BASE) {
  if (db) return db;
  if (!SQL) {
    if (!window.initSqlJs) await loadScript(`${SQLJS_BASE}sql-wasm.js`);
    SQL = await window.initSqlJs({ locateFile: (f) => `${SQLJS_BASE}${f}` });
  }
  if (!seedSql) seedSql = await (await fetch(`${BASE}data/seed.sql`)).text();
  db = new SQL.Database();
  db.run(seedSql);
  return db;
}

function resetDb() {
  if (db) { db.close(); db = null; }
}

// run SQL, return { results: [{columns, values}], error }
function runSql(sql) {
  try {
    const results = db.exec(sql);
    return { results };
  } catch (e) {
    return { error: e.message || String(e) };
  }
}

const isNum = (v) => typeof v === 'number' || (typeof v === 'string' && v !== '' && !isNaN(v) && /^-?\d/.test(v));

function renderResult(container, sql, icon) {
  const t0 = performance.now();
  const { results, error } = runSql(sql);
  const ms = Math.max(1, Math.round(performance.now() - t0));
  const info = container.querySelector('.result-info');
  const body = container.querySelector('.pg-result-body');

  if (error) {
    info.innerHTML = `<span style="color:var(--c-antipattern);font-weight:600">エラー</span>`;
    body.innerHTML = `<div class="result-error">${escapeHtml(error)}</div>`;
    setStatus('err', 'クエリエラー');
    return;
  }
  if (!results || !results.length) {
    info.innerHTML = `<span class="ok">✓ 実行完了</span><span>${ms}ms</span><span>結果セットなし（DDL/DML など）</span>`;
    body.innerHTML = `<div class="result-error" style="border-color:var(--c-tip);color:var(--c-tip);background:color-mix(in srgb,var(--c-tip) 8%,transparent)">文の実行に成功しました（返却行なし）。</div>`;
    setStatus('ready', '準備完了');
    return;
  }
  const last = results[results.length - 1];
  const rows = last.values.length;
  info.innerHTML = `<span class="ok">✓ ${rows} 行</span><span>${last.columns.length} 列</span><span>${ms}ms</span>${results.length > 1 ? `<span>（${results.length}文中の最終結果）</span>` : ''}`;
  body.innerHTML = renderTable(last);
}

function renderTable(rs) {
  const head = rs.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
  const body = rs.values.slice(0, 1000).map((row) =>
    `<tr>${row.map((v) => {
      const cls = isNum(v) ? ' class="num"' : '';
      return `<td${cls}>${v === null ? '<span style="opacity:.4">NULL</span>' : escapeHtml(String(v))}</td>`;
    }).join('')}</tr>`).join('');
  return `<div class="result-table-wrap"><table class="result-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let statusEl = null;
function setStatus(kind, text) {
  if (!statusEl) return;
  statusEl.className = `pg-status ${kind}`;
  statusEl.querySelector('.txt').textContent = text;
}

let editor = null;
function setEditor(sql) { if (editor) editor.value = sql; }
function getEditor() { return editor ? editor.value : ''; }

// public: called when a lesson "try in playground" navigates here
export function runInPlayground(sql) {
  sessionStorage.setItem('datable:trysql', sql);
  location.hash = '#/playground';
}

export async function renderPlayground(root, ctx) {
  ctxRef = ctx;
  const { BASE, icon, toast } = ctx;

  const schemaHtml = SCHEMA.map((t) => `
    <div class="pg-table">
      <div class="tname" data-table="${t.name}">${icon('i-db')} ${t.name}</div>
      <ul class="cols">${t.cols.map((c) => `<li data-col="${c[0]}">${c[0]} <span class="ty">${c[1]}</span></li>`).join('')}</ul>
    </div>`).join('');

  const examplesHtml = EXAMPLES.map((e, i) => `<option value="${i}">${escapeHtml(e.label)}</option>`).join('');

  root.innerHTML = `
    <div class="pg-head">
      <h1>${icon('i-play')} SQL Playground</h1>
      <span class="pg-status" id="pgStatus"><span class="dot"></span><span class="txt">エンジンを起動中…</span></span>
    </div>
    <p style="color:var(--text-mut);font-size:.9rem;margin:-4px 0 16px">ブラウザ内のSQLite（sql.js / WASM）で、サンプルECデータに対し本物のSQLを実行できます。サーバー送信は一切なし。完全にあなたのブラウザ内で動きます。</p>
    <div class="pg-grid">
      <div class="pg-schema">
        <h4>テーブル（クリックで挿入）</h4>
        ${schemaHtml}
        <button class="try-sql" id="resetBtn" style="margin-top:8px">サンプルデータを再読込</button>
      </div>
      <div class="pg-main">
        <div class="pg-toolbar">
          <div class="pg-examples"><select id="exampleSel"><option value="">例題を選ぶ…</option>${examplesHtml}</select></div>
        </div>
        <div class="editor-shell"><textarea class="sql-editor" id="sqlEditor" spellcheck="false" placeholder="ここにSQLを書いて Ctrl/⌘ + Enter で実行"></textarea></div>
        <div class="pg-run-row">
          <button class="btn btn-primary" id="runBtn" style="padding:10px 20px">${icon('i-play')} 実行</button>
          <span class="kbd">Ctrl / ⌘ + Enter</span>
        </div>
        <div class="pg-result" id="pgResult">
          <div class="result-info"></div>
          <div class="pg-result-body"></div>
        </div>
      </div>
    </div>`;

  statusEl = root.querySelector('#pgStatus');
  editor = root.querySelector('#sqlEditor');

  // initial editor content
  const pending = sessionStorage.getItem('datable:trysql');
  if (pending) { setEditor(pending); sessionStorage.removeItem('datable:trysql'); }
  else setEditor(EXAMPLES[1].sql);

  const resultBox = root.querySelector('#pgResult');
  const doRun = () => {
    if (!db) { toast('まだ起動中です…'); return; }
    setStatus('ready', '準備完了');
    renderResult(resultBox, getEditor(), icon);
  };

  root.querySelector('#runBtn').addEventListener('click', doRun);
  editor.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); doRun(); }
    if (e.key === 'Tab') { e.preventDefault(); const s = editor.selectionStart; editor.setRangeText('  ', s, editor.selectionEnd, 'end'); }
  });
  root.querySelector('#exampleSel').addEventListener('change', (e) => {
    const i = e.target.value; if (i === '') return;
    setEditor(EXAMPLES[+i].sql); doRun();
  });
  root.querySelectorAll('.pg-table .tname').forEach((el) => el.addEventListener('click', () => {
    setEditor(`SELECT * FROM ${el.dataset.table} LIMIT 50;`); doRun();
  }));
  root.querySelectorAll('.pg-table .cols li').forEach((el) => el.addEventListener('click', () => {
    const s = editor.selectionStart; editor.setRangeText(el.dataset.col, s, editor.selectionEnd, 'end'); editor.focus();
  }));
  root.querySelector('#resetBtn').addEventListener('click', async () => {
    resetDb(); setStatus('', '再読込中…'); await ensureDb(BASE); setStatus('ready', '準備完了'); toast('サンプルデータを再読込しました');
  });

  // boot engine
  try {
    await ensureDb(BASE);
    setStatus('ready', '準備完了');
    doRun();
  } catch (e) {
    setStatus('err', 'エンジン起動失敗');
    resultBox.querySelector('.pg-result-body').innerHTML = `<div class="result-error">SQLエンジンの読み込みに失敗しました（ネットワークをご確認ください）。\n${escapeHtml(e.message || String(e))}</div>`;
  }
}
