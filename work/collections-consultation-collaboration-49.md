# 49 · 컬렉션, Tumor Board, 자문 요청과 공동 판독

참조는 [Techcyte PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf) 19·32–33·37쪽, [42번 시연](workflow-verification-42.md), [43번 화면 대조](pdf-frontend-review-43.md)다.

| PDF | 확인한 화면과 발표 설명 | 이번 구현 |
|---|---|---|
| 19쪽 | Worklist에서 Tumor Board 컬렉션에 케이스를 추가하는 대화상자와 Collection Note가 보인다. 발표자는 회의 대상 케이스를 참조로 등록하는 흐름을 설명했다. | 개인·공유 컬렉션 및 보드별 회차를 대상 목록에 묶었다. 회차에서 Add Cases from Worklist를 누르면 해당 회차가 미리 선택된다. 저장 후 안건에 초점을 맞추며, 순번·Presented 집계·첫 미발표 안건과 정확한 WSI·완료 결과 경로를 제공한다. |
| 32쪽 | 설정 표의 사건별 In-app·Email·Push와 채널 선택이 보인다. | 자문 상세에서 Notification Preferences를 열고 동일 요청으로 돌아온다. 상단 Notifications의 This Request Only는 현재 사용자 수신함과 전송 이력을 해당 요청으로 좁힌다. |
| 33쪽 | Viewer에 참여자 색상·현재 발표자·Follow 동작이 보인다. 발표자는 진행권 교대와 Teams 통화를 설명했다. | 데스크톱 Viewer에서 겹쳐 열리는 참여자 패널을 사용한다. Driver, Following, Independent 및 연결 상태를 표시한다. 초대 대상자용 세션 진입 주소, Retry Connection, 온라인 참여자로의 인계 및 권한 회수에 기존 API를 사용한다. |
| 37쪽 | Viewer에서 요청 유형과 담당자를 선택하는 UI가 보인다. 발표자는 사용자·그룹 자문과 AI 요청을 설명했다. | Viewer의 Requests에서 활성 스캔을 기본값으로 설정하고 기존 케이스 자문·분석 폼을 재사용한다. 생성 후 작업 화면에 머물며, 상세에서 담당자·대상 스캔·상태·완료 응답을 조회하고 같은 스캔의 Requests로 돌아올 수 있다. 권한이 부여된 담당자 목록과 요청 범위의 WSI를 사용한다. |

우선 UI는 Worklist 대화상자를 통한 케이스 한 건씩 등록, 주소를 통한 안건 복귀, 기존 사용자 단위 배정 계약을 사용한다. 보고 근거와 AI 분석은 기존 흐름을 사용한다. PDF에는 그룹 배정, 외부 공유의 운영 권한과 보안 정책이 별도로 확인되지 않았다.

## 시연 절차

1. **Collections and Tumor Board → Board Meeting → Add Cases from Worklist**를 누른다. 케이스 미리보기에서 **Add to Collection or Board**를 열고 회차와 메모를 확인한 뒤 추가한다. **Open Destination**에서 등록된 행에 초점이 가는지 확인하고, **Move Earlier/Later**, **Mark Presented**, **First Pending Item**을 사용한다. **Slides and Completed Results**의 WSI나 완료 결과를 열고 **Back to Collection**으로 같은 안건에 복귀한다.
2. WSI에서 **Requests → New Request → Consultation**을 누른다. 기본 Target Scan을 확인하고 자문을 생성한다. **Open Created Request**에서 담당자 배정과 상태를 확인하고, 담당자는 상단 **Notifications**에서 요청을 연 뒤 응답을 완료한다. **This Request Only**, **Notification Preferences → Back to Request**, **Back to Viewer Requests**를 확인한다.
3. 첫 세션에서 **Collaborative Review → Start Review Session → Invite**를 실행한다. 초대한 사용자는 별도 로그인 세션에서 **Session Link for Invited Participants**의 주소로 진입한다. **Join Review Session → Follow Driver** 이후 스캔과 위치를 비교하고, **Hand Off Drive**로 진행권을 넘긴다. 연결을 끊었다가 복구하고 새로고침한 뒤 Follow 복원을 확인한다. 방 소유자가 참여 권한을 회수하면 상대 Viewer는 독립 판독 화면을 유지하며 공동 판독을 사용할 수 없다.

## 외부 Teams

Viewer의 **Microsoft Teams · Not Configured** 상태를 확인했다. 이 앱에서 승인된 Teams 테넌트와 회의 연결은 대기 상태다. 실제 회의 참여는 기관과 주최자의 참가·로비 정책을 따른다. IMS 세션 주소로 들어오면 기존 계정·케이스·초대 권한을 확인한다. [Microsoft Teams 참가 정책](https://learn.microsoft.com/en-us/microsoftteams/anonymous-users-in-meetings) · [33번 구현과 공식 문서 검토](collaborative-review-33.md)

## 검증

Linux 6.8, Node 22.12.0, Python 3.10.20, 임시 PostgreSQL 18.6, Chrome 146에서 합성 환자·케이스·요청과 프로젝트 NDPI/SVS 샘플을 사용했다. 코드 변경은 프런트, 브라우저 시나리오와 작업 기록에 적용했다. DB 마이그레이션이 없으며 이 커밋을 되돌린 뒤 프런트를 재빌드하면 롤백된다. 실제 기관의 Teams, Email·Push 전송과 임상 사용자 검토는 별도 확인 대상이다.

```bash
npm --prefix frontend run build
scripts/verify-integration.sh
scripts/verify-integration.sh --demo tumor-board
scripts/verify-integration.sh --demo collaboration
git diff --check
```

- 빌드, Alembic 검증, 협업·권한 관련 API 테스트 4개, 브라우저 시나리오 7개를 통과했다. 자문·보드 이후 한 번의 브라우저 실행이 종료되어 공동 판독과 레이아웃·알림 구간은 별도 임시 DB로 확인했다. 390px Viewer에서 캔버스 배치와 History 위 공동 판독 패널의 열기·닫기를 함께 확인했다. [API](../.runtime/collaboration-49/api.log) · [자문·보드](../.runtime/collaboration-49/browser-final.log) · [공동 판독](../.runtime/collaboration-49/collaboration-final.log) · [레이아웃·알림](../.runtime/collaboration-49/layout-final.log)
- 두 브라우저에서 스캔 전환 519ms, 재접속 1,354ms, 진행권 인계 897ms를 측정했다. 동일 배율 환경의 팬·인계 후 중심 좌표와 배율 차이는 0이었다. 개발 환경의 단일 측정이며 임상 사용성 기준값은 적용하지 않았다. [Tumor Board 안건](../.runtime/collaboration-49/tumor-board-presented-agenda.png) · [공동 판독 인계](../.runtime/collaboration-49/collaboration-drive-handoff.png)
- 포트 9920에서 최신 프런트 번들과 정상 health 응답을 확인했다.
