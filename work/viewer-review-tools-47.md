# 47. WSI 판독 도구와 복귀 경로

PDF 31쪽에서 ROI 미리보기·장기계통 선택, 34–38쪽에서 4분할·측정·오른쪽 주석 목록·요청·Positive/Total을 확인했다. 외부 PathoSearch, AI 보조 정합과 최대 6분할, Notes/LIS 계수 활용은 발표자의 설명이다. 현재 프런트엔드는 43번 비교와 기존 WSI·주석·검체 계수 API를 사용한다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf) · [43번 대조](pdf-frontend-review-43.md) · [기존 좌표·정합 기준](viewer-workflow-29.md)

| 동작 | 재현 경로 |
|---|---|
| 도형·측정·점 계수 | **Polygon ROI**에서 꼭짓점을 찍고 첫 점 또는 **Close Polygon**으로 닫는다. Undo, Cancel, 교차 윤곽 검증을 사용한다. **Distance Measurement / Multi-segment Distance**는 영상에서 작업하는 동안 길이를 표시한다. **Point Count**의 표식은 개별 점에 번호가 붙으며 저장 전에 확인한다. |
| 주석 검색·위치 | 오른쪽 **Annotations**에서 이름 검색, 유형 선택, 정렬 및 **Show Saved Markup**을 사용한다. **Go to Position**으로 이동하면 목록의 해당 항목과 영상의 도형이 강조된다. 좁은 화면에서는 영상으로 포커스를 돌려준다. |
| 북마크·프리셋 | **Save Bookmark**로 이름과 현재 중심·배율을 저장하고 **Annotation Type → Bookmark**에서 다시 연다. **Calibrated ROI Preset**은 250/500/1000µm 정사각형을 배치한다. 픽셀 크기가 없으면 길이는 px로 표시하고 프리셋은 비활성화한다. |
| ROI Export | 저장한 ROI의 **Export ROI PNG**에서 윤곽·스케일바 포함 여부를 선택한다. 선택 ROI의 경계 상자를 대상으로 하며, 출력은 원본 장변 기준 최대 1600px이다. |
| ROI 유사검색 | 저장한 ROI의 **Find Similar ROIs**에서 로컬 참조를 검색한다. **Open Match in WSI**로 대상 스캔의 ROI가 강조된 위치를 연다. **Return to ROI Search**에서 직전 장기계통을 유지하고 검색을 다시 실행할 수 있다. **Back to Source ROI**는 원본 스캔·ROI로 이동한다. |
| Multi View·정합 | **Multi View**에서 같은 케이스의 2–4개 스캔을 비교한다. 활성 pane의 스캔 형식·ID를 확인한다. **Tissue Registration**에서 각 라운드에 어느 pane의 클릭이 남았는지 확인한다. 처음 2라운드는 정합, 이후 1–6라운드는 독립 오차 확인에 사용한다. **Use Tissue Registration → Sync Position**으로 적용한다. |
| 비교 복귀 | **Open Active Scan in Single View**는 활성 pane의 중심·배율을 단일 Viewer의 화면 범위에서 이어서 사용한다. **Close Comparison**은 비교 전 단일 뷰의 스캔·위치로 복귀한다. 이 복귀 위치는 조회 중 유지된다. |
| 림프절 계수·보고 | Viewer의 **Lymph Node Count**에서 수기로 Positive/Total을 저장한다. 검체 단위 집계이며, 버전마다 입력한 스캔 ID를 표시한다. 같은 검체의 다른 스캔에서 사유와 함께 정정할 수 있다. **Open Report Draft → Result Evidence**에서 해당 버전을 참조하고 **Open Viewer**로 입력 스캔을 다시 연다. |

좌표는 기존 level-0 규약을 사용한다. 물리 길이는 축별 MPP를 사용한다. 정합 오차는 독립 확인점의 RMS/최댓값으로 표시하고, 자동 정합·조직 변형 보정은 별도 범위다. 림프절 계수는 기존 수기·검체 단위와 보고 근거 정책을 적용한다. API·DB 마이그레이션은 없다. 원내 외부 서비스와 판독자 사용성의 검증은 대기 중이다.

## 검증

[Playwright 준비 방법](integration-demo-10.md)을 따른 뒤 프로젝트 루트에서 실행한다.

```bash
export MEDIAUTO_WORKFLOW_EVIDENCE_DIR="$PWD/.runtime/viewer-47"
MEDIAUTO_DEMO_PORT=19993 scripts/verify-integration.sh
```

대표 브라우저 시험은 `scripts/viewer-workflow-browser.mjs`, `scripts/multi-view-browser.mjs`, `scripts/roi-search-browser.mjs`다. NDPI/SVS의 합성 케이스에서 주석·북마크·프리셋, PNG, ROI 복귀, 스캔별 원천이 표시된 검체 계수 정정, 보고 참조 및 수동 정합을 확인한다. MPP 미확인 조건은 메타데이터를 모의 응답으로 재현하며 픽셀 미리보기만 확인한다.

- Node 22.12.0, Python 3.10.20, 격리 PostgreSQL 18.6, Chromium 146에서 Vite 빌드, Alembic 스키마 검사, 백엔드 테스트 59개가 통과했다. 베이스 저장소의 `d3741bc`를 확인했다.
- `node --experimental-strip-types scripts/tissue-registration-check.mjs`가 통과했다. 브라우저의 독립 확인점 2개에서 NDPI→SVS 정합 오차는 RMS 165.78µm, 최대 175.58µm였다. [정합 계산 로그](../.runtime/viewer-47/registration-math.log)
- LAN 9920에 새 프런트엔드와 `/api/health` 200이 제공되는 것을 확인했다. [측정 화면](../.runtime/viewer-47/viewer-tools-47-measurement-preview.png) · [림프절 계수 화면](../.runtime/viewer-47/viewer-tools-47-specimen-count.png) · [정합 화면](../.runtime/viewer-47/viewer-tools-47-landmark-checks.png)
- 최종 Chromium 시나리오 28개가 통과했다. [통합 실행 로그](../.runtime/viewer-47/run.log)
