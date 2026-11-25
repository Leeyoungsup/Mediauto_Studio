# PDF 업무 흐름을 반영한 작업공간 개편

PDF 14–22쪽의 케이스 목록·업무함·슬라이드 미리보기, 23–30쪽의 WSI·케이스 문서·편집·감사, 33–38쪽의 공동 판독·측정·분석 요청을 화면 구성에 반영했다. PDF 화면에서 확인한 정보 구조를 사용했다. 장비·임상 사용 근거는 기존 기능별 검증에 남아 있다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf) · [기능별 대조표](workflow-feature-matrix-42.md)

| 화면 | 새 구성 |
|---|---|
| Workspace | 왼쪽 Case Worklists에서 Worklist, My Cases, Unassigned Cases, Intake를 바로 연다. Collaboration과 Administration에는 사용자 역할에 맞는 링크를 표시한다. |
| Worklist | 상단에 All Cases, Assigned to Me, Unassigned, Slide Registration과 Tumor Board·OR 진입을 정리했다. Global Views 옆에서 Frozen Cases를 바로 적용한다. 오른쪽 Case Preview에서 Slides, Case Summary, Review를 전환하면서 선택 케이스를 유지한다. |
| Case Details | 케이스 헤더에 문서 아이콘을 추가하고, 스캔·환자·이력·미디어·검토 탭을 한 줄에서 탐색한다. |
| WSI Viewer | Slides, Analysis, History, Media, Gross Images, Notes, Case Logs 탭을 권한에 맞춰 표시한다. 의무기록·첨부·메모·감사는 같은 케이스에서 연다. 기존 캔버스를 유지하므로 복귀 시 카메라 위치와 배율이 이어진다. Pan, 사각형·타원·Polygon·Brush ROI, Point·Arrow·Count, 직선·다분절 거리, Preset, Bookmark·Position 조작을 개별 아이콘으로 선택한다. 넓은 화면에서는 영상 왼쪽에, 좁은 화면에서는 영상 위 스크롤 도구 막대에 표시한다. 오른쪽 Annotations에서 작성자·작성 시간, 정렬, 위치 이동 및 ROI 내보내기를 제공한다. |
| Settings | Intake and Integration, Manage Workgroups, Analysis Pre-run Rules, Pap Review Policy, Notifications를 기존 권한과 경로로 연결했다. |

MeDIAuto Studio 표시, 기존 보라색 계열 색상 변수, 영어 UI와 기존 API를 사용했다. DB 마이그레이션은 없다. 기존 테마에 새 섹션과 탭 모양을 적용했다. Viewer 분석의 실행 범위는 기존 보관 결과 재생 및 이미지 사전 점검이다. [Viewer 분석 지원 범위](viewer-analysis-usability.md)

## Polygon ROI

PDF 35–36쪽에서 확인된 측정 도구 메뉴와 오른쪽 주석 목록을 참고했다. 자유형 ROI·Count·Preset·내보내기는 발표자가 설명한 기능이다. 첫 점을 클릭해 도형을 닫는 동작과 잘못된 도형의 표시 방식은 MeDIAuto Studio에서 선택한 설계다.

1. Viewer 왼쪽에서 **Polygon ROI**를 선택하고 영상에서 꼭짓점을 3개 이상 찍는다. 완료 전에는 윤곽선·꼭짓점·다음 선분이 표시된다.
2. 첫 꼭짓점을 다시 클릭하거나 **Close Polygon**을 누른다. 단축키를 활성화한 경우 Enter로 닫고 Backspace로 마지막 점을 취소할 수 있다. **Undo Point**와 **Cancel Drawing**도 사용할 수 있다.
3. **Annotations**에서 이름을 입력하고 **Save Annotation**을 누른다. 저장 목록에서 해당 위치로 이동하거나 권한에 따라 ROI를 PNG로 내보낸다.

Polygon은 최대 256개 꼭짓점을 지원한다. UI와 저장 API에서 중복 꼭짓점, 교차·접촉하는 비인접 변, 면적이 없는 도형을 검사한다. 이전에 저장한 주석은 기존 방식으로 열 수 있다.

## 검증

`MEDIAUTO_DEMO_PORT=19952 scripts/verify-integration.sh`에서 TypeScript/Vite 빌드, Alembic 스키마 검사, 백엔드 테스트 58개 및 Chrome 시나리오 27개가 통과했다.

- Chrome 146과 격리 PostgreSQL 18.6에서 합성 케이스와 로컬 NDPI/SVS를 사용했다. `node scripts/workspace-layout-browser.mjs`를 격리 시연 서버에서 실행해 Worklist 미리보기 탭, 좌우 방향키와 Enter, Viewer의 같은 Canvas 복귀, 가로 390px에서 페이지 넘침 방지와 2560×1080에서 영상 표시를 확인했다.
- 별도 브라우저 시나리오에서 Frozen 바로가기, 환자 이력, PDF와 Gross Images, Case Logs 필터, Notes·멘션과 설정 탭 이동을 확인했다. 첫 회귀에서 변경 전 Frozen 버튼 이름으로 접근하던 시나리오를 갱신했다. 감사 탭 시험의 필드 선택 범위를 새 문서 영역으로 한정했다.
- 9920 LAN의 프런트엔드 자산에서 플랫폼 이름과 새 탐색·작업 탭을 확인했다. 실제 병리 사용자 사용성 검토는 대기 중이다.
- 시연 캡처는 `.runtime/pdf-workspace-layout/`의 Worklist, Viewer, History, Settings 화면에 있다.

### Workspace 및 Polygon 개선 검증 (2026-11-25)

- Node 22.12.0에서 `npm --prefix frontend run build`가 통과했다. 검증 스크립트의 격리 PostgreSQL 18에서 Alembic 검사와 백엔드 테스트 59개가 통과했다.
- `node scripts/workspace-layout-browser.mjs`는 Workspace 업무함 이동·현재 선택 표시, 2560×1080 및 390px 화면, NDPI/SVS 전환을 확인했다.
- `node scripts/viewer-workflow-browser.mjs`는 열린 Polygon 미리보기, 교차 거부, Backspace, 첫 꼭짓점 닫기, 취소, 저장·재접속, API의 교차·면적 없는 도형 거부를 확인했다. Viewer 환경설정·저장된 주석·ROI 유사검색을 포함한 Chromium 브라우저 시나리오 28개가 통과했다.
- `./start.sh`로 개발 서비스 9920을 재시작하고 LAN의 `/api/health` 200 및 배포된 Workspace·Polygon·Annotations 컨트롤을 확인했다. 합성 시연 캡처는 `.runtime/pdf-annotation-workspace/`에 있다. 실제 판독자 사용성 확인은 대기 중이다.
