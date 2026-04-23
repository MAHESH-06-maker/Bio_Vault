from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from .. import database
from ..dependencies import CurrentAccount, DatabaseSession


router = APIRouter(
    prefix="/credentials",
    tags=["Credentials"],
)


class Credentials(BaseModel):
    identifier: str = Field(max_length=database.MAX_IDENTIFIER_LENGTH)
    domain: str | None = Field(max_length=database.MAX_DOMAIN_LENGTH)
    username: str = Field(max_length=database.MAX_USERNAME_LENGTH)
    password: str = Field(max_length=database.MAX_PASSWORD_LENGTH)

class CredentialsUpdationRequest(BaseModel):
    domain: str | None = Field(default=None, max_length=database.MAX_DOMAIN_LENGTH)
    username: str | None = Field(default=None, max_length=database.MAX_USERNAME_LENGTH)
    password: str | None = Field(default=None, max_length=database.MAX_PASSWORD_LENGTH)


@router.get("/")
async def list_all_credentials(id: CurrentAccount, session: DatabaseSession) -> list[Credentials]:
    result = await session.execute(
        select(database.Credentials)
        .where(database.Credentials.owner_id == id)
    )

    return [
        Credentials(identifier=credentials.identifier.partition("-")[2], domain=credentials.domain, username=credentials.username, password=credentials.password)
        for credentials in result.scalars()
    ]

@router.get("/{identifier}")
async def read_credentials(identifier: str, id: CurrentAccount, session: DatabaseSession) -> Credentials:
    if len(identifier) > database.MAX_IDENTIFIER_LENGTH:
        raise HTTPException(status_code=400, detail="Path too long")

    result = await session.execute(
        select(database.Credentials)
        .where(database.Credentials.owner_id == id)
        .where(database.Credentials.identifier == f"{id}-{identifier}")
    )
    credentials = result.scalar_one_or_none()

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credentials not found",
        )

    return Credentials(identifier=credentials.identifier.partition("-")[2], domain=credentials.domain, username=credentials.username, password=credentials.password)


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_credentials(
    request_data: Credentials,
    id: CurrentAccount,
    session: DatabaseSession,
) -> Credentials:
    credentials = database.Credentials(
        identifier=f"{id}-{request_data.identifier}",
        owner_id=id,
        domain=request_data.domain,
        username=request_data.username,
        password=request_data.password,
    )
    session.add(credentials)

    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Credential already exists",
        ) from error

    return Credentials(identifier=credentials.identifier.partition("-")[2], domain=credentials.domain, username=credentials.username, password=credentials.password)


@router.put("/{identifier}")
async def update_credential(
    identifier: str,
    request_data: CredentialsUpdationRequest,
    id: CurrentAccount,
    session: DatabaseSession,
) -> Credentials:
    if len(identifier) > database.MAX_IDENTIFIER_LENGTH:
        raise HTTPException(status_code=400, detail="Path too long")

    result = await session.execute(
        select(database.Credentials)
        .where(database.Credentials.owner_id == id)
        .where(database.Credentials.identifier == f"{id}-{identifier}")
    )
    credentials = result.scalar_one_or_none()

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential not found",
        )

    if request_data.domain is not None:
        credentials.domain = request_data.domain

    if request_data.username is not None:
        credentials.username = request_data.username

    if request_data.password is not None:
        credentials.password = request_data.password

    await session.commit()

    return Credentials(identifier=credentials.identifier.partition("-")[2], domain=credentials.domain, username=credentials.username, password=credentials.password)


@router.delete("/{identifier}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_credential(identifier: str, id: CurrentAccount, session: DatabaseSession) -> Response:
    if len(identifier) > database.MAX_IDENTIFIER_LENGTH:
        raise HTTPException(status_code=400, detail="Path too long")

    result = await session.execute(
        select(database.Credentials)
        .where(database.Credentials.owner_id == id)
        .where(database.Credentials.identifier == f"{id}-{identifier}")
    )
    credential = result.scalar_one_or_none()

    if credential is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Credential not found",
        )

    await session.delete(credential)
    await session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
