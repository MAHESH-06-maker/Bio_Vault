document.addEventListener("DOMContentLoaded", () => {
  const startBtn = document.getElementById("startBtn");

  startBtn.addEventListener("click", () => {
    chrome.tabs.create({
      url: chrome.runtime.getURL("camera.html")
    });
  });
});