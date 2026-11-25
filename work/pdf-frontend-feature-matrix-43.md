# 43. PDF 기능 ID 96개와 현재 프런트엔드

PDF 9–12쪽 §8의 ID를 원문에서 추출해 [42번 대조표](workflow-feature-matrix-42.md)의 집합과 비교했다. 화면 34개, 정확한 진입 주소, 우선순위와 재현 순서는 [43번 전체 검토](pdf-frontend-review-43.md)에 있다. 42번 판정은 당시 구현 검증 상태이며 43번 판정은 현재 사용자 화면과 남은 업무 범위 기준이다. 여러 ID가 하나의 E2E 경로를 공유한다. SRC는 코드·계약 확인이고 해당 항목을 별도 브라우저 조작으로 검증한 증거가 아니다. 외부 시험과 실제 임상 사용자 평가는 대기 상태다.

| 판정 | 기준 |
|---|---|
| 동작 | 대응 흐름을 현재 브라우저 또는 표시한 API 근거로 확인했다. PDF의 전체 조작을 글자 그대로 재현했다는 의미는 없다. |
| UI 차이 | 기능 경로는 있으며 진입·배치·조작에 후속 프런트 개선이 필요하다. |
| 부분 | 로컬 또는 일부 경로만 확인했다. 지원하지 않는 조작이나 데이터 범위가 있다. |
| 누락 | 요구한 대응 동작을 현 앱에서 확인하지 못했다. |
| 외부 | 운영기관·장비·벤더·규제 근거가 있어야 확인할 수 있다. |

