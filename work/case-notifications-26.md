# 26. Case Notes와 알림

## 범위와 근거

- **화면 관찰**. PDF 32쪽에는 사건별 In-app, Email, Push 체크박스가 나타난다. Notes, Comments, 멘션은 기능 목록과 화면·전사 근거에 포함되어 있다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- **발표 설명**. 케이스 배정, 자문 요청과 댓글 멘션에 대해 알림 채널을 선택하는 흐름을 설명했다.
- **참석자 의견**. 외부 발신 계약과 허용 수신처, 임상 메시지 보존 기간은 시연 근거에서 확정되지 않았다.
- **IMS 구현 결정**. 등록된 임상 케이스에 Notes 및 한 단계의 Comments를 추가한다. 관리자, 해당 케이스 병리의 및 등록 담당자가 권한 범위 내에서 작성할 수 있다. 멘션은 접근 권한이 있는 활성 계정으로 제한한다. 댓글이 원래 메모 작성자를 직접 멘션하면 해당 수신자에는 멘션 설정을 적용한다. 본인의 작성으로 본인에게 알림을 생성하는 경우는 제외한다.

## 사용 방법

1. **Case Details → Notes** 또는 **WSI Viewer → Notes**에서 메모를 작성한다. **Add Comment**로 답글을 작성한다. **Mention a User**에서 계정을 선택하거나 `@username`을 입력한다.
2. 상단 **Notifications → Notification Preferences**에서 **Case Assignment**, **Request Updates**, **Mentions**, **Case Comments**별로 채널을 선택하고 저장한다. 기본은 인앱 채널 사용 및 외부 채널 미사용이다.
3. **Notifications**의 인앱 목록에서 알림을 읽는다. **Delivery Status**에서 이메일·Push의 대기, 전송 중, 재시도 예정, 발송 수락, 실패, 차단 및 시도 횟수를 확인한다. 권한이 유효한 대상은 목록의 버튼으로 열 수 있다. 실패·차단 건은 **Retry Delivery**로 다시 대기열에 넣을 수 있다.

## 전송 계약 및 구성

- Notes와 알림 발행은 같은 DB 트랜잭션이다. 케이스 배정 버전, 요청 버전, 메모·댓글 UUID를 사건 키로 사용하며 같은 수신자·채널의 중복을 막는다. 기존 요청 알림 데이터와 읽음 상태는 기존 API를 통해 함께 표시한다. 새 요청 인앱 전송에는 개인 설정을 적용한다.
- 이메일과 Push 큐는 DB에 저장된다. 실행 중 임대와 제한된 재시도를 사용하고, 처리 직전에 현재 채널 설정과 대상 접근을 확인한다. 전송 수락은 공급자 응답 기준이다. 공급자가 수락한 직후 서버가 중단되는 경우 중복 전달 가능성이 있어 SMTP Message-ID와 Push Topic은 같은 전송에서 재사용한다.
- 외부 전송 본문에는 케이스 ID, 환자 정보, 메모나 댓글을 포함하지 않는다. 로그인 후 화면에서 알림 대상을 열 수 있다. 애플리케이션 상태 응답에는 공급자 비밀과 주소 전문을 노출하지 않는다.
- 9920 개발 서버의 운영 설정은 권한 0600인 `.runtime/notifications.json`에 아래 이름을 JSON 문자열 키와 값으로 지정한다. 다른 경로의 파일은 `MEDIAUTO_NOTIFICATION_CONFIG_FILE`로 지정할 수 있으며 서비스 환경 변수 값이 우선한다.
- 이메일 발송을 사용할 때 운영자가 TLS 지원 SMTP의 `MEDIAUTO_SMTP_HOST`, `MEDIAUTO_SMTP_FROM`, 필요 시 `MEDIAUTO_SMTP_PORT`, `MEDIAUTO_SMTP_TLS`(`starttls` 또는 `ssl`), `MEDIAUTO_SMTP_USERNAME`/ `MEDIAUTO_SMTP_PASSWORD`를 앱 서비스 환경에 설정한다. 검증한 계정 이메일은 개발/기관 DB에 연결된 `cd backend && python -s -m app.manage_users --organization <org> --username <username> --edit-notification-email`의 입력란에서 기록한다.
- 브라우저 Push는 앱 서비스 환경의 `MEDIAUTO_VAPID_PRIVATE_KEY`(권한 0600인 P-256 PEM 경로), `MEDIAUTO_VAPID_SUBJECT`(`mailto:` 운영 연락처)로 구성한다. HTTPS 또는 localhost에서 **Connect Browser Push**를 눌러 브라우저 권한을 부여한다. 현재 계정별 단일 브라우저 구독과 Chrome(Firebase)·Firefox(Mozilla) 엔드포인트를 지원한다. [W3C Push API](https://www.w3.org/TR/push-api/) · [pywebpush 2.5.0](https://pypi.org/project/pywebpush/2.5.0/)

## 마이그레이션과 검증

- `0015_case_notifications`는 메모, 전송, 환경설정 테이블과 계정 이메일 필드를 추가한다. 되돌릴 때 DB를 백업하고 발신 작업을 정지한 뒤 이전 코드에서 `python -s -m alembic downgrade 0014_case_logs`를 실행한다. 새 메모·알림·계정 이메일 데이터가 제거되며, 기존 요청 인앱 알림과 Case Logs 행은 보존된다.
- 테스트는 격리 PostgreSQL 18.6 및 Chrome 146에서 합성 계정과 사례를 사용했다. SMTP 호출과 Web Push HTTP 요청을 테스트 대역으로 대체했다. Web Push 암호화와 VAPID 헤더 생성은 실제 라이브러리 경로를 실행했다.
- 실제 기관 SMTP·브라우저 Push 수신 및 임상 사용자 검토는 대기 중이다.
- 격리 DB에서 `0014 → 0015 → 0014 → 0015`와 Alembic 스키마 일치를 확인했다. 9920에서는 `.runtime/before-notifications-0015-20261124T182140.dump` 백업 후 적용하고 기존 요청 알림·감사·케이스 건수를 비교했다. 실제 서버의 설정 화면과 Push 서비스 워커 자산 응답을 확인했다.
- `MEDIAUTO_DEMO_PORT=19926 scripts/verify-integration.sh` **PASS**. Node 22.12.0, Playwright와 Tesseract를 사용해 빌드, 자동 테스트 30개와 Chrome 시나리오 13개를 통과했다. 중복 배정·요청·멘션, 새 세션 설정 복원, 권한 차단, 임시·영구 실패 및 같은 전송 ID 재시도를 확인했다. 9920에서 이메일·Push 공급자 설정은 미설정 상태이며, 명령표 사용자 확인은 대기 중이다.
