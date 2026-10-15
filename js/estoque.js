import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { mostrarToast } from "./toast.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  writeBatch,
  increment,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

let estabelecimentoAtual = null;
let produtos = []; // [{ id, nome, precoCusto, diasAlerta, estoqueMinimo, ... }]
let estoqueMap = {}; // produtoId -> { geladeira, seco }  (só existe para produto já contado)
let localAtual = "geladeira"; // "geladeira" | "seco"
let planoImportacao = null;

const ROTULO_LOCAL = { geladeira: "Geladeira", seco: "Seco" };
const LOCAL_DO_LOTE = { geladeira: "Geladeira", seco: "Estoque seco" };

const lista = document.getElementById("lista-estoque");
const campoBusca = document.getElementById("campo-busca");

function numero(valor) {
  return Number(valor) || 0;
}

function esc(texto) {
  return String(texto ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  try {
    await carregarTudo();
  } catch (erro) {
    console.error(erro);
    lista.innerHTML =
      '<p class="mensagem-vazio">Não foi possível carregar o estoque. Confirme se as regras do Firestore foram publicadas (coleções "estoque" e "movimentosEstoque") e tente de novo.</p>';
  }
});

// ---------- Local da contagem (geladeira / seco) ----------

const segGeladeira = document.getElementById("seg-geladeira");
const segSeco = document.getElementById("seg-seco");

function mostrarLocal(local) {
  localAtual = local;
  segGeladeira.classList.toggle("ativo", local === "geladeira");
  segGeladeira.setAttribute("aria-selected", String(local === "geladeira"));
  segSeco.classList.toggle("ativo", local === "seco");
  segSeco.setAttribute("aria-selected", String(local === "seco"));
  renderizarLista();
}

segGeladeira.addEventListener("click", () => mostrarLocal("geladeira"));
segSeco.addEventListener("click", () => mostrarLocal("seco"));
campoBusca.addEventListener("input", renderizarLista);

// ---------- Carregamento ----------

async function carregarTudo() {
  const [produtosSnap, estoqueSnap] = await Promise.all([
    getDocs(query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimentoAtual.id))),
    getDocs(query(collection(db, "estoque"), where("estabelecimentoId", "==", estabelecimentoAtual.id))),
  ]);

  produtos = produtosSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));

  estoqueMap = {};
  estoqueSnap.forEach((d) => {
    const e = d.data();
    estoqueMap[d.id] = { geladeira: numero(e.geladeira), seco: numero(e.seco) };
  });

  renderizarLista();
  await prepararImportacao();
}

// ---------- Lista de produtos ----------

function renderizarLista() {
  if (produtos.length === 0) {
    lista.innerHTML =
      '<p class="mensagem-vazio">Nenhum produto cadastrado ainda. Cadastre pela aba "Adicionar novo" da Vistoria.</p>';
    return;
  }

  const busca = campoBusca.value.trim().toLowerCase();
  const visiveis = produtos.filter((p) => p.nome.toLowerCase().includes(busca));

  if (visiveis.length === 0) {
    lista.innerHTML = '<p class="mensagem-vazio">Nenhum produto encontrado.</p>';
    return;
  }

  lista.innerHTML = "";

  visiveis.forEach((p) => {
    const contado = estoqueMap[p.id] !== undefined;
    const e = estoqueMap[p.id] || { geladeira: 0, seco: 0 };
    const total = e.geladeira + e.seco;
    const minimo = p.estoqueMinimo ?? null;
    const negativo = e.geladeira < 0 || e.seco < 0;
    const abaixo = contado && !negativo && minimo !== null && total <= minimo;

    const linha = document.createElement("div");
    linha.className = `ea${negativo ? " ea--negativo" : abaixo ? " ea--baixo" : ""}`;
    linha.innerHTML = `
      <div class="ea-topo">
        <div class="ea-nome">${esc(p.nome)}</div>
        <div class="ea-numero" aria-label="${ROTULO_LOCAL[localAtual]}: ${e[localAtual]}">${e[localAtual]}</div>
      </div>
      <div class="ea-meta">Geladeira ${e.geladeira} · Seco ${e.seco} · Total ${total}${minimo !== null ? ` · mínimo ${minimo}` : ""}</div>
      <div class="ea-avisos">
        ${!contado ? '<span class="selo selo--sem-validade">Ainda não contado</span>' : ""}
        ${negativo ? '<span class="selo selo--vencido">Recontar</span>' : ""}
        ${abaixo ? '<span class="selo selo--atencao">No mínimo ou abaixo</span>' : ""}
      </div>
      <div class="ea-acoes">
        <button type="button" class="btn-texto ea-btn" data-acao="entrada">Entrada (+N)</button>
        <button type="button" class="btn-texto ea-btn" data-acao="ajuste">Ajustar contagem</button>
      </div>
      <div class="ea-form" hidden></div>
    `;
    lista.appendChild(linha);

    linha.querySelectorAll(".ea-btn").forEach((btn) => {
      btn.addEventListener("click", () => abrirFormulario(linha, p, btn.dataset.acao));
    });
  });
}

