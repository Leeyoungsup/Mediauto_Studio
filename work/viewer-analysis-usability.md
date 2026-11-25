# Viewer 사용성과 분석 실행

## 변경 범위

- Viewer의 **Analysis**에서 현재 등록 스캔의 염색, 실행 가능한 방법과 최근 시도를 표시한다. 케이스 및 스캔 선택을 다시 입력할 필요가 없다. 모델이 하나면 기본 선택하고, 둘 이상이면 사용자가 선택한다.
- 분석 패널에서 대기/실행/완료/실패 상태, 실패 사유, 취소, 재실행과 상세 요청을 확인한다. 빈 보관본은 실행 선택에 넣지 않고 이유를 표시한다. 활성 스캔을 바꾸면 새 스캔의 작업을 불러온다.
- **Show Result on Slide**는 완료된 PD-L1 보관 원본을 현재 캔버스에 표시한다. 경로와 카메라를 유지한다. IHC Image Preflight의 결과는 이미지 크기와 보정 정보로 표시한다.
- Viewer 제목 영역의 환자 이력·첨부·메모·감사·Case Editor는 **Case Tools**에 모았다. 보고와 요청 경로를 제목 영역에 유지한다. **Requests**에는 수동 자문, 보관본 연결, 과거 실행 이력이 있다.
- 기존 승인·케이스·스캔 권한을 적용한다. 새 조회 경로와 기존 요청·워커를 사용한다. 현재 스캔에서 같은 실행이 이미 대기·진행 중이면 새 분석 요청을 만들지 않는다. 마이그레이션 변경은 없다. 이전 버전의 앱 코드로 돌아가도 해당 요청과 기록은 기존 요청 페이지에서 조회할 수 있다.

## PDF 대비 남은 범위

PDF 22–24쪽에 스캔·Tray·Viewer 조작 화면, 37쪽에 AI/자문 요청 화면이 보인다. 37–44쪽에는 발표자가 설명한 모델 작업 및 결과와 스캔 오버레이 화면이 있다. 이번 작업의 분석 버튼과 우측 패널은 IMS에서 조작을 줄이기 위해 추가했다. 임상 사용자 평가와 모델·검체별 적용 승인 기록은 확인하지 못했다. [참조 PDF](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)

현재 Viewer의 큐에서 실행하는 작업은 **PD-L1 CPS/TPS 보관 원본 재생**과 **IHC 이미지 사전 점검**이다. 경로 및 파이프라인을 점검한 결과 기존 베이스에 PD-L1 체크포인트가 있고 개발 Conda 환경에 PyTorch가 있다. IMS의 큐에는 새 추론 어댑터가 없으며 해당 환경에서 Ultralytics를 찾지 못했다. `nvidia-smi`도 NVIDIA 드라이버에 연결하지 못했다. 새 추론의 처리 시간과 모델 산출, 임상 검증은 이번 작업에서 실행하지 않았다. 기존 결과 카드와 전문 도구는 등록 데이터에 의존한다.

Viewer의 UI 개선 뒤에도 자동 조직 정합·최대 6분할, 기관 DICOM Metadata·PACS 조회, 림프절 계수의 Notes 자동 연계는 남아 있다. 현재 지원되는 수동 정합·최대 4분할, OpenSlide 메타데이터, 계수의 보고 참조 범위와 전문 분석의 근거는 기능표에 기록했다. [42번 기능별 대조표](workflow-feature-matrix-42.md)

## 재현과 검증

Worklist에서 등록된 PD-L1 또는 IHC 슬라이드를 열고 **Analysis → Analysis Method → Run Analysis**를 누른다. PD-L1 보관 원본이 있는 경우 **Show Result on Slide**를 누르면 같은 위치와 배율에 오버레이가 표시된다. 보관 원본이 없는 슬라이드에서 해당 실행이 비활성 범위로 안내되는 것을 확인한다. 스캔 변경 시 새 작업 목록과 방법이 표시된다.

- 격리 환경은 Linux x86_64, Python 3.10.20, PostgreSQL 18.6, Node 22.12.0, Chrome 146이다. 로컬 NDPI/SVS와 합성 분석 원본·환자·업무 기록을 사용했다.
- `MEDIAUTO_DEMO_PORT=19948 scripts/verify-integration.sh --demo ihc`에서 Viewer의 활성 스캔으로 실행, 실행 결과 표시, 확대·위치 유지와 다른 스캔의 결과 격리를 확인했다. 같은 스캔의 활성 실행 중복 방지 및 비배정 사용자 접근 차단은 API 시험에서 확인했다.
- `MEDIAUTO_DEMO_PORT=19948 scripts/verify-integration.sh`에서 TypeScript/Vite, Alembic 스키마 검사, 백엔드 58개, Chrome 시나리오 27개가 통과했다. 첫 회귀에서 Case Details 테스트가 Viewer 전용 메뉴를 찾도록 지정한 부분을 수정해 다시 검증했다. 390px에서 분석 패널과 Case Tools 메뉴의 가로 범위를 확인했다.
- `./start.sh`로 9920 개발 서비스에 반영했다. LAN의 새 Viewer 자산, OpenAPI의 스캔 분석 경로, 미인증 요청의 HTTP 401, DB 연결과 EMR 미설정 상태를 확인했다.
- 실제 사용자 조작 시간과 새 모델 추론·임상 결과는 **NOT RUN**이다.
