# Google Photos Sorter By Name

Tiện ích mở rộng Chrome (Manifest V3) giúp sắp xếp album Google Photos theo tên file, ngay trên trang album.

Google Photos cho phép sắp xếp album theo ngày thêm hoặc thứ tự tùy chỉnh, nhưng không có tùy chọn sắp xếp theo tên file. Tiện ích này thêm một panel nhỏ vào trang album, cho phép xếp toàn bộ ảnh theo thứ tự A đến Z chỉ với một cú nhấp.

> **Lưu ý:** tiện ích này **không có trên Chrome Web Store**. Mã nguồn chỉ được phát hành trong repo này, bạn cần cài thủ công bằng chế độ nhà phát triển (**Load unpacked**). Xem hướng dẫn ở mục [Cài đặt](#cài-đặt).

## Tính năng

- **Sắp xếp theo tên file, A đến Z**, không phân biệt hoa thường.
- **Sắp xếp số theo giá trị**: số trong tên được so theo giá trị, nên `IMG_2` đứng trước `IMG_10`.
- **Hỗ trợ album của bạn và album được chia sẻ** (trang `/album/...` và `/share/...`, kể cả link chia sẻ có `?key=`), với điều kiện bạn có quyền chỉnh sửa album.
- **Chỉ thay đổi thứ tự trong album.** Ảnh, tên file và thư viện của bạn không bị thay đổi.
- **Panel tiến độ** gồm 4 bước (quét album, đọc tên ảnh, sắp xếp, kiểm tra), thanh tiến độ theo thời gian thực và nút **Dừng lại**.
- **Kiểm tra sau khi sắp xếp**: tiện ích quét lại album và sửa các vị trí chưa khớp với thứ tự mong muốn.
- **Bỏ qua việc không cần thiết**: nếu album đã đúng thứ tự thì không gửi yêu cầu sắp xếp nào.
- **Ghi nhớ album đã sắp xếp**: cảnh báo nếu số ảnh hoặc thứ tự những ảnh đầu tiên đã thay đổi kể từ lần sắp xếp trước.
- **Mạng ổn định hơn**: tự thử lại với exponential backoff, có timeout, và chèn khoảng nghỉ ngẫu nhiên ngắn giữa các yêu cầu để tránh bị giới hạn tần suất.
- **Popup quản lý**: lịch sử album đã sắp xếp, nhật ký lỗi gần đây, công tắc tự động tải lại trang và nút báo lỗi (sao chép thông tin chẩn đoán vào clipboard).
- **Hỗ trợ giao diện sáng và tối.** Panel chạy trong Shadow DOM nên CSS của Google Photos không ảnh hưởng tới panel và ngược lại.

## Cài đặt

Vì không phát hành trên Chrome Web Store, bạn cài tiện ích bằng cách tải mã nguồn về và nạp thủ công:

1. Tải mã nguồn về máy.
    ```bash
    git clone https://github.com/nhlis/google-photo-sorter.git
    ```
    Hoặc bấm **Code → Download ZIP** trên GitHub rồi giải nén.
2. Mở `chrome://extensions` trong Chrome (phiên bản 109 trở lên).
3. Bật **Chế độ dành cho nhà phát triển** (Developer mode) ở góc trên bên phải.
4. Bấm **Tải tiện ích đã giải nén** (Load unpacked) và chọn thư mục dự án (thư mục chứa `manifest.json`).

Lưu ý:

- Đừng xóa hoặc di chuyển thư mục sau khi cài, vì Chrome đọc trực tiếp từ thư mục đó.
- Chrome có thể hiển thị cảnh báo về tiện ích ở chế độ nhà phát triển mỗi lần khởi động. Đây là hành vi bình thường với tiện ích nạp thủ công.
- Để cập nhật, hãy lấy mã nguồn mới (`git pull` hoặc tải lại ZIP), sau đó vào `chrome://extensions` và bấm nút tải lại (⟳) trên thẻ của tiện ích.

## Cách dùng

1. Mở [Google Photos](https://photos.google.com) và vào album bạn muốn sắp xếp.
2. Panel **Sắp xếp album** xuất hiện ở góc dưới bên phải trang. Nếu panel đang thu nhỏ, bấm nút nổi để mở ra.
3. Bấm **Sắp xếp theo tên**.
4. Chờ 4 bước hoàn tất. Bạn có thể bấm **Dừng lại** bất cứ lúc nào. Nếu dừng giữa chừng, một phần ảnh có thể đã được xếp lại, hãy chạy lại để hoàn tất.
5. Khi xong, trang sẽ tự tải lại để hiển thị thứ tự mới. Bạn có thể tắt tính năng này trong popup của tiện ích và tự bấm **Tải lại trang** khi cần.

Bấm vào biểu tượng tiện ích trên thanh công cụ để mở popup, nơi bạn xem được album đã sắp xếp, xem lỗi và thay đổi cài đặt.

## Cách hoạt động

Google Photos không có API công khai để đổi thứ tự ảnh trong album, nên tiện ích gọi cùng các endpoint `batchexecute` nội bộ mà ứng dụng web Google Photos đang dùng. Tiện ích chạy dưới dạng content script ngay trong trang, nên các yêu cầu dùng phiên đăng nhập sẵn có của bạn. Không có dữ liệu nào được gửi tới máy chủ của bên thứ ba.

| Bước        | RPC      | Mục đích                                                               |
| ----------- | -------- | ---------------------------------------------------------------------- |
| Quét album  | `snAcKc` | Duyệt từng trang của album để lấy ID toàn bộ ảnh                       |
| Đọc tên ảnh | `fDcn4b` | Lấy tên file theo lô 50 ảnh                                            |
| Sắp xếp     | `QD9nKf` | Di chuyển ảnh vào đúng vị trí theo lô 10 ảnh, lô sau nối tiếp lô trước |
| Kiểm tra    | `snAcKc` | Quét lại album và sửa các vị trí chưa khớp                             |

Các token phiên (`SNlM0e`, `FdrFJe`, `cfb2h`) được đọc từ chính trang album.

**Lưu trữ cục bộ.** Tiện ích chỉ dùng `chrome.storage.local` để lưu:

- lịch sử album đã sắp xếp (tối đa 300), kèm "dấu vân tay" ngắn từ ID của 20 ảnh đầu tiên để phát hiện thay đổi về sau,
- 50 lỗi gần nhất, phục vụ việc báo lỗi,
- cài đặt của bạn.

## Cấu trúc dự án

```
├── manifest.json     # Manifest của tiện ích (MV3)
├── content.js        # Được chèn vào photos.google.com, theo dõi việc chuyển trang (SPA)
├── popup.html        # Giao diện popup trên thanh công cụ
├── popup.js          # Logic popup: lịch sử, lỗi, cài đặt, báo lỗi
└── lib/
    ├── rq.js         # Helper XHR, phân tích phản hồi batchexecute, mô tả lỗi HTTP
    ├── numRep.js     # Đệm số 0 để so sánh số theo giá trị
    ├── Store.js      # Lớp bao chrome.storage (lịch sử, lỗi, cài đặt)
    ├── Gui.js        # Panel Shadow DOM, máy trạng thái, tiến độ và nhật ký
    ├── Album.js      # Phân tích trang album, token, quét phân trang
    └── Sorter.js     # Luồng chính: đọc tên, sắp xếp, kiểm tra, sửa, ghi lịch sử
```

## Cấu hình

Trước khi chia sẻ bản build của riêng bạn, hãy sửa đối tượng `CONFIG` ở đầu file `popup.js`:

```js
const CONFIG = {
    DEV_NAME: 'Tên của bạn',
    DEV_URL: 'https://github.com/nhlis',
    BMC_URL: 'https://buymeacoffee.com/nhlis',
    ISSUE_URL: 'https://github.com/nhlis/google-photo-sorter/issues/new',
};
```

Manifest còn tham chiếu các icon `i16.png`, `i48.png` và `i128.png` ở thư mục gốc của dự án, hãy đảm bảo các file này có trong repo.

## Hạn chế

- **Không chính thức và dễ hỏng.** Do dựa vào các endpoint nội bộ không có tài liệu, một bản cập nhật của Google Photos có thể làm tiện ích ngừng hoạt động. Nếu việc sắp xếp đột nhiên báo lỗi về "cấu trúc trang" hoặc "token phiên", vui lòng mở issue.
- **Giới hạn tần suất.** Album rất lớn sẽ mất nhiều thời gian vì các yêu cầu được giãn cách có chủ ý. Nếu Google trả về HTTP 429, hãy chờ vài phút rồi thử lại.
- **Ảnh không đọc được tên.** Những ảnh này được giữ nguyên vị trí và được báo ở cuối quá trình.
- **Phát hiện thay đổi chỉ ở mức nông.** Việc kiểm tra "album đã thay đổi" chỉ so sánh số ảnh và 20 ảnh đầu tiên, nên thao tác kéo thả thủ công ở sâu trong album sẽ không được phát hiện. Bạn luôn có thể bấm **Sắp xếp lại**.
- **Mỗi lần một album**, và chỉ khi trang album đang mở. Chuyển sang trang khác sẽ dừng quá trình sắp xếp.
- **Chỉ hỗ trợ Chrome** (các trình duyệt Chromium hỗ trợ Manifest V3 có thể cũng chạy được nhưng chưa được kiểm tra).

## Xử lý sự cố

- **"Không tìm thấy token phiên":** tải lại trang, đảm bảo bạn đã đăng nhập Google rồi thử lại.
- **Panel không xuất hiện:** panel chỉ hiện ở trang album, không hiện ở thư viện chính hoặc trang xem từng ảnh.
- **Thứ tự trông chưa đổi:** bấm **Tải lại trang** trên panel hoặc tự tải lại tab.
- **Gặp lỗi khác:** mở popup của tiện ích, vào tab **Lỗi** rồi bấm **Báo lỗi**. Nút này sao chép thông tin chẩn đoán vào clipboard và mở trang tạo issue trên GitHub để bạn dán vào.

## Tuyên bố miễn trừ

Dự án này không liên kết với, không được bảo trợ hay chứng thực bởi Google. Google Photos là nhãn hiệu của Google LLC. Bạn tự chịu rủi ro khi sử dụng, và nên sao lưu những album mà thứ tự ảnh quan trọng với bạn.

## Đóng góp

Issue và pull request luôn được chào đón. Với những thay đổi lớn, vui lòng mở issue trước để trao đổi.
