# 43. PDF 전체 워크플로우와 현재 프런트 비교

2026-11-25 기준 앱 `36fbecf`의 React·FastAPI 화면을 비교했다. 기존 WSI·도구·업무 API를 유지한 상태에서 각 경로의 발견 가능성, 역할별 가시성, 현재 케이스/스캔 유지와 오류 복구를 봤다. 원본 베이스 `d3741bc`는 별도 SaaS 저장소에서 확인했다. 42번은 구현과 합성 E2E의 기준선이며 이 문서는 같은 기능이 현재 화면에서 어떻게 제공되는지 기록한다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf) · [42번 검증](workflow-verification-42.md) · [96개 기능별 대조](pdf-frontend-feature-matrix-43.md)

## PDF 2–13쪽 대조

| PDF 위치 | 근거 및 현재 앱에서 확인할 범위 |
|---|---|
| 2쪽 · 요약·방법 | **화면·자료 방법.** Worklist부터 판독·협업까지 이어지는 대표 장면과 증거 유형을 정의한다. 지금 앱에서는 여러 경로가 열리지만 조작·화면 배치와 같은 케이스 복귀 경험은 44–50번에서 검토한다. |
| 3쪽 · 플랫폼·Worklist | **발표·화면.** AP/CP, EHR/LIS·스캐너·저장 및 외부 AI의 통합 수준은 업체 설명이다. 로컬 스캔·Mock EMR/LIS·업무함과 저장 View를 재검증한다. Case points 공식, 외부 저장·동기화·벤더 계약은 기관 확인 범위다. |
| 4쪽 · Viewer | **화면·발표.** 컬럼 설정, Tray와 WSI, 문서·임상 맥락, OR, 라벨 편집과 감사 경로가 제시된다. 현재 앱에는 각각 진입점이 있다. 문서는 Viewer 탭에서 영상 대신 열리고, QC는 Case Editor에서 진행한다. |
| 5쪽 · 판독·협업 | **화면·발표.** 4분할, 주석·측정, 요청, 림프절 계수, Follow/Drive가 제시된다. 현재 판독 도구는 아이콘과 오른쪽 목록으로 연결된다. 최대 6개·자동 정합·Teams·Notes 자동 기록은 별도 범위다. |
| 6쪽 · 검색·AI | **화면·발표.** PathoSearch, IHC/PD-L1, 전립선, 피부, Pap 결과 화면이다. 현재 로컬 ROI 검색과 보관/합성 AI 결과를 확인한다. 실제 외부 벤더 추론과 자동 표피 회전은 확인되지 않았다. |
| 7쪽 · 보고·QC | **발표·화면.** 음성 전사, QC 원천, best block, 사전 실행을 설명한다. 현재 합성 음성 결과·보고 근거·Mock LIS ACK, 수기 QC 및 보관 결과 실행으로 확인한다. 원내 전송과 음성 인식 정확도는 기관 검증 대상이다. |
| 8쪽 · Q&A·권고 | **참석자 의견.** 병리사·병리의 흐름과 CPS/TPS 지원 요청을 기록했다. **업체 답변.** 가격, 시험 테넌트, 모델 버전 병행, 무중단 전환, Beaker 일정은 계약·운영 근거가 필요하다. **자체 권고.** 결과의 적용 범위를 화면에서 설명하고 사용 역할별 검증을 실시한다. |
| 9쪽 · 위험·인덱스 | **자체 권고·인덱스.** AI 적용 범위, 상태 동기화, 감사, 성능, 버전, 라벨 오류와 부서 간 접근을 확인 대상으로 둔다. 로컬 오류·권한 시험과 기관 검증을 구분한다. |
| 10–11쪽 · 인덱스 | **화면·발표 근거.** Worklist 및 Viewer 상세 동작, 림프절 계수, 보관 AI의 세부 기능을 행별로 매핑했다. 고유 ID를 PDF 원문에서 추출해 42번 및 43번의 집합과 비교한다. |
| 12쪽 · 인덱스·부록 | **화면·발표 근거.** Pap·조직생검 기능의 검토 단계와 영상·전사 참조를 포함한다. 현재 테스트의 권한·상태 검증은 합성 정책 버전으로 이뤄진다. |
| 13쪽 · 자료 한계 | **자료 한계.** 기관 계약, 임상 성능, 가용성 및 인증을 판단하려면 별도 자료가 필요하다. [기관 연동 기록](institution-integration-41.md) |

