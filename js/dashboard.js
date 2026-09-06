import { db } from "./firebase-config.js";
import { protegerPagina, sair } from "./auth-guard.js";
import { calcularStatus, STATUS_LABEL, formatarDiasRestantes } from "./status.js";
import {
  collection,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.getElementById("link-sair").addEventListener("click", (e) => {
  e.preventDefault();
  sair();
});

protegerPagina(async ({ estabelecimento }) => {
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;

  const diasAlertaPadrao = estabelecimento.diasAlertaPadrao ?? 3;

  const [produtosSnap, lotesSnap] = await Promise.all([
    getDocs(query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimento.id))),
    getDocs(query(collection(db, "lotes"), where("estabelecimentoId", "==", estabelecimento.id))),
  ]);

  const produtos = {};
  produtosSnap.forEach((d) => (produtos[d.id] = { id: d.id, ...d.data() }));

  const lotes = lotesSnap.docs.map((d) => {
    const dados = d.data();
    const produto = produtos[dados.produtoId] || { nome: "(produto removido)", diasAlerta: null };
    const diasAlerta = produto.diasAlerta ?? diasAlertaPadrao;
    const { diasRestantes, status } = calcularStatus(dados.dataVencimento, diasAlerta, dados.promocaoAtiva);
    return { id: d.id, ...dados, produtoNome: produto.nome, diasRestantes, status };
  });

  lotes.sort((a, b) => a.diasRestantes - b.diasRestantes);

  renderizarLegendaAtualizacao(estabelecimento.ultimaVistoria);
  renderizarGrafico(lotes);
  renderizarTabela(lotes.filter((l) => l.status !== "normal"));
});

function renderizarLegendaAtualizacao(ultimaVistoria) {
  const el = document.getElementById("legenda-atualizacao");
  if (!ultimaVistoria) {
    el.textContent = "Nenhuma vistoria registrada ainda.";
    return;
  }
  const data = ultimaVistoria.toDate ? ultimaVistoria.toDate() : new Date(ultimaVistoria);
  el.textContent = `Última vistoria: ${data.toLocaleDateString("pt-BR")} às ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function renderizarGrafico(lotes) {
  const dias = 14;
  const labels = [];
  const valores = new Array(dias).fill(0);

  for (let i = 0; i < dias; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    labels.push(d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));
  }

  lotes.forEach((l) => {
    if (l.diasRestantes >= 0 && l.diasRestantes < dias) {
      valores[l.diasRestantes] += Number(l.quantidade) || 0;
    }
  });

  new Chart(document.getElementById("grafico-vencimentos"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Unidades vencendo",
          data: valores,
          backgroundColor: "#235571",
          borderRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });
}

function renderizarTabela(lotes) {
  const container = document.getElementById("lista-lotes");
  container.innerHTML = "";

  if (lotes.length === 0) {
    container.innerHTML = '<p class="mensagem-vazio">Nenhum lote em atenção ou vencido. 🎉</p>';
    return;
  }

  lotes.forEach((l) => {
    const valorEmRisco = (Number(l.quantidade) || 0) * (Number(l.precoCusto) || 0);
    const div = document.createElement("div");
    div.className = `lote lote--${l.status}`;
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${l.produtoNome}${l.status === "promocao" ? '<span class="selo selo--promocao">Promoção</span>' : ""}</div>
        <div class="lote-meta">${l.local || "—"} · ${l.quantidade} un.</div>
      </div>
      <div class="lote-dados">
        <div class="lote-dias lote-dias--${l.status}">${formatarDiasRestantes(l.diasRestantes)}</div>
        <div class="lote-valor">R$ ${valorEmRisco.toFixed(2)} em risco</div>
      </div>
    `;
    container.appendChild(div);
  });
}
