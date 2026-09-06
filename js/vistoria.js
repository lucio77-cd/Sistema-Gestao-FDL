import { db } from "./firebase-config.js";
import { protegerPagina, sair } from "./auth-guard.js";
import { calcularStatus, formatarData } from "./status.js";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.getElementById("link-sair").addEventListener("click", (e) => {
  e.preventDefault();
  sair();
});

let estabelecimentoAtual = null;
let produtosCache = {};
let inputsQuantidade = [];

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  await carregarProdutos();
  await carregarLotes();
});

async function carregarProdutos() {
  const snap = await getDocs(
    query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimentoAtual.id))
  );
  produtosCache = {};
  const select = document.getElementById("produto");
  select.innerHTML = '<option value="">Selecione…</option>';
  snap.forEach((d) => {
    produtosCache[d.id] = { id: d.id, ...d.data() };
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.data().nome;
    select.appendChild(opt);
  });
}

async function carregarLotes() {
  const container = document.getElementById("lista-lotes-vistoria");
  const snap = await getDocs(
    query(collection(db, "lotes"), where("estabelecimentoId", "==", estabelecimentoAtual.id))
  );

  if (snap.empty) {
    container.innerHTML = '<p class="mensagem-vazio">Nenhum lote cadastrado ainda. Adicione um abaixo.</p>';
    inputsQuantidade = [];
    return;
  }

  const diasAlertaPadrao = estabelecimentoAtual.diasAlertaPadrao ?? 3;
  container.innerHTML = "";
  inputsQuantidade = [];

  const lotes = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.dataVencimento.localeCompare(b.dataVencimento));

  lotes.forEach((l) => {
    const produto = produtosCache[l.produtoId] || { nome: "(produto removido)" };
    const diasAlerta = produto.diasAlerta ?? diasAlertaPadrao;
    const { status } = calcularStatus(l.dataVencimento, diasAlerta, l.promocaoAtiva);

    const div = document.createElement("div");
    div.className = `lote lote--${status}`;
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${produto.nome}</div>
        <div class="lote-meta">${l.local || "—"} · vence em ${formatarData(l.dataVencimento)}</div>
      </div>
      <div class="lote-dados">
        <input type="number" min="0" value="${l.quantidade}" style="width:5.5rem; text-align:right" data-lote-id="${l.id}" />
      </div>
    `;
    container.appendChild(div);
    inputsQuantidade.push(div.querySelector("input"));
  });
}

document.getElementById("btn-salvar-vistoria").addEventListener("click", async () => {
  const msg = document.getElementById("msg-vistoria");
  msg.hidden = true;

  const atualizacoes = inputsQuantidade.map((input) =>
    updateDoc(doc(db, "lotes", input.dataset.loteId), { quantidade: Number(input.value) })
  );
  await Promise.all(atualizacoes);
  await updateDoc(doc(db, "estabelecimentos", estabelecimentoAtual.id), {
    ultimaVistoria: serverTimestamp(),
  });

  msg.textContent = "Vistoria salva.";
  msg.hidden = false;
});

document.getElementById("btn-novo-produto").addEventListener("click", () => {
  document.getElementById("painel-novo-produto").hidden = false;
});

document.getElementById("btn-salvar-produto").addEventListener("click", async () => {
  const nome = document.getElementById("np-nome").value.trim();
  if (!nome) return;

  const dados = {
    estabelecimentoId: estabelecimentoAtual.id,
    nome,
    categoria: document.getElementById("np-categoria").value.trim(),
    precoCusto: Number(document.getElementById("np-custo").value) || 0,
    precoVenda: Number(document.getElementById("np-venda").value) || 0,
  };
  const diasAlerta = document.getElementById("np-dias-alerta").value;
  if (diasAlerta !== "") dados.diasAlerta = Number(diasAlerta);

  await addDoc(collection(db, "produtos"), dados);
  document.getElementById("painel-novo-produto").hidden = true;
  document.getElementById("np-nome").value = "";
  document.getElementById("np-categoria").value = "";
  document.getElementById("np-custo").value = "";
  document.getElementById("np-venda").value = "";
  document.getElementById("np-dias-alerta").value = "";
  await carregarProdutos();
});

document.getElementById("form-novo-lote").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = document.getElementById("erro-lote");
  erro.hidden = true;

  const produtoId = document.getElementById("produto").value;
  if (!produtoId) {
    erro.textContent = "Selecione um produto.";
    erro.hidden = false;
    return;
  }

  await addDoc(collection(db, "lotes"), {
    estabelecimentoId: estabelecimentoAtual.id,
    produtoId,
    quantidade: Number(document.getElementById("quantidade").value),
    local: document.getElementById("local").value,
    dataVencimento: document.getElementById("vencimento").value,
    promocaoAtiva: false,
    precoPromocional: null,
  });

  e.target.reset();
  await carregarLotes();
});
