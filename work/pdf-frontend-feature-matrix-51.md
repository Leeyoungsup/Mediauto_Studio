# 51 · PDF 기능 ID 96개 최종 대조

기능 ID와 쪽은 PDF §8 원문 9–12쪽에서 추출해 43번과 집합 일치를 확인했다. 43번 판정은 기준선이며 51번은 최종 프런트의 대응 경로를 기준으로 다시 분류했다. 화면 34개와 최종 재현 절차는 [51번 전체 검증](pdf-frontend-review-51.md)에 있다. [PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf) · [43번 기준표](pdf-frontend-feature-matrix-43.md)

| 판정 | 적용 기준 |
|---|---|
| 동작 | 최종 앱에서 해당 사용자 흐름이 열리고, 표기한 자동화 또는 화면 근거가 있다. |
| UI 차이 | 기능은 접근 가능하며 PDF와 입력 방식 또는 화면 배치에 남은 차이가 있다. |
| 부분 | 지원 범위, 데이터 또는 검증에 제한이 있다. |
| 외부 | 기관·장비·벤더·규제 근거가 있어야 해당 기능을 확인할 수 있다. |
| 누락 | 해당 동작의 구현을 확인하지 못했다. |

| 기능 ID | §8 쪽 | PDF 기능 | 43번 | 최종 51번 | 근거 | 최종 경로 또는 제한 |
|---|---:|---|---|---|---|---|
| IMS-F001 | 9 | 이미지 관리 시스템·뷰어·저장 | 부분 | 부분 | IN, GR, WS | 로컬 파일 등록·QC·스캔 열람과 복구. 기관 보존, 장비 및 PACS/VNA 경로는 별도. |
| IMS-F002 | 9 | Image Optimization & Acquisition | 부분 | 부분 | IN, API | 구조 검사, 수기·외부 QC 관찰, 재스캔 교체를 확인했다. 장비 직접 획득은 기관 시험 대상. |
| IMS-F003 | 9 | Data Curation & AI Algorithms | 부분 | 부분 | AX, IH, BM, PG | 버전 있는 보관 결과, Replay·Preflight, 검토를 연결했다. 임상 모델 추론 및 학습 큐레이션 범위는 별도. |
| IMS-F004 | 9 | 3rd Party AI Algorithms | 외부 | 외부 | RO, AX, SRC | 로컬 ROI 참조 검색과 보관 결과를 실행한다. 타사 운영 추론·검색 커넥터 가용성은 기관 확인 대상. |
| IMS-F005 | 9 | Reporting & LIS Integration | 부분 | 부분 | GR, OR, API | 초안·승인·정정·감사와 Mock LIS ACK. 외부 LIS 전달·수락은 기관 시험 대상. |
| IMS-F006 | 9 | Custom Workflow & AI Tools | 동작 | 동작 | WL, WG, RQ, MV, AX | 저장 View·업무함·Viewer 자문·판독 도구를 사용한다. |
| IMS-F007 | 9 | Compliance CE, HIPAA, GDPR, ISO, SOC 2 | 외부 | 외부 | UA, API, SRC | 역할·감사 회귀 근거가 있다. 인증·법적 적합성과 기관 보존은 별도 평가. |
| IMS-F001-01 | 9 | Worklist | UI 차이 | 동작 | WL, UI, GR | 사이드바·Worklist 업무함 활성 표시와 전체 목록 탐색. |
| IMS-F001-02 | 9 | Cases / Scans | UI 차이 | 동작 | IN, WS | Intake와 Slide Registration에서 접수한 뒤 같은 Case Editor 스캔을 확인한다. |
| IMS-F001-03 | 9 | Assigned to: [user] (me) | 동작 | 동작 | GR, WL | My Cases의 배정된 케이스 범위와 현재 업무함 표시. |
| IMS-F001-04 | 9 | Last opened | UI 차이 | 동작 | WL, API | More Filters의 Last Opened와 선택 열을 제공하며 계정별 최근 열람을 기록한다. |
| IMS-F001-05 | 9 | Time since / Date range | 부분 | 부분 | WL, API, SRC | 최근 열람 상대기간 및 별도 날짜 필터. 각 상대기간의 경계 조합은 개별 브라우저 검증 미수행. |
| IMS-F001-06 | 9 | Collections | 동작 | 동작 | BO | 개인·공유 컬렉션과 Tumor Board 회차가 나뉘며 접근 권한을 확인한다. |
| IMS-F001-07 | 9 | Global views | UI 차이 | 동작 | WG, WL | Worklist Global Views와 그룹·Frozen 분류를 업무함에 표시한다. |
| IMS-F001-08 | 9 | Toolbar | UI 차이 | 동작 | WL, WS | 검색, 저장 View, Columns, Multi-Level Sort, More Filters와 현재 결과를 Worklist에서 확인한다. |
| IMS-F001-09 | 9 | 분야별 뷰 복수 선택 UI | 부분 | 부분 | WG, WL, SRC | 그룹과 우선순위를 세부 필터와 조합한다. PDF처럼 분야 트리에서 복수 선택하는 UI는 미구현. |
| IMS-F001-10 | 9 | Slide status 표시 | UI 차이 | 동작 | WL, IN, WS | Slides 탭의 가용 여부·형식·스캔 ID, QC 보류와 교체 후 열람. |
| IMS-F001-11 | 10 | LIS case status 표시 | 부분 | 부분 | WL, API | Review Status와 출처가 있는 LIS Case Status를 구분한다. 실제 LIS 수신은 기관 확인 대상. |
| IMS-F001-12 | 10 | 케이스 정렬 표시 | 동작 | 동작 | WL | 열 정렬 방향과 다단계 우선순위. |
| IMS-F001-13 | 10 | More filters 목록 | UI 차이 | 동작 | WL | More Filters의 환자·검체·담당자·스캔 조건, 출처와 적용 칩. |
| IMS-F001-14 | 10 | Age at collection 범위 UI | 동작 | 동작 | WL | 채취일 연령 범위 필터와 누락 값의 별도 처리. |
| IMS-F001-15 | 10 | 조건 적용 시 목록 갱신 | 동작 | 동작 | WL | 조건 적용 후 결과 갱신, 조건 표시 및 해제. |
| IMS-F001-16 | 10 | 빈 검색 결과 안내 | 동작 | 동작 | WL, GR | 빈 목록을 표시하고 검색 조건을 조정한다. |
| IMS-F001-17 | 10 | Custom View 생성 | 동작 | 동작 | WL | Save New View로 저장하고 이후 세션에서 복원한다. |
| IMS-F001-18 | 10 | 뷰 저장 범위 | 동작 | 동작 | WL, UA | 개인 및 조직 View의 저장·조직 공유 권한. |
| IMS-F001-19 | 10 | 컬럼 상태 포함 저장 | 동작 | 동작 | WL | Include current columns의 선택 값에 따라 저장된 열 복원. |
| IMS-F001-20 | 10 | 개인·공유 컬렉션 | 동작 | 동작 | BO | 개인/공유와 보드 참여 권한을 적용하고 역할 배지를 표시한다. |
| IMS-F001-21 | 10 | 컬렉션 선택 | 부분 | 부분 | BO, SRC | 개인·공유·보드별 회차를 묶고 회차에서 미리 선택한다. 한 번에 한 대상. |
| IMS-F001-22 | 10 | Tumor Board 컬렉션에 케이스 추가 | 동작 | 동작 | BO | Worklist에서 안건 추가 뒤 Open Destination이 같은 행에 초점을 준다. |
| IMS-F001-23 | 10 | Collection note | 동작 | 동작 | BO | Collection Note 생성·수정과 선택한 안건 복귀. |
| IMS-F001-24 | 10 | Frozen Section 분류 목록 | UI 차이 | 동작 | WG, OR | Frozen 업무함 → Frozen Report 및 해당 버전 OR 확인. |
| IMS-F001-25 | 10 | Worklist 컬럼 표시 설정 | 동작 | 동작 | WL | Columns에서 검색, 표시·숨김 및 저장 View 열 복원. |
| IMS-F001-26 | 10 | 컬럼 순서 UI | UI 차이 | UI 차이 | WL, SRC | Up/Down으로 열을 재정렬한다. PDF의 열 드래그와 입력 방식이 다르다. |
| IMS-F001-27 | 10 | 뷰 저장 컬럼 표시 | 동작 | 동작 | WL | 저장 View의 열 선택 복원과 기본값 적용. |
| IMS-F001-28 | 10 | 다중 정렬 우선순위 | UI 차이 | 동작 | WL | Multi-Level Sort에서 필드·방향을 지정하고 적용 순서를 이동한다. |
| IMS-F001-29 | 10 | 정렬 기본값 복원 | 동작 | 동작 | WL | 정렬 초기화·Restore Default Worklist와 View 기본값. |
| IMS-F001-30 | 10 | 슬라이드 썸네일 패널 | UI 차이 | 동작 | WS, IN | Case Preview의 썸네일에서 정확한 NDPI/SVS·QC 정보를 구분하고 Viewer로 연다. |
| IMS-F001-31 | 10 | 추가 업무 정보 | 부분 | 부분 | WL, RQ, NT | 보조 열 및 요청·Notes 사용 가능. 기관 저장 상태와 장기 보존 값은 별도. |
| IMS-F002-01 | 10 | Worklist→WSI Viewer 전환 | 동작 | 동작 | WS, GR | Worklist 미리보기와 Case Details에서 지정한 스캔으로 진입. |
| IMS-F002-02 | 10 | H&E WSI 화면 표시 | 동작 | 동작 | GR, WS | NDPI·SVS 타일, 스캔 전환과 오류 후 타일 복구. |
| IMS-F002-03 | 10 | 좌측 슬라이드 탐색 패널 | 동작 | 동작 | WS | Slide Tray의 활성 스캔 표시 및 가로/세로·Gallery. |
| IMS-F002-04 | 10 | 전체 이미지 Overview | 동작 | 동작 | WS | Overview와 동적 미니맵에서 정확한 위치 탐색. |
| IMS-F002-05 | 10 | 배율 및 스케일 표시 | 동작 | 동작 | WS, MV | 배율과 스케일바. 등록 MPP가 없으면 물리 단위 가용 상태를 표시한다. |
| IMS-F002-06 | 10 | 케이스 관련 상단 탭 | UI 차이 | 동작 | WS, HI, MD, LG, UI | Slides와 문서·Requests 탭, 같은 캔버스 복귀와 주소로 선택 스캔 복원. |
| IMS-F002-07 | 10 | 도구 바로가기 | UI 차이 | 동작 | WS, MV | 영상 조작과 도형 아이콘을 활성 스캔 및 도구 상태에 배치했다. |
| IMS-F002-08 | 10 | 슬라이드 간 이미지 조회 | 동작 | 동작 | WS, GR | 같은 라벨의 NDPI·SVS를 개별 스캔 ID로 구분한다. |
| IMS-F002-09 | 10 | 썸네일 스트립 / 타일형 슬라이드 갤러리 | 동작 | 동작 | WS | Tray 방향과 Gallery를 전환하고 계정에 저장한다. |
| IMS-F002-10 | 10 | Slide viewer settings | 부분 | 부분 | WS, SRC | Label·Overview·미니맵·단축키·Autopan 설정 복원. 게임패드·커서 유형·성능 시험 UI는 확인하지 못했다. |
| IMS-F002-11 | 10 | Pathology 탭의 병리 기록 | UI 차이 | UI 차이 | HI | 병리·진료 기록은 History에서 조회한다. PDF와 별도 Pathology 탭 표현이 다르다. |
| IMS-F002-12 | 10 | History 및 진단 기록 검색/조회 | UI 차이 | 동작 | HI, UI | Viewer와 Case Details History가 같은 기록을 열고 로컬/외부 출처 및 장애 상태를 표시한다. |
| IMS-F002-13 | 10 | Media 첨부문서 열람 | 동작 | 동작 | MD | PDF 페이지·다운로드·감사 및 미리보기 실패 후 재시도. |
| IMS-F002-14 | 10 | Gross images | 동작 | 동작 | MD | 검체별 Gross Images 업로드·필터·열람과 재접속. |
| IMS-F002-15 | 10 | Quality 우측 패널 | UI 차이 | UI 차이 | IN | Quality 조작은 선택 스캔의 Case Editor에 있다. PDF 우측 상시 패널 대신 스캔 초점으로 이동한다. |
| IMS-F002-16 | 10 | OR view A 결과 카드 | 동작 | 동작 | OR | OR Results의 예비보고·절제연, 확인 이슈·ACK·콜백과 정정 후 재확인. |
| IMS-F002-17 | 10 | Case editor / 슬라이드 메타데이터 | UI 차이 | 동작 | IN | Case Editor에서 라벨·바코드·검체·블록·염색·QC, 스캔 선택 및 복귀. |
| IMS-F002-18 | 10 | Case logs | UI 차이 | 동작 | LG, GR, OR, UA | Viewer/Case의 Case Logs 필터와 Accounts의 관리자 전용 감사 경로. |
| IMS-F002-19 | 10 | Case details / DICOM Metadata | 외부 | 외부 | SRC, API | 기본 파일과 스캔 메타데이터가 제공된다. 기관 DICOM Metadata 뷰와 시스템 연결은 검증 대기. |
| IMS-F002-20 | 10 | Aignostics PathoSearch | 부분 | 부분 | RO, SRC | ROI 검색의 미리보기·장기 선택·결과→원본/대상 위치 복귀. 외부 Aignostics 운영 연결은 대기. |
| IMS-F002-21 | 11 | Requests 상태 및 생성 UI | UI 차이 | 동작 | RQ, AX | Viewer Requests가 현재 스캔을 미리 선택하고 세부 상태·담당·알림으로 이어진다. |
| IMS-F002-22 | 11 | Notes / Comments | 동작 | 동작 | NT | Case·Viewer에서 Notes, 댓글, 멘션과 권한을 확인한다. |
| IMS-F002-23 | 11 | Notifications | 동작 | 동작 | NT, RQ | 상단 Notifications에서 해당 요청으로 진입하고 This Request Only로 좁힌다. |
| IMS-F002-24 | 11 | Notification preferences | 부분 | 부분 | NT, API | In-app·Email·Push 사건별 설정과 실패 표시. 승인된 외부 전송 시험은 대기. |
| IMS-F002-25 | 11 | Viewer 공동 참여자 표시 | UI 차이 | 동작 | CO | 참여자 색상, Online, Driver/Following/Independent를 패널과 헤더에서 확인한다. |
| IMS-F002-26 | 11 | 발표자 표시 / Invite to follow | 부분 | 부분 | CO, SRC | 초대 링크, Follow/Drive, 온라인 참여자 인계·재접속. Teams는 Not Configured. |
| IMS-F002-27 | 11 | 전체 화면·단축키·Autopan 탐색 | 동작 | 동작 | WS | 전체 화면, 키보드, Autopan과 저장 설정 및 문서 탭 전환. |
| IMS-F002-28 | 11 | 다중 WSI 동시 비교 화면 | 동작 | 동작 | MV | 같은 케이스 최대 4개 독립 pane과 위치 동기화, 활성 pane. |
| IMS-F002-29 | 11 | WSI co-registration, 정렬 | 부분 | 부분 | MV, SRC | 수동 조직 랜드마크와 잔차. 6분할·자동 조직 정합은 확인되지 않았다. |
| IMS-F002-30 | 11 | Point/Arrow 등 주석 도구 | UI 차이 | 동작 | MV | 도구 아이콘에서 Point/Arrow를 선택하고 그리기·선택 상태를 본다. |
| IMS-F002-31 | 11 | Ruler/다분절 길이 측정 | 동작 | 동작 | MV | 직선·다분절 거리 저장, MPP 기준 단위와 확대 시 좌표. |
| IMS-F002-32 | 11 | 도형·브러시·ROI 및 카운트 | 동작 | 동작 | MV | Polygon 가이드·닫기·Undo·교차 거부, 도형·브러시·수기 계수. |
| IMS-F002-33 | 11 | Annotation 목록·북마크·프리셋 | 동작 | 동작 | MV | Annotations 목록·북마크·프리셋, 저장 후 스캔과 카메라 복원. |
| IMS-F002-34 | 11 | Viewer 현재 화면 이미지 내보내기 | 부분 | 부분 | MV, SRC | ROI로 PNG를 만들고 주석/스케일 옵션을 적용한다. 현재 viewport 전체 캡처는 미확인. |
| IMS-F002-35 | 11 | Viewer 에서 Request 생성 | UI 차이 | 동작 | RQ, AX, UI | Viewer의 분석·자문 진입, 현재 스캔으로 새 요청 및 작업 상세의 정확한 복귀. |
| IMS-F002-36 | 11 | Lymph node count 패널 | UI 차이 | 동작 | MV, GR | Lymph Node Count 영상 내 패널, Positive/Total, 기록한 스캔과 보고 버튼. |
| IMS-F002-37 | 11 | 슬라이드별 림프절 계수 | 부분 | 부분 | MV, SRC | 계수는 검체 단위로 저장하고 출발 스캔을 기록한다. 동일 검체의 스캔별 독립 계수 제공 범위와 다르다. |
| IMS-F002-38 | 11 | 림프절 계수 집계 및 보고 활용 | 부분 | 부분 | MV, GR | 보고 근거에서 저장된 검체 계수 버전을 조회한다. 운영 LIS 전송은 검증 대기. |
| IMS-F002-39 | 11 | 계수 결과 Notes 연계 | 누락 | 누락 | MV, SRC | 보고 근거 링크가 제공된다. 림프절 계수→Notes 자동 기록은 미구현. |
| IMS-F003-01 | 11 | 외부 AI 결과를 IMS Viewer에 직접 오버레이 표시 | 부분 | 부분 | IH, BM, RQ, AX | 해당 스캔에 바인딩된 보관 결과와 오버레이. 외부 AI 자동 수신은 기관 범위. |
| IMS-F003-02 | 11 | Ki-67 AI 양성/음성 세포 분류 및 ROI/비율 표시 | 동작 | 동작 | IH | Ki-67 세포 클래스·오버레이 및 근거 있는 수기 수정과 결과 카드. |
| IMS-F003-03 | 11 | AI 판정 양성 임계값 조절과 결과 재계산 | 동작 | 동작 | IH, API | 임계값·셀 판정 수정, Original 비교, 원본 복원과 이력. |
| IMS-F003-04 | 11 | PR·ER 면역염색 양성도 시각화 및 threshold 초기화 | 부분 | 부분 | IH, API | ER/PR 오버레이와 승인 제한. PR 전용 수정·복원 경로는 별도 E2E 미수행. |
| IMS-F003-05 | 11 | HER2 다중 염색 패턴·종합 점수 | 동작 | 동작 | BM | HER2 막 패턴·Composite 및 승인 근거에 따른 표시·회수, 원본 복원. |
| IMS-F003-06 | 11 | PD-L1 AI 다색 시각화 및 CPS/TPS 결과 | 부분 | 부분 | BM, AX | 검증 자료에 바인딩된 CPS/TPS와 선택 결과의 세포 클래스. 임상 적용 범위는 별도 확인. |
| IMS-F003-07 | 11 | 전립선 AI 결과 패널 및 코어별 영역 표시 | 동작 | 동작 | PR | 전립선 영역 오버레이, 부위 탐색, Return to WSI. |
| IMS-F003-08 | 11 | 전립선 조직 코어·레벨 단위 AI 결과 | 동작 | 동작 | PR | Core/Level 구분, 모델/분석 버전과 스캔 귀속. |
| IMS-F003-09 | 11 | Gleason/Grade Group, 종양 영역, PNI/cribriform 등 출력 | 부분 | 부분 | PR, SRC | 계약된 Grade Group과 길이·PNI. Cribriform 등 미계약 필드는 별도. |
| IMS-F003-10 | 11 | 피부 조직 표피 방향 AI 회전 | 부분 | 부분 | SK, SRC | 표피 방향과 영역 오버레이. 영상 자동 회전은 미구현. |
| IMS-F003-11 | 11 | 흑색종 유사분열 후보 AI 검출 | 부분 | 부분 | SK | 보관된 유사분열 후보와 사용자 확인·반려. 실제 검출 민감도/특이도는 기관 검증 대상. |
| IMS-F003-12 | 11 | 유사분열 밀도 Heatmap | 동작 | 동작 | SK | Heatmap 및 후보/영역의 선택 토글과 짝이 맞는 출처 표시. |
| IMS-F003-13 | 11 | 지정 면적 수동 유사분열 계수 | 동작 | 동작 | SK | 보정된 지정 면적의 수기 계수 및 수정 이력, 자료 없는 스캔의 수기 범위. |
| IMS-F003-14 | 11 | Pap smear 세포검사 AI | 부분 | 부분 | PG | 해당 Pap 염색·스캔의 보관된 후보를 표시한다. 실제 모델의 장비 입력과 선별 성능은 별도. |
| IMS-F003-15 | 12 | Pap AI 세포 후보 갤러리/범주별 탐색 | UI 차이 | 동작 | PG, UI | 등록된 Pap 스캔의 범주·후보·좌표와 계정별 복원. 일반 미입력 스캔의 버튼 노출 해소. |
| IMS-F003-16 | 12 | Pap 검사 결과 입력 UI | UI 차이 | 동작 | PA, PG | Pap Gallery와 Pap Review 사이에서 선택 후보 맥락을 유지하며 검토 필드를 연다. |
| IMS-F003-17 | 12 | 세포검사 리뷰 완료 및 상태 표시 | 동작 | 동작 | PA | 권한별 1차 제출·반려·완료·재개, 용어 버전 및 감사 이력. |
| IMS-F003-18 | 12 | Pap–biopsy correlation | 동작 | 동작 | RL | 환자 및 양쪽 케이스 권한을 확인하고 별도 WSI를 연 뒤 출발 Pap 스캔 복귀. |
| IMS-F003-19 | 12 | Cytotechnologist 1 차·병리과 의사 2 차 검토 | 동작 | 동작 | PA, API | 1차/후속 검토자와 대체 역할, 권한 회수와 감사. 실제 기관 정책 검증 대기. |

