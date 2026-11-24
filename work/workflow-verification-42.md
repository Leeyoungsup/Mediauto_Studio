# 42. PDF 전체 워크플로우 통합 검증

이 검증은 접수·스캔 QC → 배정·판독 → 보고 승인 → 정정 → 감사의 일반 경로와 Frozen, Tumor Board, IHC, Pap, 공동 판독의 독립 시연을 다룬다. [화면 34개·기능 ID 96개 대조표](workflow-feature-matrix-42.md)에 각 항목의 코드/E2E 근거와 남은 범위를 연결했다.

## 근거와 검증 환경

- **화면에서 관찰** · PDF 14–47쪽에서 Worklist·뷰어·OR·보드·AI·Pap 기능을 대조했다. §8의 96개 중복 제거 ID를 원문과 비교했다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- **업체 설명** · 6분할과 자동 정합, 외부 AI 및 Teams, 기관 시스템 연동·운영 승계가 발표에 포함됐다. 현 구현에서는 4분할·수동 기준점·로컬 공동 판독과 승인 환경 대기 상태를 확인한다.
- **회의 참석자 의견** · PDF에서 병리의·병리사의 업무 범위 확인과 CPS/TPS 적용 확대가 논의됐다. 환자 결과를 포함하는 임상 수락 시험은 기관 사용자·장비·권한과 별도로 진행할 항목이다.
- **자체 검증 기준** · 일반 경로는 하나의 합성 케이스 ID를 접수·스캔 교체·판독·원본 보고·정정·감사에서 유지한다. 각 전문 경로에서 해당 역할, 실패와 복구, 원본·수정 이력을 확인한다. 베이스 `d3741bc`의 존재를 확인했고, 기존 FastAPI·React 앱·WSI/타일 및 27개 브라우저 시나리오를 재사용했다.
- Linux x86_64, AMD Ryzen Threadripper PRO 5965WX, 루프백, Python 3.10.20, PostgreSQL 18.6, Node 22.12.0, Chrome 146.0.7680.164. 동시 Chrome 세션은 공동 판독 2개, 역할/권한 시나리오 2–4개를 사용한다. NDPI/SVS는 로컬 샘플을 사용했고 환자·임상 보고·모델 결과·외부 메시지는 합성했다. 기존 DB와 DDL 변경 없이 격리 PostgreSQL에서 실행했다.

## 독립 시연

| 명령 인자 | 역할별 관찰 경로 | 확인할 결과와 예외 |
|---|---|---|
| `general` | 접수 관리자 **Slide Registration → Case Editor → QC**. 배정 관리자 **Assign Case**. 병리의 **Open Viewer → Start Review → Review Complete → Report** | 같은 `IMS-QA-EDITOR`에서 수기 대조, 라벨 오류 복구, 보류된 원본 스캔의 접근 차단, 교체 스캔 판독과 재접속 후 기록 보존. 보고 원본 V3·정정 V7 각각 승인 → Mock LIS ACK → Case Logs. 배정되지 않은 사용자 차단. 별도 `IMS-DEMO-101`에서 NDPI/SVS 전환·타일 503 복구. |
| `frozen` | 실험실 관리자 **Authorize Recipient**, 병리의 **Frozen Section → Frozen Report**, OR 수신자 **OR Case Queue** | 최초 예비보고 V1과 절제연 → 확인 실패 기록·새로고침 후 기존 V1 ACK 복원 → 전화 read-back 저장 → V2 정정 → OR 화면에서 새 버전 재확인. V1·V2와 당시 확인·콜백·열람 이력을 조회한다. |
| `tumor-board` | 회의 준비자 **Collections and Tumor Board → New Board Meeting → Add Case Reference**. 참석자 **Slides and Completed Results** | 업무함에서 안건 추가, 순서·메모 정정, Presented, 정확한 SVS와 완료 자문 열기. 참석자의 케이스 권한 및 컬렉션 권한 교차 적용, 비회원 차단과 실시간 권한 회수. |
| `ihc` | 검토자 **IHC Results → Cell Overlay → Save IHC Review → Restore Original**. 배정 병리의 **IHC Review → Best Block → Report** | Ki-67 점수 66.67% → 판정/임계값 변경 100% → 원본 복원 66.67% 및 변경 이력. ER/PR과 승인 자료 없는 점수 제한, HER2/PD-L1 계약·근거 회수, Best Block 보고 참조와 버전 고정 보관 결과 재실행. |
| `pap` | 기관 설정 관리자 **Pap Review Policy**, 1차 검토자 **Pap Gallery → Pap Review**, 병리의 **Complete Follow-up Review** | 범주·후보·좌표와 재접속, 적절성/해석/미생물, 1차 제출·반려·후속 완료·재개, 용어 버전 고정과 감사. 별도 연관 환자 픽스처에서 권한/검체·환자 일치 검증, Pap–생검 독립 비교와 해제. |
| `collaboration` | 세션 운영자와 초대된 병리의가 각 Chrome 세션에서 **Collaborative Review → Follow Driver → Hand Off Drive** | 스캔·팬·줌 동기화, Follow 중지와 독립 탐색, 오프라인 및 새로고침 이후 재접속, 진행권 인계와 권한 회수, 인계 감사. |

