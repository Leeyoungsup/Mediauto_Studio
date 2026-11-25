# 51 · 최종 프런트와 PDF 전체 워크플로우 검증

[참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)의 2–13쪽 설명, 14–47쪽의 화면 34개, §8의 기능 ID 96개를 대상으로 했다. 43번의 기준 커밋은 `36fbecf`, 이번 검증 대상 앱 커밋은 `b872c3e`다. 기준표를 남겨 전후 판정과 원래 관찰 내용을 확인할 수 있게 했다. [96개 기능 최종표](pdf-frontend-feature-matrix-51.md) · [43번 기준 검토](pdf-frontend-review-43.md) · [42번 역할별 시연](workflow-verification-42.md)

| 기능 상태 | 43번 | 최종 | 변화 |
|---|---:|---:|---:|
| 동작 | 43 | 65 | +22 |
| UI 차이 | 25 | 3 | -22 |
| 부분 | 24 | 24 | 0 |
| 외부 | 3 | 3 | 0 |
| 누락 | 1 | 1 | 0 |
| 합계 | 96 | 96 | 0 |

22개는 진입·선택·복귀 흐름이 개선되어 최종 앱에서 대응 동작을 확인한 항목이다. 판정은 기능의 사용자 경로와 근거를 나타낸다. 같은 E2E가 여러 ID를 뒷받침하며, 실제 기관 연결 및 임상 성능은 검증 범위를 따로 기록했다.

## PDF 2–13쪽의 근거와 적용 범위

| 쪽 | 근거 유형과 최종 적용 |
|---:|---|
| 2 | **자료 방법.** 설명, 화면 캡처, 질문·답변의 출처가 나뉜다. 최종 검증도 34개 화면과 96개 기능 ID를 분리해 다룬다. |
| 3 | **화면·업체 발표.** Worklist, AP/CP와 외부 연동을 설명한다. 로컬 Worklist·우선순위·저장 View와 EMR/LIS 미설정·Mock 사용을 검증했다. 실제 장비와 부서별 AP/CP 연동은 기관 범위다. |
| 4 | **화면·업체 발표.** Viewer·문서·OR·접수 QC·감사를 제시한다. 현재 스캔, 문서 원천, 검체와 스캔 QC, 역할별 감사 경로에서 확인했다. |
| 5 | **화면·업체 발표.** 멀티슬라이드, 주석, 계수, 자문, Follow/Drive를 설명한다. 4 pane·수동 조직 정합과 로컬 공동 판독을 사용했다. 자동 정합·6 pane·Teams는 별도다. |
| 6 | **화면·업체 발표.** ROI 유사검색 및 분석 결과·Pap 예시다. 로컬 검색과 스캔에 연결된 보관 결과·오버레이를 검증했다. 실제 외부 추론 서비스와 임상 민감도는 미확인이다. |
| 7 | **화면·업체 발표.** 보고·음성·QC·Best Block·선실행을 설명한다. 합성 전사, 수기 QC, IHC 근거, Mock LIS 보고·정정과 기록을 확인했다. 장비·음성 정확도와 운영 전송은 기관 시험이 필요하다. |
| 8 | **회의 참석자 의견·업체 답변.** 병리사/병리의 범위, CPS/TPS 적용, 시험 테넌트, 가격·Beaker 일정 질문은 도입 계획의 입력이다. **자체 검증 기준.** 사용자 역할과 현재 스캔, 검증된 결과 버전을 화면에서 확인했다. |
| 9 | **자체 권고·인덱스.** 상태 원천, 라벨 오류, 보존, 모델 버전, 외부 연동을 점검 대상으로 둔다. 임시 DB에서 원천 장애·실패·권한을 재현했다. |
| 10–11 | **§8 인덱스와 화면·발표 근거.** Worklist·Viewer·보고·AI를 기능별로 확인했다. |
| 12 | **§8 인덱스와 부록.** Pap 검토 단계와 독립 조직생검 비교를 확인했다. 시험에는 합성 기관 용어와 역할을 사용했다. |
| 13 | **자료 한계.** 영상/설명만으로 장비·계약·인증 및 임상 효능을 확정할 수 없다. 기관 확인 항목은 아래에 기록했다. |

