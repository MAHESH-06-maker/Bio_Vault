// popup.js — Login-Gated Multi-User Version

// ==================== CRYPTO HELPERS ====================

async function hashMasterPassword(masterPassword, username) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(masterPassword), { name: "PBKDF2" }, false, ["deriveBits"]
  );
  const hashBuffer = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: encoder.encode(username + "BioVaultMasterHashSalt"), iterations: 800000, hash: "SHA-256" },
    keyMaterial, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
}

async function encryptWithHash(plainText, masterPasswordHash, username) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(masterPasswordHash), { name: "PBKDF2" }, false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: encoder.encode(username + "BioVaultSaveKeySalt"), iterations: 200000, hash: "SHA-256" },
    keyMaterial, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoder.encode(plainText));
  const out = new Uint8Array(12 + enc.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...out));
}

// ==================== MAIN LOGIC ====================

document.addEventListener("DOMContentLoaded", async () => {
  const storage = chrome.storage.local;

  // ── Screen references ────────────────────────────────────
  const loginScreen    = document.getElementById('loginScreen');
  const mainScreen     = document.getElementById('mainScreen');
  const saveScreen     = document.getElementById('saveScreen');
  const accessScreen   = document.getElementById('accessScreen');
  const registerScreen = document.getElementById('registerScreen');

  const allScreens = [loginScreen, mainScreen, saveScreen, accessScreen, registerScreen];

  const showScreen = (screen) => {
    allScreens.forEach(s => s.classList.add('hidden'));
    screen.classList.remove('hidden');
  };

  // ── Initial routing ──────────────────────────────────────
  // Rules:
  //   No accounts at all            → Register screen
  //   Has accounts, not logged in   → Login screen
  //   Already logged in (session)   → Main screen directly
  const { accounts = [], loggedUser } = await storage.get(['accounts', 'loggedUser']);

  if (accounts.length === 0) {
    showScreen(registerScreen);
  } else if (loggedUser && accounts.find(a => a.username === loggedUser)) {
    // Active session — go straight to main
    document.getElementById('loggedInBadge').textContent = loggedUser;
    showScreen(mainScreen);
  } else {
    // Has accounts but no active session → login
    showScreen(loginScreen);
  }

  // ── Navigation helpers ───────────────────────────────────
  document.getElementById('backToMainFromSave').onclick   = () => showScreen(mainScreen);
  document.getElementById('backToMainFromAccess').onclick = () => showScreen(mainScreen);
  document.getElementById('backToLoginFromRegister').onclick = () => showScreen(loginScreen);

  document.getElementById('registerLink').addEventListener('click', (e) => {
    e.preventDefault();
    showScreen(registerScreen);
  });

  // ── Main screen buttons ──────────────────────────────────
  document.getElementById('savePasswordBtn').onclick   = () => showScreen(saveScreen);
  document.getElementById('accessPasswordBtn').onclick = () => showScreen(accessScreen);

  // ── LOGIN with username + master password ────────────────
  document.getElementById('loginSubmitBtn').onclick = async () => {
    const username  = document.getElementById('loginUsername').value.trim();
    const inputPass = document.getElementById('loginPassword').value;

    if (!username || !inputPass) return alert("Enter both username and password.");

    const { accounts: accs = [] } = await storage.get('accounts');
    const account = accs.find(a => a.username === username);
    if (!account) return alert("No account found for that username.");

    const inputHash = await hashMasterPassword(inputPass, account.username);
    if (inputHash !== account.masterPasswordHash) return alert("Incorrect password.");

    // Set session
    await storage.set({ loggedUser: account.username, _sessionMasterPass: inputPass });

    document.getElementById('loggedInBadge').textContent = account.username;
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    showScreen(mainScreen);
  };

  // ── FACE LOGIN (from login screen) ──────────────────────
  document.getElementById('loginFaceBtn').onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("camera.html") });
  };

  // ── LOGOUT ───────────────────────────────────────────────
  document.getElementById('logoutBtnPopup').onclick = async () => {
    await storage.remove(['loggedUser', '_sessionMasterPass']);
    document.getElementById('loginUsername').value = '';
    document.getElementById('loginPassword').value = '';
    showScreen(loginScreen);
  };

  // ── SAVE CREDENTIAL (no username prompt — uses loggedUser) ──
  document.getElementById('saveCredentialBtn').onclick = async () => {
    const domain       = document.getElementById('domain').value.trim();
    const siteUsername = document.getElementById('siteUsername').value.trim();
    const password     = document.getElementById('password').value.trim();

    if (!domain || !siteUsername || !password) return alert("All fields required!");

    const { loggedUser: activeUser, accounts: accs = [] } = await storage.get(['loggedUser', 'accounts']);
    if (!activeUser) {
      // Shouldn't happen — but guard anyway
      alert("Session expired. Please log in again.");
      return showScreen(loginScreen);
    }

    const account = accs.find(a => a.username === activeUser);
    if (!account) {
      await storage.remove(['loggedUser', '_sessionMasterPass']);
      alert("Account error. Please log in again.");
      return showScreen(loginScreen);
    }

    try {
      const { credentials = {} } = await storage.get('credentials');
      if (!credentials[activeUser]) credentials[activeUser] = [];

      const encryptedPassword = await encryptWithHash(password, account.masterPasswordHash, activeUser);
      credentials[activeUser].push({ domain, username: siteUsername, password: encryptedPassword });
      await storage.set({ credentials });

      alert("Credential Saved Securely!");
      document.getElementById('domain').value       = '';
      document.getElementById('siteUsername').value = '';
      document.getElementById('password').value     = '';
      showScreen(mainScreen);
    } catch (err) {
      alert("Encryption failed. Please try again.");
      console.error("Encryption error:", err);
    }
  };

  // ── OPEN VAULT — re-verify master password ───────────────
  // Username is already known from loggedUser — no need to ask again.
  document.getElementById('submitMasterPassword').onclick = async () => {
    const inputPass = document.getElementById('masterPassword').value;

    const { loggedUser: activeUser, accounts: accs = [] } = await storage.get(['loggedUser', 'accounts']);
    if (!activeUser) {
      alert("Session expired. Please log in again.");
      return showScreen(loginScreen);
    }

    const account = accs.find(a => a.username === activeUser);
    if (!account) {
      alert("Account error. Please log in again.");
      return showScreen(loginScreen);
    }

    const inputHash = await hashMasterPassword(inputPass, account.username);
    if (inputHash !== account.masterPasswordHash) return alert("Incorrect Master Password!");

    // Store session pass so HomePage can decrypt
    await storage.set({ _sessionMasterPass: inputPass });
    chrome.tabs.create({ url: chrome.runtime.getURL("HomePage.html") });
  };

  // ── FACE LOCK for vault access (from access screen) ─────
  document.getElementById('faceLockBtn').onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("camera.html") });
  };

  // ── REGISTER new account ─────────────────────────────────
  document.getElementById('createAccountBtn').onclick = async () => {
    const username = document.getElementById('regUsername').value.trim();
    const pass     = document.getElementById('regMasterPassword').value;
    const confirm  = document.getElementById('regConfirmPassword').value;

    if (!username || !pass) return alert("Fill in all fields.");
    if (pass !== confirm)   return alert("Passwords do not match!");

    const { accounts: accs = [] } = await storage.get('accounts');
    if (accs.find(a => a.username === username)) {
      return alert("Username already taken. Choose another.");
    }

    const masterHash = await hashMasterPassword(pass, username);
    accs.push({ username, masterPasswordHash: masterHash });

    const { credentials = {} } = await storage.get('credentials');
    credentials[username] = [];

    await storage.set({ accounts: accs, credentials });

    alert("Account created! You can now log in.");

    // Clear register fields
    document.getElementById('regUsername').value        = '';
    document.getElementById('regMasterPassword').value  = '';
    document.getElementById('regConfirmPassword').value = '';

    showScreen(loginScreen);
  };

  // ── REGISTER FACE (opens camera; loggedUser must be set) ─
  document.getElementById('registerFaceBtn').onclick = async () => {
    const { loggedUser: activeUser } = await storage.get('loggedUser');
    if (!activeUser) {
      return alert("Please log in first before registering your face.");
    }
    chrome.tabs.create({ url: chrome.runtime.getURL("camera.html") });
  };

  // ── Toggle password visibility (shared handler) ──────────
  document.querySelectorAll('.toggle-password').forEach(btn => {
    btn.addEventListener('click', function () {
      const input = document.getElementById(this.getAttribute('data-target'));
      const isPass = input.type === 'password';
      input.type = isPass ? 'text' : 'password';
      this.innerHTML = isPass
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
        : `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    });
  });
});