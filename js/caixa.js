import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
import { mostrarToast } from "./toast.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

let estabelecimentoAtual = null;
const campoCodigo = document.getElementById("campo-codigo");

protegerPagina(({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;

  if (!estabelecimento.baixaAutomaticaAtiva) {
    document.getElementById("caixa-status-texto").textContent = "Desativado";
    document.querySelector(".caixa-status").classList.add("caixa-status--desativado");
    document.getElementById("caixa-desativado").hidden = false;
    return;
  }

  document.getElementById("caixa-ativo").hidden = false;
  document.getElementById("caixa-status-texto").textContent = "Pronto para leitura";
  campoCodigo.focus();
});

document.getElementById("form-scanner").addEventListener("submit", async (e) => {
  e.preventDefault();
  const codigo = campoCodigo.value.trim();
  campoCodigo.value = "";
  campoCodigo.focus();

  if (!codigo) return;
  await processarLeitura(codigo);
});

async function processarLeitura(codigo, tentativas = 0) {
  try {
    const produtosSnap = await getDocs(
      query(
        collection(db, "produtos"),
        where("estabelecimentoId", "==", estabelecimentoAtual.id),
        where("codigoBarras", "==", codigo)
      )
    );

    if (produtosSnap.empty) {
      registrarLeitura(null, "Código não reconhecido.", "erro");
      return;
    }

    const produto = { id: produtosSnap.docs[0].id, ...produtosSnap.docs[0].data() };

    const lotesSnap = await getDocs(
      query(
        collection(db, "lotes"),
        where("estabelecimentoId", "==", estabelecimentoAtual.id),
        where("produtoId", "==", produto.id)
      )
    );

    const candidatos = lotesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((l) => Number(l.quantidade) > 0)
      .sort((a, b) => Number(b.quantidade) - Number(a.quantidade));

    if (candidatos.length === 0) {
      registrarLeitura(produto.nome, "Sem estoque registrado para este produto.", "erro");
      return;
    }

    const loteRef = doc(db, "lotes", candidatos[0].id);

    const resultado = await runTransaction(db, async (tx) => {
      const loteSnap = await tx.get(loteRef);

      if (!loteSnap.exists()) {
        return { status: "lote-mudou" };
      }

      const lote = loteSnap.data();
      const quantidadeAtual = Number(lote.quantidade) || 0;

      if (quantidadeAtual <= 0) {
        return { status: "lote-mudou" };
      }

      const quantidadeNova = quantidadeAtual - 1;
      const refMovimentoEstoque = doc(collection(db, "movimentosEstoque"));
      tx.set(refMovimentoEstoque, {
        estabelecimentoId: estabelecimentoAtual.id,
        produtoId: produto.id,
        produtoNome: produto.nome,
        local: "geral",
        tipo: "venda",
        quantidade: 1,
        delta: -1,
        origem: "caixa",
        registradoEm: serverTimestamp(),
      });

      if (quantidadeNova > 0) {
        tx.update(loteRef, { quantidade: quantidadeNova });
        return { status: "baixado", quantidadeNova, precoPromocional: lote.promocaoAtiva && lote.precoPromocional != null ? lote.precoPromocional : null };
      }

      const refSaida = doc(collection(db, "saidas"));
      tx.delete(loteRef);
      tx.set(refSaida, {
        estabelecimentoId: estabelecimentoAtual.id,
        produtoId: produto.id,
        produtoNome: produto.nome,
        motivo: "vendido",
        quantidade: 1,
        precoCusto: lote.precoCusto ?? produto.precoCusto ?? 0,
        valor: (lote.precoCusto ?? produto.precoCusto ?? 0) * 1,
        local: lote.local || "",
        dataVencimentoOriginal: lote.dataVencimento,
        origem: "caixa",
        registradoEm: serverTimestamp(),
      });
      return { status: "encerrado", precoPromocional: lote.promocaoAtiva && lote.precoPromocional != null ? lote.precoPromocional : null };
    });

    const precoPromocional = resultado.precoPromocional;
    const precoCadastro = produto.precoVenda;
    const precoUnitario = precoPromocional != null && precoPromocional !== "" && Number.isFinite(Number(precoPromocional))
      ? Number(precoPromocional)
      : (precoCadastro != null && precoCadastro !== "" && Number.isFinite(Number(precoCadastro)) ? Number(precoCadastro) : null);

    if (resultado.status === "baixado") {
      registrarLeitura(produto.nome, `Baixa registrada — restam ${resultado.quantidadeNova} un.`, "ok", { produtoId: produto.id, precoUnitario });
    } else if (resultado.status === "encerrado") {
      registrarLeitura(produto.nome, "Baixa registrada — lote encerrado.", "ok", { produtoId: produto.id, precoUnitario });
    } else if (tentativas < 3) {
      await processarLeitura(codigo, tentativas + 1);
    } else {
      registrarLeitura(produto.nome, "Estoque mudou repetidamente durante a leitura — tente de novo.", "erro");
    }
  } catch (erro) {
    console.error(erro);
    registrarLeitura(null, "Erro ao processar. Tente ler de novo.", "erro");
  }
}

let totalLeiturasSessao = 0;
const itensCompra = new Map();

function dinheiro(valor) {
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function registrarLeitura(produtoNome, mensagem, tipo, detalhes = null) {
  if (tipo !== "ok") mostrarToast(produtoNome ? `${produtoNome}: ${mensagem}` : mensagem, tipo);
  if (tipo !== "ok" || !detalhes) return;

  const chave = detalhes.produtoId || produtoNome;
  const existente = itensCompra.get(chave);
  if (existente) {
    existente.quantidade += 1;
    if (existente.precoUnitario == null && detalhes.precoUnitario != null) existente.precoUnitario = detalhes.precoUnitario;
  } else {
    itensCompra.set(chave, { produtoId: chave, nome: produtoNome, quantidade: 1, precoUnitario: detalhes.precoUnitario });
  }
  totalLeiturasSessao += 1;
  renderizarCompra();
}

function renderizarCompra() {
  const container = document.getElementById("lista-leituras");
  const itens = [...itensCompra.values()];
  const unidades = itens.reduce((soma, item) => soma + item.quantidade, 0);
  const incompletos = itens.some(item => item.precoUnitario == null);
  const totalConhecido = itens.reduce((soma, item) => soma + (item.precoUnitario == null ? 0 : item.precoUnitario * item.quantidade), 0);
  document.getElementById("caixa-contador-leituras").textContent = `${itens.length} ${itens.length === 1 ? "produto" : "produtos"}`;
  document.getElementById("caixa-total-unidades").textContent = String(unidades);
  document.getElementById("caixa-total-valor").textContent = incompletos ? `${dinheiro(totalConhecido)}*` : dinheiro(totalConhecido);
  document.getElementById("caixa-aviso-precos").hidden = !incompletos;

  if (!itens.length) {
    container.innerHTML = '<div class="caixa-vazio"><div class="caixa-vazio-icone" aria-hidden="true">▢</div><strong>Vamos começar?</strong><p>Os produtos adicionados aparecerão aqui, com os preços cadastrados.</p></div>';
    return;
  }
  container.innerHTML = itens.map(item => {
    const total = item.precoUnitario == null ? "—" : dinheiro(item.precoUnitario * item.quantidade);
    const unitario = item.precoUnitario == null ? "Sem preço" : dinheiro(item.precoUnitario);
    return `<div class="caixa-item-compra"><div class="caixa-item-nome">${escapeHtml(item.nome)}</div><div class="caixa-item-qtd">${item.quantidade}</div><div class="caixa-item-unitario">${unitario}</div><div class="caixa-item-total">${total}</div></div>`;
  }).join("");
}
