# 42. PDF 화면·기능별 통합 검증 대조표

대상은 [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)의 화면 34개와 §8의 기능 ID 96개다. 검증 환경·독립 시연·측정치는 [42번 통합 검증 기록](workflow-verification-42.md)에 있다.

코드/E2E의 **PASS**는 합성 자료로 실행한 브라우저 시나리오 또는 별도 표시한 백엔드 회귀에서 관찰한 동작이다. **부분**은 대응 동작과 남은 범위가 함께 있는 항목이다. 모든 항목의 기관·임상 사용자 확인은 **NOT RUN**이다. 필요한 기관 접속·장비·자료는 [41번 계약 및 수락 시험](institution-integration-41.md)에 연결했다.

## 34개 화면

| 화면 | PDF 쪽 | 이번 검증 관찰 | 코드/E2E 근거 |
|---|---:|---|---|
| 01 | 14 | Worklist 환자·검체·슬라이드와 데이터 출처 | WL, IN |
| 02 | 15 | 고급 필터, 적용한 조건 및 보기 | WL |
| 03 | 16 | 채취일 기준 연령 범위와 빈 결과 | WL |
| 04 | 17 | 저장 View, 개인/공유 및 열 저장 | WL |
| 05 | 18 | Frozen과 우선순위 업무함 | WG, OR |
| 06 | 19 | Tumor Board 안건 참조·메모 | BO |
| 07 | 20 | 열 표시·순서 및 세션 복원 | WL |
| 08 | 21 | 다단계 정렬과 기본값 적용 | WL |
| 09 | 22 | Worklist 미리보기에서 정확한 스캔 선택 | WS |
| 10 | 23 | WSI 진입, NDPI/SVS·기본 탐색 | GR, WS |
| 11 | 24 | 라벨·Overview·미니맵과 설정 | WS |
| 12 | 25 | 환자 History·진단/진료 맥락과 출처 | HI |
| 13 | 26 | 첨부 PDF 업로드·페이지·오류 | MD |
| 14 | 27 | 검체별 Gross 이미지 | MD |
| 15 | 28 | OR 결과, 합성 콜백과 정정 | OR |
| 16 | 29 | Case editor·라벨 오류·환자 대조·QC | IN |
| 17 | 30 | 열람·변경·실패 필터와 감사 | LG, GR, OR |
| 18 | 31 | 로컬 ROI 검색·결과에서 WSI 복귀. 외부 서비스 대기 | RO |
| 19 | 32 | 알림 선택·인앱 및 외부 전송 상태. 실제 외부 전송 대기 | NT |
| 20 | 33 | 참여·Follow/Drive·복구. Teams 대기 | CO |
| 21 | 34 | 4 pane과 수동 랜드마크 잔차. 자동 6개 정합 미확인 | MV |
| 22 | 35 | 다분절 길이·보정 | MV |
| 23 | 36 | 주석 편집·ROI·북마크·프리셋 | MV |
| 24 | 37 | AI/자문 요청·담당·작업·실패·재실행 | RQ |
| 25 | 38 | 림프절 Positive/Total·정정·보고 참조 | MV |
| 26 | 39 | Ki-67 결과·셀 오버레이 | IH |
| 27 | 40 | ER/PR 표시·승인 제한, 공통 수정 저장 경로 | IH |
| 28 | 41 | HER2 패턴·Composite와 원본 | BM |
| 29 | 42 | PD-L1 CPS/TPS 계약·근거, 조합 제한. 임상 검증 대기 | BM |
| 30 | 43 | 전립선 Core/Level·길이·Grade Group·PNI | PR |
| 31 | 44 | 피부 방향·영역·후보·Heatmap·수기 계수 | SK |
| 32 | 45 | Pap 후보 갤러리·원천·복원 | PG |
| 33 | 46 | Pap 적절성·해석·미생물·1차/후속 | PA |
| 34 | 47 | 연관 Pap·생검의 환자 대조·독립 WSI | RL |

## 96개 기능 ID

