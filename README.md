# Bio Vault

**Bio Vault** is a Chrome extension password manager that protects saved credentials using a **master password and optional face recognition**.

All data is stored locally using Chrome's `chrome.storage.local` — no external backend is required.

## Features

* Multi-user account support
* Master password authentication
* PBKDF2 + SHA-256 password hashing
* AES-GCM credential encryption
* Add, view, reveal, and delete credentials
* Optional face registration and face login
* Local face recognition using `face-api.js`
* Delete face data or entire account
* No external backend

## Project Structure

```text
Bio_Vault/
├── manifest.json
├── popup.html
├── popup.js
├── HomePage.html
├── HomePage.js
├── camera.html
├── camera.js
├── face-api.min.js
├── models/
└── README.md
```

## How It Works

1. Create an account with a username and master password.
2. The master password is hashed using PBKDF2 with SHA-256.
3. Encryption keys are derived from the password hash.
4. Credentials are encrypted using AES-GCM.
5. Encrypted credentials are stored in `chrome.storage.local`.
6. Users can optionally register their face for biometric authentication.
7. Face recognition is performed locally using `face-api.js`.

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/MAHESH-06-maker/Bio_Vault.git
```

### 2. Load the Extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the cloned `Bio_Vault` folder.
6. Open Bio Vault from the Chrome toolbar.

## Usage

### Create an Account

Register using a username and master password.

### Enable Face Lock

Open the face registration page and register your face using the camera.

### Login

You can log in using:

* Master password
* Face recognition

### Manage Credentials

From the vault, you can:

* Add credentials
* View saved credentials
* Reveal passwords
* Delete credentials

### Manage Account

You can delete:

* Registered face data
* The complete account and its credentials

## Security

Bio Vault uses:

* **PBKDF2 + SHA-256** for password hashing
* **PBKDF2** for encryption key derivation
* **AES-GCM** for credential encryption
* **Local browser storage** for account and credential data
* **Local face recognition** using `face-api.js`

> **Note:** Bio Vault is a learning/project implementation and should not be considered a replacement for professionally audited password managers.

## Development

Bio Vault does not require a build process. It uses plain **HTML, CSS, and JavaScript**.

For local testing:

```bash
python -m http.server 8000
```

Camera features should be tested through the Chrome extension or a `localhost`/HTTPS environment.

## Troubleshooting

### Face Models Not Loading

* Make sure the `models/` directory exists.
* Verify that all required model files are present.
* Large model files may take some time to load.

### Camera Access Not Working

* Allow camera permission for the extension.
* When testing outside the extension, use `localhost` or HTTPS.

## Acknowledgements

This project uses [face-api.js](https://github.com/justadudewhohacks/face-api.js) for face detection and recognition.

## License

No license has currently been specified for this project.