전용 도구 안에서 완료하는 Board·IHC·Pap·공동 판독 검증과 일반 보고의 승인/정정은 각자의 기록을 조회한다. IHC Best Block 및 림프절 계수의 보고 참조는 해당 시나리오에서 별도로 연결한다. Frozen 예비보고는 OR 확인 및 콜백 이력을 유지한다.

## 재현

Playwright·Chrome은 [10번 준비 절차](integration-demo-10.md)를 사용한다. 프로젝트 루트에서 실행한다.

```bash
# 전체 회귀 및 시연 근거 저장
export MEDIAUTO_WORKFLOW_EVIDENCE_DIR="$PWD/.runtime/workflow-42"
MEDIAUTO_DEMO_PORT=19942 scripts/verify-integration.sh

# 독립 재실행. 아래 시연명 중 하나를 선택
scripts/verify-integration.sh --demo general
scripts/verify-integration.sh --demo frozen
scripts/verify-integration.sh --demo tumor-board
scripts/verify-integration.sh --demo ihc
scripts/verify-integration.sh --demo pap
scripts/verify-integration.sh --demo collaboration
```

`--demo`는 지정 시연의 픽스처 준비와 Chrome 시나리오만 실행한다. 실사용 역할 점검은 격리 환경에서 위 표의 순서대로 진행하고 작업 완료, 잘못 열린 환자/스캔, 조작, 시간, 오류·재시도, 도움 요청과 의견을 역할별로 기록한다. 자동 재현과 실제 임상 사용자 검토의 결과는 아래에서 구분한다.

## 실행 결과와 역할별 측정

| 실행 | 결과 |
|---|---|
| `MEDIAUTO_DEMO_PORT=19942 scripts/verify-integration.sh` | **PASS** · TypeScript/Vite, Alembic 적용과 드리프트 검사, PostgreSQL 백엔드 58개, Chrome 27개 |
| `scripts/verify-integration.sh --demo <시연명>` | **PASS 6/6** · 각 시연의 별도 DB와 Chrome 세션 |
| 기관·실제 사용자 수락 시험 | **NOT RUN** · 승인 환경 및 실제 역할별 참여자 대기 |

일반 기준 케이스에서 로그인 화면부터 관리자 배정 반영까지 0.869초·9회 조작·2회 전환, 병리의 검토 완료까지 3.325초·24회 조작·3회 전환이었다. 상세에서 첫 NDPI 표시까지 391ms, NDPI에서 SVS까지 365ms, 확대/팬 반응은 44/76ms였다. 정상 경로 오류·재시도는 각각 0회였다. 로그인과 타일 실패를 각각 주입해 재시도 2회를 확인했다.

아래는 각 독립 실행의 역할별 Chrome 계측이다. 조작은 클릭·선택·확정된 입력 변경을, 전환은 같은 브라우저의 경로 변경을 센다. 시간은 해당 역할의 첫 조작부터 마지막 조작까지이며 역할 교대 대기가 포함될 수 있다. HTTP 오류 열은 페이지가 받은 API 4xx/5xx를 센다. API로 직접 주입한 오류와 오프라인 연결 취소는 본문과 해당 시나리오 로그에 기록한다. 자동 입력과 샘플 데이터의 측정치이며 실제 사용자 업무 시간에 대한 기준값은 아직 없다.

