import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { mostrarToast } from "./toast.js";
import { confirmarAcao } from "./modal.js";
import { escapeHtml } from "./status.js";
import { chaveOpcao } from "./opcoes-produto.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  writeBatch,
  increment,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

const COL_ITENS = "cozinhaItens";
const COL_MOV = "cozinhaMovimentos";
const ESPERA_SALVAR_MS = 700;

// Lista que a colega já tinha feito (os números foram ignorados de propósito).
const ITENS_INICIAIS = [
  "Queijo fatiado",
  "Calabresa",
  "Presunto fatiado",
  "Requeijão",
  "Presunto para fatiar",
  "Lombinho",
  "Queijo para ralar",
  "Queijo provolone (meio)",
  "Baicon",
  "Hambúrguer de costela",
  "Hambúrguer de frango",
  "Salsicha",
  "Espetinho",
  "Leite condensado",
];

let estabelecimentoAtual = null;
let itens = [];
let movimentos = [];
let abaAtual = "lista";
let textoEditado = false;
let graficoLinha = null;
let graficoItens = null;

// Toques em + e − são somados e gravados juntos depois de uma pequena pausa,
// para não gerar uma escrita no banco a cada clique.
const pendentes = new Map();

const $ = (id) => document.getElementById(id);
const lista = $("lista-cozinha");
const campoBusca = $("campo-busca");
const campoTexto = $("texto-lista-whatsapp");

// ---------- Utilidades ----------

function qtd(item) {
  return Math.max(0, Number(item.quantidade) || 0);
}

function itensAtivos() {
  return itens.filter((i) => i.ativo !== false);
}

function ordenarItens() {
  itens.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR", { sensitivity: "base" }));
}

function dataDoMov(m) {
  const v = m.registradoEm;
  if (v && typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  return null;
}

function chaveDia(data) {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0"),
  ].join("-");
}

// ---------- Carregamento ----------

async function carregarDados() {
  const filtro = where("estabelecimentoId", "==", estabelecimentoAtual.id);
  const itensSnap = await getDocs(query(collection(db, COL_ITENS), filtro));
  itens = itensSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  ordenarItens();

  // O histórico é complementar: se falhar, a lista continua funcionando.
  try {
    const movSnap = await getDocs(query(collection(db, COL_MOV), filtro));
    movimentos = movSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (erro) {
    console.error("Histórico da cozinha indisponível:", erro);
    movimentos = [];
    mostrarToast("Não foi possível carregar o histórico. Confira as regras do Firestore.", "erro");
  }
}

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  $("nome-estabelecimento").textContent = estabelecimento.nome;
  try {
    await carregarDados();
    depoisDeMudarItens();
  } catch (erro) {
    console.error(erro);
    lista.innerHTML =
      '<p class="mensagem-vazio">Não foi possível carregar a lista da cozinha. Confira se as regras do Firestore para cozinhaItens e cozinhaMovimentos foram publicadas.</p>';
  }
});

function depoisDeMudarItens() {
  ordenarItens();
  renderizarLista();
  atualizarTotais();
  preencherFiltroProduto();
}

// ---------- Abas ----------

const abas = {
  lista: { botao: $("seg-lista"), secao: $("secao-lista") },
  whatsapp: { botao: $("seg-whatsapp"), secao: $("secao-whatsapp") },
  dashboard: { botao: $("seg-dashboard"), secao: $("secao-dashboard") },
};

async function mostrarAba(nome) {
  abaAtual = nome;
  Object.entries(abas).forEach(([chave, { botao, secao }]) => {
    const ativa = chave === nome;
    secao.hidden = !ativa;
    botao.classList.toggle("ativo", ativa);
    botao.setAttribute("aria-selected", String(ativa));
  });

  if (nome === "lista") return;

  // Garante que o que foi tocado por último já está gravado antes de mostrar
  // o texto ou o histórico.
  await enviarTodosPendentes();
  if (abaAtual !== nome) return;

  if (nome === "whatsapp") {
    if (textoEditado) atualizarAcoesWhatsApp();
    else gerarTextoWhatsApp();
  } else if (nome === "dashboard") {
    renderizarDashboard();
  }
}

