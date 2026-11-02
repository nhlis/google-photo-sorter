/*globals GpsStore*/

const GPS_HOST_ID = 'gphoto-sorter-host';
const GPS_MAX_LOGS = 200;
const GPS_RELOAD_DELAY = 2500;
const GPS_LOGS = []; // nhật ký tạm trong tab (chỉ hiển thị ở panel trên trang, mất khi tải lại)

class CancelError extends Error {
    constructor() {
        super('Đã dừng theo yêu cầu');
        this.name = 'CancelError';
    }
}

// Các bước hiển thị trên stepper (key khớp với tham số phase của progress())
const GPS_PHASES = [
    { key: 'scan', label: 'Quét album' },
    { key: 'info', label: 'Đọc tên ảnh' },
    { key: 'sort', label: 'Sắp xếp' },
    { key: 'verify', label: 'Kiểm tra' },
];

const GPS_ICONS = {
    sort: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M3 18h6v-2H3v2zM3 6v2h18V6H3zm0 7h12v-2H3v2z"/></svg>',
    minus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19 13H5v-2h14v2z"/></svg>',
    ok: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm-2 15l-5-5 1.4-1.4L10 14.2l7.6-7.6L19 8l-9 9z"/></svg>',
    err: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
    info: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>',
};

const GPS_CSS = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.wrap {
    --bg: #ffffff; --fg: #202124; --muted: #5f6368; --line: #e3e5e8; --surface: #f1f3f4;
    --primary: #1a73e8; --primary-fg: #ffffff; --primary-soft: #e8f0fe;
    --ok: #188038; --ok-soft: #e6f4ea; --err: #c5221f; --err-soft: #fce8e6; --warn: #b06000;
    --shadow: 0 10px 32px rgba(32, 33, 36, .22), 0 1px 3px rgba(32, 33, 36, .12);
    font-family: 'Google Sans', 'Roboto', system-ui, -apple-system, 'Segoe UI', sans-serif;
    font-size: 14px; line-height: 1.45; color: var(--fg);
}
@media (prefers-color-scheme: dark) {
    .wrap {
        --bg: #202124; --fg: #e8eaed; --muted: #9aa0a6; --line: #3c4043; --surface: #2d2e31;
        --primary: #8ab4f8; --primary-fg: #202124; --primary-soft: #263449;
        --ok: #81c995; --ok-soft: #1f3a2a; --err: #f28b82; --err-soft: #472624; --warn: #fdd663;
        --shadow: 0 10px 32px rgba(0, 0, 0, .6);
    }
}
.card {
    width: 340px; max-width: calc(100vw - 32px);
    background: var(--bg); border: 1px solid var(--line); border-radius: 20px;
    box-shadow: var(--shadow); overflow: hidden;
}
.wrap[data-collapsed="true"] .card { display: none; }
.wrap[data-collapsed="false"] .fab { display: none; }

header { display: flex; align-items: center; gap: 12px; padding: 16px 12px 6px 18px; }
.logo {
    width: 36px; height: 36px; border-radius: 12px; flex: none;
    display: grid; place-items: center; background: var(--primary-soft); color: var(--primary);
}
.titles { min-width: 0; }
h2 { margin: 0; font-size: 16px; font-weight: 600; letter-spacing: 0; }
.sub { margin: 0; font-size: 12px; color: var(--muted); }
.icon-btn {
    margin-left: auto; flex: none; width: 32px; height: 32px; border: 0; border-radius: 50%;
    display: grid; place-items: center; background: transparent; color: var(--muted); cursor: pointer;
}
.icon-btn:hover { background: var(--surface); }

.body { display: flex; flex-direction: column; gap: 14px; padding: 6px 18px 18px; }
.hint { margin: 0; color: var(--muted); }

.steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.step { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; font-size: 11px; color: var(--muted); }
.dot {
    width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center;
    border: 2px solid var(--line); background: var(--bg); font-size: 12px; font-weight: 600;
}
.step.active { color: var(--fg); font-weight: 600; }
.step.active .dot { border-color: var(--primary); color: var(--primary); }
.step.done .dot { background: var(--primary); border-color: var(--primary); color: var(--primary-fg); }

.pline { display: flex; justify-content: space-between; gap: 8px; margin-bottom: 6px; font-size: 12px; color: var(--muted); }
.bar { height: 8px; border-radius: 8px; background: var(--surface); overflow: hidden; }
.fill { height: 100%; width: 0; border-radius: 8px; background: var(--primary); transition: width .25s ease; }
.bar.indeterminate .fill { width: 35%; animation: slide 1.1s ease-in-out infinite; }
@keyframes slide { from { transform: translateX(-100%); } to { transform: translateX(300%); } }

