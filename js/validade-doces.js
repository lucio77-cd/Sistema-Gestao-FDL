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
const seletorProduto = $("doce-produto");
let estabelecimentoAtual = null;
let produtos = [];
let registros = [];
let editandoId = null;
let salvando = false;

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  $("nome-estabelecimento").textContent = estabelecimento.nome;
  await Promise.all([carregarProdutos(), carregarRegistros()]);
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

function descricaoProduto(produto) {
  return [produto.marca, produto.variante, produto.embalagem, produto.volume]
    .filter(Boolean).join(" · ");
}

async function carregarProdutos() {
  seletorProduto.innerHTML = '<option value="">Carregando produtos…</option>';
  try {
    const snap = await getDocs(query(
      collection(db, "produtos"),
      where("estabelecimentoId", "==", estabelecimentoAtual.id)
    ));
    produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.ativo !== false)
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", { sensitivity: "base" }));
    renderizarOpcoesProdutos();
  } catch (erro) {
    console.error("Falha ao carregar catálogo para validade:", erro);
    seletorProduto.innerHTML = '<option value="">Não foi possível carregar os produtos</option>';
    mostrarToast("Não foi possível carregar o cadastro de Produtos.", "erro");
  }
}

function renderizarOpcoesProdutos() {
  const atual = seletorProduto.value;
  seletorProduto.innerHTML = '<option value="">Selecione um produto cadastrado</option>' +
    produtos.map(p => {
      const detalhe = descricaoProduto(p);
      const rotulo = detalhe ? `${p.nome} — ${detalhe}` : p.nome;
      return `<option value="${escapeHtml(p.id)}">${escapeHtml(rotulo)}</option>`;
    }).join("");
  if (produtos.some(p => p.id === atual)) seletorProduto.value = atual;
  if (!produtos.length) {
    seletorProduto.innerHTML = '<option value="">Nenhum produto ativo cadastrado</option>';
  }
}

