# 16. Worklist 저장 View

## 범위와 참조

[참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf) 17쪽 화면에는 View 이름, 개인 저장 범위, 현재 열 포함 옵션이 보인다. 18쪽 화면에는 Global Views 적용 결과가, 20쪽에는 열 검색·표시·순서 변경과 View 열 사용 옵션이 보인다. 발표 흐름에서 현재 필터를 저장해 다시 적용하는 동작을 설명했다. 이 작업은 해당 화면을 참고해 현재 IMS의 코드를 확장했다. 베이스 저장소의 `d3741bc` 존재를 확인했고, 현재 IMS의 Worklist 쿼리, 계정별 케이스 조회 권한, 열 목록을 재사용했다.

- 개인 View는 작성자만 열고 변경한다. 같은 기관의 관리자가 공유 View를 만들고 변경하거나 삭제한다. 같은 기관 계정은 공유 View를 적용하거나 자신의 시작 View로 지정할 수 있다. 적용된 검색·필터는 로그인 계정의 조회 범위에서 실행한다.
- View는 전체·내 배정·미배정 탭, Case ID 검색, 검토 상태, 담당자, 정렬을 저장한다. 열 구성은 선택 사항이다. 열을 포함하면 그 View의 표시 여부와 순서를 적용한다. 열을 생략하면 계정의 기본 열 구성을 사용한다. 필터 값도 공유하므로 기관 공용 조건을 저장할 때 입력값을 확인한다.
- 계정의 시작 View는 기본 Worklist 주소로 다시 접속할 때 자동 적용한다. 탭을 주소에서 명시하면 같은 탭에 저장된 시작 View를 복원한다. **기본 Worklist**를 선택하고 **시작 View로 지정**하면 이전 시작 View 지정을 해제한다.
- **내 기본 열 저장**으로 계정별 열을 저장한다. 이전 브라우저에서 쓰던 구성은 **기존 브라우저 열 가져오기**로 불러온 뒤 저장할 수 있다. Case ID와 상세 열기는 고정이다. 기존 데이터 모델에 값이 없는 열은 빈 값으로 표시한다.
- 정렬 기준은 등록 시각, Case ID, 검토 상태, 담당자, 슬라이드 수에서 최대 세 개다. 각 우선순위에 오름차순·내림차순을 지정한다. 빈 값은 끝에 두고, 마지막 동률은 Case ID와 내부 ID로 정한다. 슬라이드 수는 기존 Worklist에 표시하는 항목 수를 사용하며, 같은 슬라이드의 별도 스캔은 별도 항목으로 센다. 필터를 적용하고 정렬한 뒤 페이지를 나눈다.

## 구현과 마이그레이션

- API 및 모델은 `backend/app/worklist.py`, `backend/app/worklist_views.py`, `backend/app/models.py`, `backend/app/main.py`에 있다. View의 변경·삭제와 기본 설정의 갱신은 버전 충돌 시 409를 반환한다. 두 세션이 변경한 경우 **View 목록 갱신** 후 최신 설정을 확인하고 저장할 수 있다. 삭제된 View를 시작 View로 지정한 계정은 기본 Worklist로 돌아간다.
- UI는 `frontend/src/worklist.tsx`, `frontend/src/worklist-config.ts`, `frontend/src/worklist-preferences.tsx`, `frontend/src/worklist-api.ts`, `frontend/src/main.tsx`, `frontend/src/style.css`에 있다.
- Alembic `0006_worklist_views`에서 `worklist_views`와 `worklist_preferences`를 추가한다. 시작 View 참조는 View 삭제 시 해제된다. 되돌리려면 개발 DB를 먼저 백업한 뒤 `backend`에서 `python -s -m alembic downgrade 0005_viewer_records`를 실행한다. 이 작업은 두 설정 테이블을 삭제하므로 필요한 설정은 백업에 남기고 이전 애플리케이션과 함께 되돌린다.

## 검증과 재현

검증 환경은 Linux 6.8, Conda Python 3.10.20, Node 22.12.0, PostgreSQL 18.6, Chrome 146이다. 새 PostgreSQL의 합성 계정·케이스로 저장 View를 검증했다. 기존 뷰어 회귀는 저장소의 NDPI·SVS 예제 데이터를 사용했다.

```bash
MEDIAUTO_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs scripts/verify-integration.sh
```

위 명령은 Vite 빌드, 격리 DB의 Alembic 적용·스키마 일치 검사, API 테스트와 Chrome 브라우저 테스트를 실행한다. Playwright가 Node 모듈 경로에 설치된 경우 환경 변수는 생략할 수 있다. 실제 병리과 사용자 검토와 대규모 케이스 정렬 성능 측정은 이 단계에서 실행하지 않았다.

| 검증 | 결과 |
|---|---|
| Vite 빌드, Alembic `upgrade head` 및 `check` | PASS |
| PostgreSQL API·단위 테스트 | 18개 PASS. 기관 간 조회 차단, 다른 작성자의 개인 View 접근 차단, 공유 View 수정 권한, 버전 충돌, 삭제 시 시작 View 해제 포함 |
| Chrome 저장 View E2E | PASS. 독립 브라우저 컨텍스트에서 검색·상태·열 순서·두 정렬 기준 복원. 2순위 방향을 바꿔 동률 순서를 검증했고 필터 후 정렬과 페이지 경계를 확인했다. 판독의는 공유 View를 적용해 자신의 케이스만 조회했고 공유 View 삭제가 거부됐다. |
| 기존 IMS Chrome 회귀 | PASS. 로그인·배정·NDPI/SVS·검토 저장, ROI·측정, Multi View |
| 격리 DB 마이그레이션 롤백 | PASS. `0005_viewer_records → 0006_worklist_views → 0005_viewer_records → 0006_worklist_views`. 기존 케이스 및 EMR 설정 보존 확인 |
| 개발 서버 9920 | PASS. 사전 백업 후 `./start.sh`로 적용. 기존 설정 및 케이스·환자·연동 레코드 수가 유지됐다. 개발 서버에 로그인해 저장 View API와 정렬 UI를 확인했다. |

수동 재현은 **Worklist → 검색/검토 상태 → 다단계 정렬 → 열 → 새 View 저장 → 시작 View로 지정** 순서다. 브라우저 프로필을 바꿔 같은 계정으로 로그인해 복원을 확인한다. 기관 관리자로 공유 View를 저장한 뒤 같은 기관의 판독의로 로그인해 해당 View를 적용하고 자신에게 배정된 케이스가 표시되는지 확인한다.