.msg { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 12px; font-size: 13px; }
.msg svg { flex: none; margin-top: 1px; }
.msg.ok { background: var(--ok-soft); color: var(--ok); }
.msg.err { background: var(--err-soft); color: var(--err); }
.msg.info { background: var(--surface); color: var(--fg); }
.msg-title { display: block; font-weight: 600; }
.msg-detail { display: block; margin-top: 2px; opacity: .9; word-break: break-word; }

.actions { display: flex; gap: 8px; }
.btn {
    flex: 1; border: 1px solid transparent; border-radius: 999px; padding: 11px 16px;
    font: inherit; font-weight: 500; cursor: pointer;
    transition: background-color .15s, box-shadow .15s, transform .1s;
}
.btn:active { transform: scale(.98); }
.btn.primary { background: var(--primary); color: var(--primary-fg); }
.btn.primary:hover { box-shadow: 0 2px 10px rgba(26, 115, 232, .35); }
.btn.ghost { background: transparent; color: var(--primary); border-color: var(--line); }
.btn.ghost:hover { background: var(--primary-soft); }
.btn.danger { background: transparent; color: var(--err); border-color: var(--err); }
.btn.danger:hover { background: var(--err-soft); }
.btn:focus-visible, .icon-btn:focus-visible, .fab:focus-visible, summary:focus-visible {
    outline: 2px solid var(--primary); outline-offset: 2px;
}

.logs summary { cursor: pointer; font-size: 12px; color: var(--muted); }
.logbox {
    margin-top: 8px; max-height: 120px; overflow: auto; padding: 8px 10px; border-radius: 10px;
    background: var(--surface); font: 11px/1.5 ui-monospace, Consolas, monospace; color: var(--fg);
    white-space: pre-wrap; word-break: break-word;
}
.logbox .ERROR { color: var(--err); }
.logbox .RETRY { color: var(--warn); }
.logbox .PROGRESS { color: var(--muted); }

.fab {
    display: flex; align-items: center; gap: 8px; padding: 12px 18px; border: 0; border-radius: 999px;
    background: var(--primary); color: var(--primary-fg); font: inherit; font-weight: 500; cursor: pointer;
    box-shadow: var(--shadow);
}
@media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
}
`;

const GPS_HTML = `
<div class="wrap" id="wrap" data-collapsed="false">
    <button class="fab" id="fab" type="button" aria-label="Mở bộ sắp xếp album">
        ${GPS_ICONS.sort}<span id="fab-text">Sắp xếp album</span>
    </button>
    <section class="card" aria-label="Sắp xếp album Google Photos">
        <header>
            <div class="logo">${GPS_ICONS.sort}</div>
            <div class="titles">
                <h2>Sắp xếp album</h2>
                <p class="sub">Theo tên file, A đến Z</p>
            </div>
            <button class="icon-btn" id="min" type="button" aria-label="Thu nhỏ">${GPS_ICONS.minus}</button>
        </header>
        <div class="body">
            <p class="hint" id="hint">Xếp toàn bộ ảnh trong album theo tên file. Số trong tên được so theo giá trị nên IMG_2 đứng trước IMG_10. Chỉ thứ tự trong album này thay đổi.</p>
            <ol class="steps" id="steps" hidden>
                ${GPS_PHASES.map((p, i) => `<li class="step"><span class="dot">${i + 1}</span><span>${p.label}</span></li>`).join('')}
            </ol>
            <div id="progress" hidden>
                <div class="pline"><span id="ptext">Đang chuẩn bị</span><span id="ppct"></span></div>
                <div class="bar" id="bar"><div class="fill" id="fill"></div></div>
            </div>
            <div class="msg info" id="msg" role="status" aria-live="polite" hidden>
                <span id="msg-icon"></span>
                <span><span class="msg-title" id="msg-title"></span><span class="msg-detail" id="msg-detail"></span></span>
            </div>
            <div class="actions">
                <button class="btn primary" id="main" type="button"></button>
                <button class="btn ghost" id="second" type="button"></button>
            </div>
            <details class="logs"><summary>Nhật ký</summary><div class="logbox" id="logbox"></div></details>
        </div>
    </section>
