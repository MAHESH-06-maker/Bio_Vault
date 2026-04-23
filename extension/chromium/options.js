import { DEFAULT_SETTINGS, getSettings, saveSettings } from "./lib/storage.js";

const form = document.querySelector("#settings-form");
const resetButton = document.querySelector("#reset-button");
const statusLine = document.querySelector("#status");

function setStatus(message) {
  statusLine.textContent = message;
}

async function populateForm() {
  const settings = await getSettings();
  form.apiBaseUrl.value = settings.apiBaseUrl;
  form.username.value = settings.username;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await saveSettings({
    apiBaseUrl: form.apiBaseUrl.value.trim(),
    username: form.username.value.trim(),
  });

  setStatus("Settings saved.");
});

resetButton.addEventListener("click", async () => {
  await saveSettings(DEFAULT_SETTINGS);
  await populateForm();
  setStatus("Settings reset to defaults.");
});

populateForm().catch((error) => {
  setStatus(error.message);
});
