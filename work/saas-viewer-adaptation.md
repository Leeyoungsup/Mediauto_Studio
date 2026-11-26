# SaaS Viewer 동작 재사용

기준은 [SaaS 저장소](../reference/Base_Git_repository.txt)의 `d3741bc5eb8aa4dd01da043b8e48cadd97933a70`이다. 로컬 체크아웃의 HEAD와 지정 커밋을 확인했다.

| SaaS 모듈 | IMS 적용과 재현 |
|---|---|
| `frontend/js/tile-viewer.js`의 `_setupEvents`, `getMagnification` | WSI의 휠을 포인터가 가장자리에 있을 때 돌려도 현재 중심을 기준으로 1.1배씩 확대한다. 스캔 MPP가 있으면 **Calibrated Magnification**에서 현재 배율을 확인하고 2×–80× 중 가능한 값을 선택한다. 뷰어 상한과 스캔 가로 MPP를 사용한다. |
| `frontend/js/multi-view-focus.js` | 비교 pane의 캔버스를 빠르게 더블클릭해 활성 pane으로 확대하고 **Restore Split View**로 돌아온다. 크기 변화 시 중심과 배율을 보존한다. 기존 6 pane, 활성 pane, 수동 조직 정합·위치 동기화와 연결한다. |
| `frontend/js/ai-viewer.js`, `tile-viewer.js`의 `_renderCells` | WSI 옆 **Detection Results**에서 IHC/PD-L1 결과 버전과 오버레이를 확인한다. 넓은 시야에서는 밀집 점, 5 µm/px 이하에서는 색상별 테두리로 표시한다. API의 뷰포트 범위와 셀 표시 제한을 사용한다. |
| `frontend/js/app.js`의 셀 수정 팝업 및 단축키 | 최신 IHC 결과에서 세포를 우클릭한다. 메뉴 또는 숫자키로 분류를 고르면 테두리에 변경 색이 나타난다. **Review Reason → Save IHC Review**로 새 리비전을 남긴다. 기존 검토 화면에서 원본 조회, 이력, 원본 복원을 확인한다. |

React 화면과 인증된 스캔 타일·분석 API에 해당 동작을 옮겼다. DB 스키마 변경은 없다. PD-L1은 현재 원본과 가져온 수정본을 선택하는 보관 결과 API를 사용한다. 이번 세포 직접 수정은 IMS의 검토 및 집계 계약이 연결된 IHC에 적용했다.

## 검증

- Node 22.12.0, 기존 Conda 환경, 격리 PostgreSQL 18과 Chromium에서 NDPI·SVS 및 합성 세포 결과를 사용했다.
- `scripts/verify-integration.sh --demo ihc` · PASS. 중심 유지 휠, 빠른 더블클릭과 6 pane, IHC 수정·리비전·원본 복원, HER2 Composite, PD-L1 원본·가져온 수정본·CPS/TPS 검증 표시, 활성 스캔의 분석 결과 열기와 카메라 유지.
- HTTPS 9920 · PASS. 등록된 스캔에서 **20×** 선택 및 Multi View 더블클릭 확대·복귀 확인. AI 검토는 위 격리 자료로 검증했다.
- 일반 통합 시연에서 로그인·배정·NDPI/SVS·검토 기록 저장은 통과했다. 이어지는 Case Editor 재스캔 테스트는 지정 교체 NDPI 파일 부재로 404를 반환해 전체 실행이 중단됐다.
- 모바일 390px 프런트에서 배율 선택과 상대 확대율이 함께 표시돼 불필요한 줄바꿈이 생겼다. 스캔 보정 배율이 있으면 좁은 화면에는 보정 배율만 표시한다. `viewer-preferences-browser.mjs`에서 모바일 배치와 설정·발표 모드·Autopan 회귀를 확인했다.
