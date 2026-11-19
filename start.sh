#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
unit=mediauto-studio-dev
export PATH="$HOME/.local/bin:$PATH"
export MEDIAUTO_HOST="${MEDIAUTO_HOST:-0.0.0.0}"

wait_for_server() {
    for ((attempt = 0; attempt < 60; attempt++)); do
        if ! systemctl --user is-active --quiet "$unit.service"; then break; fi
        if curl --noproxy '*' --fail --silent --max-time 2 \
            "http://127.0.0.1:9920/api/health" >/dev/null; then
            echo 'Mediauto Studio: http://127.0.0.1:9920/'
            if [[ "$MEDIAUTO_HOST" != 127.0.0.1 ]]; then
                read -r lan_ip _ <<< "$(hostname -I 2>/dev/null || true)"
                if [[ -n "$lan_ip" ]]; then echo "LAN: http://$lan_ip:9920/"; fi
            fi
            return 0
        fi
        sleep .5
    done
    journalctl --user -u "$unit.service" -n 25 --no-pager >&2
    return 1
}

if systemctl --user is-active --quiet "$unit.service"; then
    if [[ $(systemctl --user show -p WorkingDirectory --value "$unit.service") != "$root" ]]; then
        echo 'The service is running from a different workspace.' >&2
        exit 1
    fi
    systemctl --user restart "$unit.service"
    wait_for_server
    exit
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
    exec /bin/bash "$root/scripts/run-dev.sh"
fi

options=(--setenv="CONDA_PREFIX=$CONDA_PREFIX" --setenv="MEDIAUTO_HOST=$MEDIAUTO_HOST")
if [[ -n ${MEDIAUTO_PG_BIN:-} ]]; then options+=(--setenv="MEDIAUTO_PG_BIN=$MEDIAUTO_PG_BIN"); fi
systemd-run --user --quiet --collect --unit="$unit" --working-directory="$root" \
    --property=Type=exec --property=KillMode=mixed "${options[@]}" \
    /bin/bash "$root/scripts/run-dev.sh"
wait_for_server
