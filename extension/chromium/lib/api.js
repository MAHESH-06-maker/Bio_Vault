import { getSession, getSettings } from "./storage.js";

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function formatValidationIssue(issue) {
  if (!issue || typeof issue !== "object") {
    return null;
  }

  const location = Array.isArray(issue.loc) ? issue.loc.join(".") : "";
  const message = typeof issue.msg === "string" ? issue.msg : "";
  if (!location && !message) {
    return null;
  }
  return location ? `${location}: ${message}` : message;
}

function extractErrorMessage(payload, status) {
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }

  if (Array.isArray(payload)) {
    const issues = payload
      .map(formatValidationIssue)
      .filter(Boolean);
    if (issues.length) {
      return issues.join("; ");
    }
  }

  if (typeof payload === "object" && payload !== null) {
    if (typeof payload.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }

    if (Array.isArray(payload.detail)) {
      const issues = payload.detail
        .map(formatValidationIssue)
        .filter(Boolean);
      if (issues.length) {
        return issues.join("; ");
      }
    }

    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
  }

  return `Request failed with status ${status}`;
}

async function buildUrl(path) {
  const settings = await getSettings();
  const baseUrl = trimTrailingSlash(settings.apiBaseUrl || "");
  if (!baseUrl) {
    throw new Error("Set the API base URL in the extension options first.");
  }
  return `${baseUrl}${path}`;
}

export async function request(path, { method = "GET", body, auth = true, headers: extraHeaders = {} } = {}) {
  const session = await getSession();
  const headers = { ...extraHeaders };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (auth) {
    if (!session.accessToken) {
      throw new Error("Login first.");
    }
    headers.Authorization = `Bearer ${session.accessToken}`;
  }

  const response = await fetch(await buildUrl(path), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message = extractErrorMessage(payload, response.status);
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}
