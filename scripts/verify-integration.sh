#!/usr/bin/env bash
set -euo pipefail
umask 077

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
export PATH="$HOME/.local/bin:$PATH"
studio_prefix=${MEDIAUTO_STUDIO_PREFIX:-"$HOME/anaconda3/envs/mediauto-studio"}
python="$studio_prefix/bin/python"
pg=${MEDIAUTO_PG_BIN:-"$(dirname -- "$studio_prefix")/mediauto-postgres/bin"}
port=${MEDIAUTO_DEMO_PORT:-19920}
mode=${1:-}
demo=${2:-}
case "$mode:$#:$demo" in
    :0:|--manual:1:|--probe:1:|--demo:2:*) ;;
    *) printf 'Usage: %s [--manual | --probe | --demo general|frozen|tumor-board|ihc|pap|collaboration]\n' "$0" >&2; exit 2 ;;
esac
if [[ "$mode" == --demo ]]; then
    case "$demo" in
        general|frozen|tumor-board|ihc|pap|collaboration) ;;
        *) printf 'Unknown workflow demo: %s\n' "$demo" >&2; exit 2 ;;
    esac
fi

selected() {
    [[ -z "$demo" ]] && return 0
    local candidate
    for candidate in "$@"; do
        [[ "$candidate" == "$demo" ]] && return 0
    done
    return 1
}

run_browser() {
    local script=$1
    shift
    if selected "$@"; then node "scripts/$script-browser.mjs"; fi
}

sandbox=$(mktemp -d /tmp/mediauto-integration.XXXXXX)
server_pid=
cleanup() {
    local result=$?
    if [[ -n "$server_pid" ]]; then
        kill "$server_pid" 2>/dev/null || true
        wait "$server_pid" || true
    fi
    if [[ -f "$sandbox/db/postmaster.pid" ]]; then
        "$pg/pg_ctl" -D "$sandbox/db" -w -m fast stop >/dev/null
    fi
    if (( result == 0 )); then rm -rf -- "$sandbox"
    else printf 'Verification logs: %s\n' "$sandbox" >&2
    fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

npm --prefix "$root/frontend" run build
mkdir "$sandbox/socket"
"$pg/initdb" -D "$sandbox/db" --auth-local=peer --auth-host=scram-sha-256 --encoding=UTF8 --no-locale >"$sandbox/init.log"
"$pg/pg_ctl" -D "$sandbox/db" -l "$sandbox/postgres.log" -o "-h '' -k $sandbox/socket" -w start
"$pg/createdb" -h "$sandbox/socket" mediauto_clinical_test
export MEDIAUTO_DATABASE_URL="postgresql+asyncpg://$(id -un)@/mediauto_clinical_test?host=$sandbox/socket"
export MEDIAUTO_AUTH_SECRET_FILE="$sandbox/auth.key"
export MEDIAUTO_PDL1_ROOT="$sandbox/pdl1"
export MEDIAUTO_IHC_ROOT="$sandbox/ihc" MEDIAUTO_IHC_VALIDATION_FILE="$sandbox/ihc-validation.json"
export MEDIAUTO_PROSTATE_ROOT="$sandbox/prostate"
export MEDIAUTO_SKIN_ROOT="$sandbox/skin"
export MEDIAUTO_PAP_ROOT="$sandbox/pap"
export MEDIAUTO_NOTIFICATION_CONFIG_FILE="$sandbox/notifications.json"
export MEDIAUTO_SMTP_HOST="" MEDIAUTO_VAPID_PRIVATE_KEY=""
export MEDIAUTO_DEMO_URL="http://127.0.0.1:$port"
cd -- "$root/backend"

"$python" -s -m alembic upgrade head
"$python" -s -m alembic check
if [[ -z "$mode" ]]; then
    MEDIAUTO_CLINICAL_TEST=1 "$python" -s -m unittest discover -s tests -v
fi
PYTHONPATH="$PWD:$PWD/tests" "$python" -s - <<'PY'
import asyncio
from app.main import app
from test_clinical import create_account

async def main():
    async with app.router.lifespan_context(app):
        for account, role in (
            ("integration-admin", "admin"), ("integration-doctor", "doctor"), ("integration-other", "doctor"),
            ("integration-viewer-admin", "admin"), ("integration-editor-admin", "admin"),
            ("integration-or", "viewer"),
            ("integration-pap-primary", "labeler"), ("integration-pap-backup", "labeler"),
        ):
            await create_account("local", account, role)

asyncio.run(main())
PY

"$python" -s -m uvicorn app.main:app --no-access-log --host 127.0.0.1 --port "$port" >"$sandbox/web.log" 2>&1 &
server_pid=$!
ready=
for ((attempt = 0; attempt < 40; attempt++)); do
    kill -0 "$server_pid" 2>/dev/null || break
    if curl --noproxy '*' --fail --silent --max-time 1 "$MEDIAUTO_DEMO_URL/api/health" >/dev/null; then ready=1; break; fi
    sleep .25
done
if [[ -z "$ready" ]]; then
    cat "$sandbox/web.log" >&2
    exit 1
fi
cd -- "$root"
if [[ "$mode" == --manual ]]; then
    node scripts/integration-browser.mjs --seed-only
    printf 'Manual session at %s. Press Enter to stop.\n' "$MEDIAUTO_DEMO_URL"
    read -r _
elif [[ "$mode" == --probe ]]; then
    node scripts/integration-browser.mjs --seed-only
    node scripts/frontend-workflow-probe.mjs
else
    if selected general; then
        node scripts/integration-browser.mjs
    elif selected tumor-board ihc pap collaboration; then
        node scripts/integration-browser.mjs --seed-only
    fi
    run_browser workspace-layout
    run_browser viewer-preferences
    run_browser viewer-records
    run_browser wsi-viewport-coverage general
    run_browser multi-view ihc pap
    run_browser worklist-views
    if selected; then node scripts/registration-browser.mjs; fi
    if selected ihc; then
        (
            cd -- "$root/backend"
            "$python" -s - "$sandbox/pdl1-fixture.json" "${MEDIAUTO_DEMO_SVS:-CODIPAI-STBX-SS-04364-I-PD-22.svs}" <<'PYFIXTURE'
import argparse
import json
from pathlib import Path
import sys

from app.import_pdl1 import DATA_ROOT, import_snapshot, slide_signature

fixture = Path(sys.argv[1])
for sample, analysis_version in (
    (sys.argv[2], "request-browser-fixture"),
    ("CODIPAI-BRCA-SS-00194-I-HR-01.svs", "analysis-browser-fixture"),
):
    fixture.write_text(json.dumps({
        "source": slide_signature(DATA_ROOT / sample),
        "tissue_type": "Stomach",
        "pd_score": {"score_type": "CPS", "score": 25, "class_counts": {"0": 3, "2": 1, "3": 0}},
        "model_runtime": {"filename": "PDL1_ST_CPS_detection.pt", "version": "synthetic"},
        "class_names": {"0": "Synthetic cell"},
        "cells": [[20, 30, 0, 0.9]],
        "analysis_version": analysis_version,
    }))
    options = argparse.Namespace(organization="local", slide=sample, result=fixture, original=None,
                                 editor=None, saved_at=None, audit=None, importer="synthetic-fixture")
    options.original = import_snapshot(options)["id"]
    options.editor = "synthetic-reviewer"
    import_snapshot(options)
PYFIXTURE
        )
    fi
    run_browser case-requests
    run_browser workgroups
    if selected general; then
        export MEDIAUTO_QA_LABEL="$sandbox/qa-label.png"
        "$python" -s - "$MEDIAUTO_QA_LABEL" <<'PYLABEL'
import sys
from PIL import Image, ImageDraw, ImageFont

image = Image.new("RGB", (900, 170), "white")
font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 68)
ImageDraw.Draw(image).text((30, 30), "QA-EDITOR-21", font=font, fill="black")
image.save(sys.argv[1])
PYLABEL
    fi
    run_browser case-editor general
    run_browser patient-history
    if selected; then
        export MEDIAUTO_QA_PDF="$sandbox/qa-case-media.pdf" MEDIAUTO_QA_GROSS="$sandbox/qa-gross.png"
        "$python" -s - "$MEDIAUTO_QA_PDF" "$MEDIAUTO_QA_GROSS" <<'PYMEDIA'
