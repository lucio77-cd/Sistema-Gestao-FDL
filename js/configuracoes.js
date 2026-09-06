import { db } from "./firebase-config.js";
import { protegerPagina, sair } from "./auth-guard.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.getElementById("link-sair").addEventListener("click", (e) => {
  e.preventDefault();
  sair();
});

function gerarToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function montarLinkGerente(token) {
  const base = window.location.href.replace(/configuracoes\.html.*$/, "gerente.html");
  return `${base}?token=${token}`;
}

let estabelecimentoAtual = null;

protegerPagina(({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  document.getElementById("nome-input").value = estabelecimento.nome;
  document.getElementById("dias-alerta-input").value = estabelecimento.diasAlertaPadrao ?? 3;
  document.getElementById("link-gerente").textContent = montarLinkGerente(estabelecimento.linkToken);
});

document.getElementById("btn-salvar-config").addEventListener("click", async () => {
  const nome = document.getElementById("nome-input").value.trim();
  const diasAlertaPadrao = Number(document.getElementById("dias-alerta-input").value);

  await updateDoc(doc(db, "estabelecimentos", estabelecimentoAtual.id), {
    nome,
    diasAlertaPadrao,
  });

  const msg = document.getElementById("msg-config");
  msg.textContent = "Configurações salvas.";
  msg.hidden = false;
});

document.getElementById("btn-gerar-novo-link").addEventListener("click", async () => {
  const novoToken = gerarToken();
  await updateDoc(doc(db, "estabelecimentos", estabelecimentoAtual.id), { linkToken: novoToken });
  document.getElementById("link-gerente").textContent = montarLinkGerente(novoToken);
});
