# Mediauto_Studio

## 개발 환경 준비

서버의 `mediauto-studio` Conda 환경은 FastAPI와 Alembic을 실행합니다. `mediauto-postgres` Conda 환경은 PostgreSQL 18 실행 파일을 제공합니다. 프런트엔드는 Node.js `22.12.0`에서 준비합니다.

```bash
conda activate mediauto-studio
conda install -c conda-forge openslide=4.0.0
python -s -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
```

## 9920 포트에서 실행

```bash
./start.sh
```

브라우저에서 `http://서버IP:9920/`을 열면 로그인 화면이 표시됩니다. 서버 자체에서는 `http://127.0.0.1:9920/`으로 접속합니다. `/api/health`에서 FastAPI·PostgreSQL과 EMR 설정 상태를 확인할 수 있습니다.

### 계정 가입 신청

로그인 화면의 **Request an Account**에서 기관 코드, 이름, 사용자명, 비밀번호를 제출합니다. 표시되는 확인 코드를 기관 관리자에게 전달합니다. 관리자는 **Accounts → Registration Requests**에서 신청을 열고 역할과 확인 코드를 입력해 승인합니다. 이후 신청에 사용한 사용자명과 비밀번호로 로그인할 수 있습니다. [가입 절차와 검증](work/account-registration.md)

관리자 메뉴의 **Accounts → Directory and Access**에서 기존 계정의 역할·활성 상태를 바꿀 수 있습니다. **Audit Log**에서 가입 결정, 계정 권한, Workgroup 멤버십의 변경 이력을 확인합니다. [계정 관리와 감사 범위](work/account-registration.md)

Worklist에서 등록한 케이스는 개발 PostgreSQL에 저장됩니다.

Worklist에서는 **Hide Case Preview**로 목록을 넓힐 수 있습니다. WSI 뷰어는 탐색 메뉴를 기본으로 접고, **Hide Slide Tray**로 이미지 영역을 더 넓힐 수 있습니다. 탐색 메뉴는 상단 아이콘에서 다시 펼칩니다.

**Worklist → Column Preview**에서 합성 케이스 4건의 슬라이드 메타데이터와 24개 선택 컬럼을 확인합니다. **Test Columns**에서 검색·표시·숨김·순서를 시험합니다. **Apply Columns to Worklist**는 현재 목록의 컬럼만 바꾸며, 기본값으로 저장할 때는 목록의 **Columns → Save My Default Columns**를 사용합니다.

### 예제 슬라이드 등록

`Worklist → Slide Registration`은 `data/`의 NDPI·SVS를 읽기 전용으로 검색합니다. `Settings → Filename Rules`에서 규칙을 작성하거나 CODIPAI 예제를 불러온 뒤 `Preview → Save Rules → Apply to Unregistered Slides`을 실행합니다. 규칙 미일치 파일은 `Unregistered Slides`에서 Case ID와 Slide ID를 직접 등록할 수 있습니다.

규칙과 파일 등록 정보는 개발 PostgreSQL에 저장되며, 이미 등록한 파일은 규칙을 다시 적용해도 유지됩니다. 등록 정보는 Worklist에서 Case ID로 묶어 확인합니다. 같은 Slide ID의 NDPI와 SVS는 서로 다른 원본 파일로 표시됩니다. 등록된 스캔은 케이스 상세의 WSI 뷰어에서 열 수 있습니다.

### Viewer Analysis

등록된 스캔을 열고 **Analysis → Run Analysis**에서 현재 스캔의 실행 옵션, 상태 및 완료 결과를 확인합니다. Viewer의 **History**, **Media**, **Gross Images**, **Notes**, **Case Logs** 탭에서 같은 케이스 정보를 확인합니다. **Case Editor**는 상단에서 엽니다. [Viewer 분석 사용법과 지원 범위](work/viewer-analysis-usability.md)

### Workspace Layout

**Worklist**에서 업무 탭과 Frozen Cases, Tumor Board, OR Results에 접근합니다. 오른쪽 **Case Preview**의 **Slides**, **Case Summary**, **Review** 탭은 선택 케이스를 이어서 표시합니다. Viewer와 Settings도 업무별 탭으로 이동합니다. [화면 구성 변경과 검증](work/pdf-workspace-layout.md)

### 42. Integrated Workflow Verification

`scripts/verify-integration.sh --demo general`로 접수·판독·원본/정정 보고·감사를 시연합니다. `frozen`, `tumor-board`, `ihc`, `pap`, `collaboration`도 개별 실행할 수 있습니다. [역할별 시연과 검증](work/workflow-verification-42.md) · [PDF 화면·기능별 대조표](work/workflow-feature-matrix-42.md)

### 41. Institutional Integration Contract

