/*globals Gui Album GpsStore GPS_DEFAULT_SETTINGS gpsHash GPS_HEAD CancelError rq_post numReplacer numP batchEntries entryFailed describeHttpStatus sleep rqLastStatus*/

// Jitter Delay: chờ một khoảng ngẫu nhiên để giả lập người dùng
function randomDelay(minMs = 300, maxMs = 700) {
    return sleep(Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs);
}

class Img {
    constructor(payload) {
        const meta = payload && payload[0];
        this.id = meta ? meta[0] : null;
        this.name = meta && meta[2] != null ? String(meta[2]) : '';
        this.modified = meta ? meta[3] : null;
    }
}

class Sorter extends Gui {
    constructor() {
        super();
        this.al = null;
        this.imgIdSet = {};
        this.skipped = 0;
        this.checkToken = 0; // tăng mỗi lần kiểm tra để bỏ kết quả cũ khi người dùng đổi album
        this.checkSorted(); // album đã có trong lịch sử thì báo "đã sắp xếp" ngay
    }

    resetState() {
        // Bản gốc không reset imgIdSet giữa các lần chạy -> lần chạy lại (sau lỗi) thấy
        // "đã có đủ ảnh", sắp xếp 0 ảnh rồi báo thành công giả.
        this.al = null;
        this.imgIdSet = {};
        this.skipped = 0;
        this.cancelled = false;
        this.lastLoggedPct = -1;
        this.view = { phase: 'scan', label: '', cur: 0, max: 0 };
    }

    /* ------------------------------ Gọi API ------------------------------ */

    isBatchOk(res, rpcid) {
        const entries = batchEntries(res, rpcid);
        return entries.length > 0 && !entries.some(entryFailed);
    }

