# 22. 스캔 선택과 뷰어 설정

개발 구현·자동 검증 완료. 9920 개발 서버에 반영했다. 임상 사용자 검토와 명령표의 사용자 확인은 대기 중이다.

## 범위와 근거

- **화면 관찰**. PDF 22쪽은 Worklist에서 슬라이드 썸네일과 염색을, 23쪽은 같은 케이스의 Tray와 WSI를, 24쪽은 라벨·Overview·동적 미니맵 설정을 보여준다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)
- **발표 설명**. Tray 가로·세로 배치, 단축키, 전체화면·Autopan은 발표 구간에 기록되어 있다. 발표에서는 Worklist 썸네일 위에서 검토 준비 상태를 확인하는 흐름도 설명한다.
- **참석자 의견**. 해당 구간의 구체적인 갤러리 배치, Autopan 동작 또는 개인 저장 범위를 참석자가 승인했다는 기록은 확인되지 않았다.
- **IMS 구현 결정**. 갤러리는 Tray 안의 큰 썸네일 배치다. 단일 WSI에서 사용자가 지정한 방향과 속도로 시작한 Autopan은 경계·수동 조작·스캔 전환·탭 숨김 시 멈춘다. 속도는 화면 CSS 픽셀 기준 초당 60·120·240이다. 전체화면은 브라우저 Fullscreen API를 사용한다. 개인 기본값은 **Save as Default**를 눌러 다른 세션에 적용한다.

## 데이터와 동작

- 기존 베이스 경로에서 `d3741bc`를 확인했다. IMS의 케이스 조회와 스캔 UUID, 원본 파일 확인, OpenSlide JPEG, Canvas 타일 및 레벨 0 좌표를 재사용했다. Worklist 미리보기·Case Details·Tray의 스캔은 형식과 짧은 ID를 표시하며 모두 정확한 원본 UUID를 연다. Case Details로 돌아올 때 URL에 선택한 스캔을 유지한다.
- WSI의 라벨 API는 스캔의 기존 조회 권한과 QC 게이트를 적용한다. 임상 스캔은 최신 업로드 라벨을 우선하며 업로드본이 없으면 OpenSlide 내장 라벨을 읽는다. 파일 등록 스캔은 내장 라벨을 읽는다. 누락·읽기 실패는 해당 스캔에서 안내하며 Overview와 라벨을 따로 재시도할 수 있다.
- `0011_viewer_preferences`는 계정·기관 복합키를 가진 `viewer_preferences`를 추가한다. UI 기본값, 화면 표시 방식과 Autopan 옵션만 저장한다. 저장에는 버전 번호를 사용하며 다른 세션의 변경과 충돌하면 사용자에게 재로드를 안내한다. 기존 Worklist 저장 뷰와 별도다.
- 롤백은 개발 DB를 백업하고 이전 앱 코드로 되돌린 뒤 `cd backend && python -s -m alembic downgrade 0010_case_editor`를 실행한다. 이 단계에서 저장한 Viewer 기본값만 제거된다. 설정을 복구하려면 해당 테이블 데이터를 미리 백업한다.

## 사용자 재현

1. Worklist에서 케이스를 선택하고 **Case Preview**에서 포맷·번호가 다른 스캔을 클릭한다. **Case Details**로 돌아간 뒤 같은 스캔에 선택 표시가 있는지 확인한다. **Open Viewer**로 다시 연다.
2. **Viewer Settings**에서 Tray 가로·세로, 갤러리, 라벨, Overview, 동적 미니맵을 조정하고 **Save as Default**를 누른다. 같은 계정으로 새 브라우저 세션에 접속한다.
3. 캔버스에 포커스한 상태에서 `F` 전체화면, `M` 미니맵, `G` 갤러리, `Space` Autopan, 방향키 이동, `+` / `-` 확대·축소, `0` 화면 맞춤을 사용한다. 확대 후 Autopan을 실행하고 수동으로 움직여 자동 이동을 중단한다.

## 검증

- Linux 6.8, AMD Threadripper PRO 5965WX, Node 22.12.0, PostgreSQL 18.6, Chrome 146. 같은 슬라이드 번호의 NDPI 356 MB / 49,920 × 59,904 px와 SVS 669 MB / 70,685 × 87,947 px를 사용했다. 임상 등록 정보와 업로드 라벨은 합성 데이터다.
- `bash /tmp/mediauto-22-rollback.sh` **PASS**. 격리 DB에서 `0010 → 0011 → 0010 → 0011`, Alembic 스키마 일치와 기존 케이스·라벨·설정 구조 보존을 확인했다.
- `MEDIAUTO_DEMO_PORT=19921 scripts/verify-integration.sh` **PASS**. Playwright와 Tesseract 경로를 지정해 빌드, Alembic 검사, PostgreSQL/API 23개 및 Chrome 9개 시나리오를 실행했다. 실제 NDPI·SVS 전환, 정확한 복귀, 개인 기본값, 라벨·Overview 오류 및 재시도, 업로드 라벨 표시, 단축키, Autopan 이동·정지, 전체화면과 요청·ROI·Multi View 회귀를 확인했다. 샘플 NDPI·SVS에는 내장 라벨이 없었다.
- 9920 개발 서버 **PASS**. 기존 DB를 `.runtime/before-viewer-0011-20261124T173128.dump`에 백업한 뒤 적용했다. 기존 설정과 업무 데이터 건수를 비교했고, 등록 샘플에서 Worklist 미리보기·Overview·가로 Tray·Case Details 복귀를 확인했다.
- 기존 통합 시연과 같은 자동 측정에서 로그인→Worklist는 관리자 472 ms, 병리의 375 ms였다. 첫 WSI 374 ms, 휠 36 ms, 드래그 79 ms였다. 원본 전환 5회 중앙값은 NDPI 280 ms 및 SVS 376 ms였다. 직전 기준 기록은 NDPI 276 ms 및 SVS 278 ms였고, 이번 SVS 측정 범위는 272–399 ms였다. 실행별 편차가 있어 SVS 전환 성능의 동등 여부는 미확정이다.
- 외부 사용자 임상 사용성과 브라우저별 전체화면 지원은 별도 검증이 필요하다. 동시 사용 부하와 임상 검토 속도에 대한 합격 기준은 설정하지 않았다.
