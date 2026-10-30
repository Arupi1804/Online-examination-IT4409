# REST API contract

Auth contract/session đã được mô tả trong [auth-contract.md](auth-contract.md), OpenAPI và schema Zod tại `packages/shared/src/auth.ts`. TV1 duy trì Auth; TV2 tiếp tục endpoint nghiệp vụ. Các API Auth đã triển khai: `/auth/csrf`, `/auth/register`, `/auth/login`, `/auth/me`, `/auth/logout`.

Base URL: `/api/v1`. Định nghĩa máy đọc được tại `openapi.yaml`; hiện có health và Auth. Quy ước chung trong `CONTRACT.md`. TV2 hoàn thiện request/response của API nghiệp vụ, TV1 duyệt trước khi tích hợp.

Contract chi tiết sẽ được chốt trước khi frontend tích hợp. Các nhóm endpoint dự kiến: `/auth`, `/questions`, `/exams`, `/attempts`, `/results`.

Mỗi endpoint phải nêu rõ role được phép gọi, request/response schema và mã lỗi.