[41번 기관 연동 계약 초안과 수락 시험](work/institution-integration-41.md)에 스캐너·EMR/LIS·PACS/VNA의 AP/CP 범위, 상태 원천, 장애·복구와 보존 조건을 정리했습니다. 기관 접속 및 수락 시험은 승인된 환경과 명세 확인을 기다리고 있습니다.

### 40. Related Pap and Biopsy Cases

**Case Details** 또는 **WSI Viewer → Related Pap and Biopsy Cases**에서 같은 환자의 Pap·조직생검 연결을 대조하고 승인합니다. **Open Independent Comparison**은 별도 탭에 두 스캔을 표시하며 각각 독립적으로 확대하고 이동할 수 있습니다. [40번 연결 기준과 검증](work/related-cases-40.md)

### 39. Pap Specimen Review

**Settings → Pap Review Policy**에서 기관 용어와 1차·후속 검토자를 게시합니다. 등록한 Pap 스캔의 **WSI Viewer → Pap Review**에서 적절성·해석·미생물을 입력하고 제출·후속 검토·반려·재개 이력을 확인합니다. [39번 설정, 권한과 검증](work/pap-review-39.md)

### 38. Pap Candidate Gallery

등록된 Papanicolaou 스캔의 **WSI Viewer → Pap Gallery**에서 분석과 후보 범주를 선택합니다. 후보 이미지를 누르면 해당 WSI 위치로 이동하며 같은 계정으로 다시 열면 마지막 후보를 복원합니다. [38번 입력 계약과 검증](work/pap-gallery-38.md)

### 37. Skin and Melanoma Review

등록된 H&E 스캔의 **WSI Viewer → Skin Review**에서 표피 방향, 조직 영역, 유사분열 후보와 모델 Heatmap을 확인합니다. **Manual Review**에서는 0.2 또는 1 mm² 영역을 지정해 수기 확인과 계수를 시작할 수 있습니다. [37번 보관본 연결, 계수와 검증](work/skin-review-37.md)

### 36. Prostate Core and Level

등록한 H&E 임상 스캔에서 **WSI Viewer → Prostate AI**를 열면 원천 분석 버전과 Core·Level별 영역을 선택하고 이동할 수 있습니다. 길이·Grade Group·PNI는 모델 출력과 해당 Core·Level의 기준 결과가 일치할 때 표시됩니다. [36번 결과 계약과 검증](work/prostate-results-36.md)

### 35. HER2·PD-L1 결과 계약

**WSI Viewer → Result Contract and Validation**에서 HER2 강도·막염색 패턴과 PD-L1 CPS·TPS의 적용 범위, 원본 및 기준 검증 기록을 확인할 수 있습니다. HER2 Composite와 CPS·TPS 공동 표시의 조건은 [35번 보관본·검증 자료 연결 절차](work/biomarker-contracts-35.md)에 있습니다.

### 34. Ki-67, ER, PR 결과 검토

**WSI Viewer → IHC Results**에서 셀 표식, 원본과 사용자 리비전, 모델·분석 버전을 확인합니다. 편집 권한이 있으면 개별 셀 판정과 검출 신뢰도 임계값을 변경하고 **Restore Original**로 원본을 복원할 수 있습니다. 임상 수치는 보관본 재현과 기관 승인 범위가 확인될 때 표시됩니다. [34번 보관본 연결·승인 설정·검증 기록](work/ihc-results-34.md)

### 33. Collaborative Review

같은 케이스의 **WSI Viewer → Collaborative Review**에서 세션을 열고 케이스 권한이 있는 동료를 초대합니다. **Follow Driver**, **Stop Following**, **Hand Off Drive**로 스캔·위치·배율 공유를 제어합니다. [33번 공동 판독과 Teams 검토](work/collaborative-review-33.md)

### 32. Collections와 Tumor Board

**Collections and Tumor Board**에서 개인·공유 컬렉션과 Board 회차를 관리합니다. **Worklist → Add to Collection or Board**에서 원본 케이스를 참조로 추가합니다. 회차에서 순서, 메모, **Presented**를 기록하고 기존 케이스·WSI·완료 결과를 엽니다. [32번 권한과 검증 기록](work/case-collections-32.md)

### 31. 분석 실행과 IHC 검토

**Case Details → Requests**에서 모델을 지정해 작업을 실행하거나 자문을 배정합니다. **Model Runs**에서 시도별 상태와 취소·재실행을 확인합니다. **Settings → Analysis Pre-run Rules**에서 염색별 사전 실행을 설정합니다. 배정 병리의는 **IHC Review and Best Block**에서 검토를 저장하고 **Report Draft → Result Evidence**에 버전을 연결합니다. [31번 실행 범위와 검증 기록](work/analysis-execution-31.md)

### 30. ROI 유사검색

