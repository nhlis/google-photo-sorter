/*globals chrome GpsStore GPS_KEY_HISTORY GPS_KEY_ERRORS GPS_KEY_SETTINGS GPS_DEFAULT_SETTINGS*/

// ĐIỀN THÔNG TIN CỦA BẠN VÀO ĐÂY
const CONFIG = {
    DEV_NAME: 'Tên nhà phát triển',
    DEV_URL: 'https://github.com/nhlis',
    BMC_URL: 'https://buymeacoffee.com/nhlis',
    ISSUE_URL: 'https://github.com/nhlis/google-photo-sorter/issues/new',
};

const $ = (id) => document.getElementById(id);
let cache = { history: {}, errors: [], settings: { ...GPS_DEFAULT_SETTINGS } };

const fmt = (ts) => new Date(ts).toLocaleString();

// Mọi dữ liệu hiển thị (tên album lấy từ tiêu đề trang!) đều đi qua textContent, không dùng innerHTML
function item(cls, title, meta) {
    const d = document.createElement('div');
    d.className = 'item ' + cls;
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = title;
    d.appendChild(t);
    if (meta) {
        const m = document.createElement('div');
        m.className = 'm';
        m.textContent = meta;
        d.appendChild(m);
    }
    return d;
}

function empty(text) {
    const d = document.createElement('div');
    d.className = 'empty';
    d.textContent = text;
    return d;
}

function render() {
    const albums = Object.values(cache.history).sort((a, b) => b.at - a.at);
    const hist = $('history');
    hist.textContent = '';
    if (albums.length === 0) hist.appendChild(empty('Chưa có album nào được sắp xếp.'));
    albums.forEach((r) => hist.appendChild(item('ok', r.title || r.id, `${r.n} ảnh · ${fmt(r.at)}`)));
    $('history-count').textContent = albums.length || ''; // rỗng -> badge tự ẩn (:empty)
    $('history-tools').hidden = albums.length === 0;

    const errs = cache.errors.slice().reverse();
    const box = $('errors');
    box.textContent = '';
    if (errs.length === 0) box.appendChild(empty('Không có lỗi nào. 🎉'));
    errs.forEach((e) => box.appendChild(item('err', e.message, `${fmt(e.at)} · v${e.v || '?'}`)));
    $('errors-count').textContent = errs.length || '';
    $('errors-tools').hidden = errs.length === 0;

    $('auto-reload').checked = !!cache.settings.autoReload;
}

async function load() {
    try {
        const [history, errors, settings] = await Promise.all([GpsStore.getHistory(), GpsStore.getErrors(), GpsStore.getSettings()]);
        cache = { history, errors, settings };
    } catch (e) {
        cache = { history: {}, errors: [], settings: { ...GPS_DEFAULT_SETTINGS } };
    }
    render();
}

// Content script ghi thêm lúc popup đang mở -> cập nhật ngay
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes[GPS_KEY_HISTORY] || changes[GPS_KEY_ERRORS] || changes[GPS_KEY_SETTINGS])) load();
});

// Tab: chỉ hiện một danh sách tại một thời điểm. Có hỗ trợ phím mũi tên trái/phải theo chuẩn WAI-ARIA tabs.
const TABS = ['history', 'errors'];
function selectTab(name, focus) {
    TABS.forEach((t) => {
        const on = t === name;
        const tab = $('tab-' + t);
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        $('panel-' + t).hidden = !on;
        if (on && focus) tab.focus();
    });
}
TABS.forEach((t, i) => {
    const tab = $('tab-' + t);
    tab.addEventListener('click', () => selectTab(t));
    tab.addEventListener('keydown', (ev) => {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        ev.preventDefault();
        selectTab(TABS[(i + (ev.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length], true);
    });
});

// Công tắc tự động tải lại trang: lưu ngay khi đổi, Sorter đọc lại đúng lúc sắp xếp xong
$('auto-reload').addEventListener('change', async (ev) => {
    try {
        await GpsStore.setSetting('autoReload', ev.currentTarget.checked);
    } catch (e) {
        load(); // ghi thất bại: đọc lại để công tắc phản ánh đúng giá trị đang lưu
    }
});

// Nút "Xóa" cần bấm 2 lần trong 3 giây để tránh xóa nhầm
function armedClear(btn, action) {
    let timer = null;
    btn.addEventListener('click', async () => {
        if (!timer) {
            btn.textContent = 'Bấm lần nữa để xóa';
            btn.classList.add('armed');
            timer = setTimeout(reset, 3000);
            return;
        }
        reset();
        await action();
        load();
    });
    function reset() {
        clearTimeout(timer);
        timer = null;
        btn.textContent = 'Xóa';
        btn.classList.remove('armed');
    }
}
armedClear($('clear-history'), () => GpsStore.clearHistory());
armedClear($('clear-errors'), () => GpsStore.clearErrors());

// Báo lỗi: sao chép báo cáo vào clipboard rồi mở trang tạo issue để người dùng dán vào
$('report').addEventListener('click', async (ev) => {
    const btn = ev.currentTarget;
    const lines = [`GPhotos Sorter v${chrome.runtime.getManifest().version}`, navigator.userAgent, `Thời điểm: ${new Date().toISOString()}`, `Tự động tải lại trang: ${cache.settings.autoReload ? 'bật' : 'tắt'}`, '', cache.errors.length ? '--- Lỗi gần đây ---' : 'Không có lỗi nào được ghi lại.', ...cache.errors.map((e) => `[${new Date(e.at).toISOString()}] (v${e.v || '?'}) ${e.message}`)];
    try {
        await navigator.clipboard.writeText(lines.join('\n'));
        btn.textContent = 'Đã sao chép, hãy dán vào issue';
    } catch (e) {
        btn.textContent = 'Không sao chép được';
    }
    const body = encodeURIComponent('Dán báo cáo lỗi đã sao chép (Ctrl+V) vào đây.\n\nMô tả thêm:\n');
    chrome.tabs.create({ url: `${CONFIG.ISSUE_URL}?body=${body}` });
});

$('coffee').href = CONFIG.BMC_URL;
$('dev').href = CONFIG.DEV_URL;
$('dev').textContent = CONFIG.DEV_NAME;
$('version').textContent = 'v' + chrome.runtime.getManifest().version;

load();
