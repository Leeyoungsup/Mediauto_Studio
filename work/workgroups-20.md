# 20. 역할별 업무함·그룹·우선순위·배정 업무량

## 근거와 범위

PDF 18쪽에서 Global Views의 Frozen Section을 선택하면 Priority: Frozen 조건과 케이스 목록을 볼 수 있다. 4쪽 업무 설명에는 Breast·Cytology 분야별 업무함과 업무량 점수 제안이 나온다. 현 시스템의 Worklist, 역할과 케이스 접근 권한, 고급 필터와 저장 View, 배정·재배정 이력을 재사용했다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)

| 항목 | 기능과 권한 |
|---|---|
| 역할별 Worklist | 케이스 등록 권한이 있는 관리·접수 계정은 미배정 업무와 기존 접수 경로를 사용한다. 병리의는 내 배정 건을 사용한다. 기본 Worklist와 전용 업무함은 기존 역할별 케이스 접근 범위를 적용한다. |
| 그룹 | Breast와 Cytology를 기본 제공한다. 관리자는 기관별 추가 그룹을 만들고 활성 계정을 그룹에 추가한다. 구성원과 관리자는 분야별 View를 선택할 수 있다. 그룹은 배정 후보를 좁힌다. 그룹 가입만으로 다른 담당자의 케이스나 타일 열람 권한이 생기지 않는다. |
| 그룹 배정 | 케이스에는 하나의 그룹을 지정할 수 있고, 계정은 여러 그룹에 속할 수 있다. 그룹 케이스의 담당자는 같은 기관의 활성 그룹 병리의만 선택할 수 있다. 담당자와 맞지 않는 그룹 변경 및 미완료 케이스가 배정된 구성원의 제거는 409로 처리한다. 그룹 없는 케이스는 기존 배정 후보를 사용한다. |
| 우선순위 | Routine, Urgent, Frozen 또는 미설정으로 분류한다. 분류는 관리자 또는 해당 그룹의 접수 권한 계정이 수행하며 변경 사유·행위자·시각·이전/이후 값·수기 출처를 감사 이력에 기록한다. 검토 완료 케이스의 분류는 잠긴다. Frozen Section은 그룹과 독립적으로 Frozen 조건을 적용한다. |
| 구독 | Global Views에서 구독한 View가 개인 Worklist에 고정된다. 다른 세션에서도 같은 핀이 복원되고 언제든 구독을 해제할 수 있다. 그룹에서 제외되면 관련 핀도 제거된다. 우선순위 값은 수기로 지정한 상태이며 SLA나 긴급 메시지 전송은 후속 동결절편·알림 단계에 있다. |
| 배정별 업무량 | 관리자와 병리의가 현재 필터 결과 범위에서 케이스·미완료·검토 중·완료·슬라이드·Frozen 수를 볼 수 있다. 대체 스캔은 같은 임상 슬라이드 한 건으로 센다. 기존 파일 등록 건은 검체·슬라이드 라벨 쌍으로 묶는다. 요약은 결과의 전체 페이지를 기준으로 계산한다. |

업무량 가중 점수는 기관 확인 대기다. 적용 전 기관이 정의한 입력·가중치·예외, 유효기간, 점수표 버전, 산정 근거와 경계 사례를 합의해야 한다. 개발용 첫 범위에서는 실제 건수만 제공한다. 실제 병리 사용자 평가와 병원 LIS 우선순위 매핑은 미실행이다.

## 재현 및 변경

1. 관리자로 로그인하여 **Settings → Manage Workgroups**에서 Breast 또는 Cytology를 선택하고 병리의를 **Add Member**로 추가한다.
2. 정규 케이스의 **Case Details → Workgroup and Priority**에서 목적 그룹과 우선순위를 지정한다. 기존 파일 기반 케이스는 **Confirm Case from Registered Files**로 먼저 정규 케이스로 등록한다.
3. **Assign Case**에서 그룹 병리의를 선택하고 사유를 저장한다. **History**에서 분류·배정 이력을 확인한다.
4. **Worklist → Global Views → Breast** 또는 **Frozen Section**을 연다. **Subscribe**로 고정한 다음 다른 브라우저 세션에서 확인한다. **Assignment Workload**를 열어 집계한다.

`0009_workgroups`는 그룹, 구성원, 개인 구독 테이블과 케이스 그룹·우선순위·출처 필드를 추가한다. 기존 케이스 분류는 비워 둔다. API는 `backend/app/{workgroups,workgroup_policy,worklist,workflow}.py`에 있고 UI는 Worklist, 설정, 케이스 상세에 연결했다. 되돌리려면 백업 후 이전 코드와 함께 `python -s -m alembic downgrade 0008_worklist_filters`를 실행한다. 새 분류·그룹·구독이 제거되므로 필요하면 백업에서 복원한다. 새 그룹 또는 우선순위 필터를 저장한 View를 이전 버전에서 사용하려면 먼저 호환되는 조건으로 정리한다.

검증은 격리 PostgreSQL 18.6, Python 3.10.20, Node 22.12.0, Chrome 146과 합성 계정·케이스를 사용했다. 재현 명령은 `MEDIAUTO_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs scripts/verify-integration.sh`다.

| 검증 | 결과 |
|---|---|
| Vite 빌드·Alembic 적용·스키마 검사 | PASS |
| PostgreSQL API·단위 테스트 | 21개 PASS. 그룹 자격·다른 기관 차단·버전 충돌·감사·구독 중복과 해제·대체 스캔 업무량 포함 |
| Chrome 업무함 E2E 및 기존 브라우저 회귀 | PASS. 설정에서 그룹 생성 및 구성원 추가, 분류·배정, Frozen 목록과 업무량, 새 세션 구독 복원, 권한 없는 계정 차단을 확인했다. 기존 Worklist·WSI·ROI·Multi View·요청 회귀도 통과했다. |
| 격리 DB 롤백 | PASS. `0008 → 0009 → 0008 → 0009`에서 기존 케이스·설정·Worklist 테이블을 확인했다. |
| 개발 서버 9920 | PASS. 개발 DB 백업 후 마이그레이션과 재시작을 적용했다. 기존 설정·레코드 수가 유지됐으며 실제 개발 서버의 Global Views, Frozen 필터, 업무량, 관리자 구성원 화면을 확인했다. |
