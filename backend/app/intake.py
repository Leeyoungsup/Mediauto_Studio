import asyncio
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from string import Formatter
from typing import Annotated
from uuid import NAMESPACE_URL, uuid5

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, StringConstraints, ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.models import ApplicationSetting, IntegrationConnection
from app.auth import CurrentUser, WRITERS, require_organization, require_roles

def require_intake(user: CurrentUser):
    require_organization(user, "local")
    require_roles(user, WRITERS)


def require_rules(user: CurrentUser):
    require_roles(user, ("admin",))


router = APIRouter(prefix="/api/intake", tags=["Slide intake"], dependencies=[Depends(require_intake)])
DATA_ROOT = Path(__file__).resolve().parents[2] / "data"
RULES_KEY = "slide_filename_rules"
INTAKE_PREFIX = "slide_intake:"
FORM_FIELDS = ("case_id", "slide_id", "specimen", "stain", "patient_number", "block_number", "barcode")
TOKEN = re.compile(r"[a-z][a-z0-9_]*", re.IGNORECASE | re.ASCII)
formatter = Formatter()

ShortText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)]
Identifier = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")]


class SlideFields(BaseModel):
    case_id: Identifier
    slide_id: Identifier
    specimen: ShortText = ""
    stain: ShortText = ""
    patient_number: ShortText = ""
    block_number: Annotated[ShortText, Field(max_length=80)] = ""
    barcode: ShortText = ""
    patient_name: ShortText = ""


class ManualEntry(BaseModel):
    version: int = Field(ge=0)
    fields: SlideFields


class FilenameRule(BaseModel):
    name: Annotated[ShortText, Field(min_length=1)]
    pattern: Annotated[ShortText, Field(min_length=1)]
    case_id: Annotated[ShortText, Field(min_length=1)]
    slide_id: Annotated[ShortText, Field(min_length=1)]
    specimen: ShortText = ""
    stain: ShortText = ""
    patient_number: ShortText = ""
    block_number: Annotated[ShortText, Field(max_length=80)] = ""
    barcode: ShortText = ""


class RuleDraft(BaseModel):
    rules: list[FilenameRule] = Field(max_length=20)


class RuleUpdate(RuleDraft):
    version: int = Field(ge=0)


class RuleApplication(BaseModel):
    version: int = Field(ge=0)


@dataclass(frozen=True)
class SourceFile:
    id: str
    filename: str
    format: str
    size: int
    modified: str


def source_id(relative: str, size: int, modified_ns: int) -> str:
    return str(uuid5(NAMESPACE_URL, f"mediauto-intake:{relative}\0{size}\0{modified_ns}"))


def scan_files(root: Path) -> list[SourceFile]:
    sources = []
    for path in sorted(root.rglob("*")):
        if path.suffix.lower() not in (".ndpi", ".svs") or path.is_symlink() or not path.is_file():
            continue
        try:
            stat = path.stat()
        except FileNotFoundError:
            continue
        relative = path.relative_to(root).as_posix()
        sources.append(SourceFile(
            id=source_id(relative, stat.st_size, stat.st_mtime_ns),
            filename=relative,
            format=path.suffix[1:].upper(),
            size=stat.st_size,
            modified=datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        ))
    return sources


def compile_rule(rule: FilenameRule) -> re.Pattern[str]:
    pieces = []
    tokens = set()
    for literal, token, spec, conversion in formatter.parse(rule.pattern):
        pieces.append(re.escape(literal))
        if token is None:
            continue
        if not TOKEN.fullmatch(token) or spec or conversion or token in tokens:
            raise ValueError("Use unique filename tokens with English letters inside braces, such as {name}.")
        if tokens and not any(not char.isalnum() for char in literal):
            raise ValueError("Separate filename tokens with a hyphen, underscore, or period.")
        tokens.add(token)
        pieces.append(fr"(?P<{token}>[^\W_]+)")
    if not tokens:
        raise ValueError("Include a token such as {case} in the filename pattern.")
    for key in FORM_FIELDS:
        for _, token, spec, conversion in formatter.parse(getattr(rule, key)):
            if token is not None and (token not in tokens or spec or conversion):
                raise ValueError(f"The output format contains an undefined token: {{{token}}}.")
    return re.compile("".join(pieces), re.IGNORECASE)


def classify(source: SourceFile, rules: list[tuple[FilenameRule, re.Pattern[str]]]) -> dict | None:
    for rule, pattern in rules:
        match = pattern.fullmatch(Path(source.filename).stem)
        if not match:
            continue
        fields = {key: getattr(rule, key).format_map(match.groupdict()) for key in FORM_FIELDS}
        try:
            return {"rule": rule.name, "fields": SlideFields(**fields).model_dump()}
        except ValidationError:
            continue
    return None


def compiled_rules(draft: RuleDraft) -> list[tuple[FilenameRule, re.Pattern[str]]]:
    try:
        return [(rule, compile_rule(rule)) for rule in draft.rules]
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


async def saved_rules(connection) -> RuleUpdate:
    stored = await connection.scalar(select(ApplicationSetting.value).where(ApplicationSetting.key == RULES_KEY))
    return RuleUpdate.model_validate(stored or {"rules": [], "version": 0})