## PDF 화면 34개 최종 대조

`{case}`, `{scan}`, `{board}`, `{entry}`, `{link}`는 해당 시연에서 생성한 내부 ID다. 증거 약호의 실행 파일과 권한은 [최종 기능표](pdf-frontend-feature-matrix-51.md#근거)에 있다. 여기서 43번 항목은 당시 화면, 최종 항목은 현재 위치·조작과 유지되는 제한이다.

| PDF 쪽 | 화면에서 관찰한 조작 | 43번 기준 | 최종 경로와 근거 |
|---:|---|---|---|
| 14 | Cases/Scans, 사이드바·케이스 표 | 좌측과 상단에 같은 목록으로 가는 링크 | 관리자/접수·병리의 · `#worklist/all`, `#worklist/mine`, `#scans`에서 활성 업무함/Intake와 Preview를 확인한다. **WL, WS, UI** |
| 15 | More Filters의 조건 | 그룹·원천 표시, 접근과 검색 위치 개선 과제 | Worklist → **More Filters**에서 필드별 출처와 적용 칩을 확인한다. **WL** |
| 16 | 채취일 기준 연령과 빈 결과 | 범위 필터를 열고 결과 없는 상태 확인 | Worklist → **More Filters → Age at Collection**에서 범위, 누락값 및 조건 해제를 확인한다. **WL** |
| 17 | 저장 View와 필터 | 저장 View·열 포함 옵션 | **Save New View**와 개인/공유 범위를 적용하고 재접속 후 정렬·컬럼을 확인한다. **WL** |
| 18 | Frozen 분류 업무함 | Frozen 진입, 보고 연결 개선 과제 | Worklist → **Frozen Section → Frozen Report**로 병리의가 해당 케이스를 연다. **WG, OR** |
| 19 | Tumor Board에 케이스·메모 추가 | 개별 대상 선택 | 회차 → **Add Cases from Worklist → Add to Collection or Board → Open Destination**이 회차를 미리 선택하고 같은 안건으로 간다. 한 번에 한 대상이다. **BO** |
| 20 | 컬럼 검색·선택·순서 | 체크와 Up/Down | Worklist → **Columns**에서 열을 표시하거나 이동하고 저장 View에 반영한다. 순서는 버튼 방식이다. **WL** |
| 21 | 다중 정렬 방향·우선순위 | 필드와 순서 입력, 현재 순서 강조가 과제 | **Multi-Level Sort**에서 적용 순서와 기본값 복원, 필터와 조합을 확인한다. **WL** |
| 22 | 미리보기에서 스캔 선택 | 원본 ID·형식 표시, 선택 강조 개선 과제 | Worklist **Case Preview → Slides**에서 NDPI/SVS·QC 상태를 구분하고 스캔을 연다. **IN, WS** |
| 23 | WSI, Tray, 뷰어 탭·도구 | 영상 초기 영역과 헤더 조작이 분산 | `#viewer/{case}/{scan}`에서 활성 스캔, 문서 탭, 조작과 보이는 캔버스 영역을 확인한다. **GR, WS, UI** |
| 24 | Label·Overview·미니맵 설정 | 설정과 Tray 저장 | **Viewer Settings**와 이미지 버튼으로 설정하고 새 세션에 복원한다. 게임패드·커서 유형·성능 시험 UI는 미확인이다. **WS, SRC** |
| 25 | 진료 기록 목록·본문 | History 다음 Slides 복귀 배율 유지 | Viewer/Case **History → Open in Case Details → Open Viewer**에서 같은 기록·스캔과 EMR 장애 중 기록을 확인한다. **HI, UI** |
| 26 | Media PDF | 케이스/Viewer의 첨부 및 미리보기 | **Media**에서 페이지 이동·다운로드 감사·미리보기 실패 복구·스캔 복귀를 확인한다. **MD** |
| 27 | 검체별 Gross 사진 | 등록·필터 기능 있음 | **Gross Images**에서 검체 필터를 적용하고 Case Details를 거쳐 원래 스캔으로 돌아간다. **MD** |
| 28 | OR 결과·콜백·절제연 | 발표 결과 및 확인, 밀도 개선 과제 | **Frozen Section → Open OR View**에서 버전·절제연·콜백·실패·ACK를 확인하고 정정본을 재확인한다. **OR** |
| 29 | Case Editor의 라벨·품질 | Editor 별도 진입 | Worklist **Review Scan QC** 또는 Viewer **Case Editor**에서 해당 스캔을 열어 라벨을 확인하고 교체 후 복귀한다. QC는 Editor를 사용한다. **IN, GR** |
| 30 | Case Logs의 시간·사용자·행위·결과 | Viewer 이력과 Settings 계정 감사 분리 | Viewer/Case **Case Logs**와 관리자 `#settings/accounts/audit`에서 각각 로그를 필터링하고 업무 권한을 확인한다. **LG, UA, UI** |
| 31 | ROI 검색 시작과 결과 | 로컬 검색과 원래 WSI 복귀 | **Annotations → Find Similar ROIs**에서 장기, 미리보기, 결과, 원본·대상 위치와 재시도를 확인한다. 운영 Aignostics는 별도다. **RO** |
| 32 | 사건별 In-app·Email·Push | 알림 설정 분리 | 상단 **Notifications**, Notes·요청의 **Notification Preferences**와 현재 요청 필터. 외부 채널은 실패/차단 상태까지 합성 검증했다. **NT, RQ** |
| 33 | 참여자 색상·발표자·Follow | 로컬 Follow/Drive와 아이콘 | **Collaborative Review**에서 초대 링크, 현재 Driver, 연결, 인계, 재접속과 권한 회수. Teams는 **Not Configured**다. **CO** |
| 34 | 네 조직 화면과 미니맵 | 4 pane·수동 정합 | **Multi View**로 활성 pane과 동기화, 기준점·잔차를 확인한다. 최대 4 pane, 자동 정합은 미구현이다. **MV** |
| 35 | 직선·다분절 거리 도구 | 각 아이콘과 안내 | Viewer 도구 → **Distance Measurement** 또는 다분절에서 거리·단위·저장 후 확대 동작을 확인한다. **MV** |
| 36 | 주석 목록과 영상 도형 | 닫기와 목록 있음, 캔버스 피드백 보완 과제 | **Polygon ROI / Annotations**에서 프리뷰·닫기·Undo·잘못된 도형 차단과 ROI PNG를 확인한다. **MV** |
| 37 | 분석/자문 요청 팝업 | Analysis는 Viewer 안, 자문은 케이스 화면으로 이동 | Viewer **Requests**는 활성 스캔을 기본값으로 쓰고, **Analysis**는 모델 가용·작업 상태·고정 결과 및 **Back to Slide Analysis**를 제공한다. **RQ, AX, UI** |
| 38 | Positive/Total 계수 입력 | 영상 아래 패널, 검체 단위 | 영상 내 **Lymph Node Count**에서 Positive/Total과 작업 스캔을 보고 **Open Report Draft**로 근거를 확인한다. 저장은 검체 단위다. **MV, GR** |
| 39 | Ki-67 셀과 결과 카드 | 카드·셀 편집 및 복원 | **IHC Results**에서 원본/편집·오버레이, **Return to WSI**, Best Block 경로를 확인한다. **IH, AX** |
| 40 | PR 판정·카드 | PR 표시, 편집 브라우저 근거는 Ki-67 | PR 스캔의 결과와 세포, 승인되지 않은 집계 제한을 확인한다. PR 전용 편집·복원 조작은 별도 검증이다. **IH, API** |
| 41 | HER2 패턴과 Composite | 검증 자료에 연결된 Composite | **IHC Results**에서 검증 자료, 막 패턴, 원본·변경 이력 및 근거 회수 시 제한을 확인한다. **BM** |
| 42 | CPS/TPS 카드 및 세포 유형 | 승인 조합만 표시 | **PD-L1 Results**에서 결과 버전·검증 근거·원본 링크·세포 오버레이 및 고정 결과 누락을 확인한다. **BM, AX** |
| 43 | 전립선 Core/Level 및 조직 구획 | 계약 내 Grade Group·길이·PNI | **Prostate AI**에서 영역을 선택하고 결과 버전·누락값·**Return to WSI**를 확인한다. **PR** |
| 44 | 피부 영역·Heatmap·후보 | 방향 표식과 수기 검토, 자동 회전 미확인 | **Skin Review**에서 레이어·후보·계수와 **Return to WSI**를 확인한다. **SK** |
| 45 | WSI와 Pap 후보 그리드 | 일반 미입력 스캔에도 Pap 입구가 보임 | 등록 Pap 스캔에 **Pap Gallery**가 나타난다. 범주·후보·좌표·복원과 **Open Pap Review**를 확인한다. **PG, UI** |
| 46 | Pap 적절성·해석·미생물 | Gallery와 검토의 별도 입구 | **Pap Review**에서 선택 후보 맥락과 1차·후속 이력, **Return to Pap Candidates**를 확인한다. **PA, PG** |
| 47 | 연관 생검과 Pap 병렬 WSI | 독립 pane 및 양쪽 접근 | Pap Review **Compare Related Biopsy** → `#related-comparison/{link}`에서 두 WSI의 검체·염색·스캔과 독립 줌/팬, 출발 Pap 검토 복귀. **RL** |

## 43번과 최종 프런트 비교

같은 `IMS-DEMO-101`과 미입력 염색의 NDPI/SVS를 사용했다. 화면 측정은 페이지 가로 넘침과 스크롤 시작점으로부터 캔버스 아래쪽까지의 y좌표를 비교한다. 조작 수는 버튼을 화면에 보이게 만든 개수가 아닌 실제 독립 시연 계측표에서 따로 확인한다.

| 지표·조작 | 43번 | 최종 51번 |
|---|---|---|
| 데스크톱 1440×900, NDPI/SVS 캔버스 하단 | 각각 y=971px | 각각 y=891px, 상단 y=268px. 영상 하단이 초기 화면 안에 들어온다. |
| 모바일 390×844, NDPI 캔버스 하단 | y=1575px | y=835px, 상단 y=462px. |
| 페이지 가로 넘침 | 0px | 0px |
| 헤더 버튼 / 영상 도구막대 버튼 | 7 / 12 | 8 / 15. 표시 방식과 범위가 바뀌었으므로 버튼 수로 업무 조작을 평가하지 않는다. |
| 미입력 염색의 분석·Pap | 두 Analysis 진입점과 모델 선택 없음, Pap 진입 버튼 표시 | 두 진입점이 같은 Analysis 패널을 열고 모델 미지원 상태를 표시한다. Pap 버튼은 등록된 Pap 염색에 표시된다. |
| History와 스캔 복귀 | Viewer History에서 같은 배율로 복귀 | 같은 캔버스·배율 및 **Open in Case Details**에서 정확한 스캔 복귀. |
| 자문 | 케이스 Requests 탭으로 이동 | Viewer 안에서 Requests를 열고 대상 스캔이 미리 선택된다. |
| 계정 감사 | Accounts의 Audit Log, 병리의 API 403 | 관리자 직접 주소 `#settings/accounts/audit`, 병리의 화면 권한 거부와 API 403 확인. |

[43번 1440px 화면](../.runtime/workflow-43/43-viewer-1440.png) · [최종 1440px 화면](../.runtime/workflow-51/probe/51-viewer-1440.png) · [43번 390px 화면](../.runtime/workflow-43/43-viewer-390.png) · [최종 390px 화면](../.runtime/workflow-51/probe/51-viewer-390.png) · [43번 측정](../.runtime/workflow-43/43-frontend-probe.json) · [최종 측정](../.runtime/workflow-51/probe/51-frontend-probe.json)

## 통합 검증 및 독립 시연

Linux x86_64, AMD Ryzen Threadripper PRO 5965WX, 루프백, Node 22.12.0, Python 3.10.20, PostgreSQL 18.6, Chrome 146.0.7680.164에서 프로젝트의 NDPI/SVS 샘플과 합성 환자·결과·외부 메시지를 사용했다. [기존 SaaS 저장소](../reference/Base_Git_repository.txt)의 로컬 복제본에 기준 커밋 `d3741bc`가 있음을 확인했다. 현재 검증은 이 프로젝트의 React·FastAPI 앱에서 수행했다.

| 경로 | 최종 시연 순서와 역할 | 정상·복구·권한 증거 | 43번 / 최종 화면 |
|---|---|---|---|
| 일반 | 접수 관리자 **Slide Registration → Case Editor → Review Scan QC**. 배정 관리자 **Assign Case**. 배정 병리의 **Open Viewer → Start Review → Review Complete → Report Draft**. 원본 V3 승인·Mock LIS ACK → 정정 V7 승인·ACK → **Case Logs**. | 합성 `IMS-QA-EDITOR` 한 케이스에서 접수·라벨 재시도·QC 보류 원본 접근 409·교체 NDPI 판독과 재접속·보고 이력. 미배정 사용자는 접근 거부. 별도 `IMS-DEMO-101`에서 NDPI/SVS 전환, 잘못된 로그인 및 타일 503 후 복구. | [43번](../.runtime/workflow-43/general-report-approved-correction.png) / [최종](../.runtime/workflow-51/independent/general-report-approved-correction.png) |
| Frozen | 관리자 **Authorize Recipient**. 병리의 **Frozen Section → Publish Preliminary Result**. OR 수신자 확인 문제 기록 → V1 ACK, 병리의 콜백과 read-back 기록 → V2 정정 → 새 ACK. | 원래 절제연·V1 확인·콜백 이력 유지, 새 버전의 별도 확인. 관리자 OR 화면에서 정확한 SVS로 복귀, OR 수신자의 케이스 직접 접근은 404. | [43번](../.runtime/workflow-43/frozen-corrected-and-acknowledged.png) / [최종](../.runtime/workflow-51/independent/frozen-corrected-and-acknowledged.png) |
| Tumor Board | 준비자 회차에서 Worklist로 이동 → **Add Case Reference**, 순서·메모·**Presented**. 참석자 **Slides and Completed Results**에서 SVS와 완료 자문 → **Back to Collection**. | 개인/공유 권한과 안건의 케이스 가시성을 교차 적용한다. 비회원 거부 및 회수 후 화면 숨김. 새로고침을 포함한 같은 안건 복귀. | [43번](../.runtime/workflow-43/tumor-board-presented-agenda.png) / [최종](../.runtime/workflow-51/independent/tumor-board-presented-agenda.png) |
| IHC | 검토자 **IHC Results → Cell Overlay → Save IHC Review → Restore Original**. 배정 병리의 **Analysis**에서 모델 실행, **Run Details → Back to Slide Analysis → Show Result on Slide**, Best Block과 보고 근거 확인. | Ki-67 66.67→100→66.67%와 원본·수정 감사. ER/PR 표시·집계 승인 제한, HER2 패턴 및 PD-L1 검증 자료, 바인딩·고정 결과 누락·실행 재시도 확인. 실행 범위는 Replay/Preflight다. | [43번](../.runtime/workflow-43/ihc-restored-result-and-audit.png) / [최종](../.runtime/workflow-51/independent/ihc-restored-result-and-audit.png) |
| Pap | 설정 관리자 **Pap Review Policy**. 1차 검토자 **Pap Gallery → Open Pap Review** 및 제출. 후속 병리의 완료·반려·재개. 연관 **Compare Related Biopsy → Return to Pap Review**. | 후보 복원, 썸네일 503과 아카이브 오류 복구, 적절성·해석·미생물 및 용어 버전 고정, 권한 회수. 환자·검체 연결 및 두 WSI의 독립 탐색을 확인한다. | [43번](../.runtime/workflow-43/pap-completed-follow-up.png) / [최종](../.runtime/workflow-51/independent/pap-completed-follow-up.png) |
| 공동 판독 | 운영자가 **Invite**, 다른 브라우저에서 링크로 입장 → **Follow Driver** → 스캔 전환과 팬/줌 → **Hand Off Drive**. | Follow 중지와 독립 탐색, 네트워크 끊김 및 **Retry Connection**, 새로고침 후 Follow 복원, 인계 감사·권한 회수. 좁은 화면의 패널과 별도 문서 탭을 확인한다. | [43번](../.runtime/workflow-43/collaboration-drive-handoff.png) / [최종](../.runtime/workflow-51/independent/collaboration-drive-handoff.png) |

### 실행 결과와 재현

- **PASS** · TypeScript/Vite, Alembic, 임시 PostgreSQL의 Python 테스트 59개, Chrome 시나리오 28개와 최종 프런트 측정. 첫 단일 실행은 검증 스크립트 편집 중 셸 읽기 오류로 브라우저 시작 전에 종료되었다. 완료한 백엔드 결과를 보존하고 브라우저 전체 목록을 세 묶음의 별도 임시 DB에서 다시 실행했다. [빌드·백엔드](../.runtime/workflow-51/full/run.log) · [Workspace/Viewer/요청](../.runtime/workflow-51/full/foundation/run.log) · [접수/문서/일반 보고](../.runtime/workflow-51/full/case/run.log) · [전용 경로](../.runtime/workflow-51/full/special/run.log) · [최종 화면 측정](../.runtime/workflow-51/probe/run.log)
- **PASS** · 여섯 독립 시연은 각각 별도 임시 DB에서 수행했다. Pap 최초 독립 실행은 선택 후보가 표시된 Pap Review를 기다리다 제한 시간에 도달했다. 전체 브라우저 묶음과 분리한 Pap 재실행에서는 통과했다. [일반](../.runtime/workflow-51/independent/general.log) · [Frozen](../.runtime/workflow-51/independent/frozen.log) · [Tumor Board](../.runtime/workflow-51/independent/tumor-board.log) · [IHC](../.runtime/workflow-51/independent/ihc.log) · [Pap 최초](../.runtime/workflow-51/independent/pap.log) · [Pap 재실행](../.runtime/workflow-51/independent/pap-retry.log) · [공동 판독](../.runtime/workflow-51/independent/collaboration.log)

Playwright 설치와 테스트 샘플 준비는 [10번 기준](integration-demo-10.md)을 따른다. 기존 전체 실행과 독립 실행은 다음과 같이 재현한다. `--probe`는 43번과 같은 크기의 화면과 합성 케이스로 UI를 측정한다.

```bash
export MEDIAUTO_WORKFLOW_EVIDENCE_DIR="$PWD/.runtime/workflow-51/repro"
mkdir -p "$MEDIAUTO_WORKFLOW_EVIDENCE_DIR"
MEDIAUTO_DEMO_PORT=19995 scripts/verify-integration.sh
for scenario in general frozen tumor-board ihc pap collaboration; do
  MEDIAUTO_DEMO_PORT=19996 scripts/verify-integration.sh --demo "$scenario" || break
done
MEDIAUTO_DEMO_PORT=19999 scripts/verify-integration.sh --probe
```

수동으로 확인할 때는 `scripts/verify-integration.sh --manual`의 격리 세션에서 기본 샘플을 열고, 각 전용 경로의 데이터와 권한은 해당 독립 시연 스크립트의 픽스처를 사용한다. 아래 측정은 브라우저 자동 조작이며, 실제 역할의 업무 시간·조작 수 기준은 임상 사용자와 따로 확정한다.

### 역할별 시간·조작·전환·오류

일반 기본 경로는 **상세→첫 NDPI** 371→351ms, **NDPI→SVS** 366→355ms, **줌** 36→36ms, **팬** 77→73ms였다. 관리자 조작/전환은 9/2회, 배정 병리의는 24/3회로 같았다. 두 실행의 정상 오류·재시도는 0회씩이고 오류 주입 후 재시도는 2회씩이었다. [43번 원본](../.runtime/workflow-43/run.log) · [최종 원본](../.runtime/workflow-51/independent/general.log)

아래 각 셀의 순서는 **43번 → 최종**이다. 시간은 첫~마지막 브라우저 조작 사이로 역할 교대 대기와 브라우저 실행 부하를 포함한다. 조작은 클릭 및 입력 확정, 전환은 브라우저 주소 변경, HTTP는 페이지가 받은 4xx/5xx다. 별도 API 호출, 네트워크 중단, OR의 업무상 확인 실패는 각 시연 로그와 위 표에 있다. 43번 전체 실행에서 수집한 역할 JSON과 이번 독립 시연을 비교하므로, 추가된 경로의 조작까지 포함한 개발 환경 표본이다.

| 시연·역할 | 시간(초) | 조작(회) | 전환(회) | HTTP 4xx/5xx | 재시도 클릭 |
|---|---:|---:|---:|---:|---:|
| 일반 · 접수 · 접수 관리자 | 2.161→3.159 | 46→53 | 4→7 | 2/0→3/0 | 1→1 |
| 일반 · 보고 · 배정·보고 관리자 | 3.295→3.161 | 22→23 | 2→2 | 0/0→0/0 | 0→0 |
| 일반 · 보고 · 배정 병리의 | 5.516→6.621 | 21→23 | 2→3 | 0/0→0/0 | 0→0 |
| 일반 · 보고 · 미배정 병리의 | 0.000→0.000 | 0→0 | 0→0 | 1/0→1/0 | 0→0 |
| Frozen · 실험실 관리자 | 0.051→0.580 | 3→7 | 0→4 | 0/0→0/0 | 0→0 |
| Frozen · Frozen 병리의 | 1.422→5.539 | 19→20 | 1→2 | 0/0→0/0 | 0→0 |
| Frozen · OR 수신자 | 5.532→5.464 | 9→9 | 1→1 | 0/0→0/0 | 0→0 |
| Tumor Board · 보드 준비자 | 4.112→4.028 | 60→61 | 8→13 | 0/0→0/0 | 0→0 |
| Tumor Board · 보드 참석자 | 0.599→0.737 | 4→6 | 6→7 | 2/0→2/0 | 0→0 |
| Tumor Board · 비회원 | 0.000→0.000 | 0→0 | 0→0 | 2/0→1/0 | 0→0 |
| IHC · IHC 검토자 | 2.115→1.961 | 18→21 | 2→3 | 0/0→0/0 | 0→0 |
| Pap · 용어 관리자 | 0.168→0.174 | 9→9 | 0→0 | 0/0→0/0 | 0→0 |
| Pap · 1차 검토자 | 0.809→1.033 | 8→8 | 0→0 | 0/0→0/0 | 0→0 |
| Pap · 대체 검토자 | 0.266→0.351 | 3→3 | 0→0 | 0/0→0/0 | 0→0 |
| Pap · 후속 병리의 | 1.666→1.933 | 12→12 | 0→0 | 0/0→0/0 | 0→0 |
| 공동 판독 · 세션 운영자 | 6.929→7.496 | 18→19 | 1→1 | 0/0→0/0 | 0→0 |
| 공동 판독 · 초대 병리의 | 5.770→6.833 | 6→10 | 0→0 | 0/0→0/0 | 0→1 |

역할 JSON의 JavaScript 오류는 43번과 최종 모두 0건이었다. 최종 공동 판독의 스캔 전환은 465ms, 팬 375ms, 재접속 1,333ms, 인계 417ms이며, 팬·인계 후 두 세션의 중심 좌표와 줌 차이는 0이었다. [43번 JSON 및 캡처](../.runtime/workflow-43/) · [최종 JSON 및 캡처](../.runtime/workflow-51/independent/)

## 남은 검증과 제품 범위

- **기관·임상 사용자 시험 대기** · 실제 EMR/LIS·스캐너·PACS/VNA, 기관 DICOM Metadata, 외부 검색·AI·Email/Push·Teams 및 OR 장비, 장기 보존·복구와 규제 적합성. 실제 병리사·병리의·OR·보드 참여자의 사용자 수락·임상 유효성 검증도 남아 있다. [기관 연동 범위](institution-integration-41.md)
- **PDF 대비 남은 기능** · 컬렉션 트리형 다중 선택, 게임패드/커서 유형/성능 시험 설정, 전체 viewport 캡처, 6 pane·자동 정합, 자동 표피 회전 및 미계약 모델 출력. 계수는 검체 단위로 저장하여 보고 근거에 연결하며 Notes 자동 기록은 누락 1건으로 남겼다. [최종 기능표](pdf-frontend-feature-matrix-51.md)
- 포트 9920의 health 응답과 검증 대상 프런트 번들을 읽기로 확인했다. 변경은 검증 명령·측정 스크립트·대조표에 적용했다. 데이터베이스 변경은 없으며, 검증 도구와 문서는 작업 커밋을 되돌려 롤백할 수 있다. AGENTS.md의 51번 완료 체크는 사용자 확인을 기다린다.
