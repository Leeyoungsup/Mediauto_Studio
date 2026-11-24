# 35. HER2와 PD-L1 결과 계약 및 검증 근거

## 참조와 적용 범위

PDF 41쪽에서 HER2 패턴 카드와 조직 영상의 표식을, 42쪽에서 PD-L1 CPS·TPS 카드와 세포 표식을 확인했다. 발표자는 HER2 막염색의 partial/complete, strong/weak와 Composite를 설명했다. 페이지에 Composite 공식, IMS 모델 검증 데이터 또는 참석자의 적용 승인 기록은 없다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)

베이스 `d3741bc`의 `scoring.py` 및 `marker_pipeline.py`를 확인했다. HER2 보관본은 기존 IHC 스캔 연결·리비전·오버레이를 재사용한다. PD-L1은 12번의 원본·수정본, 검산, 쌍 비교와 스캔 권한을 확장한다.

| 출력 계약 | 모델·입력 적용 범위 | 저장 결과와 검증 조건 |
| --- | --- | --- |
| `her2-intensity-v1` | `Precise_IHC_HER2_detection.pt`의 0+/1+/2+/3+ 강도 클래스 | 원본 가중 평균을 소수 셋째 자리에서 검산한다. 이 결과에는 막의 완전성 데이터가 없다. 강도별 셀 수와 표식은 검토용으로 열리며, 수치 표시에는 일치하는 원천 재현과 기관 기준 결과가 필요하다. |
| `her2-membrane-patterns-v1` | 침윤성 유방암 조직, 해당 HER2 클론·장비·프로토콜·영역에서 검증된 모델의 명시적 패턴 출력 | 클래스 0 Absent, 1 Partial Weak, 2 Partial Strong, 3 Complete Weak, 4 Complete Strong. 명시적 Composite 값 및 단위와 패턴별 기준 셀 수가 일치할 때 저장값을 읽는다. |
| `pdl1_flat_5class` | 위선암 원래 범위, `PDL1_ST_CPS_detection.pt` | 저장 CPS와 종양 양성·음성 및 면역 양성 수를 검산한다. |
| `tps_3class` | 비소세포폐암 원래 범위, `PDL1_TPS_detection.pt` | 저장 TPS와 종양 양성·음성 수를 검산한다. |
| CPS·TPS 공동 표시 | 동일 WSI, 검체, 조직형, 염색, 클론, 장비, 프로토콜, 영역 | 정확한 두 원본과 해당 모델별 기준 결과를 연결한 비교 근거가 필요하다. 각 결과의 오버레이는 선택한 원본에 대응한다. |