| 기능 ID | PDF 항목 | 로컬 코드/E2E | 근거 | 관찰 및 남은 범위 |
|---|---|---|---|---|
| IMS-F001 | 이미지 관리 시스템·뷰어·저장 | 부분 · 해당 범위 PASS | IN, GR | 로컬 WSI 저장·등록·열람. 기관 스토리지·보존 및 PACS/VNA 대기. |
| IMS-F002 | Image Optimization & Acquisition | 부분 · 해당 범위 PASS | IN | 로컬 NDPI/SVS와 스캔 구조·교체 검증. 실제 스캐너 획득 인터페이스 대기. |
| IMS-F003 | Data Curation & AI Algorithms | 부분 · 해당 범위 PASS | RQ, IH, BM, PG | 버전 고정 보관 결과·합성 재현 및 검토. 학습 데이터 큐레이션과 모델별 임상 성능은 별도 범위. |
| IMS-F004 | 3rd Party AI Algorithms | 부분 · 해당 범위 PASS | RO, RQ | 로컬 유사검색·보관본 어댑터와 실패 복구. 승인된 외부 모델·벤더 전송 시험 대기. |
| IMS-F005 | Reporting & LIS Integration | 부분 · 해당 범위 PASS | GR, OR | 동일 케이스 원본·정정 보고 및 Mock ACK, OR 예비보고. 실제 LIS 게시 대기. |
| IMS-F006 | Custom Workflow & AI Tools | 있음 · PASS | WL, WG, RQ, MV | 개인·공유 View, 분류/업무함, 작업 규칙, 판독 도구. |
| IMS-F007 | Compliance CE, HIPAA, GDPR, ISO, SOC 2 | 미확인 · NOT RUN | — | 인증·역할·감사는 기능별 증거가 있다. 업체 규제·인증 범위와 기관 심사 증거는 미확보. |
| IMS-F001-01 | Worklist | 있음 · PASS | WL, GR | 업무 목록·케이스 조회/진입 |
| IMS-F001-02 | Cases / Scans | 있음 · PASS | IN | Cases와 Slide Registration의 로컬 수기 입력·확정 |
| IMS-F001-03 | Assigned to: [user] (me) | 있음 · PASS | GR, WL | Assigned to Me와 배정 기반 조회 |
| IMS-F001-04 | Last opened | 있음 · PASS | WL, API | 최근 열람 필터와 개인별 열람 시각 |
| IMS-F001-05 | Time since / Date range | 있음 · PASS | WL | 날짜 범위와 누락 분류. 상대일 옵션별 동등성 미확인 |
| IMS-F001-06 | Collections | 있음 · PASS | BO, WG | 컬렉션·분야별 업무함 |
| IMS-F001-07 | Global views | 있음 · PASS | WG | 기관 그룹과 Breast/Cytology/Frozen 업무함 |
| IMS-F001-08 | Toolbar | 있음 · PASS | WL, RQ | Worklist 필터·뷰·요청 조작 |
| IMS-F001-09 | 분야별 뷰 복수 선택 UI | 있음 · PASS | WG, WL | 그룹·분야/검체 분류와 필터 조합 |
| IMS-F001-10 | Slide status 표시 | 있음 · PASS | WL, IN | 스캔 상태와 로컬 QC |
| IMS-F001-11 | LIS case status 표시 | 부분 · 해당 범위 PASS | WL, API | Mock LIS 외부 원천과 로컬 상태 분리. 실제 상태 동기화 대기 |
| IMS-F001-12 | 케이스 정렬 표시 | 있음 · PASS | WL | 열 기반 정렬 방향·반영 |
| IMS-F001-13 | More filters 목록 | 있음 · PASS | WL | 고급 필터와 필드 출처 |
| IMS-F001-14 | Age at collection 범위 UI | 있음 · PASS | WL | 채취일 기준 연령 범위·생년/채취일 누락 |
| IMS-F001-15 | 조건 적용 시 목록 갱신 | 있음 · PASS | WL | 필터 변경 후 목록·조건 토큰 갱신 |
| IMS-F001-16 | 빈 검색 결과 안내 | 있음 · PASS | WL, GR | 빈 결과와 정상 검색 복귀 |
| IMS-F001-17 | Custom View 생성 | 있음 · PASS | WL | 개인 View 생성 및 재접속 |
| IMS-F001-18 | 뷰 저장 범위 | 있음 · PASS | WL | 개인/공유 권한 |
| IMS-F001-19 | 컬럼 상태 포함 저장 | 있음 · PASS | WL | 열 포함 저장 옵션 |
| IMS-F001-20 | 개인·공유 컬렉션 | 있음 · PASS | BO | 개인·공유 컬렉션과 접근 분리 |
| IMS-F001-21 | 컬렉션 선택 | 부분 · 해당 범위 PASS | BO | 대상 선택과 보드 회차는 동작. PDF의 트리 검색·다중 체크 선택 미확인 |
| IMS-F001-22 | Tumor Board 컬렉션에 케이스 추가 | 있음 · PASS | BO | Worklist의 보드 회차 참조 추가 |
| IMS-F001-23 | Collection note | 있음 · PASS | BO | 참조 메모 입력·정정 |
| IMS-F001-24 | Frozen Section 분류 목록 | 있음 · PASS | OR, WG | Frozen 업무함과 우선순위 |
| IMS-F001-25 | Worklist 컬럼 표시 설정 | 있음 · PASS | WL | 검색 가능한 열 목록과 표시/숨기기 |
| IMS-F001-26 | 컬럼 순서 UI | 있음 · PASS | WL | 이동 버튼으로 열 순서 저장·복원. 원본 화면은 드래그 핸들 |
| IMS-F001-27 | 뷰 저장 컬럼 표시 | 있음 · PASS | WL | 저장 열 적용/토글 |
| IMS-F001-28 | 다중 정렬 우선순위 | 있음 · PASS | WL | 다단계 정렬 순서·방향, 필터와 조합 |
| IMS-F001-29 | 정렬 기본값 복원 | 있음 · PASS | WL | 기본 Worklist/정렬 복원 |
| IMS-F001-30 | 슬라이드 썸네일 패널 | 있음 · PASS | WS | 정확한 스캔별 미리보기·Tray |
| IMS-F001-31 | 추가 업무 정보 | 부분 · 해당 범위 PASS | WL, RQ, NT | 검체·요청·스캔/로컬 저장 정보. 기관 아카이브 상태와 PDF의 전체 열 원천은 별도 |
| IMS-F002-01 | Worklist→WSI Viewer 전환 | 있음 · PASS | WS, GR | 미리보기와 정확한 스캔을 WSI에서 열기 |
| IMS-F002-02 | H&E WSI 화면 표시 | 있음 · PASS | GR, WS | NDPI/SVS 타일·줌·팬 |
| IMS-F002-03 | 좌측 슬라이드 탐색 패널 | 있음 · PASS | WS | Tray 탐색·활성 스캔 |
| IMS-F002-04 | 전체 이미지 Overview | 있음 · PASS | WS | Overview 및 미니맵 |
| IMS-F002-05 | 배율 및 스케일 표시 | 있음 · PASS | WS, MV | 배율·스케일바·MPP 보정 |
| IMS-F002-06 | 케이스 관련 상단 탭 | 있음 · PASS | WS, HI, MD, LG | 케이스 맥락과 상세 진입 |
| IMS-F002-07 | 도구 바로가기 | 있음 · PASS | WS | 툴바 및 설정 |
| IMS-F002-08 | 슬라이드 간 이미지 조회 | 있음 · PASS | WS, GR | 슬라이드/스캔 선택과 복귀 |
| IMS-F002-09 | 썸네일 스트립 / 타일형 슬라이드 갤러리 | 있음 · PASS | WS | 갤러리·Tray 보기 전환 |
| IMS-F002-10 | Slide viewer settings | 있음 · PASS | WS | 저장 뷰어 환경설정과 재접속 |
| IMS-F002-11 | Pathology 탭의 병리 기록 | 있음 · PASS | HI | 로컬 및 외부 Mock 병리 기록 출처 |
| IMS-F002-12 | History 및 진단 기록 검색/조회 | 있음 · PASS | HI | 진료/진단 조회·권한·외부 장애 |
| IMS-F002-13 | Media 첨부문서 열람 | 있음 · PASS | MD | 첨부 PDF 페이지·열람/실패 |
| IMS-F002-14 | Gross images | 있음 · PASS | MD | 검체별 Gross 이미지와 접근 제어 |
| IMS-F002-15 | Quality 우측 패널 | 있음 · PASS | IN | 스캔 QC와 대체 스캔 복구 |
| IMS-F002-16 | OR view A 결과 카드 | 있음 · PASS | OR | 권한 있는 OR 결과·ACK·재확인 |
| IMS-F002-17 | Case editor / 슬라이드 메타데이터 | 있음 · PASS | IN | 대조·편집·라벨 및 스캔 복구 |
| IMS-F002-18 | Case logs | 있음 · PASS | LG, GR, OR | 열람·실패·변경과 사용자·행위·대상·결과 필터 |
| IMS-F002-19 | Case details / DICOM Metadata | 미확인 · NOT RUN | — | 기관 DICOM Metadata·PACS/VNA 커넥터 대기. 로컬 OpenSlide 메타데이터 경로는 WS에서 검증 |
| IMS-F002-20 | Aignostics PathoSearch | 부분 · 해당 범위 PASS | RO | ROI 미리보기·기관 승인 대기 상태, 로컬/합성 결과·복구. 실제 Aignostics 호출 대기 |
| IMS-F002-21 | Requests 상태 및 생성 UI | 있음 · PASS | RQ | AI/자문 요청 상태·담당·완료 |
| IMS-F002-22 | Notes / Comments | 있음 · PASS | NT | 케이스/뷰어 Notes·댓글·멘션 |
| IMS-F002-23 | Notifications | 있음 · PASS | NT | 인앱 알림·중복 제어 |
| IMS-F002-24 | Notification preferences | 부분 · 해당 범위 PASS | NT | 인앱/Email/Push 설정·상태. SMTP·Push 승인 서버 실제 전송 대기 |
| IMS-F002-25 | Viewer 공동 참여자 표시 | 있음 · PASS | CO | 동일 WSI 세션 참여자 |
| IMS-F002-26 | 발표자 표시 / Invite to follow | 있음 · PASS | CO | 초대·Follow/Drive·인계·재접속 |
| IMS-F002-27 | 전체 화면·단축키·Autopan 탐색 | 있음 · PASS | WS | 전체화면·단축키·Autopan·사용자 설정 |
| IMS-F002-28 | 다중 WSI 동시 비교 화면 | 있음 · PASS | MV | 최대 4 pane·활성 pane·좌표 동기화 |
| IMS-F002-29 | WSI co-registration, 정렬 | 부분 · 해당 범위 PASS | MV | 수동 기준점과 잔차 확인. 자동/6분할 발표 범위 미확인 |
| IMS-F002-30 | Point/Arrow 등 주석 도구 | 있음 · PASS | MV | 점·도형 등을 WSI 좌표로 기록하고 목록에서 확인 |
| IMS-F002-31 | Ruler/다분절 길이 측정 | 있음 · PASS | MV | 거리·다분절과 물리 단위 |
| IMS-F002-32 | 도형·브러시·ROI 및 카운트 | 있음 · PASS | MV | 도형·ROI·계수 도구와 백엔드 좌표 검증 |
| IMS-F002-33 | Annotation 목록·북마크·프리셋 | 있음 · PASS | MV | 목록·북마크·프리셋 복원 |
| IMS-F002-34 | Viewer 현재 화면 이미지 내보내기 | 있음 · PASS | MV | ROI PNG 저장·범위 |
| IMS-F002-35 | Viewer 에서 Request 생성 | 있음 · PASS | RQ | Viewer 분석/자문 요청과 결과 참조 |
| IMS-F002-36 | Lymph node count 패널 | 있음 · PASS | MV | 림프절 입력·제약 |
| IMS-F002-37 | 슬라이드별 림프절 계수 | 있음 · PASS | MV | 스캔/검체 계수와 정정 |
| IMS-F002-38 | 림프절 계수 집계 및 보고 활용 | 있음 · PASS | MV, GR | Positive/Total을 보고 근거로 참조. 실제 LIS 동기화 검증 대기 |
| IMS-F002-39 | 계수 결과 Notes 연계 | 미확인 · NOT RUN | — | 계수 패널과 보고 근거는 MV에서 확인. 계수의 자동 Notes 복제는 미확인 |
| IMS-F003-01 | 외부 AI 결과를 IMS Viewer에 직접 오버레이 표시 | 부분 · 해당 범위 PASS | IH, BM, RQ | 보관본 결과와 셀 오버레이. 외부 추론·자동 입수 검증 대기 |
| IMS-F003-02 | Ki-67 AI 양성/음성 세포 분류 및 ROI/비율 표시 | 있음 · PASS | IH | 합성 Ki-67 원본·수정본과 검증 집계 |
| IMS-F003-03 | AI 판정 양성 임계값 조절과 결과 재계산 | 있음 · PASS | IH | 사용자 셀 판정·임계값 변경, 최신본과 재계산 |
| IMS-F003-04 | PR·ER 면역염색 양성도 시각화 및 threshold 초기화 | 있음 · PASS | IH | ER/PR 결과·오버레이와 근거 없는 점수 보류. 수정·복원 E2E는 Ki-67, 공통 저장 경로는 백엔드 회귀 |
| IMS-F003-05 | HER2 다중 염색 패턴·종합 점수 | 있음 · PASS | BM | HER2 패턴, Composite·편집/복원과 근거 회수 |
| IMS-F003-06 | PD-L1 AI 다색 시각화 및 CPS/TPS 결과 | 부분 · 해당 범위 PASS | BM | 보관본/합성 기준 결과에서 CPS/TPS·오버레이 표시 범위 검증. 실제 검체/암종·동시 임상 유효성 대기 |
| IMS-F003-07 | 전립선 AI 결과 패널 및 코어별 영역 표시 | 있음 · PASS | PR | Core 영역·선택·줌 이후 위치 |
| IMS-F003-08 | 전립선 조직 코어·레벨 단위 AI 결과 | 있음 · PASS | PR | Core/Level·모델/분석 버전 |
| IMS-F003-09 | Gleason/Grade Group, 종양 영역, PNI/cribriform 등 출력 | 부분 · 해당 범위 PASS | PR | 근거 있는 길이·Grade Group·PNI와 누락 처리. cribriform 등 미계약 값·실제 모델 검증 대기 |
| IMS-F003-10 | 피부 조직 표피 방향 AI 회전 | 부분 · 해당 범위 PASS | SK | 보관본의 표피 방향 표식·영역을 표시. 자동 회전은 미확인 |
| IMS-F003-11 | 흑색종 유사분열 후보 AI 검출 | 부분 · 해당 범위 PASS | SK | 합성 보관 후보·위치·확정/반려. 실제 검출기 성능 대기 |
| IMS-F003-12 | 유사분열 밀도 Heatmap | 있음 · PASS | SK | 후보 밀도 Heatmap과 보정/범위 |
| IMS-F003-13 | 지정 면적 수동 유사분열 계수 | 있음 · PASS | SK | 수기 0.2/1 mm² 계수·이력 |
| IMS-F003-14 | Pap smear 세포검사 AI | 부분 · 해당 범위 PASS | PG | 합성 후보 보관 결과를 연동. 장비/실제 모델 입력·성능 대기 |
| IMS-F003-15 | Pap AI 세포 후보 갤러리/범주별 탐색 | 있음 · PASS | PG | 후보 범주·목록·WSI 좌표·재접속 |
| IMS-F003-16 | Pap 검사 결과 입력 UI | 있음 · PASS | PA | 적절성·해석·미생물과 기관 용어 버전 |
| IMS-F003-17 | 세포검사 리뷰 완료 및 상태 표시 | 있음 · PASS | PA | 제출·반려·재개·완료 및 감사 |
| IMS-F003-18 | Pap–biopsy correlation | 있음 · PASS | RL | 동일 환자 Pap/생검 연결과 독립 WSI·해제 |
| IMS-F003-19 | Cytotechnologist 1 차·병리과 의사 2 차 검토 | 있음 · PASS | PA | 1차/후속 권한·역할 회수와 대체 검토자 |

