# Backend MP3 trực tuyến

## Cách chạy

`Dockerfile.vercel` đóng gói Node.js 24, Python, yt-dlp và FFmpeg. `vercel.json` chọn Container runtime. Ứng dụng nghe trên `0.0.0.0:$PORT`; mặc định cổng 80.

Kho Vercel Blob phải là **private** và kết nối với cùng dự án. Vercel có thể cấp `BLOB_READ_WRITE_TOKEN` tự động (mã không xuất giá trị), hoặc `BLOB_STORE_ID` cùng quyền OIDC. Bản mã không chứa thông tin xác thực. `@vercel/blob` được ghim 2.8.2; Zod gián tiếp được ghim bản vá 4.6.6.

## Luồng phát

1. `/api/search` và `/api/recommendations/:id` chạy yt-dlp để tìm metadata từ YouTube. Không trả dữ liệu mẫu thay cho kết quả thật.
2. `/api/prepare` kiểm tra MP3 đã lưu. Nếu có, trả URL phát ngay; các phiên container khác nhau dùng cùng kho.
3. Nếu chưa có, cùng yêu cầu HTTP tải đúng định dạng `bestaudio[vcodec=none]` và chuyển sang MP3 128 kbps. Máy chủ gửi các bản ghi tiến độ NDJSON trong khi làm việc; không phụ thuộc tác vụ nền tồn tại sau HTTP.
4. Tệp hoàn chỉnh được lưu trong kho riêng tư. Máy chủ ký đường GET cho đúng tệp, hết hạn sau 4 giờ; trình duyệt tải MP3 trực tiếp và có thể dùng Range để tua. Không truyền khóa đọc/ghi của kho cho trình duyệt.
5. Khi chuyển bài trong lúc chuẩn bị, trình duyệt hủy yêu cầu cũ; máy chủ dừng các tiến trình tương ứng. Các bản local/LAN vẫn dùng luồng MP3 phát sớm cũ.

Lần đầu phải chờ tệp hoàn chỉnh được tạo và tải lên kho; các lần phát lại dùng cache. Nhánh này ưu tiên dữ liệu dùng chung và khả năng tua đúng trên nhiều phiên máy chủ. Không cam kết độ trễ của mọi nguồn.

## Giới hạn

- Nội dung tối đa 3 giờ; MP3 tối đa 180 MB; xử lý/đưa lên kho tối đa khoảng 210 giây trong yêu cầu.
- Hai lượt chuyển đổi đồng thời trên mỗi phiên container. Đây không phải giới hạn toàn tài khoản khi nền tảng tự tăng số phiên.
- Cache mục tiêu 512 MiB trong tiền tố riêng `laplay/mp3/v2/`; khi cần chỗ, chỉ xóa các tệp cache của ứng dụng đã cũ hơn 6 giờ. Nếu cache gần đây đã đầy, trả `CACHE_FULL` thay vì tăng dung lượng vô hạn. Các phiên đồng thời có thể khiến giới hạn mục tiêu bị vượt tạm thời.
- Không dùng cookie, tài khoản, proxy, giải CAPTCHA hoặc vượt hạn chế truy cập. Khi YouTube từ chối, trả `SOURCE_BLOCKED`; không báo phát thành công.
- Tệp riêng tư có thể được truy cập bởi người giữ URL phát hợp lệ cho tới khi URL hết hạn. Không phải hệ thống tài khoản/thư viện riêng của từng người dùng.
- Gói Hobby và hạn mức được giữ nguyên; không tự nâng gói hoặc bật gói trả phí.

## Kiểm tra trước khi phát hành

`npm test` kiểm tra tách biệt nguồn, cache chung, hủy yêu cầu, tiến độ UTF-8, lỗi nguồn, tài nguyên giao diện và MP3 Range. `npm audit --omit=dev` kiểm tra phụ thuộc.

Kiểm tra Preview cần đủ: `/api/health` có `searchReady: true`, `toolsReady: true`; tìm kiếm thật; chuẩn bị một nguồn được phép; tệp chỉ có âm thanh MP3; GET/Range trên URL phát riêng tư; phát, tua, chuyển bài trong trình duyệt. Chỉ build thành công không xác nhận những bước này.

Tại máy, tìm `tiktok` qua API thật đã trả 10 kết quả. Một phép thử nguồn Big Buck Bunny bị YouTube yêu cầu xác nhận không phải bot; phép thử đó **không được tính là phát thành công**. Cần kiểm chứng nguồn trên Preview trước khi phát hành.