| 시연 | 역할 | 조작 | 전환 | 시간(초) | HTTP 4xx/5xx | 재시도 클릭 |
|---|---|---:|---:|---:|---:|---:|
| 일반 · 접수 | 접수 관리자 | 46 | 4 | 2.180 | 2/0 | 1 |
| 일반 · 판독/보고 | 배정·보고 관리자 | 22 | 2 | 3.061 | 0/0 | 0 |
| 일반 · 판독/보고 | 배정 병리의 | 21 | 2 | 4.981 | 0/0 | 0 |
| 일반 · 판독/보고 | 미배정 병리의 | 0 | 0 | 0.000 | 1/0 | 0 |
| Frozen | 실험실 관리자 | 3 | 0 | 0.056 | 0/0 | 0 |
| Frozen | Frozen 병리의 | 19 | 1 | 1.115 | 0/0 | 0 |
| Frozen | OR 수신자 | 9 | 1 | 5.163 | 0/0 | 0 |
| Tumor Board | 보드 준비자 | 60 | 8 | 4.375 | 0/0 | 0 |
| Tumor Board | 보드 참석자 | 4 | 6 | 1.098 | 2/0 | 0 |
| Tumor Board | 비회원 | 0 | 0 | 0.000 | 2/0 | 0 |
| IHC | IHC 검토자 | 18 | 2 | 1.909 | 0/0 | 0 |
| Pap | 용어 관리자 | 9 | 0 | 0.201 | 0/0 | 0 |
| Pap | 1차 검토자 | 8 | 0 | 1.118 | 0/0 | 0 |
| Pap | 대체 검토자 | 3 | 0 | 0.231 | 0/0 | 0 |
| Pap | 후속 병리의 | 12 | 0 | 1.682 | 0/0 | 0 |
| 공동 판독 | 세션 운영자 | 18 | 1 | 6.430 | 0/0 | 0 |
| 공동 판독 | 초대 병리의 | 6 | 0 | 5.133 | 0/0 | 0 |

역할별 JavaScript 오류는 0건이었다. 일반의 라벨 오류·미배정 사용자와 보드의 비공유 컬렉션·권한 회수는 실패/거부를 의도한 구간이다. Frozen은 OR 확인 문제 1건을 기록한 뒤 승인하고, 정정 뒤 새 버전이 별도 ACK를 요구하는 것을 확인했다. 공동 판독 독립 실행에서 1회 오프라인과 1회 새로고침을 시험했다. 동기화 스캔 전환 509ms, 팬 365ms, 재접속 797ms, 진행권 인계 916ms였으며 동기화 후 중심·배율 차이는 두 세션에서 0이었다.

시연 화면은 합성 데이터가 보이는 패널만 저장했다. [일반 · 판독/보고](../.runtime/workflow-42-independent/general-report-approved-correction.png) · [Frozen](../.runtime/workflow-42-independent/frozen-corrected-and-acknowledged.png) · [Tumor Board](../.runtime/workflow-42-independent/tumor-board-presented-agenda.png) · [IHC](../.runtime/workflow-42-independent/ihc-restored-result-and-audit.png) · [Pap](../.runtime/workflow-42-independent/pap-completed-follow-up.png) · [공동 판독](../.runtime/workflow-42-independent/collaboration-drive-handoff.png)

수집 원본은 `.runtime/workflow-42-independent/`의 역할별 JSON과 시연별 로그, `.runtime/workflow-42/run.log`의 전체 실행 기록에 있다. 첫 개발 실행에서 검토 상태를 가리키는 선택자와 음성 모의 응답 설치 시점을 수정했고 전체와 일반 독립 실행에서 재검증했다. 라벨은 수기로 확정했다. OCR 실행 파일 및 실제 음성 인식 정확도는 이번 시험 범위에서 대기 중이다.

## 남은 검증

- **기관/임상 사용자 검토 NOT RUN** · 실제 스캐너·LIS 게시·EMR 환자 대조·PACS/VNA 보관, OR 장비/실제 콜백 시간, Teams, 외부 검색·AI·이메일·Push, 승인 저장/복구 환경. 실제 병리과 의사, 병리사, OR 및 보드 사용자 역할의 사용성 평가도 대기 중이다. [41번 기관 연동](institution-integration-41.md)
- **PDF 대비 남은 제품 범위** · 기관 DICOM Metadata 뷰, 림프절 계수의 자동 Notes 동기화, 컬렉션 트리형 다중 선택, 6 pane·자동 조직 정합, 모델별 미지원 출력과 자동 표피 회전. 세부 항목은 대조표에 기록했다. [기능별 대조표](workflow-feature-matrix-42.md)
- 이번 작업은 검증·기록 변경이므로 애플리케이션이나 DB 롤백이 필요한 릴리스는 없다. `AGENTS.md`의 42번 체크 상태는 사용자 확인을 기다린다.