abas.lista.botao.addEventListener("click", () => mostrarAba("lista"));
abas.whatsapp.botao.addEventListener("click", () => mostrarAba("whatsapp"));
abas.dashboard.botao.addEventListener("click", () => mostrarAba("dashboard"));

// ---------- Lista: renderização ----------

function cartaoHtml(item) {
  const q = qtd(item);
  const nome = escapeHtml(item.nome);
  return `
    <article class="cozinha-item${q > 0 ? " cozinha-item--pedido" : ""}" data-id="${escapeHtml(item.id)}">
      <div class="cozinha-item-info">
        <div class="cozinha-item-nome">${nome}</div>
        ${item.unidade ? `<div class="cozinha-item-unidade">${escapeHtml(item.unidade)}</div>` : ""}
        <div class="cozinha-item-acoes">
          <button type="button" class="btn-texto" data-acao="renomear">Renomear</button>
          <button type="button" class="btn-texto" data-acao="remover">Remover</button>
        </div>
      </div>
      <div class="stepper">
        <button type="button" data-acao="menos" aria-label="Diminuir ${nome}">−</button>
        <input type="number" class="cozinha-qtd" min="0" step="1" inputmode="numeric" value="${q}" aria-label="Quantidade a pedir de ${nome}" />
        <button type="button" data-acao="mais" aria-label="Aumentar ${nome}">+</button>
      </div>
    </article>`;
}

function renderizarLista() {
  const ativos = itensAtivos();

  if (!itens.length) {
    lista.innerHTML = `
      <div class="painel estado-vazio">
        <p>A lista da cozinha ainda está vazia.</p>
        <button type="button" class="btn" data-acao="seed">Cadastrar os ${ITENS_INICIAIS.length} itens da lista atual</button>
      </div>`;
    return;
  }

  if (!ativos.length) {
    lista.innerHTML = '<p class="mensagem-vazio">Nenhum item ativo. Use "Acrescentar produto" abaixo.</p>';
    return;
  }

  const busca = campoBusca.value.trim().toLocaleLowerCase("pt-BR");
  const visiveis = ativos.filter((i) => !busca || String(i.nome).toLocaleLowerCase("pt-BR").includes(busca));

  if (!visiveis.length) {
    lista.innerHTML = '<p class="mensagem-vazio">Nenhum item encontrado.</p>';
    return;
  }

  lista.innerHTML = visiveis.map(cartaoHtml).join("");
}

function atualizarCartao(item) {
  const card = lista.querySelector(`[data-id="${CSS.escape(item.id)}"]`);
  if (!card) return;
  card.classList.toggle("cozinha-item--pedido", qtd(item) > 0);
  card.querySelector(".cozinha-qtd").value = qtd(item);
}

function atualizarTotais() {
  const ativos = itensAtivos();
  const comPedido = ativos.filter((i) => qtd(i) > 0);
  const unidades = comPedido.reduce((soma, i) => soma + qtd(i), 0);
  $("topo-total-itens").textContent = String(ativos.length);
  $("topo-itens-pedir").textContent = String(comPedido.length);
  $("topo-unidades").textContent = String(unidades);
  $("btn-zerar-pedidos").disabled = comPedido.length === 0;
}

campoBusca.addEventListener("input", renderizarLista);

$("toggle-edicao").addEventListener("change", (e) => {
  lista.classList.toggle("modo-edicao", e.target.checked);
});

// ---------- Lista: + e − ----------

