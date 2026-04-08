window.addEventListener("DOMContentLoaded", async () => {

  const video = document.getElementById("video");
  const statusText = document.getElementById("status");
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");
  const nameInput = document.getElementById("name");

  let users = [];                    // We'll load from chrome.storage
  let stream = null;
  let scanning = false;
  let matchedUser = null;
  let isRunning = true;
  let currentAccount = null;

  const MODEL_URL = "models";

  // Button events
  registerBtn.addEventListener("click", register);
  loginBtn.addEventListener("click", login);

  // Load account + users from chrome.storage
  async function loadData() {
    const data = await chrome.storage.local.get(['account', 'users']);
    currentAccount = data.account || null;
    users = data.users || [];
  }

  async function start() {
    try {
      statusText.innerText = "Loading models...";

      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
        faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
      ]);

      await loadData();   // ← Important: load before camera

      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;

      video.onloadedmetadata = () => {
        video.play();
        statusText.innerText = "Camera ready. Look at the camera.";
        autoScan();
      };

    } catch (err) {
      console.error(err);
      statusText.innerText = "Error: " + err.message;
    }
  }

  start();

  // Get face descriptor
  async function getDescriptor() {
    try {
      const detection = await faceapi.detectSingleFace(
        video,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 160 })
      ).withFaceLandmarks().withFaceDescriptor();

      return detection || null;
    } catch {
      return null;
    }
  }

  // Auto scan for login
  async function autoScan() {
    if (!isRunning) return;

    if (!scanning && users.length > 0) {
      scanning = true;

      const detection = await getDescriptor();

      if (!detection) {
        statusText.innerText = "No face detected";
        loginBtn.disabled = true;
      } else {
        const descriptor = detection.descriptor;
        let found = false;

        for (let user of users) {
          const dist = faceapi.euclideanDistance(
            new Float32Array(user.descriptor),
            descriptor
          );

          if (dist < 0.5) {
            matchedUser = user;
            found = true;
            break;
          }
        }

        if (found) {
          statusText.innerText = `Face recognized: ${matchedUser.name}`;
          loginBtn.disabled = false;
        } else {
          statusText.innerText = "Face not recognized";
          loginBtn.disabled = true;
        }
      }

      scanning = false;
    }

    requestAnimationFrame(autoScan);
  }

  // REGISTER
  async function register() {
    if (!currentAccount) {
      alert("No account found. Create account from popup first.");
      return;
    }

    statusText.innerText = "Registering face...";

    const detection = await getDescriptor();
    if (!detection) {
      statusText.innerText = "Face not detected. Try again.";
      return;
    }

    const descriptor = detection.descriptor;

    // Check if face already registered
    for (let user of users) {
      const dist = faceapi.euclideanDistance(
        new Float32Array(user.descriptor),
        descriptor
      );
      if (dist < 0.5) {
        alert("This face is already registered!");
        return;
      }
    }

    // Save with account username
    users.push({
      name: currentAccount.username,
      descriptor: Array.from(descriptor)
    });

    await chrome.storage.local.set({ users });

    statusText.innerText = "Face registered successfully! You can now login with face.";
    nameInput.value = ""; // clear input if any
  }

  // LOGIN
  async function login() {
    if (!matchedUser) {
      alert("No face matched!");
      return;
    }

    if (!currentAccount || matchedUser.name !== currentAccount.username) {
      alert("Face does not match the registered account!");
      return;
    }

    stopCamera();

    await chrome.storage.local.set({ loggedUser: matchedUser.name });

    window.location.href = chrome.runtime.getURL("HomePage.html");
  }

  // Stop camera
  function stopCamera() {
    isRunning = false;
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
    video.srcObject = null;
  }
});