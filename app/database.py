from datetime import datetime, timezone
import math
import os

from sqlalchemy import event, text
from sqlalchemy.dialects.mysql import TIMESTAMP
from sqlalchemy.engine import URL
from sqlalchemy.engine.interfaces import DBAPIConnection
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import ConnectionPoolEntry
from sqlmodel import BINARY, VARCHAR, Column, Field, SQLModel


DATABASE_URL = URL.create(
    drivername="mysql+asyncmy",
    username=os.environ["MYSQL_USERNAME"],
    password=os.environ["MYSQL_PASSWORD"],
    host=os.environ["MYSQL_HOST"],
    port=int(os.environ["MYSQL_PORT"]),
    database=os.environ["MYSQL_DATABASE"],
    query={"charset": "utf8mb4"},
)

KEY_FINGERPRINT_LENGTH = 32

MAX_DOMAIN_LENGTH = int(os.environ["IDENTIFIER_MAX_LENGTH"])
MAX_IDENTIFIER_LENGTH = int(os.environ["IDENTIFIER_MAX_LENGTH"])
MAX_LABEL_LENGTH = int(os.environ["LABEL_MAX_LENGTH"])
MAX_PASSWORD_LENGTH = int(os.environ["PASSWORD_MAX_LENGTH"])
MAX_USERNAME_LENGTH = int(os.environ["USERNAME_MAX_LENGTH"])

MAX_USERID_LENGTH = math.floor(math.log10(2**32)) + 1

engine = create_async_engine(DATABASE_URL)
session = async_sessionmaker(
    engine,
    expire_on_commit=False
)

@event.listens_for(engine.sync_engine, "connect")
def _set_mysql_utc(dbapi_connection: DBAPIConnection, _: ConnectionPoolEntry) -> None:
    # Keep the session timezone pinned to UTC so MySQL TIMESTAMP values round-trip in UTC.
    cursor = dbapi_connection.cursor()
    try:
        cursor.execute(text("SET time_zone = '+00:00'").text)
    finally:
        cursor.close()

class Account(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    username: str = Field(nullable=False, unique=True, index=True, max_length=MAX_USERNAME_LENGTH)
    salt: bytes

class Key(SQLModel, table=True):
    fingerprint: bytes = Field(
        sa_column=Column(BINARY(KEY_FINGERPRINT_LENGTH), primary_key=True)
    )
    owner_id: int = Field(foreign_key="account.id", index=True)
    label: str = Field(nullable=False, max_length=MAX_LABEL_LENGTH)
    data: bytes
    wrapped_key: bytes
    is_master: bool = Field(nullable=False, default=False)
    last_modified: datetime = Field(
        default=None,
        sa_column=Column(
            TIMESTAMP(fsp=6),
            nullable=False,
            server_default=text("UTC_TIMESTAMP(6)"),
            onupdate=text("UTC_TIMESTAMP(6)"),
        )
    )

class Nonce(SQLModel, table=True):
    username: str = Field(primary_key=True, foreign_key="account.username", max_length=MAX_USERNAME_LENGTH)
    data: bytes
    expires_at: datetime = Field(default=None, sa_column=Column(TIMESTAMP(fsp=6), nullable=False))

class Credentials(SQLModel, table=True):
    identifier: str = Field(
        sa_column=Column(VARCHAR(MAX_IDENTIFIER_LENGTH + 1 + MAX_IDENTIFIER_LENGTH), primary_key=True)
    )
    owner_id: int = Field(foreign_key="account.id", index=True)
    domain: str | None = Field(default=None, max_length=MAX_DOMAIN_LENGTH)
    username: str = Field(nullable=False, max_length=MAX_USERNAME_LENGTH)
    password: str = Field(nullable=False, max_length=MAX_PASSWORD_LENGTH)

async def initialise() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)

def utc_now() -> datetime:
    # MySQL TIMESTAMP round-trips as a naive datetime through this driver, so store UTC consistently.
    return datetime.now(timezone.utc).replace(tzinfo=None)