function alterarQuantidade(id, delta) {
  const item = itens.find((i) => i.id === id);
  if (!item || !delta) return;

  const atual = qtd(item);
  const novo = Math.max(0, atual + delta);
  const real = novo - atual;
  if (!real) return;

  item.quantidade = novo;

  const pendente = pendentes.get(id) || { delta: 0, timer: null };
  pendente.delta += real;
  clearTimeout(pendente.timer);
  pendente.timer = setTimeout(() => enviarPendente(id), ESPERA_SALVAR_MS);
  pendentes.set(id, pendente);

  atualizarCartao(item);
  atualizarTotais();
  if (abaAtual === "whatsapp" && !textoEditado) gerarTextoWhatsApp();
}

async function enviarPendente(id) {
  const pendente = pendentes.get(id);
  if (!pendente) return;
  clearTimeout(pendente.timer);
  pendentes.delete(id);
  if (!pendente.delta) return;

  const item = itens.find((i) => i.id === id);
  if (!item) return;

  const movRef = doc(collection(db, COL_MOV));
  const mov = {
    estabelecimentoId: estabelecimentoAtual.id,
    itemId: id,
    itemNome: item.nome,
    tipo: "ajuste",
    delta: pendente.delta,
    registradoEm: serverTimestamp(),
  };

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, COL_ITENS, id), {
      quantidade: increment(pendente.delta),
      atualizadoEm: serverTimestamp(),
    });
    batch.set(movRef, mov);
    await batch.commit();
    movimentos.push({ id: movRef.id, ...mov, registradoEm: Timestamp.now() });
  } catch (erro) {
    console.error(erro);
    item.quantidade = Math.max(0, qtd(item) - pendente.delta);
    atualizarCartao(item);
    atualizarTotais();
    mostrarToast("Não foi possível salvar a alteração. Tente de novo.", "erro");
  }
}

async function enviarTodosPendentes() {
  await Promise.all([...pendentes.keys()].map((id) => enviarPendente(id)));
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") enviarTodosPendentes();
});
window.addEventListener("pagehide", () => {
  enviarTodosPendentes();
});

lista.addEventListener("click", async (e) => {
  const botao = e.target.closest("[data-acao]");
  if (!botao) return;
  const acao = botao.dataset.acao;

  if (acao === "seed") {
    await cadastrarItensIniciais(botao);
    return;
  }

  const card = botao.closest("[data-id]");
  if (!card) return;
  const id = card.dataset.id;

  if (acao === "mais") alterarQuantidade(id, 1);
  else if (acao === "menos") alterarQuantidade(id, -1);
  else if (acao === "renomear") await renomearItem(id);
  else if (acao === "remover") await removerItem(id);
});

lista.addEventListener("change", (e) => {
  const campo = e.target.closest(".cozinha-qtd");
  if (!campo) return;
  const item = itens.find((i) => i.id === campo.closest("[data-id]").dataset.id);
  if (!item) return;

  const valor = Number(campo.value);
  if (campo.value === "" || !Number.isInteger(valor) || valor < 0) {
    campo.value = qtd(item);
    mostrarToast("Informe um número inteiro igual ou maior que zero.", "erro");
    return;
  }
  alterarQuantidade(item.id, valor - qtd(item));
});

// ---------- Lista: cadastro, renomear, remover ----------

