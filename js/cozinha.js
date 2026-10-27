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
const COL_VISTORIAS = "cozinhaVistorias";
const LIMITE_LISTA = 30;
const MAX_LINHAS = 8;
const CHAVE_SEM_GRUPO = "__sem_grupo__";
const GRUPOS_PADRAO = ["Frios", "Carnes", "Hambúrguer", "Embutidos", "Laticínios", "Molhos", "Congelados", "Outros"];
const PALETA = ["#235571", "#c2790a", "#3e7a5b", "#a83232", "#5a3d7a", "#52707d", "#b5651d", "#2a9d8f"];

// Lista que a colega já tinha feito (os números foram ignorados de propósito).
const ITENS_INICIAIS = [
  { nome: "Queijo fatiado", grupo: "Frios" },
  { nome: "Calabresa", grupo: "Embutidos" },
  { nome: "Presunto fatiado", grupo: "Frios" },
  { nome: "Requeijão", grupo: "Laticínios" },
  { nome: "Presunto para fatiar", grupo: "Frios" },
  { nome: "Lombinho", grupo: "Carnes" },
  { nome: "Queijo para ralar", grupo: "Frios" },
  { nome: "Queijo provolone (meio)", grupo: "Frios" },
  { nome: "Baicon", grupo: "Embutidos" },
  { nome: "Hambúrguer de costela", grupo: "Hambúrguer" },
  { nome: "Hambúrguer de frango", grupo: "Hambúrguer" },
  { nome: "Salsicha", grupo: "Embutidos" },
  { nome: "Espetinho", grupo: "Carnes" },
  { nome: "Leite condensado", grupo: "Laticínios" },
];

let estabelecimentoAtual = null;
let usuarioAtual = null;
let itens = [];
let vistorias = []; // da mais recente para a mais antiga
let abaAtual = "lista";
let textoEditado = false;
let salvando = false;
let vistoriaSelecionada = null;
let waItens = 0;
let waZerados = 0;
let editandoId = null;
let graficoLinha = null;
let graficoEstoque = null;
let graficoConsumo = null;

// Vistoria em andamento (rascunho). Fica só neste aparelho até "Salvar vistoria".
//  quantidades: itemId -> número mostrado na tela (começa na última contagem)
//  conferidos:  itens que ela contou ou confirmou nesta vistoria
//  entradas:    itemId -> quantidade que chegou desde a última vistoria
const quantidades = new Map();
const conferidos = new Set();
const entradas = new Map();
const entradasAbertas = new Set();

// Filtros da Dashboard
const filtroGrupos = new Set();
const filtroProdutos = new Set();

const $ = (id) => document.getElementById(id);
const lista = $("lista-cozinha");
const campoBusca = $("campo-busca");
const campoTexto = $("texto-lista-whatsapp");

// ---------- Utilidades ----------

function qtd(item) {
  return quantidades.get(item.id) ?? 0;
}

function itensAtivos() {
  return itens.filter((i) => i.ativo !== false);
}

function ordenarItens() {
  itens.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR", { sensitivity: "base" }));
}

function minimoDe(item) {
  const m = item.estoqueMinimo;
  return m === null || m === undefined || m === "" ? null : Number(m);
}

function grupoDe(item) {
  return String(item.grupo || "").trim();
}

function chaveGrupo(item) {
  return chaveOpcao(grupoDe(item)) || CHAVE_SEM_GRUPO;
}

function chaveDia(data) {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0"),
  ].join("-");
}

function dataDaVistoria(v) {
  const x = v.data;
  if (x && typeof x.toDate === "function") return x.toDate();
  if (x instanceof Date) return x;
  if (v.dia) return new Date(v.dia + "T12:00:00");
  return null;
}

function diaDaVistoria(v) {
  if (v.dia) return v.dia;
  const d = dataDaVistoria(v);
  return d ? chaveDia(d) : "";
}

function ordenarVistorias() {
  vistorias.sort((a, b) => (dataDaVistoria(b)?.getTime() || 0) - (dataDaVistoria(a)?.getTime() || 0));
}

function formatarData(d) {
  return d ? d.toLocaleDateString("pt-BR") : "—";
}

function formatarHora(d) {
  return d ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
}

function rotuloDia(dia, completo = false) {
  const [ano, mes, d] = dia.split("-");
  return completo ? `${d}/${mes}/${ano}` : `${d}/${mes}`;
}

// Última linha registrada deste item em qualquer vistoria (usada como ponto de partida).
function ultimaEntrada(itemId) {
  for (const v of vistorias) {
    const e = (v.itens || []).find((i) => i.itemId === itemId);
    if (e) return { quantidade: Number(e.quantidade) || 0, data: dataDaVistoria(v) };
  }
  return null;
}

// Última contagem CONFERIDA deste item (usada na Dashboard).
function ultimoConferido(itemId) {
  for (const v of vistorias) {
    const e = (v.itens || []).find((i) => i.itemId === itemId && i.conferido);
    if (e) return { quantidade: Number(e.quantidade) || 0, data: dataDaVistoria(v), dia: diaDaVistoria(v) };
  }
  return null;
}

function temValorConhecido(item) {
  return conferidos.has(item.id) || !!ultimaEntrada(item.id);
}

function estaBaixo(item, quantidade) {
  const min = minimoDe(item);
  return quantidade === 0 || (min !== null && quantidade <= min);
}

// ---------- Rascunho local ----------

function chaveRascunho() {
  return `cozinha:vistoria:${estabelecimentoAtual.id}`;
}

function aplicarBase() {
  itensAtivos().forEach((i) => {
    if (!quantidades.has(i.id)) {
      const ultima = ultimaEntrada(i.id);
      quantidades.set(i.id, ultima ? ultima.quantidade : 0);
    }
  });
}

function salvarRascunhoLocal() {
  try {
    const q = {};
    const e = {};
    conferidos.forEach((id) => {
      q[id] = quantidades.get(id) ?? 0;
      const entrada = entradas.get(id);
      if (entrada > 0) e[id] = entrada;
    });
    localStorage.setItem(chaveRascunho(), JSON.stringify({ q, c: [...conferidos], e }));
  } catch (erro) {
    /* sem localStorage: o rascunho só vale enquanto a página estiver aberta */
  }
}