| 기능 ID | PDF 기능 | 42번 판정 | 43번 판정·근거 | 현 상태 및 수정 방향 | 후속 |
|---|---|---|---|---|---|
| IMS-F001 | 이미지 관리 시스템·뷰어·저장 | 부분 · 해당 범위 PASS | 부분 · IN, GR | 로컬 업로드·열람·저장 상태가 있다. 기관 스토리지 보존·PACS는 별도. | 45·46·41 |
| IMS-F002 | Image Optimization & Acquisition | 부분 · 해당 범위 PASS | 부분 · IN | 수기와 재스캔·교체 흐름이 있다. 실제 스캐너 획득과 장비 QC는 별도. | 45·41 |
| IMS-F003 | Data Curation & AI Algorithms | 부분 · 해당 범위 PASS | 부분 · RQ, IH, BM, PG | 버전 있는 보관 결과·검토를 제공한다. 큐레이션과 실제 임상 모델이 필요하다. | 50·41 |
| IMS-F004 | 3rd Party AI Algorithms | 부분 · 해당 범위 PASS | 외부 · RO, RQ | 로컬 ROI 검색·보관 결과 실행을 확인한다. 외부 추론/검색의 서비스 상태를 명시한다. | 47·50·41 |
| IMS-F005 | Reporting & LIS Integration | 부분 · 해당 범위 PASS | 부분 · GR, OR | 작성·승인·정정 및 Mock ACK가 있다. 실기관 전달과 실제 수락 절차는 별도. | 48·41 |
| IMS-F006 | Custom Workflow & AI Tools | 있음 · PASS | 동작 · WL, WG, RQ, MV | 저장 View·업무함·요청·그리기 도구를 각각 열 수 있다. | 45·47·50 |
| IMS-F007 | Compliance CE, HIPAA, GDPR, ISO, SOC 2 | 미확인 · NOT RUN | 외부 · — | 역할·감사 회귀는 존재한다. 규제·표준·보존 적합성은 제품 근거와 기관 심사가 필요하다. | 41 |
| IMS-F001-01 | Worklist | 있음 · PASS | UI 차이 · WL, GR, UI | 왼쪽 Worklist와 상단 All Cases에서 같은 목록을 연다. 현재 업무함 강조를 통일한다. | 44·45 |
| IMS-F001-02 | Cases / Scans | 있음 · PASS | UI 차이 · IN | 상단 Slide Registration과 왼쪽 Intake가 같은 접수 화면을 연다. 접수 후 케이스 복귀를 정리한다. | 45 |
| IMS-F001-03 | Assigned to: [user] (me) | 있음 · PASS | 동작 · GR, WL | My Cases/Assigned to Me에서 배정 범위와 활성 상태를 확인한다. | 44·45 |
| IMS-F001-04 | Last opened | 있음 · PASS | UI 차이 · WL, API | 최근 열람은 More Filters 및 선택 열 안에 있다. 개인별 최근 활동 진입을 정리한다. | 45 |
| IMS-F001-05 | Time since / Date range | 있음 · PASS | 부분 · WL, SRC | Unopened/Today/Last 2 Days/Last 7 Days는 UI에 있다. 날짜 범위는 별도 필드이며 상대기간 옵션별 경계 E2E는 미확인. | 45 |
| IMS-F001-06 | Collections | 있음 · PASS | 동작 · BO, WG | 개인·공유 컬렉션을 열고 표시 계층의 차이는 F001-21에서 다룬다. | 49 |
| IMS-F001-07 | Global views | 있음 · PASS | UI 차이 · WG | Global Views 및 Frozen 바로가기가 있다. 활성 필터와 업무함 출처를 함께 표시한다. | 45 |
| IMS-F001-08 | Toolbar | 있음 · PASS | UI 차이 · WL, RQ | View·정렬·컬럼·필터가 여러 줄에 분산된다. 자주 쓰는 동작을 같은 조작 영역에 배치한다. | 45 |
| IMS-F001-09 | 분야별 뷰 복수 선택 UI | 있음 · PASS | 부분 · WG, WL, SRC | Workgroup·Priority와 상세조건은 조합된다. PDF의 트리 내 분야 복수 선택 UI는 확인되지 않았다. | 45 |
| IMS-F001-10 | Slide status 표시 | 있음 · PASS | UI 차이 · WL, IN | 스캔 수·QC 상태 및 개별 스캔이 있다. 여러 스캔의 상태를 행/미리보기에서 빠르게 구분한다. | 45 |
| IMS-F001-11 | LIS case status 표시 | 부분 · 해당 범위 PASS | 부분 · WL, API | 로컬 Review Status와 LIS Case Status를 구분한다. 실제 기관 값은 연동 환경에서 재검증한다. | 45·41 |
| IMS-F001-12 | 케이스 정렬 표시 | 있음 · PASS | 동작 · WL | 열의 정렬 방향 및 다단계 정렬 반영을 확인한다. | 45 |
| IMS-F001-13 | More filters 목록 | 있음 · PASS | UI 차이 · WL | More Filters에 필드별 그룹과 출처가 있다. 화면 밀도와 조건 찾기를 정리한다. | 45 |
| IMS-F001-14 | Age at collection 범위 UI | 있음 · PASS | 동작 · WL | 채취일 기준 연령 범위와 누락 데이터 구분이 있다. | 45 |
| IMS-F001-15 | 조건 적용 시 목록 갱신 | 있음 · PASS | 동작 · WL | 적용한 조건 칩과 목록 갱신이 관찰된다. | 45 |
| IMS-F001-16 | 빈 검색 결과 안내 | 있음 · PASS | 동작 · WL, GR | 결과 없음과 검색 조건 수정으로 복귀한다. | 45 |
| IMS-F001-17 | Custom View 생성 | 있음 · PASS | 동작 · WL | Save New View로 이름을 정해 저장·복원한다. | 45 |
| IMS-F001-18 | 뷰 저장 범위 | 있음 · PASS | 동작 · WL | 개인/조직 저장 범위와 조직 공유 권한을 검증한다. | 44·45 |
| IMS-F001-19 | 컬럼 상태 포함 저장 | 있음 · PASS | 동작 · WL | Include current columns 선택을 제공한다. | 45 |
| IMS-F001-20 | 개인·공유 컬렉션 | 있음 · PASS | 동작 · BO | 개인·공유 목록의 접근 권한 차이를 검증한다. | 49 |
| IMS-F001-21 | 컬렉션 선택 | 부분 · 해당 범위 PASS | 부분 · BO, SRC | 추가 폼은 개별 컬렉션/회차를 선택한다. 검색 가능한 계층형 다중 선택은 확인되지 않았다. | 49 |
| IMS-F001-22 | Tumor Board 컬렉션에 케이스 추가 | 있음 · PASS | 동작 · BO | Worklist Case Preview에서 안건 참조를 추가한다. | 49 |
| IMS-F001-23 | Collection note | 있음 · PASS | 동작 · BO | 안건 추가 및 회차에서 메모를 조회·수정한다. | 49 |
| IMS-F001-24 | Frozen Section 분류 목록 | 있음 · PASS | UI 차이 · OR, WG | Frozen 케이스를 업무함에서 열 수 있다. 전용 보고 진입과 우선순위 출처를 함께 확인한다. | 45·48 |
| IMS-F001-25 | Worklist 컬럼 표시 설정 | 있음 · PASS | 동작 · WL | Columns에서 필드 검색, 표시·숨김을 사용할 수 있다. | 45 |
| IMS-F001-26 | 컬럼 순서 UI | 있음 · PASS | UI 차이 · WL | 열 재정렬은 Up/Down으로 동작한다. PDF의 드래그 조작과 키보드 대체 경로를 같이 검토한다. | 45 |
| IMS-F001-27 | 뷰 저장 컬럼 표시 | 있음 · PASS | 동작 · WL | 저장 View의 컬럼 설정을 불러오거나 해제한다. | 45 |
| IMS-F001-28 | 다중 정렬 우선순위 | 있음 · PASS | UI 차이 · WL | 다단계 정렬은 필드·방향 선택 및 이동 버튼 방식이다. 현재 적용 순서를 강조한다. | 45 |
| IMS-F001-29 | 정렬 기본값 복원 | 있음 · PASS | 동작 · WL | 기본 정렬·Worklist 복원 동작이 있다. | 45 |
| IMS-F001-30 | 슬라이드 썸네일 패널 | 있음 · PASS | UI 차이 · WS | 썸네일과 NDPI/SVS·짧은 ID로 원본을 구분한다. 미리보기 선택 상태와 Viewer 복귀를 정리한다. | 45·46 |
| IMS-F001-31 | 추가 업무 정보 | 부분 · 해당 범위 PASS | 부분 · WL, RQ, NT | Storage Status·Tags·Requests·Case Notes 후보 열이 있다. 기관 아카이브 값은 확인되지 않았다. | 45·41 |
| IMS-F002-01 | Worklist→WSI Viewer 전환 | 있음 · PASS | 동작 · WS, GR | 미리보기에서 정확한 스캔 UUID로 Viewer를 연다. | 46 |
| IMS-F002-02 | H&E WSI 화면 표시 | 있음 · PASS | 동작 · GR, WS | NDPI·SVS 타일을 열고 줌·팬과 재시도를 확인한다. | 46 |
| IMS-F002-03 | 좌측 슬라이드 탐색 패널 | 있음 · PASS | 동작 · WS | Tray에서 활성 스캔과 다른 스캔을 식별한다. | 46 |
| IMS-F002-04 | 전체 이미지 Overview | 있음 · PASS | 동작 · WS | Overview와 미니맵을 각각 표시하고 위치 이동을 제공한다. | 46 |
| IMS-F002-05 | 배율 및 스케일 표시 | 있음 · PASS | 동작 · WS, MV | 줌과 스케일바가 있다. 물리 단위 표시는 MPP 지원에 따른다. | 46·47 |
| IMS-F002-06 | 케이스 관련 상단 탭 | 있음 · PASS | UI 차이 · WS, HI, MD, LG, UI | Slides/History/Media/Gross Images/Notes/Case Logs 탭이 있다. 문서 탭에서 영상은 숨겨지고 복귀 시 위치가 유지된다. | 46·48 |
| IMS-F002-07 | 도구 바로가기 | 있음 · PASS | UI 차이 · WS, UI | Viewer 왼쪽에 별도 도구 아이콘이 있다. 도구 모드와 진입 맥락을 정리한다. | 46·47 |
| IMS-F002-08 | 슬라이드 간 이미지 조회 | 있음 · PASS | 동작 · WS, GR | 같은 표시 번호의 서로 다른 형식까지 구분해 전환한다. | 46 |
| IMS-F002-09 | 썸네일 스트립 / 타일형 슬라이드 갤러리 | 있음 · PASS | 동작 · WS | Tray 가로/세로 및 Gallery 전환을 확인한다. | 46 |
| IMS-F002-10 | Slide viewer settings | 있음 · PASS | 부분 · WS, SRC | Label/Overview·미니맵 설정을 복원한다. 게임패드·커서 유형·성능 시험의 사용자 UI는 미확인. | 46 |
| IMS-F002-11 | Pathology 탭의 병리 기록 | 있음 · PASS | UI 차이 · HI | 병리 기록은 독립 Pathology 탭 대신 History 흐름에서 조회한다. | 48 |
| IMS-F002-12 | History 및 진단 기록 검색/조회 | 있음 · PASS | UI 차이 · HI, UI | History에서 진단/진료 기록 및 원천을 확인한다. 영상 복귀와 기록 탐색을 연결한다. | 48 |
| IMS-F002-13 | Media 첨부문서 열람 | 있음 · PASS | 동작 · MD | Media에서 PDF 열람·페이지·손상 복구를 확인한다. | 48 |
| IMS-F002-14 | Gross images | 있음 · PASS | 동작 · MD | 검체별 Gross 사진 필터·등록·열람을 확인한다. | 48 |
| IMS-F002-15 | Quality 우측 패널 | 있음 · PASS | UI 차이 · IN | QC·라벨은 현재 Case Editor 중심이다. 실패→수기 확인/재스캔 조작을 스캔에 붙인다. | 45 |
| IMS-F002-16 | OR view A 결과 카드 | 있음 · PASS | 동작 · OR | OR 카드의 공개/정정 결과, 확인과 재확인을 검증한다. | 48 |
| IMS-F002-17 | Case editor / 슬라이드 메타데이터 | 있음 · PASS | UI 차이 · IN | 케이스 상세와 Viewer에서 Editor로 이동한다. 스캔 카드·복귀의 경로를 정리한다. | 45 |
| IMS-F002-18 | Case logs | 있음 · PASS | UI 차이 · LG, GR, OR | 케이스 이력은 문서 탭, 계정 감사는 Accounts 설정에서 접근한다. | 44·48 |
| IMS-F002-19 | Case details / DICOM Metadata | 미확인 · NOT RUN | 외부 · SRC | OpenSlide 및 입력 메타데이터를 제공한다. 기관 DICOM Metadata 뷰와 연동은 확인되지 않았다. | 45·41 |
| IMS-F002-20 | Aignostics PathoSearch | 부분 · 해당 범위 PASS | 부분 · RO | Find Similar ROIs로 로컬 검색과 원본 복귀가 동작한다. Aignostics 운영 연결은 미검증. | 47·41 |
| IMS-F002-21 | Requests 상태 및 생성 UI | 있음 · PASS | UI 차이 · RQ, AX | Requests는 케이스 한 탭, 분석 실행은 Viewer 패널과 연결된다. 유형·대상·복귀를 정리한다. | 49·50 |
| IMS-F002-22 | Notes / Comments | 있음 · PASS | 동작 · NT | Notes·댓글·멘션이 케이스에 귀속된다. | 48 |
| IMS-F002-23 | Notifications | 있음 · PASS | 동작 · NT | 상단 알림 센터에서 앱 내부 사건을 확인한다. | 48 |
| IMS-F002-24 | Notification preferences | 부분 · 해당 범위 PASS | 부분 · NT | 환경설정에 채널과 사건이 있다. 승인된 외부 Email/Push 전달은 미검증. | 48·41 |
| IMS-F002-25 | Viewer 공동 참여자 표시 | 있음 · PASS | UI 차이 · CO | Collaborative Review 아이콘으로 참여자 목록을 연다. 접속 상태와 참여자 발견 가능성을 높인다. | 49 |
| IMS-F002-26 | 발표자 표시 / Invite to follow | 있음 · PASS | 부분 · CO | 로컬 Follow/Drive, 인계와 재접속을 확인한다. Teams 운영 환경은 대기. | 49·41 |
| IMS-F002-27 | 전체 화면·단축키·Autopan 탐색 | 있음 · PASS | 동작 · WS | 전체화면·단축키·Autopan 기능과 사용자 설정 복원을 확인한다. | 46 |
| IMS-F002-28 | 다중 WSI 동시 비교 화면 | 있음 · PASS | 동작 · MV | 4개 pane, 활성 pane, 동기화/정확한 스캔 표시를 검증한다. | 47 |
| IMS-F002-29 | WSI co-registration, 정렬 | 부분 · 해당 범위 PASS | 부분 · MV | 수동 랜드마크 및 잔차를 보여준다. 6 pane·자동 정합은 지원 근거가 없다. | 47 |
| IMS-F002-30 | Point/Arrow 등 주석 도구 | 있음 · PASS | UI 차이 · MV, UI | Point/Arrow를 드롭다운 없이 선택한다. 선택 상태와 그림 조작을 인지하게 한다. | 47 |
| IMS-F002-31 | Ruler/다분절 길이 측정 | 있음 · PASS | 동작 · MV | 직선과 다분절 측정이 저장되고 MPP 기준 길이를 재현한다. | 47 |
| IMS-F002-32 | 도형·브러시·ROI 및 카운트 | 있음 · PASS | 동작 · MV, UI | Polygon 열린 가이드·첫 점 닫기·되돌리기·교차 거부·재접속 확인. | 47 |
| IMS-F002-33 | Annotation 목록·북마크·프리셋 | 있음 · PASS | 동작 · MV | Annotations 오른쪽 목록, 정렬, 북마크·프리셋을 제공한다. | 47 |
| IMS-F002-34 | Viewer 현재 화면 이미지 내보내기 | 있음 · PASS | 부분 · MV, SRC | 주석 선택 기반 ROI PNG와 주석/스케일 옵션이 있다. 현재 전체 viewport 내보내기는 확인되지 않았다. | 47 |
| IMS-F002-35 | Viewer 에서 Request 생성 | 있음 · PASS | UI 차이 · RQ, AX | Analysis 배치와 Requests 이동이 각각 있다. 같은 스캔의 새 요청/결과 복귀 경로를 정리한다. | 49·50 |
| IMS-F002-36 | Lymph node count 패널 | 있음 · PASS | UI 차이 · MV | Lymph Node Count는 영상 아래 접이식 패널이다. 스캔 가까이에 진입과 상태를 제공한다. | 47·48 |
| IMS-F002-37 | 슬라이드별 림프절 계수 | 있음 · PASS | 부분 · MV, SRC | 계수 이력은 검체 기준이고 작업한 스캔을 기록한다. 같은 검체의 NDPI/SVS는 같은 계수를 표시하므로 스캔별 독립 집계와 범위가 다르다. | 47·48 |
| IMS-F002-38 | 림프절 계수 집계 및 보고 활용 | 있음 · PASS | 부분 · MV, GR | 보고 근거 참조를 검증한다. 기관 LIS 자동 전송은 별도 검증 범위다. | 48·41 |
| IMS-F002-39 | 계수 결과 Notes 연계 | 미확인 · NOT RUN | 누락 · SRC | 계수의 Notes 자동 기록이 확인되지 않았다. 43번에서는 기존 보고 참조와 정책 요구를 기록한다. | 48 |
| IMS-F003-01 | 외부 AI 결과를 IMS Viewer에 직접 오버레이 표시 | 부분 · 해당 범위 PASS | 부분 · IH, BM, RQ | 보관 결과 오버레이와 이력을 제공한다. 실기관 외부 AI 결과 자동 입수는 미검증. | 50·41 |
| IMS-F003-02 | Ki-67 AI 양성/음성 세포 분류 및 ROI/비율 표시 | 있음 · PASS | 동작 · IH | Ki-67 세포·결과 카드와 기준 집계를 확인한다. | 50 |
| IMS-F003-03 | AI 판정 양성 임계값 조절과 결과 재계산 | 있음 · PASS | 동작 · IH | 임계값·수기 판정을 수정·저장하고 원본을 복원한다. | 50 |
| IMS-F003-04 | PR·ER 면역염색 양성도 시각화 및 threshold 초기화 | 있음 · PASS | 부분 · IH | ER/PR 표시와 승인 제한, 공통 저장 API를 확인한다. PR 전용 수정·복원 E2E 범위는 남는다. | 50 |
| IMS-F003-05 | HER2 다중 염색 패턴·종합 점수 | 있음 · PASS | 동작 · BM | HER2 패턴·Composite 점수의 검증 자료 연결과 회수를 확인한다. | 50 |
| IMS-F003-06 | PD-L1 AI 다색 시각화 및 CPS/TPS 결과 | 부분 · 해당 범위 PASS | 부분 · BM | 근거 있는 CPS/TPS만 표시한다. 기관 검체·암종별 임상 적용과 동시 사용은 별도 검증. | 50·41 |
| IMS-F003-07 | 전립선 AI 결과 패널 및 코어별 영역 표시 | 있음 · PASS | 동작 · PR | 전립선 Core 영역과 위치 선택이 WSI에 연결된다. | 50 |
| IMS-F003-08 | 전립선 조직 코어·레벨 단위 AI 결과 | 있음 · PASS | 동작 · PR | Core/Level 계층과 모델·분석 버전이 표시된다. | 50 |
| IMS-F003-09 | Gleason/Grade Group, 종양 영역, PNI/cribriform 등 출력 | 부분 · 해당 범위 PASS | 부분 · PR, SRC | 계약 내 Grade Group·길이·PNI를 표시한다. cribriform과 비계약 출력은 별도. | 50·41 |
| IMS-F003-10 | 피부 조직 표피 방향 AI 회전 | 부분 · 해당 범위 PASS | 부분 · SK, SRC | 표피 방향 표식이 표시된다. 영상 자동 회전은 확인되지 않았다. | 50 |
| IMS-F003-11 | 흑색종 유사분열 후보 AI 검출 | 부분 · 해당 범위 PASS | 부분 · SK | 보관 후보 선택·확정/반려가 있다. 실제 검출기 성능 검증은 별도. | 50·41 |
| IMS-F003-12 | 유사분열 밀도 Heatmap | 있음 · PASS | 동작 · SK | Heatmap·영역·후보 밀도를 보정 근거와 함께 표시한다. | 50 |
| IMS-F003-13 | 지정 면적 수동 유사분열 계수 | 있음 · PASS | 동작 · SK | 지정 면적 수기 계수·이력·수기 전용 상태를 검증한다. | 50 |
| IMS-F003-14 | Pap smear 세포검사 AI | 부분 · 해당 범위 PASS | 부분 · PG | 보관된 Pap 후보를 연동한다. 실제 영상 모델의 장비 입력·성능은 미검증. | 50·41 |
| IMS-F003-15 | Pap AI 세포 후보 갤러리/범주별 탐색 | 있음 · PASS | UI 차이 · PG, UI | 갤러리의 범주별 후보·좌표·복원은 동작한다. Pap 적용 가능 상태를 입구에서 표시한다. | 50 |
| IMS-F003-16 | Pap 검사 결과 입력 UI | 있음 · PASS | UI 차이 · PA | 적절성·해석·미생물은 별도 Pap Review 도구에서 연다. 후보 위치와 검토 단계 유지가 목표다. | 50 |
| IMS-F003-17 | 세포검사 리뷰 완료 및 상태 표시 | 있음 · PASS | 동작 · PA | 제출·반려·완료·재개와 감사 및 용어 버전이 있다. | 50 |
| IMS-F003-18 | Pap–biopsy correlation | 있음 · PASS | 동작 · RL | 양쪽 접근 권한을 확인한 뒤 독립 WSI pane으로 비교한다. | 50 |
| IMS-F003-19 | Cytotechnologist 1 차·병리과 의사 2 차 검토 | 있음 · PASS | 동작 · PA | 1차·후속 검토자 범위, 권한 회수, 대체 참여를 확인한다. | 50 |

