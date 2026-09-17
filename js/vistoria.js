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
// { loteId: { input, valorOriginal, produtoId, produtoNome, precoCusto, local, dataVencimento, acaoZero } }
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
const segExcluidos = document.getElementById("seg-excluidos");
const secaoAtualizar = document.getElementById("secao-atualizar");
const secaoAdicionar = document.getElementById("secao-adicionar");
const secaoExcluidos = document.getElementById("secao-excluidos");

function mostrarSecao(nome) {
  secaoAtualizar.hidden = nome !== "atualizar";
  secaoAdicionar.hidden = nome !== "adicionar";
  secaoExcluidos.hidden = nome !== "excluidos";

  segAtualizar.classList.toggle("ativo", nome === "atualizar");
  segAtualizar.setAttribute("aria-selected", String(nome === "atualizar"));
  segAdicionar.classList.toggle("ativo", nome === "adicionar");
  segAdicionar.setAttribute("aria-selected", String(nome === "adicionar"));
  segExcluidos.classList.toggle("ativo", nome === "excluidos");
  segExcluidos.setAttribute("aria-selected", String(nome === "excluidos"));

  if (nome === "excluidos") carregarExcluidos();
}

segAtualizar.addEventListener("click", () => mostrarSecao("atualizar"));
segAdicionar.addEventListener("click", () => mostrarSecao("adicionar"));
segExcluidos.addEventListener("click", () => mostrarSecao("excluidos"));

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

  // Migração silenciosa: lotes criados antes desta versão não têm o nome do
  // produto gravado no próprio lote. Isso é o que fazia a página da gerente
  // depender de ler a coleção "produtos" (sem permissão pública) e travar em
  // "Carregando…" para sempre. Aproveitamos que já temos o produto em cache
  // aqui (tela autenticada) para completar o dado uma única vez.
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
        <div class="lote-produto">${produto.nome}</div>
        <div class="lote-meta">${l.local || "—"} · vence em ${formatarData(l.dataVencimento)}</div>
        <div class="lote-acao-zero" hidden>
          <button type="button" class="btn-texto btn-acao-zero" data-acao="vendido">Vendido — excluir</button>
          <button type="button" class="btn-texto btn-acao-zero" data-acao="perda">Sobrou/venceu — registrar perda</button>
        </div>
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
    };

    function atualizarEstadoVisual() {
      const valor = Number(input.value);
      const alterou = valor !== controlesQuantidade[l.id].valorOriginal;
      stepper.classList.toggle("alterado", alterou);
      areaAcaoZero.hidden = valor !== 0;
      if (valor !== 0) controlesQuantidade[l.id].acaoZero = null;
    }

    stepper.querySelector(".btn-menos").addEventListener("click", () => {
      input.value = Math.max(0, Number(input.value) - 1);
      atualizarEstadoVisual();
    });
    stepper.querySelector(".btn-mais").addEventListener("click", () => {
      input.value = Number(input.value) + 1;
      atualizarEstadoVisual();
    });
    input.addEventListener("input", () => {
      if (Number(input.value) < 0) input.value = 0;
      atualizarEstadoVisual();
    });

    areaAcaoZero.querySelectorAll(".btn-acao-zero").forEach((btn) => {
      btn.addEventListener("click", () => {
        controlesQuantidade[l.id].acaoZero = btn.dataset.acao;
        areaAcaoZero.querySelectorAll(".btn-acao-zero").forEach((b) => b.classList.remove("selecionado"));
        btn.classList.add("selecionado");
      });
    });

    // Se o lote já foi carregado com quantidade 0 (raro, mas possível), mostra
    // a escolha desde já.
    atualizarEstadoVisual();
  });
}

// ---------- Lista de excluídos ----------
// Itens marcados como "Vendido" ao zerar a quantidade não somem sem deixar
// rastro: ficam registrados aqui como histórico simples de saída.