async function adicionarItens(entradas) {
  const existentes = new Map(itens.map((i) => [chaveOpcao(i.nome), i]));
  const vistos = new Set();
  const batch = writeBatch(db);
  const novos = [];
  const reativados = [];
  let ignorados = 0;

  entradas.forEach(({ nome, unidade }) => {
    const limpo = String(nome || "").trim();
    if (!limpo) return;
    const chave = chaveOpcao(limpo);

    if (vistos.has(chave)) {
      ignorados++;
      return;
    }
    vistos.add(chave);

    const existente = existentes.get(chave);
    if (existente) {
      if (existente.ativo === false) {
        batch.update(doc(db, COL_ITENS, existente.id), {
          ativo: true,
          quantidade: 0,
          atualizadoEm: serverTimestamp(),
        });
        reativados.push(existente);
      } else {
        ignorados++;
      }
      return;
    }

    const ref = doc(collection(db, COL_ITENS));
    const dados = {
      estabelecimentoId: estabelecimentoAtual.id,
      nome: limpo,
      unidade: String(unidade || "").trim(),
      ativo: true,
      quantidade: 0,
      criadoEm: serverTimestamp(),
    };
    batch.set(ref, dados);
    novos.push({ id: ref.id, ...dados, criadoEm: Timestamp.now() });
  });

  if (!novos.length && !reativados.length) {
    return { criados: 0, reativados: 0, ignorados };
  }

  await batch.commit();
  novos.forEach((n) => itens.push(n));
  reativados.forEach((r) => {
    r.ativo = true;
    r.quantidade = 0;
  });
  return { criados: novos.length, reativados: reativados.length, ignorados };
}

async function cadastrarItensIniciais(botao) {
  botao.disabled = true;
  try {
    const r = await adicionarItens(ITENS_INICIAIS.map((nome) => ({ nome, unidade: "" })));
    depoisDeMudarItens();
    mostrarToast(`${r.criados} itens cadastrados.`, "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível cadastrar os itens. Confira as regras do Firestore.", "erro");
    botao.disabled = false;
  }
}

$("form-novo-item").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nome = $("novo-nome").value.trim();
  const unidade = $("novo-unidade").value.trim();
  if (!nome) return;

  const botao = e.submitter;
  botao.disabled = true;
  try {
    const r = await adicionarItens([{ nome, unidade }]);
    if (r.criados || r.reativados) {
      depoisDeMudarItens();
      e.target.reset();
      $("novo-nome").focus();
      mostrarToast(r.criados ? "Item adicionado à lista." : "Item voltou para a lista.", "ok");
    } else {
      mostrarToast("Este item já está na lista.", "erro");
    }
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível adicionar o item.", "erro");
  } finally {
    botao.disabled = false;
  }
});

// "Calabresa: 10", "* Calabresa", "1. Calabresa" → "Calabresa"
function limparLinha(linha) {
  return linha
    .replace(/^\s*(?:[-*•·]+|\d+\s*[.)])\s*/, "")
    .replace(/\s*[:\-–—]\s*\d+(?:[.,]\d+)?\s*[a-zA-Z.]*\s*$/, "")
    .trim();
}