    // Thử lại với exponential backoff
    async postWithRetry(url, data, rpcid, maxRetries = 4) {
        let delay = 1000;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            this.throwIfCancelled();
            const res = await rq_post({ url, dataType: 'text', data });
            if (this.isBatchOk(res, rpcid)) return res;

            // 401/403: token hết hạn, thử lại vô ích
            if (rqLastStatus === 401 || rqLastStatus === 403) return null;

            if (attempt < maxRetries) {
                const why = res ? 'Google trả về lỗi' : describeHttpStatus();
                this.log('RETRY', `${why}. Thử lại ${attempt}/${maxRetries - 1} sau ${delay}ms...`);
                await sleep(delay);
                delay *= 2;
            }
        }
        return null;
    }

    /* ------------------------------ Đọc tên ảnh ------------------------------ */

    makeImgInfosFreq(imgs) {
        const list = [];
        for (let i = 0; i < imgs.length; i++) {
            list.push(['fDcn4b', JSON.stringify([imgs[i][0], 1]), null, (i + 1).toString()]);
        }
        return [list];
    }

    addNewImgs(res) {
        for (const entry of batchEntries(res, 'fDcn4b')) {
            if (entry[2] == null) continue;
            let payload;
            try {
                payload = JSON.parse(entry[2]);
            } catch (e) {
                continue;
            }
            const io = new Img(payload);
            if (!io.id || this.imgIdSet[io.id]) continue;
            this.imgIdSet[io.id] = true;
            this.al.new_imgs.push(io);
        }
    }

    async fetchInfos(imgs, label) {
        const byNum = 50;
        for (let i = 0; i < imgs.length; i += byNum) {
            this.throwIfCancelled();
            const chunk = imgs.slice(i, i + byNum);
            const data = { 'f.req': JSON.stringify(this.makeImgInfosFreq(chunk)), at: this.al.at_ };
            const res = await this.postWithRetry(this.al.makeUrl('fDcn4b'), data, 'fDcn4b', 3);
            if (!res) throw new Error(`Không đọc được tên ảnh ${i + 1}-${i + chunk.length} (${describeHttpStatus()})`);
            this.addNewImgs(res);
            this.progress('info', label, Math.min(i + byNum, imgs.length), imgs.length);
        }
    }

    // Bản gốc chỉ là stub ("Giả sử đã xử lý xong") nên ảnh thiếu metadata bị bỏ qua âm thầm.
    async fillMissingImgInfos() {
        const findMissing = () => this.al.imgs.filter((img) => !this.imgIdSet[img[0]]);
        for (let pass = 1; pass <= 2; pass++) {
            const missing = findMissing();
            if (missing.length === 0) return;
            this.log('STATUS', `Thiếu tên của ${missing.length} ảnh, đang lấy bổ sung (lần ${pass}/2)...`);
            await this.fetchInfos(missing, 'Bổ sung tên ảnh');
        }
        this.skipped = findMissing().length;
        if (this.skipped > 0) {
            this.log('ERROR', `${this.skipped} ảnh không đọc được tên, sẽ giữ nguyên vị trí.`);
        }
    }

    /* ------------------------------ Sắp xếp ------------------------------ */

    sortBy(a, b) {
        const an = a.name.toLowerCase().replace(numP, numReplacer);
        const bn = b.name.toLowerCase().replace(numP, numReplacer);
        if (an < bn) return -1;
        if (an > bn) return 1;
        return 0;
    }

    makeSortFreq(baseImg, followImgs) {
        const keys = followImgs.map((img) => [[img.id]]);
        const j1 = [this.al.id, [], 3, null, keys, [[baseImg.id]]];
        return [[['QD9nKf', JSON.stringify(j1), null, 'generic']]];
    }

    async sortImgs() {
        this.al.new_imgs.sort(this.sortBy);

        const len = this.al.new_imgs.length;
        const byNum = 10;
        let baseImg = this.al.new_imgs[0];

        for (let i = 1; i < len; i += byNum) {
            this.throwIfCancelled();
            const end = Math.min(i + byNum, len);
            const followImgs = this.al.new_imgs.slice(i, end);
            const data = { 'f.req': JSON.stringify(this.makeSortFreq(baseImg, followImgs)), at: this.al.at_ };

            const res = await this.postWithRetry(this.al.makeUrl('QD9nKf'), data, 'QD9nKf');
            if (!res) throw new Error(`Google chặn hoặc không phản hồi khi sắp xếp ảnh ${i + 1}-${end} (${describeHttpStatus()})`);

            this.progress('sort', 'Sắp xếp', end, len);
            baseImg = followImgs[followImgs.length - 1];
            await randomDelay(400, 800); // ngưng ngẫu nhiên, tránh spam
        }
    }

    /* ------------------------------ Kiểm tra & sửa ------------------------------ */

    isSameOrder(a, b) {
        if (!a || !b || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
        return true;
    }

    // Đã đúng thứ tự tên chưa? Chỉ xét ảnh đọc được tên (giống fixOrder); tên trùng thì thứ tự nào cũng hợp lệ
    isSortedByName(ids, imgMap) {
        let prev = null;
        for (const id of ids) {
            const img = imgMap[id];
            if (!img) continue;
            if (prev && this.sortBy(prev, img) > 0) return false;
            prev = img;
        }
        return true;
    }

    // Trả về snapshot thứ tự hiện tại nếu album ĐÃ đúng thứ tự (khỏi sort), ngược lại null
    async verifySorted() {
        const imgMap = {};
        for (const img of this.al.new_imgs) imgMap[img.id] = img;

        // 1) So bằng snapshot lúc quét đầu: 0 request
        if (
            !this.isSortedByName(
                this.al.imgs.map((img) => img[0]),
                imgMap,
            )
        )
            return null;

        // 2) Có vẻ đã đúng -> quét lại 1 lần cho chắc (snapshot có thể đã cũ sau lúc đọc tên)
        this.progress('verify', 'Kiểm tra thứ tự', 0, 0);
        const snap = await this.getCurrentOrderIds();
        return this.isSortedByName(snap.ids, imgMap) ? snap : null;
    }

    async getCurrentOrderIds() {
        const al = new Album(this, { like: this.al, quiet: true });
        await al.parseAlbum();
        // ids giữ nguyên toàn bộ (không lọc) vì dùng làm dấu vân tay; n = số ảnh album khai báo
        return { ids: al.imgs.map((img) => img[0]), n: al.declared || al.imgs.length };
    }

    async fixOrder(expectedIds) {
        if (expectedIds.length <= 1) return null;

        const imgMap = {};
        for (const img of this.al.new_imgs) imgMap[img.id] = img;

        this.progress('verify', 'Kiểm tra thứ tự', 0, expectedIds.length);
        // Bỏ các ảnh không đọc được tên: không thể xếp chúng nên không đưa vào so sánh
        const snap = await this.getCurrentOrderIds();
        const currentIds = snap.ids.filter((id) => imgMap[id]);
        if (this.isSameOrder(expectedIds, currentIds)) {
            this.log('STATUS', 'Thứ tự đã đúng, không cần sửa.');
            return snap; // lần quét này đã là trạng thái cuối, khỏi quét lại
        }

        const url = this.al.makeUrl('QD9nKf');
        let baseImg = imgMap[expectedIds[0]];
        let fixes = 0;

        for (let i = 1; i < expectedIds.length; i++) {
            this.throwIfCancelled();
            const expectId = expectedIds[i];
            const followImg = imgMap[expectId];

            // Đã nằm ngay sau baseImg thì bỏ qua (kiểm tra theo vị trí thực, không theo chỉ số i
            // như bản gốc - cách đó sai khi ảnh đầu tiên chưa nằm ở vị trí 0)
            const baseIdx = currentIds.indexOf(baseImg.id);
            const curIdx = currentIds.indexOf(expectId);
            if (curIdx === -1) continue; // ảnh không còn trong album (vừa bị xóa?), bỏ qua
            if (baseIdx === -1) {
                baseImg = followImg; // mốc không còn tồn tại, lấy ảnh này làm mốc mới
                continue;
            }
            if (curIdx !== baseIdx + 1) {
                const data = { 'f.req': JSON.stringify(this.makeSortFreq(baseImg, [followImg])), at: this.al.at_ };
                const res = await this.postWithRetry(url, data, 'QD9nKf');
                if (!res) throw new Error(`Sửa thứ tự bị gián đoạn tại ảnh ${i + 1} (${describeHttpStatus()})`);

                // Mô phỏng thao tác "chuyển ảnh này ra ngay sau baseImg"
                currentIds.splice(curIdx, 1);
                currentIds.splice(currentIds.indexOf(baseImg.id) + 1, 0, expectId);
                fixes++;
                await randomDelay(300, 600);
            }
            baseImg = followImg;
            this.progress('verify', 'Sửa thứ tự', i + 1, expectedIds.length);
        }
        this.log('STATUS', `Đã sửa ${fixes} vị trí.`);
        return null; // đã sửa -> phải quét lại để xác nhận (confirmOrder)
    }

    // Quét lại album sau khi sửa để chắc chắn thứ tự thật sự đã đúng; thử tối đa 2 lần vì Google có thể trễ chút
    async confirmOrder(expectedIds) {
        const known = new Set(expectedIds);
        for (let attempt = 1; attempt <= 2; attempt++) {
            this.throwIfCancelled();
            this.progress('verify', 'Xác nhận kết quả', 0, 0);
            const snap = await this.getCurrentOrderIds();
            const present = new Set(snap.ids);
            // Bỏ qua ảnh vừa bị xóa / ảnh mới thêm giữa chừng
            const expected = expectedIds.filter((id) => present.has(id));
            const current = snap.ids.filter((id) => known.has(id));
            if (this.isSameOrder(expected, current)) return snap;
            if (attempt < 2) {
                this.log('RETRY', 'Thứ tự trên Google Photos chưa khớp, chờ 2 giây rồi kiểm tra lại...');
                await sleep(2000);
            }
        }
        return null;
    }

    /* ------------------------------ Lịch sử album ------------------------------ */

    readTitle() {
        // Tiêu đề tab dạng "Tên album - Google Photos" (đuôi phụ thuộc ngôn ngữ nên cắt theo chữ "Google")
        const t = (document.title || '').replace(/\s+[-–—]\s+Google[^-–—]*$/i, '').trim();
        return t && !/^Google\b/i.test(t) ? t : `Album ${this.al.id.slice(-6)}`;
    }

    async recordSorted(snap) {
        const k = Math.min(GPS_HEAD, snap.ids.length);
        const rec = {
            id: this.al.id,
            type: this.al.type,
            unum: this.al.unum,
            title: this.readTitle(),
            n: snap.n,
            k: k,
            h: gpsHash(snap.ids.slice(0, k)),
            at: Date.now(),
        };
        try {
            await GpsStore.saveAlbum(rec);
        } catch (e) {
            // Không làm hỏng kết quả sắp xếp chỉ vì không ghi được lịch sử
            this.log('STATUS', 'Không lưu được lịch sử album: ' + ((e && e.message) || e));
        }
    }

    /* ------------------------------ Kiểm tra album đã sắp xếp ------------------------------ */

    // ui giả: quét nền không được ghi log/tiến độ lên panel
    quietUi() {
        return { log() {}, progress() {}, throwIfCancelled() {} };
    }

    // Kiểm tra nhanh (1 request GET): số ảnh + thứ tự GPS_HEAD ảnh đầu có còn như lúc sắp xếp không.
    // Không phát hiện được việc kéo thả sâu bên trong album; người dùng luôn có nút "Sắp xếp lại".
    async compareWithRecord(rec) {
        const al = new Album(this.quietUi(), { quiet: true });
        const { ids, total } = await al.peekFirstPage();
        if (ids.length < rec.k) return 'unknown';
        if (total !== null && total !== rec.n) return 'changed';
        return gpsHash(ids.slice(0, rec.k)) === rec.h ? 'same' : 'changed';
    }

    async checkSorted() {
        const token = ++this.checkToken;
        const m = location.pathname.match(/\/(album|share)\/([^/?]+)/);
        if (!m || location.pathname.includes('/photo/') || this.state !== 'idle') return;

        let rec;
        try {
            rec = (await GpsStore.getHistory())[m[2]];
        } catch (e) {
            return; // storage lỗi / extension vừa reload: coi như chưa sắp xếp
        }
        if (!rec || token !== this.checkToken || this.state !== 'idle') return;

        this.setState('checking', { kind: 'info', title: 'Đang kiểm tra album...' });
        let verdict = 'unknown';
        try {
            verdict = await this.compareWithRecord(rec);
        } catch (e) {
            /* lỗi mạng/cấu trúc trang: không báo lỗi đỏ, chỉ là chưa xác minh được */
        }
        // Người dùng đã đổi trang hoặc bấm chạy trong lúc chờ -> bỏ kết quả này
        if (token !== this.checkToken || this.state !== 'checking') return;

        const when = new Date(rec.at).toLocaleString();
        if (verdict === 'changed') {
            this.setState('idle', {
                kind: 'info',
                title: 'Album đã thay đổi',
                detail: `Đã sắp xếp lúc ${when}, nhưng số ảnh hoặc thứ tự hiện tại khác. Bạn có thể sắp xếp lại.`,
            });
        } else {
            const tail = verdict === 'unknown' ? ' · chưa kiểm tra được thay đổi sau đó' : '';
            this.setState('sorted', { kind: 'ok', title: 'Album đã được sắp xếp', detail: `${rec.n} ảnh · ${when}${tail}` });
        }
    }

    /* ------------------------------ Luồng chính ------------------------------ */

    // Đọc lúc hoàn tất (không cache) để đổi công tắc trong popup giữa chừng vẫn có hiệu lực
    async shouldAutoReload() {
        try {
            return !!(await GpsStore.getSettings()).autoReload;
        } catch (e) {
            return GPS_DEFAULT_SETTINGS.autoReload; // storage lỗi / extension vừa reload
        }
    }

    async run() {
        if (this.state === 'running') return;
        this.resetState();
        this.setState('running');
        this.log('STATUS', 'Bắt đầu sắp xếp...');

        // Mọi lỗi (kể cả ngoại lệ bất ngờ) đều được bắt ở đây. Bản gốc không có try/catch
        // nên khi có lỗi, nút kẹt mãi ở "Đang xử lý..." mà không hiện gì.
        try {
            this.al = new Album(this);
            await this.al.parseAlbum();
            const total = this.al.imgs.length;
            this.log('STATUS', `Album có ${total} ảnh.`);

            if (total < 2) {
                this.succeed('Không cần sắp xếp', `Album chỉ có ${total} ảnh.`, false);
                return;
            }

            await this.fetchInfos(this.al.imgs, 'Đọc tên ảnh');
            await this.fillMissingImgInfos();

            if (this.al.new_imgs.length < 2) {
                throw new Error('Không đọc được tên ảnh nào từ Google Photos (API có thể đã thay đổi).');
            }

            const already = await this.verifySorted();
            if (already) {
                await this.recordSorted(already); // ghi lại để lần sau khỏi phải kiểm tra
                const note = this.skipped > 0 ? `${this.skipped} ảnh không đọc được tên nên bị bỏ qua. ` : '';
                this.succeed('Album đã đúng thứ tự', note + 'Không cần sắp xếp lại.', false); // false: không cần reload
                return;
            }

            await this.sortImgs();
            const expectedIds = this.al.new_imgs.map((img) => img.id);
            let snap = await this.fixOrder(expectedIds);
            if (!snap) snap = await this.confirmOrder(expectedIds);
            if (!snap) {
                // Không ghi vào lịch sử: không được nhận "đã sắp xếp" khi kết quả thực tế chưa đúng
                throw new Error('Đã gửi lệnh sắp xếp nhưng thứ tự trên Google Photos vẫn chưa khớp. Hãy bấm "Thử lại".');
            }
            await this.recordSorted(snap);

            const n = this.al.new_imgs.length;
            const note = this.skipped > 0 ? `${this.skipped} ảnh không đọc được tên nên giữ nguyên vị trí. ` : '';
            // Đã bấm dừng mà vẫn chạy tới đây (vd. người dùng chuyển album lúc sắp xong) thì không tự tải lại,
            // kẻo reload nhầm sang trang khác. Nút "Tải lại trang" vẫn còn để bấm tay.
            const auto = !this.cancelled && (await this.shouldAutoReload());
            const next = auto ? 'Đang tải lại trang để hiển thị thứ tự mới.' : 'Bấm "Tải lại trang" để hiển thị thứ tự mới.';
            this.succeed(`Đã sắp xếp ${n} ảnh`, note + next, true, auto);
        } catch (e) {
            this.fail(e);
        }
    }
}