## PDF 화면 34개와 최신 앱

`{case}`·`{scan}`은 내부 UUID, `{board}`·`{roi}`는 각 화면에서 생성된 ID다. 해시 뒤의 UI 항목은 해당 주소에서 선택한다. 역할은 격리 시연 계정 기준이다. 각 약호의 스크립트 및 세부 차이는 [기능별 대조표](pdf-frontend-feature-matrix-43.md)에 있다.

| PDF 쪽 | 화면에서 관찰한 핵심 조작 | 현재 진입 경로·역할과 근거 | 프런트 차이 및 후속 번호 |
|---:|---|---|---|
| 14 | 좌측 탐색, Cases/Scans 전환, 케이스 표 | `#worklist/all` 및 `#scans` · 관리자/접수 · WL, IN, UI | 사이드바와 상단 업무함 링크가 함께 표시된다. 같은 선택을 두 영역에서 어떻게 안내할지 44·45. |
| 15 | More filters에서 상세 조건 선택 | `#worklist/all` → **More Filters** · 관리자·병리의 · WL | 현재 조건 분류와 필드 원천을 유지하며 검색·필터·결과의 위치를 45에서 정리. |
| 16 | 채취일 기준 연령 조건과 빈 결과 | Worklist → **More Filters** → 연령 범위 · 관리자 · WL | 조건이 적용된 빈 결과와 생년/채취일 누락을 보여준다. 조건 제거·전체 초기화의 발견 가능성 45. |
| 17 | View 이름·저장 범위·현재 열 포함 | Worklist → **Save New View** · 관리자/병리의 · WL | 조직 공유는 현재 관리자 권한. 저장 범위·현재 적용 View를 함께 인지하게 45. |
| 18 | Frozen 업무함과 우선순위 적용 | Worklist → **Frozen Cases** / **Global Views** · 관리자/병리의 · WG, OR | 활성 큐·우선순위의 출처와 보고 진입을 45·48에서 확인. |
| 19 | Tumor Board에 케이스·메모 추가 | Case Preview → **Add to Collection or Board** · 관리자/병리의 · BO | 현재 선택 폼은 개별 대상 선택. 계층 탐색·다중 대상은 별도 계약 확인 후 49. |
| 20 | Columns 검색·체크·드래그·저장 열 표시 | Worklist → **Columns** · 관리자/병리의 · WL | Up/Down 조작과 저장 열이 있음. 열 순서 조작과 저장 범위 안내 45. |
| 21 | 정렬 우선순위·방향·초기화 | Worklist → **Multi-Level Sort** · 관리자/병리의 · WL | 현재 선택 입력과 이동 버튼 사용. 키보드 조작 유지 및 활성 순서 표시 45. |
| 22 | 미리보기에서 스캔 썸네일 선택 | Worklist → **Case Preview → Slides** · 관리자/병리의 · WS, UI | 형식과 짧은 원본 ID 식별이 있다. 선택 강조와 상세→Viewer 복귀 일관성 45·46. |
| 23 | Tray, WSI, 케이스 탭과 도구 레일 | `#viewer/{case}/{scan}` · 배정 병리의/관리자 · GR, WS, UI | 현재 왼쪽에 도구 레일, 헤더·영상 툴바에 여러 조작. 활성 스캔과 주요 조작 중심으로 46. |
| 24 | Label·Overview·미니맵·입력 설정 | Viewer → **Viewer Settings** · 뷰어 접근 역할 · WS | 가로/세로 Tray·단축키·Autopan 지원. 게임패드·커서 유형·성능 시험 버튼 미확인. 46에서 범위 표시. |
| 25 | 진단 기록 목록과 상세를 같은 영역에서 조회 | Viewer → **History** · 배정 병리의/관리자 · HI, UI | 출처·미설정/장애 확인 가능. 영상은 History 탭에서 숨겨지고 복귀 시 배율 유지. 46·48. |
| 26 | 첨부 PDF 열람 영역 | Viewer → **Media** · 배정 병리의/관리자 · MD | 손상·다중 페이지 확인. 같은 스캔 유지와 문서/이미지 액션을 48에서 정리. |
| 27 | Gross 사진과 탐색 | Viewer → **Gross Images** · 배정 병리의/관리자 · MD | 검체별 필터·등록과 감사를 제공. 선택 검체와 연결된 스캔 맥락 48. |
| 28 | OR 결과 게시·콜백·절제연 카드 | `#case/{case}/frozen` → `#or` · 병리의/승인 OR 수신자 · OR | 예비/정정 버전·ACK를 확인. 승인·확인·재확인 상태의 밀도와 강조 48. |
| 29 | Case Editor의 스캔 카드와 라벨 로딩 오류 | `#case/{case}/editor` · 접수/관리자 · IN | 라벨 재시도·수기 확정·QC 보류/교체 지원. 스캔 카드에 다음 조작 연결 45. |
| 30 | 사용자·행위·대상·결과 감사 팝업 | Viewer → **Case Logs** · 관리자/허가 사용자 · LG | 현재 문서 탭에 필터와 상세. Case Logs와 관리자 Account Audit Log를 구분해 안내 44·48. |
| 31 | ROI 미리보기, 장기계통, 검색 | **Annotations → Find Similar ROIs** → `#roi-search/{case}/{scan}/{roi}` · 주석 작성 가능 역할 · RO | 현재 로컬 참조 결과와 원본 복귀. 외부 서비스 상태를 분명히 표시 47. |
| 32 | 사건별 In-app·Email·Push | `#settings/notifications` 및 상단 **Notifications** · 로그인 사용자 · NT | 채널별 환경설정과 가용 상태 표시를 연결 48. 실제 전송 승인 환경은 대기. |
| 33 | 참여자별 색상·Presenter·Invite to follow | Viewer → **Collaborative Review** · 초대/참여 권한자 · CO | 현재 로컬 Follow/Drive·인계, 외부 Teams 대기. 현재 Driver·연결 상태·진입 표시 49. |
| 34 | 네 조직 영상과 개별 미니맵 | Viewer → **Multi View** · 같은 케이스 접근 역할 · MV | 최대 4 pane·수동 랜드마크. 활성 pane·동기화 상태 가시성 47. |
| 35 | 직선·다분절 거리 도구 | Viewer 왼쪽 **Distance Measurement / Multi-segment Distance** · 관리자/병리의 · MV, UI | 개별 아이콘과 그리기 안내 제공. 단위·완료 동작과 진행 중 도구 전환 47. |
| 36 | 오른쪽 주석 목록과 영상 내 도형 | Viewer → **Polygon ROI / Annotations** · 관리자/병리의 · MV, UI | 첫 점 닫기, 가이드·Undo, 저장 목록과 이름 수정 확인. 주석 선택·캔버스 피드백과 PNG 범위 47. |
| 37 | Viewer 내부 요청 팝업과 담당 선택 | Viewer → **Analysis** 또는 **Requests** → `#case/{case}/requests` · 관리자/병리의 · RQ, AX | 분석은 Viewer 안에 있고 자문은 케이스 주소로 이동. 활성 스캔을 유지하는 단일 진입 흐름 49·50. |
| 38 | 스캔 곁 Positive/Total 계수 패널 | Viewer 하단 **Lymph Node Count** → `#case/{case}/report` · 관리자/병리의 · MV, GR | Viewer에서 입력하고 보고에 참조한다. 계수·정정은 검체 단위이며 작업한 스캔을 기록한다. 표시 위치와 집계 단위를 47·48에서 명시. |
| 39 | Ki-67 세포 표식과 결과 카드 | Viewer → **IHC Results** · 관리자/배정 병리의 · IH | 승인된 합성 카드 및 셀 편집·복원. Viewer의 결과 접근과 오버레이 상태 통합 50. |
| 40 | PR 판정과 카드 | Viewer → **IHC Results** → PR 스캔 · 관리자/배정 병리의 · IH, API | PR 표시를 재확인. 수정/복원의 최신 브라우저 근거는 Ki-67, 공통 저장은 API. PR 전용 재계산 확인 방법 50. |
| 41 | HER2 패턴·Composite | Viewer → **IHC Results** → HER2 스캔 · 관리자/배정 병리의 · BM | 검증 자료에 연결된 Composite와 패턴을 제공. 계산 기준과 원본·수정본의 접근 50. |
| 42 | 같은 카드의 CPS/TPS 및 세포 클래스 | Viewer → PD-L1 결과·오버레이 · 관리자/배정 병리의 · BM | 두 점수 근거가 있는 조합만 표시. 적용 프로필과 미지원 이유를 50에서 노출. |
| 43 | 전립선 Core/Level 영역과 결과 | Viewer → **Prostate AI** · 관리자/배정 병리의 · PR | 계약에 포함된 Grade Group·길이·PNI와 좌표. 누락값·미계약 출력의 표시 50. |
| 44 | 피부 영역·결과 카드와 후보 | Viewer → **Skin Review** · 관리자/배정 병리의 · SK | 방향 표식·Heatmap·수기 확인 제공. 자동 회전은 미확인. 레이어·영역·후보 선택을 50에서 정리. |
| 45 | WSI 곁 Pap 후보 그리드·범주 | Viewer → **Pap Gallery** · 병리사/배정 병리의 · PG | 후보–스캔 일치·재접속 확인. 염색 정보 미입력 일반 스캔에서도 진입 버튼 노출 관찰. 맥락에 맞는 표시 50. |
| 46 | Pap 적절성·해석·미생물 입력 | Viewer → **Pap Review** · 1차/후속 검토 역할 · PA | 역할별 승인·반려와 용어 버전 제공. 후보와 결과 필드 사이 이동 및 현재 검토 단계 표시 50. |
| 47 | 연관 조직생검과 별도 WSI | Viewer/Cases → **Related Cases** → `#related-comparison/{link}` · 양쪽 열람 권한자 · RL | 두 독립 pane으로 비교. 각 환자·케이스·스캔의 맥락 표시와 복귀 50. |

