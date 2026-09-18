import { db } from "./firebase-config.js";
import { protegerPagina, sair } from "./auth-guard.js";
import { formatarMoeda, formatarData, formatarValorOuAviso } from "./status.js";
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.getElementById("link-sair").addEventListener("click", (e) => {
  e.preventDefault();
  sair();
});

protegerPagina(async ({ estabelecimento }) => {
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  await carregar(estabelecimento.id);
});

async function carregar(estabelecimentoId) {
  const container = document.getElementById("lista-perdas");

  let snap;
  try {
    snap = await getDocs(
      query(
        collection(db, "perdas"),
        where("estabelecimentoId", "==", estabelecimentoId),
        orderBy("registradoEm", "desc")
      )
    );
  } catch (erro) {
    // Sem o índice composto (estabelecimentoId + registradoEm) publicado,
    // a consulta ordenada falha. Faz um fallback sem ordenação em vez de
    // travar a tela — e ordena no cliente.
    console.warn("Consulta ordenada falhou, tentando sem orderBy:", erro);
    snap = await getDocs(query(collection(db, "perdas"), where("estabelecimentoId", "==", estabelecimentoId)));
  }

  const perdas = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const dataA = a.registradoEm?.toDate ? a.registradoEm.toDate() : new Date(0);
      const dataB = b.registradoEm?.toDate ? b.registradoEm.toDate() : new Date(0);
      return dataB - dataA;
    });

  const total = perdas.reduce((soma, p) => soma + (Number(p.valorPerdido) || 0), 0);
  document.getElementById("total-perdido").textContent = formatarMoeda(total);

  container.innerHTML = "";

  if (perdas.length === 0) {
    container.innerHTML = '<p class="mensagem-vazio">Nenhuma perda registrada ainda.</p>';
    return;
  }

  perdas.forEach((p) => {
    const data = p.registradoEm?.toDate ? p.registradoEm.toDate() : null;
    const dataTexto = data ? data.toLocaleDateString("pt-BR") : "—";

    const div = document.createElement("div");
    div.className = "lote lote--vencido";
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${p.produtoNome}</div>
        <div class="lote-meta">${p.local || "—"} · ${p.quantidadePerdida} un. · vencia em ${formatarData(p.dataVencimentoOriginal)}</div>
      </div>
      <div class="lote-dados">
        <div class="lote-dias lote-dias--vencido">${formatarValorOuAviso(p.quantidadePerdida, p.precoCusto)}</div>
        <div class="lote-valor">registrado em ${dataTexto}</div>
      </div>
    `;
    container.appendChild(div);
  });
}
