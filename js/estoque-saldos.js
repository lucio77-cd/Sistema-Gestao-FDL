import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import {
  collection, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const lista = document.getElementById("lista-saldos-registrados");

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

function nomeProduto(produto) {
  return [produto.marca, produto.nome, produto.variante, produto.embalagem, produto.volume]
    .filter(Boolean).join(" · ") || "Produto sem nome";
}

protegerPagina(async ({ estabelecimento }) => {
  try {
    const [produtosSnap, estoqueSnap] = await Promise.all([
      getDocs(query(
        collection(db, "produtos"),
        where("estabelecimentoId", "==", estabelecimento.id)
      )),
      getDocs(query(
        collection(db, "estoque"),
        where("estabelecimentoId", "==", estabelecimento.id)
      ))
    ]);

    const saldosPorProduto = new Map();
    estoqueSnap.forEach(documento => {
      const saldo = documento.data();
      // Compatibilidade com registros cujo ID do documento não seja o ID do produto.
      saldosPorProduto.set(documento.id, saldo);
      if (saldo.produtoId && !saldosPorProduto.has(saldo.produtoId)) {
        saldosPorProduto.set(saldo.produtoId, saldo);
      }
    });

    const produtos = produtosSnap.docs
      .map(documento => ({ id: documento.id, ...documento.data() }))
      .filter(produto => produto.ativo !== false)
      .sort((a, b) => nomeProduto(a).localeCompare(nomeProduto(b), "pt-BR", { sensitivity: "base" }));

    if (!produtos.length) {
      lista.innerHTML = '<p class="mensagem-vazio">Nenhum produto ativo foi encontrado para este estabelecimento.</p>';
      return;
    }

    lista.innerHTML = produtos.map(produto => {
      const saldo = saldosPorProduto.get(produto.id) || {};
      const local = produto.localEstoque;
      const quantidade = local === "geladeira" || local === "seco"
        ? numero(saldo[local])
        : numero(saldo.geladeira) + numero(saldo.seco);
      const localTexto = local === "geladeira" ? "Geladeira"
        : local === "seco" ? "Parte seca" : "Total dos locais";
      const detalhe = local === "geladeira" || local === "seco"
        ? localTexto
        : "Geladeira: " + numero(saldo.geladeira) + " · Parte seca: " + numero(saldo.seco);

      return '<article class="stock-item">' +
        '<div class="stock-item-head"><div><strong>' + esc(nomeProduto(produto)) +
        '</strong><small>' + esc(detalhe) + '</small></div>' +
        '<span class="selo ' + (quantidade > 0 ? "selo--normal" : "selo--sem-validade") + '">' +
        quantidade + ' un.</span></div></article>';
    }).join("");
  } catch (erro) {
    console.error("Falha ao consultar os saldos registrados:", erro);
    lista.innerHTML = '<p class="mensagem-vazio">Não foi possível consultar os saldos registrados. Verifique a permissão de leitura das coleções produtos e estoque. O detalhe técnico está no console do navegador.</p>';
  }
});
