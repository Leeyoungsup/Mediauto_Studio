# 34. Ki-67, ER, PR WSI 결과 검토

## 참조와 구현 범위

- PDF 39쪽은 Ki-67 세포 오버레이와 결과 카드, 40쪽은 PR 핵 표식과 결과 패널을 보여준다. 업체 발표자는 ROI 선택, 임계값 조정에 따른 결과 변화, 원래 임계값으로 복원을 설명했다. 39–40쪽에 참석자가 임상 집계나 감사 정책을 승인했다는 기록은 없다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- 기존 베이스 `d3741bc`의 `marker_pipeline.py`와 `scoring.py`에서 Quanti IHC의 원본 픽셀 좌표, 클래스, 검출 신뢰도 임계값, Ki-67 양성 종양세포 비율과 ER/PR Allred 계산을 확인했다. IMS의 WSI 인증, 좌표계, PD-L1 캔버스 렌더러, Case Logs를 재사용했다.
- 사용자의 임계값은 Quanti IHC 검출기의 최소 검출 신뢰도다. 병리의가 개별 검출 세포를 0/1+/2+/3+/Other로 판정하거나 기존 판정을 지울 수 있다. 보관본의 별도 `excluded_cells` 목록, 새 검출 생성과 모델 재실행은 편집 범위 밖이다.
- 기관 검증이 적용되면 승인된 소스·설정에서 Ki-67 index 또는 ER/PR Allred와 구성값을 표시한다. 전체 케이스 해석은 병리의가 **IHC Review and Best Block**에서 기록한다. Ki-67 임상 사용과 ER/PR 보고에는 각각 검사법과 품질·해석 기준이 적용된다. [International Ki67 Working Group](https://pubmed.ncbi.nlm.nih.gov/33369635/) · [CAP/ASCO ER/PR 지침](https://documents.cap.org/documents/erpgr_summaryrecommendations.pdf)

## WSI에서 재현

1. **Worklist → Case Details → Open Viewer**에서 결과가 연결된 Ki-67, ER 또는 PR 스캔을 연다. **IHC Results** 카드에서 등급별 셀 수, 모델과 분석 버전을 확인한다. **IHC Cell Overlay**는 표식을 켜거나 끈다. 현재 화면에는 최대 5,000점을 요청하며 잘린 경우 확대 안내를 표시한다. 카드 집계의 범위는 저장된 분석 소스 전체다.
2. 기관 관리자 또는 배정 병리의가 **Latest**를 선택한다. **Pick Cell on Slide**로 표식을 고르거나 **Visible Cell**에서 키보드로 선택한다. 표식의 원본 등급과 검출 신뢰도를 확인한 뒤 **User Cell Grade**, **Minimum Detection Confidence**, **Review Reason**, **Save IHC Review**를 사용한다. 사용자 판정이 저장된 세포는 검출 신뢰도에 관계없이 판정한 등급으로 반영한다. Other는 종양 집계에서 제외한다.
3. **IHC Result Version**에서 **Original**과 과거 리비전을 읽을 수 있다. **Latest**에서 사유를 입력하고 **Restore Original**을 누르면 원본의 신뢰도 임계값과 판정을 복원한 새 버전이 생성된다. **IHC Review History**에서 수행자·시간·사유를 조회하고 **Case Logs → Entity → IHC Result Revision**으로 저장·복원 이벤트를 확인한다.

## 보관본 연결과 승인 조건

이 명령은 프로젝트 루트에서 실행한다. WSI가 `data/` 안에 있어야 한다. ER과 PR이 같은 모델을 사용하므로 운영자가 원천 염색을 확인해 `--marker`를 지정한다.

```bash
cd backend
conda activate mediauto-studio
python -s -m app.import_ihc --organization local --marker ki67 --slide 'sample.svs' --result '/srv/verified-results/quanti-ki67.json'
```

가져오기는 WSI의 파일명·크기·OpenSlide quickhash·원본 해상도, 모델·분석 메타데이터와 경계 내 세포 좌표를 확인한다. 원본 JSON SHA-256을 사용해 기관과 WSI별 `.runtime/ihc/`에 불변 보관본을 생성한다. 원본과 복원본에서는 저장 당시 등급별 집계를 사용한다. 편집본에서는 보관된 검출값과 사용자 변경을 다시 집계한다.

원본 임계값으로 재집계한 등급별 수치가 저장 결과와 일치하고, 아래 조건을 충족할 때 수치 집계가 열린다.

| 승인 확인 항목 | 일치 조건 |
| --- | --- |
| 기관·스캔 염색·원본 | `organization`, `marker`, `source_id` |
| 검출 모델·분석 버전 | `model_version`, `checkpoint_sha256`, `analysis_version` |
| 집계·QC | `rule`은 `quanti-ki67-index-v1` 또는 `quanti-allred-v1`. `reference`, `clone`, `platform`, `protocol`, `scoring_scope`, `minimum_tumor_cells`가 포함된 기관 검증 기록 |
| 사용자 조정 | `confidence_thresholds`에 정확한 설정이 포함돼야 한다. 셀 판정을 반영한 점수에는 `allow_cell_overrides: true`가 필요하다. |

운영 설정 `MEDIAUTO_IHC_VALIDATION_FILE`은 위 필드를 가진 JSON 배열 경로다. 기본값은 미설정이다. 운영자는 승인 조건이 달라지면 승인 파일을 교체하고 검증 근거를 별도로 보관한다. 승인 참조나 가중치 지문이 없거나 적용 범위, 셀 수, 원본 재현 조건이 맞지 않으면 검토용 등급별 셀 수만 조회된다.

## 보관 및 롤백

- `0022_ihc_result_revisions`는 새 리비전 테이블을 추가한다. DB 행은 기관·케이스·등록 스캔·원본 해시를 고정한다. 변경에는 예상 버전과 요청 키를 사용하며, 겹치는 편집은 다시 불러오도록 안내한다. 리비전과 Case Logs 이벤트는 같은 트랜잭션에 기록한다. 로그에는 버전, 임계값, 판정 수와 사유가 남는다.
- 빈 리비전 테이블에 한해 `alembic downgrade 0021_review_room`으로 돌아갈 수 있다. 리비전이 있으면 다운그레이드가 차단된다. 리비전의 근거는 PostgreSQL과 `.runtime/ihc/`에 나뉘므로 함께 보관한다. 승인 설정은 별도로 보관한다.

## 실제 보관본 확인

| 보관본 | WSI 대조 | 원본 표식 수 | 저장된 신뢰도로 재집계할 때 추가된 0등급 수 |
| --- | --- | ---: | ---: |
| Ki-67 | 프로젝트 예제 SVS | 255,151 | 4 |
| PR | 프로젝트 예제 SVS | 229,303 | 1 |
| ER | 베이스의 ER SVS로 격리 확인 | 829,007 | 11 |

세 보관본 모두 가중치 SHA-256과 기관 검증 자료가 확인되지 않았다. 반올림된 신뢰도 때문에 원본 임계값 부근의 오버레이와 저장 당시 집계에도 위 표의 차이가 있었다. 실제 임상 수치와 사용자 검토는 대기 상태다. ER 원본 WSI는 베이스에 있어 프로젝트 `data/` 예제에 포함되지 않는다.

## 검증 결과

- Ubuntu 22.04.5, AMD Ryzen Threadripper PRO 5965WX, Python 3.10.20, PostgreSQL 18.6, Node 22.12.0, Chrome 146.0을 사용했다. `MEDIAUTO_DEMO_PORT=19945 scripts/verify-integration.sh`에서 TypeScript·Vite 빌드, 백엔드 테스트 43개, Chrome 시나리오 21개가 통과했다. 필드·화면 검증의 임상 승인 자료는 합성했다.
- Chrome에서 세 표지자 카드·오버레이와 승인 유무, 셀 클릭, 판정·임계값 저장, 새로고침 후 복원, 이전 버전 열람과 원본 복원을 확인했다. API는 배정·역할 범위, 케이스 이동 후 이전 이력 접근 차단, 동시 중복 저장, 버전 충돌, 부족한 종양세포 수와 Case Logs를 확인했다.
- 실제 세 SVS와 보관본을 격리 PostgreSQL에서 연결했다. 단일 1520×1010 Chrome에서 케이스 진입부터 카드 및 오버레이가 모두 보일 때까지 Ki-67 1,066ms, ER 1,751ms, PR 668ms를 측정했다. 세 보관본의 원본 등급별 집계와 수치 집계 차단을 확인했다. 이 측정은 동일 호스트의 단일 자동화 실행이다. 임상 사용성 평가는 진행되지 않았다.
- 격리 PostgreSQL에서 `0021 → 0022 → 0021 → 0022`와 `alembic check`를 통과했다. 리비전이 있는 DB의 다운그레이드 차단도 확인했다.
- 개발 DB를 `.runtime/before-ihc-results-0022-20261124T202507.dump`에 백업한 뒤 9920에 적용했다. 기존 데이터에 대한 사전·사후 확인, 인증·미등록 스캔 처리와 EMR 미설정을 확인했다. 9920 Worklist에서 끝 번호 `00194`인 기존 파일 예제의 Ki-67·PR 카드와 표식을 실제 Chrome으로 열었다. 이 파일 예제는 읽기 전용이다. 임상 케이스로 등록된 스캔에서 관리자 또는 배정 병리의로 편집할 수 있다.