</div>`;

class Gui {
    constructor() {
        this.settings = {};
        this.state = 'idle'; // idle | checking | sorted | running | done | error | cancelled
        this.notice = null; // { kind: 'ok'|'err'|'info', title, detail, reload }
        this.cancelled = false;
        this.collapsed = false;
        this.reloadTimer = null;
        this.lastLoggedPct = -1;
        this.actions = {};
        this.view = { phase: 'scan', label: '', cur: 0, max: 0 };
        this.ui = null;
        this.injectUI();
    }

    /* ------------------------------ DOM ------------------------------ */

    injectUI() {
        if (document.getElementById(GPS_HOST_ID)) return;

        const host = document.createElement('div');
        host.id = GPS_HOST_ID;
        host.style.cssText = 'all: initial; position: fixed; right: 24px; bottom: 24px; z-index: 2147483647;';
        // Shadow DOM: CSS của Google Photos không ảnh hưởng tới panel và ngược lại
        const root = host.attachShadow({ mode: 'open' });
        root.innerHTML = `<style>${GPS_CSS}</style>${GPS_HTML}`;
        (document.body || document.documentElement).appendChild(host);

        const $ = (id) => root.getElementById(id);
        this.ui = {
            host,
            wrap: $('wrap'),
            fab: $('fab'),
            fabText: $('fab-text'),
            min: $('min'),
            hint: $('hint'),
            steps: $('steps'),
            stepEls: Array.from(root.querySelectorAll('.step')),
            progress: $('progress'),
            ptext: $('ptext'),
            ppct: $('ppct'),
            bar: $('bar'),
            fill: $('fill'),
            msg: $('msg'),
            msgIcon: $('msg-icon'),
            msgTitle: $('msg-title'),
            msgDetail: $('msg-detail'),
            main: $('main'),
            second: $('second'),
            logbox: $('logbox'),
        };

        this.ui.min.addEventListener('click', () => this.setCollapsed(true));
        this.ui.fab.addEventListener('click', () => this.setCollapsed(false));
        this.ui.main.addEventListener('click', () => this.actions.main && this.actions.main[1]());
        this.ui.second.addEventListener('click', () => this.actions.second && this.actions.second[1]());

        GPS_LOGS.slice(-100).forEach((e) => this.appendLogToPanel(e));
        this.render();
    }

    setCollapsed(v) {
        this.collapsed = v;
        this.render();
    }

    render() {
        const u = this.ui;
        if (!u || !u.host.isConnected) return;
        const s = this.state;
        const v = this.view;
        const running = s === 'running';
        const known = v.max > 0;
        const pct = known ? Math.min(100, Math.floor((v.cur / v.max) * 100)) : 0;

        u.wrap.dataset.collapsed = String(this.collapsed);
        u.wrap.dataset.state = s;

        u.hint.hidden = s !== 'idle' || !!this.notice;
        u.steps.hidden = !running;
        u.progress.hidden = !running;
        u.msg.hidden = !this.notice || running;

        if (running) {
            const idx = GPS_PHASES.findIndex((p) => p.key === v.phase);
            u.stepEls.forEach((li, i) => {
                li.className = 'step' + (i < idx ? ' done' : i === idx ? ' active' : '');
                li.firstElementChild.textContent = i < idx ? '✓' : String(i + 1);
            });
            u.bar.classList.toggle('indeterminate', !known);
            u.fill.style.width = known ? pct + '%' : '';
            u.ptext.textContent = v.label ? (known ? `${v.label}: ${v.cur}/${v.max}` : v.label) : 'Đang chuẩn bị';
            u.ppct.textContent = known ? pct + '%' : '';
        }

        if (this.notice && !running) {
            const n = this.notice;
            u.msg.className = 'msg ' + n.kind;
            u.msgIcon.innerHTML = GPS_ICONS[n.kind] || GPS_ICONS.info;
            u.msgTitle.textContent = n.title;
            u.msgDetail.textContent = n.detail || '';
            u.msgDetail.hidden = !n.detail;
        }

        // Nút hành động theo trạng thái: [nhãn, hàm xử lý]
        const run = () => typeof this.run === 'function' && this.run();
        const map = {
            idle: { main: ['Sắp xếp theo tên', run] },
            checking: {},
            sorted: { second: ['Sắp xếp lại', run] },
            running: { second: ['Dừng lại', () => this.requestCancel(), 'danger'] },
            done: this.notice && this.notice.reload ? { main: ['Tải lại trang', () => location.reload()], second: ['Sắp xếp lại', run] } : { main: ['Sắp xếp lại', run] },
            error: { main: ['Thử lại', run] },
            cancelled: { main: ['Sắp xếp lại', run] },
        };
        this.actions = map[s] || {};
        const a = this.actions;
        u.main.hidden = !a.main;
        if (a.main) u.main.textContent = a.main[0];
        u.second.hidden = !a.second;
        if (a.second) {
            u.second.textContent = a.second[0];
            u.second.className = 'btn ' + (a.second[2] === 'danger' ? 'danger' : 'ghost');
        }

        u.fabText.textContent = s === 'running' ? (known ? `Đang xử lý ${pct}%` : 'Đang xử lý') : s === 'done' ? 'Hoàn tất' : s === 'sorted' ? 'Đã sắp xếp' : s === 'checking' ? 'Đang kiểm tra' : s === 'error' ? 'Có lỗi' : 'Sắp xếp album';
    }

    /* --------------------------- Trạng thái --------------------------- */

    setState(state, notice = null) {
        clearTimeout(this.reloadTimer);
        this.reloadTimer = null;
        this.state = state;
        this.notice = notice;
        this.render();
    }

    resetView() {
        if (this.state === 'running') return;
        this.view = { phase: 'scan', label: '', cur: 0, max: 0 };
        this.lastLoggedPct = -1;
        this.setState('idle');
        // Sorter cài đặt checkSorted(): hỏi lịch sử xem album mới này đã sắp xếp chưa
        if (typeof this.checkSorted === 'function') this.checkSorted();
    }

    // reload: trang phải tải lại mới thấy thứ tự mới (panel hiện nút "Tải lại trang")
    // auto  : tự tải lại sau GPS_RELOAD_DELAY; false thì để người dùng tự bấm nút
    succeed(title, detail, reload, auto = true) {
        this.log('STATUS', title);
        this.setState('done', { kind: 'ok', title, detail, reload });
        if (reload && auto) this.reloadTimer = setTimeout(() => location.reload(), GPS_RELOAD_DELAY);
    }

    fail(e) {
        if (e instanceof CancelError) {
            this.log('STATUS', 'Đã dừng theo yêu cầu.');
            this.setState('cancelled', { kind: 'info', title: 'Đã dừng', detail: 'Một phần ảnh có thể đã được xếp lại. Chạy lại để hoàn tất.' });
            return;
        }
        console.error('[GPhotos Sorter]', e);
        const message = (e && e.message) || String(e);
        // Gộp message + vài dòng stack thành MỘT bản ghi lỗi; bỏ tiền tố chrome-extension://<id>/ cho gọn
        const stack =
            e && e.stack
                ? String(e.stack)
                      .replace(/chrome-extension:\/\/[^/\s)]+\//g, '')
                      .split('\n')
                      .slice(0, 3)
                      .join('\n')
                : '';
        this.log('ERROR', stack ? `${message}\n${stack}` : message);
        this.setState('error', { kind: 'err', title: 'Không thể sắp xếp album', detail: message });
    }

    requestCancel() {
        if (this.state !== 'running') return;
        this.cancelled = true;
        this.view.label = 'Đang dừng';
        this.log('STATUS', 'Đang dừng, chờ yêu cầu hiện tại kết thúc...');
        this.render();
    }

    throwIfCancelled() {
        if (this.cancelled) throw new CancelError();
    }

    progress(phase, label, cur, max) {
        if (phase !== this.view.phase) this.lastLoggedPct = -1;
        this.view = { phase, label, cur, max };
        const pct = max > 0 ? Math.min(100, Math.floor((cur / max) * 100)) : 0;
        // Chỉ ghi log mỗi ~10% để nhật ký không bị tràn
        if (this.lastLoggedPct < 0 || pct - this.lastLoggedPct >= 10 || (pct === 100 && this.lastLoggedPct !== 100)) {
            this.lastLoggedPct = pct;
            this.log('PROGRESS', `${label}: ${cur}/${max || '?'} (${pct}%)`);
        }
        this.render();
    }

    /* ------------------------------ Log ------------------------------- */

    log(type, message) {
        const entry = { type, message: String(message), time: new Date().toLocaleTimeString() };
        GPS_LOGS.push(entry);
        if (GPS_LOGS.length > GPS_MAX_LOGS) GPS_LOGS.shift();
        this.appendLogToPanel(entry);
        // Chỉ lỗi mới được lưu vĩnh viễn (để báo issue); PROGRESS/STATUS/RETRY chỉ nằm trong panel tạm
        if (type === 'ERROR') {
            try {
                GpsStore.addError(entry.message).catch(() => {});
            } catch (e) {
                /* extension vừa reload, bỏ qua */
            }
        }
    }

    appendLogToPanel(entry) {
        const box = this.ui && this.ui.logbox;
        if (!box) return;
        const line = document.createElement('div');
        line.className = entry.type;
        line.textContent = `[${entry.time}] ${entry.message}`;
        box.appendChild(line);
        while (box.childElementCount > 100) box.removeChild(box.firstElementChild);
        box.scrollTop = box.scrollHeight;
    }
}
