#!/usr/bin/env bash
set -euo pipefail
umask 077

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ -z ${CONDA_PREFIX:-} ]]; then
    echo 'Activate the mediauto-studio Conda environment first.' >&2
    exit 1
fi
python="$CONDA_PREFIX/bin/python"
pg_bin=${MEDIAUTO_PG_BIN:-"$(dirname -- "$CONDA_PREFIX")/mediauto-postgres/bin"}
if [[ ! -x "$python" || ! -x "$pg_bin/pg_ctl" ]]; then
    echo 'The application Python and PostgreSQL 18 binaries are required.' >&2
    exit 1
fi
if [[ ! -f "$root/frontend/dist/index.html" ]]; then
    echo 'Build the frontend first with npm --prefix frontend run build.' >&2
    exit 1
fi

runtime="$root/.runtime"
pg_data="$runtime/postgres"
pg_socket="$runtime/pgsocket"
mkdir -p -- "$runtime" "$pg_socket"
exec 9>"$runtime/server.lock"
if ! flock -n 9; then
    echo 'Mediauto Studio is already running from this workspace.' >&2
    exit 1
fi

db_user=$(id -un)
db_port=5432
pg_connection=(--host="$pg_socket" --port="$db_port" --username="$db_user")
export MEDIAUTO_DB_SOCKET="$pg_socket" MEDIAUTO_DB_USER="$db_user"
unset MEDIAUTO_DATABASE_URL

if [[ ! -f "$pg_data/PG_VERSION" ]]; then
    "$pg_bin/initdb" --pgdata="$pg_data" --username="$db_user" \
        --auth-local=peer --auth-host=scram-sha-256 --encoding=UTF8 --no-locale 9>&-
fi

server_pid=
cleanup() {
    if [[ -n "$server_pid" ]]; then
        kill -TERM "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
    fi
    if "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null; then
        "$pg_bin/pg_ctl" -D "$pg_data" -m fast -w stop 9>&-
    fi
}
trap cleanup EXIT
trap 'exit 0' INT TERM

if ! "$pg_bin/pg_ctl" -D "$pg_data" status >/dev/null; then
    printf -v pg_options '%q ' -h '' -k "$pg_socket" -p "$db_port"
    "$pg_bin/pg_ctl" -D "$pg_data" -l "$runtime/postgres.log" -o "$pg_options" -w start 9>&-
fi

db_exists=$("$pg_bin/psql" "${pg_connection[@]}" -X -At --set=ON_ERROR_STOP=1 --dbname=postgres \
    --command="SELECT 1 FROM pg_database WHERE datname = 'mediauto_studio_dev'")
if [[ "$db_exists" != 1 ]]; then
    "$pg_bin/createdb" "${pg_connection[@]}" --maintenance-db=postgres mediauto_studio_dev
fi

cd -- "$root/backend"
"$python" -s -m alembic upgrade head
if [[ -z ${MEDIAUTO_TESSERACT:-} ]]; then
    ocr_binary=$(dirname -- "$CONDA_PREFIX")/urban/bin/tesseract
    if [[ -x "$ocr_binary" ]]; then export MEDIAUTO_TESSERACT="$ocr_binary"; fi
fi

"$python" -s -m uvicorn app.main:app --no-access-log \
    --host "${MEDIAUTO_HOST:-0.0.0.0}" --port "${MEDIAUTO_PORT:-9920}" \
    --proxy-headers --forwarded-allow-ips 127.0.0.1 &
server_pid=$!
wait "$server_pid"
