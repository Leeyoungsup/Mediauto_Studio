# 44. Workspace 로그인·계정 관리와 역할별 탐색

[43번 비교](pdf-frontend-review-43.md)의 공통 프런트 개선 범위다. PDF 14쪽의 업무함 탐색 배치와 30쪽의 케이스 감사 화면을 참고했다. 가입 승인과 관리 메뉴의 구조는 MeDIAuto Studio의 기존 기관 계정·권한과 승인 API에 맞춰 구성했다. 보라색 테마와 영어 표시를 사용한다.

| 사용자·경로 | 화면과 조작 |
|---|---|
| 신규 사용자 | **Sign In → Request an Account → Submit Registration Request**. 제출 결과는 **Pending Approval**과 확인 코드를 표시한다. **Copy Code**로 복사하고 기관 관리자에게 전달한다. 브라우저 클립보드가 제한된 환경에서는 코드를 선택해 직접 복사한다. **Back to Sign In**에서 가입에 사용한 사용자 이름을 미리 채운다. |
| 관리자 · `#settings/accounts` | 사이드바 **Accounts** 또는 Settings → **Accounts**. **Directory and Access**에서 사용자 이름을 검색하고, 변경 권한이 있는 계정의 역할과 활성 상태를 편집한다. **View Log**는 해당 계정으로 필터링한 감사 페이지를 연다. |
| 관리자 · `#settings/accounts/requests` | 사이드바 **Approvals** 또는 Accounts → **Registration Requests**. 요청을 선택하고 신청자 확인 코드와 역할을 확인해 승인하거나 반려한다. 처리된 요청은 **Reviewed**에서 확인한다. |
| 관리자 · `#settings/accounts/audit` | 사이드바 **Account Audit** 또는 Accounts → **Audit Log**. 계정 생성 승인·반려, 역할·상태 변경, 업무 그룹 변경과 시행자·전후 값을 조회한다. 직접 주소에서 열거나 새로고침하면 전체 로그를 보여준다. Directory에서 지정한 사용자 필터는 해당 화면 이동에 사용한다. |
| 모든 로그인 역할 · `#settings/notifications` | 사이드바 **Preferences**에서 개인 알림 설정을 연다. 기존 Worklist·Intake·OR·Collections 역할별 진입 조건을 사용한다. 계정·개인 설정에 직접 진입해도 상단 EMR/LIS 상태를 불러온다. 관리자 주소로 직접 진입할 경우 현재 역할에 따라 접근 거부를 표시한다. |
| 케이스 열람 역할 | Viewer의 **Case Logs**에서 케이스 열람·변경 이력을 확인한다. 관리자 계정 감사와 각각의 경로를 사용한다. |

승인 전 확인 코드는 신청 화면에서만 표시한다. 로그인 응답은 기존 인증 API의 공통 오류를 사용한다. 역할이나 활성 여부를 바꾸면 기존 API가 해당 계정의 활성 세션을 무효화한다. UI의 역할 표시는 로그인으로 받은 계정 정보에 기반한다.

## 검증과 재현

- 격리 PostgreSQL 18.6과 Chromium 146, Node 22.12.0, 합성 계정을 사용한다. [Playwright 준비 방법](integration-demo-10.md)
- `MEDIAUTO_DEMO_PORT=19977 scripts/verify-integration.sh`에서 Vite 빌드, Alembic 검사, 백엔드 59개와 Chromium 시나리오 28개가 통과했다. 승인 전 로그인 거부, 승인 후 로그인, 계정 상태 변경 후 세션 종료, 감사 전후 값, 관리자 주소 새로고침·뒤로 가기, 개인 설정, 로그아웃을 `scripts/registration-browser.mjs`에서 확인한다.
- 수동 확인은 `MEDIAUTO_DEMO_PORT=19976 scripts/verify-integration.sh --manual`에서 시작한다. 두 브라우저 세션에서 합성 가입자와 기관 관리자로 위 표의 순서를 진행한다. 관리자와 일반 계정으로 동일한 Accounts 주소 세 개에 접근해 각각 화면과 권한 거부를 확인하고, 390px에서도 메뉴·폼과 페이지 폭을 점검한다.
- 집중 검증의 첫 실행에서는 배정 없는 시드 때문에 알림 멘션 옵션이 나타나지 않았다. 통합 시연의 케이스 배정을 포함해 재실행했고 가입·계정·Workspace·알림 시나리오를 모두 통과했다.
- LAN 9920에서 최신 빌드와 `/api/health` 200을 확인했다. 합성 [로그인](../.runtime/workspace-44/sign-in-390.png) · [가입 승인](../.runtime/workspace-44/account-approvals.png) · [계정 감사](../.runtime/workspace-44/account-audit.png) 화면을 기록했다.
- 기존 접근 정책과 API·DB 스키마를 사용한다. 임상·기관 사용성 검토는 대기 중이며 44번 완료 체크는 사용자 확인을 따른다.
