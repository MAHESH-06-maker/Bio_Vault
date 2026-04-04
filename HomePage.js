window.addEventListener("DOMContentLoaded", () => {

  const username = localStorage.getItem("loggedUser");
  const usernameText = document.getElementById("username");
  const deleteBtn = document.getElementById("deleteBtn");
  const logoutBtn = document.getElementById("logoutBtn");

  usernameText.innerText = username || "Unknown User";

  deleteBtn.addEventListener("click", deleteUser);
  logoutBtn.addEventListener("click", logout);

  function logout() {
    localStorage.removeItem("loggedUser");
    window.location.href = chrome.runtime.getURL("camera.html");
  }

  function deleteUser() {
    let users = JSON.parse(localStorage.getItem("users")) || [];
    const nameToDelete = document.getElementById("deleteName").value.trim();

    if (!nameToDelete) {
      alert("Enter a name first");
      return;
    }

    const updatedUsers = users.filter(u => u.name !== nameToDelete);

    if (users.length === updatedUsers.length) {
      alert("User not found");
      return;
    }

    localStorage.setItem("users", JSON.stringify(updatedUsers));

    if (nameToDelete === username) {
      localStorage.removeItem("loggedUser");
      alert("Your account deleted");
      window.location.href = chrome.runtime.getURL("camera.html");
    } else {
      alert("User deleted successfully");
    }
  }

});