## 발표 기능과 기관 확인

| 발표·도입 언급 | 로컬 확인 | 기관에서 남은 검증 |
|---|---|---|
| AP/CP, 스캐너·EMR/LIS·PACS/VNA·FHIR/HL7/DICOMweb | NDPI/SVS, 수기 접수·QC, EMR/LIS Mock, 출처·리비전, 정정 ACK | 실장비·시험 응답, CP 검사실 흐름, 실제 보고 게시, PACS 보관과 조회 |
| 분야별 업무량·구독·우선순위 | 합성 배정·업무함·구독 | 실제 기관 역할·업무량 산정과 사용성 |
| 스캔 라벨 OCR·장비/AI QC | 오류 주입 후 라벨 재열람과 수기 확정, 합성 QC 근거와 재스캔 | OCR 바이너리 별도 준비, 스캐너·AI QC 실제 메시지와 정확도 |
| 음성 전사·보고 템플릿·LIS 정정 | 합성 로컬 SpeechRecognition 응답으로 초안 반영, 보고 버전 및 Mock ACK | 실제 음성 입력/정확도·언어, 기관 전송·게시·정정 |
| 이메일·Push 및 협업 Teams | 로컬 인앱 및 비설정 채널 상태, 브라우저 두 세션 Follow/Drive | 승인된 SMTP·Push·Teams 설정과 실제 외부 전달 |
| 자동·수동 정합 및 6분할 | 최대 4 pane, 같은 케이스의 동기화와 수동 기준점 | 자동 정합 및 6 pane 미확인. 기관 WSI 표본별 정합의 임상 허용 오차 미합의 |
| IHC best block, 외부 AI, 사전 실행, 유사검색 | 수기·규칙 요청, 버전 고정 보관본 재실행, 참조를 포함한 보고, 합성 ROI 검색 | 외부 AI 계정과 장비, 실제 데이터 반출·검증, 기관 모델별 판독 기준 |
| 공급업체의 버전 병행·서비스 절체 및 보존 | 격리 DB·합성 기록, Mock 장애 중 로컬 독립 운영 | 공급업체 SLA, 실제 버전 전환·원천 대사·보존 및 복구 훈련 |
| 규제 표기·가격·도입 일정 | 사용자 권한·감사 E2E를 별도 확인 | 기관 심사와 업체 근거·계약, 제품 범위 검토 |