HER2의 저장 가중 평균과 입력 별 Composite는 모델 출력이다. 유방 HER2 검사와 임상 보고는 별도 기준을 적용한다. [CAP/ASCO HER2 검사 지침](https://www.cap.org/cap-guidelines/her2-testing-in-breast-cancer-2023-guideline-update/)

## 서버 계약과 기준 결과 연결

1. **HER2**는 `cd backend`에서 `python -s -m app.import_ihc --organization local --marker her2 --slide sample.svs --result /path/result.json`으로 가져온다. 기준 WSI는 `data/` 아래에 두고 파일명·크기·OpenSlide quickhash·원본 치수를 확인한다. 베이스 강도 파일은 `marker: "HER2"`에 기존 `her2_score`를 사용한다.
2. 패턴 파일의 추가 필드는 `score_schema: "her2-membrane-patterns-v1"`과 `input_context`다. `her2_score`에 `score_type: "HER2 Composite"`, `composite`, `unit`(`index` 또는 `percent`), `total_tumor`, 클래스 0–4의 `class_counts`를 제공한다. `cells`는 기존 Quanti 좌표 계약의 `[x, y, class, confidence, x0, y0, x1, y1]`이고 표식 중심은 WSI level-0 픽셀이다. 어댑터에서 모델의 출력 클래스를 위 계약으로 명시적으로 매핑한다. 임상 판독 등급 또는 다른 모델 점수로 변환하지 않는다.
3. **PD-L1**은 기존 `app.import_pdl1 --validation-context`를 사용한다. HER2 `input_context`와 PD-L1 `input` 모두 `specimen_ref`, `histology`, `stain`, `clone`, `platform`, `protocol`, `region_ref`로 구성된다. 모델 이름, 체크포인트 SHA-256과 분석 버전을 기록한다. 식별자는 비식별 검증 자료 태그를 사용한다.
4. 각 WSI의 기존 보관 경로 아래 `validation-evidence.json`을 배열로 작성한다. HER2는 `.runtime/ihc/<organization>/<WSI signature digest>/`이고 PD-L1은 `.runtime/pdl1/<organization>/<WSI signature digest>/`이다. 원본별 키는 `snapshot_id`, `source_digest`, `model`, `checkpoint_sha256`, `analysis_version`, `schema`, `context`, `reference`, `reviewed_by`, `reference_result`다. 마지막 객체에 `value`와 `counts`를 넣고 HER2 Composite에는 원본과 같은 `unit`을 넣는다. `reference`는 해당 검체·모델·분석 버전의 독립 기준 판독 보고서 ID다. 원본 1건에 일치하는 기준 결과 1건만 허용한다. 기준 수와 저장 수가 정확히 같아야 하며 점수는 계약의 저장 정밀도로 검산한다.
5. **CPS/TPS 공동 표시**에는 이전 12번 `comparison-validation.json`을 사용하면서 신규 공동 검증에는 `evidence_version: 1`을 지정한다. `cps_reference`와 `tps_reference`가 각각 4번의 검산 가능한 기준 결과 ID와 일치해야 한다. 이전 형식의 비교 링크는 보존하고 화면에서 기준 수치 검증 여부를 구분한다. 파일을 제거하거나 조건이 달라지면 다음 조회에서 비교가 다시 평가된다.

기관 기준 판독과 검증 승인 문서는 서버 카탈로그 밖에서 관리한다. 환자 식별정보나 문서 본문을 넣을 필요가 없다. 기준 결과 연결 및 범위 검증은 질환별 실제 검사 성능 평가와 구분한다.

## WSI에서 재현

- **Worklist → Case Details → Open Viewer**에서 연결한 HER2 스캔을 연다. **HER2 Results → Result Contract and Validation**에서 적용 범위, 검증 문서 ID와 기준 결과를 확인한다. **IHC Result Version**에서 이전 리비전과 원본을 열 수 있다. 관리자 또는 배정 병리의가 분류와 임계값을 바꾸면 해당 수정본의 Composite는 숨긴다. **Restore Original**로 원본을 복원하면 승인 조건을 다시 평가한다.
- PD-L1 스캔에서 **Result Version**을 변경하고 **Result Contract and Validation**을 연다. 검증된 쌍은 **Combined Display Validation Evidence**에서 비교 문서와 모델별 문서를 보여준다. 편집본의 수치는 숨기고 **View Original**로 해당 원본을 연다.
- 스키마는 기존 `0022_ihc_result_revisions`를 사용한다. DB 마이그레이션은 없다. 검증 회수는 운영 카탈로그 파일을 보관한 뒤 제외하는 방식으로 수행한다. 34번 빌드로 되돌릴 때는 해당 빌드가 HER2 클래스를 표시할 수 없으므로 HER2 원본 디렉터리를 기존 IHC 검색 경로 밖으로 보관한 뒤 재시작한다. 검토 이력은 기존 DB에 유지한다.

## 확인된 보관 자료

로컬 `00194` 예제의 실제 HER2 SVS와 베이스 강도 보관본을 대조했다. 강도 보관본에는 248,003개의 원본 검출 좌표가 있다. 막 완전성 패턴·Composite의 기관 정답과 승인 자료는 확인되지 않았다. PD-L1은 기존 보관 CPS를 유지하며 실제 CPS·TPS 공동 검증 자료는 대기 상태다.

## 검증 결과

- Python 3.10.20, PostgreSQL 18.6, Node 22.12.0과 Chrome 146.0에서 `MEDIAUTO_DEMO_PORT=19945 scripts/verify-integration.sh`를 실행했다. TypeScript/Vite 빌드와 `alembic check`를 통과했다. PostgreSQL·단위 테스트 46개와 Chrome 시나리오 22개가 통과했다.
- 합성 자료로 HER2 패턴 누적과 검증된 Composite, 수정본 수치 차단, 원본 복원과 기준 결과, CPS·TPS 공동 표시, 출처 추적과 기준 결과 제거 후 수치 차단을 확인했다. 비교 시 참조의 값·단위·집계·원본 ID·패턴 스키마·검체/분석 범위 불일치를 검사한다.
- 9920의 기존 `00194` 파일 예제에서 실제 HER2 강도 오버레이와 수치 보류를 확인했다. `04364` 예제에서 기존 보관 CPS, 적용 범위와 CPS·TPS 공동 근거 미확인을 확인했다. EMR은 미설정 상태였다. 임상 사용자 평가와 기관 승인 자료 연결은 진행되지 않았다.
