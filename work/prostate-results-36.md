# 36. 전립선 Core·Level AI 결과와 WSI 영역

## 출처와 적용 범위

- PDF 43쪽에는 길게 배열된 여러 조직 코어와 구획별 영역이 보인다. 업체 발표자는 종양 영역 이동, Gleason/Grade Group, 종양 길이, PNI와 cribriform을 설명했다. 해당 부분에 Core·Level 일치율, 길이 검증, 모델 성능 자료 또는 참석자 승인 기록은 없다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- 베이스 `d3741bc`의 Quanti HE 프로필과 기존 분석 보관 디렉터리, 프로젝트의 NDPI/SVS를 확인했다. Quanti HE는 해당 베이스의 세포 검출 모델이며, 전립선 생검 Core·Level, 종양 길이, Grade Group 또는 PNI를 반환하는 전용 체크포인트·결과·기관 검증 자료를 찾지 못했다. WSI 레벨 0 좌표, 타일, 케이스 권한, 기존 카메라의 영역 이동을 재사용했다.
- 전립선 생검의 결과 계약은 Core의 모델 원천 분류와 길이 측정 방법을 각각 유지한다. CAP의 검체 수준 프로토콜도 코어별 길이와 측정 방법을 다룬다. 그 문서는 보고 용어 참고 자료다. [CAP 전립선 생검 검체 수준 프로토콜](https://documents.cap.org/protocols/Prostate.Needle.Specimen.Bx_1.1.0.0.REL_CAPCP.pdf)

## WSI에서 재현

1. 등록된 임상 케이스의 **WSI Viewer → Prostate AI**를 연다. **Prostate Analysis**로 분석 버전을 고르고 **Core and Level**에서 결과를 선택한다.
2. **Region Overlay**를 켜고 **Focus Core and Level**이나 개별 영역 버튼을 누른다. 조직, 종양, PNI 표식은 원천에서 받은 해당 Core·Level의 다각형이다. 다른 단면의 스캔은 기존 **Slide Tray**에서 전환한다. 해당 스캔의 분석과 표식을 독립적으로 로드한다.
3. **Core Length**, **Tumor Length**, **Grade Group**, **PNI**에서 개별 표시 상태를 확인한다. 모델 미지원, 해당 Core·Level의 값 누락, 기준 결과 대기는 각각 다르게 표시한다. 명시적으로 제공되고 기준과 일치한 `0 mm`와 `Not Identified`를 확인할 수 있다. **Model and Evidence Versions**에는 모델 버전, 체크포인트, 분석/검증 버전과 각 문서 ID가 있다.

## 가져오기와 식별자

`data/`에 존재하는 등록된 H&E NDPI/SVS와 표준화된 원천 JSON을 운영자가 연결한다. 백엔드 기준 실행 예시는 아래와 같다.

```bash
cd backend
conda activate mediauto-studio
python -s -m app.import_prostate --organization local --slide sample.svs --result /path/verified-export.json
```

| 필드 | 출력 계약 |
| --- | --- |
| `schema_version` | `prostate-core-level-v1` |
| `source` | `filename`, `size`, OpenSlide `quickhash`, `dimensions`. WSI의 레벨 0 파일과 일치해야 한다. |
| `binding` | IMS 내부 UUID `case_id`, `specimen_id`, `slide_id`, `block_id`. 블록이 없는 등록 슬라이드는 `block_id: null`. 파일이 다른 검체나 블록으로 이동한 경우 기존 바인딩은 조회 대상에서 제외된다. |
| `input` | `organ: prostate`, `specimen_type: needle_biopsy`, `stain: H&E`, `protocol`. 임상 스캔의 등록 염색도 H&E여야 한다. 모델 적용 범위에 대한 실제 검체 확인은 운영자가 수행한다. |
| `model` | `name`, `version`, `checkpoint_sha256`. 원본에는 별도 `analysis_version`과 시간대가 있는 `analyzed_at`이 필요하다. |
| `capabilities` | 원천이 실제 제공하는 기능의 배열. `tissue_region`, `tumor_region`, `pni_region`, `core_length`, `tumor_length`, `grade_group`, `pni` 중 해당 항목만 선언한다. |
| `core_levels` | 각 항목의 `core_id`와 `level_id`를 원천에서 제공한다. 같은 원본에서 식별자 쌍은 유일하다. 조직 레벨은 WSI 확대 피라미드의 레벨과 별개다. |
| `regions` | 원천의 `id`, `kind`(`tissue`, `tumor`, `pni`), `points`(WSI 레벨 0의 `[x,y]`)를 저장한다. 한 영역은 단일 다각형이다. 다중 영역은 별도 ID로 연결한다. 이 보관 형식은 마스크 내 구멍을 지원하지 않는다. |
| `findings` | 제공된 값만 넣는다. 길이는 `value`, `unit`(`mm` 또는 `um`), `method`가 필요하다. Core 길이는 `core_axis`, 종양 길이는 `single_focus`, `continuous_span`, `sum_of_foci` 중 하나를 기록한다. Grade Group은 1–5이며 PNI 상태는 `present`, `not_identified`, `indeterminate`다. |

길이는 모델이 저장한 값이며 화면에서는 mm로 환산한다. 조직 도형의 둘레나 카메라 배율로 길이를 만들어 내지 않는다. Grade Group이나 PNI는 다른 모델의 출력과 조직 영역에서 추정하지 않는다. 등록된 케이스의 조회 경로는 `GET /api/wsi/clinical/{scan_id}/prostate`다. 기존 케이스 RBAC와 스캔 QC를 적용한다.

## 기준 결과와 보존

- 원천 JSON 파일 바이트의 SHA-256을 아카이브 ID로 사용한다. 보관 경로는 기본 `.runtime/prostate/<organization>/<WSI signature digest>/<archive id>.json`이다. `MEDIAUTO_PROSTATE_ROOT`로 다른 디렉터리를 지정할 수 있다. 동일 파일 재입력은 같은 ID를 사용하며 다른 버전은 별개 원본으로 저장한다.
- 같은 WSI·기관 디렉터리의 `validation-evidence.json` 배열에 승인된 원본별 `archive_id`, `checkpoint_sha256`, `model_version`, `analysis_version`, `core_id`, `level_id`, `reference`, `review_version`, `reviewed_by`, `reviewed_at`, 독립 기준 `findings`를 연결한다.
- 길이의 기준값은 같은 측정 방법 및 mm 환산 결과가 일치해야 한다. Grade Group·PNI는 원본 값과 정확하게 대조한다. 한 필드에 기준 기록이 둘 이상이면 해당 필드는 검증 대기로 표시한다. 수치와 PNI는 원본·버전·Core·Level별 기준이 맞을 때만 API와 화면에 나타난다. 조직 영역은 원천의 AI 표식으로 표시되며 모델과 아카이브 버전으로 추적한다.
- 운영 승인과 독립 판독 데이터는 별도로 관리한다. 보관 파일에는 비식별 문서 참조만 저장한다. 기준 근거를 회수하면 **Refresh Prostate Results** 또는 재접속 시 값이 숨겨진다. 원본·검증 파일은 함께 보관할 수 있다.
- DB 마이그레이션은 없다. 이전 애플리케이션 빌드로 롤백하면 기존 WSI와 임상 데이터는 그대로 사용할 수 있으며 전립선 보관 파일은 서버에 보존된다.

## 검증 결과

- Python 3.10.20, PostgreSQL 18.6, Node 22.12.0, Chrome 146.0을 사용했다. `python -s -m unittest discover -s tests -p 'test_prostate_results.py' -v`에서 단위 테스트 3개를 통과했다. 파일 서명·바인딩, 좌표 경계, 중복 ID, 단위와 기준 버전, 변조 및 권한 범위를 검증했다.
- 격리 Chrome에서 실제 SVS 두 장을 영상 배경으로 사용하고 전립선 Core·Level 출력과 기준 결과는 합성했다. 여러 분석 버전, 다른 코어·레벨 전환, 영역 초점 중심 오차 2 level-0 px 미만, 확대 후 중심 유지, 이전 스캔 표식 정리, 단위 변환·0 mm·명시적인 PNI, 미지원·누락·검증 대기의 구분, 기준 근거 회수와 비배정 계정 차단을 확인했다.
- 개발 서비스 9920에서 배포된 프런트엔드, 인증·미등록 스캔 API, 기존 PostgreSQL과 EMR 미설정 상태를 확인했다. 현재 개발 Worklist에서 등록된 임상 전립선 스캔과 모델 보관본은 확인되지 않았다. 실제 모델 성능과 임상 사용자 검토는 대기 중이다.
- 전체 `MEDIAUTO_DEMO_PORT=19945 scripts/verify-integration.sh`에서 TypeScript/Vite 빌드, `alembic check`, 백엔드 테스트 49개, Chrome 시나리오 23개를 통과했다.