// ---------- Formulários de Entrada / Ajuste ----------

function abrirFormulario(linha, produto, acao) {
  const area = linha.querySelector(".ea-form");
  const rotulo = ROTULO_LOCAL[localAtual];

  if (acao === "entrada") {
    area.innerHTML = `
      <label>Quantos chegaram (${rotulo})?</label>
      <input type="number" min="1" inputmode="numeric" class="ea-qtd" />
      <label>Data de vencimento (opcional — se preencher, também cria o lote na Vistoria)</label>
      <input type="date" class="ea-data" />
      <div class="ea-form-botoes">
        <button type="button" class="btn ea-confirmar">Confirmar entrada</button>
        <button type="button" class="btn btn-secundario ea-cancelar">Cancelar</button>
      </div>
    `;
  } else {
    area.innerHTML = `
      <label>Contagem atual de ${esc(produto.nome)} em ${rotulo}</label>
      <input type="number" min="0" inputmode="numeric" class="ea-qtd" />
      <div class="ea-form-botoes">
        <button type="button" class="btn ea-confirmar">Confirmar contagem</button>
        <button type="button" class="btn btn-secundario ea-cancelar">Cancelar</button>
      </div>
    `;
  }

  area.hidden = false;
  area.querySelector(".ea-qtd").focus();

  area.querySelector(".ea-cancelar").addEventListener("click", () => {
    area.hidden = true;
    area.innerHTML = "";
  });

  area.querySelector(".ea-confirmar").addEventListener("click", async (evento) => {
    const botao = evento.currentTarget;
    const valor = area.querySelector(".ea-qtd").value;

    if (valor === "" || !Number.isFinite(Number(valor))) {
      mostrarToast("Informe a quantidade.", "erro");
      return;
    }
    const quantidade = Math.floor(Number(valor));

    if (acao === "entrada" && quantidade < 1) {
      mostrarToast("A entrada precisa ser de pelo menos 1.", "erro");
      return;
    }
    if (acao === "ajuste" && quantidade < 0) {
      mostrarToast("A contagem não pode ser negativa.", "erro");
      return;
    }

    botao.disabled = true;
    const textoOriginal = botao.textContent;
    botao.textContent = "Salvando…";

    try {
      if (acao === "entrada") {
        await registrarEntrada(produto, quantidade, area.querySelector(".ea-data").value);
        mostrarToast(`Entrada de ${quantidade} registrada em ${rotulo}.`, "ok");
      } else {
        await registrarAjuste(produto, quantidade);
        mostrarToast(`Contagem de ${rotulo} atualizada.`, "ok");
      }
      renderizarLista();
    } catch (erro) {
      console.error(erro);
      mostrarToast("Não salvou — verifique a conexão e tente de novo.", "erro");
      botao.disabled = false;
      botao.textContent = textoOriginal;
    }
  });
}