## 근거

약호가 같은 여러 항목은 한 브라우저 경로를 공유한다. SRC는 코드·계약 근거, API는 단위·API 회귀다. 외부 항목은 기관 시험 결과가 없다.

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
| RQ | Viewer **Requests** / `#case/{case}/requests` / `#request/{request}` · 병리의/관리자/자문 담당자 | [case-requests](../scripts/case-requests-browser.mjs), [analysis-execution](../scripts/analysis-execution-browser.mjs) |
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
| RL | Pap Review → **Compare Related Biopsy** → 비교 · 양쪽 케이스 접근 역할 | [related-cases](../scripts/related-cases-browser.mjs) |
| AX | Viewer → **Analysis** · 관리자/배정 병리의 | [analysis-execution](../scripts/analysis-execution-browser.mjs) |
| UA | 계정 등록·승인/권한·감사 · 관리자/신규 계정 | [registration](../scripts/registration-browser.mjs) |
| UI | 최종 Worklist, Viewer 및 계정 감사 · 관리자/병리의 | [프런트 측정 스크립트](../scripts/frontend-workflow-probe.mjs) · [전후 자료](pdf-frontend-review-51.md#43번과-최종-프런트-비교) |
| SRC | 화면·설정·계약 검토 | [프런트 소스](../frontend/src/) · [기관 연동 계약](institution-integration-41.md) |
| API | 스캔·환자·케이스 접근과 검증 정책 | [임상 API 회귀](../backend/tests/test_clinical.py) |
