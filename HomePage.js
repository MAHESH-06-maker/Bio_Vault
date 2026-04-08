document.addEventListener("DOMContentLoaded", async () => {
  const storage = chrome.storage.local;
  const { account, credentials = [], loggedUser } = await storage.get(['account', 'credentials', 'loggedUser']);

  document.getElementById('username').textContent = account?.username || loggedUser;

  const tbody = document.querySelector("#credTable tbody");

  function renderTable(creds) {
    tbody.innerHTML = "";
    creds.forEach((cred, index) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${cred.domain}</td>
        <td>${cred.username}</td>
        <td>
          <span class="password" data-index="${index}">••••••••</span>
          <span class="eye" data-index="${index}">👁</span>
        </td>
        <td><button data-index="${index}" class="deleteCred">Delete</button></td>
      `;
      tbody.appendChild(tr);
    });
  }

  renderTable(credentials);

  // Add Credential
  document.getElementById('addCredBtn').onclick = async () => {
    const domain = document.getElementById('newDomain').value.trim();
    const username = document.getElementById('newUser').value.trim();
    const password = document.getElementById('newPass').value.trim();

    if (!domain || !username || !password) return alert("All fields required");

    const { credentials = [] } = await storage.get('credentials');
    credentials.push({ domain, username, password });
    await storage.set({ credentials });
    renderTable(credentials);
    alert("Credential Added!");
  };

  // Toggle Password
  tbody.addEventListener('click', async (e) => {
    if (e.target.classList.contains('eye')) {
      const index = parseInt(e.target.dataset.index);
      const { credentials } = await storage.get('credentials');
      const passSpan = document.querySelector(`.password[data-index="${index}"]`);

      if (passSpan.textContent === "••••••••") {
        passSpan.textContent = credentials[index].password;
      } else {
        passSpan.textContent = "••••••••";
      }
    }

    if (e.target.classList.contains('deleteCred')) {
      const index = parseInt(e.target.dataset.index);
      const { credentials } = await storage.get('credentials');
      credentials.splice(index, 1);
      await storage.set({ credentials });
      renderTable(credentials);
    }
  });

  // Logout
  document.getElementById('logoutBtn').onclick = () => {
    chrome.storage.local.remove('loggedUser');
    window.location.href = chrome.runtime.getURL("camera.html");
  };

  // Delete User (Keep your existing logic or enhance)
  // Simple Dropdown Delete
const deleteDropdown = document.getElementById('deleteDropdown');

deleteDropdown.addEventListener('change', async () => {
  const choice = deleteDropdown.value;

  if (choice === 'face') {
    if (confirm("Delete face data only? Account and passwords will stay safe.")) {
      await chrome.storage.local.remove('users');
      alert("Face data deleted successfully!");
      deleteDropdown.value = ""; // reset dropdown
      window.location.reload();
    }
  } 
  else if (choice === 'account') {
    if (confirm("⚠️ Delete entire account and ALL data permanently?")) {
      await chrome.storage.local.clear();
      alert("Entire account deleted!");
      window.location.href = chrome.runtime.getURL("popup.html");
    }
  }

  // Reset dropdown after action
  deleteDropdown.value = "";
});
});