async function carregarExcluidos() {
  const container = document.getElementById("lista-excluidos");
  container.innerHTML = '<p class="mensagem-vazio">Carregando…</p>';

  const snap = await getDocs(
    query(collection(db, "excluidos"), where("estabelecimentoId", "==", estabelecimentoAtual.id))
  );

  const itens = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const dataA = a.registradoEm?.toDate ? a.registradoEm.toDate() : new Date(0);
      const dataB = b.registradoEm?.toDate ? b.registradoEm.toDate() : new Date(0);
      return dataB - dataA;
    });

  container.innerHTML = "";

  if (itens.length === 0) {
    container.innerHTML = '<p class="mensagem-vazio">Nenhum item excluído ainda.</p>';
    return;
  }

  itens.forEach((item) => {
    const data = item.registradoEm?.toDate ? item.registradoEm.toDate() : null;
    const dataTexto = data ? data.toLocaleDateString("pt-BR") : "—";

    const div = document.createElement("div");
    div.className = "lote lote--excluido";
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${item.produtoNome}</div>
        <div class="lote-meta">${item.local || "—"} · ${item.quantidadeVendida} un. · vencia em ${formatarData(item.dataVencimentoOriginal)}</div>
      </div>
      <div class="lote-dados">
        <div class="lote-valor">Excluído em ${dataTexto}</div>
      </div>
    `;
    container.appendChild(div);
  });
}

// ---------- Salvar vistoria (escrita atômica + histórico) ----------

document.getElementById("btn-salvar-vistoria").addEventListener("click", async () => {
  const botao = document.getElementById("btn-salvar-vistoria");
  const alterados = Object.entries(controlesQuantidade).filter(
    ([, c]) => Number(c.input.value) !== c.valorOriginal
  );

  if (alterados.length === 0) {
    mostrarToast("Nenhuma quantidade foi alterada.", "ok");
    return;
  }

  // Lotes zerados sem decisão ficam de fora deste salvamento — evita apagar
  // ou perder dado sem uma escolha explícita do usuário.
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
    mostrarToast(`Escolha "Vendido" ou "Sobrou/venceu" para: ${pendentes.join(", ")}.`, "erro");
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

      if (quantidadeNova > 0) {
        batch.update(loteRef, { quantidade: quantidadeNova });
      } else if (c.acaoZero === "vendido") {
        batch.delete(loteRef);
        const refExcluido = doc(collection(db, "excluidos"));
        batch.set(refExcluido, {
          estabelecimentoId: estabelecimentoAtual.id,
          produtoId: c.produtoId,
          produtoNome: c.produtoNome,
          quantidadeVendida: c.valorOriginal,
          local: c.local,
          dataVencimentoOriginal: c.dataVencimento,
          registradoEm: serverTimestamp(),
        });
      } else if (c.acaoZero === "perda") {
        batch.delete(loteRef);
        const refPerda = doc(collection(db, "perdas"));
        batch.set(refPerda, {
          estabelecimentoId: estabelecimentoAtual.id,
          produtoId: c.produtoId,
          produtoNome: c.produtoNome,
          quantidadePerdida: c.valorOriginal,
          precoCusto: c.precoCusto,
          valorPerdido: c.valorOriginal * c.precoCusto,
          local: c.local,
          dataVencimentoOriginal: c.dataVencimento,
          registradoEm: serverTimestamp(),
        });
      }

      itensHistorico.push({
        loteId,
        produtoId: c.produtoId,
        quantidadeAnterior: c.valorOriginal,
        quantidadeNova,
        acao: quantidadeNova === 0 ? c.acaoZero : "ajuste",
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
// O nome do produto e o preço de custo são gravados também no próprio lote
// (denormalizado). Isso é o que permite a página da gerente (sem login) ler
// os lotes sem precisar consultar a coleção "produtos" — que fica restrita
// por conter preço de custo/venda.

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
