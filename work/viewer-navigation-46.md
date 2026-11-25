# 46. WSI Viewer 탐색과 화면 구성

PDF 23쪽에서 관찰한 케이스 탭·슬라이드 목록·WSI의 구성과 24쪽의 라벨·Overview·미니맵 설정을 참고했다. 발표에서 설명한 Tray 방향과 단축키는 기존 사용자 설정 API를 재사용했다. 영상 렌더러, 타일 API, 카메라, 업무 및 전문 판독 도구는 현재 구현을 사용했다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf) · [43번 화면 비교](pdf-frontend-review-43.md)

| 화면 | 현재 동작 |
|---|---|
| 활성 스캔 | 영상 상단의 **Active Scan**에서 슬라이드명, 염색·NDPI/SVS 형식, 짧은 원본 ID를 확인한다. **Previous Scan / Next Scan**은 열 수 있는 스캔을 선택하며 Tray를 접었을 때도 사용 가능하다. 같은 슬라이드 번호의 다른 스캔을 내부 ID로 구분한다. |
| Tray / Gallery | **Slide Tray**는 열 수 있는 수/전체 수를 표시하고 활성 항목을 목록 안에서 자동으로 드러낸다. 넓은 화면에서 세로/가로 설정을 적용한다. 좁은 화면에서는 가로로 넘기는 스트립을 사용하며 Gallery 썸네일을 선택할 수 있다. |
| 영상 탐색 | 줌, Fit, Minimap, Scan Label, Slide Overview 및 Autopan을 같은 조작 영역에 배치했다. 줌은 스캔 원본 대비 상대값이며 스케일바는 픽셀 크기(MPP)가 있는 영상에서 물리 단위를 표시한다. 라벨·Overview 오류의 기존 재시도를 제공한다. |
| 설정과 전체화면 | Viewer Settings의 Slide Tray, Navigator, Autopan, Shortcuts 구역에서 설정을 조작한다. Escape로 닫고 설정 버튼으로 돌아온다. 설정은 **Save as Default**로 계정에 저장한다. 모바일 기본 Viewer에서는 공통 탐색을 접고 **Expand Navigation**으로 다시 표시한다. |
| 케이스 탭 복귀 | History·Media·Gross Images·Notes·Case Logs에서 현재 케이스·스캔의 맥락을 보여준다. 문서 탭을 열면 Autopan을 멈추고 같은 캔버스를 유지한다. **Return to Slides**로 돌아오면 활성 스캔·중심 위치·배율을 이어서 사용한다. |

캔버스 높이는 헤더·Tray·도구와 현재 창 높이를 기준으로 맞춘다. 영상 영역이 300px보다 작아지는 경우에는 최소 높이 300px을 확보하고 페이지를 세로로 탐색할 수 있게 한다. 좁은 화면에서는 판독 도구를 영상 하단에 배치하고 스케일바와 구분했다.

## 재현

1. 관리자로 로그인해 **Worklist → Case Preview → Slides**에서 합성 `IMS-DEMO-101`의 SVS를 연다. 표시된 원본 ID를 확인하고 **Case Details → Open Viewer**로 돌아온다.
2. **Hide Slide Tray**를 누르고 이전·다음 스캔으로 NDPI/SVS를 전환한다. Tray를 다시 열고 **Gallery**를 사용한다.
3. 상단의 Scan Label, Slide Overview, Minimap을 각각 전환한다. Viewer Settings에서 가로 Tray, Gallery, 동적 Minimap, Autopan 방향·속도를 설정하고 저장한 뒤 새 세션에서 확인한다.
4. 영상에 포커스를 둔 상태에서 F, M, G, Space와 방향키를 사용한다. Autopan 중 History를 열어 정지를 확인하고 Slides로 돌아와 중심 위치·배율을 확인한다.
5. 390×844, 1440×900, 2560×1080에서 초기 영상 영역을 비교한다. 최소 높이가 적용되거나 사용자가 공통 탐색을 펼친 경우에는 세로 스크롤이 생길 수 있다.

격리 환경 재현은 [Playwright 준비](integration-demo-10.md) 후 `MEDIAUTO_DEMO_PORT=19986 scripts/verify-integration.sh`를 실행한다. Viewer 집중 시나리오는 `scripts/viewer-preferences-browser.mjs`, `scripts/workspace-layout-browser.mjs`에 있다. 기존 API와 데이터 스키마를 사용하며 마이그레이션은 없다.

## 개발 환경 검증

Linux, Node 22.12.0, Python 3.10.20, 격리 PostgreSQL 18.6 및 Chromium 146에서 로컬 NDPI·SVS와 합성 케이스를 사용했다. 기준 SaaS 커밋 `d3741bc`를 확인했다. Vite 빌드, Alembic 스키마 검사, 백엔드 테스트 59개가 통과했다. 집중 시나리오에서 원본 ID 복원, 라벨·Overview 오류와 재시도, 스캔 순차 이동, 전체화면, 단축키 사용/비활성화, 계정별 설정 재접속, History 이동 중 Autopan 정지, 복귀 후 동일한 중심 좌표·배율을 확인했다.

합성 NDPI를 새 관리자 세션에서 직접 열고 초기에 표시된 캔버스를 측정했다. 기본 Tray와 접힌 공통 탐색 상태의 CSS 픽셀 기준이다.

| 뷰포트 | 캔버스 상단 | 캔버스 하단 | 캔버스 높이 | 페이지 가로 넘침 |
|---|---:|---:|---:|---:|
| 390×844 | 462px | 835px | 373px | 0px |
| 1440×900 | 268px | 891px | 623px | 0px |
| 2560×1080 | 221px | 1071px | 850px | 0px |

첫 집중 시험에서 모바일 도구와 공통 헤더가 영상 위 공간을 더 차지하는 점을 확인했다. 도구를 영상 하단에 옮기고 접힌 공통 탐색을 축소한 뒤, 390px에서 저장된 가로 Gallery 설정을 적용해도 초기 영상이 뷰포트 안에 들어오는 시나리오를 재실행했다. 기관 실사용자 검토는 대기 중이다. [390px Viewer](../.runtime/viewer-46/viewer-390.png) · [1440px Viewer](../.runtime/viewer-46/viewer-1440.png) · [Viewer Settings](../.runtime/viewer-46/viewer-settings.png)

전체 회귀에서 진행자와 Follow 참여자의 Viewer 높이가 달라질 때 로컬 최소 배율이 공유 배율을 덮어쓰는 결함을 재현했다. Follow 카메라를 창 크기 계산과 분리했고, 1520×1050에서 1280×900으로 참여자의 창을 줄이고 다시 넓혀도 동일 스캔·좌표·배율이 유지되는 것을 `--demo collaboration`으로 확인했다. LAN 9920에서 최종 빌드와 `/api/health` 200을 확인했다.

수정 후 28개 Chromium 시나리오를 별도 격리 DB에서 처음부터 재실행해 통과했다. [최종 브라우저 로그](../.runtime/viewer-46/browser-retest.log)
