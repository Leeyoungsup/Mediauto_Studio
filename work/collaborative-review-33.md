# 33. 동일 케이스 공동 판독과 Teams 범위

## 참조와 개발 기준

- 참조 PDF 33쪽 화면(P13 04:10)은 참여자·발표자 상태와 Follow 초대를 보여준다. 발표(T 1:03:23–1:04:48)는 진행권 교대와 Teams 통화를 설명한다. 실제 테넌트 연결, 전송 정책과 세션 승인에 관한 참석자 합의는 확인되지 않았다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- 베이스 `d3741bc` 확인 후 기존 IMS 케이스 인증, WSI 레벨 0 카메라·타일, Case Logs를 재사용했다. 한 케이스에 하나의 활성 세션과 한 명의 Driver를 유지한다. 개발 RBAC에서는 기관 관리자와 배정 병리의가 해당 케이스 열람 권한을 가진다.

## 사용자 흐름

1. **WSI Viewer → Collaborative Review → Start Review Session**을 누른다. 소유자가 **Invite Participant**에서 케이스 열람 권한이 있는 같은 기관의 활성 계정을 지정한다.
2. 초대된 계정은 같은 케이스의 WSI에서 패널을 열어 **Join Review Session**을 누른다. **Follow Driver**는 Driver의 스캔·중심·배율을 적용한다. **Stop Following** 후에는 현재 화면에서 독립적으로 판독을 계속한다.
3. Driver는 온라인 참가자를 **Next Driver**에서 고르고 **Hand Off Drive**를 누른다. 이전 권한의 입력은 서버가 차단한다. Follow 중이던 참석자가 Driver가 되면 보고 있던 화면에서 계속 진행한다. 독립 보기 중인 참가자는 자신의 현재 화면에서 진행한다.
4. 네트워크 단절에는 **Reconnecting…**을 표시한다. 연결이 돌아오면 최신 프레임을 받아 적용한다. 같은 탭 새로고침은 참여·Follow를 복원하고, 다른 탭은 명시적으로 참여한 뒤 현재 연결을 인계한다. 진행자가 12초 동안 응답하지 않으면 소유자가 **Take Drive**를 사용할 수 있다.
5. 소유자가 참가자를 회수하거나 **End Session**을 누르면 기존 세션 접근이 해제된다. 배정 변경으로 원본 케이스 열람 권한이 사라지면 공동 판독 화면의 WSI도 닫힌다. 기존 케이스 권한을 가진 참가자의 회수 후 독립 뷰는 계속 이용할 수 있다.

## 동기화·권한·보존

- 375ms 주기의 동일 출처 상태 폴링과 최대 150ms 간격의 단일 카메라 게시를 사용한다. 서버는 진행권 세대 번호와 프레임 순서로 지연·중복·경합 입력을 구분한다. 연결·초대는 기존 IMS 인증과 케이스 권한을 모두 검사한다.
- 프레임은 등록된 같은 케이스의 스캔과 원본 픽셀 중심, 배율로 구성된다. 화면 크기나 배율 한계가 다르면 기존 WSI 경계에 맞춰 적용한다. 판독 주석, 마우스 포인터와 Multi View의 동시 공유는 별도 작업 범위다.
- 활성 세션에는 최신 카메라 한 건만 보관하고 종료 시 비운다. 초대·참여·인계·회수와 종료는 Case Logs에 남는다. 저장된 감사 이벤트에는 카메라 좌표나 이미지가 들어가지 않는다.
- `0021_review_room`은 `review_rooms`와 `review_participants`를 추가한다. 기존 스키마와 데이터는 유지한다. 신규 세션 기록이 생긴 DB에서는 다운그레이드를 차단한다. 복구 시 현재 상태를 백업한 뒤 이전 코드와 배포 전 백업을 격리 환경에서 복원 검증한다.

## Teams 공식 문서 검토

