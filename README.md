# Lá Play — bản thử trên máy cá nhân

Website nghe âm thanh với giao diện tiếng Việt. Chỉ dùng `<audio>`; không có video iframe. Có ảnh bìa YouTube trong kết quả, hàng đợi, bài đã lưu và thanh đang phát; ảnh được tải khi cần, có giao diện dự phòng nếu ảnh lỗi. MP3 được mã hóa ở 128 kbps. Mã giao diện được viết mới, không sao chép GreenTube.

**Chạy lại trên máy này:** mở `start.cmd`, rồi vào http://127.0.0.1:4217. Cửa sổ chạy ứng dụng phải còn mở. Dừng bằng Ctrl+C. Node.js 22+ và Python 3.12+ là các điều kiện chạy. Công cụ âm thanh đã được cài riêng trong `.runtime` của bản thử; không cài toàn hệ thống.

Phiên được bàn giao hiện tại chạy ẩn trên máy này; dùng `stop.cmd` để dừng đúng phiên đó. Sau khi dừng, có thể mở lại bằng `start.cmd` theo cách ở trên. Xem `VERIFICATION.md` để biết các chức năng đã thử thực tế.

**Thử trên điện thoại qua LAN:** phiên hiện tại mở tại http://192.168.1.31:4217/. Điện thoại cần cùng Wi-Fi với máy tính; giữ máy tính bật và không ngủ. Đây là địa chỉ IP tại thời điểm bàn giao, có thể đổi sau khi đổi mạng/khởi động router. Chạy `start-lan.cmd` để phát hiện lại địa chỉ mạng và mở phiên LAN, hoặc `stop.cmd` để dừng. Script chỉ dừng tiến trình được ghi nhận là đúng bản Lá Play này, rồi chạy nền bản mới. `start.cmd` vẫn mặc định chỉ chạy trên chính máy tính.

Chế độ LAN chỉ cho phép localhost và thiết bị trong subnet của card Wi-Fi/LAN được chọn; không đưa dịch vụ ra Internet. Windows hiện đã có quy tắc cho phép Node.js trên mạng đang dùng, nên không thay đổi tường lửa. Thư viện/đã lưu/lịch sử nằm trên từng trình duyệt và từng địa chỉ truy cập, nên dữ liệu trên điện thoại sẽ độc lập với localhost máy tính.

Nếu chuyển sang máy Windows khác: cài Node/Python chính thức, chạy `scripts/setup.ps1` để thiết lập công cụ âm thanh, rồi chạy `start.cmd`. Không tắt chính sách bảo mật hệ thống nếu script bị hệ điều hành chặn; có thể chạy các lệnh cài đặt tương đương trong terminal do bạn mở. Các file MP3 mẫu được đóng gói sẵn.

**Có trong bản thử**

- Tìm từ khóa hoặc dán link YouTube; tối đa 10 kết quả, có thumbnail. Phát media vẫn chỉ tải luồng âm thanh, không tải luồng video.
- Chuẩn bị MP3 từ định dạng `bestaudio[vcodec=none]`; không dự phòng sang định dạng có hình.
- Phát/dừng, tua, âm lượng, tốc độ, lặp một bài, hàng đợi, lưu bài, lịch sử và nhớ vị trí trên trình duyệt.
- Nút Tiếp theo ưu tiên bài tự thêm vào hàng đợi, rồi bài tiếp trong danh sách đã chọn lúc bắt đầu nghe, rồi bài gợi ý liên quan. Danh sách đang nghe không bị thay đổi khi bạn tìm kiếm từ khóa khác. Hết bài cũng dùng cùng thứ tự; nút bài trước đi qua các bài đã phát trong phiên.
- Có khung Tiếp theo và mục Gợi ý nghe tiếp. Gợi ý lấy từ tìm kiếm theo tên bài/kênh, không dùng thuật toán cá nhân hóa hoặc lịch sử tài khoản YouTube. Có thể tắt tự động phát gợi ý để dừng khi hết danh sách; nút Tiếp theo thủ công vẫn có thể chọn gợi ý.
- Điều khiển Media Session, hỗ trợ điều khiển từ màn hình khóa trên trình duyệt/hệ điều hành có hỗ trợ.
- Hẹn giờ, giao diện điện thoại, service worker lưu vỏ ứng dụng. Không cache media trong service worker.
- Ba hòa âm 32 giây được tổng hợp riêng cho bản thử, dùng để kiểm chứng phát MP3 ngay cả khi YouTube không truy cập được.

