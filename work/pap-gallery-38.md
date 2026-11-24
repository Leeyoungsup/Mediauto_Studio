# 38. Pap 후보 계약 및 WSI 갤러리

## 참조와 구현 범위

- PDF 45쪽에서 WSI와 후보 이미지 그리드를 한 화면에 보여주는 구조를 확인했다. 발표자는 high N/C ratio, clusters, organisms, transformation zone 등의 후보 범주를 설명했다. 선별 성능, 누락률, 모델 적응증이나 참석자의 기관 승인 기록은 확인되지 않았다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- 베이스 `d3741bc`와 로컬 모델·보관본을 확인했다. 연결 가능한 Pap 모델 또는 후보 결과는 확인되지 않았다. 등록 WSI의 케이스 권한, 레벨 0 좌표, 타일·부분 영상 처리와 기존 뷰어 카메라를 재사용했다.
- 범주는 공급자가 선언하는 선별용 분류다. 이 작업은 후보 탐색 및 개인 위치 복원까지 포함한다. 검체 적절성·진단 해석·검토 완료 기록은 39번의 범위다.

## 사용자 흐름

1. 등록된 Papanicolaou 임상 스캔의 **WSI Viewer → Pap Gallery**를 연다. **Pap Analysis**가 있으면 분석을, **Candidate Category**에서 범주를 선택한다. 페이지당 최대 18개 후보를 볼 수 있다.
2. 후보 이미지를 선택하면 원본 WSI가 해당 후보의 경계 상자 중심으로 이동하고 영역을 표시한다. **Center Selected Candidate**로 다시 중심을 맞출 수 있다. **Model and Candidate Source**에서 준비 방법, 모델과 분석 버전, 체크포인트·아카이브 지문을 확인한다.
3. 선택한 후보는 같은 기관·계정·케이스·스캔에서 서버에 저장된다. 브라우저를 종료하거나 새로 로그인한 뒤 같은 스캔의 갤러리를 열면 마지막 후보와 범주·페이지·WSI 위치를 복원한다. 새 버전이 등록돼도 기존 저장 원본이 유효하면 해당 버전에서 이어서 볼 수 있다. 연결이 끊어진 원본이나 다른 스캔에서는 기존 선택을 적용하지 않는다.
4. 미수신, 수신한 결과가 비어 있음, 범주에 후보가 없음과 검증 오류를 구분한다. **Reload Gallery**로 원본을 확인하고 이미지 생성 실패 시에는 해당 후보의 **Retry Preview**를 사용한다. 일부 아카이브가 오류인 경우 정상 버전으로 계속 열람할 수 있다.

## 후보 가져오기 계약

```bash
cd backend
conda activate mediauto-studio
python -s -m app.import_pap --organization local --slide sample.svs --result /path/pap-export.json
```

| 필드 | 계약 |
| --- | --- |
| `schema_version` · `scope` | `pap-candidates-v1` · `cervical_cytology` |
| `source` | WSI `filename`, `size`, OpenSlide `quickhash`, 레벨 0 `dimensions` |
| `binding` | `case_id`, `specimen_id`, `slide_id`, `block_id`의 내부 UUID. 블록이 없으면 null을 명시한다. 등록 염색 값은 Pap 또는 Papanicolaou 계열이어야 한다. |
| `preparation` | `conventional` 또는 `liquid_based` |
| `model` · 분석 버전 | `name`, `version`, `checkpoint_sha256`. 최상위 `analysis_version` 및 시간대가 있는 `exported_at` |
| `categories` | 최대 48개. 고유 `code`와 표시용 `label`. `high_nc_ratio`, `clusters`, `organisms`, `transformation_zone` 등은 예시이며 공급자 분류를 명시적으로 매핑한다. |
| `candidates` | 최대 25,000개. 고유 `id`, 등록 범주의 `category`, 정수 레벨 0 `bounds: [left, top, right, bottom]`, 선택적 `confidence` 0–1. 각 방향 4096px 이내이며 WSI 범위 안에 있어야 한다. 후보별 다른 스캔 ID나 외부 미리보기 URL은 받지 않는다. |

카탈로그는 기본 `.runtime/pap/<organization>/<WSI signature digest>/`이며 `MEDIAUTO_PAP_ROOT`로 바꿀 수 있다. 원본 파일의 SHA-256이 아카이브 ID다. 동일한 원본 재가져오기는 같은 ID를 사용한다. 조회 시 현재 스캔·케이스·검체·슬라이드·블록 및 SHA-256을 확인한다. 썸네일은 인증된 현재 WSI에서 최대 192px의 부분 이미지로 생성한다. 원본·썸네일·선택 API는 기존 스캔 QC 및 케이스 접근 제어를 따른다.

## 이어보기와 롤백

- `0024_pap_gallery`는 `pap_gallery_cursors`를 추가한다. 기관·계정·케이스·스캔별 마지막 후보와 원본 ID를 저장한다. 같은 선택의 재시도는 기존 버전을 반환한다. 다른 탭에서 이전 버전으로 다른 후보를 덮어쓰려 하면 충돌로 처리한다.
- 저장된 선택이 없는 경우 `alembic downgrade 0023_skin_review`로 롤백할 수 있다. 선택이 남아 있는 DB는 다운그레이드가 차단된다. 복구 시 DB와 원본 디렉터리를 함께 백업한다. 실제 모델·기관 검증 자료와 임상 사용자 검토는 대기 중이다.

## 검증 결과

- Python 3.10.20, PostgreSQL 18.6, Node 22.12.0, Chrome 146.0에서 수행했다. TypeScript/Vite 빌드와 `alembic check`를 통과했다.
- 실제 등록 SVS를 배경으로 쓰고 Pap 후보·범주·모델 출처는 합성했다. 계정 재로그인 후 2페이지 후보·범주·WSI 위치를 복원했다. 이동 중심 오차는 2 level-0 px 미만이었다. PNG 썸네일과 재시도, 범주가 빈 상태, 결과 미수신과 빈 원본의 구분, 손상 복구를 확인했다.
- 동일 선택 재시도, 오래된 버전의 다른 선택 거부, 사용자별 이어보기 분리, 미배정 사용자와 다른 스캔의 아카이브·썸네일 접근 차단을 확인했다. 단위 테스트는 범주·중복 ID·좌표·스캔 지문·검체 바인딩·원본 변경을 검사했다.
- 격리 DB에서 `0023 → 0024 → 0023 → 0024`와 이력이 있는 경우의 다운그레이드 차단을 검증했다. 개발 DB를 `.runtime/before-pap-gallery-0024-20261124T211313.dump`에 백업한 뒤 9920에 적용했다. 기존 데이터와 설정 건수, 배포 화면과 API 인증, EMR 미설정 상태를 확인했다.
- 전체 `MEDIAUTO_DEMO_PORT=19945 scripts/verify-integration.sh`에서 백엔드 테스트 54개, Chrome 시나리오 25개가 통과했다.
