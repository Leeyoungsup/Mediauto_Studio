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
