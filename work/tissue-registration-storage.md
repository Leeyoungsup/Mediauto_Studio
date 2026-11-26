# 조직별 Tissue Registration 저장

Multi View에는 선택한 정합점을 저장할 서버 기록이 없었다. 등록 케이스에서 같은 계정과 스캔 조합에 **Tissue A–Z**를 분리해 저장한다. **Use Tissue Registration**을 누르면 원본 스캔의 픽셀 좌표와 기준 스캔을 저장하고, 해당 조직을 다시 선택할 수 있다. 조직을 바꾸면 마지막 선택에 반영된다. **Sync Position** 상태도 마지막 선택과 함께 저장돼 재접속에서 복원된다.

- **New Tissue B**, **New Tissue C**에서 별도의 정합점을 입력한다. 마지막으로 저장된 정합을 **Update Tissue Registration**으로 갱신할 수 있다.
- **Go to Tissue**는 활성 pane의 저장 랜드마크 영역을 화면에 맞춘다. Sync가 켜져 있으면 다른 pane도 해당 조직으로 이동한다.
- **Deactivate Tissue Registration**은 현재 적용과 동기화를 해제한다. 저장된 조직은 목록에서 다시 선택할 수 있다. 저장 전에는 **Cancel Landmark Picking**으로 이전 적용 조직을 복원할 수 있다.
- 케이스 ID, 계정 ID, 스캔 UUID 집합으로 개인 기록을 구분한다. pane 순서가 바뀌어도 같은 집합을 찾고 저장했던 기준 스캔을 사용한다. 다른 스캔 조합과 교체한 원본에는 별도의 등록이 적용된다.
- 기존 ApplicationSetting과 낙관적 버전 검사를 사용한다. 서버는 케이스 가시성, QC와 스캔 원본, 랜드마크 좌표를 확인한다. DB 마이그레이션은 없다.

## 재현

1. 등록 케이스의 Viewer에서 같은 케이스의 두 스캔을 체크한다.
2. **Tissue Registration → New Tissue A → Pick Tissue Landmarks**에서 서로 대응하는 동일 지점을 각 스캔에 최소 세 쌍 지정한다. **Use Tissue Registration → Sync Position**으로 적용한다.
3. **New Tissue B**를 선택해 다른 조직에 대해 반복한다.
4. 브라우저에서 같은 계정으로 다시 로그인한다. 스캔 두 장을 반대 순서로 체크하고 **Tissue B · Sync On**을 확인한다. **Tissue A**와 **Go to Tissue**로 돌아간다.

## 검증 결과

- React/Vite 빌드와 `git diff --check` 통과. Node 22.12.0, Chromium, 격리 PostgreSQL 18, 합성 케이스의 NDPI/SVS에서 검증했다.
- `scripts/verify-integration.sh --manual`로 격리 서버를 시작하고 `node scripts/viewer-workflow-browser.mjs` 실행 · PASS. A/B 좌표와 마지막 Sync 저장, 반대 pane 순서에서 새 로그인 후 Tissue B·Sync On 자동 복원, Tissue A 전환, Go to Tissue, 다른 계정 분리, 오래된 버전의 409와 다른 스캔 조합의 404를 확인했다.
- HTTPS 9920 · 실제 등록 케이스에서 저장 목록 API 200과 Tissue 선택 메뉴를 확인했다. 저장·재접속 검증은 위 격리 케이스에서 수행했다.
