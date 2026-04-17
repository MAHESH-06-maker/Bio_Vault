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
  // === Toggle Password Visibility ===
  document.querySelectorAll('.toggle-password').forEach(button => {
    button.addEventListener('click', function() {
      const targetId = this.getAttribute('data-target');
      const input = document.getElementById(targetId);
      
      if (input.type === 'password') {
        input.type = 'text';
        this.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
      } else {
        input.type = 'password';
        this.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
      }
    });
  });
});