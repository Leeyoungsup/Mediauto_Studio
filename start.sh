#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
unit=mediauto-studio-dev
mode=${1:-}
case "$#:$mode" in
    0:|1:--detach|1:--logs) ;;
    *) printf 'Usage: %s [--detach | --logs]\n' "$0" >&2; exit 2 ;;
esac
export PATH="$HOME/.local/bin:$PATH"

set_bind_defaults() {
    export MEDIAUTO_HOST="${MEDIAUTO_HOST:-0.0.0.0}"
    export MEDIAUTO_PORT="${MEDIAUTO_PORT:-9920}"
    export MEDIAUTO_COOKIE_SECURE="${MEDIAUTO_COOKIE_SECURE:-0}"
}

wait_for_server() {
    for ((attempt = 0; attempt < 60; attempt++)); do
        if ! systemctl --user is-active --quiet "$unit.service"; then break; fi
        if curl --noproxy '*' --fail --silent --max-time 2 \
            "http://127.0.0.1:$MEDIAUTO_PORT/api/health" >/dev/null; then
            printf 'Mediauto Studio backend: http://127.0.0.1:%s/\n' "$MEDIAUTO_PORT"
            if [[ "$MEDIAUTO_HOST" != 127.0.0.1 ]]; then
                read -r lan_ip _ <<< "$(hostname -I 2>/dev/null || true)"
                if [[ -n "$lan_ip" ]]; then printf 'LAN: http://%s:%s/\n' "$lan_ip" "$MEDIAUTO_PORT"; fi
            fi
            return 0
        fi
        sleep .5
    done
    journalctl --user -u "$unit.service" -n 25 --no-pager >&2
    return 1
}

follow_logs() {
    echo 'Following server logs. Press Ctrl+C to stop viewing logs.'
    echo "To stop the server: systemctl --user stop $unit.service"
    exec journalctl --user --unit="$unit.service" --lines=25 --follow --no-pager
}

finish_start() {
    wait_for_server
    if [[ "$mode" != --detach ]]; then
        follow_logs
    fi
}

if [[ "$mode" == --logs ]]; then
    follow_logs
fi

if systemctl --user is-active --quiet "$unit.service"; then
    if [[ $(systemctl --user show -p WorkingDirectory --value "$unit.service") != "$root" ]]; then
        echo 'The service is running from a different workspace.' >&2
        exit 1
    fi
    unit_environment=$(systemctl --user show -p Environment --value "$unit.service")
    unset MEDIAUTO_HOST MEDIAUTO_PORT MEDIAUTO_COOKIE_SECURE
    set_bind_defaults
    for name in MEDIAUTO_HOST MEDIAUTO_PORT MEDIAUTO_COOKIE_SECURE; do
        if [[ " $unit_environment " =~ [[:space:]]${name}=([^[:space:]]+)[[:space:]] ]]; then
            printf -v "$name" '%s' "${BASH_REMATCH[1]}"
        fi
    done
    systemctl --user restart "$unit.service"
    finish_start
    exit
fi

set_bind_defaults
if [[ ! "$MEDIAUTO_PORT" =~ ^[1-9][0-9]{0,4}$ ]] || (( MEDIAUTO_PORT > 65535 )); then
    echo 'MEDIAUTO_PORT must be a valid TCP port.' >&2
    exit 2
fi
conda_bin=${CONDA_EXE:-$(type -P conda || true)}
conda_bin=${conda_bin:-"$HOME/anaconda3/bin/conda"}
if [[ ! -x "$conda_bin" ]]; then
    echo 'Conda could not be found.' >&2
    exit 1
fi
CONDA_PREFIX=$("$conda_bin" env list --json | python3 -c '
import json
import sys
from pathlib import Path

for directory in json.load(sys.stdin)["envs"]:
    path = Path(directory)
    if path.name == "mediauto-studio" and (path / "bin/python").is_file():
        print(path)
        break
else:
    sys.exit("The mediauto-studio Conda environment could not be found.")
')
export CONDA_PREFIX

if [[ ! -f "$root/frontend/dist/index.html" ]]; then
    if [[ ! -x "$root/frontend/node_modules/.bin/vite" ]]; then
        npm --prefix "$root/frontend" ci
    fi
    npm --prefix "$root/frontend" run build
fi

if ! systemctl --user show --property=Version --value >/dev/null 2>&1; then
    if [[ "$mode" == --detach ]]; then
        echo 'Detached mode requires a systemd user session. Run without --detach to start in this terminal.' >&2
        exit 1
    fi
    exec /bin/bash "$root/scripts/run-dev.sh"
fi

options=(--setenv="CONDA_PREFIX=$CONDA_PREFIX" --setenv="MEDIAUTO_HOST=$MEDIAUTO_HOST"
    --setenv="MEDIAUTO_PORT=$MEDIAUTO_PORT" --setenv="MEDIAUTO_COOKIE_SECURE=$MEDIAUTO_COOKIE_SECURE")
if [[ -n ${MEDIAUTO_PG_BIN:-} ]]; then options+=(--setenv="MEDIAUTO_PG_BIN=$MEDIAUTO_PG_BIN"); fi
systemd-run --user --quiet --collect --unit="$unit" --working-directory="$root" \
    --property=Type=exec --property=KillMode=mixed "${options[@]}" \
    /bin/bash "$root/scripts/run-dev.sh"
finish_start
