import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { mostrarToast } from "./toast.js";
import {
  OPCOES_CATEGORIA, OPCOES_EMBALAGEM, OPCOES_VOLUME,
  CHAVE_SEM_VALOR, chaveOpcao, rotuloPadronizado
} from "./opcoes-produto.js";
import {
  collection, query, where, getDocs, addDoc, setDoc, updateDoc,
  doc, writeBatch, increment, serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

let estabelecimentoAtual = null;
let usuarioAtual = null;
let produtos = [];
let estoqueMap = {};
let movimentos = [];
let sessoes = [];
let sessaoAtual = null;
let contagens = {};
let localAtual = "geladeira";
let planoImportacao = null;

const ROTULO_LOCAL = { geladeira: "Geladeira", seco: "Parte seca" };
const CAMPO_LOTE = { geladeira: "Geladeira", seco: "Estoque seco" };
const lista = document.getElementById("lista-estoque");
const campoBusca = document.getElementById("campo-busca");
const painelSessao = document.getElementById("estado-sessao");
const secaoContagem = document.getElementById("secao-contagem");
const painelRevisao = document.getElementById("painel-revisao");

// Filtros da lista do WhatsApp: guardam as chaves marcadas em cada grupo.
// Grupo vazio = sem filtro (entram todos).
const filtrosLista = { categoria: new Set(), embalagem: new Set() };
const GRUPOS_FILTRO = {
  categoria: { campo: "categoria", opcoes: OPCOES_CATEGORIA, rotuloSem: "Sem categoria", container: "chips-lista-categoria" },
  embalagem: { campo: "embalagem", opcoes: OPCOES_EMBALAGEM, rotuloSem: "Sem embalagem", container: "chips-lista-embalagem" }
};

function numero(v) { return Number(v) || 0; }
function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function dataMillis(v) {
  if (!v) return 0;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v instanceof Date) return v.getTime();
  return 0;
}
function nomeApresentacao(p) {
  return [p.marca, p.nome, p.variante, p.embalagem, p.volume].filter(Boolean).join(" · ");
}
function obterSessaoLocal() {
  return sessoes.filter(s => s.local === localAtual && s.status !== "finalizada")
    .sort((a,b) => dataMillis(b.updatedAt || b.createdAt) - dataMillis(a.updatedAt || a.createdAt))[0] || null;
}
function formatarDataHora(valor) {
  const ms = dataMillis(valor);
  return ms ? new Date(ms).toLocaleString("pt-BR", { dateStyle:"short", timeStyle:"short" }) : "agora";
}

// Preenche as listas do cadastro rápido (categoria, embalagem e volume)
// com as opções compartilhadas em opcoes-produto.js.
function preencherOpcoesDoCadastro() {
  const preencher = (id, opcoes) => {
    const select = document.getElementById(id);
    select.innerHTML = '<option value="">Selecione…</option>' +
      opcoes.map(o => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join("");
  };
  preencher("np-categoria", OPCOES_CATEGORIA);
  preencher("np-embalagem", OPCOES_EMBALAGEM);
  document.getElementById("opcoes-volume").innerHTML =
    OPCOES_VOLUME.map(v => '<option value="' + esc(v) + '"></option>').join("");
}
preencherOpcoesDoCadastro();

protegerPagina(async ({ estabelecimento, user }) => {
  estabelecimentoAtual = estabelecimento;
  usuarioAtual = user;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  try {
    await carregarTudo();
  } catch (erro) {
    console.error(erro);
    painelSessao.innerHTML = '<p class="mensagem-vazio">Não foi possível carregar o estoque. Confira as regras do Firestore para estoque, movimentosEstoque, vistoriasEstoque e contagensEstoque.</p>';
  }
});

const segGeladeira = document.getElementById("seg-geladeira");
const segSeco = document.getElementById("seg-seco");
segGeladeira.addEventListener("click", () => mudarLocal("geladeira"));
segSeco.addEventListener("click", () => mudarLocal("seco"));
campoBusca.addEventListener("input", renderizarLista);

async function mudarLocal(local) {
  localAtual = local;
  segGeladeira.classList.toggle("ativo", local === "geladeira");
  segGeladeira.setAttribute("aria-selected", String(local === "geladeira"));
  segSeco.classList.toggle("ativo", local === "seco");
  segSeco.setAttribute("aria-selected", String(local === "seco"));
  sessaoAtual = obterSessaoLocal();
  try {
    await carregarContagensDaSessao();
    renderizarTudo();
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível carregar a vistoria deste local.", "erro");
  }
}

async function carregarTudo() {
  const [prodSnap, estoqueSnap, movSnap, sessoesSnap] = await Promise.all([
    getDocs(query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimentoAtual.id))),
    getDocs(query(collection(db, "estoque"), where("estabelecimentoId", "==", estabelecimentoAtual.id))),
    getDocs(query(collection(db, "movimentosEstoque"), where("estabelecimentoId", "==", estabelecimentoAtual.id))),
    getDocs(query(collection(db, "vistoriasEstoque"), where("estabelecimentoId", "==", estabelecimentoAtual.id)))
  ]);
  produtos = prodSnap.docs.map(d => ({ id:d.id, ...d.data() }))
    .sort((a,b) => nomeApresentacao(a).localeCompare(nomeApresentacao(b), "pt-BR", { sensitivity:"base" }));
  estoqueMap = {};
  estoqueSnap.forEach(d => { const e=d.data(); estoqueMap[d.id] = { id:d.id, ...e, geladeira:numero(e.geladeira), seco:numero(e.seco) }; });
  movimentos = movSnap.docs.map(d => ({ id:d.id, ...d.data() }));
  sessoes = sessoesSnap.docs.map(d => ({ id:d.id, ...d.data() }));
  sessaoAtual = obterSessaoLocal();
  await carregarContagensDaSessao();
  renderizarTudo();
  await prepararImportacao();
}

