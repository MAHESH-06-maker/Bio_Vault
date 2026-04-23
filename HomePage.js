// HomePage.js — Multi-User Version

// ==================== CRYPTO HELPERS ====================

async function decryptWithHash(encryptedText, masterPasswordHash, username) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(masterPasswordHash),
    { name: "PBKDF2" }, false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(username + "BioVaultSaveKeySalt"),
      iterations: 200000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const binaryString = atob(encryptedText);
  const combined = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) combined[i] = binaryString.charCodeAt(i);
  const iv         = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const decryptedBuffer = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  return new TextDecoder().decode(decryptedBuffer);
}

async function encryptWithHash(plainText, masterPasswordHash, username) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(masterPasswordHash),
    { name: "PBKDF2" }, false, ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(username + "BioVaultSaveKeySalt"),
      iterations: 200000,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(plainText)
  );
  const combined = new Uint8Array(12 + encryptedBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(encryptedBuffer), 12);
  return btoa(String.fromCharCode(...combined));
}

// ==================== MAIN LOGIC ====================

document.addEventListener("DOMContentLoaded", async () => {
  const storage = chrome.storage.local;

  // ── Session guard ────────────────────────────────────────
  const { accounts = [], loggedUser, _sessionMasterPass } = await storage.get([
    'accounts', 'loggedUser', '_sessionMasterPass'
  ]);

  if (!loggedUser) {
    window.location.href = chrome.runtime.getURL("popup.html");
    return;
  }

  const account = accounts.find(a => a.username === loggedUser);
  if (!account) {
    await storage.remove(['loggedUser', '_sessionMasterPass']);
    window.location.href = chrome.runtime.getURL("popup.html");
    return;
  }

  // Clear session master pass immediately after reading
  if (_sessionMasterPass) {
    window.currentMasterPassword = _sessionMasterPass;
    await storage.remove('_sessionMasterPass');
  }

  // ── Render username ──────────────────────────────────────
  document.getElementById('username').textContent = loggedUser;

  // ── Load this user's credentials only ───────────────────
  const { credentials = {} } = await storage.get('credentials');
  let userCreds = credentials[loggedUser] || [];

  const list = document.getElementById("credList");

  function renderTable(creds) {
    list.innerHTML = "";

    if (creds.length === 0) {
      list.innerHTML = `<p style="color:#94a3b8;font-size:13px;text-align:center;">No credentials saved yet.</p>`;
      return;
    }

    creds.forEach((cred, index) => {
      const div = document.createElement('div');
      div.className = "cred-item";
      div.innerHTML = `
        <div class="cred-top">
          <span class="cred-domain">${cred.domain}</span>
          <button class="deleteCred" data-index="${index}">Delete</button>
        </div>
        <div class="cred-user">${cred.username}</div>
        <div class="cred-bottom">
          <span class="password" data-index="${index}">••••••••</span>
          <span class="eye" data-index="${index}">👁</span>
        </div>
      `;
      list.appendChild(div);
    });
  }

  renderTable(userCreds);

  // ── Add Credential ───────────────────────────────────────
  document.getElementById('addCredBtn').onclick = async () => {
    const domain   = document.getElementById('newDomain').value.trim();
    const username = document.getElementById('newUser').value.trim();
    const password = document.getElementById('newPass').value.trim();

    if (!domain || !username || !password) return alert("All fields required");

    try {
      const { credentials: currentCreds = {} } = await storage.get('credentials');
      if (!currentCreds[loggedUser]) currentCreds[loggedUser] = [];

      const encryptedPassword = await encryptWithHash(
        password,
        account.masterPasswordHash,
        loggedUser
      );

      currentCreds[loggedUser].push({ domain, username, password: encryptedPassword });
      await storage.set({ credentials: currentCreds });

      userCreds = currentCreds[loggedUser];
      renderTable(userCreds);

      document.getElementById('newDomain').value = '';
      document.getElementById('newUser').value   = '';
      document.getElementById('newPass').value   = '';
      alert("Credential Added Securely!");
    } catch (err) {
      console.error("Encryption error:", err);
      alert("Failed to save credential.");
    }
  };

  // ── Eye reveal + Delete ──────────────────────────────────
  list.addEventListener('click', async (e) => {

    // Reveal password
    if (e.target.classList.contains('eye')) {
      const index    = parseInt(e.target.dataset.index);
      const passSpan = document.querySelector(`.password[data-index="${index}"]`);
      const { credentials: currentCreds = {} } = await storage.get('credentials');

      if (passSpan.textContent === "••••••••") {
        try {
          const plainPass = await decryptWithHash(
            currentCreds[loggedUser][index].password,
            account.masterPasswordHash,
            loggedUser
          );
          passSpan.textContent = plainPass;
        } catch (err) {
          console.error("Decryption error:", err);
          passSpan.textContent = "[Decryption Failed]";
        }
      } else {
        passSpan.textContent = "••••••••";
      }
    }

    // Delete credential
    if (e.target.classList.contains('deleteCred')) {
      const index = parseInt(e.target.dataset.index);
      if (!confirm("Delete this credential?")) return;

      const { credentials: currentCreds = {} } = await storage.get('credentials');
      currentCreds[loggedUser].splice(index, 1);
      await storage.set({ credentials: currentCreds });

      userCreds = currentCreds[loggedUser];
      renderTable(userCreds);
    }
  });

  // ── Logout ───────────────────────────────────────────────
  document.getElementById('logoutBtn').onclick = async () => {
    window.currentMasterPassword = null;
    await storage.remove(['loggedUser', '_sessionMasterPass']);
    window.location.href = chrome.runtime.getURL("popup.html");
  };

  // ── Delete dropdown ──────────────────────────────────────
  const deleteDropdown = document.getElementById('deleteDropdown');

  deleteDropdown.addEventListener('change', async () => {
    const choice = deleteDropdown.value;

    if (choice === 'face') {
      if (confirm("Delete face data for your account only?")) {
        const { users = [] } = await chrome.storage.local.get('users');
        const updatedUsers = users.filter(u => u.name !== loggedUser);
        await chrome.storage.local.set({ users: updatedUsers });
        alert("Face data deleted!");
        deleteDropdown.value = "";
        window.location.reload();
      }

    } else if (choice === 'account') {
      if (confirm("Permanently delete your account and all saved credentials?")) {
        const {
          accounts: accs = [],
          credentials: creds = {},
          users: us = []
        } = await chrome.storage.local.get(['accounts', 'credentials', 'users']);

        const updatedAccounts = accs.filter(a => a.username !== loggedUser);
        delete creds[loggedUser];
        const updatedUsers = us.filter(u => u.name !== loggedUser);

        await chrome.storage.local.set({
          accounts:    updatedAccounts,
          credentials: creds,
          users:       updatedUsers
        });
        await chrome.storage.local.remove(['loggedUser', '_sessionMasterPass']);

        alert("Account deleted!");
        window.location.href = chrome.runtime.getURL("popup.html");
      }
    }

    deleteDropdown.value = "";
  });
});