저장된 영역 주석에서 **Find Similar ROIs**를 엽니다. 장기계통을 고르면 같은 케이스에 등록한 참조 ROI를 개발용 어댑터로 검색합니다. **Open Match in WSI**와 **Back to Source ROI**로 결과와 원래 판독 위치를 오갑니다. [30번 설정·검증 기록](work/roi-search-30.md)

### 29. 조직 정합과 판독 도구

**Multi View → Tissue Registration**에서 같은 조직의 대응점을 지정해 화면을 동기화하고 별도 확인점의 오차를 확인합니다. 단일 뷰의 **Review Tools**에서 다분절 거리, 도형, 점 계수, 북마크, 보정된 ROI 프리셋을 사용합니다. 저장한 ROI는 PNG로 내보낼 수 있으며, 수기 림프절 계수는 **Report Draft → Result Evidence**에 특정 버전으로 연결합니다. [29번 조작·검증 기록](work/viewer-workflow-29.md)

### 28. 동결절편 예비결과와 OR 확인

**Worklist → Global Views → Frozen Section**에서 케이스를 선택해 **Frozen Report**를 엽니다. 관리자가 지정한 수술실 수신자는 **OR Results**에서 최신 예비결과를 열고 해당 버전을 확인합니다. 배정 병리의는 전화 콜백과 정정을 기록하며 **Published Version History**와 **Case Logs**에서 이력을 확인할 수 있습니다. [28번 권한·시연·검증 기록](work/frozen-workflow-28.md)

### 27. 보고 초안과 LIS 전송

**Case Details → Report Draft**에서 템플릿과 근거 결과를 선택해 초안을 작성합니다. **Dictation Draft**에서 확인한 전사 텍스트를 섹션에 반영하고, 버전별 내용은 **Version History**에서 조회합니다. 배정 병리의 승인 후 연결한 Mock LIS에 명시적으로 전송할 수 있습니다. [27번 역할·설정 및 검증 기록](work/case-reporting-27.md)

### 26. Case Notes와 알림

**Case Details** 또는 **WSI Viewer**의 **Notes**에서 메모, 댓글과 `@username` 멘션을 작성합니다. **Notifications → Notification Preferences**에서 사건별 **In-app**, **Email**, **Push**를 선택하고 **Delivery Status**에서 전송 상태를 확인합니다. 이메일과 Push에는 운영자 발신 설정이 필요합니다. [26번 설정과 검증 기록](work/case-notifications-26.md)

### 25. Case Logs

기관 관리자와 배정 병리의는 **Case Details** 또는 **WSI Viewer**의 **Case Logs**에서 열람·변경·실패를 조회합니다. **User**, **Action**, **Entity**, **Result**, **Target ID**를 조합하고 **View Details**에서 변경 전후를 확인합니다. [25번 검증 기록](work/case-logs-25.md)

### 24. Media와 Gross Images

등록된 임상 케이스의 **Case Details**와 **WSI Viewer**에서 **Media** 또는 **Gross Images**를 엽니다. **Attach PDF**에서 케이스 문서를 등록하고 **Add Gross Image**에서 검체를 선택해 JPEG·PNG를 올립니다. **Download Attachment** 요청은 **Attachment Activity**에 기록됩니다. 서버의 PDF 미리보기는 Poppler(`pdfinfo`, `pdftoppm`)와 Linux `prlimit`을 사용합니다. [24번 검증 기록](work/case-attachments-24.md)

### 23. 환자 임상 History

**Case Details → History** 또는 **WSI Viewer → Patient History**에서 이전 진단 보고서와 진료 기록을 읽습니다. 로컬 환자를 연결한 뒤 **Add Clinical Record**로 수기 기록을 추가합니다. 외부 기록은 **Patient Information**에서 대조를 확인한 환자에 대해 수신 시각과 원천을 표시합니다. [23번 조회 계약과 검증 기록](work/patient-history-23.md)

### 22. 스캔 선택과 뷰어 설정

Worklist의 **Case Preview**에서 포맷과 **Scan** 번호를 확인한 뒤 썸네일을 눌러 해당 원본을 엽니다. 뷰어의 **Case Details**로 돌아가면 같은 스캔이 선택되어 있습니다. **Gallery**에서 썸네일 배치를 바꾸고, **Viewer Settings**에서 라벨·Overview·동적 미니맵, Tray 방향과 Autopan 속도·방향을 설정한 뒤 **Save as Default**를 누르면 재접속 후 복원됩니다. 캔버스에 포커스한 상태에서 `F`는 전체화면, `M`은 미니맵, `G`는 갤러리, `Space`는 Autopan을 제어합니다. [22번 검증 기록](work/viewer-settings-22.md)

### 21. Case Editor와 스캔 QC