async function carregarContagensDaSessao() {
  contagens = {};
  if (!sessaoAtual) return;
  const snap = await getDocs(query(collection(db, "contagensEstoque"), where("estabelecimentoId", "==", estabelecimentoAtual.id), where("sessaoId", "==", sessaoAtual.id)));
  snap.forEach(d => { contagens[d.data().produtoId] = { id:d.id, ...d.data() }; });
}

function renderizarTudo() {
  atualizarResumo();
  renderizarEstoqueBaixo();
  renderizarSessao();
  renderizarLista();
  preencherFiltrosListaWhatsApp();
  if (localListaWhatsApp) gerarListaWhatsApp(localListaWhatsApp);
}

function renderizarEstoqueBaixo() {
  const totalEl = document.getElementById("estoque-baixo-total");
  const listaEl = document.getElementById("lista-estoque-baixo");
  if (!totalEl || !listaEl) return;

  const itens = produtos
    .filter(p => p.ativo !== false && p.estoqueMinimo !== undefined && p.estoqueMinimo !== null && p.estoqueMinimo !== "")
    .map(p => {
      const saldo = estoqueMap[p.id] || {};
      const geladeira = numero(saldo.geladeira);
      const seco = numero(saldo.seco);
      const total = geladeira + seco;
      const minimo = numero(p.estoqueMinimo);
      return { produto:p, geladeira, seco, total, minimo };
    })
    .filter(i => i.total <= i.minimo)
    .sort((a,b) => (a.total-a.minimo) - (b.total-b.minimo) || nomeApresentacao(a.produto).localeCompare(nomeApresentacao(b.produto), "pt-BR", {sensitivity:"base"}));

  totalEl.textContent = String(itens.length);
  if (!itens.length) {
    listaEl.innerHTML = '<p class="mensagem-vazio">Nenhum produto está no limite ou abaixo do estoque mínimo cadastrado.</p>';
    return;
  }

  listaEl.innerHTML = "";
  itens.forEach(i => {
    const item = document.createElement("article");
    item.className = "stock-item";
    item.innerHTML = '<div class="stock-item-head"><div><strong>' + esc(nomeApresentacao(i.produto)) + '</strong><small>Estoque mínimo: ' + i.minimo + ' un.</small></div><span class="selo selo--atencao">' + (i.total === 0 ? "Sem estoque" : "Estoque baixo") + '</span></div>' +
      '<div class="stock-item-meta">Total: <strong>' + i.total + ' un.</strong> · Geladeira: ' + i.geladeira + ' · Parte seca: ' + i.seco + '</div>';
    listaEl.appendChild(item);
  });
}

function nomeCurtoWhatsApp(produto, todosProdutos) {
  const marca = String(produto.marca || "").trim();
  const nome = String(produto.nome || "").trim();
  const volume = String(produto.volume || "").trim();
  const variante = String(produto.variante || "").trim();

  // Prioriza a marca quando o nome do cadastro repete essa mesma informação.
  let principal = nome || marca || "Produto";
  if (marca && nome.toLocaleLowerCase("pt-BR").includes(marca.toLocaleLowerCase("pt-BR"))) {
    principal = marca;
  } else if (marca && nome) {
    principal = marca + " " + nome;
  }

  let curto = [principal, volume].filter(Boolean).join(" ");
  const iguais = todosProdutos.filter(p => {
    const outraMarca = String(p.marca || "").trim();
    const outroNome = String(p.nome || "").trim();
    let outroPrincipal = outroNome || outraMarca || "Produto";
    if (outraMarca && outroNome.toLocaleLowerCase("pt-BR").includes(outraMarca.toLocaleLowerCase("pt-BR"))) {
      outroPrincipal = outraMarca;
    } else if (outraMarca && outroNome) {
      outroPrincipal = outraMarca + " " + outroNome;
    }
    return [outroPrincipal, String(p.volume || "").trim()].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR") === curto.toLocaleLowerCase("pt-BR");
  });

  // Só acrescenta a variante quando ela é necessária para diferenciar itens.
  if (iguais.length > 1 && variante) curto = [principal, variante, volume].filter(Boolean).join(" ");
  // Último recurso para evitar nomes iguais na mensagem.
  if (iguais.length > 1 && !variante) curto = [principal, nome !== principal ? nome : "", volume].filter(Boolean).join(" ");
  return curto;
}

