import os

from sqlalchemy.engine import URL, make_url


def database_url() -> URL:
    configured = os.environ.get("MEDIAUTO_DATABASE_URL")
    if configured:
        return make_url(configured)

    return URL.create(
        "postgresql+asyncpg",
        username=os.environ["MEDIAUTO_DB_USER"],
        database="mediauto_studio_dev",
        query={"host": os.environ["MEDIAUTO_DB_SOCKET"]},
    )
