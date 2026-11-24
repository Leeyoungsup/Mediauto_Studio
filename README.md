# Mediauto_Studio

## 개발 환경 준비

서버의 `mediauto-studio` Conda 환경은 FastAPI와 Alembic을 실행합니다. `mediauto-postgres` Conda 환경은 PostgreSQL 18 실행 파일을 제공합니다. 프런트엔드는 Node.js `22.12.0`에서 준비합니다.

```bash
conda activate mediauto-studio
python -m pip install -r backend/requirements.txt
npm --prefix frontend ci
npm --prefix frontend run build
```

## 9920 포트에서 실행

```bash
./start.sh
```

브라우저에서 `http://서버IP:9920/`을 열면 React 화면이 표시됩니다. 서버 자체에서는 `http://127.0.0.1:9920/`으로 접속합니다. `/api/health`에서 FastAPI·PostgreSQL과 EMR 설정 상태를 확인할 수 있습니다.

Worklist에서 직접 만든 시연용 케이스와 입력값은 페이지를 새로고침할 때 초기화됩니다. 뷰어는 아래 공개 조직 사진을 WebP로 변환해 미리보기에 사용합니다.

- CoRus13, [Colon, low mag.jpg](https://commons.wikimedia.org/wiki/File:Colon,_low_mag.jpg), [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- Nephron, [Colorectal adenocarcinoma — low mag.jpg](https://commons.wikimedia.org/wiki/File:Colorectal_adenocarcinoma_--_low_mag.jpg), [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)

### 예제 슬라이드 등록

`Worklist → 슬라이드 등록`은 `data/`의 NDPI·SVS를 읽기 전용으로 검색합니다. `설정 → 파일명 규칙`에서 규칙을 작성하거나 CODIPAI 예제를 불러온 뒤 `미리보기 → 규칙 저장 → 미입력 슬라이드에 적용`을 실행합니다. 규칙 미일치 파일은 `미입력 슬라이드`에서 Case ID와 Slide ID를 직접 등록할 수 있습니다.

규칙과 파일 등록 정보는 개발 PostgreSQL에 저장되며, 이미 등록한 파일은 규칙을 다시 적용해도 유지됩니다. 등록 정보는 Worklist에서 Case ID로 묶어 확인합니다. 같은 Slide ID의 NDPI와 SVS는 서로 다른 원본 파일로 표시됩니다. 이 화면은 등록 정보 확인용이며 실제 WSI 타일 연결은 후속 작업입니다.

Worklist의 `열`에서 PDF 기반 열을 검색하고 표시 여부와 순서를 설정할 수 있습니다. 이 설정은 브라우저별로 유지됩니다.

스크립트는 전용 개발 DB `mediauto_studio_dev`를 `.runtime/postgres`에 만들고 Alembic 마이그레이션을 적용합니다. PostgreSQL은 `.runtime/pgsocket`의 로컬 Unix 소켓에만 연결됩니다. 최초 마이그레이션은 EMR 상태를 `미설정`으로 초기화합니다. 스크립트를 다시 실행해도 DB 데이터는 유지됩니다.

서비스가 중지된 상태에서 `MEDIAUTO_HOST=127.0.0.1 ./start.sh`로 실행하면 서버 자체에서만 접속할 수 있습니다. PostgreSQL 실행 파일이 다른 경로에 있다면 `MEDIAUTO_PG_BIN`으로 `bin` 디렉터리를 지정합니다.

### 실행 상태와 중지

`./start.sh`는 `mediauto-studio` Conda 환경을 찾아 사용자 서비스로 시작합니다. 이 프로젝트의 서비스가 이미 실행 중이면 종료한 뒤 9920 포트에서 다시 시작하고, 헬스 체크가 통과하면 접속 주소를 출력합니다. 사용자 systemd를 사용할 수 없는 환경에서는 현재 터미널에서 실행되며 `Ctrl+C`로 중지합니다.

```bash
systemctl --user status mediauto-studio-dev.service
journalctl --user -u mediauto-studio-dev.service -f
systemctl --user stop mediauto-studio-dev.service
```

### 프런트엔드 수정

9920의 API를 실행한 상태에서 `npm --prefix frontend run dev`를 실행합니다. 로컬 Vite 주소 `http://127.0.0.1:5173/`에서 코드 수정이 반영되며, `/api` 요청은 9920으로 전달됩니다. 9920의 화면을 갱신하려면 `npm --prefix frontend run build`로 다시 빌드합니다.
