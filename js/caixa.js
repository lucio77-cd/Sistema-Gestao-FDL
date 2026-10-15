import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { escapeHtml } from "./status.js";
import { mostrarToast } from "./toast.js";
import { calcularBaixaEstoque } from "./caixa-stock.js";
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
    document.getElementById("caixa-desativado").hidden = false;
    return;
  }

  document.getElementById("caixa-ativo").hidden = false;
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
    const estoqueRef = doc(db, "estoque", produto.id);

    const resultado = await runTransaction(db, async (tx) => {
      // Todas as leituras acontecem antes de qualquer escrita na transação.
      const loteSnap = await tx.get(loteRef);
      const estoqueSnap = await tx.get(estoqueRef);

      if (!loteSnap.exists()) {
        return { status: "lote-mudou" };
      }

      const lote = loteSnap.data();
      const quantidadeAtual = Number(lote.quantidade) || 0;

      // Revalida o vínculo, pois a lista de candidatos foi consultada antes
      // da transação e pode ter ficado desatualizada.
      if (
        lote.estabelecimentoId !== estabelecimentoAtual.id ||
        lote.produtoId !== produto.id ||
        quantidadeAtual <= 0
      ) {
        return { status: "lote-mudou" };
      }

      const quantidadeNova = quantidadeAtual - 1;
      const refSaida = doc(collection(db, "saidas"));
      const refMovimento = doc(collection(db, "movimentosEstoque"));
      const precoCusto = Number(lote.precoCusto ?? produto.precoCusto) || 0;

      // Cada leitura válida gera uma saída, não apenas a última unidade do lote.
      if (quantidadeNova > 0) {
        tx.update(loteRef, { quantidade: quantidadeNova });
      } else {
        tx.delete(loteRef);
      }

      tx.set(refSaida, {
        estabelecimentoId: estabelecimentoAtual.id,
        produtoId: produto.id,
        produtoNome: produto.nome,
        motivo: "vendido",
        quantidade: 1,
        precoCusto,
        valor: precoCusto,
        local: lote.local || "",
        dataVencimentoOriginal: lote.dataVencimento ?? null,
        origem: "caixa",
        registradoEm: serverTimestamp(),
      });

      // O saldo geral é uma contagem independente. Se já existe um documento
      // de estoque, a venda baixa o campo correspondente na mesma transação.
      // Se nunca foi contado, não inventamos um saldo inicial negativo: o
      // movimento fica registrado com saldoAtualizado=false para reconciliação.
      let localEstoque = null;
      if (lote.local === "Geladeira") localEstoque = "geladeira";
      else if (lote.local === "Estoque seco" || lote.local === "Seco") localEstoque = "seco";

      const saldoExiste = estoqueSnap.exists() && localEstoque !== null;
      const baixa = calcularBaixaEstoque(
        saldoExiste ? estoqueSnap.data()[localEstoque] : null,
        saldoExiste
      );

      // A venda e a baixa do lote são registradas mesmo quando o saldo contado
      // já está zerado; nesse caso, preservamos zero e sinalizamos divergência.
      if (baixa.atualizar) {
        tx.update(estoqueRef, {
          [localEstoque]: baixa.depois,
          atualizadoEm: serverTimestamp(),
        });
      }

      tx.set(refMovimento, {
        estabelecimentoId: estabelecimentoAtual.id,
        produtoId: produto.id,
        produtoNome: produto.nome,
        local: localEstoque || lote.local || "",
        tipo: "venda",
        delta: -1,
        antes: baixa.antes,
        depois: baixa.depois,
        saldoAtualizado: baixa.atualizar,
        divergenciaSaldo: baixa.divergencia,
        origem: "caixa",
        registradoEm: serverTimestamp(),
      });

      return {
        status: "registrado",
        quantidadeNova,
        saldoAtualizado: baixa.atualizar,
        saldoDepois: baixa.depois,
        divergenciaSaldo: baixa.divergencia,
        saldoNaoContado: !saldoExiste,
      };
    });

    if (resultado.status === "registrado") {
      const mensagemLote = resultado.quantidadeNova > 0
        ? `Venda registrada — restam ${resultado.quantidadeNova} un. no lote.`
        : "Venda registrada — lote encerrado.";
      let mensagemSaldo;
      if (resultado.saldoAtualizado) {
        mensagemSaldo = ` Saldo geral: ${resultado.saldoDepois} un.`;
      } else if (resultado.divergenciaSaldo) {
        mensagemSaldo = " ATENÇÃO: saldo geral já estava zerado; mantido em 0. Confira o estoque físico.";
      } else {
        mensagemSaldo = " Saldo geral ainda não contado; venda registrada no histórico.";
      }
      registrarLeitura(produto.nome, mensagemLote + mensagemSaldo, "ok");
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

function registrarLeitura(produtoNome, mensagem, tipo) {
  mostrarToast(produtoNome ? `${produtoNome}: ${mensagem}` : mensagem, tipo);

  const container = document.getElementById("lista-leituras");
  if (container.querySelector(".mensagem-vazio")) container.innerHTML = "";

  const div = document.createElement("div");
  div.className = `lote ${tipo === "erro" ? "lote--vencido" : "lote--normal"}`;
  const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  div.innerHTML = `
    <div class="lote-info">
      <div class="lote-produto">${escapeHtml(produtoNome) || "—"}</div>
      <div class="lote-meta">${escapeHtml(mensagem)}</div>
    </div>
    <div class="lote-dados">
      <div class="lote-valor">${hora}</div>
    </div>
  `;
  container.prepend(div);
}
