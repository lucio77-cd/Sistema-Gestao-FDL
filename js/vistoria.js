import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { calcularStatus, formatarData, formatarValorOuAviso, STATUS_ICONE, escapeHtml } from "./status.js";
import { mostrarToast } from "./toast.js";
import { skeletonLotes } from "./skeleton.js";
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

iniciarNavegacao();

let estabelecimentoAtual = null;
let produtosCache = {};
let controlesQuantidade = {};

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  await carregarProdutos();
  await carregarLotes();
});

// ---------- Alternância de seção principal ----------

const segAtualizar = document.getElementById("seg-atualizar");
const segAdicionar = document.getElementById("seg-adicionar");
const segSaidas = document.getElementById("seg-saidas");
const secaoAtualizar = document.getElementById("secao-atualizar");
const secaoAdicionar = document.getElementById("secao-adicionar");
const secaoSaidas = document.getElementById("secao-saidas");

function mostrarSecao(nome) {
  secaoAtualizar.hidden = nome !== "atualizar";
  secaoAdicionar.hidden = nome !== "adicionar";
  secaoSaidas.hidden = nome !== "saidas";

  segAtualizar.classList.toggle("ativo", nome === "atualizar");
  segAtualizar.setAttribute("aria-selected", String(nome === "atualizar"));
  segAdicionar.classList.toggle("ativo", nome === "adicionar");
  segAdicionar.setAttribute("aria-selected", String(nome === "adicionar"));
  segSaidas.classList.toggle("ativo", nome === "saidas");
  segSaidas.setAttribute("aria-selected", String(nome === "saidas"));

  if (nome === "saidas") mostrarSubSecaoSaida("vendidos");
}

segAtualizar.addEventListener("click", () => mostrarSecao("atualizar"));
segAdicionar.addEventListener("click", () => mostrarSecao("adicionar"));
segSaidas.addEventListener("click", () => mostrarSecao("saidas"));

function irParaCadastroDeProduto() {
  mostrarSecao("adicionar");
  const campo = document.getElementById("np-nome");
  campo.scrollIntoView({ behavior: "smooth", block: "center" });
  campo.focus();
}

// ---------- Sub-abas dentro de Saídas ----------

const segVendidos = document.getElementById("seg-vendidos");
const segVencidos = document.getElementById("seg-vencidos");
const secaoVendidos = document.getElementById("secao-vendidos");
const secaoVencidos = document.getElementById("secao-vencidos");

function mostrarSubSecaoSaida(nome) {
  secaoVendidos.hidden = nome !== "vendidos";
  secaoVencidos.hidden = nome !== "vencidos";
  segVendidos.classList.toggle("ativo", nome === "vendidos");
  segVendidos.setAttribute("aria-selected", String(nome === "vendidos"));
  segVencidos.classList.toggle("ativo", nome === "vencidos");
  segVencidos.setAttribute("aria-selected", String(nome === "vencidos"));

  if (nome === "vendidos") carregarSaidas("vendido");
  else carregarSaidas("vencido");
}

segVendidos.addEventListener("click", () => mostrarSubSecaoSaida("vendidos"));
segVencidos.addEventListener("click", () => mostrarSubSecaoSaida("vencidos"));

