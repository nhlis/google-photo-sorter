/*globals rq rq_post encForm batchEntries entryFailed describeHttpStatus sleep CancelError*/

// Build label dự phòng; ưu tiên lấy giá trị hiện hành (cfb2h) từ chính trang Google Photos
const DEFAULT_BL = 'boq_photosuiserver_20190709.14_p0';

// Dấu hiệu nhận biết khối dữ liệu album trong HTML (giữ đúng như bản Chrome gốc)
const ALBUM_DATA_MARKER = 'data:[null,[[';

class Album {
    /**
     * @param ui   đối tượng Gui dùng để báo tiến độ/log và kiểm tra hủy
     * @param opts { like: Album } sao chép danh tính album (khi quét lại để kiểm tra),
     *             { quiet: true } không cập nhật thanh tiến độ
     */
    constructor(ui, opts = {}) {
        this.ui = ui;
        this.quiet = !!opts.quiet;

        if (opts.like) {
            const o = opts.like;
            this.unum = o.unum;
            this.type = o.type;
            this.id = o.id;
            this.query = o.query;
        } else {
            const mu = location.pathname.match(/\/u\/(\d+)\//);
            const ma = location.pathname.match(/\/(album|share)\/([^/?]+)/);
            if (!ma) throw new Error('Trang hiện tại không phải album Google Photos');
            this.unum = mu ? mu[1] : '0';
            this.type = ma[1];
            this.id = ma[2];
            this.query = location.search; // giữ ?key=... của link chia sẻ
        }

        this.url_f = `https://photos.google.com/u/${this.unum}/`;
        this.f_sid = null;
        this.at_ = null;
        this.bl = DEFAULT_BL;
        this.imgs = [];
        this.seen = new Set();
        this.total = null;
        this.declared = null; // số ảnh do album tự khai báo (null nếu không có)
        this.new_imgs = [];
    }

    report(label, cur, max) {
        if (!this.quiet) this.ui.progress('scan', label, cur, max);
    }

    async getDirectAlbum() {
        const src = await rq({
            url: `${this.url_f}${this.type}/${this.id}${this.query}`,
            dataType: 'text',
            headers: { 'Cache-Control': 'no-cache' },
        });
        if (!src) throw new Error(`Không tải được trang album (${describeHttpStatus()})`);
        return src;
    }

    makeUrl(rpcids) {
        const reqid = Math.floor(Math.random() * 799999) + 200000;
        const q_o = {
            rpcids: rpcids,
            _reqid: reqid.toString(),
            bl: this.bl,
            'f.sid': this.f_sid || '',
            hl: 'ja',
            rt: 'c',
            'soc-app': '165',
            'soc-device': '1',
            'soc-platform': '1',
        };
        return this.url_f + '_/PhotosUi/data/batchexecute?' + encForm(q_o);
    }

    static pick(src, key) {
        const m = src.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"'));
        if (!m) return null;
        try {
            return JSON.parse('"' + m[1] + '"');
        } catch (e) {
            return m[1];
        }
    }

    readTokens(src) {
        let wiz = null;
        try {
            wiz = JSON.parse(src.split('window.WIZ_global_data = ')[1].split(';</script>')[0]);
        } catch (e) {
            /* dùng regex bên dưới */
        }
        const get = (k) => (wiz && wiz[k]) || Album.pick(src, k);
        this.at_ = get('SNlM0e');
        this.f_sid = get('FdrFJe');
        this.bl = get('cfb2h') || DEFAULT_BL;
        if (!this.at_) {
            throw new Error('Không tìm thấy token phiên (SNlM0e). Hãy tải lại trang, đăng nhập lại Google, hoặc Google đã đổi cấu trúc trang.');
        }
        if (!this.f_sid) this.ui.log('STATUS', 'Cảnh báo: không tìm thấy f.sid, vẫn thử tiếp.');
    }

    addImgs(list) {
        let added = 0;
        for (const img of list) {
            const id = img && img[0];
            if (!id || this.seen.has(id)) continue;
            this.seen.add(id);
            this.imgs.push(img);
            added++;
        }
        return added;
    }

    async setNextImgs(nextToken) {
        const data = {
            'f.req': JSON.stringify([[['snAcKc', JSON.stringify([this.id, nextToken, null, null, true]), null, 'generic']]]),
            at: this.at_,
        };

        let res = null;
        for (let attempt = 1; attempt <= 3 && !res; attempt++) {
            this.ui.throwIfCancelled();
            res = await rq_post({ url: this.makeUrl('snAcKc'), dataType: 'text', data });
            if (!res && attempt < 3) {
                this.ui.log('RETRY', `Quét trang tiếp theo thất bại (${describeHttpStatus()}). Thử lại ${attempt}/3...`);
                await sleep(attempt * 1000);
            }
        }
        if (!res) throw new Error(`Không quét được danh sách ảnh (${describeHttpStatus()})`);

        const entry = batchEntries(res, 'snAcKc')[0];
        if (!entry || entry[2] == null || entryFailed(entry)) {
            throw new Error('Google trả về lỗi khi quét danh sách ảnh (có thể hết phiên hoặc bị giới hạn tần suất)');
        }
        const rj2 = JSON.parse(entry[2]);
        const added = this.addImgs(Array.isArray(rj2[1]) ? rj2[1] : []);
        this.report('Quét ảnh', this.imgs.length, this.total);
        return { next: rj2[2], added };
    }

    /**
     * Đọc JSON từ thẻ <script class="ds:N">AF_initDataCallback({key: 'ds:N', hash: '..', data:[...], sideChannel: {}});</script>
     * @returns mảng data đã parse, hoặc null nếu không đọc được
     */
    static parseDataBlock(tag) {
        try {
            let s = tag.replace(/^<script[^>]*>\s*AF_initDataCallback\(/, '').replace(/\);?\s*<\/script>$/, '');
            const m = s.match(/\bdata:\s*/);
            if (!m) return null;
            s = s.slice(m.index + m[0].length);
            // Cắt tại "sideChannel:" cuối cùng. Cách split(/data:\s*/)[1] của bản cũ bị cắt nhầm
            // nếu tên album/ảnh trong dữ liệu có chứa chữ "data:".
            const k = s.lastIndexOf('sideChannel:');
            s = k === -1 ? s.replace(/\}\s*$/, '') : s.slice(0, k).replace(/,\s*$/, '');
            return JSON.parse(s);
        } catch (e) {
            return null;
        }
    }