기능 ID별 판정은 동작 43개, UI 차이 25개, 부분 지원 24개, 외부 확인 3개, 누락 1개다. UI 차이 항목에도 현재 동작하는 경로의 브라우저 근거를 남겼다. [기능별 판정](pdf-frontend-feature-matrix-43.md)

## 최신 브라우저에서 추가로 확인한 차이

- **Viewer 진입과 공간.** 합성 `IMS-DEMO-101`의 NDPI·SVS를 1440×900에서 각각 열었다. 헤더 버튼 7개와 이미지 툴바 버튼 12개가 노출됐다. 가로 페이지 넘침은 0px이었고 초기 화면에서 캔버스 하단은 y=971이었다. 390×844에서는 가로 넘침이 없었으며 캔버스 하단은 y=1575였다. 좁은 화면에서 헤더와 Tray 이후 영상에 도달하는 조작과 영상 가용 영역을 별도 측정한다. [1440px 캡처](../.runtime/workflow-43/43-viewer-1440.png) · [390px 캡처](../.runtime/workflow-43/43-viewer-390.png)
- **분석 경로와 적용 조건.** `Analysis` 탭과 영상의 `Analysis` 버튼은 같은 **Slide Analysis** 패널을 열었다. 염색이 **Not Entered**인 두 샘플에서 실행 방법 선택이 없었으나 **Pap Review**, **Pap Gallery**, **Skin Review**, **Prostate AI**가 모두 상단에 나타났다. **Requests**는 별도 케이스 탭으로 연결된다. 모델별 지원·보관 결과·실제 실행 여부를 활성 스캔 가까이에 표시하는 작업을 50번에 둔다. [브라우저 측정 원본](../.runtime/workflow-43/43-frontend-probe.json)
- **문서와 안전한 복귀.** Viewer에서 **History**를 열면 영상은 숨겨졌다. **Return to Slides**에서 동일 배율로 복귀했다. 42번의 케이스 문서 기능을 유지하면서 46·48에서 현재 스캔과 문서 출처의 가시성을 개선할 수 있다.
- **권한과 감사.** 관리자에게 Settings → Accounts → **Audit Log**가 표시됐다. 병리의가 `#settings/accounts` 주소로 접근할 때 화면에 권한 거부 안내가 표시됐고 계정 감사 API는 403을 반환했다. 케이스 접근 이력은 Viewer의 **Case Logs**에 있다. 44번에서 두 감사 경로의 목적과 진입 위치를 확인한다.
- **계수의 단위.** 시연에서 NDPI에 저장한 2/9가 같은 검체의 SVS에도 표시됐다. SVS에서 3/9로 정정한 뒤 보고 초안에서 새 버전을 선택했다. 화면은 스캔에서 열리지만 저장 이력은 검체 기준이며 수행한 스캔 ID를 기록한다. PDF 38쪽의 슬라이드별 입력 설명과 비교해 47·48번에 단위 표시와 정책 확인을 남겼다.
- **PDF 대비 잔여 범위.** 트리형 다중 컬렉션 선택, 게임패드/커서/성능 시험 설정, 현재 viewport 전체 캡처, 자동 정합·6 pane, 림프절 계수→Notes 자동 기록은 현재 대응 범위가 제한적이거나 확인되지 않았다. 외부 DICOM Metadata, Teams, 스캐너·LIS, 외부 AI·검색·알림은 기관·벤더 계약과 별도 승인 환경이 필요하다. 기능별 상태는 [96개 상세 대조표](pdf-frontend-feature-matrix-43.md)에 기록했다.

