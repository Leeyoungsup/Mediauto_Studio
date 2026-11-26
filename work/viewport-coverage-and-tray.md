# Viewer 타일 커버리지와 Slide Tray 비교

- 원인 · 상세 타일 목록은 viewport 전체를 계산했지만 요청 단계에서 가운데에 가까운 타일만 캐시 한도의 절반만큼 잘랐다. 요청한 타일이 다 오면 화면 가장자리의 미요청 영역도 로딩 완료로 표시됐다.
- 변경 · 해상도 단계별로 viewport 전체에 필요한 타일을 요청한다. 현재 작업 집합이 크면 화면 픽셀에 필요한 해상도를 충족하는 범위에서 피라미드 단계를 선택한다. 현재 viewport에 필요한 타일은 캐시에서 보호한다. 확대·팬 중에는 Overview와 이미 도착한 타일을 사용하며, 실패는 Viewer 안에서 재시도할 수 있다.
- 동작 · **Open Viewer → Slide Tray**에서 현재 스캔 옆의 체크 상태를 확인하고 다른 스캔을 체크한다. 같은 Viewer에서 최대 6장으로 분할된다. 비교 시 Tray와 영상 조작 중심으로 상단을 줄였고, 등록·정합 조작은 **Tissue Registration** 메뉴로 열 수 있다. 더블클릭 확대, 활성 pane, Sync Position과 수동 정합을 지원한다. 한 장만 남기면 단일 Viewer로 돌아온다.
- pane별 주석 · 각 pane 상단의 **Annotations** 아이콘에서 저장 주석 목록과 도형, 거리 측정, 계수, 북마크 도구를 연다. 도구를 선택하면 목록이 닫혀 영상 위에서 그릴 수 있다. 저장 목록과 ROI는 해당 스캔에 귀속된다. 조직 정합의 랜드마크를 입력하는 동안 주석 도구가 접힌다.
- DB·마이그레이션 · 없음. 기존 타일 API, 접근 범위, 원본 파일과 비교 좌표를 사용한다.

## 검증

- Node 22.12.0, Chromium, PostgreSQL 18 격리 스키마. `npm --prefix frontend run build` 및 `git diff --check`.
- `node scripts/wsi-viewport-coverage-browser.mjs`는 2200×1410에서 48개 타일이 모두 요청되어 네 모서리의 실제 캔버스 픽셀이 타일 색으로 렌더링됨을 확인했다. 503인 타일을 한 번 발생시키고 Retry에서 복구했다.
- `node scripts/multi-view-browser.mjs`는 두 pane의 이미지 높이(650px 이상), Tray 체크, 6장까지 추가, 7번째 제한, 기존 pane 유지, 동기화·오류 복구·더블클릭 및 체크 해제 후 단일 복귀를 검증했다.
- `node scripts/viewer-workflow-browser.mjs`는 기존 주석·ROI 내보내기·계수·수동 조직 정합을 검증했다. `node scripts/viewer-preferences-browser.mjs`는 단일 Viewer 설정, 모바일 화면, Tray, 전체화면, Autopan 및 스캔 전환을 검증했다.
- HTTPS 9920 · 실제 NDPI/SVS를 Tray 체크로 비교했다. 1520×1024 화면에서 첫 pane 영상 높이 808px, 확대 타일 로딩 완료, 390px 너비에서 가로 넘침 없이 비교 화면 유지, 체크 해제 후 동일 Viewer의 단일 스캔 상태 복귀를 확인했다.
- pane 주석 후속 검증 · 격리 Chromium에서 첫 pane에 Polygon을 저장하고 두 번째 pane에 보이지 않는 것을 확인했다. 두 번째 pane의 거리 측정은 µm로 저장했다. 비교를 닫고 다시 열었을 때 Polygon의 원래 스캔·기록 ID·오버레이가 복원됐다. 9920에서는 실제 스캔 두 pane에서 각각 도구와 목록을 열었다.
- 검증 서버 기동 · 지정 포트를 이전 테스트 서버가 사용하고 있었다. 테스트 실행이 이번 Uvicorn 프로세스의 기동 로그와 응답을 모두 확인하도록 고쳤으며, 새 포트에서 검증했다.
