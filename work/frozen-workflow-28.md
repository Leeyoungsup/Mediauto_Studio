# 28. Frozen Worklist 및 OR 예비결과 확인

## 참조와 구현 범위

- PDF 28쪽 OR 화면(P12 04:10, T 58:41–59:13)에는 게시 결과, 콜백, 절제연 평가가 표시된다. 발표자는 수술실 화면에 예비결과를 게시하고 수신 확인과 전화 콜백을 추적하는 흐름을 설명한다. 해당 구간에서 수신자 자격 또는 원내 승인 절차에 대한 참석자 합의는 확인되지 않았다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- 베이스 저장소의 `d3741bc` 존재를 확인했다. 현재 IMS의 Frozen 우선순위, 배정 및 케이스 접근 제어, 보고 초안, 감사 기록을 재사용했다.
- 개발용 권한을 다음과 같이 적용했다. 관리자가 동일 기관의 활성 `viewer` 계정을 케이스별로 지정하거나 해제한다. 배정 병리의가 예비결과 게시와 정정, 콜백 기록을 맡는다. OR 수신자는 자신에게 배정된 케이스의 최신 예비결과만 열고 직접 확인한다. OR 수신 권한에는 기존 케이스 상세나 WSI 권한이 포함되지 않는다. 관리자는 수술실 화면을 미리 볼 수 있다. 임상 도입 전 수신자 자격과 승인 절차에 대한 기관 확인이 필요하다.

## 재현 절차

1. 관리자 계정에서 케이스를 병리의에게 배정하고 **Workgroup and Priority**에서 **Frozen**을 선택한다. **Frozen Section → OR Recipients**에서 같은 기관의 수신 계정과 사유를 선택한 뒤 **Authorize Recipient**를 누른다.
2. 배정 병리의 계정에서 **Worklist → Global Views → Frozen Section**을 열고 케이스 미리보기에서 **Frozen Report**를 누른다. **New Preliminary Result**에서 소견과 선택 항목인 **Margin Assessment**를 입력해 게시한다.
3. 별도 세션의 지정 수신자가 **OR Results**에서 케이스를 선택한다. 버전과 결과를 확인한 뒤 **I have read this version. → Acknowledge Result**를 누른다. 장애가 발생하면 **Record Confirmation Issue**로 사유를 저장하고 같은 버전에 다시 확인할 수 있다. 화면은 자동 갱신되며 **Refresh OR Result**로 즉시 새로고침할 수 있다.
4. 병리의가 **Log Telephone Callback**에서 수신자와 결과를 저장한다. 통화 성공 시 해당 버전을 복창했음을 확인하고, 부재나 통화 실패 시 메모를 남긴다. 화면 확인과 전화 콜백은 독립적으로 기록된다.
5. 병리의가 **Start Correction**에서 변경된 소견 또는 절제연 평가와 정정 사유를 입력한다. 게시하면 이전 버전의 확인·콜백은 **Published Version History**에 남고 새 버전은 각 수신자가 다시 확인한다. **Case Logs**에서 게시·정정·열람·확인·실패·콜백 이력을 조회한다.

서버는 게시·확인·콜백 시각을 UTC로 기록하고 화면은 브라우저 현지 시각으로 표시한다. OR 화면은 별도 **Case Report Workflow**의 상태와 버전을 표시하며, 보고서 본문과 임상 확정은 기존 보고 절차에서 관리한다. 실제 원내 OR 장치·LIS와의 송수신, 전화 발신·녹취, 실사용자 검토는 기관 테스트 환경에서 별도 검증이 필요하다.

## DB 마이그레이션 및 롤백

`0017_frozen_workflow`에서 예비결과 버전, OR 수신권한, 버전별 확인, 콜백 테이블을 추가했다. 기존 테이블이나 데이터 변환은 없다. 케이스 잠금으로 게시 순서와 수신자 변경을 직렬화하며 고유 키로 중복 게시·콜백을 막는다. 롤백이 필요하면 작업을 중지하고 신규 기록을 포함한 DB를 별도 백업한 뒤 `python -s -m alembic downgrade 0016_case_reporting`와 이전 버전을 함께 적용한다. 다운그레이드는 새 테이블의 기록을 제거한다.

## 검증 기록

- Python 3.10.20, Node 22.12.0, Chromium 계열 Chrome 146, 격리 PostgreSQL 18.6과 합성 케이스를 사용했다. 사용자 역할별 실측과 기관 임상 검토는 아직 수행하지 않았다.
- 전체 재현 명령은 `MEDIAUTO_DEMO_PORT=19933 scripts/verify-integration.sh`이다. 브라우저 자동화는 `MEDIAUTO_PLAYWRIGHT_MODULE` 또는 설치된 Playwright와 Chrome이 필요하다. 격리 서버에서 동결절편 시나리오만 다시 확인하려면 검증용 관리자·배정 병리의·OR 계정을 준비한 뒤 `node scripts/frozen-workflow-browser.mjs`를 실행한다.
- 격리 PostgreSQL 18에서 `0016 → 0017 → 0016 → 0017` 및 `python -s -m alembic check`를 통과했다. 기존 케이스와 설정을 보존했고 신규 예비결과·확인·콜백의 합성 기록도 별도 DB에서 백업 복원으로 확인했다.
- 최종 전체 실행에서 빌드, 백엔드 자동 테스트 33개, Chrome 시나리오 15개를 통과했다. 첫 전체 실행의 Case Editor 시간 초과는 단독 실행과 최종 전체 실행에서 재현되지 않았다. 동일 요청 중복, 권한·기관 격리, 확인 실패의 복구, 콜백 복창 및 버전 일치, 재접속 시 확인 유지, 정정 이력, 보고 승인 상태와 예비결과 분리, Case Logs의 관련 이벤트를 확인했다.
- `./start.sh`에 앞서 개발 DB를 `.runtime/before-frozen-0017-20261124T185145.dump`에 백업했다. 9920에서 새 마이그레이션과 기존 케이스·설정·보고 등의 건수 유지, 관리자의 OR 화면 진입과 390px 레이아웃을 확인했다.
- AGENTS 명령표의 사용자 확인은 대기 중이다.
