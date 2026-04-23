# Generate a random EdDSA key to sign JWTs, encrypt it with a randomly generated password, and save it to a file named jwt.key

from jwcrypto import jwk # type: ignore
import secrets, base64


key = jwk.JWK.generate(kty="OKP", crv="Ed25519")
password= secrets.token_bytes(32)

with open("jwt.key", "wb") as f:
    _ = f.write(key.export_to_pem(private_key=True, password=password))
    
print(f"Password: {base64.urlsafe_b64encode(password).decode()}")