let localListaWhatsApp = null;

// ---------- Filtros da lista do WhatsApp (escolha múltipla) ----------

function chaveDoProduto(produto, grupo) {
  const chave = chaveOpcao(produto[GRUPOS_FILTRO[grupo].campo]);
  return chave || CHAVE_SEM_VALOR;
}

// Opções que aparecem como botões: só o que existe nos produtos cadastrados,
// sem repetir "suco" e "Suco", com "Sem ..." sempre por último.
function opcoesDoFiltro(grupo) {
  const cfg = GRUPOS_FILTRO[grupo];
  const mapa = new Map();
  produtos.forEach(p => {
    const chave = chaveDoProduto(p, grupo);
    if (mapa.has(chave)) return;
    mapa.set(chave, chave === CHAVE_SEM_VALOR ? cfg.rotuloSem : rotuloPadronizado(p[cfg.campo], cfg.opcoes));
  });
  return [...mapa.entries()]
    .map(([chave, rotulo]) => ({ chave, rotulo }))
    .sort((a, b) => {
      if (a.chave === CHAVE_SEM_VALOR) return 1;
      if (b.chave === CHAVE_SEM_VALOR) return -1;
      return a.rotulo.localeCompare(b.rotulo, "pt-BR", { sensitivity:"base" });
    });
}

function rotulosSelecionados(grupo) {
  return opcoesDoFiltro(grupo).filter(i => filtrosLista[grupo].has(i.chave)).map(i => i.rotulo);
}

function produtoPassaNoFiltro(produto) {
  // "Ou" dentro de cada grupo; "e" entre os grupos.
  return Object.keys(GRUPOS_FILTRO).every(grupo => {
    const marcados = filtrosLista[grupo];
    return marcados.size === 0 || marcados.has(chaveDoProduto(produto, grupo));
  });
}

function atualizarResumoFiltros() {
  const tipos = rotulosSelecionados("categoria");
  const embalagens = rotulosSelecionados("embalagem");
  document.getElementById("resumo-filtros-lista").textContent =
    "Mostrando: " + (tipos.length ? tipos.join(", ") : "todos os tipos") +
    " · " + (embalagens.length ? embalagens.join(", ") : "todas as embalagens");
  document.getElementById("btn-limpar-filtros-lista").hidden = !(tipos.length || embalagens.length);
}

function preencherFiltrosListaWhatsApp() {
  Object.keys(GRUPOS_FILTRO).forEach(grupo => {
    const container = document.getElementById(GRUPOS_FILTRO[grupo].container);
    const itens = opcoesDoFiltro(grupo);
    const existentes = new Set(itens.map(i => i.chave));
    // Remove marcações de opções que deixaram de existir, para não filtrar "no escuro".
    [...filtrosLista[grupo]].forEach(chave => { if (!existentes.has(chave)) filtrosLista[grupo].delete(chave); });

    if (!itens.length) {
      container.innerHTML = '<span class="legenda">Nenhum produto cadastrado.</span>';
      return;
    }
    container.innerHTML = itens.map(i => {
      const ativo = filtrosLista[grupo].has(i.chave);
      return '<button type="button" class="chip-filtro' + (ativo ? ' chip-filtro--ativo' : '') + '" data-grupo="' + grupo + '" data-chave="' + esc(i.chave) + '" aria-pressed="' + ativo + '">' + esc(i.rotulo) + '</button>';
    }).join("");
  });
  atualizarResumoFiltros();
}

function gerarListaWhatsApp(local) {
  localListaWhatsApp = local;
  const rotulo = ROTULO_LOCAL[local];
  const itens = produtos
    .filter(produtoPassaNoFiltro)
    .map(p => ({ produto: p, quantidade: numero((estoqueMap[p.id] || {})[local]) }))
    .filter(i => i.quantidade > 0)
    .sort((a,b) => nomeCurtoWhatsApp(a.produto, produtos).localeCompare(nomeCurtoWhatsApp(b.produto, produtos), "pt-BR", { sensitivity:"base" }));
  const filtros = [
    rotulosSelecionados("categoria").join(", "),
    rotulosSelecionados("embalagem").join(", ")
  ].filter(Boolean);
  const linhas = [
    "📦 ESTOQUE — " + rotulo.toLocaleUpperCase("pt-BR") + (filtros.length ? " — " + filtros.join(" / ").toLocaleUpperCase("pt-BR") : ""),
    new Date().toLocaleDateString("pt-BR"),
    "",
    ...(itens.length ? itens.map(i => "• " + nomeCurtoWhatsApp(i.produto, produtos) + " — " + i.quantidade + " un.") : ["Nenhum produto com saldo corresponde aos filtros selecionados."])
  ];
  const campo = document.getElementById("texto-lista-whatsapp");
  campo.value = linhas.join("\n");
  campo.dataset.local = local;
  document.getElementById("btn-copiar-lista").disabled = itens.length === 0;
}