**Slide Registration**에서 블록·바코드를 입력하고, 파일 케이스를 확정할 때 로컬 환자를 대조할 수 있습니다. **Case Editor**에서 검체·슬라이드·라벨을 수정하고 OCR 후보를 확인한 뒤 저장합니다. **Scan Quality**에서 수기 판정과 스캐너·AI 관측을 기록하고, 보류된 스캔을 교체할 수 있습니다. [21번 검증 기록](work/case-editor-21.md)

### 20. Workgroup 업무함

**Global Views**에서 Breast, Cytology, Frozen Section을 열거나 구독합니다. 관리자는 **Manage Workgroups**에서 그룹과 구성원을 관리하고, 케이스 상세의 **Workgroup and Priority**에서 분류할 수 있습니다. **Assignment Workload**는 현재 Worklist 결과의 배정별 실제 건수를 표시합니다. [20번 검증 기록](work/workgroups-20.md)

### 19. Worklist 고급 필터

**More Filters**에서 환자·검체·슬라이드·LIS 상태, 날짜 구간·채취일 기준 연령·최근 열람을 조합합니다. **Case Details → Case and Specimen Dates**에서 접수 시각과 검체 채취일을 입력하고, **Save New View**로 조건을 저장합니다. 기본 열과 정렬을 다시 적용하려면 **Restore Default Worklist**를 사용합니다. [19번 검증 기록](work/worklist-filters-19.md)

### 17. 케이스 분석·자문 요청

케이스 상세의 **Requests** 탭 또는 WSI 뷰어의 **Analysis and Consultation Requests**에서 요청을 등록합니다. 담당자는 상단 **Request Notifications**에서 요청을 열고 처리 상태를 저장합니다. 자문 답변과 연결된 PD-L1 스냅샷은 케이스 **Report Draft** 탭에서 참조할 수 있습니다.

PD-L1 요청은 담당자가 보관 결과를 연결하는 흐름입니다. 요청 권한, 상태 전이, 시험과 롤백 절차는 [17번 요청 검증 기록](work/case-requests-17.md)에 정리했습니다.

### 16. Worklist 저장 View

**Multi-Level Sort**에서 최대 세 가지 기준과 각 방향을 선택합니다. **Columns**에서 표시 여부와 순서를 조정한 뒤 **Save My Default Columns**을 누르면 다른 브라우저에도 적용됩니다. 검색, 필터, 탭과 정렬은 **Save New View**에서 저장하고, 원하면 현재 열 구성을 포함할 수 있습니다. **Set as Startup View**한 조건은 다시 접속할 때 적용됩니다.

개인 View는 작성자만 열고 편집할 수 있습니다. 관리자가 만든 기관 공유 View는 같은 기관 계정이 사용할 수 있습니다. 권한·검증과 마이그레이션은 [16번 Worklist 검증 기록](work/worklist-views-16.md)에 정리했습니다.

### 15. Multi View

케이스 뷰어에서 **Multi View**를 열고 같은 케이스의 스캔 2~4개를 선택합니다. 활성 화면에서 **Sync Position**를 켜거나, 각 패널의 중심을 맞춘 뒤 수동 기준점으로 연결할 수 있습니다. 지원 범위와 샘플별 조직 특징점 오차는 [15번 Multi View 검증 기록](work/multi-view-15.md)에 정리했습니다.

### 14. 판독 위치·ROI·거리

WSI에서 **Save Position**, **Rectangular ROI**, **Distance Measurement**을 사용합니다. 저장 위치는 사용자·스캔별로, 주석과 측정은 스캔별로 복원합니다. 사용 방법, 좌표·길이 기준과 롤백은 [14번 뷰어 검증 기록](work/viewer-records-14.md)에 정리했습니다.

### 13. EMR·LIS 어댑터

**Settings → EMR and LIS Integration**에서 기관별 Mock을 설정하고 응답 상태와 수신함을 확인합니다. 케이스 **Patient Information**에서 직접 입력하거나 EMR 후보를 대조한 뒤 승인할 수 있습니다. 초기값은 두 채널 모두 미설정입니다. Mock 메시지 계약, 재시도와 롤백 절차는 [13번 연동 검증 기록](work/emr-lis-13.md)에 정리했습니다.

### 12. PD-L1 CPS·TPS 동시 표시

동일 WSI에서 검체·염색 조건·분석 영역, 두 원본의 모델·분석 버전 및 독립 검증 근거가 일치하는 경우에만 CPS와 TPS를 표시합니다. 현재 개발 서버에서는 기존 예제의 단일 CPS 보관 결과를 열 수 있습니다. 적용 범위와 검증 자료의 형식은 [12번 검토 기록](work/pdl1-scope-12.md)에 정리했습니다.

### 11. 기존 PD-L1 결과 보기

