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
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

const COL_ITENS = "cozinhaItens";
const COL_PEDIDOS = "cozinhaPedidos";
const LIMITE_PEDIDOS_LISTA = 30;

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
let usuarioAtual = null;
let itens = [];
let pedidos = [];
let abaAtual = "lista";
let textoEditado = false;
let salvando = false;
let pedidoSelecionado = null;
let waItens = 0;
let waUnidades = 0;
let graficoLinha = null;
let graficoItens = null;

// Pedido em andamento (rascunho): itemId -> quantidade. Fica só neste aparelho
// até o botão "Salvar pedido" gravar tudo de uma vez.
const quantidades = new Map();

const $ = (id) => document.getElementById(id);
const lista = $("lista-cozinha");
const campoBusca = $("campo-busca");
const campoTexto = $("texto-lista-whatsapp");

// ---------- Utilidades ----------

function qtd(item) {
  return quantidades.get(item.id) || 0;
}

function itensAtivos() {
  return itens.filter((i) => i.ativo !== false);
}

function itensMarcados() {
  return itensAtivos().filter((i) => qtd(i) > 0);
}

function ordenarItens() {
  itens.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR", { sensitivity: "base" }));
}

function chaveDia(data) {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0"),
  ].join("-");
}

function dataDoPedido(p) {
  const v = p.data;
  if (v && typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  if (p.dia) return new Date(p.dia + "T12:00:00");
  return null;
}

function diaDoPedido(p) {
  if (p.dia) return p.dia;
  const d = dataDoPedido(p);
  return d ? chaveDia(d) : "";
}

function ordenarPedidos() {
  pedidos.sort((a, b) => (dataDoPedido(b)?.getTime() || 0) - (dataDoPedido(a)?.getTime() || 0));
}

function formatarData(d) {
  return d ? d.toLocaleDateString("pt-BR") : "—";
}

function formatarHora(d) {
  return d ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
}

function somaUnidades(listaItens) {
  return (listaItens || []).reduce((soma, i) => soma + (Number(i.quantidade) || 0), 0);
}

// ---------- Rascunho local ----------

function chaveRascunho() {
  return `cozinha:rascunho:${estabelecimentoAtual.id}`;
}

function salvarRascunhoLocal() {
  try {
    const obj = {};
    quantidades.forEach((valor, id) => {
      if (valor > 0) obj[id] = valor;
    });
    localStorage.setItem(chaveRascunho(), JSON.stringify(obj));
  } catch (e) {
    /* sem localStorage: o rascunho só vale enquanto a página estiver aberta */
  }
}

function carregarRascunhoLocal() {
  quantidades.clear();
  try {
    const obj = JSON.parse(localStorage.getItem(chaveRascunho()) || "{}");
    const ativos = new Set(itensAtivos().map((i) => i.id));
    Object.entries(obj).forEach(([id, valor]) => {
      const n = Math.floor(Number(valor));
      if (ativos.has(id) && n > 0) quantidades.set(id, n);
    });
  } catch (e) {
    /* rascunho ilegível: começa vazio */
  }
}

// ---------- Carregamento ----------

async function carregarDados() {
  const filtro = where("estabelecimentoId", "==", estabelecimentoAtual.id);
  const itensSnap = await getDocs(query(collection(db, COL_ITENS), filtro));
  itens = itensSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  ordenarItens();

  // Os pedidos salvos são complementares: se falhar, a lista continua funcionando.
  try {
    const pedidosSnap = await getDocs(query(collection(db, COL_PEDIDOS), filtro));
    pedidos = pedidosSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    ordenarPedidos();
  } catch (erro) {
    console.error("Pedidos da cozinha indisponíveis:", erro);
    pedidos = [];
    mostrarToast("Não foi possível carregar os pedidos salvos. Confira as regras do Firestore.", "erro");
  }
}

protegerPagina(async ({ estabelecimento, user }) => {
  estabelecimentoAtual = estabelecimento;
  usuarioAtual = user;
  $("nome-estabelecimento").textContent = estabelecimento.nome;
  try {
    await carregarDados();
    carregarRascunhoLocal();
    depoisDeMudarItens();
  } catch (erro) {
    console.error(erro);
    lista.innerHTML =
      '<p class="mensagem-vazio">Não foi possível carregar a lista da cozinha. Confira se as regras do Firestore para cozinhaItens e cozinhaPedidos foram publicadas.</p>';
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

function mostrarAba(nome) {
  abaAtual = nome;
  Object.entries(abas).forEach(([chave, { botao, secao }]) => {
    const ativa = chave === nome;
    secao.hidden = !ativa;
    botao.classList.toggle("ativo", ativa);
    botao.setAttribute("aria-selected", String(ativa));
  });

  if (nome === "whatsapp") {
    preencherSelectPedidos();
    gerarTextoWhatsApp();
    renderizarPedidosSalvos();
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
  const marcados = itensMarcados();
  const unidades = marcados.reduce((soma, i) => soma + qtd(i), 0);
  const temPedido = marcados.length > 0;

  $("topo-total-itens").textContent = String(ativos.length);
  $("topo-itens-pedir").textContent = String(marcados.length);
  $("topo-unidades").textContent = String(unidades);

  $("aviso-rascunho").hidden = !temPedido;
  $("aviso-rascunho-texto").textContent =
    `Pedido em andamento, ainda não salvo: ${marcados.length} item(ns) · ${unidades} unidade(s).`;

  document.querySelectorAll(".btn-salvar-pedido").forEach((botao) => {
    botao.disabled = !temPedido || salvando;
  });
  $("btn-limpar-rascunho").disabled = !temPedido;
}

campoBusca.addEventListener("input", renderizarLista);

$("toggle-edicao").addEventListener("change", (e) => {
  lista.classList.toggle("modo-edicao", e.target.checked);
});

// ---------- Lista: + e − (só montam o rascunho) ----------

function definirQuantidade(id, valor) {
  const novo = Math.max(0, Math.floor(Number(valor) || 0));
  if (novo > 0) quantidades.set(id, novo);
  else quantidades.delete(id);
  salvarRascunhoLocal();

  const item = itens.find((i) => i.id === id);
  if (item) atualizarCartao(item);
  atualizarTotais();
}

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
  const item = itens.find((i) => i.id === id);
  if (!item) return;

  if (acao === "mais") definirQuantidade(id, qtd(item) + 1);
  else if (acao === "menos") definirQuantidade(id, qtd(item) - 1);
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
  definirQuantidade(item.id, valor);
});

$("btn-limpar-rascunho").addEventListener("click", async () => {
  if (!itensMarcados().length) return;
  const confirmou = await confirmarAcao({
    titulo: "Limpar o pedido em andamento?",
    mensagem: "As quantidades marcadas e ainda não salvas voltam para zero.",
    textoConfirmar: "Limpar",
    perigo: true,
  });
  if (!confirmou) return;
  quantidades.clear();
  salvarRascunhoLocal();
  renderizarLista();
  atualizarTotais();
});

// ---------- Salvar pedido ----------

async function salvarPedido() {
  if (salvando) return;
  const marcados = itensMarcados();
  if (!marcados.length) {
    mostrarToast("Marque pelo menos um item para salvar.", "erro");
    return;
  }

  const agora = new Date();
  const hoje = chaveDia(agora);
  if (pedidos.some((p) => diaDoPedido(p) === hoje)) {
    const confirmou = await confirmarAcao({
      titulo: "Já existe um pedido hoje",
      mensagem: "Já há um pedido salvo hoje. Este será salvo como outro pedido do mesmo dia e os dois somam na Dashboard. Continuar?",
      textoConfirmar: "Salvar mesmo assim",
    });
    if (!confirmou) return;
  }

  salvando = true;
  atualizarTotais();

  try {
    const itensPedido = marcados.map((i) => ({
      itemId: i.id,
      nome: i.nome,
      unidade: i.unidade || "",
      quantidade: qtd(i),
    }));
    const dados = {
      estabelecimentoId: estabelecimentoAtual.id,
      dia: hoje,
      data: serverTimestamp(),
      itens: itensPedido,
      totalItens: itensPedido.length,
      totalUnidades: somaUnidades(itensPedido),
      criadoPor: usuarioAtual?.uid || null,
    };
    const ref = await addDoc(collection(db, COL_PEDIDOS), dados);
    pedidos.push({ id: ref.id, ...dados, data: Timestamp.now() });
    ordenarPedidos();

    quantidades.clear();
    salvarRascunhoLocal();
    renderizarLista();

    pedidoSelecionado = ref.id;
    textoEditado = false;
    mostrarToast("Pedido salvo. Agora é só enviar para a gerente.", "ok");
    mostrarAba("whatsapp");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não salvou — verifique a conexão e tente de novo.", "erro");
  } finally {
    salvando = false;
    atualizarTotais();
  }
}

document.querySelectorAll(".btn-salvar-pedido").forEach((botao) => {
  botao.addEventListener("click", salvarPedido);
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
        batch.update(doc(db, COL_ITENS, existente.id), { ativo: true, atualizadoEm: serverTimestamp() });
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

  const confirmou = await confirmarAcao({
    titulo: "Remover da lista?",
    mensagem: `"${item.nome}" sai da lista da cozinha. Os pedidos já salvos continuam com ele no histórico.`,
    textoConfirmar: "Remover",
    perigo: true,
  });
  if (!confirmou) return;

  try {
    await updateDoc(doc(db, COL_ITENS, id), { ativo: false, atualizadoEm: serverTimestamp() });
    item.ativo = false;
    quantidades.delete(id);
    salvarRascunhoLocal();
    depoisDeMudarItens();
    mostrarToast("Item removido da lista.", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível remover.", "erro");
  }
}

// ---------- WhatsApp ----------

function rotuloPedido(p) {
  const d = dataDoPedido(p);
  const n = p.totalItens ?? (p.itens || []).length;
  return `${formatarData(d)} ${formatarHora(d)} — ${n} item(ns)`;
}

function preencherSelectPedidos() {
  const select = $("select-pedido-wa");
  const temRascunho = itensMarcados().length > 0;
  const visiveis = pedidos.slice(0, LIMITE_PEDIDOS_LISTA);

  let valor = pedidoSelecionado;
  const existe = valor === "rascunho" || visiveis.some((p) => p.id === valor);
  if (!valor || !existe) valor = temRascunho ? "rascunho" : visiveis[0]?.id || "rascunho";

  select.innerHTML =
    '<option value="rascunho">Pedido em andamento (não salvo)</option>' +
    visiveis.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(rotuloPedido(p))}</option>`).join("");
  select.value = valor;
  pedidoSelecionado = select.value;
}

$("select-pedido-wa").addEventListener("change", (e) => {
  pedidoSelecionado = e.target.value;
  gerarTextoWhatsApp();
});

function gerarTextoWhatsApp() {
  const escolha = $("select-pedido-wa").value || "rascunho";
  let linhasItens = [];
  let dataTexto = new Date().toLocaleDateString("pt-BR");

  if (escolha === "rascunho") {
    linhasItens = itensMarcados().map((i) => ({ nome: i.nome, unidade: i.unidade, quantidade: qtd(i) }));
  } else {
    const pedido = pedidos.find((p) => p.id === escolha);
    if (pedido) {
      linhasItens = (pedido.itens || []).map((i) => ({ ...i }));
      dataTexto = formatarData(dataDoPedido(pedido));
    }
  }

  linhasItens.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR", { sensitivity: "base" }));
  waItens = linhasItens.length;
  waUnidades = somaUnidades(linhasItens);

  const linhas = [
    "🍳 PEDIDO DA COZINHA",
    dataTexto,
    "",
    ...(linhasItens.length
      ? linhasItens.map((i) => `• ${i.nome} — ${Number(i.quantidade) || 0} ${i.unidade || "un."}`)
      : ["Nenhum item neste pedido."]),
  ];
  campoTexto.value = linhas.join("\n");
  textoEditado = false;
  atualizarAcoesWhatsApp();
}

function atualizarAcoesWhatsApp() {
  $("wa-itens").textContent = String(waItens);
  $("wa-unidades").textContent = String(waUnidades);

  const habilitado = !!campoTexto.value.trim() && (waItens > 0 || textoEditado);
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

// ---------- WhatsApp: pedidos salvos ----------

function renderizarPedidosSalvos() {
  const container = $("lista-pedidos-salvos");
  if (!pedidos.length) {
    container.innerHTML = '<p class="mensagem-vazio">Nenhum pedido salvo ainda.</p>';
    return;
  }

  container.innerHTML = pedidos
    .slice(0, LIMITE_PEDIDOS_LISTA)
    .map((p) => {
      const d = dataDoPedido(p);
      const nItens = p.totalItens ?? (p.itens || []).length;
      const nUn = p.totalUnidades ?? somaUnidades(p.itens);
      return `
        <div class="cozinha-pedido-salvo" data-id="${escapeHtml(p.id)}">
          <div><strong>${formatarData(d)} · ${formatarHora(d)}</strong><small>${nItens} item(ns) · ${nUn} un.</small></div>
          <div class="cozinha-pedido-acoes">
            <button type="button" class="btn-texto" data-acao="ver-pedido">Ver texto</button>
            <button type="button" class="btn-texto" data-acao="excluir-pedido">Excluir</button>
          </div>
        </div>`;
    })
    .join("");
}

$("lista-pedidos-salvos").addEventListener("click", async (e) => {
  const botao = e.target.closest("[data-acao]");
  if (!botao) return;
  const linha = botao.closest("[data-id]");
  if (!linha) return;
  const id = linha.dataset.id;

  if (botao.dataset.acao === "ver-pedido") {
    pedidoSelecionado = id;
    $("select-pedido-wa").value = id;
    gerarTextoWhatsApp();
    campoTexto.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (botao.dataset.acao === "excluir-pedido") {
    const pedido = pedidos.find((p) => p.id === id);
    if (!pedido) return;
    const confirmou = await confirmarAcao({
      titulo: "Excluir este pedido?",
      mensagem: `O pedido de ${rotuloPedido(pedido)} sai da lista e também da Dashboard. Não dá para desfazer.`,
      textoConfirmar: "Excluir pedido",
      perigo: true,
    });
    if (!confirmou) return;

    try {
      await deleteDoc(doc(db, COL_PEDIDOS, id));
      pedidos = pedidos.filter((p) => p.id !== id);
      if (pedidoSelecionado === id) pedidoSelecionado = null;
      preencherSelectPedidos();
      gerarTextoWhatsApp();
      renderizarPedidosSalvos();
      mostrarToast("Pedido excluído.", "ok");
    } catch (erro) {
      console.error(erro);
      mostrarToast("Não foi possível excluir o pedido.", "erro");
    }
  }
});

// ---------- Dashboard (só pedidos salvos) ----------

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

function rotuloDia(dia, completo = false) {
  const [ano, mes, d] = dia.split("-");
  return completo ? `${d}/${mes}/${ano}` : `${d}/${mes}`;
}

function renderizarDashboard() {
  const dias = Number($("filtro-periodo-cozinha").value) || 30;
  const produto = $("filtro-produto-cozinha").value || "todos";

  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  inicio.setDate(inicio.getDate() - (dias - 1));
  const chaveInicio = chaveDia(inicio);

  const doPeriodo = pedidos.filter((p) => diaDoPedido(p) >= chaveInicio);

  // ----- Série: um ponto por dia com pedido salvo -----
  const porDia = new Map();
  doPeriodo.forEach((p) => {
    const dia = diaDoPedido(p);
    const filtrados = (p.itens || []).filter((i) => produto === "todos" || i.itemId === produto);
    porDia.set(dia, (porDia.get(dia) || 0) + somaUnidades(filtrados));
  });
  const serie = [...porDia.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dia, total]) => ({ dia, total }));
  const unidadesPeriodo = serie.reduce((soma, d) => soma + d.total, 0);

  const itemSelecionado = itens.find((i) => i.id === produto);
  const nomeSerie = produto === "todos" ? "Todos os produtos" : itemSelecionado ? itemSelecionado.nome : "Produto";

  // ----- Indicadores -----
  $("dash-total-itens").textContent = String(itensAtivos().length);
  $("dash-pedidos").textContent = String(doPeriodo.length);
  $("dash-pedidos-legenda").textContent = `${porDia.size} dia(s) com pedido · ${dias} dias`;
  $("dash-unidades-periodo").textContent = String(unidadesPeriodo);
  $("dash-unidades-legenda").textContent = `${nomeSerie} · ${dias} dias`;

  const ultimo = pedidos[0];
  if (ultimo) {
    $("dash-ultimo").textContent = formatarData(dataDoPedido(ultimo));
    $("dash-ultimo-legenda").textContent =
      `${ultimo.totalItens ?? (ultimo.itens || []).length} item(ns) · ${ultimo.totalUnidades ?? somaUnidades(ultimo.itens)} un.`;
  } else {
    $("dash-ultimo").textContent = "—";
    $("dash-ultimo-legenda").textContent = "Nenhum pedido salvo";
  }

  $("legenda-linha").textContent = `Unidades pedidas em cada dia com pedido salvo — ${nomeSerie}.`;

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
    semLinha.textContent =
      produto !== "todos" && doPeriodo.length > 0
        ? "Este produto não foi pedido nos pedidos salvos deste período."
        : "Nenhum pedido salvo neste período.";
  } else {
    canvasLinha.hidden = false;
    semLinha.hidden = true;
    graficoLinha = new Chart(canvasLinha, {
      type: "line",
      data: {
        labels: serie.map((d) => rotuloDia(d.dia)),
        datasets: [
          {
            label: nomeSerie,
            data: serie.map((d) => d.total),
            borderColor: "#235571",
            backgroundColor: "rgba(35, 85, 113, 0.12)",
            fill: true,
            tension: 0.2,
            borderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6,
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
              title: (itensTooltip) => rotuloDia(serie[itensTooltip[0].dataIndex].dia, true),
              label: (ctx) => `${ctx.parsed.y} unidade(s)`,
            },
          },
        },
        scales: {
          y: { beginAtZero: true, ticks: { precision: 0 } },
          x: { ticks: { maxTicksLimit: 10, maxRotation: 0, minRotation: 0 } },
        },
      },
    });
  }

  // ----- Ranking de itens (considera todos os produtos) -----
  const porItem = new Map();
  doPeriodo.forEach((p) => {
    (p.itens || []).forEach((i) => {
      const atual = porItem.get(i.itemId) || { nome: i.nome, total: 0 };
      atual.total += Number(i.quantidade) || 0;
      porItem.set(i.itemId, atual);
    });
  });
  const ranking = [...porItem.entries()]
    .map(([itemId, r]) => {
      const item = itens.find((i) => i.id === itemId);
      return { nome: item ? item.nome : r.nome, total: r.total };
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

  // ----- Último pedido salvo -----
  const containerUltimo = $("dash-lista-ultimo");
  if (!ultimo || !(ultimo.itens || []).length) {
    containerUltimo.innerHTML = '<p class="mensagem-vazio">Nenhum pedido salvo ainda.</p>';
  } else {
    containerUltimo.innerHTML = [...ultimo.itens]
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR", { sensitivity: "base" }))
      .map(
        (i) =>
          `<div class="cozinha-linha-atual"><span>${escapeHtml(i.nome)}</span><span>${Number(i.quantidade) || 0} ${escapeHtml(i.unidade || "un.")}</span></div>`
      )
      .join("");
  }
}
