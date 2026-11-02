/*globals chrome*/

/*
 * Lưu trữ vĩnh viễn (chrome.storage.local), dùng chung cho content script và popup.
 * Chỉ lưu 3 thứ:
 *   - gps_history : album đã sắp xếp thành công (map id -> bản ghi)
 *   - gps_errors  : các lỗi quan trọng để báo issue
 *   - gps_settings: cài đặt của người dùng (xem GPS_DEFAULT_SETTINGS)
 * Nhật ký tiến độ (PROGRESS/STATUS/RETRY) KHÔNG được lưu ở đây.
 */

const GPS_KEY_HISTORY = 'gps_history';
const GPS_KEY_ERRORS = 'gps_errors';
const GPS_KEY_SETTINGS = 'gps_settings';
// Mặc định = hành vi trước đây (tự tải lại), nên người đang dùng bản cũ không thấy gì thay đổi
const GPS_DEFAULT_SETTINGS = { autoReload: true };
const GPS_MAX_HISTORY = 300;
const GPS_MAX_ERRORS = 50;
const GPS_HEAD = 20; // số ảnh đầu album dùng làm "dấu vân tay" để phát hiện album đã thay đổi

// Hash nhanh (2 vòng 32-bit) của danh sách id theo đúng thứ tự
function gpsHash(ids) {
    const s = ids.join('|');
    let h1 = 0x811c9dc5;
    let h2 = 5381;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 16777619);
        h2 = Math.imul(h2, 33) ^ c;
    }
    return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

const GpsStore = (function () {
    // Ghi tuần tự (read-modify-write) để 2 lần ghi liên tiếp trong cùng một tab không đè nhau
    let queue = Promise.resolve();

    async function read(key, fallback) {
        const res = await chrome.storage.local.get(key);
        return res && res[key] !== undefined ? res[key] : fallback;
    }

    function update(key, fallback, fn) {
        const job = queue.then(async () => {
            const cur = await read(key, fallback);
            await chrome.storage.local.set({ [key]: fn(cur) });
        });
        queue = job.catch(() => {});
        return job;
    }

    function version() {
        try {
            return chrome.runtime.getManifest().version;
        } catch (e) {
            return '?';
        }
    }

    return {
        getHistory: () => read(GPS_KEY_HISTORY, {}),
        getErrors: () => read(GPS_KEY_ERRORS, []),

        // Luôn trả về đủ mọi khóa: giá trị đã lưu được phủ lên mặc định
        getSettings: async () => Object.assign({}, GPS_DEFAULT_SETTINGS, await read(GPS_KEY_SETTINGS, {})),
        setSetting: (name, value) => update(GPS_KEY_SETTINGS, {}, (s) => Object.assign({}, s, { [name]: value })),

        // rec: { id, type, unum, title, n, k, h, at }
        saveAlbum(rec) {
            return update(GPS_KEY_HISTORY, {}, (map) => {
                map[rec.id] = rec;
                const ids = Object.keys(map);
                if (ids.length > GPS_MAX_HISTORY) {
                    ids.sort((a, b) => map[a].at - map[b].at);
                    ids.slice(0, ids.length - GPS_MAX_HISTORY).forEach((k) => delete map[k]);
                }
                return map;
            });
        },

        addError(message) {
            const entry = { at: Date.now(), v: version(), message: String(message).slice(0, 2000) };
            return update(GPS_KEY_ERRORS, [], (list) => list.concat(entry).slice(-GPS_MAX_ERRORS));
        },

        clearErrors: () => chrome.storage.local.remove(GPS_KEY_ERRORS),
        clearHistory: () => chrome.storage.local.remove(GPS_KEY_HISTORY),
    };
})();
