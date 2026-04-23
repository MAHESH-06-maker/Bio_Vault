import { request } from "./lib/api.js";
import {
  decodeBase64Url,
  decodeJwtPayload,
  decryptWithAesGcm,
  deriveSessionSecrets,
  ed25519KeyPairFromSeed,
  ed25519SpkiFromPublicKey,
  encryptWithAesGcm,
  encodeBase64Url,
  fingerprintFromPublicKey,
  randomBytes,
  signDetached,
} from "./lib/crypto.js";
import { clearFaceUnlock, clearSession, getFaceUnlock, getSession, getSettings, saveSession, saveSettings } from "./lib/storage.js";

const loginView = document.querySelector("#login-view");
const appView = document.querySelector("#app-view");
const loginPanel = document.querySelector("#login-panel");
const registerPanel = document.querySelector("#register-panel");
const showLoginButton = document.querySelector("#show-login");
const showRegisterButton = document.querySelector("#show-register");
const loginForm = document.querySelector("#login-form");
const registerForm = document.querySelector("#register-form");
const faceUnlockButton = document.querySelector("#face-unlock-button");
const toggleFaceUnlockButton = document.querySelector("#toggle-face-unlock");
const apiBaseUrl = document.querySelector("#api-base-url");
const usernameNode = document.querySelector("#username");
const keyList = document.querySelector("#key-list");
const credentialList = document.querySelector("#credential-list");
const keyTemplate = document.querySelector("#key-item-template");
const credentialTemplate = document.querySelector("#credential-item-template");
const statusLine = document.querySelector("#status");
const credentialForm = document.querySelector("#credential-form");
const credentialFormTitle = document.querySelector("#credential-form-title");
const credentialFormSubmit = document.querySelector("#credential-form-submit");
const credentialsPage = document.querySelector("#credentials-page");
const keysPage = document.querySelector("#keys-page");
const credentialFormPage = document.querySelector("#credential-form-page");

let cachedCredentials = [];
let credentialFormMode = "create";
let editingIdentifier = null;

function setStatus(message, isError = false) {
  statusLine.textContent = message;
  statusLine.style.color = isError ? "var(--danger)" : "var(--accent-deep)";
}

function setLoggedInState(isLoggedIn) {
  loginView.classList.toggle("hidden", isLoggedIn);
  appView.classList.toggle("hidden", !isLoggedIn);
}

function setAuthMode(mode) {
  const isLogin = mode === "login";
  loginPanel.classList.toggle("hidden", !isLogin);
  registerPanel.classList.toggle("hidden", isLogin);
  showLoginButton.classList.toggle("hidden", isLogin);
  showRegisterButton.classList.toggle("hidden", !isLogin);
}

function setAppPage(page) {
  credentialsPage.classList.toggle("hidden", page !== "credentials");
  keysPage.classList.toggle("hidden", page !== "keys");
  credentialFormPage.classList.toggle("hidden", page !== "credential-form");
}

async function handleError(error) {
  if (error?.status === 401) {
    await logout("Session expired or invalid.");
    return;
  }

  setStatus(error?.message || "Unexpected error.", true);
}

async function logout(reason = "Logged out.") {
  await clearSession();
  setLoggedInState(false);
  setAuthMode("login");
  setAppPage("credentials");
  keyList.textContent = "";
  credentialList.textContent = "";
  cachedCredentials = [];
  const settings = await getSettings();
  loginForm.username.value = settings.username || "";
  loginForm.password.value = "";
  registerForm.username.value = settings.username || "";
  registerForm.password.value = "";
  registerForm.confirmPassword.value = "";
  usernameNode.textContent = settings.username || "Not configured";
  await refreshFaceUnlockState();
  setStatus(reason);
}

function prepareCredentialForm(mode, credential = null) {
  credentialFormMode = mode;
  editingIdentifier = credential ? credential.identifier : null;
  credentialFormTitle.textContent = mode === "create" ? "Add Credential" : "Edit Credential";
  credentialFormSubmit.textContent = mode === "create" ? "Create Credential" : "Save Changes";
  credentialForm.identifier.disabled = mode === "edit";
  credentialForm.identifier.value = credential ? credential.identifier : "";
  credentialForm.domain.value = credential?.domain || "";
  credentialForm.username.value = credential?.username || "";
  credentialForm.password.value = credential?.password || "";
}