document.getElementById("btn-lista-geladeira").addEventListener("click", () => gerarListaWhatsApp("geladeira"));
document.getElementById("btn-lista-seco").addEventListener("click", () => gerarListaWhatsApp("seco"));

// Um único listener cuida de todos os botões de filtro (tipo e embalagem).
document.getElementById("painel-lista-whatsapp").addEventListener("click", e => {
  const chip = e.target.closest(".chip-filtro");
  if (!chip) return;
  const { grupo, chave } = chip.dataset;
  const marcados = filtrosLista[grupo];
  if (marcados.has(chave)) marcados.delete(chave); else marcados.add(chave);
  const ativo = marcados.has(chave);
  chip.classList.toggle("chip-filtro--ativo", ativo);
  chip.setAttribute("aria-pressed", String(ativo));
  atualizarResumoFiltros();
  if (localListaWhatsApp) gerarListaWhatsApp(localListaWhatsApp);
});

document.getElementById("btn-limpar-filtros-lista").addEventListener("click", () => {
  filtrosLista.categoria.clear();
  filtrosLista.embalagem.clear();
  preencherFiltrosListaWhatsApp();
  if (localListaWhatsApp) gerarListaWhatsApp(localListaWhatsApp);
});

document.getElementById("btn-copiar-lista").addEventListener("click", async () => {
  const campo = document.getElementById("texto-lista-whatsapp");
  if (!campo.value.trim()) {
    mostrarToast("Gere uma lista antes de copiar.", "erro");
    return;
  }
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(campo.value);
    } else {
      campo.focus();
      campo.select();
      if (!document.execCommand("copy")) throw new Error("Cópia não disponível");
    }
    mostrarToast("Lista copiada. Agora é só colar no WhatsApp.", "ok");
  } catch (erro) {
    console.error(erro);
    campo.focus();
    campo.select();
    mostrarToast("Selecione o texto e copie manualmente.", "erro");
  }
});

function atualizarResumo() {
  document.getElementById("resumo-produtos").textContent = String(produtos.length);
  document.getElementById("resumo-contados").textContent = String(Object.keys(contagens).length);
  document.getElementById("resumo-data").textContent = sessaoAtual
    ? "Sessão atual: " + ROTULO_LOCAL[localAtual] + ". Confira os itens pendentes antes de finalizar."
    : "Nenhuma contagem em andamento. Inicie uma vistoria física para registrar as quantidades reais.";
}

function renderizarSessao() {
  secaoContagem.hidden = true;
  painelRevisao.hidden = true;
  if (!sessaoAtual) {
    painelSessao.innerHTML = '<h2>Vistoria: ' + esc(ROTULO_LOCAL[localAtual]) + '</h2><p class="legenda">Nenhuma vistoria em andamento neste local.</p><button type="button" class="btn" id="btn-iniciar">Iniciar vistoria</button>';
    document.getElementById("btn-iniciar").addEventListener("click", iniciarSessao);
    return;
  }
  const contados = Object.keys(contagens).length;
  painelSessao.innerHTML = '<h2>Vistoria: ' + esc(ROTULO_LOCAL[localAtual]) + '</h2>' +
    '<p class="legenda">Iniciada em ' + formatarDataHora(sessaoAtual.createdAt) + ' · ' + contados + ' de ' + produtos.length + ' apresentações contadas.</p>' +
    '<p><span class="selo ' + (sessaoAtual.status === "aguardando_revisao" ? "selo--atencao" : "selo--normal") + '">' + (sessaoAtual.status === "aguardando_revisao" ? "Aguardando revisão" : "Em andamento") + '</span></p>';
  if (sessaoAtual.status === "aguardando_revisao") {
    painelRevisao.hidden = false;
    painelSessao.insertAdjacentHTML("beforeend", '<button type="button" class="btn btn-secundario" id="btn-abrir-revisao">Ver revisão</button>');
    document.getElementById("btn-abrir-revisao").addEventListener("click", () => painelRevisao.scrollIntoView({behavior:"smooth",block:"start"}));
    renderizarRevisao();
  } else {
    secaoContagem.hidden = false;
    painelSessao.insertAdjacentHTML("beforeend", '<button type="button" class="btn btn-secundario" id="btn-retomar">Continuar contando</button>');
    document.getElementById("btn-retomar").addEventListener("click", () => secaoContagem.scrollIntoView({behavior:"smooth",block:"start"}));
  }
}