## 프런트 수정 우선순위

아래 순위는 이번 브라우저 관찰을 반영한 개발 제안이다. 번호는 [AGENTS.md](../AGENTS.md)의 개별 작업에 대응한다. PDF 8–9쪽 권고의 WSI·Worklist·LIS 및 CPS/TPS는 제품 요구로 따로 추적한다.

| 우선 | 작업 | 수정 범위 및 완료 판단 |
|---|---|---|
| P0 · 46 | Viewer 기본 탐색 | 활성 케이스·스캔, Tray와 줌·팬·미니맵 위계를 한 화면에서 읽히게 한다. 1440×900·390×844에서 첫 영상의 세로 위치와 보이는 영상 크기를 재고, NDPI/SVS 전환·타일 재시도·동일 스캔 복귀를 검증한다. |
| P0 · 50 | AI 실행 진입 | 같은 기능의 Analysis 진입점을 정리하고 스캔·염색별 실행/보관 결과/미지원 사유를 한 흐름으로 표시한다. 미입력 샘플과 지원 결과가 있는 샘플 각각에서 빈 상태·실패·결과 열기 조작 수를 잰다. Pap·피부·전립선 도구는 현재 스캔 맥락에 맞춰 진입하게 한다. |
| P0 · 44·45 | 역할별 Workspace와 접수·업무함 | 같은 업무함의 활성 표시, 필터·저장 View·열·미리보기, 접수→QC→스캔 선택을 연결한다. 관리자·병리의·병리사, EMR/LIS 미설정, 빈 결과·QC 보류 시나리오를 검증한다. |
| P1 · 47 | 주석·측정·비교 | Polygon과 다분절의 그리기 상태·완료 피드백, 선택 주석과 원본 WSI 복귀를 보강한다. 좌표·MPP·권한, ROI PNG 범위, 4 pane 동작, 검체 기준 계수의 원천 스캔 표시를 각각 검증한다. |
| P1 · 48 | 케이스 맥락·보고 | 문서·Notes·Case Logs의 케이스/스캔 맥락과 보고 근거·정정·전송 상태를 묶는다. 일반 및 Frozen에서 새 버전의 확인·콜백·감사까지 확인한다. |
| P2 · 49 | 협업·Tumor Board·자문 | 보드의 정확한 스캔·완료 결과 진입, 참여자·진행권·재접속, 실패 상태를 정리한다. 외부 연결은 계약 검증과 분리한다. |
| 최종 · 51 | 통합 검증 | 43번과 같은 시나리오에서 단계를 재검증하고 시간·조작·전환·오류·복구를 비교한다. |

