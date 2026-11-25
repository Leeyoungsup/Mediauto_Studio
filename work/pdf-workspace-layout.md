# PDF 업무 흐름을 반영한 작업공간 개편

PDF 14–22쪽의 케이스 목록·업무함·슬라이드 미리보기, 23–30쪽의 WSI·케이스 문서·편집·감사, 33–38쪽의 공동 판독·측정·분석 요청을 화면 구성에 반영했다. PDF 화면에서 확인한 정보 구조를 사용했다. 장비·임상 사용 근거는 기존 기능별 검증에 남아 있다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf) · [기능별 대조표](workflow-feature-matrix-42.md)

| 화면 | 새 구성 |
|---|---|
| Worklist | 상단에 All Cases, Assigned to Me, Unassigned, Slide Registration과 Tumor Board·OR 진입을 정리했다. Global Views 옆에서 Frozen Cases를 바로 적용한다. 오른쪽 Case Preview에서 Slides, Case Summary, Review를 전환하면서 선택 케이스를 유지한다. |
| Case Details | 케이스 헤더에 문서 아이콘을 추가하고, 스캔·환자·이력·미디어·검토 탭을 한 줄에서 탐색한다. |
| WSI Viewer | Slides, Analysis, History, Media, Gross Images, Notes, Case Logs 탭을 권한에 맞춰 표시한다. 의무기록·첨부·메모·감사는 같은 케이스에서 연다. 기존 캔버스를 유지하므로 복귀 시 카메라 위치와 배율이 이어진다. Pan, ROI, Ruler, Bookmark, Position 조작을 아이콘으로 구분했다. 넓은 화면에서 도구 영역을 영상 위로 배치하고 좁은 화면에서는 영상 아래로 이동한다. |
| Settings | Intake and Integration, Manage Workgroups, Analysis Pre-run Rules, Pap Review Policy, Notifications를 기존 권한과 경로로 연결했다. |

MeDIAuto Studio 표시, 기존 보라색 계열 색상 변수, 영어 UI와 기존 API를 사용했다. 데이터·DB 마이그레이션 변경은 없다. 기존 테마에 새 섹션과 탭 모양을 적용했다. Viewer 분석의 실행 범위는 기존 보관 결과 재생 및 이미지 사전 점검이다. [Viewer 분석 지원 범위](viewer-analysis-usability.md)

## 검증

`MEDIAUTO_DEMO_PORT=19952 scripts/verify-integration.sh`에서 TypeScript/Vite 빌드, Alembic 스키마 검사, 백엔드 테스트 58개 및 Chrome 시나리오 27개가 통과했다.

- Chrome 146과 격리 PostgreSQL 18.6에서 합성 케이스와 로컬 NDPI/SVS를 사용했다. `node scripts/workspace-layout-browser.mjs`를 격리 시연 서버에서 실행해 Worklist 미리보기 탭, 좌우 방향키와 Enter, Viewer의 같은 Canvas 복귀, 가로 390px에서 페이지 넘침 방지와 2560×1080에서 영상 표시를 확인했다.
- 별도 브라우저 시나리오에서 Frozen 바로가기, 환자 이력, PDF와 Gross Images, Case Logs 필터, Notes·멘션과 설정 탭 이동을 확인했다. 첫 회귀에서 변경 전 Frozen 버튼 이름으로 접근하던 시나리오를 갱신했다. 감사 탭 시험의 필드 선택 범위를 새 문서 영역으로 한정했다.
- 9920 LAN의 프런트엔드 자산에서 플랫폼 이름과 새 탐색·작업 탭을 확인했다. 실제 병리 사용자 사용성 검토는 대기 중이다.
- 시연 캡처는 `.runtime/pdf-workspace-layout/`의 Worklist, Viewer, History, Settings 화면에 있다.