function carregarRascunhoLocal() {
  quantidades.clear();
  conferidos.clear();
  entradas.clear();
  try {
    const obj = JSON.parse(localStorage.getItem(chaveRascunho()) || "{}");
    const ativos = new Set(itensAtivos().map((i) => i.id));
    (obj.c || []).forEach((id) => {
      if (!ativos.has(id)) return;
      const n = Math.floor(Number(obj.q?.[id]));
      quantidades.set(id, n >= 0 ? n : 0);
      conferidos.add(id);
      const entrada = Math.floor(Number(obj.e?.[id]));
      if (entrada > 0) entradas.set(id, entrada);
    });
  } catch (erro) {
    /* rascunho ilegível: começa do zero */
  }
  aplicarBase();
}

function reiniciarRascunho() {
  quantidades.clear();
  conferidos.clear();
  entradas.clear();
  entradasAbertas.clear();
  aplicarBase();
  salvarRascunhoLocal();
}

// ---------- Carregamento ----------

async function carregarDados() {
  const filtro = where("estabelecimentoId", "==", estabelecimentoAtual.id);
  const itensSnap = await getDocs(query(collection(db, COL_ITENS), filtro));
  itens = itensSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  ordenarItens();

  // As vistorias salvas são complementares: se falhar, a lista continua funcionando.
  try {
    const vistoriasSnap = await getDocs(query(collection(db, COL_VISTORIAS), filtro));
    vistorias = vistoriasSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    ordenarVistorias();
  } catch (erro) {
    console.error("Vistorias da cozinha indisponíveis:", erro);
    vistorias = [];
    mostrarToast("Não foi possível carregar as vistorias salvas. Confira as regras do Firestore.", "erro");
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
      '<p class="mensagem-vazio">Não foi possível carregar a lista da cozinha. Confira se as regras do Firestore para cozinhaItens e cozinhaVistorias foram publicadas.</p>';
  }
});

function depoisDeMudarItens() {
  ordenarItens();
  aplicarBase();
  preencherGrupos();
  renderizarLista();
  atualizarTotais();
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
    preencherSelectVistorias();
    gerarTextoWhatsApp();
    renderizarVistoriasSalvas();
  } else if (nome === "dashboard") {
    renderizarDashboard();
  }
}

abas.lista.botao.addEventListener("click", () => mostrarAba("lista"));
abas.whatsapp.botao.addEventListener("click", () => mostrarAba("whatsapp"));
abas.dashboard.botao.addEventListener("click", () => mostrarAba("dashboard"));

// ---------- Grupos (sugestões do campo "Grupo") ----------

function preencherGrupos() {
  const existentes = itens.map((i) => grupoDe(i)).filter(Boolean);
  const todos = [...new Set([...GRUPOS_PADRAO, ...existentes])].sort((a, b) => a.localeCompare(b, "pt-BR"));
  $("grupos-lista").innerHTML = todos.map((g) => `<option value="${escapeHtml(g)}"></option>`).join("");
}

// ---------- Lista: renderização ----------