정합 자동화, 장비·벤더 연결, 모델 임상 승인, 계수→Notes 기록 정책에는 별도 계약·데이터·사용자 결정이 필요하다. 이번 검토에서 모델 산출·환자 매칭·보고 전송 정책은 확정하지 않았다.

## 재현

Node 22.12.0, Python 3.10.20, PostgreSQL 18.6, Chromium 146 계열을 사용했다. 동일 서버의 루프백에서 합성 사례·임시 PostgreSQL·로컬 NDPI/SVS로 실행한다. Playwright 의존성 설치는 [10번 준비 방법](integration-demo-10.md)을 따른다.

```bash
export MEDIAUTO_WORKFLOW_EVIDENCE_DIR="$PWD/.runtime/workflow-43"
mkdir -p "$MEDIAUTO_WORKFLOW_EVIDENCE_DIR"
MEDIAUTO_DEMO_PORT=19973 scripts/verify-integration.sh > "$MEDIAUTO_WORKFLOW_EVIDENCE_DIR/run.log" 2>&1

# 역할별 워크플로우를 독립적으로 다시 실행
MEDIAUTO_DEMO_PORT=19973 scripts/verify-integration.sh --demo general
# 시연명: general, frozen, tumor-board, ihc, pap, collaboration

# 화면 조작을 직접 비교할 합성 세션
MEDIAUTO_DEMO_PORT=19974 scripts/verify-integration.sh --manual
```