async function iniciarSessao() {
  const btn = document.getElementById("btn-iniciar");
  btn.disabled = true;
  try {
    const now = Timestamp.now();
    const ref = await addDoc(collection(db, "vistoriasEstoque"), {
      estabelecimentoId: estabelecimentoAtual.id, local:localAtual, status:"em_andamento",
      criadaPor:usuarioAtual?.uid || null, criadaEm:serverTimestamp(), createdAt:now, updatedAt:serverTimestamp()
    });
    sessaoAtual = { id:ref.id, estabelecimentoId:estabelecimentoAtual.id, local:localAtual, status:"em_andamento", createdAt:now, updatedAt:now };
    sessoes.push(sessaoAtual);
    contagens = {};
    renderizarTudo();
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível iniciar a vistoria.", "erro");
    btn.disabled = false;
  }
}

function renderizarLista() {
  if (!sessaoAtual || sessaoAtual.status !== "em_andamento") {
    lista.innerHTML = '<p class="mensagem-vazio">Inicie ou retome uma vistoria para contar produtos.</p>';
    return;
  }
  const busca = campoBusca.value.trim().toLocaleLowerCase("pt-BR");
  const visiveis = produtos.filter(p => nomeApresentacao(p).toLocaleLowerCase("pt-BR").includes(busca) || String(p.codigoBarras || "").includes(busca));
  if (!visiveis.length) {
    lista.innerHTML = '<p class="mensagem-vazio">Nenhum produto encontrado. Use o cadastro rápido abaixo para adicionar um novo.</p>';
    return;
  }
  lista.innerHTML = "";
  visiveis.forEach(p => {
    const count = contagens[p.id];
    const old = estoqueMap[p.id] || {geladeira:0,seco:0};
    const row = document.createElement("article");
    row.className = "stock-item" + (count ? " stock-item--contado" : "");
    row.innerHTML = '<div class="stock-item-head"><div><strong>' + esc(nomeApresentacao(p)) + '</strong><small>' + esc(p.categoria || "Sem categoria") + '</small></div><span class="selo ' + (count ? "selo--normal" : "selo--sem-validade") + '">' + (count ? "Contado" : "Pendente") + '</span></div>' +
      '<div class="stock-item-meta">Saldo anterior em ' + esc(ROTULO_LOCAL[localAtual]) + ': ' + numero(old[localAtual]) + (p.estoqueMinimo != null ? ' · Mínimo: ' + numero(p.estoqueMinimo) : '') + '</div>' +
      '<div class="stock-item-controls"><label for="q-' + esc(p.id) + '">Quantidade física</label><input id="q-' + esc(p.id) + '" type="number" min="0" step="1" inputmode="numeric" value="' + (count ? numero(count.quantidade) : '') + '" placeholder="Não contado" /><button type="button" class="btn stock-save-count" data-id="' + esc(p.id) + '">' + (count ? "Atualizar contagem" : "Salvar contagem") + '</button></div>' +
      '<button type="button" class="btn-texto stock-entry-toggle" data-id="' + esc(p.id) + '">Registrar entrada (+)</button>' +
      '<div class="stock-entry-form" data-form-id="' + esc(p.id) + '" hidden><label>Quantidade recebida</label><input class="stock-entry-q" type="number" min="1" step="1" inputmode="numeric" placeholder="Ex.: 12" /><label>Vencimento (opcional)</label><input class="stock-entry-date" type="date" /><button type="button" class="btn stock-entry-save" data-id="' + esc(p.id) + '">Salvar entrada</button></div>';
    lista.appendChild(row);
  });
  lista.querySelectorAll(".stock-save-count").forEach(btn => btn.addEventListener("click", () => salvarContagem(btn.dataset.id, btn)));
  lista.querySelectorAll(".stock-entry-toggle").forEach(btn => btn.addEventListener("click", () => {
    const form = lista.querySelector('[data-form-id="' + btn.dataset.id + '"]');
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector(".stock-entry-q").focus();
  }));
  lista.querySelectorAll(".stock-entry-save").forEach(btn => btn.addEventListener("click", () => salvarEntradaDaLinha(btn.dataset.id, btn)));
}

async function salvarContagem(produtoId, botao) {
  const produto = produtos.find(p => p.id === produtoId);
  const input = document.getElementById("q-" + produtoId);
  if (!produto || input.value === "" || !Number.isInteger(Number(input.value)) || Number(input.value) < 0) {
    mostrarToast("Informe uma quantidade inteira igual ou maior que zero.", "erro");
    input?.focus();
    return;
  }
  botao.disabled = true;
  const original = botao.textContent;
  botao.textContent = "Salvando…";
  const contadoEm = Timestamp.now();
  const id = sessaoAtual.id + "_" + produtoId;
  try {
    await setDoc(doc(db, "contagensEstoque", id), {
      estabelecimentoId:estabelecimentoAtual.id, sessaoId:sessaoAtual.id, produtoId,
      produtoNome:nomeApresentacao(produto), local:localAtual, quantidade:Number(input.value),
      contadoEm, contadoPor:usuarioAtual?.uid || null, atualizadoEm:serverTimestamp()
    });
    await updateDoc(doc(db, "vistoriasEstoque", sessaoAtual.id), {updatedAt:serverTimestamp(), status:"em_andamento"});
    contagens[produtoId] = {id, estabelecimentoId:estabelecimentoAtual.id, sessaoId:sessaoAtual.id, produtoId, produtoNome:nomeApresentacao(produto), local:localAtual, quantidade:Number(input.value), contadoEm};
    sessaoAtual.status = "em_andamento";
    mostrarToast("Contagem salva. Você pode continuar depois.", "ok");
    renderizarTudo();
  } catch (erro) {
    console.error(erro);
    mostrarToast("A contagem não foi salva. Verifique a conexão e tente novamente.", "erro");
    botao.disabled = false;
    botao.textContent = original;
  }
}