$("btn-colar-lista").addEventListener("click", async (e) => {
  const linhas = $("texto-colar").value.split(/\r?\n/).map(limparLinha).filter(Boolean);
  if (!linhas.length) {
    mostrarToast("Cole pelo menos um produto.", "erro");
    return;
  }
  if (linhas.length > 400) {
    mostrarToast("Cole no máximo 400 linhas por vez.", "erro");
    return;
  }

  const botao = e.currentTarget;
  botao.disabled = true;
  try {
    const r = await adicionarItens(linhas.map((nome) => ({ nome, unidade: "" })));
    depoisDeMudarItens();
    $("texto-colar").value = "";
    const partes = [`${r.criados} novo(s)`];
    if (r.reativados) partes.push(`${r.reativados} de volta à lista`);
    if (r.ignorados) partes.push(`${r.ignorados} já existia(m)`);
    mostrarToast(partes.join(" · ") + ".", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível cadastrar a lista colada.", "erro");
  } finally {
    botao.disabled = false;
  }
});

async function renomearItem(id) {
  const item = itens.find((i) => i.id === id);
  if (!item) return;

  const resposta = window.prompt("Novo nome do item:", item.nome);
  if (resposta === null) return;
  const nome = resposta.trim();
  if (!nome) {
    mostrarToast("O nome não pode ficar vazio.", "erro");
    return;
  }
  const chave = chaveOpcao(nome);
  if (itens.some((i) => i.id !== id && chaveOpcao(i.nome) === chave)) {
    mostrarToast("Já existe um item com esse nome.", "erro");
    return;
  }

  try {
    await updateDoc(doc(db, COL_ITENS, id), { nome, atualizadoEm: serverTimestamp() });
    item.nome = nome;
    depoisDeMudarItens();
    mostrarToast("Item renomeado.", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível renomear.", "erro");
  }
}

async function removerItem(id) {
  const item = itens.find((i) => i.id === id);
  if (!item) return;
  await enviarPendente(id);

  const confirmou = await confirmarAcao({
    titulo: "Remover da lista?",
    mensagem: `"${item.nome}" sai da lista da cozinha. O histórico dele continua na Dashboard.`,
    textoConfirmar: "Remover",
    perigo: true,
  });
  if (!confirmou) return;

  try {
    await updateDoc(doc(db, COL_ITENS, id), {
      ativo: false,
      quantidade: 0,
      atualizadoEm: serverTimestamp(),
    });
    item.ativo = false;
    item.quantidade = 0;
    depoisDeMudarItens();
    mostrarToast("Item removido da lista.", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível remover.", "erro");
  }
}

// ---------- WhatsApp ----------

function gerarTextoWhatsApp() {
  const pedidos = itensAtivos().filter((i) => qtd(i) > 0);
  const linhas = [
    "🍳 PEDIDO DA COZINHA",
    new Date().toLocaleDateString("pt-BR"),
    "",
    ...(pedidos.length
      ? pedidos.map((i) => `• ${i.nome} — ${qtd(i)} ${i.unidade || "un."}`)
      : ["Nenhum item marcado para pedir."]),
  ];
  campoTexto.value = linhas.join("\n");
  textoEditado = false;
  atualizarAcoesWhatsApp();
}

function atualizarAcoesWhatsApp() {
  const pedidos = itensAtivos().filter((i) => qtd(i) > 0);
  const unidades = pedidos.reduce((soma, i) => soma + qtd(i), 0);
  $("wa-itens").textContent = String(pedidos.length);
  $("wa-unidades").textContent = String(unidades);

  const texto = campoTexto.value.trim();
  const habilitado = !!texto && (pedidos.length > 0 || textoEditado);
  $("btn-copiar-lista").disabled = !habilitado;

  const link = $("link-abrir-whatsapp");
  link.setAttribute("aria-disabled", String(!habilitado));
  link.href = habilitado ? "https://wa.me/?text=" + encodeURIComponent(campoTexto.value) : "#";
}

campoTexto.addEventListener("input", () => {
  textoEditado = true;
  atualizarAcoesWhatsApp();
});

$("btn-regerar").addEventListener("click", gerarTextoWhatsApp);

$("btn-copiar-lista").addEventListener("click", async () => {
  if (!campoTexto.value.trim()) {
    mostrarToast("Não há lista para copiar.", "erro");
    return;
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(campoTexto.value);
    } else {
      campoTexto.focus();
      campoTexto.select();
      if (!document.execCommand("copy")) throw new Error("Cópia não disponível");
    }
    mostrarToast("Lista copiada. Agora é só colar no WhatsApp.", "ok");
  } catch (erro) {
    console.error(erro);
    campoTexto.focus();
    campoTexto.select();
    mostrarToast("Selecione o texto e copie manualmente.", "erro");
  }
});

$("btn-zerar-pedidos").addEventListener("click", async (e) => {
  await enviarTodosPendentes();
  const comPedido = itensAtivos().filter((i) => qtd(i) > 0);
  if (!comPedido.length) return;

  const confirmou = await confirmarAcao({
    titulo: "Zerar todos os pedidos?",
    mensagem: `${comPedido.length} item(ns) voltam para zero. A lista de produtos e o histórico da Dashboard continuam.`,
    textoConfirmar: "Zerar pedidos",
    perigo: true,
  });
  if (!confirmou) return;

  const botao = e.currentTarget;
  botao.disabled = true;
  try {
    for (let i = 0; i < comPedido.length; i += 200) {
      const batch = writeBatch(db);
      comPedido.slice(i, i + 200).forEach((item) => {
        batch.update(doc(db, COL_ITENS, item.id), { quantidade: 0, atualizadoEm: serverTimestamp() });
        batch.set(doc(collection(db, COL_MOV)), {
          estabelecimentoId: estabelecimentoAtual.id,
          itemId: item.id,
          itemNome: item.nome,
          tipo: "zerar",
          delta: -qtd(item),
          registradoEm: serverTimestamp(),
        });
      });
      await batch.commit();
    }
    comPedido.forEach((item) => {
      item.quantidade = 0;
    });
    renderizarLista();
    atualizarTotais();
    gerarTextoWhatsApp();
    mostrarToast("Pedidos zerados. Pronto para um novo pedido.", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível zerar. Recarregando a lista…", "erro");
    try {
      await carregarDados();
      depoisDeMudarItens();
      gerarTextoWhatsApp();
    } catch (e2) {
      console.error(e2);
    }
  }
});

// ---------- Dashboard ----------

function preencherFiltroProduto() {
  const select = $("filtro-produto-cozinha");
  const atual = select.value || "todos";
  select.innerHTML =
    '<option value="todos">Todos os produtos (total)</option>' +
    itens
      .map(
        (i) =>
          `<option value="${escapeHtml(i.id)}">${escapeHtml(i.nome)}${i.ativo === false ? " (removido)" : ""}</option>`
      )
      .join("");
  select.value = [...select.options].some((o) => o.value === atual) ? atual : "todos";
}

$("filtro-periodo-cozinha").addEventListener("change", renderizarDashboard);
$("filtro-produto-cozinha").addEventListener("change", renderizarDashboard);

function renderizarDashboard() {
  const dias = Number($("filtro-periodo-cozinha").value) || 30;
  const produto = $("filtro-produto-cozinha").value || "todos";

  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  inicio.setDate(inicio.getDate() - (dias - 1));
  const fim = new Date();
  fim.setHours(23, 59, 59, 999);

  // Só "ajuste" (+ e −) conta como pedido. "zerar" é apenas a virada de rodada.
  const ajustes = movimentos
    .filter((m) => m.tipo === "ajuste")
    .map((m) => ({ ...m, data: dataDoMov(m) }))
    .filter((m) => m.data && m.data >= inicio && m.data <= fim);

  // ----- Série por dia (respeita o filtro de produto) -----
  const porDia = new Map();
  for (let i = 0; i < dias; i++) {
    const data = new Date(inicio);
    data.setDate(inicio.getDate() + i);
    porDia.set(chaveDia(data), { data, total: 0 });
  }
  ajustes
    .filter((m) => produto === "todos" || m.itemId === produto)
    .forEach((m) => {
      const dia = porDia.get(chaveDia(m.data));
      if (dia) dia.total += Number(m.delta) || 0;
    });
  const serie = [...porDia.values()].map((d) => ({ ...d, total: Math.max(0, d.total) }));
  const unidadesPeriodo = serie.reduce((soma, d) => soma + d.total, 0);
  const diasComPedido = serie.filter((d) => d.total > 0).length;

  const itemSelecionado = itens.find((i) => i.id === produto);
  const nomeSerie = produto === "todos" ? "Todos os produtos" : itemSelecionado ? itemSelecionado.nome : "Produto";

  // ----- Indicadores -----
  const ativos = itensAtivos();
  const comPedido = ativos.filter((i) => qtd(i) > 0);
  const unidadesAgora = comPedido.reduce((soma, i) => soma + qtd(i), 0);
  $("dash-total-itens").textContent = String(ativos.length);
  $("dash-pedir-agora").textContent = String(comPedido.length);
  $("dash-pedir-legenda").textContent = `${unidadesAgora} unidade(s) marcadas`;
  $("dash-unidades-periodo").textContent = String(unidadesPeriodo);
  $("dash-unidades-legenda").textContent = `${nomeSerie} · ${dias} dias`;
  $("dash-dias-pedido").textContent = String(diasComPedido);
  $("legenda-linha").textContent = `Unidades pedidas em cada dia — ${nomeSerie}.`;

  // ----- Gráfico de linha -----
  if (graficoLinha) {
    graficoLinha.destroy();
    graficoLinha = null;
  }
  const canvasLinha = $("grafico-cozinha-linha");
  const semLinha = $("sem-dados-linha");
  if (unidadesPeriodo === 0) {
    canvasLinha.hidden = true;
    semLinha.hidden = false;
  } else {
    canvasLinha.hidden = false;
    semLinha.hidden = true;
    const rotulosCompletos = serie.map((d) =>
      d.data.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })
    );
    graficoLinha = new Chart(canvasLinha, {
      type: "line",
      data: {
        labels: serie.map((d) => d.data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })),
        datasets: [
          {
            label: nomeSerie,
            data: serie.map((d) => d.total),
            borderColor: "#235571",
            backgroundColor: "rgba(35, 85, 113, 0.12)",
            fill: true,
            tension: 0.25,
            borderWidth: 2,
            pointRadius: dias > 30 ? 1 : 3,
            pointHoverRadius: 5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (itensTooltip) => rotulosCompletos[itensTooltip[0].dataIndex],
              label: (ctx) => `${ctx.parsed.y} unidade(s)`,
            },
          },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
          x: { ticks: { maxTicksLimit: 8, maxRotation: 0, minRotation: 0 } },
        },
      },
    });
  }

  // ----- Ranking de itens (considera todos os produtos) -----
  const porItem = new Map();
  ajustes.forEach((m) => {
    const atual = porItem.get(m.itemId) || { itemId: m.itemId, nome: m.itemNome || "Item", total: 0 };
    atual.total += Number(m.delta) || 0;
    porItem.set(m.itemId, atual);
  });
  const ranking = [...porItem.values()]
    .map((r) => {
      const item = itens.find((i) => i.id === r.itemId);
      return { nome: item ? item.nome : r.nome, total: Math.max(0, r.total) };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, 10);

  if (graficoItens) {
    graficoItens.destroy();
    graficoItens = null;
  }
  const canvasItens = $("grafico-cozinha-itens");
  const areaItens = $("area-grafico-cozinha-itens");
  const semItens = $("sem-dados-itens");
  if (!ranking.length) {
    canvasItens.hidden = true;
    areaItens.style.height = "auto";
    semItens.hidden = false;
  } else {
    canvasItens.hidden = false;
    semItens.hidden = true;
    areaItens.style.height = `${Math.max(200, ranking.length * 36)}px`;
    graficoItens = new Chart(canvasItens, {
      type: "bar",
      data: {
        labels: ranking.map((r) => r.nome),
        datasets: [{ label: "Unidades", data: ranking.map((r) => r.total), backgroundColor: "#235571", borderRadius: 4 }],
      },
      options: {
        indexAxis: "y",
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.x} unidade(s)` } },
        },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } },
          y: { ticks: { autoSkip: false } },
        },
      },
    });
  }

  // ----- Pedido atual -----
  const containerAtual = $("dash-lista-atual");
  if (!comPedido.length) {
    containerAtual.innerHTML = '<p class="mensagem-vazio">Nenhum item marcado para pedir agora.</p>';
  } else {
    containerAtual.innerHTML = comPedido
      .map(
        (i) =>
          `<div class="cozinha-linha-atual"><span>${escapeHtml(i.nome)}</span><span>${qtd(i)} ${escapeHtml(i.unidade || "un.")}</span></div>`
      )
      .join("");
  }
}
