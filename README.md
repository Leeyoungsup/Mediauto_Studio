# Mediauto_Studio

## 개발 환경 준비

서버의 `mediauto-studio` Conda 환경은 FastAPI와 Alembic을 실행합니다. `mediauto-postgres` Conda 환경은 PostgreSQL 18 실행 파일을 제공합니다. 프런트엔드는 Node.js `22.12.0`에서 준비합니다.

```bash
conda activate mediauto-studio
python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
```

## 9920 포트에서 실행

```bash
./start.sh
```

브라우저에서 `http://서버IP:9920/`을 열면 React 화면이 표시됩니다. 서버 자체에서는 `http://127.0.0.1:9920/`으로 접속합니다. `/api/health`에서 FastAPI·PostgreSQL과 EMR 설정 상태를 확인할 수 있습니다.

Worklist에서 직접 만든 시연용 케이스와 입력값은 페이지를 새로고침할 때 초기화됩니다. 뷰어는 아래 공개 조직 사진을 WebP로 변환해 미리보기에 사용합니다.

- CoRus13, [Colon, low mag.jpg](https://commons.wikimedia.org/wiki/File:Colon,_low_mag.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- Nephron, [Colorectal adenocarcinoma — low mag.jpg](https://commons.wikimedia.org/wiki/File:Colorectal_adenocarcinoma_--_low_mag.jpg), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

### 예제 슬라이드 등록

`Worklist → 슬라이드 등록`은 `data/`의 NDPI·SVS를 읽기 전용으로 검색합니다. `설정 → 파일명 규칙`에서 규칙을 작성하거나 CODIPAI 예제를 불러온 뒤 `미리보기 → 규칙 저장 → 미입력 슬라이드에 적용`을 실행합니다. 규칙 미일치 파일은 `미입력 슬라이드`에서 Case ID와 Slide ID를 직접 등록할 수 있습니다.

규칙과 파일 등록 정보는 개발 PostgreSQL에 저장되며, 이미 등록한 파일은 규칙을 다시 적용해도 유지됩니다. 등록 정보는 Worklist에서 Case ID로 묶어 확인합니다. 같은 Slide ID의 NDPI와 SVS는 서로 다른 원본 파일로 표시됩니다. 이 화면은 등록 정보 확인용이며 실제 WSI 타일 연결은 후속 작업입니다.

Worklist의 `열`에서 PDF 기반 열을 검색하고 표시 여부와 순서를 설정할 수 있습니다. 이 설정은 브라우저별로 유지됩니다.

### 06. 정규 케이스 등록·조회 API

서버 내부에서 `http://127.0.0.1:9920/docs`를 열어 API를 확인합니다. 경로의 `{organization}`에는 개발용 기관 코드를 지정합니다. 이 단계의 작성자와 이벤트 행위자는 `local-development`로 기록하며, 계정별 인증과 권한 매핑은 07번에서 연결합니다.

| 데이터 | 연결과 필드 | 등록 시 출처와 제약 |
| --- | --- | --- |
| 환자 | `patient.id`, `display_name`, `local_reference`, `birth_date` | 수기 출처를 기록합니다. 이름 또는 로컬 식별자 중 하나가 필요하며, 로컬 식별자는 기관 내에서 유일합니다. |
| 케이스 | `case.id`, `case_number`, 선택 `patient_id` | 기관 내 케이스 번호로 중복을 막습니다. 환자 없이 등록한 뒤 명시적으로 연결할 수 있습니다. |
| 검체 | `specimen.id`, `case_id`, `specimen_number`, 선택 `description` | 소속 케이스가 필요하며, 검체 번호의 유일 범위는 케이스입니다. |
| 슬라이드 | `slide.id`, `slide_number`, 선택 `specimen_id`, `stain` | 검체 미연결 상태로 보관하고 나중에 연결할 수 있습니다. 연결된 슬라이드 번호의 유일 범위는 검체입니다. |
| 스캔 | `scan.id`, `slide_id`, `storage_key`, 형식, 파일 크기·수정 시각 | 상대 경로 기준으로 동일 파일의 이중 등록을 막습니다. 하나의 슬라이드에서 NDPI와 SVS를 각각 등록할 수 있습니다. |
| 외부 식별자 | 기관 코드, 원천 시스템, 식별자 종류, 원문 값, 로컬 레코드 UUID | 식별자 조합의 유일성은 개발 DB 기준입니다. 수기 연결 시각을 기록하며 외부 동기화 시각은 비워둡니다. 병원별 정규화와 식별자 정책은 기관 인터페이스에 맞춰 확정합니다. |

`Patient (선택) ← Case ← Specimen ← Slide ← Scan` 관계입니다. 검체에 연결되기 전의 슬라이드도 별도로 조회할 수 있습니다. 생성 API는 `Idempotency-Key` 헤더를 사용하며 같은 요청을 다시 보내면 같은 UUID를 반환합니다. 연결을 바꿀 때는 최신 `version`과 `reason`을 보냅니다. 중복·충돌·이전 버전 저장은 HTTP `409`를 반환합니다. 현재 상태는 등록 단계의 `registered`와 슬라이드의 `unlinked`만 사용합니다. 상태와 연결 변경 전후 값은 추가 전용 `history`에 기록합니다.

```bash
curl -X POST http://127.0.0.1:9920/api/clinical/local/cases \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: case-example-1' \
  -d '{"case_number":"DEMO-001"}'
curl 'http://127.0.0.1:9920/api/clinical/local/cases?unlinked=true'
```

등록·조회 경로는 `/api/clinical/{organization}/{patients|cases|specimens|slides|scans}`입니다. 하위 목록은 `?parent_id=<UUID>`로 조회하고 `PATCH /cases/{id}/patient`와 `PATCH /slides/{id}/specimen`으로 연결합니다. 기관별 외부 ID는 `POST /{종류}/{id}/external-identifiers`로 연결하고 `POST /{종류}/external-identifiers/lookup`으로 조회합니다. 두 경로 모두 케이스·검체·슬라이드와 환자에 적용됩니다. 조회 본문에는 `system`, `kind`, `value`를 보냅니다. 등록·변경 이력은 `GET /{종류}/{id}/history`에서 조회합니다.

`0002_clinical_records`는 새 테이블을 추가합니다. 기존 `application_settings`의 EMR 설정과 슬라이드 등록 정보는 해당 테이블에 유지됩니다. 새 테이블의 데이터는 필요 시 먼저 백업하고, 연결한 개발 DB에서 `python -m alembic -c backend/alembic.ini downgrade 0001_application_settings`로 되돌릴 수 있습니다. `./start.sh`는 실행할 때 최신 리비전을 적용하므로 코드도 함께 이전 상태로 맞춥니다.

격리된 `mediauto_clinical_test` PostgreSQL에 `upgrade head`를 적용한 뒤, `backend/`에서 `MEDIAUTO_CLINICAL_TEST=1 python -m unittest discover -s tests -v`로 API를 검증할 수 있습니다. 테스트는 현재 Conda에 설치된 `httpx`를 사용합니다.

스크립트는 전용 개발 DB `mediauto_studio_dev`를 `.runtime/postgres`에 만들고 Alembic 마이그레이션을 적용합니다. PostgreSQL은 `.runtime/pgsocket`의 로컬 Unix 소켓에만 연결됩니다. 최초 마이그레이션은 EMR 상태를 `미설정`으로 초기화합니다. 스크립트를 다시 실행해도 DB 데이터는 유지됩니다.

서비스가 중지된 상태에서 `MEDIAUTO_HOST=127.0.0.1 ./start.sh`로 실행하면 서버 자체에서만 접속할 수 있습니다. PostgreSQL 실행 파일이 다른 경로에 있다면 `MEDIAUTO_PG_BIN`으로 `bin` 디렉터리를 지정합니다.

### 실행 상태와 중지

`./start.sh`는 `mediauto-studio` Conda 환경을 찾아 사용자 서비스로 시작합니다. 이 프로젝트의 서비스가 이미 실행 중이면 종료한 뒤 9920 포트에서 다시 시작하고, 헬스 체크가 통과하면 접속 주소를 출력합니다. 사용자 systemd를 사용할 수 없는 환경에서는 현재 터미널에서 실행되며 `Ctrl+C`로 중지합니다.

```bash
systemctl --user status mediauto-studio-dev.service
journalctl --user -u mediauto-studio-dev.service -f
systemctl --user stop mediauto-studio-dev.service
```

### 프런트엔드 수정

9920의 API를 실행한 상태에서 `npm --prefix frontend run dev`를 실행합니다. 로컬 Vite 주소 `http://127.0.0.1:5173/`에서 코드 수정이 반영되며, `/api` 요청은 9920으로 전달됩니다. 9920의 화면을 갱신하려면 `npm --prefix frontend run build`로 다시 빌드합니다.
