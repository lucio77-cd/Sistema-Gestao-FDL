import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { mostrarToast } from "./toast.js";
import { calcularStatus, formatarDiasRestantes, seloHtml, escapeHtml } from "./status.js";
import {
  collection, query, where, getDocs, addDoc, doc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

const $ = (id) => document.getElementById(id);
const form = $("form-doce");
const lista = $("doces-lista");
let estabelecimentoAtual = null;
let registros = [];
let editandoId = null;
let salvando = false;

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  $("nome-estabelecimento").textContent = estabelecimento.nome;
  await carregarRegistros();
});

function dataPt(data) {
  if (!data) return "—";
  const [ano, mes, dia] = data.split("-");
  return `${dia}/${mes}/${ano}`;
}

function diasAlerta() {
  return Number(estabelecimentoAtual?.diasAlertaPadrao ?? 3);
}

function statusDo(registro) {
  return calcularStatus(registro.dataVencimento, diasAlerta(), false);
}

async function carregarRegistros() {
  lista.innerHTML = '<p class="mensagem-vazio">Carregando doces…</p>';
  try {
    const snap = await getDocs(query(
      collection(db, "docesValidade"),
      where("estabelecimentoId", "==", estabelecimentoAtual.id)
    ));
    registros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    registros.sort((a, b) => String(a.dataVencimento || "").localeCompare(String(b.dataVencimento || "")));
    renderizar();
  } catch (erro) {
    console.error("Falha ao carregar validade dos doces:", erro);
    lista.innerHTML = '<p class="mensagem-vazio">Não foi possível carregar os registros. Verifique se as regras atualizadas do Firestore foram publicadas.</p>';
    mostrarToast("Erro ao carregar a validade dos doces.", "erro");
  }
}

function atualizarResumo() {
  const ativos = registros.filter(r => r.ativo !== false);
  const vencidos = ativos.filter(r => statusDo(r).status === "vencido").length;
  const atencao = ativos.filter(r => statusDo(r).status === "atencao").length;
  $("doces-total-ativos").textContent = String(ativos.length);
  $("doces-total-atencao").textContent = String(atencao);
  $("doces-total-vencidos").textContent = String(vencidos);
}

function cartao(registro) {
  const status = statusDo(registro);
  const encerrado = registro.ativo === false;
  const classe = encerrado ? "doce-card doce-card--encerrado" : "doce-card";
  const quantidade = Number(registro.quantidade) || 0;
  const acao = encerrado ? "Reabrir para venda" : "Marcar vendido / retirado";
  return `<article class="${classe}" data-id="${escapeHtml(registro.id)}">
    <div class="doce-card-conteudo">
      <div class="doce-card-titulo"><h3>${escapeHtml(registro.nome)}</h3>${encerrado ? '<span class="selo selo--sem-validade">Encerrado</span>' : seloHtml(status.status)}</div>
      <div class="doce-card-dados">
        <span><strong>${quantidade}</strong> ${quantidade === 1 ? "unidade" : "unidades"}</span>
        <span>Validade: <strong>${dataPt(registro.dataVencimento)}</strong></span>
        <span>${escapeHtml(encerrado ? "Fora da venda" : formatarDiasRestantes(status.diasRestantes))}</span>
      </div>
      ${registro.observacao ? `<p class="doce-card-obs">${escapeHtml(registro.observacao)}</p>` : ""}
    </div>
    <div class="doce-card-acoes">
      <button type="button" class="btn-texto" data-acao="editar">Editar</button>
      <button type="button" class="btn-texto" data-acao="alternar">${acao}</button>
    </div>
  </article>`;
}

function renderizar() {
  atualizarResumo();
  const filtro = $("doces-filtro").value;
  const filtrados = registros.filter(r => {
    if (filtro === "ativos") return r.ativo !== false;
    if (filtro === "encerrados") return r.ativo === false;
    return true;
  });
  if (!filtrados.length) {
    lista.innerHTML = '<div class="painel estado-vazio"><p>Nenhum doce neste filtro.</p><span class="legenda">Adicione o primeiro registro no formulário acima.</span></div>';
    return;
  }
  lista.innerHTML = filtrados.map(cartao).join("");
}

function limparFormulario() {
  form.reset();
  $("doce-quantidade").value = "1";
  editandoId = null;
  $("doces-form-titulo").textContent = "Adicionar doce";
  $("doce-salvar").textContent = "Salvar validade";
  $("doce-cancelar").hidden = true;
}

function iniciarEdicao(id) {
  const registro = registros.find(r => r.id === id);
  if (!registro) return;
  editandoId = id;
  $("doce-nome").value = registro.nome || "";
  $("doce-quantidade").value = String(registro.quantidade ?? 1);
  $("doce-validade").value = registro.dataVencimento || "";
  $("doce-observacao").value = registro.observacao || "";
  $("doces-form-titulo").textContent = "Editar validade";
  $("doce-salvar").textContent = "Salvar alterações";
  $("doce-cancelar").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
  $("doce-nome").focus({ preventScroll: true });
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (salvando || !estabelecimentoAtual) return;
  const nome = $("doce-nome").value.trim();
  const quantidade = Number($("doce-quantidade").value);
  const dataVencimento = $("doce-validade").value;
  const observacao = $("doce-observacao").value.trim();
  if (!nome || nome.length > 120 || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 1000000 || !/^\d{4}-\d{2}-\d{2}$/.test(dataVencimento)) {
    mostrarToast("Confira o nome, a quantidade e a data de validade.", "erro");
    return;
  }

  salvando = true;
  $("doce-salvar").disabled = true;
  try {
    const dados = {
      nome, quantidade, dataVencimento, observacao,
      atualizadoEm: serverTimestamp()
    };
    if (editandoId) {
      await updateDoc(doc(db, "docesValidade", editandoId), dados);
      mostrarToast("Validade atualizada.");
    } else {
      await addDoc(collection(db, "docesValidade"), {
        ...dados,
        estabelecimentoId: estabelecimentoAtual.id,
        ativo: true,
        criadoEm: serverTimestamp()
      });
      mostrarToast("Doce registrado.");
    }
    limparFormulario();
    await carregarRegistros();
  } catch (erro) {
    console.error("Falha ao salvar validade do doce:", erro);
    mostrarToast("Não foi possível salvar. Confira as permissões do Firestore.", "erro");
  } finally {
    salvando = false;
    $("doce-salvar").disabled = false;
  }
});

$("doce-cancelar").addEventListener("click", limparFormulario);
$("doces-filtro").addEventListener("change", renderizar);

lista.addEventListener("click", async (evento) => {
  const botao = evento.target.closest("button[data-acao]");
  if (!botao) return;
  const card = botao.closest("[data-id]");
  const id = card?.dataset.id;
  const registro = registros.find(r => r.id === id);
  if (!registro) return;
  if (botao.dataset.acao === "editar") {
    iniciarEdicao(id);
    return;
  }
  if (botao.dataset.acao === "alternar") {
    botao.disabled = true;
    try {
      await updateDoc(doc(db, "docesValidade", id), {
        ativo: registro.ativo === false,
        atualizadoEm: serverTimestamp()
      });
      mostrarToast(registro.ativo === false ? "Doce voltou para a lista de venda." : "Doce marcado como vendido/retirado.");
      await carregarRegistros();
    } catch (erro) {
      console.error("Falha ao atualizar situação do doce:", erro);
      mostrarToast("Não foi possível atualizar a situação.", "erro");
      botao.disabled = false;
    }
  }
});
