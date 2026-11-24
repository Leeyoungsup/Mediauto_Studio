# 32. 개인·공유 컬렉션과 Tumor Board

## 참조 근거와 개발 기준

- PDF 19쪽 P08 02:45의 화면에는 GI Tumor Board, Collection note, Add가 보인다. 발표(T 37:33–40:38)는 Worklist의 케이스를 이동 없이 컬렉션에서 참조하는 흐름을 설명한다. 참석자의 의견을 원내 권한이나 환자 정보 공유 승인으로 사용하지 않았다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- 베이스 `d3741bc` 확인 후 현재 IMS의 Worklist, 케이스·WSI 접근 정책, 완료된 자문·AI 및 보고 화면을 재사용했다. 컬렉션과 회차에는 케이스 내부 ID로 참조를 저장한다.

## 사용자 흐름

1. **Collections and Tumor Board → New Collection or Board**에서 개인 또는 공유 컬렉션을 만든다. 관리자는 Tumor Board도 만들 수 있다.
2. 공유 컬렉션 소유자는 **Manage Members**에서 같은 기관의 활성 관리자·병리의를 Viewer 또는 Editor로 지정한다. Board 소유자는 **Manage Participants**에서 Participant 또는 Coordinator로 지정한다. Coordinator는 회차와 안건을 편집하고 소유자가 참가 권한을 관리한다.
3. Board에 **New Board Meeting**으로 제목과 날짜를 입력한다. **Worklist → Add to Collection or Board**에서 컬렉션 또는 회차를 고르고 메모를 입력한다. 같은 케이스는 대상 목록에 한 번만 추가한다. 저장 후 **Open Destination**으로 이동할 수 있다.
4. 회차 안건의 **Move Earlier / Move Later**, **Edit Note**, **Mark Presented / Clear Presented**로 순서와 상태를 관리한다. Presented에는 처리자와 시각을 보존하며 케이스 검토 상태 및 보고 승인과 독립적으로 기록한다.
5. 케이스 제목으로 상세를 열고 **Slides and Completed Results**에서 해당 스캔, 완료된 자문·AI 요청, 분석 시도·보관 원본, 최신 승인 보고서를 연다. 열람 경로마다 기존 케이스·스캔 권한을 다시 적용한다.

## 데이터·권한

- 개인 컬렉션은 소유자에게만 보인다. 공유 컬렉션 및 Board는 소유자와 명시적으로 지정한 구성원에게 보인다. 참여자에게 원본 케이스 권한도 있을 때만 안건과 메모를 제공하며, 다른 안건의 개수·제목·링크는 응답에 싣지 않는다. Board 멤버십은 회차에 상속한다. 권한을 회수하면 다음 요청부터 접근이 차단되고 열린 안건은 자동 재조회에서 해제된다.
- 메모·Presented·참조 제거에는 안건 버전을 사용한다. 순서 변경에는 컬렉션 버전을 적용한다. 제한된 편집자는 조회 가능한 안건 사이에서만 순서를 조정한다. 같은 케이스와 메모를 다시 제출하면 기존 항목을 반환하며, 다른 메모는 기존 항목의 수정 경로를 사용한다.
- 컬렉션·구성원·안건의 감사 이벤트는 기존 감사 데이터에 저장한다. 변경 유형과 참조만 기록해 개인 메모가 공유 Case Logs로 노출되지 않게 한다. 안건 제거는 참조의 소프트 삭제이며 원본 케이스·스캔을 보존한다.
- `0020_case_collections`은 `case_collections`, `collection_members`, `collection_entries`를 추가한다. 기존 스키마와 업무 기록은 변환 없이 유지한다. 컬렉션 기록이 있는 DB에서 다운그레이드를 차단한다. 배포를 되돌려야 하면 현재 DB를 별도 백업하고 이전 코드와 배포 전 백업의 복원을 격리 환경에서 확인한다.

## 검증

- PostgreSQL 18.6, Python 3.10.20, Node 22.12.0, Chrome 146에서 검증했다.
- 격리 DB에서 `0019 → 0020 → 0019 → 0020`, `alembic check`, 기존 케이스·분석·보고 보존과 컬렉션 생성 후 다운그레이드 차단을 확인했다.
- API에서 동시 추가, 동시 메모 편집, 오래된 순서·제거 버전, 다른 기관과 비구성원, 참석과 케이스 권한의 교차 적용, 배정 변경 및 참석 권한 회수 후 차단을 확인했다.
- 브라우저 재현은 `MEDIAUTO_DEMO_PORT=19943 scripts/verify-integration.sh`에서 빌드, 백엔드 테스트 38개와 Chrome 시나리오 19개를 통과했다. 개인·공유·Board 회차 작성, Worklist 참조 추가, 안건 준비, 실제 예제 SVS와 완료 자문 열기, 열린 회차에서 참가 권한 회수를 확인한다.
- 독립 브라우저 실행에서 개인·공유 컬렉션과 Board 생성부터 4개 참조 추가, 재정렬·메모 수정 및 Presented까지 2.9초, 클릭·변경 이벤트 58개, 해시 경로 전환 7개를 기록했다. 자동화 픽스처의 시간이며 실제 사용자 시간은 별도 측정이 필요하다.
- 9920 개발 DB를 `.runtime/before-collections-0020-20261124T194950.dump`에 백업한 뒤 적용했다. 이전 데이터 및 설정 건수 보존과 새 UI·인증된 컬렉션 목록을 확인했다.
- 실제 기관 사용자의 회의 준비 시간과 조직 승인 여부는 검토 대기 중이며 AGENTS 완료 체크는 사용자 확인 대상이다.
