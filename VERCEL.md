# Khắc phục lỗi khởi động trên Vercel

## Nguyên nhân đã xác nhận

Runtime Logs của bản `dpl_EDyWPpPhsFmV6cK4VZuwpmEZz8iF`, commit `0cdb080`, ghi:

```text
Invalid export found in module "/var/task/server.mjs".
The default export must be a function or server.
```

Build đã hoàn tất và chọn `server.mjs` làm entrypoint. Các cảnh báo `engines.node` và `cache-dir` không làm build thất bại. Mã cũ chỉ xuất các hàm tiện ích; phần mở cổng chỉ chạy khi thực thi trực tiếp bằng `node server.mjs`, không chạy khi Vercel import module.

## Bản sửa này làm gì

- Xuất một HTTP server mặc định để Vercel nhận yêu cầu. Import module không tạo cache, không mở cổng, không tạo tiến trình âm thanh hay bộ hẹn giờ.
- Cho phép tên miền `*.vercel.app` và Origin HTTPS cùng tên miền trong chế độ Vercel. Bản chạy trên máy/LAN giữ cơ chế giới hạn truy cập cũ. Với tên miền riêng, thêm biến `LA_PUBLIC_HOSTS`, ví dụ `music.example.com,www.music.example.com` (chỉ tên miền, phân cách bằng dấu phẩy).
- Đóng gói `dist/**` vào Function để HTML, JavaScript, CSS và MP3 mẫu được phục vụ. Loại `.runtime`, `.cache` và test khỏi bundle.
- Giao diện, thư viện và ba bài mẫu dùng được trên Vercel. `/api/health` trả `deployment: "vercel"`, `toolsReady: false` và `localOnly: false`.
- Tìm kiếm, gợi ý và chuẩn bị MP3 YouTube trả JSON 503 `AUDIO_BACKEND_REQUIRED` ngay khi cần nguồn trực tuyến. Giao diện thông báo chưa kết nối nguồn. Không chạy hàng đợi cục bộ trên các Function riêng biệt.
- Cache dùng đường dẫn tạm trong chế độ Vercel; bản sửa không coi nó là bộ nhớ dùng chung. Bản máy/LAN có thể phát lại MP3 đã cache mà không cần khởi động công cụ chuyển đổi.

## Giới hạn cần hiểu trước khi triển khai

Đây là bản sửa lỗi 500 và khả năng phục vụ ứng dụng, **chưa phải bản đưa toàn bộ pipeline YouTube/MP3 lên Vercel**. Ba bài mẫu là các tệp đã có trong dự án, không đại diện cho việc tìm kiếm/phát YouTube đã hoạt động trên Internet.

Pipeline hiện dùng Python + yt-dlp + FFmpeg, `Map` giữ trạng thái tác vụ, tệp MP3 đang ghi và công việc tiếp tục sau khi HTTP trả lời. Để chạy đầy đủ cần một backend chạy liên tục, hoặc thiết kế lại dùng hàng đợi/bộ lưu trạng thái và tệp dùng chung. Chỉ thêm FFmpeg, đổi cache sang `/tmp`, thêm `waitUntil`, hoặc đóng Docker image chưa giải quyết sự phụ thuộc vào cùng một tiến trình qua nhiều yêu cầu.

## Triển khai bản sửa khởi động

1. Giữ Framework Preset **Node.js** và thư mục gốc repository. `vercel.json` đã khai báo entrypoint assets; không đổi Output Directory thành `dist` vì frontend vẫn gọi `/api/*`.
2. Đưa các thay đổi lên một nhánh để kiểm tra bằng Preview Deployment trước. Không chép `.runtime`, `.cache`, thông tin tài khoản hoặc cookie vào Git.
3. Trên bản Preview: mở trang, kiểm tra `/api/health`, phát một bài mẫu và tua. Tìm kiếm sẽ báo chưa kết nối nguồn trực tuyến, không bị treo chờ MP3.
4. Chỉ đưa bản đã kiểm tra lên production sau khi chấp nhận phạm vi trên; bản này không thay thế backend âm thanh đầy đủ.

## Kiểm chứng

Đã chạy `npm test`: **22/22 test đạt** trên Node.js 24.18.0 tại máy. Test Vercel import entrypoint khi bị cấm ghi file, kiểm tra server export, tài nguyên giao diện, Origin HTTPS, MP3 Range 206, API 503 rõ ràng và giới hạn localhost/LAN. Kiểm tra tại máy không chứng minh bundle trên Vercel đã chạy; cần kiểm tra Preview sau khi build.

Đã kiểm tra Preview Deployment `laplay-4jn0yieeh-ttvb.vercel.app` của commit `6bb8291`: trang chủ, `/api/health`, `/app.js` và MP3 mẫu đều trả HTTP 200. MP3 mẫu trả `Content-Type: audio/mpeg`, kích thước 513.296 byte. Tìm kiếm trả 503 `AUDIO_BACKEND_REQUIRED` đúng phạm vi bản sửa. Chưa kiểm tra thao tác phát/tua trong trình duyệt trên bản Preview hoặc khóa màn hình điện thoại; các thao tác này cần kiểm tra trước khi đưa lên production.

Tài liệu: https://vercel.com/docs/functions/runtimes/node-js và https://vercel.com/docs/functions/runtimes.
