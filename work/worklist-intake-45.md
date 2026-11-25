# 45. Worklist에서 접수·환자·스캔 QC까지

[43번 프런트 비교](pdf-frontend-review-43.md)의 후속 작업이다. PDF 14–22쪽에서 관찰한 업무함, 저장 View, 필터·컬럼·정렬, 스캔 미리보기와 29쪽의 Case Editor 및 라벨 오류 복구를 참고했다. 실제 기관 스캐너·LIS 동작은 기존 계약 범위에서 별도로 확인한다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)

| 화면 | 현재 동작 |
|---|---|
| Worklist | 업무함 바로 아래 **Global Views**와 **Saved View**를 모았다. 검색·담당자·상태·정렬·컬럼·**More Filters**는 같은 검색 도구 영역에 배치한다. 적용된 상세 조건은 개별 해제할 수 있으며 **Clear Filters**는 검색과 상태·담당자·상세 조건을 초기화한다. 다른 Global View를 열면 해당 큐 조건으로 시작한다. **Clear Queue**는 업무함 조건을 해제한다. |
| 표시·정렬 | **Columns**에서 표시 여부, 드래그 또는 이동 버튼으로 열 순서, **Show Columns Saved to View** 토글을 사용할 수 있다. 토글을 끄면 계정의 기본 컬럼을 표시한다. **Multi-Level Sort**의 순서를 직접 바꾸며 표시된 첫 번째 정렬 열에 방향을 표시한다. 개인/조직 저장 범위 및 시작 View는 기존 설정을 따른다. |
| Case Preview | **Assign Case / Reassign Case**는 관리자에게 최신 버전과 해당 업무함에서 배정 가능한 병리의를 불러온다. 접수 권한자는 **Case Editor** 또는 **Review Scan QC**로 이동한다. QC 보류·재스캔 상태에서 Viewer는 열리지 않으며 **Review Scan QC**는 해당 스캔의 검체와 슬라이드를 펼친다. 상세에서 Worklist로 돌아올 때 현재 필터 내의 같은 케이스 선택을 복원한다. |
| Slide Registration | **Enter Manually → Save Slide Details → Continue to Case Editor**로 이어진다. 아직 생성하지 않은 케이스는 등록 파일과 환자 일치 여부를 확인한 뒤 생성하고 Case Editor를 연다. 기존 Case ID면 해당 Case Editor를 열며 추가 스캔은 기존 **Add Scan** 절차를 사용한다. EMR 상태와 로컬 접수 가능 여부를 표시한다. |
| Case Editor | **Register Case** 직후 또는 Case Preview에서 진입한다. 미연결 환자는 **Patient Reconciliation**에서 로컬 환자를 찾거나 **Enter Patient Manually**로 등록한다. 검체·블록·스캔 수와 QC 보류 수를 표시하며 기존 검체·블록·스캔 편집, 라벨, QC 및 교체 저장을 연결한다. |

모든 화면은 기존 MeDIAuto Studio 테마와 영어 표시를 사용한다. 현재 배정·환자 확인·스캔 QC·감사 API와 버전을 재사용했다. DB 마이그레이션은 없다.

## 재현

프로젝트 루트에서 [Playwright 준비 방법](integration-demo-10.md)에 따라 격리 검증을 실행한다.

```bash
export MEDIAUTO_WORKFLOW_EVIDENCE_DIR="$PWD/.runtime/workspace-45"
MEDIAUTO_DEMO_PORT=19981 scripts/verify-integration.sh
```

1. 관리자 Worklist에서 Case ID를 검색하고 **More Filters**, **Columns**, **Multi-Level Sort**를 적용한다. View로 저장하고 다시 로그인해 복원, 열 토글, 정렬 방향, 빈 결과에서 조건 해제를 확인한다.
2. 배정 가능한 합성 케이스의 **Case Preview**에서 **Assign Case / Reassign Case**를 연다. 후보와 사유 입력을 확인한다. 이미 검토 완료된 케이스나 배정 권한이 없는 역할에서 저장 동작이 표시되지 않는다.
3. 등록 전 파일에 스캔 정보를 수기로 넣고 **Continue to Case Editor**를 누른다. 로컬 환자 대조 후 등록을 확정하고, 검체·블록·스캔을 확인한다. 다른 케이스는 **Register Case → Enter Patient Manually**로 수기 등록한다.
4. 사례의 QC를 **Rescan Required**로 기록한다. Worklist로 돌아가 같은 케이스의 **Review Scan QC**를 연다. 올바른 스캔과 교체 폼이 열리는지, 보류된 원본은 차단되고 교체 스캔은 열리는지 확인한다.

## 검증 기록

- Linux, Node 22.12.0, Python 3.10.20, 임시 PostgreSQL 18.6, Chromium 146에서 합성 케이스와 NDPI/SVS 샘플을 사용했다. Vite 빌드, Alembic 검사, 백엔드 테스트 59개와 최종 Chromium 시나리오 28개가 통과했다. [브라우저 실행 로그](../.runtime/workspace-45/browser-final.log)
- 별도 일반 시연 `--demo general`에서 미설정 EMR의 스캔 접수, 로컬 환자 대조·별도 수기 환자 등록, 검체·블록, 라벨 오류 복구, QC 보류·교체, 보고 정정·Mock LIS ACK가 통과했다. 집중 검증 첫 실행에서 현재 검색을 유지한 채 큐를 전환하면 기존 시작 View의 검색어가 큐 결과를 가리는 점을 확인해, 큐 선택을 새 조회로 처리했다.
- LAN 9920의 `/api/health` 200과 새 프런트 자산을 확인했다. 기관 실장비와 실제 사용자의 업무 검토는 대기 중이다. [Worklist의 QC 진입](../.runtime/workspace-45/general-intake-worklist-scan-qc.png) · [Case Editor 교체 화면](../.runtime/workspace-45/general-intake-replacement-scan.png)