document.getElementById("btn-revisar").addEventListener("click", async () => {
  if (!sessaoAtual) { mostrarToast("Inicie uma vistoria antes de revisar.", "erro"); return; }
  if (!Object.keys(contagens).length) { mostrarToast("Conte pelo menos um produto antes de revisar.", "erro"); return; }
  try {
    await updateDoc(doc(db,"vistoriasEstoque",sessaoAtual.id), {status:"aguardando_revisao", updatedAt:serverTimestamp()});
    sessaoAtual.status = "aguardando_revisao";
    renderizarTudo();
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível abrir a revisão.", "erro");
  }
});

document.getElementById("btn-voltar-contagem").addEventListener("click", async () => {
  if (!sessaoAtual) return;
  try {
    await updateDoc(doc(db,"vistoriasEstoque",sessaoAtual.id), {status:"em_andamento",updatedAt:serverTimestamp()});
    sessaoAtual.status = "em_andamento";
    renderizarTudo();
  } catch (erro) { console.error(erro); mostrarToast("Não foi possível retomar a contagem.", "erro"); }
});

function renderizarRevisao() {
  if (!sessaoAtual) return;
  const itens = Object.values(contagens);
  const ids = new Set(itens.map(c => c.produtoId));
  const pendentes = produtos.filter(p => !ids.has(p.id));
  document.getElementById("texto-revisao").textContent = "Revise antes de aplicar. Produtos pendentes mantêm o saldo anterior; zero só é aplicado quando você contou explicitamente zero.";
  const box = document.getElementById("resumo-revisao");
  box.innerHTML = '<div class="stock-review-stats"><strong>' + itens.length + ' contados</strong><strong>' + pendentes.length + ' pendentes</strong><strong>' + itens.filter(c => numero(c.quantidade) === 0).length + ' com zero</strong></div>';
  itens.sort((a,b) => String(a.produtoNome).localeCompare(String(b.produtoNome),"pt-BR")).forEach(c => {
    const antigo = numero((estoqueMap[c.produtoId] || {})[localAtual]);
    const div = document.createElement("div");
    div.className = "stock-review-row";
    const diferenca = numero(c.quantidade)-antigo;
    div.innerHTML = '<span><strong>' + esc(c.produtoNome) + '</strong><small>Anterior: ' + antigo + ' · Contado: ' + numero(c.quantidade) + '</small></span><strong>' + (diferenca > 0 ? "+" : "") + diferenca + '</strong>';
    box.appendChild(div);
  });
  if (pendentes.length) {
    const p = document.createElement("p");
    p.className = "legenda";
    p.textContent = "Pendentes; saldo anterior preservado: " + pendentes.map(nomeApresentacao).join(", ");
    box.appendChild(p);
  }
}

document.getElementById("btn-finalizar").addEventListener("click", finalizarSessao);

