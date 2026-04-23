import base64
import os
from pathlib import Path
import time

from cryptography import fernet
from jwcrypto import jwk, jwt # type: ignore


with open(Path(__file__).parents[1] / "jwt.key", "rb") as file:
    JWT_KEY = jwk.JWK.from_pem(file.read(), base64.urlsafe_b64decode(os.environ["JWT_KEY_PASSWORD"]))

JWT_TTL = int(os.environ["JWT_EXPIRATION_PERIOD"])

NONCE_SECRET = os.environ["NONCE_SECRET"].encode()
NONCE_CIPHER = fernet.Fernet(NONCE_SECRET)
NONCE_TTL = int(os.environ["NONCE_EXPIRATION_PERIOD"])

def issue_access_token(account_id: int) -> jwt.JWT:
    issuance_time = time.time()
    expiration_time = issuance_time + JWT_TTL

    token = jwt.JWT(
        header={"alg": "EdDSA"},
        claims={
            "sub": str(account_id),
            "exp": expiration_time,
            "nbf": issuance_time,
        }
    )
    token.make_signed_token(JWT_KEY)

    return token

def issue_nonce(username: str) -> bytes:
    return NONCE_CIPHER.encrypt(username.encode())
