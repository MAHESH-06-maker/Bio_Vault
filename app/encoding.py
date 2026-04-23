import base64

from fastapi import HTTPException, status


def decode_base64url(value: str, detail: str) -> bytes:
    padding = "=" * (-len(value) % 4)

    try:
        return base64.b64decode((value + padding).encode(), altchars=b"-_", validate=True)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=detail,
        ) from error
