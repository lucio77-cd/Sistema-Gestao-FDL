import { db } from "./firebase-config.js";
import { protegerPagina, sair } from "./auth-guard.js";
import { calcularStatus, formatarData } from "./status.js";
import { mostrarToast } from "./toast.js";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.getElementById("link-sair").addEventListener("click", (e) => {
  e.preventDefault();
  sair();
});

let estabelecimentoAtual = null;
let produtosCache = {};
// { loteId: { input, valorOriginal, produtoId } }
let controlesQuantidade = {};

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  await carregarProdutos();
  await carregarLotes();
});

// ---------- Alternância de seção (evita misturar tarefa rápida com rara) ----------

const segAtualizar = document.getElementById("seg-atualizar");
const segAdicionar = document.getElementById("seg-adicionar");
const secaoAtualizar = document.getElementById("secao-atualizar");
const secaoAdicionar = document.getElementById("secao-adicionar");

function mostrarSecao(nome) {
  const ehAtualizar = nome === "atualizar";
  secaoAtualizar.hidden = !ehAtualizar;
  secaoAdicionar.hidden = ehAtualizar;
  segAtualizar.classList.toggle("ativo", ehAtualizar);
  segAtualizar.setAttribute("aria-selected", String(ehAtualizar));
  segAdicionar.classList.toggle("ativo", !ehAtualizar);
  segAdicionar.setAttribute("aria-selected", String(!ehAtualizar));
}

segAtualizar.addEventListener("click", () => mostrarSecao("atualizar"));
segAdicionar.addEventListener("click", () => mostrarSecao("adicionar"));

function irParaCadastroDeProduto() {
  mostrarSecao("adicionar");
  const campo = document.getElementById("np-nome");
  campo.scrollIntoView({ behavior: "smooth", block: "center" });
  campo.focus();
}

// ---------- Carregamento ----------

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

  controlesQuantidade = {};

  if (snap.empty) {
    container.innerHTML = `
      <div class="estado-vazio">
        <p>Nenhum lote cadastrado ainda. Comece cadastrando seu primeiro produto.</p>
        <button type="button" class="btn" id="btn-primeiro-produto">Cadastrar primeiro produto</button>
      </div>
    `;
    document.getElementById("btn-primeiro-produto").addEventListener("click", irParaCadastroDeProduto);
    return;
  }

  const diasAlertaPadrao = estabelecimentoAtual.diasAlertaPadrao ?? 3;
  container.innerHTML = "";

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
      <div class="stepper" data-lote-id="${l.id}">
        <button type="button" class="btn-menos" aria-label="Diminuir quantidade de ${produto.nome}">−</button>
        <input type="number" min="0" value="${l.quantidade}" inputmode="numeric" aria-label="Quantidade de ${produto.nome}" />
        <button type="button" class="btn-mais" aria-label="Aumentar quantidade de ${produto.nome}">+</button>
      </div>
    `;
    container.appendChild(div);

    const stepper = div.querySelector(".stepper");
    const input = stepper.querySelector("input");
    controlesQuantidade[l.id] = { input, valorOriginal: Number(l.quantidade), produtoId: l.produtoId };

    function marcarSeAlterado() {
      const alterou = Number(input.value) !== controlesQuantidade[l.id].valorOriginal;
      stepper.classList.toggle("alterado", alterou);
    }

    stepper.querySelector(".btn-menos").addEventListener("click", () => {
      input.value = Math.max(0, Number(input.value) - 1);
      marcarSeAlterado();
    });
    stepper.querySelector(".btn-mais").addEventListener("click", () => {
      input.value = Number(input.value) + 1;
      marcarSeAlterado();
    });
    input.addEventListener("input", () => {
      if (Number(input.value) < 0) input.value = 0;
      marcarSeAlterado();
    });
  });
}

// ---------- Salvar vistoria (escrita atômica + histórico) ----------

document.getElementById("btn-salvar-vistoria").addEventListener("click", async () => {
  const botao = document.getElementById("btn-salvar-vistoria");
  const idsAlterados = Object.entries(controlesQuantidade).filter(
    ([, c]) => Number(c.input.value) !== c.valorOriginal
  );

  if (idsAlterados.length === 0) {
    mostrarToast("Nenhuma quantidade foi alterada.", "ok");
    return;
  }

  botao.disabled = true;
  const textoOriginal = botao.textContent;
  botao.textContent = "Salvando…";

  try {
    const batch = writeBatch(db);
    const itensHistorico = [];

    idsAlterados.forEach(([loteId, c]) => {
      const quantidadeNova = Number(c.input.value);
      batch.update(doc(db, "lotes", loteId), { quantidade: quantidadeNova });
      itensHistorico.push({
        loteId,
        produtoId: c.produtoId,
        quantidadeAnterior: c.valorOriginal,
        quantidadeNova,
      });
    });

    const refVistoria = doc(collection(db, "vistorias"));
    batch.set(refVistoria, {
      estabelecimentoId: estabelecimentoAtual.id,
      data: serverTimestamp(),
      itens: itensHistorico,
    });

    batch.update(doc(db, "estabelecimentos", estabelecimentoAtual.id), {
      ultimaVistoria: serverTimestamp(),
    });

    await batch.commit();

    idsAlterados.forEach(([, c]) => (c.valorOriginal = Number(c.input.value)));
    document.querySelectorAll(".stepper.alterado").forEach((el) => el.classList.remove("alterado"));

    mostrarToast("Vistoria salva com sucesso.", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não salvou — verifique a conexão e tente de novo.", "erro");
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
});

// ---------- Cadastro de produto ----------

document.getElementById("btn-salvar-produto").addEventListener("click", async () => {
  const nomeInput = document.getElementById("np-nome");
  const nome = nomeInput.value.trim();
  if (!nome) {
    nomeInput.focus();
    return;
  }

  const dados = {
    estabelecimentoId: estabelecimentoAtual.id,
    nome,
    categoria: document.getElementById("np-categoria").value.trim(),
    precoCusto: Number(document.getElementById("np-custo").value) || 0,
    precoVenda: Number(document.getElementById("np-venda").value) || 0,
  };
  const diasAlerta = document.getElementById("np-dias-alerta").value;
  if (diasAlerta !== "") dados.diasAlerta = Number(diasAlerta);

  try {
    await addDoc(collection(db, "produtos"), dados);
    document.getElementById("np-nome").value = "";
    document.getElementById("np-categoria").value = "";
    document.getElementById("np-custo").value = "";
    document.getElementById("np-venda").value = "";
    document.getElementById("np-dias-alerta").value = "";
    await carregarProdutos();
    mostrarToast(`Produto "${nome}" cadastrado.`, "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível salvar o produto.", "erro");
  }
});

// ---------- Cadastro de lote ----------

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

  try {
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
    mostrarToast("Lote adicionado.", "ok");
    await carregarLotes();
    mostrarSecao("atualizar");
  } catch (err) {
    console.error(err);
    erro.textContent = "Não foi possível salvar o lote. Tente novamente.";
    erro.hidden = false;
  }
});
