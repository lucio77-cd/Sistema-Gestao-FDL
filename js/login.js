import { auth } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const PAGINAS_PERMITIDAS = new Set([
  "index.html", "vistoria.html", "estoque.html", "promocoes.html",
  "produtos.html", "caixa.html", "configuracoes.html", "gerente.html", "graficos.html",
  "cozinha.html",
]);

function obterDestino() {
  const solicitado = new URLSearchParams(window.location.search).get("returnTo");
  if (!solicitado) return "index.html";
  try {
    const url = new URL(solicitado, window.location.origin);
    const pagina = url.pathname.split("/").pop();
    if (url.origin !== window.location.origin || !PAGINAS_PERMITIDAS.has(pagina)) return "index.html";
    return pagina + url.search;
  } catch {
    return "index.html";
  }
}

const destino = obterDestino();
onAuthStateChanged(auth, (user) => {
  if (user) window.location.replace(destino);
});

const form = document.getElementById("form-login");
const erro = document.getElementById("erro-login");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  erro.hidden = true;
  const botao = form.querySelector('button[type="submit"]');
  const email = document.getElementById("email").value.trim();
  const senha = document.getElementById("senha").value;

  botao.disabled = true;
  const textoOriginal = botao.textContent;
  botao.textContent = "Entrando…";

  try {
    await signInWithEmailAndPassword(auth, email, senha);
    window.location.replace(destino);
  } catch (e) {
    erro.textContent = "E-mail ou senha inválidos.";
    erro.hidden = false;
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
});
