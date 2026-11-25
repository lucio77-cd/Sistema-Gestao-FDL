import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { mostrarToast } from "./toast.js";
import { getThemePreference, setThemePreference } from "./theme.js";
import { doc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

document.querySelectorAll('input[name="tema-sistema"]').forEach((input) => {
  input.checked = input.value === getThemePreference();
  input.addEventListener("change", () => {
    if (!input.checked) return;
    setThemePreference(input.value);
    mostrarToast("Aparência atualizada.", "ok");
  });
});

let estabelecimentoAtual = null;

protegerPagina(({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  document.getElementById("nome-input").value = estabelecimento.nome;
  document.getElementById("dias-alerta-input").value = estabelecimento.diasAlertaPadrao ?? 3;
  document.getElementById("toggle-caixa").checked = !!estabelecimento.baixaAutomaticaAtiva;
});

document.getElementById("toggle-caixa").addEventListener("change", async (e) => {
  if (!estabelecimentoAtual) {
    e.target.checked = !e.target.checked;
    mostrarToast("Aguarde o carregamento das configurações.", "erro");
    return;
  }
  const toggle = e.currentTarget;
  toggle.disabled = true;
  try {
    await updateDoc(doc(db, "estabelecimentos", estabelecimentoAtual.id), {
      baixaAutomaticaAtiva: toggle.checked,
    });
    mostrarToast(toggle.checked ? "Caixa ativado." : "Caixa desativado.", "ok");
  } catch (erro) {
    console.error(erro);
    toggle.checked = !toggle.checked;
    mostrarToast("Não foi possível salvar. Tente novamente.", "erro");
  } finally {
    toggle.disabled = false;
  }
});

document.getElementById("btn-salvar-config").addEventListener("click", async () => {
  if (!estabelecimentoAtual) {
    mostrarToast("Aguarde o carregamento das configurações.", "erro");
    return;
  }

  const nome = document.getElementById("nome-input").value.trim();
  const diasTexto = document.getElementById("dias-alerta-input").value.trim();
  const diasAlertaPadrao = Number(diasTexto);

  if (!nome || nome.length > 120) {
    mostrarToast("Informe um nome de estabelecimento com até 120 caracteres.", "erro");
    document.getElementById("nome-input").focus();
    return;
  }
  if (diasTexto === "" || !Number.isInteger(diasAlertaPadrao) || diasAlertaPadrao < 0 || diasAlertaPadrao > 365) {
    mostrarToast("O prazo de alerta deve ser um número inteiro entre 0 e 365 dias.", "erro");
    document.getElementById("dias-alerta-input").focus();
    return;
  }

  const botao = document.getElementById("btn-salvar-config");
  botao.disabled = true;
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

