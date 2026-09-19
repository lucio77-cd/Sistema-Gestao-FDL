import { db } from "./firebase-config.js";
import { protegerPagina, sair } from "./auth-guard.js";
import { mostrarToast } from "./toast.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
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

async function processarLeitura(codigo) {
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

    // Não dá pra saber de qual lote físico a venda saiu (o scanner só
    // identifica o produto, não o lote) — por isso a baixa sai sempre do
    // lote com MAIS quantidade daquele produto: reduz o risco de zerar à
    // toa um lote pequeno que na real não foi o vendido.
    const lotesSnap = await getDocs(
      query(
        collection(db, "lotes"),
        where("estabelecimentoId", "==", estabelecimentoAtual.id),
        where("produtoId", "==", produto.id)
      )
    );

    const lotes = lotesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((l) => Number(l.quantidade) > 0)
      .sort((a, b) => Number(b.quantidade) - Number(a.quantidade));

    if (lotes.length === 0) {
      registrarLeitura(produto.nome, "Sem estoque registrado para este produto.", "erro");
      return;
    }

    const lote = lotes[0];
    const quantidadeNova = Number(lote.quantidade) - 1;

    if (quantidadeNova > 0) {
      await updateDoc(doc(db, "lotes", lote.id), { quantidade: quantidadeNova });
      registrarLeitura(produto.nome, `Baixa registrada — restam ${quantidadeNova} un.`, "ok");
    } else {
      // Chegou a zero na hora da venda: o motivo é inequívoco (foi vendido
      // agora, no caixa), então arquiva direto, sem perguntar nada — não dá
      // pra parar o fluxo do caixa pra decidir algo que já é óbvio aqui.
      await deleteDoc(doc(db, "lotes", lote.id));
      await addDoc(collection(db, "saidas"), {
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
      registrarLeitura(produto.nome, "Baixa registrada — lote encerrado.", "ok");
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
      <div class="lote-produto">${produtoNome || "—"}</div>
      <div class="lote-meta">${mensagem}</div>
    </div>
    <div class="lote-dados">
      <div class="lote-valor">${hora}</div>
    </div>
  `;
  container.prepend(div);
}
