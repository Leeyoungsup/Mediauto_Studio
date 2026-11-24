# 27. Case Report, 음성 전사 초안 및 LIS 송신

## 범위와 근거

- **화면과 발표**. PDF 4.5절은 T 59:39–1:00:37에서 Reporting과 Dictation 템플릿 구성을 발표 내용으로 기록한다. 실제 LIS 제출은 이 근거에 포함되지 않는다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- **참석자 의견**. 보고의 법적 확정, 서명 권한, 기관별 송신 형식과 ACK 정의에 대한 승인 기록은 확인되지 않았다.
- **IMS 구현 결정**. 관리자와 배정 병리의가 초안을 작성·검토 요청하고, 배정 병리의가 근거를 직접 검토한 뒤 IMS 내부에서 승인한다. 임상 서명 정책 및 원내 운영 LIS 연동은 기관의 별도 승인이 필요하다. Outbound는 기존 Stage 13 개발 Mock만 사용한다. 기존 요청의 Report Draft References와 읽기 전용 PD-L1 뷰어를 유지한다.

## 사용자 흐름

1. **Case Details → Report Draft** 또는 WSI에서 **Report Draft**를 연다. **Report Template**을 선택한다. 관리자는 **Manage Templates**에서 새 템플릿과 개정판을 등록한다.
2. 보고 섹션을 채우고 **Result Evidence**에서 같은 케이스의 완료된 자문과 보관 AI 결과를 연결한다. 근거는 요청 버전, 응답, AI 스냅샷·모델·분석 버전과 함께 저장한다. 표시하는 정보는 기존 결과 참조이며, 원본 AI 산출 자료는 기존 뷰어에서 연다.
3. **Dictation Draft**에서 온디바이스 브라우저 전사 또는 붙여넣은 전사 텍스트를 검토한다. **Apply Transcript to Section**을 누르면 편집 중인 섹션에 추가된다. **Save Draft**로 저장할 때 반영한 섹션을 기록한다. 음성은 브라우저에서 로컬 인식에만 사용하며 서버에는 사용자가 반영한 보고 텍스트를 저장한다. 지원 브라우저, 보안 출처, 마이크 권한, 사용 가능한 언어 팩이 필요하다. [Web Speech API](https://webaudio.github.io/web-speech-api/) · [Chrome의 온디바이스 음성 인식](https://developer.chrome.com/release-notes/139)
4. **Submit for Review** 후 배정 병리의가 내용을 확인한다. **Return to Draft**에 사유를 입력해 되돌리거나, 검토 확인을 선택하고 **Approve Report**를 누른다. **Version History**에서 각 버전의 섹션과 저장된 근거를 연다.
5. 정정은 승인본에서 **Start Correction**과 사유를 입력해 새 초안을 시작한다. 원본을 보존하고 새 버전에 기존 승인 버전 번호와 정정 사유를 기록한다. 기존 송신 건이 있으면 ACK가 확인된 뒤 정정을 시작한다.

## Mock LIS 계약

- 관리자가 **Settings → EMR and LIS Integration → LIS**에서 **Development Mock** 및 **Enable Mock Report Delivery**를 저장한다. 보고 화면에서 관리자 권한으로 검증한 Mock accession을 연결한다. 같은 기관·케이스에 연결 상태인 단일 `lis.mock / ACCESSION`이 필요하다.
- 승인 이후 **Queue Mock LIS Delivery**를 별도로 실행한다. 전송은 승인된 고정 버전과 accession을 사용하며, 환자 인적사항과 근거 본문 대신 보고 섹션 및 송신 메타데이터를 구성한다. 실제 네트워크 송신과 기관 데이터 입력은 승인된 기관 테스트 계약이 확보될 때 검증한다.
- 전송 ID와 내용 지문을 ACK와 대조한다. 중복 큐 요청과 재시도는 같은 전송 UUID를 사용한다. 대기, 발송 중, 재시도, 승인 응답 및 실패를 표시한다. 타임아웃·잘못된 ACK는 제한적으로 재시도하고 거절 ACK는 검토 대상으로 남긴다. **Retry LIS Delivery**를 누르면 같은 승인본과 ID를 사용한다.
- 이전에 ACK된 승인본이 있을 때 새 전송은 해당 ACK를 가리키는 정정이다. 앞선 승인본이 로컬에서만 보존되고 ACK된 송신이 없으면 최신 승인본이 최초 송신으로 분류된다. 기존 Case Logs에 승인·정정·송신 상태와 실패를 기록하며 보고서 본문은 버전 이력에 보존한다.

## 마이그레이션과 검증

- `0016_case_reporting`는 보고 템플릿·헤드·불변 버전·전송 테이블과 Mock 송신 승인 설정을 추가한다. 기본 송신은 비활성이다. 롤백 시 작업자를 정지하고 새 보고·전송 데이터를 백업한 뒤 이전 코드의 스키마로 `python -s -m alembic downgrade 0015_case_notifications`를 실행한다. 기존 요청·Case Logs와 연동 구성은 보존된다.
- 실제 기관 LIS 테스트 인터페이스, 기관 승인 역할 정책, 실마이크 언어 팩과 임상 사용자 검토는 대기 중이다.
- 베이스 저장소에 `d3741bc`가 있는 것을 확인했다. 격리 PostgreSQL 18.6에서 `0015 → 0016 → 0015 → 0016` 및 Alembic 스키마 일치를 검증했다.
- 9920 개발 DB를 `.runtime/before-reporting-0016-20261124T183510.dump`에 백업한 뒤 적용했다. 기존 케이스·설정·감사·알림 건수를 비교했고 기본 템플릿과 Mock 송신 비활성 상태를 확인했다.
- `MEDIAUTO_DEMO_PORT=19928 scripts/verify-integration.sh`에서 빌드와 자동 테스트 32개, 기존 Chrome 시나리오 13개를 통과했다. 새 스크립트의 테스트 선택자와 합성 접수 번호를 보완한 뒤, 같은 격리 서버에서 새 합성 케이스로 `node scripts/case-report-browser.mjs`를 다시 실행해 통과했다.
- 온디바이스 전사 이벤트는 합성 음성 인식 대역으로 검증했다. SQL 테스트에서 역할·버전 충돌·근거 검사, 잘못된 ACK와 동일 전송 ID 재시도, 정정의 이전 ACK 연결, 원본 승인본 보존을 확인했다. 명령표의 사용자 확인은 대기 중이다.
