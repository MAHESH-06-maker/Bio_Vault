from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import Depends, HTTPException, Header, status
from jwcrypto import common, jwt # type: ignore
from pydantic import BaseModel
from sqlalchemy.ext.asyncio.session import AsyncSession

from . import database
from .security import JWT_KEY


class _AccountClaims(BaseModel):
    sub: int

async def _current_account(authorization: Annotated[str, Header()]) -> int:
    try:
        scheme, token = authorization.split(" ")
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from error

    if scheme != "Bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        return _AccountClaims.model_validate_json(jwt.JWT(jwt=token, key=JWT_KEY, expected_type="JWS").claims).sub
    except jwt.JWTNotYetValid as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token not yet valid",
            headers={"WWW-Authenticate": "Bearer"},
        ) from error
    except jwt.JWTExpired as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
            headers={"WWW-Authenticate": "Bearer"},
        ) from error
    except common.JWException as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        ) from error

async def _database_session() -> AsyncGenerator[AsyncSession, None]:
    async with database.session() as session:
        yield session

CurrentAccount = Annotated[int, Depends(_current_account)]
DatabaseSession = Annotated[AsyncSession, Depends(_database_session)]
