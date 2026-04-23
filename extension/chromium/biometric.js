import { request } from "./lib/api.js";
import {
  decodeBase64Url,
  decryptWithAesGcm,
  encryptWithAesGcm,
  ed25519KeyPairFromSeed,
  encodeBase64Url,
  fingerprintFromPublicKey,
  randomBytes,
  signDetached,
  utf8Bytes,
  utf8String,
} from "./lib/crypto.js";
import {
  getFaceUnlock,
  getSession,
  saveFaceUnlock,
  saveSession,
  saveSettings,
} from "./lib/storage.js";

const params = new URLSearchParams(location.search);
const mode = params.get("mode");
const requestedUsername = params.get("username") || "";

const title = document.querySelector("#title");
const description = document.querySelector("#description");
const video = document.querySelector("#video");
const actions = document.querySelector("#actions");
const statusLine = document.querySelector("#status");

let faceStream = null;
let unlockMaterial = null;

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.style.color = isError ? "var(--danger)" : "var(--accent-deep)";
}

function makeButton(label, className, onClick) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.textContent = label;
  element.addEventListener("click", onClick);
  return element;
}

async function openConsoleWindow() {
  await chrome.windows.create({
    url: chrome.runtime.getURL("console.html"),
    type: "popup",
    width: 560,
    height: 900,
    focused: true,
  });
}

function getFaceApi() {
  if (!globalThis.faceapi) {
    throw new Error("face-api.js is not loaded.");
  }
  return globalThis.faceapi;
}