**Luồng âm thanh và giới hạn**

Backend dùng một lần chạy yt-dlp để lấy nguồn và tải đúng luồng chỉ âm thanh; FFmpeg chuyển sang MP3 đồng thời. Bản mới bắt đầu phát khi có các byte MP3 đầu tiên, không chờ chuyển xong toàn bài. Sau khi bản đầy đủ được lưu, thanh tua được bật; thao tác tua đầu tiên sẽ chuyển sang bản đầy đủ có hỗ trợ Range. Nếu cần nghe tiếp đúng vị trí cũ mà cache đã hết hạn, ứng dụng có thể phải đợi chuẩn bị xong để mở vị trí đó. MP3 đã có trong cache phát lại ngay, không phải lấy metadata YouTube lại.

Cache trên máy có thời hạn khoảng 1 giờ, được kiểm tra khi khởi động/sau tác vụ/định kỳ; giới hạn mục tiêu 256 MiB, không phải xóa chính xác ngay tại mốc 60 phút. Tối đa 2 tác vụ xử lý đồng thời, tối đa 5 tác vụ chờ/đang chạy, nội dung tối đa 3 giờ, tác vụ âm thanh tối đa 3 phút và có giới hạn kích thước. Tệp đang nghe vẫn có thể bị cleanup theo thời hạn; bấm Phát lại để tạo lại nếu nguồn không còn. Tốc độ bắt đầu phụ thuộc nguồn YouTube, không cam kết mọi bài cùng một độ trễ.

Đây **không phải tích hợp phát nhạc chính thức của YouTube**. API/player chính thức không cấp endpoint MP3 để dùng theo cách này và chính sách YouTube API hạn chế tách audio/phát nền. Chỉ dùng với nội dung và phương thức truy cập bạn có quyền sử dụng, tuân thủ điều khoản nền tảng. Công cụ không nhập cookie tài khoản, không đăng nhập và không vượt CAPTCHA/nội dung bị hạn chế. Khi nguồn từ chối hoặc thay đổi, ứng dụng báo lỗi; không tự chuyển sang proxy công khai hay tài khoản khác.

Xem chính sách: https://developers.google.com/youtube/terms/developer-policies-guide và https://www.youtube.com/static?template=terms.

Nghe nền phụ thuộc trình duyệt/OS. Chưa thể bảo đảm chỉ từ kiểm thử desktop rằng iOS/Android sẽ tiếp tục phát khi khóa màn hình. Hẹn giờ bằng JavaScript có thể trễ nếu hệ điều hành đóng băng trang. Trên điện thoại, dùng địa chỉ LAN ở trên thay cho `127.0.0.1`. HTTP LAN dùng để thử nhanh; service worker/PWA và các tính năng yêu cầu secure context sẽ cần HTTPS để hoạt động đầy đủ. Bản thử không yêu cầu cài chứng chỉ hoặc thay đổi bảo mật trình duyệt.

**Cấu trúc**

`server.mjs`: HTTP server Node, hợp đồng API, gợi ý và pipeline MP3. `stream-growing.mjs`: gửi MP3 đang được tạo cho lượt nghe đầu. `dist/`: frontend; `dist/playback-order.js` giữ thứ tự danh sách/hàng đợi/lịch sử phiên. `scripts/setup.ps1`: cài công cụ riêng cho project. `.runtime/`: môi trường máy hiện tại, không phát hành cùng mã. `.cache/`: cache âm thanh, không phát hành. `tests/`: kiểm chứng API/range/phát sớm và thứ tự chuyển bài. Chạy `npm test` để kiểm tra sau khi có các MP3 mẫu.

Thư viện: yt-dlp 2026.10.26 và yt-dlp-ejs, imageio-ffmpeg 0.6.0 cùng các phụ thuộc của chúng. Giữ giấy phép riêng của các dự án khi phân phối runtime; bản mã nguồn gọn không kèm runtime/binary/cached media. Các bài mẫu do bản thử tự tạo; bản thân ứng dụng không chèn quảng cáo. Không có cam kết mọi nguồn YouTube đều phát được hoặc loại bỏ được nội dung tài trợ có sẵn trong bản thu.
