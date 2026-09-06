import { auth } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
  if (user) window.location.href = "index.html";
});

const form = document.getElementById("form-login");
const erro = document.getElementById("erro-login");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  erro.hidden = true;
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;

  try {
    await signInWithEmailAndPassword(auth, email, senha);
    window.location.href = "index.html";
  } catch (e) {
    erro.textContent = "E-mail ou senha inválidos.";
    erro.hidden = false;
  }
});