// ---------- Carregamento de produtos e lotes ----------

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
  container.innerHTML = skeletonLotes(4);

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

  const batchMigracao = writeBatch(db);
  let precisaMigrar = false;

  lotes.forEach((l) => {
    const produto = produtosCache[l.produtoId];
    if (produto && (l.produtoNome === undefined || l.precoCusto === undefined)) {
      l.produtoNome = produto.nome;
      l.precoCusto = produto.precoCusto ?? 0;
      if (l.diasAlerta === undefined) l.diasAlerta = produto.diasAlerta ?? null;
      batchMigracao.update(doc(db, "lotes", l.id), {
        produtoNome: produto.nome,
        precoCusto: produto.precoCusto ?? 0,
        diasAlerta: produto.diasAlerta ?? null,
      });
      precisaMigrar = true;
    }
  });

  if (precisaMigrar) {
    batchMigracao.commit().catch((erro) => console.error("Migração de lotes falhou:", erro));
  }

  lotes.forEach((l) => {
    const produto = produtosCache[l.produtoId] || { nome: l.produtoNome || "(produto removido)" };
    const diasAlerta = (l.diasAlerta ?? produto.diasAlerta) ?? diasAlertaPadrao;
    const { status } = calcularStatus(l.dataVencimento, diasAlerta, l.promocaoAtiva);

    const div = document.createElement("div");
    div.className = `lote lote--${status}`;
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${STATUS_ICONE[status]} ${escapeHtml(produto.nome)}</div>
        <div class="lote-meta">${escapeHtml(l.local || "—")} · vence em ${formatarData(l.dataVencimento)}</div>
        <div class="lote-acao-zero">
          <button type="button" class="btn-texto btn-acao-zero" data-acao="vendido">Vendido</button>
          <button type="button" class="btn-texto btn-acao-zero" data-acao="vencido">Vencido</button>
        </div>
      </div>
      <div class="stepper" data-lote-id="${l.id}">
        <button type="button" class="btn-menos" aria-label="Diminuir quantidade de ${escapeHtml(produto.nome)}">−</button>
        <input type="number" min="0" value="${l.quantidade}" inputmode="numeric" aria-label="Quantidade de ${escapeHtml(produto.nome)}" />
        <button type="button" class="btn-mais" aria-label="Aumentar quantidade de ${escapeHtml(produto.nome)}">+</button>
      </div>
    `;
    container.appendChild(div);

    const stepper = div.querySelector(".stepper");
    const input = stepper.querySelector("input");
    const areaAcaoZero = div.querySelector(".lote-acao-zero");

    controlesQuantidade[l.id] = {
      input,
      valorOriginal: Number(l.quantidade),
      produtoId: l.produtoId,
      produtoNome: produto.nome,
      precoCusto: Number(l.precoCusto ?? produto.precoCusto ?? 0),
      local: l.local || "",
      dataVencimento: l.dataVencimento,
      acaoZero: null,
      quantidadeParaAcao: null,
    };

    function atualizarClasseAlterado() {
      const valor = Number(input.value);
      const alterou = valor !== controlesQuantidade[l.id].valorOriginal || !!controlesQuantidade[l.id].acaoZero;
      stepper.classList.toggle("alterado", alterou);
    }

    function limparAcaoEscolhida() {
      controlesQuantidade[l.id].acaoZero = null;
      controlesQuantidade[l.id].quantidadeParaAcao = null;
      areaAcaoZero.querySelectorAll(".btn-acao-zero").forEach((b) => b.classList.remove("selecionado"));
    }

    stepper.querySelector(".btn-menos").addEventListener("click", () => {
      input.value = Math.max(0, Number(input.value) - 1);
      limparAcaoEscolhida();
      atualizarClasseAlterado();
    });
    stepper.querySelector(".btn-mais").addEventListener("click", () => {
      input.value = Number(input.value) + 1;
      limparAcaoEscolhida();
      atualizarClasseAlterado();
    });
    input.addEventListener("input", () => {
      if (Number(input.value) < 0) input.value = 0;
      limparAcaoEscolhida();
      atualizarClasseAlterado();
    });

    areaAcaoZero.querySelectorAll(".btn-acao-zero").forEach((btn) => {
      btn.addEventListener("click", () => {
        const quantidadeNoMomento = Number(input.value);
        controlesQuantidade[l.id].acaoZero = btn.dataset.acao;
        controlesQuantidade[l.id].quantidadeParaAcao = quantidadeNoMomento;
        input.value = 0;

        areaAcaoZero.querySelectorAll(".btn-acao-zero").forEach((b) => b.classList.remove("selecionado"));
        btn.classList.add("selecionado");
        atualizarClasseAlterado();
      });
    });

    atualizarClasseAlterado();
  });
}

// ---------- Lista de saídas ----------

async function carregarSaidas(motivo) {
  const containerId = motivo === "vendido" ? "lista-vendidos" : "lista-vencidos";
  const container = document.getElementById(containerId);
  container.innerHTML = skeletonLotes(3);

  let snap;
  try {
    snap = await getDocs(
      query(
        collection(db, "saidas"),
        where("estabelecimentoId", "==", estabelecimentoAtual.id),
        where("motivo", "==", motivo)
      )
    );
  } catch (erro) {
    console.error("Falha ao carregar saídas:", erro);
    container.innerHTML =
      '<p class="mensagem-vazio">Não foi possível carregar. Confirme se as regras do Firestore foram publicadas (coleção "saidas") e tente de novo.</p>';
    return;
  }

  const itens = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const dataA = a.registradoEm?.toDate ? a.registradoEm.toDate() : new Date(0);
      const dataB = b.registradoEm?.toDate ? b.registradoEm.toDate() : new Date(0);
      return dataB - dataA;
    });

  if (motivo === "vencido") {
    const total = itens.reduce((soma, it) => soma + (Number(it.valor) || 0), 0);
    document.getElementById("total-vencido").textContent = `R$ ${total.toFixed(2)}`;
  }

  container.innerHTML = "";

  if (itens.length === 0) {
    container.innerHTML = `<p class="mensagem-vazio">Nenhum item ${motivo === "vendido" ? "vendido" : "vencido"} registrado ainda.</p>`;
    return;
  }

  itens.forEach((item) => {
    const data = item.registradoEm?.toDate ? item.registradoEm.toDate() : null;
    const dataTexto = data ? data.toLocaleDateString("pt-BR") : "—";

    const div = document.createElement("div");
    div.className = `lote lote--${motivo === "vencido" ? "vencido" : "excluido"}`;
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${escapeHtml(item.produtoNome)}</div>
        <div class="lote-meta">${escapeHtml(item.local || "—")} · ${item.quantidade} un. · vencia em ${formatarData(item.dataVencimentoOriginal)}</div>
      </div>
      <div class="lote-dados">
        ${motivo === "vencido" ? `<div class="lote-dias lote-dias--vencido">${formatarValorOuAviso(item.quantidade, item.precoCusto)}</div>` : ""}
        <div class="lote-valor">Registrado em ${dataTexto}</div>
      </div>
    `;
    container.appendChild(div);
  });
}