| 범위 | 공식 지원과 기관 검증 조건 |
| --- | --- |
| 기존 회의 링크 열기 | Teams 회의 참가 딥 링크를 별도 브라우저 또는 Teams 클라이언트에서 열 수 있다. 참여 허용과 로비는 기관 및 회의 주최자의 정책에 따르며 IMS 케이스·세션 권한은 기존 방식으로 별도 검사한다. 첫 연동 후보는 기관이 제공한 회의 링크만 열고 환자 정보·WSI·좌표나 케이스 ID를 URL 또는 회의 제목에 넣지 않는 방식이다. [Teams 딥 링크](https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/deep-link-workflow) · [Teams 참가 정책](https://learn.microsoft.com/en-us/microsoftteams/anonymous-users-in-meetings) |
| Microsoft Graph에서 회의 만들기 | 업무·학교 계정의 위임 권한은 `OnlineMeetings.ReadWrite`다. 앱 권한 `OnlineMeetings.ReadWrite.All`은 관리자가 만든 애플리케이션 액세스 정책을 주최 사용자에게 할당해야 한다. `onlineMeeting` 생성은 단독 회의이며 일정 통합은 별도 범위다. [Graph v1.0 회의 생성](https://learn.microsoft.com/en-us/graph/api/application-post-onlinemeetings?view=graph-rest-1.0) |
| Teams 회의 패널과 스테이지 | Teams 앱 매니페스트, 회의 컨텍스트와 리소스별 동의가 필요한 별도 앱 경로다. 승인된 테넌트의 테스트 앱으로 호스트·인증·참석 권한을 검증해야 한다. [Teams 회의 스테이지](https://learn.microsoft.com/en-us/microsoftteams/platform/apps-in-teams-meetings/build-apps-for-teams-meeting-stage) |

이번 작업에서 Teams 범위는 공식 문서 검토에 한정했다. 기관 승인 테넌트, 테스트 회의 링크·주최자 계정과 연동 정책이 확보되면 비식별 회의에서 참가·로비·권한 분리를 검증할 수 있다.

## 검증

- PostgreSQL 18.6, Python 3.10.20, Node 22.12.0, Chrome 146 사용. API에서 초대 권한, 같은 케이스 스캔 제한, 스캔 좌표 경계, 동일 세대의 인계 경합, 이전 브라우저 입력 차단, 세션·케이스 권한 회수와 감사를 확인했다.
- 격리 PostgreSQL에서 `0020 → 0021 → 0020 → 0021`, `alembic check`, 기존 케이스·컬렉션 보존 및 세션 기록이 있는 경우의 다운그레이드 차단을 확인했다.
- 개발 DB를 `.runtime/before-review-room-0021-20261124T200717.dump`에 백업한 뒤 9920에 배포했다. 기존 데이터 건수를 비교했고 새 UI의 제공 상태와 API 인증·케이스 범위를 확인했다.
- 동일한 1520 × 1050 두 브라우저의 독립 실행에서 스캔 전환 450ms, 팬 378ms, 연결 복구 796ms, 진행권 인계 235ms를 측정했다. 비교한 팬과 인계 프레임의 중심 오차는 0 level-0 px, 배율 차이는 0이었다. 네트워크 차단·새로고침을 각각 한 번 수행했고 인계에는 선택·버튼 조작 두 번이 필요했다. 이 값은 격리 브라우저 자동화이며 임상 SLA 측정에는 별도 기관 조건을 적용해야 한다.
- `MEDIAUTO_DEMO_PORT=19945 scripts/verify-integration.sh`에서 빌드, 백엔드 테스트 39개와 Chrome 시나리오 20개를 통과했다. 두 Chrome 컨텍스트의 NDPI·SVS 비교와 Follow, 단절·새로고침, 인계와 회수 재현을 포함했다.
- 기관 네트워크 지연, 사용자 검토, 테넌트 검증 및 AGENTS 완료 표시에는 사용자 확인이 필요하다.
