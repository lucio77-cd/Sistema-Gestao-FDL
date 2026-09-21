import { db } from "./firebase-config.js";
import { protegerPagina, sair } from "./auth-guard.js";
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

document.getElementById("link-sair").addEventListener("click", (e) => {
  e.preventDefault();
  sair();
});

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

// tentativas: proteção contra loop infinito no caso raro de o lote
// escolhido mudar de estado repetidamente entre a query e a transação.
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

    // A escolha de QUAL lote sofre a baixa ainda é feita fora da transação
    // (o Firestore não permite query dentro de uma transação) — por isso
    // ainda existe uma janela pequena em que "o lote com mais quantidade"
    // pode estar levemente desatualizado se dois scans do mesmo produto
    // chegarem quase juntos. O que a transação abaixo elimina é o problema
    // mais grave: duas leituras decrementando o MESMO documento ao mesmo
    // tempo e uma sobrescrevendo silenciosamente a outra (lost update).
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
        // Outro scan/processo já encerrou este lote entre a query e agora.
        return { status: "lote-mudou" };
      }

      const lote = loteSnap.data();
      const quantidadeAtual = Number(lote.quantidade) || 0;

      if (quantidadeAtual <= 0) {
        return { status: "lote-mudou" };
      }

      const quantidadeNova = quantidadeAtual - 1;

      if (quantidadeNova > 0) {
        tx.update(loteRef, { quantidade: quantidadeNova });
        return { status: "baixado", quantidadeNova };
      }

      // Chegou a zero na hora da venda: motivo inequívoco, arquiva direto.
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
      return { status: "encerrado" };
    });

    if (resultado.status === "baixado") {
      registrarLeitura(produto.nome, `Baixa registrada — restam ${resultado.quantidadeNova} un.`, "ok");
    } else if (resultado.status === "encerrado") {
      registrarLeitura(produto.nome, "Baixa registrada — lote encerrado.", "ok");
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

function escapeHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto ?? "";
  return div.innerHTML;
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