function dadosMovimento(produto, tipo, delta, antes, depois) {
  return {
    estabelecimentoId: estabelecimentoAtual.id,
    produtoId: produto.id,
    produtoNome: produto.nome,
    local: localAtual,
    tipo,
    delta,
    antes,
    depois,
    origem: "estoque",
    registradoEm: serverTimestamp(),
  };
}

// Entrada soma com increment() (atômico): mesmo que outra aba/aparelho mexa
// no mesmo produto ao mesmo tempo, as somas não se perdem.
async function registrarEntrada(produto, quantidade, dataVencimento) {
  const atual = estoqueMap[produto.id] || { geladeira: 0, seco: 0 };
  const antes = atual[localAtual];
  const batch = writeBatch(db);

  batch.set(
    doc(db, "estoque", produto.id),
    {
      estabelecimentoId: estabelecimentoAtual.id,
      produtoId: produto.id,
      produtoNome: produto.nome,
      [localAtual]: increment(quantidade),
      atualizadoEm: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(doc(collection(db, "movimentosEstoque")), dadosMovimento(produto, "entrada", quantidade, antes, antes + quantidade));

  // Com data informada, a mesma entrada cria o lote na Vistoria, para não
  // precisar digitar duas vezes. Sem data, só entra no estoque.
  if (dataVencimento) {
    batch.set(doc(collection(db, "lotes")), {
      estabelecimentoId: estabelecimentoAtual.id,
      produtoId: produto.id,
      produtoNome: produto.nome,
      precoCusto: produto.precoCusto ?? 0,
      diasAlerta: produto.diasAlerta ?? null,
      quantidade,
      local: LOCAL_DO_LOTE[localAtual],
      dataVencimento,
      promocaoAtiva: false,
      precoPromocional: null,
    });
  }

  await batch.commit();
  estoqueMap[produto.id] = { ...atual, [localAtual]: antes + quantidade };
}

// Ajuste grava o número contado (valor absoluto) no local escolhido.
async function registrarAjuste(produto, novoValor) {
  const atual = estoqueMap[produto.id] || { geladeira: 0, seco: 0 };
  const antes = atual[localAtual];
  const batch = writeBatch(db);

  batch.set(
    doc(db, "estoque", produto.id),
    {
      estabelecimentoId: estabelecimentoAtual.id,
      produtoId: produto.id,
      produtoNome: produto.nome,
      [localAtual]: novoValor,
      atualizadoEm: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(doc(collection(db, "movimentosEstoque")), dadosMovimento(produto, "ajuste", novoValor - antes, antes, novoValor));

  await batch.commit();
  estoqueMap[produto.id] = { ...atual, [localAtual]: novoValor };
}

// ---------- Importação única dos lotes sem data (levantamento do seco) ----------
// Travas contra duplicidade:
//  1) grava o NÚMERO (não soma): rodar de novo não dobra;
//  2) só importa produto que ainda não tem estoque contado;
//  3) mostra uma conferência antes de confirmar;
//  4) os lotes importados ficam marcados e somem da Vistoria, então o painel
//     desaparece sozinho quando não resta nada para importar.

async function prepararImportacao() {
  const painel = document.getElementById("painel-importacao");
  const snap = await getDocs(query(collection(db, "lotes"), where("estabelecimentoId", "==", estabelecimentoAtual.id)));

  const candidatos = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => !l.dataVencimento && !l.importadoParaEstoque && l.produtoId);

  const porProduto = {};
  candidatos.forEach((l) => {
    if (!porProduto[l.produtoId]) {
      const produto = produtos.find((p) => p.id === l.produtoId);
      porProduto[l.produtoId] = {
        produtoId: l.produtoId,
        nome: l.produtoNome || produto?.nome || "(sem nome)",
        geladeira: 0,
        seco: 0,
        loteIds: [],
      };
    }
    const item = porProduto[l.produtoId];
    if (l.local === "Geladeira") item.geladeira += numero(l.quantidade);
    else item.seco += numero(l.quantidade);
    item.loteIds.push(l.id);
  });

  const itens = [];
  const ignorados = [];
  Object.values(porProduto).forEach((item) => {
    if (estoqueMap[item.produtoId] !== undefined) ignorados.push(item);
    else itens.push(item);
  });

  if (itens.length === 0 && ignorados.length === 0) {
    painel.hidden = true;
    planoImportacao = null;
    return;
  }

  planoImportacao = { itens, ignorados };

  document.getElementById("texto-importacao").textContent =
    itens.length > 0
      ? "Estes lotes sem data viram contagem de estoque. Confira antes de confirmar — depois de importados, eles saem da lista da Vistoria."
      : "Nada novo para importar: os produtos abaixo já têm estoque contado, então foram ignorados.";

  document.getElementById("conferencia-importacao").innerHTML =
    itens
      .map((i) => `<div class="linha-estoque"><div class="linha-estoque-nome">${esc(i.nome)}</div><div class="linha-estoque-qtd">Geladeira ${i.geladeira} · Seco ${i.seco}</div></div>`)
      .join("") +
    ignorados
      .map((i) => `<div class="linha-estoque"><div class="linha-estoque-nome">${esc(i.nome)}</div><div class="linha-estoque-qtd">já tem estoque — ignorado</div></div>`)
      .join("");

  document.getElementById("btn-confirmar-importacao").hidden = itens.length === 0;
  painel.hidden = false;
}

// Agrupa por produto, sem estourar o limite de 500 operações por lote de escrita.
function dividirEmGrupos(itens) {
  const grupos = [];
  let atual = [];
  let operacoes = 0;
  itens.forEach((item) => {
    const custo = 2 + item.loteIds.length;
    if (operacoes + custo > 400 && atual.length > 0) {
      grupos.push(atual);
      atual = [];
      operacoes = 0;
    }
    atual.push(item);
    operacoes += custo;
  });
  if (atual.length > 0) grupos.push(atual);
  return grupos;
}

document.getElementById("btn-confirmar-importacao").addEventListener("click", async (evento) => {
  if (!planoImportacao || planoImportacao.itens.length === 0) return;

  const botao = evento.currentTarget;
  botao.disabled = true;
  const textoOriginal = botao.textContent;
  botao.textContent = "Importando…";

  try {
    for (const grupo of dividirEmGrupos(planoImportacao.itens)) {
      const batch = writeBatch(db);
      grupo.forEach((item) => {
        // set SEM merge e com valor absoluto: idempotente.
        batch.set(doc(db, "estoque", item.produtoId), {
          estabelecimentoId: estabelecimentoAtual.id,
          produtoId: item.produtoId,
          produtoNome: item.nome,
          geladeira: item.geladeira,
          seco: item.seco,
          atualizadoEm: serverTimestamp(),
        });
        batch.set(doc(collection(db, "movimentosEstoque")), {
          estabelecimentoId: estabelecimentoAtual.id,
          produtoId: item.produtoId,
          produtoNome: item.nome,
          local: "ambos",
          tipo: "importacao",
          geladeira: item.geladeira,
          seco: item.seco,
          origem: "estoque",
          registradoEm: serverTimestamp(),
        });
        item.loteIds.forEach((id) => batch.update(doc(db, "lotes", id), { importadoParaEstoque: true }));
      });
      await batch.commit();
    }

    mostrarToast("Importação concluída.", "ok");
    await carregarTudo();
  } catch (erro) {
    console.error(erro);
    mostrarToast("A importação falhou. Nada foi duplicado — pode tentar de novo.", "erro");
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
});