## 근거 스크립트

| 근거 | 실행 시나리오 |
|---|---|
| IN | [case-editor](../scripts/case-editor-browser.mjs) |
| WL | [worklist-views](../scripts/worklist-views-browser.mjs) |
| WG | [workgroups](../scripts/workgroups-browser.mjs) |
| GR | [integration](../scripts/integration-browser.mjs), [case-report](../scripts/case-report-browser.mjs) |
| WS | [viewer-preferences](../scripts/viewer-preferences-browser.mjs), [workspace-layout](../scripts/workspace-layout-browser.mjs) |
| HI | [patient-history](../scripts/patient-history-browser.mjs) |
| MD | [case-attachments](../scripts/case-attachments-browser.mjs) |
| OR | [frozen-workflow](../scripts/frozen-workflow-browser.mjs) |
| LG | [case-logs](../scripts/case-logs-browser.mjs) |
| RO | [roi-search](../scripts/roi-search-browser.mjs) |
| RQ | [case-requests](../scripts/case-requests-browser.mjs), [analysis-execution](../scripts/analysis-execution-browser.mjs) |
| NT | [notifications](../scripts/notifications-browser.mjs) |
| CO | [collaborative-review](../scripts/collaborative-review-browser.mjs) |
| MV | [multi-view](../scripts/multi-view-browser.mjs), [viewer-workflow](../scripts/viewer-workflow-browser.mjs) |
| BO | [case-collections](../scripts/case-collections-browser.mjs) |
| IH | [ihc-results](../scripts/ihc-results-browser.mjs) |
| BM | [biomarker-evidence](../scripts/biomarker-evidence-browser.mjs) |
| PR | [prostate-results](../scripts/prostate-results-browser.mjs) |
| SK | [skin-review](../scripts/skin-review-browser.mjs) |
| PG | [pap-gallery](../scripts/pap-gallery-browser.mjs) |
| PA | [pap-review](../scripts/pap-review-browser.mjs) |
| RL | [related-cases](../scripts/related-cases-browser.mjs) |
| API | [PostgreSQL 통합 회귀](../backend/tests/test_clinical.py)의 Worklist 최근 열람·LIS 타임아웃 및 출처 시험 |