async function getActiveTabDomainOrEmpty() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.url) {
    return "";
  }

  try {
    const { hostname, protocol } = new URL(tab.url);
    if (!hostname || (protocol !== "http:" && protocol !== "https:")) {
      return "";
    }
    return hostname;
  } catch {
    return "";
  }
}

async function getTargetTabOrThrow() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id || !tab.url) {
    throw new Error("No active tab available.");
  }
  return tab;
}

function domainsMatch(activeDomain, credentialDomain) {
  const active = activeDomain.trim().toLowerCase();
  const credential = credentialDomain.trim().toLowerCase();

  if (!active || !credential) {
    return false;
  }

  return active === credential || active.endsWith(`.${credential}`);
}

function renderKeys(keys) {
  keyList.textContent = "";

  if (!keys.length) {
    keyList.innerHTML = '<li class="card-item"><p class="card-title">No keys stored.</p></li>';
    return;
  }

  for (const key of keys) {
    const fragment = keyTemplate.content.cloneNode(true);
    const title = fragment.querySelector(".card-title");
    const button = fragment.querySelector(".delete-key-button");

    title.textContent = key.label;
    if (key.is_master) {
      button.disabled = true;
      button.textContent = "Locked";
    } else {
      button.dataset.fingerprint = key.fingerprint;
    }

    keyList.append(fragment);
  }
}

function renderCredentials(credentials, activeDomain = "") {
  credentialList.textContent = "";
  const sortedCredentials = [...credentials].sort((first, second) => {
    const firstMatches = domainsMatch(activeDomain, first.domain || "");
    const secondMatches = domainsMatch(activeDomain, second.domain || "");
    if (firstMatches === secondMatches) {
      return 0;
    }
    return firstMatches ? -1 : 1;
  });
  cachedCredentials = sortedCredentials;

  if (!sortedCredentials.length) {
    credentialList.innerHTML = '<li class="card-item"><p class="card-title">No credentials stored.</p></li>';
    return;
  }

  for (const credential of sortedCredentials) {
    const fragment = credentialTemplate.content.cloneNode(true);
    fragment.querySelector(".card-title").textContent = credential.identifier;
    fragment.querySelector(".card-subtitle").textContent = credential.username;
    fragment.querySelector(".copy-username-button").dataset.identifier = credential.identifier;
    fragment.querySelector(".copy-password-button").dataset.identifier = credential.identifier;
    fragment.querySelector(".edit-credential-button").dataset.identifier = credential.identifier;
    fragment.querySelector(".delete-credential-button").dataset.identifier = credential.identifier;
    credentialList.append(fragment);
  }
}

async function loadSettings() {
  const settings = await getSettings();
  apiBaseUrl.textContent = settings.apiBaseUrl || "Not configured";
  usernameNode.textContent = settings.username || "Not configured";
  loginForm.username.value = settings.username || "";
  registerForm.username.value = settings.username || "";
  await refreshFaceUnlockState();
}

async function refreshFaceUnlockState() {
  const session = await getSession();
  const username = (session.username || loginForm.username.value || "").trim();
  const faceUnlock = await getFaceUnlock(username);
  const enabled = Boolean(username && faceUnlock.method && faceUnlock.wrappedBundle);
  faceUnlockButton.classList.toggle("hidden", !enabled);
  toggleFaceUnlockButton.textContent = enabled ? "Disable Face" : "Enable Face";
}

async function assertActiveSession() {
  const session = await getSession();
  if (!session.accessToken) {
    return false;
  }

  const payload = decodeJwtPayload(session.accessToken);
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= Date.now()) {
    await logout("Session expired.");
    return false;
  }

  return true;
}

async function refreshKeys() {
  renderKeys(await request("/account/keys"));
}

async function refreshCredentials() {
  const [credentials, activeDomain] = await Promise.all([
    request("/credentials/"),
    getActiveTabDomainOrEmpty(),
  ]);
  renderCredentials(credentials, activeDomain);
}

async function refreshAll() {
  await loadSettings();
  if (!(await assertActiveSession())) {
    setLoggedInState(false);
    return;
  }

  setLoggedInState(true);
  setAppPage("credentials");
  const session = await getSession();
  usernameNode.textContent = session.username;
  await Promise.all([refreshKeys(), refreshCredentials()]);
  await refreshFaceUnlockState();
  setStatus("Vault data refreshed.");
}

