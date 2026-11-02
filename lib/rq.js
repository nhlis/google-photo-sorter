/*
 * Helper mạng dùng chung.
 * - rq / rq_post KHÔNG bao giờ reject: lỗi mạng, timeout, HTTP != 200 đều resolve(null).
 *   Mã trạng thái cuối cùng nằm ở rqLastStatus -> dùng describeHttpStatus() để báo lỗi rõ ràng.
 */

var rqLastStatus = 0; // 0 = lỗi mạng, -1 = timeout, còn lại là HTTP status
const RQ_DEFAULT_TIMEOUT = 30000;

function rqSend(method, settings, body) {
    return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => {
            rqLastStatus = xhr.status;
            resolve(xhr.status === 200 ? xhr.response : null);
        };
        xhr.onerror = () => {
            rqLastStatus = 0;
            resolve(null);
        };
        xhr.onabort = xhr.onerror;
        xhr.ontimeout = () => {
            rqLastStatus = -1;
            resolve(null);
        };
        xhr.open(method, settings.url, true);
        xhr.timeout = settings.timeout || RQ_DEFAULT_TIMEOUT;
        xhr.responseType = settings.dataType || 'text';
        if (method === 'POST') {
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
        }
        if (settings.headers) {
            for (const k in settings.headers) xhr.setRequestHeader(k, settings.headers[k]);
        }
        xhr.send(body);
    });
}

function rq(settings) {
    return rqSend('GET', settings);
}

function rq_post(settings) {
    return rqSend('POST', settings, encForm(settings.data));
}

function encForm(data) {
    const params = [];
    for (const name in data) {
        params.push(encodeURIComponent(name) + '=' + encodeURIComponent(data[name]));
    }
    return params.join('&').replace(/%20/g, '+');
}

function describeHttpStatus() {
    if (rqLastStatus === -1) return 'hết thời gian chờ (timeout)';
    if (rqLastStatus === 0) return 'lỗi mạng hoặc yêu cầu bị chặn';
    if (rqLastStatus === 401 || rqLastStatus === 403) return `HTTP ${rqLastStatus} - phiên đăng nhập hết hạn hoặc không có quyền`;
    if (rqLastStatus === 429) return 'HTTP 429 - Google đang giới hạn tần suất yêu cầu';
    return `HTTP ${rqLastStatus}`;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 * Tách response của batchexecute thành danh sách entry ["wrb.fr", rpcid, payload, ..., errorInfo].
 * Chunk nào có dấu hiệu rpcid nhưng không parse được JSON vẫn được coi là "có phản hồi"
 * (giữ đúng độ dễ tính của bản gốc), payload = null.
 */
function batchEntries(res, rpcid) {
    const out = [];
    if (!res) return out;
    const marker = '"wrb.fr","' + rpcid + '"';
    for (const chunk of res.split(/\n\d+\n/)) {
        if (chunk.indexOf(marker) === -1) continue;
        let arr;
        try {
            arr = JSON.parse(chunk);
        } catch (e) {
            out.push(['wrb.fr', rpcid, null]);
            continue;
        }
        if (!Array.isArray(arr)) continue;
        for (const entry of arr) {
            if (Array.isArray(entry) && entry[0] === 'wrb.fr' && entry[1] === rpcid) out.push(entry);
        }
    }
    return out;
}

// Entry lỗi có dạng ["wrb.fr", rpcid, null, null, null, [3], "generic"]
function entryFailed(entry) {
    return entry[2] == null && Array.isArray(entry[5]);
}