`Worklist → Case Details → Open Viewer`에서 PD-L1 결과가 연결된 스캔을 선택합니다. 9920 개발 서버에는 Case ID가 `04364`로 끝나는 예제의 NDPI와 SVS 원본을 연결했습니다. 뷰어에는 선택한 스캔의 저장 점수와 세포 중심점이 표시됩니다. 영상 아래에서는 **Result Version**, 세포 클래스별 저장 집계, 모델·가중치 기록, 분석 버전, 결과 지문과 **Audit History**을 확인할 수 있습니다.

참조 PDF 42쪽에서 확인한 점수 카드와 세포 클래스 표식을 IMS에 적용했습니다. 점수와 좌표의 원천은 베이스 `d3741bc`의 `marker_pipeline.py` 및 `ai_user_edits.py` 저장 규격입니다. 원본 점수는 저장값을 표시합니다. 기존 수정본 JSON은 세포를 고친 뒤에도 원본 점수를 보존할 수 있어, 해당 점수 카드에는 **Edited Score Unverified**를 표시합니다. 모델 릴리스 번호처럼 저장 근거가 없는 필드는 **No record**으로 표시합니다. 여러 결과가 있으면 버전에서 하나씩 선택합니다.

#### 기존 결과 가져오기

서버에서 비식별 확인을 마친 저장 JSON을 명시적으로 연결합니다. WSI 파일명·크기·OpenSlide quickhash·level-0 크기가 모두 일치해야 하고, 세포 중심 좌표를 WSI 경계 내에서 검증합니다. 원본을 덮어쓰지 않고 `.runtime/pdl1/`에 읽기 전용 스냅샷을 생성합니다. 한 번에 표시하는 세포 수에는 상한을 두며, 상한에 도달하면 화면에 표시합니다. 점수 집계는 원천 파일의 값입니다.

```bash
cd backend
python -s -m app.import_pdl1 --organization local --slide '<data 아래 NDPI 또는 SVS 상대 경로>' \
  --result '<저장 JSON 경로>' --importer '<가져오기 수행자>'
```

수정본에는 `--original <원본 스냅샷 ID>`와 `--editor <확인된 수정자>`를 추가합니다. 보유 자료에 따라 `--saved-at <시간대 포함 ISO 8601>` 및 `--audit '<감사 내보내기 JSON 경로>'`을 지정합니다. 감사 파일은 `action`, `actor`, `occurred_at` 및 선택 `reference`가 있는 이벤트 목록입니다. 화면에 원천에서 가져온 이벤트와 IMS 가져오기 이벤트를 함께 표시합니다. 같은 기관과 케이스의 WSI 읽기 권한을 재사용하며, 등록 담당자에게는 사용자 수정본 조회를 제한합니다.

실제 예제에서는 원본 두 건을 확인했습니다. 사용자 수정본과 원천 감사 이력의 화면 동작은 합성 자료로 검증했습니다. 격리 PostgreSQL 테스트 11개와 통합 브라우저 회귀 테스트가 통과했습니다. Chrome에서는 좌표가 알려진 수정본의 표식 위치와 다른 스캔으로 전환할 때 오버레이가 정리되는 것도 확인했습니다. 이 기능은 저장 결과 열람용이며, 암종별 적용이나 CPS·TPS 동시 표시의 임상 검증은 별도 단계입니다. DB 마이그레이션은 없으며 개발 서버와 같은 작업공간에서 `.runtime/pdl1/`을 보관하면 다시 열 수 있습니다.

### 10. 첫 통합 시연

`scripts/verify-integration.sh`으로 격리 DB와 Chrome에서 로그인, 케이스 검색·배정, NDPI/SVS, 검토 메모 저장과 재로그인을 검증할 수 있습니다. 실패 시나리오와 업무별 계측값, 수동 점검 절차는 [통합 시연 검증 기록](work/integration-demo-10.md)에 있습니다.

### 09. 케이스 배정과 검토

1. 기존 파일 등록 건은 케이스 상세에서 **Confirm Case from Registered Files**을 누릅니다. 확정은 등록 당시의 검체·슬라이드·스캔 정보로 정규 케이스를 만듭니다. 원본 파일과 접수 정보는 보존하며, 확정 후 접수 화면의 변경은 정규 케이스에 자동 반영하지 않습니다. 파일 버전이 달라졌거나, 같은 Case ID가 이미 등록됐거나, 환자 정보가 일치하지 않으면 충돌을 표시합니다. 기존 환자 기록과의 병합은 별도 확인이 필요합니다.
2. 관리자는 케이스 상세의 **Assign Case** 또는 **Reassign**에서 같은 기관의 활성 병리의를 선택하고 사유를 입력합니다. 스캔이 등록되기 전에도 배정할 수 있습니다.
3. 담당 병리의는 **Assigned to Me**에서 케이스를 열어 상세나 WSI 뷰어에서 **Start Review → Review Complete**를 저장합니다. 스캔 한 개 이상이 연결되어 있어야 합니다. 검토 완료는 IMS 내 업무 상태이며 법적 최종 보고는 별도 흐름입니다.
4. **History** 탭에서 이전·이후 상태와 담당자, 변경 사유, 수행자, 시각, 출처를 확인합니다. 최신 50건을 표시하며 추가 이력은 기존 `/api/clinical/{organization}/cases/{id}/history`에서 페이지별로 조회합니다.