async function finalizarSessao() {
  if (!sessaoAtual || sessaoAtual.status !== "aguardando_revisao") return;
  const itens = Object.values(contagens);
  if (!itens.length) { mostrarToast("Nenhum produto foi contado nesta vistoria.", "erro"); return; }
  if (!window.confirm("Aplicar " + itens.length + " contagens à " + ROTULO_LOCAL[localAtual].toLowerCase() + "? Produtos pendentes manterão os saldos anteriores.")) return;
  const botao = document.getElementById("btn-finalizar");
  botao.disabled = true;
  botao.textContent = "Aplicando…";
  try {
    const snap = await getDocs(query(collection(db,"movimentosEstoque"),where("estabelecimentoId","==",estabelecimentoAtual.id)));
    const freshMovs = snap.docs.map(d => d.data());
    const plano = itens.map(c => {
      const contagemMs = dataMillis(c.contadoEm);
      const posteriores = freshMovs.filter(m => m.produtoId === c.produtoId && dataMillis(m.registradoEm) > contagemMs && m.local === localAtual && ["entrada","perda","vencido","ajuste"].includes(m.tipo));
      const delta = posteriores.reduce((sum,m) => sum + numero(m.delta),0);
      return {...c, deltaPosterior:delta, quantidadeFinal:numero(c.quantidade)+delta};
    });
    const impossiveis = plano.filter(c => c.quantidadeFinal < 0);
    if (impossiveis.length) throw new Error("Há perdas posteriores maiores que a quantidade contada para: " + impossiveis.map(c=>c.produtoNome).join(", ") + ". Reconfira esses itens.");
    for (let i=0; i<plano.length; i+=150) {
      const batch = writeBatch(db);
      plano.slice(i,i+150).forEach(c => {
        const atual = estoqueMap[c.produtoId] || {geladeira:0,seco:0};
        const ultimaAtual = dataMillis(atual.ultimaContagemEm);
        const ultimaContagem = ultimaAtual > dataMillis(c.contadoEm) ? atual.ultimaContagemEm : c.contadoEm;
        batch.set(doc(db,"estoque",c.produtoId), {
          estabelecimentoId:estabelecimentoAtual.id, produtoId:c.produtoId, produtoNome:c.produtoNome,
          [localAtual]:c.quantidadeFinal, ultimaContagemEm:ultimaContagem, atualizadoEm:serverTimestamp()
        }, {merge:true});
        batch.set(doc(collection(db,"movimentosEstoque")), {
          estabelecimentoId:estabelecimentoAtual.id, produtoId:c.produtoId, produtoNome:c.produtoNome,
          local:localAtual, tipo:"contagem", delta:c.quantidadeFinal-numero(atual[localAtual]),
          quantidadeContada:numero(c.quantidade), deltaMovimentacoesPosteriores:c.deltaPosterior,
          sessaoId:sessaoAtual.id, origem:"vistoria-estoque", registradoEm:serverTimestamp()
        });
      });
      await batch.commit();
    }
    await updateDoc(doc(db,"vistoriasEstoque",sessaoAtual.id), {status:"finalizada",finalizadaEm:serverTimestamp(),updatedAt:serverTimestamp(),quantidadeItensContados:itens.length});
    mostrarToast("Vistoria finalizada e saldos aplicados.", "ok");
    await carregarTudo();
  } catch (erro) {
    console.error(erro);
    mostrarToast(erro.message && erro.message.startsWith("Há perdas posteriores") ? erro.message : "Não foi possível finalizar. Revise a conexão e tente novamente; a vistoria continuará disponível.", "erro");
  } finally {
    botao.disabled = false;
    botao.textContent = "Confirmar e aplicar saldos";
  }
}

document.getElementById("form-novo-produto-estoque").addEventListener("submit", async e => {
  e.preventDefault();
  const nome = document.getElementById("np-nome").value.trim();
  if (!nome) return;
  const minimoEl = document.getElementById("np-estoque-minimo");
  const minimoTexto = minimoEl.value.trim();
  if (minimoTexto !== "" && (!Number.isInteger(Number(minimoTexto)) || Number(minimoTexto) < 0)) {
    mostrarToast("O estoque mínimo deve ser um número inteiro igual ou maior que zero.", "erro");
    minimoEl.focus();
    return;
  }
  const dados = {
    estabelecimentoId:estabelecimentoAtual.id, nome,
    marca:document.getElementById("np-marca").value.trim(),
    categoria:document.getElementById("np-categoria").value,
    variante:document.getElementById("np-variante").value.trim(),
    embalagem:document.getElementById("np-embalagem").value,
    volume:document.getElementById("np-volume").value.trim(),
    codigoBarras:document.getElementById("np-codigo").value.trim(),
    precoCusto:0, precoVenda:0, ativo:true,
    ...(minimoTexto !== "" ? { estoqueMinimo:Number(minimoTexto) } : {})
  };
  const chave = [dados.nome,dados.marca,dados.variante,dados.embalagem,dados.volume].join("|").toLocaleLowerCase("pt-BR");
  const duplicado = produtos.find(p => [p.nome,p.marca||"",p.variante||"",p.embalagem||"",p.volume||""].join("|").toLocaleLowerCase("pt-BR") === chave);
  if (duplicado) { mostrarToast("Este produto/apresentação já está cadastrado.", "erro"); return; }
  const botao = e.submitter;
  botao.disabled = true;
  try {
    const ref = await addDoc(collection(db,"produtos"),dados);
    produtos.push({id:ref.id,...dados});
    produtos.sort((a,b) => nomeApresentacao(a).localeCompare(nomeApresentacao(b),"pt-BR"));
    e.target.reset();
    campoBusca.value = "";
    renderizarLista();
    preencherFiltrosListaWhatsApp();
    mostrarToast("Produto cadastrado. Agora informe a quantidade física.", "ok");
    document.getElementById("q-"+ref.id)?.focus();
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível cadastrar o produto.", "erro");
  } finally { botao.disabled = false; }
});

async function salvarEntradaDaLinha(produtoId, botao) {
  const form = lista.querySelector('[data-form-id="' + produtoId + '"]');
  const quantidade = Number(form.querySelector(".stock-entry-q").value);
  const vencimento = form.querySelector(".stock-entry-date").value;
  const produto = produtos.find(p => p.id === produtoId);
  if (!produto || !Number.isInteger(quantidade) || quantidade < 1) {
    mostrarToast("Informe uma quantidade recebida inteira maior que zero.", "erro");
    return;
  }
  botao.disabled = true;
  try {
    await registrarEntrada(produto, quantidade, vencimento);
    mostrarToast("Entrada de " + quantidade + " unidades registrada em " + ROTULO_LOCAL[localAtual] + ".", "ok");
    renderizarTudo();
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível registrar a entrada.", "erro");
    botao.disabled = false;
  }
}

