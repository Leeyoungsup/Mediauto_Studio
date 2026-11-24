# 21. 접수·Case Editor·스캔 QC

[참조 PDF 29쪽](../reference/Techcyte_IMS_Demo_Screen_Analysis.pdf)에서 검체·염색·바코드·스캐너 필드와 라벨 표시 오류를 확인했다. 발표자는 OCR 후보로 라벨 입력을 도울 수 있다고 설명했다. 현재 IMS는 기존 파일명 규칙, 수기 접수, 로컬·EMR 환자 대조, WSI 등록, 권한과 감사 이벤트를 이 화면에 연결한다.

## 사용 방법과 권한

1. **Slide Registration**에서 파일의 검체, 블록, 슬라이드 ID, 염색, 바코드와 환자 식별 정보를 입력하거나 파일명 규칙으로 채운다. 파일 기반 케이스를 **Confirm Case from Registered Files**로 확정할 때 기존 로컬 환자번호를 조회하고 현재 접수 정보와 이름·번호·생년월일을 대조한 뒤 확인한다. 변경된 버전, 동일 스캔 ID의 서로 다른 염색·블록·바코드, 파일에 기록된 여러 환자 값은 재확인을 요구한다.
2. **Case Editor**에서 기존 EMR 대조·수기 입력 또는 로컬 환자 대조를 사용한다. 환자 레코드는 연결할 때 수정·병합하지 않는다. 검체, 실제 블록, 슬라이드 번호·염색·바코드·라벨 텍스트, 스캔 경로 등록과 스캐너 정보를 관리한다. 기관 내 바코드는 중복을 막고 앞뒤 공백과 대소문자를 정규화한다. 블록은 해당 슬라이드의 검체에 귀속된다.
3. 스캔 엔트리의 **Scan Label**이 실패하면 **Retry Label**, JPEG·PNG **Upload Label**, 수기 **Confirmed Label Text**를 사용할 수 있다. 업로드는 2MiB로 제한하고 서버가 JPEG로 변환하며 이미지의 부가 메타데이터를 저장하지 않는다. 이전 라벨은 보관한다. **Read Label with OCR**은 로컬 Tesseract에서 읽은 후보를 보여준다. 후보가 현재 바코드를 포함하지 않으면 화면에서 확인을 요청한다. **Use Candidate After Review → Save Slide Details**로 사람이 내용을 확인하고 저장한다. OCR은 바코드를 자동 입력하거나 판독 상태를 바꾸지 않는다.
4. **Check Scan Structure**는 OpenSlide로 파일의 피라미드와 일부 픽셀을 읽는다. 관리자에게는 **Scanner Observation**과 **AI Observation**으로 공급자·버전/참조와 결과를 기록하는 경로가 열린다. 관측값은 수기 판정과 함께 이력에 기록된다. 관측값의 입력은 별도 스캐너·AI 장비 연결을 전제로 하지 않는다. 실제 병원 장비 이벤트 수신과 QC 모델 실행은 이 환경에서 검증하지 않았다.
5. 수기 QC는 **Passed**, **On Hold**, **Rescan Required**를 기록한다. Passed 저장은 현재 파일을 구조적으로 읽을 수 있을 때만 가능하다. 보류·재스캔·교체 완료 스캔은 일반 WSI, 타일, 요청의 스캔 읽기와 검토 시작의 사용 가능 대상에서 제외된다. **Register Replacement**로 읽을 수 있는 다른 파일을 연결하면 기존 스캔을 **Replaced**로 남기고 이전·신규 ID를 같은 감사 트랜잭션에 기록한다. 기존 클라이언트와 케이스를 위해 Unassessed는 사용 가능하며 신규 교체 스캔도 Unassessed에서 시작한다.

관리자와 접수 담당자가 편집하고, 기존 케이스 열람 권한이 있는 계정은 내용을 볼 수 있다. 검토 완료 케이스의 Case Editor 변경은 잠근다. 환자 연결, 검체·블록·슬라이드 수정, 라벨, QC, 교체는 변경 버전 및 기록을 남긴다. 환자·스캔 원본은 교체 과정에서 덮어쓰지 않는다.

## 마이그레이션과 재현

`0010_case_editor`는 블록·라벨 이력 테이블과 슬라이드·스캔 필드를 추가한다. 기존 스캔은 Unassessed로 표시한다. 롤백은 이전 코드와 함께 `python -s -m alembic downgrade 0009_workgroups`를 사용한다. 실행 전 백업이 필요하다. 웹 업로드한 라벨, 블록, QC 현재 상태와 스캔 교체 연결은 이전 스키마에서 제거된다. 이전 감사 테이블과 WSI 파일은 유지된다.

```bash
MEDIAUTO_TESSERACT=/path/to/tesseract \
MEDIAUTO_PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs \
scripts/verify-integration.sh
```

개발 서버는 서버에 설치된 Tesseract 5.2.0을 사용한다. 명시 경로를 주지 않으면 기존 Conda 도구를 먼저 발견할 수 있는 개발 환경 설정을 사용한다. OCR 실행 파일이 없으면 API가 영문 오류로 수기 입력 경로를 안내한다. 검사실의 실제 라벨·OCR 정확도, 스캐너 이벤트, AI QC 성능은 미검증이다.

| 검증 | 결과 |
|---|---|
| 프런트 빌드 및 Alembic 스키마 검사 | PASS |
| 격리 PostgreSQL API·단위 테스트 | 22개 PASS. 환자 버전, 타 검체 블록 차단, 중복 바코드, 라벨 오류, OCR 확인, QC 출처·권한, 판독 접근 차단을 확인했다. |
| Chrome Case Editor E2E | PASS. 실제 NDPI 접수와 환자 대조, 블록·바코드, 라벨 오류·업로드, Tesseract로 합성 라벨 텍스트 확인·저장, QC 관측·재스캔 결정, 실파일 교체 및 WSI 열람까지 확인했다. |
| 기존 Chrome 흐름 | PASS. WSI·ROI·Multi View·저장 View·요청·역할별 업무함 회귀를 확인했다. |
| 격리 DB 롤백 | PASS. `0009 → 0010 → 0009 → 0010`과 기존 업무함·케이스 보존을 확인했다. |
| 개발 서버 9920 | PASS. 적용 전 DB를 백업했고 기존 케이스·환자·설정의 수와 설정값을 확인했다. 실제 서버에서 접수 블록·바코드 입력과 로컬 환자 대조 API를 확인했다. |