async function launchBiometricWindow(mode, username = "") {
  const url = chrome.runtime.getURL(
    `biometric.html?mode=${encodeURIComponent(mode)}${username ? `&username=${encodeURIComponent(username)}` : ""}`,
  );
  const biometricWindow = await chrome.windows.create({
    url,
    type: "popup",
    width: 620,
    height: 760,
    focused: true,
  });
  await new Promise((resolve) => {
    const listener = (windowId) => {
      if (windowId === biometricWindow.id) {
        chrome.windows.onRemoved.removeListener(listener);
        resolve();
      }
    };
    chrome.windows.onRemoved.addListener(listener);
  });
}

async function startFaceUnlock(usernameOverride = "") {
  const username = (usernameOverride || loginForm.username.value || "").trim();
  if (!username) {
    throw new Error("Enter your username first.");
  }
  const faceUnlock = await getFaceUnlock(username);
  if (!faceUnlock.method) {
    throw new Error("Face unlock is not configured for this account.");
  }
  await launchBiometricWindow("unlock", username);
  await refreshAll();
}

async function completePasswordLogin(username, passwordKey, ed25519Seed, challenge = null) {
  const activeChallenge =
    challenge
    || await request(`/account/challenge?username=${encodeURIComponent(username)}`, { auth: false });
  const keyPair = ed25519KeyPairFromSeed(ed25519Seed);
  const fingerprint = await fingerprintFromPublicKey(keyPair.publicKey);
  const signedNonce = signDetached(decodeBase64Url(activeChallenge.nonce), keyPair.secretKey);
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
  if (!matchingKey) {
    throw new Error("Matching key record not found.");
  }
  const vaultKey = await decryptWithAesGcm(passwordKey, decodeBase64Url(matchingKey.wrapped_key));

  await saveSettings({ username });
  await saveSession({
    accessToken,
    aesKey: encodeBase64Url(vaultKey),
    passwordKey: encodeBase64Url(passwordKey),
    username,
    fingerprint: encodeBase64Url(fingerprint),
    ed25519Seed: encodeBase64Url(ed25519Seed),
  });
}

async function performLogin(username, password) {
  const challenge = await request(`/account/challenge?username=${encodeURIComponent(username)}`, { auth: false });
  const { aesKey: passwordKey, ed25519Seed } = await deriveSessionSecrets(password, challenge.salt);
  await completePasswordLogin(username, passwordKey, ed25519Seed, challenge);
}