async function registrarEntrada(produto, quantidade, dataVencimento) {
  const batch = writeBatch(db);
  const atual = estoqueMap[produto.id] || {geladeira:0,seco:0};
  batch.set(doc(db,"estoque",produto.id), {
    estabelecimentoId:estabelecimentoAtual.id, produtoId:produto.id, produtoNome:nomeApresentacao(produto),
    [localAtual]:increment(quantidade), atualizadoEm:serverTimestamp()
  }, {merge:true});
  batch.set(doc(collection(db,"movimentosEstoque")), {
    estabelecimentoId:estabelecimentoAtual.id, produtoId:produto.id, produtoNome:nomeApresentacao(produto),
    local:localAtual, tipo:"entrada", delta:quantidade, quantidade, origem:"estoque", registradoEm:serverTimestamp()
  });
  if (dataVencimento) {
    batch.set(doc(collection(db,"lotes")), {
      estabelecimentoId:estabelecimentoAtual.id, produtoId:produto.id, produtoNome:produto.nome,
      precoCusto:produto.precoCusto ?? 0, diasAlerta:produto.diasAlerta ?? null, quantidade,
      local:CAMPO_LOTE[localAtual], dataVencimento, promocaoAtiva:false, precoPromocional:null
    });
  }
  await batch.commit();
  estoqueMap[produto.id] = {...atual,[localAtual]:atual[localAtual]+quantidade};
  const snap = await getDocs(query(collection(db,"movimentosEstoque"),where("estabelecimentoId","==",estabelecimentoAtual.id)));
  movimentos = snap.docs.map(d=>({id:d.id,...d.data()}));
}

async function prepararImportacao() {
  const painel = document.getElementById("painel-importacao");
  const snap = await getDocs(query(collection(db,"lotes"),where("estabelecimentoId","==",estabelecimentoAtual.id)));
  const candidatos = snap.docs.map(d=>({id:d.id,...d.data()})).filter(l=>!l.dataVencimento && !l.importadoParaEstoque && l.produtoId);
  const porProduto = {};
  candidatos.forEach(l=>{
    if (!porProduto[l.produtoId]) porProduto[l.produtoId]={produtoId:l.produtoId,nome:l.produtoNome||produtos.find(p=>p.id===l.produtoId)?.nome||"(sem nome)",geladeira:0,seco:0,loteIds:[]};
    const item=porProduto[l.produtoId];
    if (l.local==="Geladeira") item.geladeira+=numero(l.quantidade); else item.seco+=numero(l.quantidade);
    item.loteIds.push(l.id);
  });
  const itens=Object.values(porProduto).filter(i=>!estoqueMap[i.produtoId]);
  if (!itens.length) { painel.hidden=true; planoImportacao=null; return; }
  planoImportacao=itens;
  document.getElementById("texto-importacao").textContent="Foram encontrados lotes sem vencimento e ainda não importados. Confira antes de transformá-los em saldo inicial.";
  document.getElementById("conferencia-importacao").innerHTML=itens.map(i=>'<div class="linha-estoque"><div class="linha-estoque-nome">'+esc(i.nome)+'</div><div class="linha-estoque-qtd">Geladeira '+i.geladeira+' · Parte seca '+i.seco+'</div></div>').join("");
  painel.hidden=false;
}

document.getElementById("btn-confirmar-importacao").addEventListener("click",async e=>{
  if(!planoImportacao?.length)return;
  const botao=e.currentTarget;botao.disabled=true;
  try{
    for(let i=0;i<planoImportacao.length;i+=150){
      const batch=writeBatch(db);
      planoImportacao.slice(i,i+150).forEach(item=>{
        batch.set(doc(db,"estoque",item.produtoId),{estabelecimentoId:estabelecimentoAtual.id,produtoId:item.produtoId,produtoNome:item.nome,geladeira:item.geladeira,seco:item.seco,atualizadoEm:serverTimestamp()},{merge:true});
        batch.set(doc(collection(db,"movimentosEstoque")),{estabelecimentoId:estabelecimentoAtual.id,produtoId:item.produtoId,produtoNome:item.nome,local:"ambos",tipo:"importacao",geladeira:item.geladeira,seco:item.seco,origem:"estoque",registradoEm:serverTimestamp()});
        item.loteIds.forEach(id=>batch.update(doc(db,"lotes",id),{importadoParaEstoque:true}));
      });
      await batch.commit();
    }
    mostrarToast("Importação concluída.","ok");
    await carregarTudo();
  }catch(erro){console.error(erro);mostrarToast("A importação falhou. Confira a conexão e tente novamente.","erro");}
  finally{botao.disabled=false;}
});