| 작업 | 허용 계정 | 상태 전이 |
| --- | --- | --- |
| 최초 배정 | 관리자 | 배정 대기 → 배정됨 |
| 재배정 | 관리자 | 배정됨 또는 검토 중 → 배정됨 |
| 검토 시작 | 현재 담당 병리의 | 배정됨 → 검토 중 |
| 검토 완료 | 현재 담당 병리의 | 검토 중 → 검토 완료 |

검토 완료 상태는 이 단계에서 잠급니다. 동일 버전의 변경이 겹치면 먼저 저장된 요청만 반영하고 이후 요청은 HTTP 409를 반환합니다. **Reload Latest Status**로 갱신 후 변경 내용을 다시 확인합니다. 상태·담당자 변경과 기존의 추가 전용 `clinical_events` 기록은 같은 PostgreSQL 트랜잭션에서 저장합니다. 이번 단계는 기존 마이그레이션 `0003_auth_worklist`를 사용합니다.

개발 서버에는 `local`의 `demo-doctor-a`와 `demo-doctor-b`를 준비했습니다. 초기 비밀번호는 `.runtime/<계정>-initial-password`에 저장됩니다.

Node 22.12.0 빌드와 격리 PostgreSQL 18.6의 `MEDIAUTO_CLINICAL_TEST=1 python -s -m unittest discover -s tests -v`에서 10개 테스트를 통과했습니다. Chrome에서 두 병리의 계정으로 등록 파일 확정, 배정, WSI에서 검토 시작, 재배정, 이전 담당자 조회 차단, 검토 완료, 새로고침 후 감사 이력을 확인했습니다.

### 08. WSI 뷰어

1. 로그인한 뒤 Worklist에서 스캔이 등록된 케이스의 상세를 엽니다.
2. `Open Viewer` 또는 상세 화면의 슬라이드 행을 선택합니다. Tray에서 NDPI와 SVS를 전환할 수 있습니다.
3. 확대·축소 버튼이나 마우스 휠로 배율을 바꾸고, 캔버스를 드래그하거나 미니맵을 눌러 이동합니다. 캔버스에 포커스가 있을 때 방향키, `+`·`-`, `0`도 사용할 수 있습니다.
4. 읽기에 실패하면 `Retry`를 누르거나 Tray에서 다른 스캔을 선택합니다. 일부 타일만 실패했다면 현재 위치와 배율을 유지한 채 해당 타일을 다시 요청합니다.

베이스 `d3741bc`의 Canvas 좌표계와 1·4·8 다운샘플 1024px JPEG 타일 규격을 현재 React·FastAPI에 연결했습니다. `/api/wsi/{source}/{scan_id}`와 하위 미리보기·타일 경로는 스캔 UUID 및 로그인 권한을 확인합니다. 슬라이드 등록 탭에서 등록한 파일은 `local` 기관의 등록 권한으로 열 수 있습니다. 정규 스캔은 상위 케이스의 조회 권한을 따릅니다. NDPI와 SVS가 같은 슬라이드에 등록된 경우 Tray에서 형식을 구분해 표시합니다.

스케일바는 수평 픽셀 크기(MPP)가 기록된 스캔에서 표시됩니다. MPP가 없으면 화면에 픽셀 크기 정보 없음이 표시됩니다. 화면의 퍼센트는 스캔 픽셀 대비 화면 배율입니다. 임상 장비의 색상·길이 교정 확인은 별도로 진행해야 합니다. 이 단계는 DB 스키마를 변경하지 않습니다.

Node 22.12.0 프런트 빌드와 격리 PostgreSQL 18.6의 `MEDIAUTO_CLINICAL_TEST=1 python -s -m unittest discover -s tests -v`를 확인했습니다. Ubuntu 22.04의 같은 서버에서 Chrome 146을 실행해 LAN 주소의 실제 샘플을 열었을 때 클릭부터 미니맵 표시까지 NDPI 318ms, Tray에서 SVS 선택 후 287ms였습니다. 각 수치는 단일 브라우저 세션의 1회 관측입니다. 브라우저에서 실제 JPEG 타일 요청, 확대·팬·미니맵, 케이스와 슬라이드 전환, 실패한 타일 재시도, 이전 요청 취소를 확인했습니다.

