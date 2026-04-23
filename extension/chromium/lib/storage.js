export const DEFAULT_SETTINGS = {
  apiBaseUrl: "http://127.0.0.1:8000",
  username: "",
};

export const DEFAULT_SESSION = {
  accessToken: "",
  aesKey: "",
  passwordKey: "",
  ed25519Seed: "",
  fingerprint: "",
  username: "",
};

export const DEFAULT_FACE_UNLOCK = {
  method: "",
  wrappedBundle: "",
  username: "",
  descriptor: [],
};

const FACE_UNLOCK_STORE_KEY = "faceUnlockByUsername";

export async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
  };
}

export async function saveSettings(nextSettings) {
  const current = await getSettings();
  const merged = { ...current, ...nextSettings };
  await chrome.storage.sync.set(merged);
  return merged;
}

export async function getSession() {
  const stored = await chrome.storage.session.get(DEFAULT_SESSION);
  return {
    ...DEFAULT_SESSION,
    ...stored,
  };
}

export async function saveSession(nextSession) {
  const current = await getSession();
  const merged = { ...current, ...nextSession };
  await chrome.storage.session.set(merged);
  return merged;
}

export async function clearSession() {
  await chrome.storage.session.clear();
}

export async function getFaceUnlock(username) {
  if (!username) {
    return { ...DEFAULT_FACE_UNLOCK };
  }
  const stored = await chrome.storage.local.get(FACE_UNLOCK_STORE_KEY);
  const perUser = stored[FACE_UNLOCK_STORE_KEY] || {};
  const record = perUser[username] || {};
  return {
    ...DEFAULT_FACE_UNLOCK,
    ...record,
    username: username || record.username || "",
  };
}

export async function saveFaceUnlock(username, nextFaceUnlock) {
  if (!username) {
    throw new Error("Username is required for face unlock storage.");
  }
  const stored = await chrome.storage.local.get(FACE_UNLOCK_STORE_KEY);
  const perUser = stored[FACE_UNLOCK_STORE_KEY] || {};
  const current = {
    ...DEFAULT_FACE_UNLOCK,
    ...(perUser[username] || {}),
  };
  const merged = { ...current, ...nextFaceUnlock, username };
  perUser[username] = merged;
  await chrome.storage.local.set({ [FACE_UNLOCK_STORE_KEY]: perUser });
  return merged;
}

export async function clearFaceUnlock(username) {
  if (!username) {
    await chrome.storage.local.remove(FACE_UNLOCK_STORE_KEY);
    return;
  }
  const stored = await chrome.storage.local.get(FACE_UNLOCK_STORE_KEY);
  const perUser = stored[FACE_UNLOCK_STORE_KEY] || {};
  delete perUser[username];
  await chrome.storage.local.set({ [FACE_UNLOCK_STORE_KEY]: perUser });
}
