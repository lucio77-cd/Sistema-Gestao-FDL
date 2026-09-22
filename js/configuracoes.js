import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { mostrarToast } from "./toast.js";
import { confirmarAcao } from "./modal.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

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
  document.getElementById("toggle-caixa").checked = !!estabelecimento.baixaAutomaticaAtiva;
});

document.getElementById("toggle-caixa").addEventListener("change", async (e) => {
  try {
    await updateDoc(doc(db, "estabelecimentos", estabelecimentoAtual.id), {
      baixaAutomaticaAtiva: e.target.checked,
    });
    mostrarToast(e.target.checked ? "Caixa ativado." : "Caixa desativado.", "ok");
  } catch (erro) {
    console.error(erro);
    e.target.checked = !e.target.checked;
    mostrarToast("Não foi possível salvar. Tente novamente.", "erro");
  }
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

document.getElementById("btn-copiar-link").addEventListener("click", async () => {
  const texto = document.getElementById("link-gerente").textContent;
  try {
    await navigator.clipboard.writeText(texto);
    mostrarToast("Link copiado.", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível copiar. Selecione o texto manualmente.", "erro");
  }
});

document.getElementById("btn-gerar-novo-link").addEventListener("click", async () => {
  const confirmar = await confirmarAcao({
    titulo: "Gerar novo link?",
    mensagem: "Isso invalida o link atual imediatamente. Se a gerente já tiver o link salvo, ele vai parar de funcionar.",
    textoConfirmar: "Gerar novo link",
    textoCancelar: "Cancelar",
    perigo: true,
  });
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
