import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { mostrarToast } from "./toast.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

let estabelecimentoAtual = null;

protegerPagina(({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  document.getElementById("nome-input").value = estabelecimento.nome;
  document.getElementById("dias-alerta-input").value = estabelecimento.diasAlertaPadrao ?? 3;
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

