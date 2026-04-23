from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import database
from .routers import account, credentials


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await database.initialise()
    yield


app = FastAPI(lifespan=lifespan)

app.include_router(account.router)
app.include_router(credentials.router)