// ---------- Salvar vistoria ----------

document.getElementById("btn-salvar-vistoria").addEventListener("click", async () => {
  const botao = document.getElementById("btn-salvar-vistoria");

  const alterados = Object.entries(controlesQuantidade).filter(([, c]) => {
    if (c.acaoZero) return true;
    return Number(c.input.value) !== c.valorOriginal;
  });

  if (alterados.length === 0) {
    mostrarToast("Nenhuma quantidade foi alterada.", "ok");
    return;
  }

  const prontos = [];
  const pendentes = [];
  alterados.forEach(([loteId, c]) => {
    const quantidadeNova = Number(c.input.value);
    if (quantidadeNova === 0 && !c.acaoZero) {
      pendentes.push(c.produtoNome);
    } else {
      prontos.push([loteId, c, quantidadeNova]);
    }
  });

  if (prontos.length === 0) {
    mostrarToast(`Escolha "Vendido" ou "Vencido" para: ${pendentes.join(", ")}.`, "erro");
    return;
  }

  botao.disabled = true;
  const textoOriginal = botao.textContent;
  botao.textContent = "Salvando…";

  try {
    const batch = writeBatch(db);
    const itensHistorico = [];

    prontos.forEach(([loteId, c, quantidadeNova]) => {
      const loteRef = doc(db, "lotes", loteId);
      const quantidadeDaAcao = c.quantidadeParaAcao ?? c.valorOriginal;

      if (c.acaoZero === "vendido" || c.acaoZero === "vencido") {
        batch.delete(loteRef);
        const refSaida = doc(collection(db, "saidas"));
        batch.set(refSaida, {
          estabelecimentoId: estabelecimentoAtual.id,
          produtoId: c.produtoId,
          produtoNome: c.produtoNome,
          motivo: c.acaoZero,
          quantidade: quantidadeDaAcao,
          precoCusto: c.precoCusto,
          valor: quantidadeDaAcao * c.precoCusto,
          local: c.local,
          dataVencimentoOriginal: c.dataVencimento,
          origem: "vistoria",
          registradoEm: serverTimestamp(),
        });
      } else {
        batch.update(loteRef, { quantidade: quantidadeNova });
      }

      itensHistorico.push({
        loteId,
        produtoId: c.produtoId,
        quantidadeAnterior: c.valorOriginal,
        quantidadeNova,
        acao: c.acaoZero || "ajuste",
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

    if (pendentes.length > 0) {
      mostrarToast(`Vistoria salva. Falta decidir: ${pendentes.join(", ")}.`, "erro");
    } else {
      mostrarToast("Vistoria salva com sucesso.", "ok");
    }

    await carregarLotes();
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
  const produto = produtosCache[produtoId];
  if (!produtoId || !produto) {
    erro.textContent = "Selecione um produto.";
    erro.hidden = false;
    return;
  }

  try {
    await addDoc(collection(db, "lotes"), {
      estabelecimentoId: estabelecimentoAtual.id,
      produtoId,
      produtoNome: produto.nome,
      precoCusto: produto.precoCusto ?? 0,
      diasAlerta: produto.diasAlerta ?? null,
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