function cartaoHtml(item) {
  const id = escapeHtml(item.id);
  const nome = escapeHtml(item.nome);
  const q = qtd(item);
  const conf = conferidos.has(item.id);
  const conhecido = temValorConhecido(item);
  const min = minimoDe(item);
  const ult = ultimaEntrada(item.id);

  let classe = "cozinha-item";
  if (conf) classe += " cozinha-item--conferido";
  if (conhecido && q === 0) classe += " cozinha-item--zerado";
  else if (conhecido && estaBaixo(item, q)) classe += " cozinha-item--baixo";

  let selos = conf
    ? '<span class="selo selo--normal">Conferido</span>'
    : '<span class="selo selo--sem-validade">Não conferido</span>';
  if (conhecido && q === 0) selos += '<span class="selo selo--vencido">Acabou</span>';
  else if (conhecido && estaBaixo(item, q)) selos += '<span class="selo selo--atencao">Baixo</span>';

  const partesMeta = [];
  if (item.unidade) partesMeta.push(escapeHtml(item.unidade));
  if (grupoDe(item)) partesMeta.push(escapeHtml(grupoDe(item)));
  if (min !== null) partesMeta.push(`mínimo ${min}`);
  partesMeta.push(
    ult ? `última vistoria: ${ult.quantidade} (${formatarData(ult.data)})` : "sem contagem anterior"
  );

  let acoes = "";
  if (!conf) {
    acoes += '<button type="button" class="btn-texto" data-acao="confirmar">Confirmar sem mudar</button>';
  } else {
    const entrada = entradas.get(item.id) || 0;
    if (entrada > 0 || entradasAbertas.has(item.id)) {
      acoes = `<div class="cozinha-entrada-linha"><label for="ent-${id}">Chegou desde a última vistoria</label><input id="ent-${id}" class="cozinha-entrada" type="number" min="0" step="1" inputmode="numeric" value="${entrada}" /></div>`;
    } else {
      acoes += '<button type="button" class="btn-texto" data-acao="entrada">Chegou mercadoria?</button>';
    }
  }

  const form =
    editandoId === item.id
      ? `<div class="cozinha-item-form">
          <div class="stock-form-grid">
            <div><label>Nome</label><input class="ed-nome" type="text" maxlength="80" value="${nome}" /></div>
            <div><label>Unidade</label><input class="ed-unidade" type="text" maxlength="20" value="${escapeHtml(item.unidade || "")}" /></div>
            <div><label>Grupo</label><input class="ed-grupo" type="text" list="grupos-lista" maxlength="30" value="${escapeHtml(grupoDe(item))}" /></div>
            <div><label>Estoque mínimo (opcional)</label><input class="ed-minimo" type="number" min="0" step="1" inputmode="numeric" value="${min === null ? "" : min}" /></div>
          </div>
          <div class="stock-review-actions">
            <button type="button" class="btn" data-acao="salvar-edicao">Salvar item</button>
            <button type="button" class="btn btn-secundario" data-acao="cancelar-edicao">Cancelar</button>
          </div>
        </div>`
      : "";

  return `
    <article class="${classe}" data-id="${id}">
      <div class="cozinha-item-info">
        <div class="cozinha-item-nome">${nome}${selos}</div>
        <div class="cozinha-item-meta">${partesMeta.join(" · ")}</div>
        <div class="cozinha-item-acoes">${acoes}</div>
        <div class="cozinha-item-acoes cozinha-item-acoes--edicao">
          <button type="button" class="btn-texto" data-acao="editar">Editar</button>
          <button type="button" class="btn-texto" data-acao="remover">Remover</button>
        </div>
      </div>
      <div class="stepper">
        <button type="button" data-acao="menos" aria-label="Diminuir ${nome}">−</button>
        <input type="number" class="cozinha-qtd" min="0" step="1" inputmode="numeric" value="${q}" aria-label="Quantidade em estoque de ${nome}" />
        <button type="button" data-acao="mais" aria-label="Aumentar ${nome}">+</button>
      </div>
      ${form}
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
  card.outerHTML = cartaoHtml(item);
}

function atualizarTotais() {
  const ativos = itensAtivos();
  const nConferidos = ativos.filter((i) => conferidos.has(i.id)).length;
  const nBaixos = ativos.filter((i) => temValorConhecido(i) && estaBaixo(i, qtd(i))).length;
  const sujo = nConferidos > 0;

  $("topo-total-itens").textContent = String(ativos.length);
  $("topo-conferidos").textContent = `${nConferidos} de ${ativos.length}`;
  $("topo-baixos").textContent = String(nBaixos);

  $("aviso-rascunho").hidden = !sujo;
  $("aviso-rascunho-texto").textContent =
    `Vistoria em andamento, ainda não salva: ${nConferidos} de ${ativos.length} itens conferidos.`;

  document.querySelectorAll(".btn-salvar-vistoria").forEach((botao) => {
    botao.disabled = !sujo || salvando;
  });
  $("btn-limpar-rascunho").disabled = !sujo;
  $("btn-conferir-todos").disabled = ativos.length === 0 || nConferidos === ativos.length;
}

campoBusca.addEventListener("input", renderizarLista);

$("toggle-edicao").addEventListener("change", (e) => {
  lista.classList.toggle("modo-edicao", e.target.checked);
});

// ---------- Lista: contar e conferir ----------

function definirQuantidade(id, valor) {
  const novo = Math.max(0, Math.floor(Number(valor) || 0));
  quantidades.set(id, novo);
  conferidos.add(id);
  salvarRascunhoLocal();
  const item = itens.find((i) => i.id === id);
  if (item) atualizarCartao(item);
  atualizarTotais();
}

function conferirSemMudar(id) {
  conferidos.add(id);
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
  else if (acao === "confirmar") conferirSemMudar(id);
  else if (acao === "entrada") {
    entradasAbertas.add(id);
    atualizarCartao(item);
    lista.querySelector(`#ent-${CSS.escape(id)}`)?.focus();
  } else if (acao === "editar") {
    const anterior = itens.find((i) => i.id === editandoId);
    editandoId = id;
    if (anterior && anterior.id !== id) atualizarCartao(anterior);
    atualizarCartao(item);
  } else if (acao === "cancelar-edicao") {
    editandoId = null;
    atualizarCartao(item);
  } else if (acao === "salvar-edicao") await salvarEdicao(id, card);
  else if (acao === "remover") await removerItem(id);
});

lista.addEventListener("change", (e) => {
  const card = e.target.closest("[data-id]");
  if (!card) return;
  const item = itens.find((i) => i.id === card.dataset.id);
  if (!item) return;

  if (e.target.classList.contains("cozinha-qtd")) {
    const valor = Number(e.target.value);
    if (e.target.value === "" || !Number.isInteger(valor) || valor < 0) {
      e.target.value = qtd(item);
      mostrarToast("Informe um número inteiro igual ou maior que zero.", "erro");
      return;
    }
    definirQuantidade(item.id, valor);
  } else if (e.target.classList.contains("cozinha-entrada")) {
    const valor = Number(e.target.value);
    if (e.target.value === "" || !Number.isInteger(valor) || valor < 0) {
      e.target.value = entradas.get(item.id) || 0;
      mostrarToast("Informe um número inteiro igual ou maior que zero.", "erro");
      return;
    }
    if (valor > 0) entradas.set(item.id, valor);
    else entradas.delete(item.id);
    salvarRascunhoLocal();
  }
});

$("btn-conferir-todos").addEventListener("click", async () => {
  const ativos = itensAtivos();
  const confirmou = await confirmarAcao({
    titulo: "Marcar todos como conferidos?",
    mensagem: `Use só se você conferiu os ${ativos.length} itens. Os que você não mexeu serão salvos com o valor que aparece na tela.`,
    textoConfirmar: "Marcar todos",
  });
  if (!confirmou) return;
  ativos.forEach((i) => conferidos.add(i.id));
  salvarRascunhoLocal();
  renderizarLista();
  atualizarTotais();
});

$("btn-limpar-rascunho").addEventListener("click", async () => {
  if (!conferidos.size) return;
  const confirmou = await confirmarAcao({
    titulo: "Descartar a vistoria em andamento?",
    mensagem: "Tudo o que foi conferido e ainda não foi salvo volta para a última vistoria salva.",
    textoConfirmar: "Descartar",
    perigo: true,
  });
  if (!confirmou) return;
  reiniciarRascunho();
  renderizarLista();
  atualizarTotais();
});

// ---------- Salvar vistoria ----------

