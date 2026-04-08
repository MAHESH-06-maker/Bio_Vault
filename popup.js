document.addEventListener("DOMContentLoaded", async () => {
  const storage = chrome.storage.local;

  // Elements
  const mainScreen = document.getElementById('mainScreen');
  const saveScreen = document.getElementById('saveScreen');
  const accessScreen = document.getElementById('accessScreen');
  const registerScreen = document.getElementById('registerScreen');

  const showScreen = (screen) => {
    document.querySelectorAll('.section, #mainScreen').forEach(s => s.classList.add('hidden'));
    screen.classList.remove('hidden');
  };

  // Check if account exists
  const data = await storage.get(['account']);
  const hasAccount = !!data.account;

  if (!hasAccount) {
    showScreen(registerScreen);
  } else {
    showScreen(mainScreen);
  }

  // === Navigation ===
  document.getElementById('savePasswordBtn').onclick = () => showScreen(saveScreen);
  document.getElementById('accessPasswordBtn').onclick = () => showScreen(accessScreen);
  document.getElementById('backToMainFromSave').onclick = () => showScreen(mainScreen);
  document.getElementById('backToMainFromAccess').onclick = () => showScreen(mainScreen);
  document.getElementById('backToMainFromAccount').onclick = () => showScreen(mainScreen);


  // === Save Credential ===
  document.getElementById('saveCredentialBtn').onclick = async () => {
    const domain = document.getElementById('domain').value.trim();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();

    if (!domain || !username || !password) return alert("All fields required!");

    const { credentials = [] } = await storage.get('credentials');
    credentials.push({ domain, username, password });

    await storage.set({ credentials });
    alert("Credential Saved!");
    showScreen(mainScreen);
  };

  // === Master Password Login ===
  document.getElementById('masterLoginBtn').onclick = () => {
    document.getElementById('masterLoginForm').classList.toggle('hidden');
  };

  document.getElementById('submitMasterPassword').onclick = async () => {
    const inputPass = document.getElementById('masterPassword').value;
    const { account } = await storage.get('account');

    if (inputPass === account.masterPassword) {   // In production, use proper hashing
      chrome.tabs.create({ url: chrome.runtime.getURL("HomePage.html") });
    } else {
      alert("Incorrect Master Password!");
    }
  };

  // === Face Lock ===
  document.getElementById('faceLockBtn').onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("camera.html") });
  };

  // === Register Account ===
  document.getElementById('createAccountBtn').onclick = async () => {
    const username = document.getElementById('regUsername').value.trim();
    const pass = document.getElementById('regMasterPassword').value;
    const confirm = document.getElementById('regConfirmPassword').value;

    if (!username || !pass || pass !== confirm) {
      return alert("Please fill correctly!");
    }

    await storage.set({
      account: {
        username,
        masterPassword: pass,        // TODO: Hash this in production
      },
      users: [],
      credentials: []
    });

    alert("Account Created Successfully!");
    showScreen(mainScreen);
  };

  document.getElementById('registerFaceBtn').onclick = () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("camera.html") });
  };

  // Register New User Link (using <a> tag)
  document.getElementById('registerLink').addEventListener('click', (e) => {
    e.preventDefault();        // Prevent default link behavior
    showScreen(registerScreen);
  });
});