async function carregarRegistros() {
  lista.innerHTML = '<p class="mensagem-vazio">Carregando lotes…</p>';
  try {
    const snap = await getDocs(query(
      collection(db, "docesValidade"),
      where("estabelecimentoId", "==", estabelecimentoAtual.id)
    ));
    registros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    registros.sort((a, b) => String(a.dataVencimento || "").localeCompare(String(b.dataVencimento || "")));
    renderizar();
  } catch (erro) {
    console.error("Falha ao carregar validade dos produtos:", erro);
    lista.innerHTML = '<p class="mensagem-vazio">Não foi possível carregar os lotes. Verifique se as regras atualizadas do Firestore foram publicadas.</p>';
    mostrarToast("Erro ao carregar a validade dos produtos.", "erro");
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
  const produto = produtos.find(p => p.id === registro.produtoId);
  const detalhes = produto ? descricaoProduto(produto) : [registro.marca, registro.variante, registro.embalagem, registro.volume].filter(Boolean).join(" · ");
  const acao = encerrado ? "Reabrir lote" : "Encerrar lote";
  return `<article class="${classe}" data-id="${escapeHtml(registro.id)}">
    <div class="doce-card-conteudo">
      <div class="doce-card-titulo"><h3>${escapeHtml(registro.nome)}</h3>${encerrado ? '<span class="selo selo--sem-validade">Encerrado</span>' : seloHtml(status.status)}</div>
      ${detalhes ? `<p class="doce-card-obs">${escapeHtml(detalhes)}</p>` : ""}
      <div class="doce-card-dados">
        <span><strong>${quantidade}</strong> ${quantidade === 1 ? "unidade" : "unidades"}</span>
        <span>Vencimento: <strong>${dataPt(registro.dataVencimento)}</strong></span>
        <span>${escapeHtml(encerrado ? "Fora da venda" : formatarDiasRestantes(status.diasRestantes))}</span>
        ${registro.lote ? `<span>Lote: <strong>${escapeHtml(registro.lote)}</strong></span>` : ""}
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
    lista.innerHTML = '<div class="painel estado-vazio"><p>Nenhum lote neste filtro.</p><span class="legenda">Cadastre um produto na aba Produtos e depois registre seu lote aqui.</span></div>';
    return;
  }
  lista.innerHTML = filtrados.map(cartao).join("");
}

function limparFormulario() {
  form.reset();
  $("doce-quantidade").value = "1";
  $("doce-lote").value = "";
  editandoId = null;
  $("doces-form-titulo").textContent = "Adicionar lote";
  $("doce-salvar").textContent = "Salvar lote";
  $("doce-cancelar").hidden = true;
  renderizarOpcoesProdutos();
}

function iniciarEdicao(id) {
  const registro = registros.find(r => r.id === id);
  if (!registro) return;
  editandoId = id;
  renderizarOpcoesProdutos();

  // Compatibilidade: registros antigos não tinham vínculo com o catálogo.
  // Eles continuam editáveis e preservam o nome já salvo.
  if (registro.produtoId && produtos.some(p => p.id === registro.produtoId)) {
    seletorProduto.value = registro.produtoId;
  } else {
    const legado = `__legado__${registro.id}`;
    seletorProduto.add(new Option(`${registro.nome} (registro anterior)`, legado, true, true));
  }

  $("doce-quantidade").value = String(registro.quantidade ?? 1);
  $("doce-validade").value = registro.dataVencimento || "";
  $("doce-lote").value = registro.lote || "";
  $("doce-observacao").value = registro.observacao || "";
  $("doces-form-titulo").textContent = "Editar lote";
  $("doce-salvar").textContent = "Salvar alterações";
  $("doce-cancelar").hidden = false;
  form.scrollIntoView({ behavior: "smooth", block: "center" });
  seletorProduto.focus({ preventScroll: true });
}

form.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (salvando || !estabelecimentoAtual) return;
  const produtoId = seletorProduto.value;
  const quantidade = Number($("doce-quantidade").value);
  const dataVencimento = $("doce-validade").value;
  const lote = $("doce-lote").value.trim();
  const observacao = $("doce-observacao").value.trim();
  const registroLegado = editandoId && produtoId === `__legado__${editandoId}`
    ? registros.find(r => r.id === editandoId)
    : null;
  const produto = produtos.find(p => p.id === produtoId);
  if ((!produto && !registroLegado) || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > 1000000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(dataVencimento) || lote.length > 60 || observacao.length > 240) {
    mostrarToast("Selecione um produto e confira quantidade, lote e validade.", "erro");
    return;
  }

  salvando = true;
  $("doce-salvar").disabled = true;
  try {
    const dadosProduto = produto ? {
      produtoId: produto.id,
      nome: produto.nome,
      marca: produto.marca || "",
      categoria: produto.categoria || "",
      variante: produto.variante || "",
      embalagem: produto.embalagem || "",
      volume: produto.volume || ""
    } : {
      nome: registroLegado.nome,
      ...(registroLegado.produtoId ? { produtoId: registroLegado.produtoId } : {})
    };
    const dados = {
      ...dadosProduto,
      quantidade,
      dataVencimento,
      lote,
      observacao,
      atualizadoEm: serverTimestamp()
    };
    if (editandoId) {
      await updateDoc(doc(db, "docesValidade", editandoId), dados);
      mostrarToast("Lote atualizado.");
    } else {
      await addDoc(collection(db, "docesValidade"), {
        ...dados,
        estabelecimentoId: estabelecimentoAtual.id,
        ativo: true,
        criadoEm: serverTimestamp()
      });
      mostrarToast("Lote registrado.");
    }
    limparFormulario();
    await carregarRegistros();
  } catch (erro) {
    console.error("Falha ao salvar validade do lote:", erro);
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
      mostrarToast(registro.ativo === false ? "Lote reaberto para venda." : "Lote encerrado.");
      await carregarRegistros();
    } catch (erro) {
      console.error("Falha ao atualizar situação do lote:", erro);
      mostrarToast("Não foi possível atualizar a situação.", "erro");
      botao.disabled = false;
    }
  }
});
