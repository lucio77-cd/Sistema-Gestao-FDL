import { db } from "./firebase-config.js";
import { protegerPagina, sair } from "./auth-guard.js";
import { mostrarToast } from "./toast.js";
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

  try {
    await updateDoc(doc(db, "estabelecimentos", estabelecimentoAtual.id), {
      nome,
      diasAlertaPadrao,
    });
    document.getElementById("nome-estabelecimento").textContent = nome;
    mostrarToast("Configurações salvas.", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível salvar. Tente novamente.", "erro");
  }
});

// Ação irreversível: o link antigo para de funcionar assim que este é salvo.
// Se a gerente estiver com o link antigo aberto/salvo, ele quebra sem aviso —
// por isso a confirmação explícita antes de seguir.
document.getElementById("btn-gerar-novo-link").addEventListener("click", async () => {
  const confirmar = window.confirm(
    "Isso invalida o link atual imediatamente. Se a gerente já tiver o link salvo, ele vai parar de funcionar. Continuar?"
  );
  if (!confirmar) return;

  try {
    const novoToken = gerarToken();
    await updateDoc(doc(db, "estabelecimentos", estabelecimentoAtual.id), { linkToken: novoToken });
    document.getElementById("link-gerente").textContent = montarLinkGerente(novoToken);
    mostrarToast("Novo link gerado. O anterior não funciona mais.", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível gerar um novo link. Tente novamente.", "erro");
  }
});
