window.addEventListener("DOMContentLoaded", () => {

  const video = document.getElementById("video");
  const statusText = document.getElementById("status");
  const loginBtn = document.getElementById("loginBtn");
  const registerBtn = document.getElementById("registerBtn");

  let users = JSON.parse(localStorage.getItem("users")) || [];
  let stream = null;
  let scanning = false;
  let matchedUser = null;
  let isRunning = true;

  const MODEL_URL = "models";
  // 🔘 BUTTON EVENTS (CSP SAFE)
  registerBtn.addEventListener("click", register);
  loginBtn.addEventListener("click", login);

  async function start() {
    try {
      statusText.innerText = "Loading models...";

await Promise.all([
  faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
  faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
  faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL)
]);

      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      video.srcObject = stream;

      video.onloadedmetadata = () => {
        video.play();
        statusText.innerText = "Camera Started";
        autoScan();
      };

    } catch (err) {
      console.error(err);
      statusText.innerText = "Error starting";
    }
  }

  start();

  // 🎯 GET FACE
  async function getDescriptor() {
    try {
      return await faceapi.detectSingleFace(
        video,
        new faceapi.TinyFaceDetectorOptions({ inputSize: 160 })
      ).withFaceLandmarks().withFaceDescriptor();
    } catch {
      return null;
    }
  }

  // 🔁 AUTO SCAN
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

  // 🔹 REGISTER
  async function register() {
    const name = document.getElementById("name").value.trim();
    if (!name) return alert("Enter name");

    statusText.innerText = "Registering...";

    const detection = await getDescriptor();
    if (!detection) {
      statusText.innerText = "Face not detected";
      return;
    }

    const descriptor = detection.descriptor;

    for (let user of users) {
      const dist = faceapi.euclideanDistance(
        new Float32Array(user.descriptor),
        descriptor
      );

      if (dist < 0.5) {
        alert("User already exists!");
        return;
      }
    }

    users.push({
      name,
      descriptor: Array.from(descriptor)
    });

    localStorage.setItem("users", JSON.stringify(users));

    statusText.innerText = "Registered! Look at camera to login";
  }

  // 🔹 LOGIN
  function login() {
    if (!matchedUser) {
      alert("No face matched!");
      return;
    }

    stopCamera();

    localStorage.setItem("loggedUser", matchedUser.name);

    window.location.href = chrome.runtime.getURL("HomePage.html");
  }

  // 🛑 STOP CAMERA
  function stopCamera() {
    isRunning = false;

    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }

    video.srcObject = null;
  }

});