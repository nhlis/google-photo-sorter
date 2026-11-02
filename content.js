/*globals Sorter GPS_HOST_ID*/

(function () {
    console.log('[GPhotos Sorter] Content script loaded (Chrome)');

    const ALBUM_RE = /\/(album|share)\/([^/?]+)/;
    let sorter = null;
    let lastPath = null;

    const isAlbumPage = () => ALBUM_RE.test(location.pathname) && !location.pathname.includes('/photo/');

    // Google Photos là SPA nên phải tự theo dõi việc chuyển trang
    function sync() {
        const host = document.getElementById(GPS_HOST_ID);

        if (!isAlbumPage()) {
            if (host) host.remove();
        } else if (!sorter) {
            sorter = new Sorter();
        } else if (!host) {
            sorter.injectUI();
        }

        if (sorter && lastPath !== null && lastPath !== location.pathname) {
            if (sorter.state === 'running') {
                // Đang chạy mà người dùng chuyển trang: dừng để không thao tác nhầm album / reload nhầm trang
                sorter.log('STATUS', 'Bạn đã chuyển trang, dừng quá trình sắp xếp.');
                sorter.requestCancel();
            } else {
                sorter.resetView();
            }
        }
        lastPath = location.pathname;
    }

    setInterval(sync, 1000);
    sync();
})();
