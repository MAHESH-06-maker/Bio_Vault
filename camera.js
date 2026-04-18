// camera.js — Multi-User Version

window.addEventListener("DOMContentLoaded", async () => {

  const video       = document.getElementById("video");
  const statusText  = document.getElementById("status");
  const loginBtn    = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");

  let users          = [];
  let stream         = null;
  let scanning       = false;
  let matchedUser    = null;
  let isRunning      = true;
  let currentAccount = null;   // account of loggedUser (for registration mode)

  const MODEL_URL = "models";

  registerBtn.addEventListener("click", register);
  loginBtn.addEventListener("click", login);

  // ── Load storage state ────────────────────────────────────
  // If loggedUser is set → Registration mode (user came from "Set Up Face Lock")
  // If loggedUser is NOT set → Login mode (user came from "Login with Face")
  async function loadData() {
    const data = await chrome.storage.local.get(['accounts', 'users', 'loggedUser']);
    const accounts   = data.accounts   || [];
    const loggedUser = data.loggedUser || null;
    users = data.users || [];

    currentAccount = loggedUser
      ? (accounts.find(a => a.username === loggedUser) || null)
      : null;
  }

  // ── Start ─────────────────────────────────────────────────
  async function start() {
    try {
      statusText.innerText = "Loading models...";

      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);

      await loadData();

      // Update UI hint based on mode
      if (currentAccount) {
        statusText.innerText = `Register mode: ${currentAccount.username}. Position your face.`;
      } else {
        statusText.innerText = "Login mode. Look at the camera.";
      }

      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;

      video.onloadedmetadata = () => {
        video.play();
        autoScan();
      };

    } catch (err) {
      console.error(err);
      statusText.innerText = "Error: " + err.message;
    }
  }

  start();

  // ── Get descriptor ────────────────────────────────────────
  async function getDescriptor() {
    try {
      const det = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 }))
        .withFaceLandmarks()
        .withFaceDescriptor();
      return det || null;
    } catch {
      return null;
    }
  }

  // ── Auto-scan (login matching) ────────────────────────────
  async function autoScan() {
    if (!isRunning) return;

    if (!scanning && users.length > 0) {
      scanning = true;
      const det = await getDescriptor();

      if (!det) {
        statusText.innerText = currentAccount
          ? `Register mode: ${currentAccount.username} — No face detected`
          : "No face detected";
        loginBtn.disabled = true;
      } else {
        let found = false;
        for (const user of users) {
          const dist = faceapi.euclideanDistance(new Float32Array(user.descriptor), det.descriptor);
          if (dist < 0.5) { matchedUser = user; found = true; break; }
        }

        if (found) {
          statusText.innerText = `✅ Face recognised: ${matchedUser.name}`;
          loginBtn.disabled = false;
        } else {
          statusText.innerText = "Face not recognised";
          loginBtn.disabled = true;
          matchedUser = null;
        }
      }
      scanning = false;
    }

    requestAnimationFrame(autoScan);
  }

  // ── REGISTER ─────────────────────────────────────────────
  // Username comes ONLY from currentAccount (loggedUser in storage).
  // Name input is hidden — never read from it.
  async function register() {
    await loadData();

    if (!currentAccount) {
      alert("You must be logged in to register a face.\nPlease log in first, then open Face Setup.");
      return;
    }

    statusText.innerText = "Scanning face for registration...";

    const det = await getDescriptor();
    if (!det) {
      statusText.innerText = "No face detected. Try again.";
      return;
    }

    const descriptor = det.descriptor;

    // 1:1 — user already has a face registered
    if (users.find(u => u.name === currentAccount.username)) {
      alert(`A face is already registered for "${currentAccount.username}".\nDelete it first from the vault settings.`);
      statusText.innerText = "Already registered.";
      return;
    }

    // 1:1 — this face already belongs to another account
    for (const user of users) {
      const dist = faceapi.euclideanDistance(new Float32Array(user.descriptor), descriptor);
      if (dist < 0.5) {
        alert("This face is already linked to another account!");
        statusText.innerText = "Duplicate face rejected.";
        return;
      }
    }

    users.push({ name: currentAccount.username, descriptor: Array.from(descriptor) });
    await chrome.storage.local.set({ users });

    statusText.innerText = `✅ Face registered for: ${currentAccount.username}`;
    alert(`Face registered for "${currentAccount.username}"!\nYou can now use Face Login.`);
  }

  // ── LOGIN ─────────────────────────────────────────────────
  // matchedUser.name IS the username — no input required.
  async function login() {
    if (!matchedUser) {
      alert("No face matched. Please position your face clearly.");
      return;
    }

    const { accounts = [] } = await chrome.storage.local.get('accounts');
    const account = accounts.find(a => a.username === matchedUser.name);

    if (!account) {
      alert("No account found for this face. Please register an account first.");
      return;
    }

    stopCamera();

    // Set session — no _sessionMasterPass for face login (HomePage uses masterPasswordHash)
    await chrome.storage.local.set({ loggedUser: matchedUser.name });

    window.location.href = chrome.runtime.getURL("HomePage.html");
  }

  // ── Stop camera ───────────────────────────────────────────
  function stopCamera() {
    isRunning = false;
    if (stream) stream.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
});