# Kiểm tra bản sửa Vercel — 27/10/2026

- Nguồn kiểm tra: bản riêng từ GitHub commit `0cdb080432f1bcc5882d3c3412fda68f47b7a740` và bản vá khởi động.
- Vercel Runtime Logs đã xác nhận nguyên nhân 500 là thiếu default export hợp lệ trong `server.mjs`; build gốc đã thành công.
- `npm test`: 22/22 đạt tại máy (16 kiểm tra hiện có và 6 kiểm tra Vercel mới).
- Kiểm tra mới bao gồm import với quyền ghi file bị cấm, tài nguyên giao diện, HTTPS cùng nguồn, MP3 mẫu Range 206, phản hồi 503 cho nguồn trực tuyến chưa cấu hình và giữ giới hạn localhost/LAN.
- Chưa kiểm tra bundle/Preview Deployment trên Vercel. Cần kiểm tra bản triển khai thực tế trước khi đưa bản sửa lên production. Xem `VERCEL.md` trước khi áp dụng.

---

# Kết quả kiểm tra ngày 27/10/2026

- Trang chạy trên `http://127.0.0.1:4217` trả HTTP 200.
- Tìm `Big Buck Bunny Blender` trả 10 kết quả YouTube thật, khoảng 2,37 giây trong một phép đo.
- Video mẫu `aqz-KE-bpKQ` đã chuyển thành MP3 trong một lần kiểm tra thành công. File khoảng 10,16 MB, thời lượng 10:34,67; FFmpeg xác nhận chỉ có một luồng Audio MP3 stereo, 44.100 Hz, 128 kbps, không có video.
- Trình duyệt đã phát MP3 này, thời gian tăng qua 1:23. Chuyển sang mục Đã lưu không ngắt âm thanh. Lưu bài đã cập nhật thư viện.
- Ba bài mẫu tự tạo phát được; hàng đợi đã tự chuyển từ bài đầu sang bài thứ hai.
- GET/HEAD hỗ trợ HTTP Range; yêu cầu 1.024 byte đầu của MP3 YouTube trả `206`, `Content-Type: audio/mpeg`, `Content-Range: bytes 0-1023/10155290`.
- Bộ kiểm tra 3/3 qua: Range/suffix/giá trị sai; chuẩn bị/phục vụ MP3/HEAD/206/416; từ chối mã nội dung sai, URL bên ngoài, POST khác origin và truy cập runtime.
- Kiểm tra cú pháp server, JavaScript giao diện và service worker qua. Console trình duyệt không ghi lỗi/cảnh báo trong phiên phát đã kiểm tra.

Chưa kiểm tra khóa màn hình Android/iOS, cài PWA trên điện thoại hoặc hẹn giờ khi hệ điều hành đóng băng trang. Kết quả một video không bảo đảm mọi video YouTube đều phát được. Không sử dụng cookie, đăng nhập, proxy hay vượt hạn chế trong phép thử.

Ở phiên bản đầu, bản thử chạy loopback trên Windows; điện thoại không truy cập được địa chỉ localhost đó. Không triển khai hoặc sửa máy chủ GreenTube.

**Cập nhật ảnh bìa và LAN, 27/10/2026**

- Đã mở phiên LAN tại `http://192.168.1.31:4217/`, chỉ chấp nhận localhost và subnet Wi-Fi hiện tại `192.168.1.0/24`.
- Trang LAN và health trả 200; MP3 mẫu qua LAN trả 206 với đúng byte range.
- Ảnh bìa YouTube mẫu trả 200 JPEG, 32.195 byte. Trình duyệt qua địa chỉ LAN đã tải thành công 10 ảnh bìa tìm kiếm và kiểm tra trực quan bố cục hẹp.
- Phiên trình duyệt trên địa chỉ LAN đã chuẩn bị và phát MP3 YouTube, tiến độ qua 0:16; ảnh bìa hiện trong thanh đang phát, console không có lỗi/cảnh báo trong phiên kiểm tra.
- Bộ kiểm tra hiện tại 4/4 qua; thêm kiểm tra cho phép subnet được chọn và từ chối các mạng khác. Node/JavaScript và script bật LAN qua kiểm tra cú pháp.
- Dùng quy tắc Node.js đã có sẵn trong Windows Firewall, không tạo hoặc sửa quy tắc.
- Chưa kiểm chứng truy cập từ chính điện thoại hoặc khóa màn hình trên thiết bị thật. Không đưa dịch vụ ra Internet và không sửa máy chủ GreenTube.

**Cập nhật giảm thời gian chờ phát MP3**

- Pipeline mới dùng một lần lấy/tải nguồn trong yt-dlp, chuyển sang MP3 đồng thời và phục vụ tệp đang được tạo. Không bắt lượt nghe đầu chờ toàn bộ bài xong.
- Với video mẫu `YE7VzlLtp-4` chưa có cache: byte MP3 đầu đến khoảng 8.401 ms; toàn bài hoàn tất khoảng 17.179 ms. Phát lại: API chuẩn bị trả bản cache trong khoảng 3 ms. Đây là một phép đo trên mạng hiện tại, không phải cam kết độ trễ cho mọi video.
- 6/6 kiểm tra qua, gồm phát dữ liệu trước khi encode xong, đọc liên tục qua thời điểm đổi tên tệp và không mất byte; phát lại cache không gọi lấy metadata lại; các kiểm tra Range/đầu vào/LAN cũ vẫn qua.
- Khi phần còn lại được chuẩn bị xong, giao diện bật tua. Tua lần đầu từ nguồn đang truyền sẽ chuyển sang tệp MP3 đầy đủ có Range. Nghe tiếp vị trí cũ có thể cần chờ cache đầy đủ nếu cache đã hết hạn.
- Giới hạn thời lượng tăng từ 90 phút lên 3 giờ để hỗ trợ các bản mix dài; MP3 vẫn 128 kbps, không tải luồng video.

**Cập nhật chuyển bài theo danh sách và gợi ý**

- 16/16 kiểm tra qua. Có kiểm tra thứ tự từ kết quả đã chọn, danh sách không đổi khi tìm mới, ưu tiên hàng đợi rồi quay lại danh sách, loại bài trùng/đã phát, gợi ý sau danh sách, quay lại/đi tiếp và xem trước không làm đổi vị trí.
- Trên giao diện có hàng đợi 0 bài: phát bài mẫu đầu, bấm Tiếp theo sang bài mẫu thứ hai; tua gần cuối để hết bài, ứng dụng tự chuyển sang bài thứ ba.
- API gợi ý thử với Big Buck Bunny/Blender trả 12 bài, khoảng 2,21 giây; đã kiểm tra loại ID bài hiện tại và các ID đã truyền trong danh sách loại trừ.
- Gợi ý dựa trên tên bài và kênh, chưa phải gợi ý cá nhân hóa từ tài khoản YouTube. Yêu cầu gợi ý chạy sau khi audio bắt đầu phát để không chặn bước mở MP3.
- Trên giao diện: đã thấy 6 thẻ gợi ý liên quan, khung Tiếp theo hiển thị thứ tự đang nghe; công tắc tự động phát đổi được giữa `false` và `true`. Console không có lỗi trong lượt kiểm tra.
