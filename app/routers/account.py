import base64
from datetime import timedelta
import hashlib
from typing import cast

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519
from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlmodel import col, delete, select

from .. import database
from ..dependencies import CurrentAccount, DatabaseSession
from ..encoding import decode_base64url
from ..security import NONCE_TTL, issue_access_token, issue_nonce


router = APIRouter(
    prefix="/account",
    tags=["Accounts"]
)

class Account(BaseModel):
    id: int
    username: str = Field(max_length=database.MAX_USERNAME_LENGTH)

class Challenge(BaseModel):
    nonce: str
    salt: str

class LoginRequest(BaseModel):
    username: str = Field(max_length=database.MAX_USERNAME_LENGTH)
    signed_nonce: str
    fingerprint: str

class RegistrationRequest(BaseModel):
    username: str = Field(max_length=database.MAX_USERNAME_LENGTH)
    public_key: str
    wrapped_key: str
    salt: str

class AddKeyRequest(BaseModel):
    label: str = Field(default="Additional Key", max_length=database.MAX_LABEL_LENGTH)
    public_key: str
    wrapped_key: str

class Key(BaseModel):
    label: str
    fingerprint: str
    public_key: str
    wrapped_key: str
    is_master: bool

@router.get(
    "/",
)
async def read_account(id: CurrentAccount, session: DatabaseSession) -> Account:
    account = await session.get(database.Account, id)

    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found",
        )

    return Account.model_validate(account.model_dump())

@router.delete(
    "/",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_account(id: CurrentAccount, session: DatabaseSession) -> Response:
    account = await session.get(database.Account, id)

    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found",
        )

    _ = await session.execute(
        delete(database.Key)
        .where(col(database.Key.owner_id) == id)
    )
    _ = await session.execute(
        delete(database.Credentials)
        .where(col(database.Credentials.owner_id) == id)
    )
    _ = await session.execute(
        delete(database.Nonce)
        .where(col(database.Nonce.username) == account.username)
    )
    await session.delete(account)
    await session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)

@router.get(
    "/challenge"
)
async def issue_challenge(username: str, session: DatabaseSession) -> Challenge:
    result = await session.execute(
        select(database.Account.salt)
        .where(database.Account.username == username)
    )
    salt = result.scalar_one_or_none()

    if salt is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found",
        )

    data = issue_nonce(username)
    nonce = await session.get(database.Nonce, username)

    if nonce is None:
        nonce = database.Nonce(
            username=username,
            data=data,
            expires_at=database.utc_now() + timedelta(seconds=NONCE_TTL),
        )
        session.add(nonce)
    else:
        nonce.data = data
        nonce.expires_at = database.utc_now() + timedelta(seconds=NONCE_TTL)

    await session.commit()

    return Challenge(
        nonce=base64.urlsafe_b64encode(data).decode(),
        salt=base64.urlsafe_b64encode(salt).decode(),
    )

@router.post(
    "/login"
)
async def login(request_data: LoginRequest, session: DatabaseSession) -> str:
    account_result = await session.execute(
        select(database.Account)
        .where(database.Account.username == request_data.username)
    )
    account = account_result.scalar_one_or_none()

    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found",
        )

    fingerprint = decode_base64url(request_data.fingerprint, "Invalid fingerprint encoding")

    key_result = await session.execute(
        select(database.Key.data)
        .where(database.Key.owner_id == account.id)
        .where(database.Key.fingerprint == fingerprint)
    )
    key_data = key_result.scalar_one_or_none()

    if key_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    nonce_result = await session.execute(
        select(database.Nonce)
        .where(database.Nonce.username == request_data.username)
        .with_for_update()
    )
    nonce = nonce_result.scalar_one_or_none()

    if nonce is None or nonce.expires_at < database.utc_now():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Challenge expired or missing",
        )

    nonce_data = nonce.data
    await session.delete(nonce)
    await session.commit()

    signed_nonce = decode_base64url(request_data.signed_nonce, "Invalid signature encoding")

    key = cast(ed25519.Ed25519PublicKey, serialization.load_der_public_key(key_data))

    try:
        key.verify(signed_nonce, nonce_data)
    except InvalidSignature as error:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        ) from error

    return issue_access_token(cast(int, account.id)).serialize()

@router.post(
    "/register"
)
async def register(request_data: RegistrationRequest, session: DatabaseSession) -> str:
    try:
        account = database.Account(
            username=request_data.username,
            salt=decode_base64url(request_data.salt, "Invalid salt encoding")
        )
        session.add(account)
        await session.flush()

        data = decode_base64url(request_data.public_key, "Invalid public key encoding")
        key = database.Key(
            fingerprint=hashlib.sha256(data).digest(),
            owner_id=cast(int, account.id),
            label="Master Password",
            data=data,
            wrapped_key=decode_base64url(request_data.wrapped_key, "Invalid wrapped key encoding"),
            is_master=True,
        )
        session.add(key)
        await session.commit()
    except IntegrityError as error:
        await session.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Account already exists",
        ) from error

    return issue_access_token(cast(int, account.id)).serialize()

@router.post(
    "/key",
    status_code=status.HTTP_201_CREATED,
)
async def add_key(request_data: AddKeyRequest, id: CurrentAccount, session: DatabaseSession) -> Key:
    account = await session.get(database.Account, id)

    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found",
        )

    data = decode_base64url(request_data.public_key, "Invalid public key encoding")
    fingerprint = hashlib.sha256(data).digest()
    key = database.Key(
        fingerprint=fingerprint,
        owner_id=id,
        label=request_data.label,
        data=data,
        wrapped_key=decode_base64url(request_data.wrapped_key, "Invalid wrapped key encoding"),
        is_master=False,
    )
    session.add(key)

    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()

        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Key already exists",
        ) from error

    return Key(
        label=key.label,
        fingerprint=base64.urlsafe_b64encode(fingerprint).decode(),
        public_key=request_data.public_key,
        wrapped_key=request_data.wrapped_key,
        is_master=False,
    )

@router.get(
    "/keys",
)
async def list_keys(id: CurrentAccount, session: DatabaseSession) -> list[Key]:
    account = await session.get(database.Account, id)

    if account is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Account not found",
        )

    result = await session.execute(
        select(database.Key)
        .where(database.Key.owner_id == id)
    )

    return [
        Key(
            label=key.label,
            fingerprint=base64.urlsafe_b64encode(key.fingerprint).decode(),
            public_key=base64.urlsafe_b64encode(key.data).decode(),
            wrapped_key=base64.urlsafe_b64encode(key.wrapped_key).decode(),
            is_master=key.is_master,
        )
        for key in result.scalars()
    ]

@router.delete(
    "/key/{fingerprint}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_key(fingerprint: str, id: CurrentAccount, session: DatabaseSession) -> Response:
    fingerprint_data = decode_base64url(fingerprint, "Invalid fingerprint encoding")

    result = await session.execute(
        select(database.Key)
        .where(database.Key.owner_id == id)
        .where(database.Key.fingerprint == fingerprint_data)
    )
    key = result.scalar_one_or_none()

    if key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Key not found",
        )

    if key.is_master:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Master key cannot be deleted",
        )

    await session.delete(key)
    await session.commit()

    return Response(status_code=status.HTTP_204_NO_CONTENT)