async function salvarVistoria() {
  if (salvando) return;
  const ativos = itensAtivos();
  const conferidosAtivos = ativos.filter((i) => conferidos.has(i.id));
  if (!conferidosAtivos.length) {
    mostrarToast("Confira pelo menos um item para salvar.", "erro");
    return;
  }

  const naoConferidos = ativos.length - conferidosAtivos.length;
  if (naoConferidos > 0) {
    const confirmou = await confirmarAcao({
      titulo: "Há itens não conferidos",
      mensagem: `${naoConferidos} item(ns) não foram conferidos. Eles ficam salvos com o valor da última vistoria, marcados como "não conferido", e não entram nos gráficos. Salvar mesmo assim?`,
      textoConfirmar: "Salvar mesmo assim",
    });
    if (!confirmou) return;
  }

  const agora = new Date();
  const hoje = chaveDia(agora);
  if (vistorias.some((v) => diaDaVistoria(v) === hoje)) {
    const confirmou = await confirmarAcao({
      titulo: "Já existe uma vistoria hoje",
      mensagem: "Já há uma vistoria salva hoje. No gráfico do dia vale a mais recente. Continuar?",
      textoConfirmar: "Salvar mesmo assim",
    });
    if (!confirmou) return;
  }

  salvando = true;
  atualizarTotais();

  try {
    const itensVistoria = ativos.map((i) => {
      const conf = conferidos.has(i.id);
      return {
        itemId: i.id,
        nome: i.nome,
        unidade: i.unidade || "",
        grupo: grupoDe(i),
        quantidade: qtd(i),
        conferido: conf,
        entrada: conf ? entradas.get(i.id) || 0 : 0,
      };
    });
    const dados = {
      estabelecimentoId: estabelecimentoAtual.id,
      dia: hoje,
      data: serverTimestamp(),
      itens: itensVistoria,
      totalItens: itensVistoria.length,
      totalConferidos: conferidosAtivos.length,
      criadoPor: usuarioAtual?.uid || null,
    };
    const ref = await addDoc(collection(db, COL_VISTORIAS), dados);
    vistorias.push({ id: ref.id, ...dados, data: Timestamp.now() });
    ordenarVistorias();

    reiniciarRascunho();
    renderizarLista();

    vistoriaSelecionada = ref.id;
    textoEditado = false;
    mostrarToast("Vistoria salva. Agora é só enviar para a gerente.", "ok");
    mostrarAba("whatsapp");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não salvou — verifique a conexão e tente de novo.", "erro");
  } finally {
    salvando = false;
    atualizarTotais();
  }
}

document.querySelectorAll(".btn-salvar-vistoria").forEach((botao) => {
  botao.addEventListener("click", salvarVistoria);
});

// ---------- Lista: cadastro, edição e remoção ----------