import sys
from PIL import Image, ImageDraw

with Image.new("RGB", (400, 300), "white") as first, Image.new("RGB", (400, 300), "ivory") as second:
    ImageDraw.Draw(first).text((30, 30), "Synthetic Media - Page 1", fill="black")
    ImageDraw.Draw(second).text((30, 30), "Synthetic Media - Page 2", fill="black")
    first.save(sys.argv[1], "PDF", save_all=True, append_images=[second])
with Image.new("RGB", (480, 360), "ivory") as gross:
    ImageDraw.Draw(gross).ellipse((40, 70, 420, 290), fill="sienna")
    gross.save(sys.argv[2], "PNG")
PYMEDIA
    fi
    run_browser case-attachments
    run_browser case-logs
    run_browser notifications
    run_browser case-report general
    run_browser frozen-workflow frozen
    run_browser viewer-workflow
    run_browser roi-search
    if selected ihc; then
        (cd -- "$root/backend" && PYTHONPATH="$PWD" "$python" -s "$root/scripts/seed-ihc-fixtures.py")
    fi
    run_browser ihc-results ihc
    run_browser analysis-execution ihc
    run_browser case-collections tumor-board
    run_browser collaborative-review collaboration
    export MEDIAUTO_BIOMARKER_TEST_DIR="$sandbox"
    if selected ihc; then
        (cd -- "$root/backend" && PYTHONPATH="$PWD" "$python" -s "$root/scripts/seed-biomarker-fixtures.py")
    fi
    run_browser biomarker-evidence ihc
    export MEDIAUTO_PROSTATE_TEST_PYTHON="$python" MEDIAUTO_PROSTATE_TEST_DIR="$sandbox"
    run_browser prostate-results
    export MEDIAUTO_SKIN_TEST_PYTHON="$python" MEDIAUTO_SKIN_TEST_DIR="$sandbox"
    run_browser skin-review
    export MEDIAUTO_PAP_TEST_PYTHON="$python" MEDIAUTO_PAP_TEST_DIR="$sandbox"
    run_browser pap-gallery pap
    run_browser pap-review pap
    run_browser related-cases pap
fi