async function ensureFaceModelsLoaded() {
  const faceapi = getFaceApi();
  if (ensureFaceModelsLoaded.loaded) return;
  const modelUrl = "vendor/face-models";
  try {
    const preflight = await fetch(`${modelUrl}/tiny_face_detector_model-weights_manifest.json`);
    if (!preflight.ok) {
      throw new Error(`preflight status ${preflight.status}`);
    }
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(modelUrl),
      faceapi.nets.faceLandmark68Net.loadFromUri(modelUrl),
      faceapi.nets.faceRecognitionNet.loadFromUri(modelUrl),
    ]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to load face models from ${modelUrl}: ${reason}`);
  }
  ensureFaceModelsLoaded.loaded = true;
}

async function startCamera() {
  await ensureFaceModelsLoaded();
  faceStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
  video.srcObject = faceStream;
  video.classList.remove("hidden");
  await video.play();
}

async function stopCamera() {
  if (faceStream) {
    for (const track of faceStream.getTracks()) track.stop();
  }
  faceStream = null;
  video.srcObject = null;
  video.classList.add("hidden");
}

async function detectDescriptorOrNull() {
  const faceapi = getFaceApi();
  const detection = await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
  return detection ? Array.from(detection.descriptor) : null;
}

function euclideanDistance(first, second) {
  let total = 0;
  for (let index = 0; index < first.length; index += 1) {
    const delta = first[index] - second[index];
    total += delta * delta;
  }
  return Math.sqrt(total);
}

async function performBackendLogin(username, passwordKey, ed25519Seed) {
  const challenge = await request(`/account/challenge?username=${encodeURIComponent(username)}`, { auth: false });
  const keyPair = ed25519KeyPairFromSeed(ed25519Seed);
  const fingerprint = await fingerprintFromPublicKey(keyPair.publicKey);
  const signedNonce = signDetached(decodeBase64Url(challenge.nonce), keyPair.secretKey);
  const accessToken = await request("/account/login", {
    method: "POST",
    auth: false,
    body: {
      username,
      fingerprint: encodeBase64Url(fingerprint),
      signed_nonce: encodeBase64Url(signedNonce),
    },
  });
  const keys = await request("/account/keys", {
    auth: false,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const matchingKey = keys.find((key) => {
    try {
      const keyFingerprint = decodeBase64Url(key.fingerprint);
      return keyFingerprint.length === fingerprint.length
        && keyFingerprint.every((byte, index) => byte === fingerprint[index]);
    } catch {
      return false;
    }
  });
  if (!matchingKey) throw new Error("Matching key record not found.");
  const vaultKey = await decryptWithAesGcm(passwordKey, decodeBase64Url(matchingKey.wrapped_key));

  await saveSettings({ username });
  await saveSession({
    accessToken,
    aesKey: encodeBase64Url(vaultKey),
    passwordKey: encodeBase64Url(passwordKey),
    ed25519Seed: encodeBase64Url(ed25519Seed),
    fingerprint: encodeBase64Url(fingerprint),
    username,
  });
}

async function loadUnlockMaterial() {
  const session = await getSession();
  if (!session.username || !session.passwordKey || !session.ed25519Seed) {
    throw new Error("Login with your password first, then enable face unlock.");
  }
  unlockMaterial = {
    username: requestedUsername || session.username,
    passwordKey: decodeBase64Url(session.passwordKey),
    ed25519Seed: decodeBase64Url(session.ed25519Seed),
  };
}

async function saveFaceApiEnrollment(descriptor) {
  const faceKey = randomBytes(32);
  const wrappedBundle = await encryptWithAesGcm(
    faceKey,
    utf8Bytes(JSON.stringify({
      username: unlockMaterial.username,
      passwordKey: encodeBase64Url(unlockMaterial.passwordKey),
      ed25519Seed: encodeBase64Url(unlockMaterial.ed25519Seed),
    })),
  );
  const sealed = new Uint8Array(faceKey.length + wrappedBundle.length);
  sealed.set(faceKey, 0);
  sealed.set(wrappedBundle, faceKey.length);
  await saveFaceUnlock(unlockMaterial.username, {
    method: "face-api",
    wrappedBundle: encodeBase64Url(sealed),
    username: unlockMaterial.username,
    descriptor,
  });
}

async function runEnable() {
  title.textContent = "Enable Face Unlock";
  description.textContent = "Look at the camera and enroll a local face profile for unlocking this extension.";
  await loadUnlockMaterial();

  await startCamera();
  actions.replaceChildren(
    makeButton("Scan Face", "primary-button", async () => {
      try {
        const descriptor = await detectDescriptorOrNull();
        if (!descriptor) {
          throw new Error("No face detected in camera feed.");
        }
        await saveFaceApiEnrollment(descriptor);
        await stopCamera();
        setStatus("Camera-based face unlock enabled.");
        setTimeout(() => {
          window.close();
        }, 250);
      } catch (error) {
        setStatus(error.message, true);
      }
    }),
    makeButton("Cancel", "ghost-button", async () => {
      await stopCamera();
      window.close();
    }),
  );
}

async function runUnlock() {
  title.textContent = "Unlock with Face";
  const session = await getSession();
  const username = (requestedUsername || session.username || "").trim();
  if (!username) {
    throw new Error("Enter username first, then try face unlock.");
  }
  const faceUnlock = await getFaceUnlock(username);
  if (!faceUnlock.method) throw new Error("Face unlock is not configured.");
  description.textContent = "Look at the camera to match the enrolled face profile and unlock the vault.";

  await startCamera();
  actions.replaceChildren(
    makeButton("Scan Face", "primary-button", async () => {
      try {
        const faceUnlockState = await getFaceUnlock(username);
        const descriptor = await detectDescriptorOrNull();
        if (!descriptor) {
          throw new Error("No face detected in camera feed.");
        }
        if (!Array.isArray(faceUnlockState.descriptor) || faceUnlockState.descriptor.length !== descriptor.length) {
          throw new Error("Face unlock enrollment is invalid. Re-enroll your face.");
        }
        const distance = euclideanDistance(faceUnlockState.descriptor, descriptor);
        if (distance > 0.48) {
          throw new Error("Face detected, but it does not match the enrolled profile.");
        }
        const sealedBytes = decodeBase64Url(faceUnlockState.wrappedBundle);
        const faceKey = sealedBytes.slice(0, 32);
        const sealed = sealedBytes.slice(32);
        const bundle = JSON.parse(utf8String(
          await decryptWithAesGcm(faceKey, sealed),
        ));
        if (bundle.username !== username) {
          throw new Error("Face unlock record belongs to a different account.");
        }
        await performBackendLogin(
          bundle.username,
          decodeBase64Url(bundle.passwordKey),
          decodeBase64Url(bundle.ed25519Seed),
        );
        await stopCamera();
        setStatus("Vault unlocked.");
        setTimeout(() => {
          openConsoleWindow()
            .catch((error) => {
              setStatus(error.message, true);
            })
            .finally(() => {
              window.close();
            });
        }, 250);
      } catch (error) {
        setStatus(error.message, true);
      }
    }),
    makeButton("Cancel", "ghost-button", async () => {
      await stopCamera();
      window.close();
    }),
  );
}

document.querySelector("#close").addEventListener("click", async () => {
  await stopCamera();
  window.close();
});

(async () => {
  try {
    if (mode === "enable") {
      await runEnable();
      return;
    }
    if (mode === "unlock") {
      await runUnlock();
      return;
    }
    throw new Error("Unknown biometric mode.");
  } catch (error) {
    setStatus(error.message, true);
  }
})();