| 비교 대상 | 직접 재현할 조작 |
|---|---|
| Workspace·권한 · 44·45 | 시연용 관리자 로그인 → **My Cases → Intake → Worklist**로 이동하며 활성 URL을 확인한다. **Account Management → Audit Log**를 연 뒤 브라우저를 분리해 시연용 병리의로 동일 주소에 접근하면 권한 거부 문구가 나타난다. |
| WSI·분석 · 46·50 | `IMS-DEMO-101` 검색 → **Case Details → Open Viewer** → Tray에서 NDPI·SVS를 각각 선택한다. 1440×900과 390×844에서 페이지 가로 넘침과 영상 하단을 확인한다. 상단 탭과 영상 툴바의 **Analysis**를 각각 열어 같은 패널과 지원 방법을 비교한다. **History → Return to Slides**에서 배율을 비교한다. |
| 판독 도구 · 47 | **Polygon ROI** → 세 점 입력 → 열린 윤곽과 가이드 확인 → 첫 점 클릭 또는 **Close Polygon** → 이름·저장 → 새로고침 후 **Annotations** 재열기. 교차 폴리곤·Backspace, NDPI/SVS 분리 및 ROI Export는 `viewer-workflow-browser.mjs`에서 재현한다. |
| 보고·공동 판독·AI·Pap · 48–50 | `--demo`를 선택해 해당 픽스처를 생성한다. [42번 독립 시연](workflow-verification-42.md#독립-시연)의 역할별 조작을 사용하고, 43번 화면표에서 이때 열리는 실제 현재 탭과 주소를 대조한다. |

## 실행 결과

- **PASS** · `scripts/verify-integration.sh`에서 TypeScript/Vite 빌드, Alembic 스키마 검증, Python 59개와 Chromium 브라우저 시나리오 28개 완료. 일반·Frozen·Tumor Board·IHC·Pap·공동 판독 근거를 수집했다. [전체 실행 로그](../.runtime/workflow-43/run.log)
- **PASS** · 임시 합성 브라우저의 추가 관찰에서 NDPI/SVS·390px, 두 Analysis 진입점, 문서 복귀 배율, Account Audit Log 및 병리의 접근 403을 확인했다. 첫 실행은 접근 거부 화면의 Settings 제목을 기다리는 검증 선택자에서 실패했다. 실제 권한 거부 문구·API 상태를 확인하도록 선택자를 수정해 재실행했다.
- 일반 경로에서 케이스 상세→첫 슬라이드 371ms, NDPI→SVS 366ms, 휠 줌 36ms, 팬 77ms였다. 관리자 9회·화면 전환 2회, 배정 병리의 24회·전환 3회이며 정상 경로 오류·재시도는 0회였다. 합성 자동화 측정치로 사용한다. 역할별 근거는 `.runtime/workflow-43/`의 JSON과 캡처에 있다.
- **NOT RUN** · 운영 기관 장비·외부 서비스·실제 임상 사용자 검토, 게임패드, 자동 정합·6분할, 모델별 임상 판정 정확도. 운영 DB·릴리스·마이그레이션 변경 없이 문서와 검토 근거를 기록했다.