### 07. 로그인과 Worklist

베이스 `d3741bc`에서 확인한 JWT 및 역할을 현재 IMS의 개발 계정에 적용합니다. 계정과 세션은 개발 PostgreSQL에 저장합니다. 로그인 세션은 15분 뒤 만료되고 로그아웃 시 바로 폐기됩니다. 기존 SaaS 계정 연동과 MFA는 후속 검증이 필요합니다. 9920은 HTTP 개발 주소이므로 신뢰할 수 있는 개발망과 비식별 샘플에서 사용합니다.

| 역할 | 조회 범위 | 허용 작업 |
| --- | --- | --- |
| `admin` | 소속 기관 전체 | 임상 레코드 등록·변경. `local` 기관은 파일 등록과 파일명 규칙 설정 |
| `labeler` | 소속 기관 전체 | 임상 레코드 등록·변경. `local` 기관은 슬라이드 등록 |
| `doctor`, `viewer` | 본인에게 배정된 케이스 및 그 하위 기록 | 조회 |

`Worklist → Assigned to Me`은 계정 UUID를 사용합니다. 목록에서 Case ID를 대소문자 구분 없이 부분 검색하고 상태와 담당자 필터를 함께 사용할 수 있습니다. 파일 등록 건을 케이스로 확정하면 배정 대상이 됩니다.

개발 계정은 서버에서 생성합니다. 아래 명령은 기존 계정과 겹치지 않는 이름으로 실행합니다. 서버 실행 중에 같은 작업공간의 DB 소켓과 인증 키를 사용합니다.

```bash
conda activate mediauto-studio
export MEDIAUTO_DB_SOCKET="$(pwd -P)/.runtime/pgsocket"
export MEDIAUTO_DB_USER="$(id -un)"
cd backend
python -m app.manage_users --organization local --username pathologist --display-name '개발 병리의' --role doctor
```

초기 개발 관리자 비밀번호를 자동 생성한 경우 파일 위치는 `.runtime/admin-initial-password`입니다. `.runtime/auth.key`는 계정 해싱과 서명에 사용하므로 개발 DB 백업과 함께 접근 권한을 제한해 보관합니다.

`0003_auth_worklist`는 계정·세션 테이블과 `cases.assigned_to`를 추가합니다. 이전 코드로 돌아갈 경우 서비스를 내리고 개발 DB를 먼저 백업한 뒤, 같은 DB에서 `python -m alembic downgrade 0002_clinical_records`를 실행합니다. 다운그레이드하면 계정·세션·배정 연결이 제거됩니다. 이후 이전 코드로 서비스를 시작합니다.

### 06. 정규 케이스 등록·조회 API

로그인한 브라우저에서 `http://127.0.0.1:9920/docs`를 열어 API를 확인합니다. 경로의 `{organization}`에는 로그인 계정의 기관 코드를 지정합니다. 새 등록과 변경 이력에는 수행한 계정 UUID가 기록됩니다.

| 데이터 | 연결과 필드 | 등록 시 출처와 제약 |
| --- | --- | --- |
| 환자 | `patient.id`, `display_name`, `local_reference`, `birth_date` | 수기 출처를 기록합니다. 이름 또는 로컬 식별자 중 하나가 필요하며, 로컬 식별자는 기관 내에서 유일합니다. |
| 케이스 | `case.id`, `case_number`, 선택 `patient_id` | 기관 내 케이스 번호로 중복을 막습니다. 환자 없이 등록한 뒤 명시적으로 연결할 수 있습니다. |
| 검체 | `specimen.id`, `case_id`, `specimen_number`, 선택 `description` | 소속 케이스가 필요하며, 검체 번호의 유일 범위는 케이스입니다. |
| 슬라이드 | `slide.id`, `slide_number`, 선택 `specimen_id`, `stain` | 검체 미연결 상태로 보관하고 나중에 연결할 수 있습니다. 연결된 슬라이드 번호의 유일 범위는 검체입니다. |
| 스캔 | `scan.id`, `slide_id`, `storage_key`, 형식, 파일 크기·수정 시각 | 상대 경로 기준으로 동일 파일의 이중 등록을 막습니다. 하나의 슬라이드에서 NDPI와 SVS를 각각 등록할 수 있습니다. |
| 외부 식별자 | 기관 코드, 원천 시스템, 식별자 종류, 원문 값, 로컬 레코드 UUID | 식별자 조합의 유일성은 개발 DB 기준입니다. 수기 연결 시각을 기록하며 외부 동기화 시각은 비워둡니다. 병원별 정규화와 식별자 정책은 기관 인터페이스에 맞춰 확정합니다. |