async function adicionarItens(entradasNovas) {
  const existentes = new Map(itens.map((i) => [chaveOpcao(i.nome), i]));
  const vistos = new Set();
  const batch = writeBatch(db);
  const novos = [];
  const reativados = [];
  let ignorados = 0;

  entradasNovas.forEach(({ nome, unidade, grupo }) => {
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
      grupo: String(grupo || "").trim(),
      estoqueMinimo: null,
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
    const r = await adicionarItens(ITENS_INICIAIS.map((i) => ({ nome: i.nome, unidade: "", grupo: i.grupo })));
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
  const grupo = $("novo-grupo").value.trim();
  if (!nome) return;

  const botao = e.submitter;
  botao.disabled = true;
  try {
    const r = await adicionarItens([{ nome, unidade, grupo }]);
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
    const r = await adicionarItens(linhas.map((nome) => ({ nome, unidade: "", grupo: "" })));
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

async function salvarEdicao(id, card) {
  const item = itens.find((i) => i.id === id);
  if (!item) return;

  const nome = card.querySelector(".ed-nome").value.trim();
  const unidade = card.querySelector(".ed-unidade").value.trim();
  const grupo = card.querySelector(".ed-grupo").value.trim();
  const minimoTexto = card.querySelector(".ed-minimo").value.trim();

  if (!nome) {
    mostrarToast("O nome não pode ficar vazio.", "erro");
    return;
  }
  const chave = chaveOpcao(nome);
  if (itens.some((i) => i.id !== id && chaveOpcao(i.nome) === chave)) {
    mostrarToast("Já existe um item com esse nome.", "erro");
    return;
  }
  if (minimoTexto !== "" && (!Number.isInteger(Number(minimoTexto)) || Number(minimoTexto) < 0)) {
    mostrarToast("O estoque mínimo deve ser um número inteiro igual ou maior que zero.", "erro");
    return;
  }

  const estoqueMinimo = minimoTexto === "" ? null : Number(minimoTexto);
  try {
    await updateDoc(doc(db, COL_ITENS, id), { nome, unidade, grupo, estoqueMinimo, atualizadoEm: serverTimestamp() });
    Object.assign(item, { nome, unidade, grupo, estoqueMinimo });
    editandoId = null;
    depoisDeMudarItens();
    mostrarToast("Item atualizado.", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível salvar o item.", "erro");
  }
}

async function removerItem(id) {
  const item = itens.find((i) => i.id === id);
  if (!item) return;

  const confirmou = await confirmarAcao({
    titulo: "Remover da lista?",
    mensagem: `"${item.nome}" sai da lista da cozinha. As vistorias já salvas continuam com ele no histórico.`,
    textoConfirmar: "Remover",
    perigo: true,
  });
  if (!confirmou) return;

  try {
    await updateDoc(doc(db, COL_ITENS, id), { ativo: false, atualizadoEm: serverTimestamp() });
    item.ativo = false;
    quantidades.delete(id);
    conferidos.delete(id);
    entradas.delete(id);
    entradasAbertas.delete(id);
    filtroProdutos.delete(id);
    salvarRascunhoLocal();
    depoisDeMudarItens();
    mostrarToast("Item removido da lista.", "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível remover.", "erro");
  }
}

// Sugestão automática de grupo a partir do nome (só para itens sem grupo).
function sugerirGrupo(nome) {
  const n = chaveOpcao(nome);
  if (n.includes("hamburguer")) return "Hambúrguer";
  if (/(queijo|presunto|mussarela|provolone|peito de peru)/.test(n)) return "Frios";
  if (/(calabresa|baicon|bacon|salsicha|linguica)/.test(n)) return "Embutidos";
  if (/(requeijao|leite|creme de leite|manteiga|iogurte)/.test(n)) return "Laticínios";
  if (/(lombinho|espetinho|carne|frango|costela|file)/.test(n)) return "Carnes";
  return null;
}

$("btn-sugerir-grupos").addEventListener("click", async (e) => {
  const alteracoes = itensAtivos()
    .filter((i) => !grupoDe(i))
    .map((i) => ({ item: i, grupo: sugerirGrupo(i.nome) }))
    .filter((a) => a.grupo);

  if (!alteracoes.length) {
    mostrarToast("Nenhum item sem grupo pôde ser classificado.", "erro");
    return;
  }

  const botao = e.currentTarget;
  botao.disabled = true;
  try {
    const batch = writeBatch(db);
    alteracoes.forEach(({ item, grupo }) => {
      batch.update(doc(db, COL_ITENS, item.id), { grupo, atualizadoEm: serverTimestamp() });
    });
    await batch.commit();
    alteracoes.forEach(({ item, grupo }) => {
      item.grupo = grupo;
    });
    depoisDeMudarItens();
    mostrarToast(`${alteracoes.length} item(ns) classificados. Ajuste em "Editar" se precisar.`, "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível classificar os itens.", "erro");
  } finally {
    botao.disabled = false;
  }
});

// ---------- WhatsApp ----------

function rotuloVistoria(v) {
  const d = dataDaVistoria(v);
  return `${formatarData(d)} ${formatarHora(d)} — ${v.totalConferidos ?? 0}/${v.totalItens ?? (v.itens || []).length} conferidos`;
}

function preencherSelectVistorias() {
  const select = $("select-vistoria-wa");
  const temRascunho = conferidos.size > 0;
  const visiveis = vistorias.slice(0, LIMITE_LISTA);

  let valor = vistoriaSelecionada;
  const existe = valor === "rascunho" || visiveis.some((v) => v.id === valor);
  if (!valor || !existe) valor = temRascunho ? "rascunho" : visiveis[0]?.id || "rascunho";

  select.innerHTML =
    '<option value="rascunho">Vistoria em andamento (não salva)</option>' +
    visiveis.map((v) => `<option value="${escapeHtml(v.id)}">${escapeHtml(rotuloVistoria(v))}</option>`).join("");
  select.value = valor;
  vistoriaSelecionada = select.value;
}

$("select-vistoria-wa").addEventListener("change", (e) => {
  vistoriaSelecionada = e.target.value;
  gerarTextoWhatsApp();
});

function gerarTextoWhatsApp() {
  const escolha = $("select-vistoria-wa").value || "rascunho";
  let linhasItens = [];
  let dataTexto = new Date().toLocaleDateString("pt-BR");

  if (escolha === "rascunho") {
    linhasItens = itensAtivos()
      .filter((i) => conferidos.has(i.id))
      .map((i) => ({ nome: i.nome, unidade: i.unidade, grupo: grupoDe(i), quantidade: qtd(i) }));
  } else {
    const v = vistorias.find((x) => x.id === escolha);
    if (v) {
      linhasItens = (v.itens || []).filter((i) => i.conferido).map((i) => ({ ...i }));
      dataTexto = formatarData(dataDaVistoria(v));
    }
  }

  const porNome = (a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR", { sensitivity: "base" });
  waItens = linhasItens.length;
  waZerados = linhasItens.filter((i) => (Number(i.quantidade) || 0) === 0).length;

  const linhaItem = (i) => {
    const n = Number(i.quantidade) || 0;
    return n === 0 ? `• ${i.nome} — ACABOU` : `• ${i.nome} — ${n} ${i.unidade || "un."}`;
  };

  const linhas = ["📦 ESTOQUE DA COZINHA", dataTexto, ""];
  if (!linhasItens.length) {
    linhas.push("Nenhum item conferido.");
  } else if (linhasItens.some((i) => i.grupo)) {
    const grupos = new Map();
    linhasItens.forEach((i) => {
      const g = i.grupo || "Sem grupo";
      if (!grupos.has(g)) grupos.set(g, []);
      grupos.get(g).push(i);
    });
    const nomes = [...grupos.keys()].sort((a, b) => {
      if (a === "Sem grupo") return 1;
      if (b === "Sem grupo") return -1;
      return a.localeCompare(b, "pt-BR");
    });
    nomes.forEach((g, idx) => {
      if (idx > 0) linhas.push("");
      linhas.push(`*${g}*`);
      grupos.get(g).sort(porNome).forEach((i) => linhas.push(linhaItem(i)));
    });
  } else {
    linhasItens.sort(porNome).forEach((i) => linhas.push(linhaItem(i)));
  }

  campoTexto.value = linhas.join("\n");
  textoEditado = false;
  atualizarAcoesWhatsApp();
}

function atualizarAcoesWhatsApp() {
  $("wa-itens").textContent = String(waItens);
  $("wa-zerados").textContent = String(waZerados);

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

// ---------- WhatsApp: vistorias salvas ----------

function renderizarVistoriasSalvas() {
  const container = $("lista-vistorias-salvas");
  if (!vistorias.length) {
    container.innerHTML = '<p class="mensagem-vazio">Nenhuma vistoria salva ainda.</p>';
    return;
  }

  container.innerHTML = vistorias
    .slice(0, LIMITE_LISTA)
    .map((v) => {
      const d = dataDaVistoria(v);
      const total = v.totalItens ?? (v.itens || []).length;
      return `
        <div class="cozinha-vistoria-salva" data-id="${escapeHtml(v.id)}">
          <div><strong>${formatarData(d)} · ${formatarHora(d)}</strong><small>${v.totalConferidos ?? 0} de ${total} itens conferidos</small></div>
          <div class="cozinha-vistoria-acoes">
            <button type="button" class="btn-texto" data-acao="ver-vistoria">Ver texto</button>
            <button type="button" class="btn-texto" data-acao="excluir-vistoria">Excluir</button>
          </div>
        </div>`;
    })
    .join("");
}

$("lista-vistorias-salvas").addEventListener("click", async (e) => {
  const botao = e.target.closest("[data-acao]");
  if (!botao) return;
  const linha = botao.closest("[data-id]");
  if (!linha) return;
  const id = linha.dataset.id;

  if (botao.dataset.acao === "ver-vistoria") {
    vistoriaSelecionada = id;
    $("select-vistoria-wa").value = id;
    gerarTextoWhatsApp();
    campoTexto.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

  if (botao.dataset.acao === "excluir-vistoria") {
    const v = vistorias.find((x) => x.id === id);
    if (!v) return;
    const confirmou = await confirmarAcao({
      titulo: "Excluir esta vistoria?",
      mensagem: `A vistoria de ${rotuloVistoria(v)} sai da lista e também da Dashboard. Não dá para desfazer.`,
      textoConfirmar: "Excluir vistoria",
      perigo: true,
    });
    if (!confirmou) return;

    try {
      await deleteDoc(doc(db, COL_VISTORIAS, id));
      vistorias = vistorias.filter((x) => x.id !== id);
      if (vistoriaSelecionada === id) vistoriaSelecionada = null;
      aplicarBaseAposMudancaDeVistorias();
      preencherSelectVistorias();
      gerarTextoWhatsApp();
      renderizarVistoriasSalvas();
      mostrarToast("Vistoria excluída.", "ok");
    } catch (erro) {
      console.error(erro);
      mostrarToast("Não foi possível excluir a vistoria.", "erro");
    }
  }
});

// Depois de excluir uma vistoria, itens não conferidos voltam a partir da vistoria que sobrou.
function aplicarBaseAposMudancaDeVistorias() {
  itensAtivos().forEach((i) => {
    if (!conferidos.has(i.id)) quantidades.delete(i.id);
  });
  aplicarBase();
  renderizarLista();
  atualizarTotais();
}

// ---------- Dashboard: filtros ----------

function itensDoEscopo() {
  return itens.filter((i) => filtroGrupos.size === 0 || filtroGrupos.has(chaveGrupo(i)));
}

function periodoAtual() {
  const valor = $("filtro-periodo-cozinha").value;
  if (valor === "custom") {
    let de = $("data-de").value || "0000-01-01";
    let ate = $("data-ate").value || "9999-12-31";
    if (de > ate) [de, ate] = [ate, de];
    return { de, ate };
  }
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  inicio.setDate(inicio.getDate() - ((Number(valor) || 30) - 1));
  return { de: chaveDia(inicio), ate: chaveDia(new Date()) };
}

function chipHtml(tipo, chave, rotulo, ativo) {
  return `<button type="button" class="chip-filtro${ativo ? " chip-filtro--ativo" : ""}" data-tipo="${tipo}" data-chave="${escapeHtml(chave)}" aria-pressed="${ativo}">${escapeHtml(rotulo)}</button>`;
}

function preencherFiltrosDashboard() {
  // Grupos existentes (o "Sem grupo" sempre por último).
  const mapaGrupos = new Map();
  itens.forEach((i) => {
    const chave = chaveGrupo(i);
    if (!mapaGrupos.has(chave)) mapaGrupos.set(chave, chave === CHAVE_SEM_GRUPO ? "Sem grupo" : grupoDe(i));
  });
  [...filtroGrupos].forEach((chave) => {
    if (!mapaGrupos.has(chave)) filtroGrupos.delete(chave);
  });
  const grupos = [...mapaGrupos.entries()].sort(([ka, a], [kb, b]) => {
    if (ka === CHAVE_SEM_GRUPO) return 1;
    if (kb === CHAVE_SEM_GRUPO) return -1;
    return a.localeCompare(b, "pt-BR");
  });
  $("chips-grupo-cozinha").innerHTML = grupos.length
    ? grupos.map(([chave, rotulo]) => chipHtml("grupo", chave, rotulo, filtroGrupos.has(chave))).join("")
    : '<span class="legenda">Nenhum item cadastrado.</span>';

  // Produtos do escopo (grupos escolhidos).
  const produtos = itensDoEscopo().filter((i) => i.ativo !== false);
  const idsDoEscopo = new Set(produtos.map((i) => i.id));
  [...filtroProdutos].forEach((id) => {
    if (!idsDoEscopo.has(id)) filtroProdutos.delete(id);
  });
  $("chips-produto-cozinha").innerHTML = produtos.length
    ? produtos.map((i) => chipHtml("produto", i.id, i.nome, filtroProdutos.has(i.id))).join("")
    : '<span class="legenda">Nenhum produto neste grupo.</span>';

  const rotulosGrupos = grupos.filter(([chave]) => filtroGrupos.has(chave)).map(([, rotulo]) => rotulo);
  const rotulosProdutos = produtos.filter((i) => filtroProdutos.has(i.id)).map((i) => i.nome);
  $("resumo-filtros-cozinha").textContent =
    "Mostrando: " +
    (rotulosGrupos.length ? rotulosGrupos.join(", ") : "todos os grupos") +
    " · " +
    (rotulosProdutos.length ? rotulosProdutos.join(", ") : "total");
  $("btn-limpar-filtros-cozinha").hidden = !(rotulosGrupos.length || rotulosProdutos.length);
}

$("secao-dashboard").addEventListener("click", (e) => {
  const chip = e.target.closest(".chip-filtro");
  if (!chip) return;
  const { tipo, chave } = chip.dataset;

  if (tipo === "grupo") {
    if (filtroGrupos.has(chave)) filtroGrupos.delete(chave);
    else filtroGrupos.add(chave);
  } else {
    if (filtroProdutos.has(chave)) {
      filtroProdutos.delete(chave);
    } else {
      if (filtroProdutos.size >= MAX_LINHAS) {
        mostrarToast(`Escolha no máximo ${MAX_LINHAS} produtos por vez.`, "erro");
        return;
      }
      filtroProdutos.add(chave);
    }
  }
  renderizarDashboard();
});

$("btn-limpar-filtros-cozinha").addEventListener("click", () => {
  filtroGrupos.clear();
  filtroProdutos.clear();
  renderizarDashboard();
});

$("filtro-periodo-cozinha").addEventListener("change", (e) => {
  const custom = e.target.value === "custom";
  $("periodo-custom").hidden = !custom;
  if (custom && !$("data-de").value && !$("data-ate").value) {
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - 29);
    $("data-de").value = chaveDia(inicio);
    $("data-ate").value = chaveDia(new Date());
  }
  renderizarDashboard();
});
$("data-de").addEventListener("change", renderizarDashboard);
$("data-ate").addEventListener("change", renderizarDashboard);
$("so-baixos").addEventListener("change", renderizarDashboard);

// ---------- Dashboard: dados ----------

// Para cada dia com vistoria salva no período, a vistoria mais recente daquele dia.
function vistoriasPorDia(de, ate) {
  const mapa = new Map();
  [...vistorias].reverse().forEach((v) => {
    const dia = diaDaVistoria(v);
    if (dia >= de && dia <= ate) mapa.set(dia, v);
  });
  return mapa;
}

// Pontos conferidos de um item no período, um por dia.
function pontosDoItem(itemId, de, ate) {
  const pontos = [];
  const mapa = vistoriasPorDia(de, ate);
  [...mapa.keys()].sort().forEach((dia) => {
    const e = (mapa.get(dia).itens || []).find((i) => i.itemId === itemId && i.conferido);
    if (e) pontos.push({ dia, quantidade: Number(e.quantidade) || 0, entrada: Number(e.entrada) || 0 });
  });
  return pontos;
}

function destruir(grafico) {
  if (grafico) grafico.destroy();
  return null;
}

function renderizarDashboard() {
  preencherFiltrosDashboard();
  const { de, ate } = periodoAtual();
  renderizarIndicadores(de, ate);
  renderizarLinha(de, ate);
  renderizarEstoqueAtual();
  renderizarConsumo(de, ate);
  renderizarAtencao();
  renderizarUltima();
}

function listaAtencao() {
  return itensAtivos()
    .map((item) => {
      const u = ultimoConferido(item.id);
      if (!u) return { item, tipo: "sem-contagem" };
      const min = minimoDe(item);
      if (u.quantidade === 0) return { item, tipo: "acabou", ...u };
      if (min !== null && u.quantidade <= min) return { item, tipo: "baixo", min, ...u };
      return null;
    })
    .filter(Boolean);
}

function renderizarIndicadores(de, ate) {
  const mapa = vistoriasPorDia(de, ate);
  const doPeriodo = vistorias.filter((v) => {
    const dia = diaDaVistoria(v);
    return dia >= de && dia <= ate;
  });
  $("dash-total-itens").textContent = String(itensAtivos().length);
  $("dash-vistorias").textContent = String(doPeriodo.length);
  $("dash-vistorias-legenda").textContent = `${mapa.size} dia(s) com vistoria`;

  const ultima = vistorias[0];
  if (ultima) {
    $("dash-ultima").textContent = formatarData(dataDaVistoria(ultima));
    $("dash-ultima-legenda").textContent =
      `${ultima.totalConferidos ?? 0} de ${ultima.totalItens ?? (ultima.itens || []).length} conferidos`;
  } else {
    $("dash-ultima").textContent = "—";
    $("dash-ultima-legenda").textContent = "Nenhuma vistoria salva";
  }

  $("dash-baixos").textContent = String(listaAtencao().filter((a) => a.tipo !== "sem-contagem").length);
}

function renderizarLinha(de, ate) {
  graficoLinha = destruir(graficoLinha);
  const canvas = $("grafico-cozinha-linha");
  const sem = $("sem-dados-linha");
  const aviso = $("aviso-poucos-dados");
  aviso.hidden = true;

  const mapa = vistoriasPorDia(de, ate);
  const dias = [...mapa.keys()].sort();
  const escopoIds = new Set(itensDoEscopo().map((i) => i.id));
  const datasets = [];

  if (filtroProdutos.size > 0) {
    [...filtroProdutos].forEach((id) => {
      const item = itens.find((i) => i.id === id);
      if (!item) return;
      const data = dias.map((dia) => {
        const e = (mapa.get(dia).itens || []).find((i) => i.itemId === id && i.conferido);
        return e ? Number(e.quantidade) || 0 : null;
      });
      datasets.push({ label: item.nome, data });
    });
  } else {
    const data = dias.map((dia) => {
      const conf = (mapa.get(dia).itens || []).filter((i) => escopoIds.has(i.itemId) && i.conferido);
      return conf.length ? conf.reduce((soma, i) => soma + (Number(i.quantidade) || 0), 0) : null;
    });
    const nomesGrupos = [...filtroGrupos].map((chave) => {
      const item = itens.find((i) => chaveGrupo(i) === chave);
      return chave === CHAVE_SEM_GRUPO ? "Sem grupo" : item ? grupoDe(item) : chave;
    });
    datasets.push({ label: nomesGrupos.length ? `Total — ${nomesGrupos.join(", ")}` : "Total (itens conferidos)", data });
  }

  $("legenda-linha").textContent =
    filtroProdutos.size > 0
      ? "Quantidade de cada produto escolhido em cada vistoria salva."
      : "Soma dos itens conferidos em cada vistoria salva. Escolha produtos acima para ver uma linha para cada um.";

  const temDados = datasets.some((d) => d.data.some((v) => v !== null));
  if (!dias.length || !temDados) {
    canvas.hidden = true;
    sem.hidden = false;
    sem.textContent = !dias.length
      ? "Nenhuma vistoria salva neste período."
      : "Os itens escolhidos não foram conferidos nas vistorias deste período.";
    return;
  }

  canvas.hidden = false;
  sem.hidden = true;
  aviso.hidden = dias.length > 1;

  const unico = datasets.length === 1;
  datasets.forEach((d, idx) => {
    const cor = PALETA[idx % PALETA.length];
    Object.assign(d, {
      borderColor: cor,
      backgroundColor: unico ? cor + "22" : cor,
      fill: unico,
      tension: 0.2,
      borderWidth: 2,
      pointRadius: 4,
      pointHoverRadius: 6,
      spanGaps: true,
    });
  });

  graficoLinha = new Chart(canvas, {
    type: "line",
    data: { labels: dias.map((dia) => rotuloDia(dia)), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: datasets.length > 1 },
        tooltip: {
          callbacks: {
            title: (t) => rotuloDia(dias[t[0].dataIndex], true),
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}`,
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

function renderizarEstoqueAtual() {
  graficoEstoque = destruir(graficoEstoque);
  const canvas = $("grafico-cozinha-estoque");
  const area = $("area-grafico-estoque");
  const sem = $("sem-dados-estoque");

  let linhas = itensDoEscopo()
    .filter((i) => i.ativo !== false && (filtroProdutos.size === 0 || filtroProdutos.has(i.id)))
    .map((item) => {
      const u = ultimoConferido(item.id);
      return u ? { item, quantidade: u.quantidade, data: u.data } : null;
    })
    .filter(Boolean);

  if ($("so-baixos").checked) linhas = linhas.filter((l) => estaBaixo(l.item, l.quantidade));

  linhas.sort(
    (a, b) => a.quantidade - b.quantidade || String(a.item.nome).localeCompare(String(b.item.nome), "pt-BR")
  );
  const total = linhas.length;
  linhas = linhas.slice(0, 25);

  if (!linhas.length) {
    canvas.hidden = true;
    area.style.height = "auto";
    sem.hidden = false;
    sem.textContent = $("so-baixos").checked
      ? "Nenhum item baixo ou zerado. 🎉"
      : "Nenhuma contagem conferida para mostrar.";
    return;
  }

  canvas.hidden = false;
  sem.hidden = true;
  area.style.height = `${Math.max(200, linhas.length * 34)}px`;

  const cores = linhas.map((l) => {
    if (l.quantidade === 0) return "#a83232";
    const min = minimoDe(l.item);
    return min !== null && l.quantidade <= min ? "#c2790a" : "#235571";
  });

  graficoEstoque = new Chart(canvas, {
    type: "bar",
    data: {
      labels: linhas.map((l) => l.item.nome),
      datasets: [{ label: "Em estoque", data: linhas.map((l) => l.quantidade), backgroundColor: cores, borderRadius: 4 }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.x} ${linhas[ctx.dataIndex].item.unidade || "un."}`,
            afterLabel: (ctx) => {
              const l = linhas[ctx.dataIndex];
              const min = minimoDe(l.item);
              return [min !== null ? `Mínimo: ${min}` : "Sem mínimo cadastrado", `Contado em ${formatarData(l.data)}`];
            },
          },
        },
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 } },
        y: { ticks: { autoSkip: false } },
      },
    },
  });

  if (total > linhas.length) {
    mostrarToast(`Mostrando os ${linhas.length} itens com menor estoque de ${total}. Use os filtros para ver os outros.`, "ok");
  }
}

function renderizarConsumo(de, ate) {
  graficoConsumo = destruir(graficoConsumo);
  const canvas = $("grafico-cozinha-consumo");
  const area = $("area-grafico-consumo");
  const sem = $("sem-dados-consumo");

  const resultados = itensDoEscopo()
    .filter((i) => filtroProdutos.size === 0 || filtroProdutos.has(i.id))
    .map((item) => {
      const pontos = pontosDoItem(item.id, de, ate);
      let consumoTotal = 0;
      let diasTotal = 0;
      let intervalos = 0;
      for (let k = 1; k < pontos.length; k++) {
        const a = pontos[k - 1];
        const b = pontos[k];
        const dias = Math.round(
          (new Date(b.dia + "T12:00:00") - new Date(a.dia + "T12:00:00")) / 86400000
        );
        if (dias < 1) continue;
        // O que havia + o que chegou - o que sobrou = o que foi consumido.
        const consumo = a.quantidade + b.entrada - b.quantidade;
        if (consumo < 0) continue; // estoque subiu além da entrada informada: reposição desconhecida
        consumoTotal += consumo;
        diasTotal += dias;
        intervalos++;
      }
      return diasTotal > 0 ? { item, taxa: consumoTotal / diasTotal, intervalos } : null;
    })
    .filter((r) => r && r.taxa > 0)
    .sort((a, b) => b.taxa - a.taxa || String(a.item.nome).localeCompare(String(b.item.nome), "pt-BR"))
    .slice(0, 10);

  if (!resultados.length) {
    canvas.hidden = true;
    area.style.height = "auto";
    sem.hidden = false;
    return;
  }

  canvas.hidden = false;
  sem.hidden = true;
  area.style.height = `${Math.max(200, resultados.length * 36)}px`;

  graficoConsumo = new Chart(canvas, {
    type: "bar",
    data: {
      labels: resultados.map((r) => r.item.nome),
      datasets: [
        {
          label: "Consumo por dia",
          data: resultados.map((r) => Math.round(r.taxa * 10) / 10),
          backgroundColor: "#235571",
          borderRadius: 4,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.x} ${resultados[ctx.dataIndex].item.unidade || "un."} por dia`,
            afterLabel: (ctx) => `Baseado em ${resultados[ctx.dataIndex].intervalos} intervalo(s) entre vistorias`,
          },
        },
      },
      scales: {
        x: { beginAtZero: true },
        y: { ticks: { autoSkip: false } },
      },
    },
  });
}

function renderizarAtencao() {
  const container = $("dash-lista-atencao");
  const itensAtencao = listaAtencao().sort((a, b) => {
    const peso = { acabou: 0, baixo: 1, "sem-contagem": 2 };
    return peso[a.tipo] - peso[b.tipo] || String(a.item.nome).localeCompare(String(b.item.nome), "pt-BR");
  });

  if (!itensAtencao.length) {
    container.innerHTML = '<p class="mensagem-vazio">Nenhum item zerado ou abaixo do mínimo. 🎉</p>';
    return;
  }

  container.innerHTML = itensAtencao
    .map((a) => {
      const nome = escapeHtml(a.item.nome);
      if (a.tipo === "sem-contagem") {
        return `<div class="cozinha-linha-atual"><span>${nome}</span><span class="nao-conf">sem contagem</span></div>`;
      }
      const selo =
        a.tipo === "acabou"
          ? '<span class="selo selo--vencido">Acabou</span>'
          : `<span class="selo selo--atencao">Baixo (mín. ${a.min})</span>`;
      return `<div class="cozinha-linha-atual"><span>${nome}${selo}</span><span>${a.quantidade} · ${formatarData(a.data)}</span></div>`;
    })
    .join("");
}

function renderizarUltima() {
  const container = $("dash-lista-ultima");
  const ultima = vistorias[0];
  if (!ultima || !(ultima.itens || []).length) {
    container.innerHTML = '<p class="mensagem-vazio">Nenhuma vistoria salva ainda.</p>';
    return;
  }

  container.innerHTML = [...ultima.itens]
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR", { sensitivity: "base" }))
    .map((i) => {
      const nome = escapeHtml(i.nome);
      const valor = `${Number(i.quantidade) || 0} ${escapeHtml(i.unidade || "un.")}`;
      return i.conferido
        ? `<div class="cozinha-linha-atual"><span>${nome}</span><span>${valor}</span></div>`
        : `<div class="cozinha-linha-atual"><span class="nao-conf">${nome} (não conferido)</span><span class="nao-conf">${valor}</span></div>`;
    })
    .join("");
                          }
