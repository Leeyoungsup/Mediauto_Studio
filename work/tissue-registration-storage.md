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

## 수동 기준 위치 복원

`Manual Alignment Points` 방식은 파넬별 중심과 배율을 메모리에만 유지하던 문제를 수정했다. **Use Current Positions as Alignment Points**로 현재 중심과 배율을 선택한 Tissue 슬롯에 저장한다. 같은 계정이 같은 스캔 조합을 다시 열면 활성 조직과 Sync 상태를 복원한다. 새 세션의 **Go to Tissue**는 해당 조직의 저장 위치로 이동한다. 기존에 저장된 랜드마크의 형식은 계속 읽을 수 있다. DB 스키마 변경은 없다.

정합 명령을 받는 pane은 스캔 가장자리에서 중심을 화면 크기로 다시 제한하지 않는다. 정합된 좌표를 유지하기 위해 필요한 경우 스캔 바깥 여백을 표시한다. 수동 기준 위치를 이전 빌드에서 설정한 경우에는 업데이트 후 한 번 다시 저장해야 한다.

격리 PostgreSQL에서 `scripts/multi-view-browser.mjs`와 `scripts/viewer-workflow-browser.mjs`를 실행했다. 패널 접기·펴기, Sync 재활성화, Multi View 재진입, 새 로그인 후 같은 스캔 조합의 중심·배율 복원, 기존 Tissue A/B 랜드마크 전환과 접근 제약을 확인했다. 별도 4-pane Chrome 검증에서 닫기 전과 재오픈 후 각 중심 좌표와 배율 차이는 0.00001 미만이었다.

## 파일 접수 케이스와 크기가 다른 스캔

케이스 확정 전 파일 뷰어에도 Tissue 슬롯을 연결했다. 서버는 원본 파일이 같은 접수 Case ID에 속하는지, 접수 권한이 있는지 확인하고 같은 계정과 스캔 집합의 등록을 복원한다. 원본 파일과 다른 케이스의 정합 정보는 변경하지 않았다. 스키마 마이그레이션은 없다.

수동 정합에서는 기준점과 저장 배율의 비율로 위치를 매핑한다. 추가 조직 조각으로 한 원본의 전체 폭이나 여백이 달라도, 동기화 이동량에 원본 전체 크기를 반영하지 않는다. 확대·축소는 사용자가 저장한 배율 비율을 유지한다.

격리 PostgreSQL과 Chrome에서 폭이 다른 SVS 두 장을 파일로 접수한 뒤 **Tissue Registration → Use Current Positions as Alignment Points → Sync Position**을 실행했다. 팬 이동의 기준점 매핑 오차는 측정상 0px였고, 새로고침 뒤 저장 위치와 배율이 복원됐다. 다른 접수 케이스에 속한 스캔으로 조회할 때 404를 확인했다. `scripts/verify-integration.sh --demo ihc`를 통과했다.

9920에서 제보한 네 스캔 조합의 접수 케이스 카탈로그와 Tissue 선택 메뉴를 읽기 전용으로 확인했다.

## 같은 네 슬라이드 조합을 새로고침할 때 Sync Position 복원

같은 탭에서 같은 계정으로 동일한 슬라이드 조합을 다시 선택하면 마지막으로 동기화해 본 중심과 배율을 복원한다. 여러 pane의 위치를 수동으로 맞춘 뒤 일반 **Sync Position**을 처음 켜는 경우 그 위치를 동기화 기준으로 잡는다. 선택된 저장 정합이 있으면 현재 프로필과 일치하는 탭의 위치를 사용한다. 마지막 위치는 탭의 브라우저 세션에 보관하며 DB 스키마 변경은 없다.

`scripts/verify-integration.sh --demo ihc`로 격리 Chrome에서 파일 접수 케이스의 네 SVS를 개별 조정하고 **Sync Position**, 이동, 새로고침, 같은 네 스캔 재선택, Sync Off/On을 실행했다. 네 pane 모두 중심 차이 0.01px 미만과 배율 차이 0.00001 미만을 확인했다.