async function performRegistration(username, password) {
  const salt = randomBytes(16);
  const saltBase64 = encodeBase64Url(salt);
  const { aesKey: passwordKey, ed25519Seed } = await deriveSessionSecrets(password, saltBase64);
  const vaultKey = randomBytes(32);
  const wrappedKey = await encryptWithAesGcm(passwordKey, vaultKey);
  const keyPair = ed25519KeyPairFromSeed(ed25519Seed);
  const publicKeyDer = ed25519SpkiFromPublicKey(keyPair.publicKey);
  const fingerprint = await fingerprintFromPublicKey(keyPair.publicKey);
  const accessToken = await request("/account/register", {
    method: "POST",
    auth: false,
    body: {
      username,
      public_key: encodeBase64Url(publicKeyDer),
      wrapped_key: encodeBase64Url(wrappedKey),
      salt: saltBase64,
    },
  });

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

async function copyText(value, label) {
  await navigator.clipboard.writeText(value);
  setStatus(`${label} copied.`);
}

document.querySelector("#open-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

showLoginButton.addEventListener("click", () => {
  setAuthMode("login");
  setStatus("Login with an existing vault.");
});

showRegisterButton.addEventListener("click", () => {
  setAuthMode("register");
  setStatus("Create a new vault account.");
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  await logout("Session cleared.");
});

faceUnlockButton.addEventListener("click", async () => {
  try {
    const username = loginForm.username.value.trim();
    await startFaceUnlock(username);
  } catch (error) {
    await handleError(error);
  }
});

document.querySelector("#open-keys-page").addEventListener("click", async () => {
  try {
    if (!(await assertActiveSession())) return;
    await refreshKeys();
    setAppPage("keys");
  } catch (error) {
    await handleError(error);
  }
});

document.querySelector("#back-from-keys").addEventListener("click", () => {
  setAppPage("credentials");
});

document.querySelector("#open-add-credential").addEventListener("click", async () => {
  prepareCredentialForm("create");
  try {
    const domain = await getActiveTabDomainOrEmpty();
    if (domain) {
      credentialForm.domain.value = domain;
    }
  } catch {
    // Ignore tab lookup issues and leave the domain field blank.
  }
  setAppPage("credential-form");
});

document.querySelector("#back-from-credential-form").addEventListener("click", () => {
  setAppPage("credentials");
});

toggleFaceUnlockButton.addEventListener("click", async () => {
  try {
    if (!(await assertActiveSession())) return;
    const session = await getSession();
    const username = session.username;
    if (!username) {
      throw new Error("No active account for face unlock.");
    }
    const faceUnlock = await getFaceUnlock(username);
    if (faceUnlock.method) {
      await clearFaceUnlock(username);
      await refreshFaceUnlockState();
      setStatus("Face unlock disabled.");
      return;
    }
    await launchBiometricWindow("enable", username);
    await refreshFaceUnlockState();
    setStatus("Face unlock flow completed.");
  } catch (error) {
    await handleError(error);
  }
});

document.querySelector("#refresh-keys").addEventListener("click", async () => {
  try {
    if (!(await assertActiveSession())) return;
    await refreshKeys();
    setStatus("Keys refreshed.");
  } catch (error) {
    await handleError(error);
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const username = loginForm.username.value.trim();
    const password = loginForm.password.value;
    await performLogin(username, password);
    loginForm.password.value = "";
    await refreshAll();
    setStatus("Vault unlocked.");
  } catch (error) {
    await clearSession();
    setLoggedInState(false);
    setAuthMode("login");
    setStatus(error?.message || "Login failed.", true);
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const username = registerForm.username.value.trim();
    const password = registerForm.password.value;
    const confirmPassword = registerForm.confirmPassword.value;
    if (password !== confirmPassword) {
      throw new Error("Passwords do not match.");
    }

    await performRegistration(username, password);
    registerForm.password.value = "";
    registerForm.confirmPassword.value = "";
    await refreshAll();
    setStatus("Vault created and unlocked.");
  } catch (error) {
    await clearSession();
    setLoggedInState(false);
    setAuthMode("register");
    setStatus(error?.message || "Registration failed.", true);
  }
});

credentialForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    if (!(await assertActiveSession())) return;

    const payload = {
      identifier: credentialForm.identifier.value.trim(),
      domain: credentialForm.domain.value.trim() || null,
      username: credentialForm.username.value.trim(),
      password: credentialForm.password.value,
    };

    if (credentialFormMode === "create") {
      await request("/credentials/", { method: "POST", body: payload });
      setStatus("Credential created.");
    } else {
      await request(`/credentials/${encodeURIComponent(editingIdentifier)}`, {
        method: "PUT",
        body: {
          domain: payload.domain,
          username: payload.username,
          password: payload.password,
        },
      });
      setStatus("Credential updated.");
    }

    prepareCredentialForm("create");
    setAppPage("credentials");
    await refreshCredentials();
  } catch (error) {
    await handleError(error);
  }
});

keyList.addEventListener("click", async (event) => {
  const button = event.target.closest(".delete-key-button");
  if (!button || !button.dataset.fingerprint) return;

  try {
    if (!(await assertActiveSession())) return;
    await request(`/account/key/${encodeURIComponent(button.dataset.fingerprint)}`, { method: "DELETE" });
    await refreshKeys();
    setStatus("Key deleted.");
  } catch (error) {
    await handleError(error);
  }
});

credentialList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  const identifier = button.dataset.identifier;
  if (!identifier) return;

  const credential = cachedCredentials.find((item) => item.identifier === identifier);

  try {
    if (button.classList.contains("copy-username-button")) {
      await copyText(credential?.username || "", "Username");
      return;
    }

    if (button.classList.contains("copy-password-button")) {
      await copyText(credential?.password || "", "Password");
      return;
    }

    if (!(await assertActiveSession())) return;

    if (button.classList.contains("edit-credential-button")) {
      if (!credential) throw new Error("Credential not found.");
      prepareCredentialForm("edit", credential);
      setAppPage("credential-form");
      return;
    }

    if (button.classList.contains("delete-credential-button")) {
      await request(`/credentials/${encodeURIComponent(identifier)}`, { method: "DELETE" });
      await refreshCredentials();
      setStatus("Credential deleted.");
    }
  } catch (error) {
    await handleError(error);
  }
});

refreshAll().catch(async (error) => {
  await loadSettings();
  setLoggedInState(false);
  setAuthMode("login");
  setStatus(error?.message || "Failed to initialize extension.", true);
});

loginForm.username.addEventListener("input", () => {
  refreshFaceUnlockState().catch(() => {});
});
