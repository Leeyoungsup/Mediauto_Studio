# 13번 EMR·LIS 어댑터

## 적용 범위

03번의 기관별 메시지 계약과 테스트 계정은 작업공간에서 확인되지 않았다. AGENTS의 기관·소스별 식별자, 로컬 독립 운영, 명시적 환자 연결 원칙과 화면 초안의 환자 대조 흐름을 적용했다. 공급 기관의 전송 포맷, 인증, 필드 맵이 확정되면 `Adapter` 계약을 구현할 수 있다. 이번 연결 확인, 조회, 수신은 모두 Mock이다.

| 원천 | 식별자와 상태 |
| --- | --- |
| EMR Mock | 기관 범위의 `emr.mock` + `MRN` + 외부 값. 조회 후보의 이름·생년월일은 외부 스냅샷으로 보관한다. |
| LIS Mock | 기관 범위의 `lis.mock` + `ACCESSION`, `SPECIMEN_ID`, `SLIDE_ID` + 외부 값. 케이스·검체·슬라이드의 외부 상태는 각 스냅샷에 저장한다. |
| 로컬 IMS | 환자와 케이스·검체·슬라이드의 내부 UUID가 업무 기준이다. 배정·검토 상태와 수기 환자 정보는 로컬에서 관리한다. |

EMR·LIS는 각 기관에서 독립적으로 `미설정 → 연결 확인 전 → 연결됨`과 `연결 장애 / 사용 중지`를 표시한다. 확인과 외부 조회에 최대 0.8초의 Mock 호출 제한을 둔다. 설정 화면은 연결 유형을 **Mock**으로 표시한다. Worklist·케이스 등록·환자 수기 등록·WSI·검토는 외부 호출 없이 처리한다.

## 브라우저에서 검증 재현

1. 격리 개발 서버에서 관리자로 로그인하고 **설정 → EMR·LIS 연동** 아래 채널의 **개발 Mock**을 저장한다. **연결 확인**으로 정상 또는 장애 시나리오를 확인한다.
2. 합성 케이스의 **환자 정보 → 환자 직접 입력**에서 환자를 저장한다. 케이스 연결과 환자 등록은 같은 DB 트랜잭션과 감사 ID를 사용한다.
3. 관리자 세션으로 Mock API에 아래 합성 메시지를 보내고 **외부 수신함**에서 **연결 검토 필요**를 확인한다.
4. 케이스 **환자 정보 → EMR 조회**에서 외부 환자번호를 검색한다. 후보와 수기 정보가 다르면 불일치 항목을 확인하고 사유를 입력한 뒤 연결한다. 이미 다른 환자에게 연결된 식별자, 바뀐 환자·케이스 버전, 새 외부 버전은 충돌로 처리한다. 이름·생년월일과 로컬 번호는 승인 이후에도 로컬 입력 원문을 유지한다.
5. **Mock 응답 → 응답 지연**으로 바꾼 뒤 연결 확인이나 조회를 실행한다. 연결 장애와 조회 결과 없음을 구분해 표시하며 수기 등록을 계속할 수 있다.

같은 서버의 로그인 브라우저에서 `/docs`로 요청을 실행할 수 있다. 관리자 쿠키를 사용한 합성 예시도 가능하다.

```bash
curl -b "$MEDIAUTO_COOKIE_JAR" -H 'Content-Type: application/json' \
  -d '{"message_id":"EMR-QA-1","resource":"patient","external_id":"SYNTH-MRN","revision":1,"data":{"display_name":"Synthetic Patient"}}' \
  http://127.0.0.1:19920/api/integration/local/connections/emr/messages
curl -b "$MEDIAUTO_COOKIE_JAR" -H 'Content-Type: application/json' \
  -d '{"message_id":"LIS-QA-1","resource":"case","external_id":"SYNTH-ACC","revision":1,"data":{"external_state":"released"}}' \
  http://127.0.0.1:19920/api/integration/local/connections/lis/messages
```

LIS 외부 식별자는 기존 임상 API의 `/{종류}/{UUID}/external-identifiers`로 명시적으로 매핑한다. 케이스에는 `system=lis.mock`, `kind=ACCESSION`을 사용한다. 검체·슬라이드도 동일 방식으로 각 종류를 연결한다. `GET /api/integration/{organization}/sources/{patient|case|specimen|slide}/{UUID}`로 연결 상태, 마지막 동기화, 외부 리비전 등을 확인할 수 있다. 사례 상세의 환자 정보 탭에도 연결된 EMR 환자와 LIS 케이스 상태를 표시한다.

## 수신 계약과 복구

- 메시지 리비전은 각 외부 식별자의 **전체 스냅샷** 순서다. 도착 순서가 바뀌어도 높은 리비전이 유지된다. 이전 버전은 `stale`, 같은 리비전·같은 데이터는 `duplicate`, 같은 리비전·다른 데이터는 `conflict`로 기록한다.
- 기관·채널·메시지 ID가 같은 수신 요청의 내용이 같으면 기존 수신증을 반환한다. 내용이 다르면 409를 반환하고 충돌 횟수를 남긴다. 환자 불일치나 미연결도 스냅샷과 수신함에서 구분한다.
- 외부 시간 초과나 장애는 1·2·4초 대기 후 재시도한다. 네 번째 시도까지 실패하면 **재시도 한도 도달**로 보관한다. 관리자는 연결 복구 후 **재처리**할 수 있다. 내용 충돌은 원천에서 확인한 정정 리비전을 받아 처리한다.
- 외부 호출은 로컬 DB 쓰기 트랜잭션 밖에서 대기한다. 수신함과 스냅샷의 처리는 기관·채널·식별자 범위에서 이루어지며 설정 버전이 바뀐 결과는 적용하지 않는다.
- 실제 기관 연동 전에는 전송·인증, 필드·환자번호 발급기관, 전체 스냅샷/델타 계약, 원본과 감사 이력 보존 기간, 권한 및 기관 테스트 환경 확인이 필요하다.

## 배포와 롤백

`0004_emr_lis`에서 `integration_connections`, `integration_messages`, `integration_snapshots`를 추가한다. 기본값은 별도 연결 설정이 없는 상태다. 롤백 전 설정·수신함·스냅샷을 백업한다. 이전 코드를 배포할 때 격리 환경과 같은 방식으로 `python -s -m alembic downgrade 0003_auth_worklist`를 실행한다. 명시적으로 승인된 환자·외부 ID 연결과 기존 감사 기록은 임상 테이블에 남는다.

`scripts/verify-integration.sh`로 격리 PostgreSQL과 기본 브라우저 회귀를 실행했다. 별도 Chrome 테스트로 Mock 설정, 환자 수기 입력, 대조·승인, 장애 시 조회와 수기 등록을 이어서 검증했다. 실제 기관 인터페이스는 테스트 환경과 승인 계정 대기 상태다.