## 브라우저 시나리오와 역할별 진입

일반 검증 스크립트에서 같은 시나리오가 실행된다. UI는 최신 화면 추가 관찰, SRC는 화면 컴포넌트·경로·계약 검토, API는 백엔드 회귀다. 합성 시연은 [43번 재현 절차](pdf-frontend-review-43.md#재현)를 따른다.

| 근거 | 진입·역할 | 실행 스크립트 또는 기록 |
|---|---|---|
| IN | `#scans` → `#case/{case}/editor` · 접수/관리자 | [case-editor](../scripts/case-editor-browser.mjs) |
| WL | `#worklist/all` 및 `#worklist/mine` · 관리자/병리의 | [worklist-views](../scripts/worklist-views-browser.mjs) |
| WG | `#settings/groups` → Worklist **Global Views** · 관리자/그룹 병리의 | [workgroups](../scripts/workgroups-browser.mjs) |
| GR | `#worklist/all` → 케이스/Viewer/Report · 접수 관리자/병리의 | [integration](../scripts/integration-browser.mjs), [case-report](../scripts/case-report-browser.mjs) |
| WS | `#viewer/{case}/{scan}` → **Viewer Settings** · 뷰어 접근 역할 | [viewer-preferences](../scripts/viewer-preferences-browser.mjs), [workspace-layout](../scripts/workspace-layout-browser.mjs) |
| HI | 케이스 또는 Viewer → **History** · 배정 병리의/관리자 | [patient-history](../scripts/patient-history-browser.mjs) |
| MD | 케이스 또는 Viewer → **Media / Gross Images** · 배정 병리의/관리자 | [case-attachments](../scripts/case-attachments-browser.mjs) |
| OR | `#case/{case}/frozen` → `#or` · 병리의/승인 OR 수신자 | [frozen-workflow](../scripts/frozen-workflow-browser.mjs) |
| LG | Viewer → **Case Logs** · 관리자/허가 사용자 | [case-logs](../scripts/case-logs-browser.mjs) |
| RO | Viewer → **Annotations → Find Similar ROIs** · 주석 작성 가능 역할 | [roi-search](../scripts/roi-search-browser.mjs) |
| RQ | `#case/{case}/requests` / `#request/{request}` · 병리의/관리자/자문 담당자 | [case-requests](../scripts/case-requests-browser.mjs), [analysis-execution](../scripts/analysis-execution-browser.mjs) |
| NT | **Notifications** → `#settings/notifications` · 로그인 사용자 | [notifications](../scripts/notifications-browser.mjs) |
| CO | Viewer → **Collaborative Review** · 운영자/초대된 병리의 | [collaborative-review](../scripts/collaborative-review-browser.mjs) |
| MV | Viewer → **Review Tools / Annotations / Multi View** · 주석 권한 또는 뷰어 접근 역할 | [multi-view](../scripts/multi-view-browser.mjs), [viewer-workflow](../scripts/viewer-workflow-browser.mjs) |
| BO | `#collections` 및 Worklist 미리보기 · 보드 준비자/참석자 | [case-collections](../scripts/case-collections-browser.mjs) |
| IH | Viewer → **IHC Results** · 관리자/배정 병리의 | [ihc-results](../scripts/ihc-results-browser.mjs) |
| BM | Viewer → HER2·PD-L1 결과 · 관리자/배정 병리의 | [biomarker-evidence](../scripts/biomarker-evidence-browser.mjs) |
| PR | Viewer → **Prostate AI** · 관리자/배정 병리의 | [prostate-results](../scripts/prostate-results-browser.mjs) |
| SK | Viewer → **Skin Review** · 관리자/배정 병리의 | [skin-review](../scripts/skin-review-browser.mjs) |
| PG | Viewer → **Pap Gallery** · 병리사/배정 병리의 | [pap-gallery](../scripts/pap-gallery-browser.mjs) |
| PA | `#settings/pap`, Viewer → **Pap Review** · 설정 관리자/1차·후속 검토자 | [pap-review](../scripts/pap-review-browser.mjs) |
| RL | Viewer → **Related Cases** → 비교 · 양쪽 케이스 접근 역할 | [related-cases](../scripts/related-cases-browser.mjs) |
| AX | Viewer → **Analysis** · 관리자/배정 병리의 | [analysis-execution](../scripts/analysis-execution-browser.mjs) |
| UI | Workspace, Accounts, 일반 스캔의 Viewer · 관리자/병리의 | [현재 화면 관찰과 재현](pdf-frontend-review-43.md#최신-브라우저에서-추가로-확인한-차이) |
| SRC | 화면·설정·계약 검토 | [프런트 소스](../frontend/src/) · [기관 연동 계약](institution-integration-41.md) |
| API | 스캔·환자·케이스 접근과 검증 정책 | [임상 API 회귀](../backend/tests/test_clinical.py) |