async def slide_entries(connection, sources: list[SourceFile], *, lock: bool = False) -> dict[str, dict]:
    keys = [INTAKE_PREFIX + source.id for source in sources]
    query = select(ApplicationSetting.key, ApplicationSetting.value).where(ApplicationSetting.key.in_(keys))
    rows = await connection.execute(query.order_by(ApplicationSetting.key).with_for_update() if lock else query)
    return {key.removeprefix(INTAKE_PREFIX): value for key, value in rows}


async def save_version(connection, key: str, version: int, value: dict) -> None:
    statement = insert(ApplicationSetting).values(key=key, value={**value, "version": version + 1})
    if version == 0:
        statement = statement.on_conflict_do_nothing(index_elements=[ApplicationSetting.key])
    else:
        statement = statement.on_conflict_do_update(
            index_elements=[ApplicationSetting.key],
            set_={"value": statement.excluded.value},
            where=ApplicationSetting.value["version"].as_integer() == version,
        )
    result = await connection.execute(statement.returning(ApplicationSetting.key))
    if not result.scalar_one_or_none():
        raise HTTPException(409, "Changes were saved elsewhere. Refresh the list and try again.")


@router.get("/slides")
async def list_slides(request: Request):
    sources = await asyncio.to_thread(scan_files, DATA_ROOT)
    async with request.app.state.engine.connect() as connection:
        entries = await slide_entries(connection, sources)
    return [{**asdict(source), "entry": entries.get(source.id)} for source in sources]


@router.put("/slides/{file_id}")
async def save_slide(file_id: str, data: ManualEntry, request: Request):
    sources = await asyncio.to_thread(scan_files, DATA_ROOT)
    if all(source.id != file_id for source in sources):
        raise HTTPException(404, "The file was moved or changed. Refresh the list.")
    key = INTAKE_PREFIX + file_id
    async with request.app.state.engine.begin() as connection:
        existing = await connection.scalar(select(ApplicationSetting.value).where(ApplicationSetting.key == key))
        if (existing or {}).get("version", 0) != data.version:
            raise HTTPException(409, "The slide was changed. Refresh the list.")
        updated_at = datetime.now(timezone.utc).isoformat()
        entry = {"fields": data.fields.model_dump(), "source": "manual", "updated_at": updated_at}
        history = [*existing.get("history", []), {key: value for key, value in existing.items() if key != "history"}] if existing else []
        await save_version(connection, key, data.version, {**entry, "history": history})
    return {**entry, "version": data.version + 1}


@router.get("/rules", dependencies=[Depends(require_rules)])
async def get_rules(request: Request):
    async with request.app.state.engine.connect() as connection:
        return await saved_rules(connection)


@router.put("/rules", dependencies=[Depends(require_rules)])
async def configure_rules(data: RuleUpdate, request: Request):
    compiled_rules(data)
    async with request.app.state.engine.begin() as connection:
        current = await saved_rules(connection)
        if current.version != data.version:
            raise HTTPException(409, "The rules have changed. Reopen Settings.")
        await save_version(connection, RULES_KEY, data.version, data.model_dump())
    return data.model_copy(update={"version": data.version + 1})


@router.post("/rules/preview", dependencies=[Depends(require_rules)])
async def preview_rules(data: RuleDraft):
    rules = compiled_rules(data)
    sources = await asyncio.to_thread(scan_files, DATA_ROOT)
    return [{**asdict(source), "match": classify(source, rules)} for source in sources]


@router.post("/rules/apply", dependencies=[Depends(require_rules)])
async def apply_rules(data: RuleApplication, request: Request):
    sources = await asyncio.to_thread(scan_files, DATA_ROOT)
    async with request.app.state.engine.begin() as connection:
        emr = await connection.scalar(select(ApplicationSetting.value).where(ApplicationSetting.key == "emr"))
        mode = await connection.scalar(select(IntegrationConnection.state).where(
            IntegrationConnection.organization == "local", IntegrationConnection.channel == "emr",
        ))
        if mode == "connected" or (mode is None and (emr or {}).get("state") == "connected"):
            raise HTTPException(409, "Filename rules are available when EMR is disconnected.")
        current = await saved_rules(connection)
        if current.version != data.version:
            raise HTTPException(409, "The rules have changed. Reopen Settings.")
        rules = compiled_rules(current)
        if not rules:
            raise HTTPException(422, "Save the filename rules before applying them.")
        existing = await slide_entries(connection, sources)
        unmatched = 0
        applied = 0
        for source in sources:
            if source.id in existing:
                continue
            match = classify(source, rules)
            if not match:
                unmatched += 1
                continue
            entry = {**match, "source": "rule", "version": 1, "updated_at": datetime.now(timezone.utc).isoformat()}
            result = await connection.execute(
                insert(ApplicationSetting).values(key=INTAKE_PREFIX + source.id, value=entry)
                .on_conflict_do_nothing(index_elements=[ApplicationSetting.key])
                .returning(ApplicationSetting.key)
            )
            applied += int(result.scalar_one_or_none() is not None)
    return {"applied": applied, "unchanged": len(sources) - applied - unmatched, "unmatched": unmatched}