`Patient (선택) ← Case ← Specimen ← Slide ← Scan` 관계입니다. 검체에 연결되기 전의 슬라이드도 별도로 조회할 수 있습니다. 생성 API는 `Idempotency-Key` 헤더를 사용하며 같은 요청을 다시 보내면 같은 UUID를 반환합니다. 연결을 바꿀 때는 최신 `version`과 `reason`을 보냅니다. 중복·충돌·이전 버전 저장은 HTTP `409`를 반환합니다. 현재 상태는 등록 단계의 `registered`와 슬라이드의 `unlinked`만 사용합니다. 상태와 연결 변경 전후 값은 추가 전용 `history`에 기록합니다. 아래 명령은 로그인 응답 쿠키를 저장한 `MEDIAUTO_COOKIE_JAR`를 사용합니다.

```bash
curl -b "$MEDIAUTO_COOKIE_JAR" -X POST http://127.0.0.1:9920/api/clinical/local/cases \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: case-example-1' \
  -d '{"case_number":"DEMO-001"}'
curl -b "$MEDIAUTO_COOKIE_JAR" 'http://127.0.0.1:9920/api/clinical/local/cases?unlinked=true'
```

등록·조회 경로는 `/api/clinical/{organization}/{patients|cases|specimens|slides|scans}`입니다. 하위 목록은 `?parent_id=<UUID>`로 조회하고 `PATCH /cases/{id}/patient`와 `PATCH /slides/{id}/specimen`으로 연결합니다. 기관별 외부 ID는 `POST /{종류}/{id}/external-identifiers`로 연결하고 `POST /{종류}/external-identifiers/lookup`으로 조회합니다. 두 경로 모두 케이스·검체·슬라이드와 환자에 적용됩니다. 조회 본문에는 `system`, `kind`, `value`를 보냅니다. 등록·변경 이력은 `GET /{종류}/{id}/history`에서 조회합니다.

`0002_clinical_records`는 새 테이블을 추가합니다. 기존 `application_settings`의 EMR 설정과 슬라이드 등록 정보는 해당 테이블에 유지됩니다. 새 테이블의 데이터는 필요 시 먼저 백업하고, 연결한 개발 DB에서 `python -m alembic -c backend/alembic.ini downgrade 0001_application_settings`로 되돌릴 수 있습니다. `./start.sh`는 실행할 때 최신 리비전을 적용하므로 코드도 함께 이전 상태로 맞춥니다.

격리된 `mediauto_clinical_test` PostgreSQL에 `upgrade head`를 적용한 뒤, `backend/`에서 `MEDIAUTO_CLINICAL_TEST=1 python -m unittest discover -s tests -v`로 API를 검증할 수 있습니다. 테스트는 현재 Conda에 설치된 `httpx`를 사용합니다.

스크립트는 전용 개발 DB `mediauto_studio_dev`를 `.runtime/postgres`에 만들고 Alembic 마이그레이션을 적용합니다. PostgreSQL은 `.runtime/pgsocket`의 로컬 Unix 소켓에만 연결됩니다. 최초 마이그레이션은 EMR 상태를 `미설정`으로 초기화합니다. 스크립트를 다시 실행해도 DB 데이터는 유지됩니다.

서비스가 중지된 상태에서 `MEDIAUTO_HOST=127.0.0.1 ./start.sh`로 실행하면 서버 자체에서만 접속할 수 있습니다. PostgreSQL 실행 파일이 다른 경로에 있다면 `MEDIAUTO_PG_BIN`으로 `bin` 디렉터리를 지정합니다.

### 실행 상태와 중지

`./start.sh`는 `mediauto-studio` Conda 환경으로 서비스를 시작하거나 재시작합니다. 헬스 체크가 통과하면 9920 접속 주소를 출력하고 터미널에 서버 로그를 이어 표시합니다. 사용자 systemd로 실행 중이면 `Ctrl+C`는 로그 보기를 종료하며 서버는 계속 실행됩니다. 사용자 systemd가 없는 환경에서는 같은 터미널에서 서버가 실행되고 `Ctrl+C`로 중지합니다.

```bash
./start.sh --detach  # 서비스 시작 후 터미널 프롬프트로 복귀
./start.sh --logs    # 이미 실행 중인 서비스의 로그 표시
systemctl --user status mediauto-studio-dev.service
systemctl --user stop mediauto-studio-dev.service
```

### 프런트엔드 수정

9920의 API를 실행한 상태에서 `npm --prefix frontend run dev`를 실행합니다. 로컬 Vite 주소 `http://127.0.0.1:5173/`에서 코드 수정이 반영되며, `/api` 요청은 9920으로 전달됩니다. 9920의 화면을 갱신하려면 `npm --prefix frontend run build`로 다시 빌드합니다.
