# 39. Pap 검체 판독 이력과 기관 용어

## 범위와 자료

- PDF 46쪽에서 검체 적절성, 진단적 해석, 미생물 입력 패널을 확인했다. 발표자는 1차 검토자와 후속 병리의의 기록이 별도로 남는 흐름을 설명했다. 참석자 승인 용어표, 실제 서명 권한 및 기관 규칙은 확인되지 않았다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- 기존 Pap 갤러리에서 확인한 등록 Papanicolaou 스캔·검체 범위, WSI 권한과 Case Logs를 재사용한다. CAP 프로토콜은 필드 범위 확인에 참고했다. 실제 설치 시 사용할 코드·표시명은 기관에서 게시한다. [CAP 자궁경부질 세포검사 프로토콜](https://documents.cap.org/protocols/Cervicovaginal.Cyto_1.0.0.0.REL_CAPCP.pdf)

## 기관 설정

1. 관리자 계정에서 **Settings → Pap Review Policy**를 연다. **Policy Name**과 기관이 승인한 영어 표시명·코드를 적고 1차·후속 검토 계정을 지정한다. **Publication Reason**을 남겨 게시한다. 초기 상태는 미설정이다.
2. 각 용어는 한 줄에 `code | English Label` 형식으로 입력한다. 코드와 표시명은 각 필드 안에서 고유해야 한다. 적절성은 `| no_interpretation`을 추가하면 해당 선택에 해석·미생물을 적용하지 않는다. 미생물은 `| exclusive`를 지정하면 다른 미생물 값과 함께 선택할 수 없다. 해석이 적용될 때 미생물을 의무화할지는 기관에서 선택한다.
3. 1차 명단에는 기관이 지정한 활성 `labeler` 또는 `doctor` 계정을 넣는다. 후속 명단에는 활성 `doctor`만 넣는다. 후속 완료·반려·재개에는 케이스 배정과 1차 제출자와 다른 계정이 필요하다. 관리자 계정은 정책을 게시하고 권한 내 이력을 읽는다. 계정의 1차·후속 역할은 현재 게시본으로 적용한다.
4. 첫 저장이 사용한 용어표는 해당 검체 검토에 고정된다. 기관이 새 용어표를 게시하면 신규 검토에서 사용된다. 진행 중인 검체에 대한 권한은 현재 정책 버전에서 판단하고 각 이력에 당시 용어·권한 버전을 남긴다.

## 검토 흐름

| 현재 상태 | 허용 작업 |
| --- | --- |
| Not Started / Primary Draft | 지정 1차 검토자가 초안을 저장하거나 제출 |
| Awaiting Follow-up / Follow-up Draft | 배정된 후속 검토자가 독립 초안을 저장하거나 완료. 사유를 적고 1차에 반려 가능 |
| Returned to Primary | 지정 1차 검토자가 사유를 적고 기존 제출값을 이어서 수정 |
| Review Completed | 배정된 후속 검토자가 사유를 적고 마지막 후속 결과를 초안으로 재개 |

**WSI Viewer → Pap Review**에서 적절성·해석·미생물·메모를 입력한다. **Pap Gallery**와 함께 열 수 있으며 후보 AI 결과가 없는 등록 Pap 스캔도 검토할 수 있다. 초안은 일부 항목이 비어도 저장된다. 제출 또는 완료에는 기관 정책에 해당하는 필수값이 필요하다. 첫 후속 폼은 비어 있으며 기존 1차 결과를 별도로 펼쳐 읽을 수 있다.

한 케이스 내 동일 검체에 속한 Pap 스캔은 검토 이력을 공유한다. **Pap Review History**에 작성자, 작성 시각, 작업, 사유, 원천 스캔, 용어와 권한 버전을 남긴다. 반려 또는 재개 후에도 이전 제출과 초안은 계속 열람할 수 있다. 상태의 `Review Completed`는 Pap 검토 완료를 뜻한다. 케이스 상태 전이와 LIS 전송은 각 기존 업무 경로에서 수행한다.

## API, 보존과 롤백

- 관리자 `GET/POST /api/clinical/{organization}/pap-policy`, 스캔 `GET /api/wsi/clinical/{scan_id}/pap-review`, `POST .../pap-review/revisions`. `before`는 오래된 이력 페이지의 기준 버전이다.
- `0025_pap_review`는 `pap_review_policies` 및 `pap_review_revisions`를 추가한다. 버전과 요청 키로 충돌과 중복 저장을 처리한다. 이력과 Case Logs의 `pap_review_revision` 이벤트는 같은 트랜잭션에서 저장한다.
- 빈 테이블에서는 `alembic downgrade 0024_pap_gallery`로 돌아갈 수 있다. 정책 또는 이력이 있는 DB에서는 다운그레이드가 차단된다. 롤백 시 백업에서 원천 이력과 정책을 복원한다. 실제 기관 용어·계정과 임상 사용자 평가는 대기 중이다.

## 검증 결과

- Python 3.10.20, PostgreSQL 18.6, Node 22.12.0, Chrome 146.0에서 수행했다. 실제 SVS 두 장을 배경으로 쓰고 용어표·계정·검토 입력은 합성했다.
- 격리 Chrome에서 용어 게시, 초기 미설정·권한 거부, 1차 초안과 재접속, 제출, 독립 후속 초안, 반려, 담당 변경과 1차 재개, 재제출, 후속 완료·재개까지 검증했다. 한 검체의 두 스캔에서 같은 8개 리비전을 읽었다. 용어 v1 고정, 권한 v2 적용, 이전 검토값과 반려 사유 보존, Case Logs 연결, 동시 중복 요청과 오래된 버전 차단을 확인했다.
- 단위 테스트에서 필수 및 배타적 미생물, 해석 비적용 용어, 1·2차 동일 계정 제한과 사유 필수 조건을 확인했다.
- 격리 DB에서 `0024 → 0025 → 0024 → 0025`, `alembic check`와 게시된 정책·저장 검토의 다운그레이드 보호를 검증했다. 개발 DB를 `.runtime/before-pap-review-0025-20261124T212435.dump`에 백업해 9920에 적용했다. 기존 설정과 레코드 건수, 관리자 API 및 정책 미게시 상태를 확인했다.
- 전체 `MEDIAUTO_DEMO_PORT=19945 scripts/verify-integration.sh`에서 TypeScript/Vite 빌드, 백엔드 테스트 56개와 Chrome 시나리오 26개를 통과했다.
