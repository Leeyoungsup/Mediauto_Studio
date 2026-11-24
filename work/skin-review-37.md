# 37. 피부 병리·흑색종 WSI 검토

## 참조와 지원 범위

- PDF 44쪽에는 사각형 계수 영역과 결과 카드가 보인다. 발표자는 유사분열 후보·밀도 Heatmap, 1 mm² 및 수동 0.2 mm² 계수 방식을 설명했다. 자료에는 검출 민감도, 위양성률, 면적 검증이나 참석자 승인 기록이 없다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- 베이스 `d3741bc`와 로컬 모델·보관본을 확인했으며 전용 피부·흑색종 모델 또는 검증된 표피 방향·유사분열 출력은 확인되지 않았다. IMS의 등록 WSI 접근·QC, 레벨 0 좌표, 카메라, 케이스 감사 로그를 재사용했다. 모델 파일에 표피 표면 방향 또는 조직 도형이 있을 때 해당 기하를 그대로 표시한다.
- `Reviewed Density`는 사용자가 확인한 점 수를 화면에 표시된 계수 영역의 실제 mm²로 나눈 작업 지표다. 모델 Heatmap은 원본 후보 밀도(candidates/mm²)다. 임상 보고용 유사분열률에는 대상 조직·열람 영역과 별도의 병리의 검토 기준이 필요하다. [CAP 침윤성 피부 흑색종 절제 프로토콜](https://documents.cap.org/documents/New-Cancer-Protocols-March-2025/Skin.Inv_Melanoma.Res_1.2.0.0.REL.CAPCP.pdf)

## 화면과 권한

1. 등록된 H&E 임상 WSI에서 **Skin Review**를 연다. **Analysis Source**에서 보관 원본 또는 **Manual Review**를 선택한다. 보관 결과의 **Epidermal Orientation and Regions**, **Model Heatmap**, **Candidate Markers**를 독립적으로 확인한다. 화살표는 보관본의 시작점에서 표피 표면 방향으로 그린다.
2. **Count Field**에서 계수 영역을 선택하고 **Focus Count Field** 또는 후보 버튼으로 화면을 이동한다. 영역 안의 후보만 목록과 계수에 반영한다. **Confirmed**, **Rejected**, **Pending**을 구분하며, 변경에는 **Review Reason**이 필요하다.
3. 모델 없이도 **Manual Review → Count Field Area → Place Count Field**를 사용한다. 원하는 0.2 또는 1 mm²를 지정하고 영상에서 중심점을 클릭한다. **Mark Mitosis**로 영역 내 클릭을 추가하면 확인 수에 포함된다. 기존 점이나 같은 위치의 동일한 계수 영역 중복을 차단한다. 잘못 추가한 표식은 결정 변경으로 정정하고, 수기로 만든 영역은 **Remove Count Field**로 제거할 수 있다.
4. **Skin Review History**에서 최신 50개 작업의 사용자·사유·버전·이전과 이후 판정을 확인한다. **Case Logs**에서 `skin_review_revision` 대상으로 감사를 조회할 수 있다. 케이스 조회 권한에 따라 결과를 열고, 기관 관리자와 배정 병리의가 수정한다. 같은 리비전 경합은 다시 불러오도록 안내한다.

## 원본 계약 및 보정

```bash
cd backend
conda activate mediauto-studio
python -s -m app.import_skin --organization local --slide sample.svs --result /path/skin-export.json
```

- `schema_version: "skin-review-v1"`, `scope: "cutaneous_histology"` 또는 `"cutaneous_melanoma"`, `stain: "H&E"`를 기재한다. `source`는 파일명·크기·OpenSlide quickhash·레벨 0 치수다. `binding`은 내부 `case_id`, `specimen_id`, `slide_id`, `block_id`(없으면 null)다. 파일 키 또는 케이스·검체·블록이 변경되면 기존 수기 기록을 새 스캔에 자동 적용하지 않는다.
- `model`은 `name`, `version`, `checkpoint_sha256`을 포함한다. 원본에 `analysis_version`과 `analyzed_at`을 적고 `capabilities`에는 모델이 제공하는 출력 종류만 선언한다.
- 원본 구조는 `orientation`(`id`, `start`, `surface`), `regions`(`id`, `kind`, `points`), `windows`(`id`, `bounds`), `candidates`(`id`, `point`, 선택 `confidence`), `heatmap`(`bounds`, `density`)다. 각 배열은 자기 출력 능력의 선언이 필요하다. 좌표는 모두 레벨 0 픽셀이며 경계는 좌·상단 포함, 우·하단 제외로 후보를 센다. 영역 분류는 `epidermis`, `tissue`, `lesion`이다.
- `heatmap_unit: "candidates_per_mm2"`와 축별 `mpp`가 필요하다. 모델의 보정과 등록 WSI가 일치할 때 타일을 표시한다. 수기 계수의 영역과 밀도는 등록 WSI의 두 축 보정값으로 계산한다. 보정값이 없으면 물리 면적 생성 및 밀도 표시가 비활성화된다. 보관 원본 Heatmap은 후보를 검토해도 그대로 유지된다. 겹치는 영역은 각각 독립적으로 계수하며 전체 합계는 생성하지 않는다.
- `.runtime/skin/<organization>/<WSI signature digest>/`에 원본 SHA-256 파일을 보관한다. `MEDIAUTO_SKIN_ROOT`로 경로를 설정할 수 있다. 동일 원본은 같은 ID를 사용하며 손상된 파일은 모델 분석 목록에서 제외한다. 등록 스캔에 대한 수기 모드는 별도로 유지된다.
- 동일 폴더의 `validation-evidence.json`에 원본 ID(`archive_id`), `model_version`, `checkpoint_sha256`, `analysis_version`, `window_id`, `reference`, `review_version`, `reviewed_at`, `area_mm2`와 독립 `count`가 있는 배열을 연결한다. 정확히 일치하는 버전·영역·면적에 한해 **Reference Comparison**에서 확인 수와 기준 수의 차이를 보인다. 기준 참조에는 비식별 문서 ID를 쓴다.

## 마이그레이션 및 롤백

`0023_skin_review`는 `skin_review_revisions`를 추가한다. 버전과 요청 키로 동시 저장 및 재시도 중복을 막는다. 리비전과 Case Logs 변경 이벤트는 같은 트랜잭션에 저장한다. 로그에는 버전, 대상 ID, 변경 상태와 사유를 기록한다. 원래 보관 파일이나 검체 데이터는 변경하지 않는다.

테이블이 비어 있으면 `alembic downgrade 0022_ihc_result_revisions`로 롤백할 수 있다. 수기 이력이 있으면 마이그레이션이 다운그레이드를 차단한다. 롤백 시 DB와 원본 디렉터리를 함께 백업한다.

## 검증 결과

- Python 3.10.20, PostgreSQL 18.6, Node 22.12.0, Chrome 146.0에서 수행했다. 테스트는 실제 SVS를 배경으로 쓰고 피부 모델 출력과 기준 계수는 합성했다.
- 단위와 격리 Chrome에서 Heatmap 좌표 오차 1 화면 px 미만, 두 축 보정, 0.2·1 mm² 면적, 경계 포함 정책, 미보정 시 차단, 후보 판정 및 정정, 요청 재시도·버전 충돌·권한, 기준 회수, 손상된 원본에서 수기 도구 유지, 저장 후 다시 열기를 검증했다. 합성 예의 0.2 mm² 영역에서 확인 한 점은 5 confirmed/mm²였으며 원본 Heatmap은 10 candidates/mm²를 유지했다.
- 격리 DB에서 `0022 → 0023 → 0022 → 0023`, `alembic check`, 이력 보존 가드를 확인했다. 개발 DB를 `.runtime/before-skin-review-0023-20261124T210142.dump`에 백업한 뒤 9920에 적용했다. 기존 설정·데이터 건수, 배포 화면, 인증과 EMR 미설정을 확인했다.
- 실제 피부 모델 결과·계수 기준과 임상 사용자 검토는 대기 중이다.
- 전체 `MEDIAUTO_DEMO_PORT=19945 scripts/verify-integration.sh`에서 백엔드 테스트 52개와 Chrome 시나리오 24개가 통과했다. 기존 Multi View 회귀는 전체 목록의 노출 순서에 의존하던 진입을 정확한 케이스 ID 조회로 변경했다. TypeScript/Vite 빌드를 통과했으며 피부 검토 화면은 열 때 로드한다.
