const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const ED25519_SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function assertVendor(name) {
  const value = globalThis[name];
  if (!value) {
    throw new Error(`${name} is not loaded.`);
  }
  return value;
}

export function utf8Bytes(value) {
  return textEncoder.encode(value);
}

export function utf8String(bytes) {
  return textDecoder.decode(bytes);
}

export function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

export async function encryptWithAesGcm(keyBytes, plaintext) {
  const iv = randomBytes(12);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext,
    ),
  );
  const sealed = new Uint8Array(iv.length + ciphertext.length);
  sealed.set(iv, 0);
  sealed.set(ciphertext, iv.length);
  return sealed;
}

export async function decryptWithAesGcm(keyBytes, sealed) {
  const iv = sealed.slice(0, 12);
  const ciphertext = sealed.slice(12);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext,
    ),
  );
}

export function encodeBase64Url(bytes) {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeBase64Url(value) {
  const padding = value.length % 4 === 0 ? "" : "=".repeat(4 - (value.length % 4));
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/") + padding;
  const binary = atob(normalized);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function hkdfExpand(secret, info, length) {
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(),
      info: utf8Bytes(info),
    },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

export async function deriveSessionSecrets(password, saltBase64Url) {
  const argon2 = assertVendor("argon2");
  const salt = decodeBase64Url(saltBase64Url);
  const result = await argon2.hash({
    pass: utf8Bytes(password),
    salt,
    time: 3,
    mem: 65536,
    parallelism: 4,
    hashLen: 32,
    type: argon2.ArgonType ? argon2.ArgonType.Argon2id : 2,
  });

  const rootSecret = result.hash instanceof Uint8Array ? result.hash : new Uint8Array(result.hash);
  const aesKey = await hkdfExpand(rootSecret, "aes-256-gcm-key", 32);
  const ed25519Seed = await hkdfExpand(rootSecret, "ed25519-seed", 32);

  return { aesKey, ed25519Seed };
}

export function ed25519KeyPairFromSeed(seed) {
  const nacl = assertVendor("nacl");
  return nacl.sign.keyPair.fromSeed(seed);
}

export function ed25519SpkiFromPublicKey(publicKey) {
  const spki = new Uint8Array(ED25519_SPKI_PREFIX.length + publicKey.length);
  spki.set(ED25519_SPKI_PREFIX, 0);
  spki.set(publicKey, ED25519_SPKI_PREFIX.length);
  return spki;
}

export async function fingerprintFromPublicKey(publicKey) {
  const publicKeyDer = ed25519SpkiFromPublicKey(publicKey);
  return sha256(publicKeyDer);
}

export function signDetached(message, secretKey) {
  const nacl = assertVendor("nacl");
  return nacl.sign.detached(message, secretKey);
}

export function decodeJwtPayload(token) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid access token.");
  }

  const payload = decodeBase64Url(parts[1]);
  return JSON.parse(textDecoder.decode(payload));
}