    /**
     * Chọn khối dữ liệu album trong HTML.
     * Quy tắc như bản Chrome gốc: trong các khối có marker thì lấy khối CUỐI CÙNG; nếu có khối khai báo
     * tổng số ảnh ([3][21], trường bản gốc dùng để hiển thị tiến độ) thì chỉ xét các khối đó.
     * (Bản Firefox trước đó dùng Array.find nên lấy khối ĐẦU TIÊN, dễ trúng một khối khác chỉ có 1 mục
     * và báo "album chỉ có 1 ảnh".) Không âm thầm đoán: khối được chọn hỏng hoặc không có khối hợp lệ
     * thì báo lỗi kèm danh sách các khối đã thấy.
     */
    static pickAlbumBlock(src) {
        const tags = src.match(/<script[^>]*class="ds:\d+"[^>]*>AF_initDataCallback\([^<]+<\/script>/g) || [];
        if (tags.length === 0) {
            throw new Error('Không tìm thấy dữ liệu album trong trang (AF_initDataCallback). Google có thể đã đổi cấu trúc trang.');
        }
        const blocks = tags.map((tag) => {
            const stat_j = Album.parseDataBlock(tag);
            return {
                key: (tag.match(/class="(ds:\d+)"/) || [])[1] || '?',
                marker: tag.indexOf(ALBUM_DATA_MARKER) > -1,
                stat_j,
                count: stat_j && Array.isArray(stat_j[1]) ? stat_j[1].length : null,
                total: stat_j && Array.isArray(stat_j[3]) && typeof stat_j[3][21] === 'number' ? stat_j[3][21] : null,
            };
        });
        const summary = blocks.map((b) => `${b.key}(${b.marker ? 'marker, ' : ''}${b.count === null ? 'không có danh sách' : b.count + ' mục'}${b.total === null ? '' : ', khai báo ' + b.total})`).join(', ');

        const marked = blocks.filter((b) => b.marker);
        if (marked.length > 0) {
            const withTotal = marked.filter((x) => x.total !== null);
            const pool = withTotal.length > 0 ? withTotal : marked;
            const b = pool[pool.length - 1];
            if (b.count === null) {
                throw new Error(`Khối ${b.key} có marker album nhưng không đọc được danh sách ảnh. Các khối: ${summary}`);
            }
            return { stat_j: b.stat_j, key: b.key, note: '', summary };
        }

        // Không khối nào có marker: chỉ chấp nhận khi có đúng 1 khối trông như danh sách ảnh
        const lists = blocks.filter((b) => b.count > 0 && b.stat_j[1].some((e) => Array.isArray(e) && e[0]));
        if (lists.length === 1) {
            return { stat_j: lists[0].stat_j, key: lists[0].key, note: ' (không có marker, ứng viên duy nhất)', summary };
        }
        throw new Error(lists.length === 0 ? `Không tìm thấy danh sách ảnh trong trang album (album trống, hoặc Google đã đổi cấu trúc trang). Các khối: ${summary}` : `Không xác định được khối dữ liệu album: có ${lists.length} ứng viên và không khối nào có marker. Các khối: ${summary}`);
    }

    /**
     * Chỉ đọc trang đầu của album (1 request GET, không phân trang).
     * Dùng để kiểm tra nhanh album đã sắp xếp có bị thay đổi hay không.
     * @returns { ids: id các ảnh ở trang đầu, total: số ảnh khai báo hoặc null }
     */
    async peekFirstPage() {
        const src = await this.getDirectAlbum();
        const { stat_j } = Album.pickAlbumBlock(src);
        const ids = stat_j[1].map((e) => e && e[0]).filter(Boolean);
        const declared = stat_j[3] && stat_j[3][21];
        return { ids, total: typeof declared === 'number' && declared > 0 ? declared : null };
    }

    async parseAlbum() {
        const src = await this.getDirectAlbum();
        this.readTokens(src);

        const { stat_j, key, note, summary } = Album.pickAlbumBlock(src);
        this.ui.log('STATUS', `Khối dữ liệu album: ${key}${note} - ${stat_j[1].length} mục ở trang đầu. Các khối tìm thấy: ${summary}`);

        this.addImgs(stat_j[1]);
        let nextToken = stat_j[2];
        const declared = stat_j[3] && stat_j[3][21]; // số ảnh do album tự khai báo
        this.declared = typeof declared === 'number' && declared > 0 ? declared : null;
        this.total = this.declared || this.imgs.length;
        this.report('Quét ảnh', this.imgs.length, this.total);

        // Bản gốc dùng `while (nextToken != '')`: nếu token cuối là null/undefined thì lặp vô hạn.
        // Dùng kiểm tra "truthy" + giới hạn số vòng + dừng khi không có ảnh mới.
        let stalled = 0;
        for (let page = 0; nextToken; page++) {
            this.ui.throwIfCancelled();
            if (page > 2000) throw new Error('Quét album vượt quá giới hạn số trang, đã dừng để tránh lặp vô hạn');
            const r = await this.setNextImgs(nextToken);
            nextToken = r.next;
            stalled = r.added === 0 ? stalled + 1 : 0;
            if (stalled >= 3) {
                this.ui.log('STATUS', 'Cảnh báo: 3 trang liên tiếp không có ảnh mới, dừng quét.');
                break;
            }
        }
        if (typeof declared === 'number' && declared > this.imgs.length) {
            this.ui.log('STATUS', `Cảnh báo: album khai báo ${declared} ảnh nhưng chỉ quét được ${this.imgs.length}.`);
        }
        return true;
    }
}
