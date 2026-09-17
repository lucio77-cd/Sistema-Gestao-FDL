import { db } from "./firebase-config.js";
import { protegerPagina, sair } from "./auth-guard.js";
import { calcularStatus, formatarDiasRestantes, agruparPorFaixa, seloHtml } from "./status.js";
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

// ---------- Abas Ação / Panorama ----------
// O gráfico só é montado quando a aba "Panorama" é aberta pela primeira vez —
// evita o custo de inicializar o Chart.js se a pessoa só olhar a tabela.

const segAcao = document.getElementById("seg-acao");
const segPanorama = document.getElementById("seg-panorama");
const secaoAcao = document.getElementById("secao-acao");
const secaoPanorama = document.getElementById("secao-panorama");

let lotesCarregados = [];
let graficoMontado = false;

function mostrarAba(nome) {
  const ehAcao = nome === "acao";
  secaoAcao.hidden = !ehAcao;
  secaoPanorama.hidden = ehAcao;
  segAcao.classList.toggle("ativo", ehAcao);
  segAcao.setAttribute("aria-selected", String(ehAcao));
  segPanorama.classList.toggle("ativo", !ehAcao);
  segPanorama.setAttribute("aria-selected", String(!ehAcao));

  if (!ehAcao && !graficoMontado) {
    renderizarGrafico(lotesCarregados);
    graficoMontado = true;
  }
}

segAcao.addEventListener("click", () => mostrarAba("acao"));
segPanorama.addEventListener("click", () => mostrarAba("panorama"));

// ---------- Carregamento ----------

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
    const produto = produtos[dados.produtoId] || {
      nome: dados.produtoNome || "(produto removido)",
      diasAlerta: dados.diasAlerta ?? null,
      precoCusto: dados.precoCusto ?? 0,
    };
    const diasAlerta = produto.diasAlerta ?? diasAlertaPadrao;
    const { diasRestantes, status } = calcularStatus(dados.dataVencimento, diasAlerta, dados.promocaoAtiva);
    return { id: d.id, ...dados, produtoNome: produto.nome, precoCusto: dados.precoCusto ?? produto.precoCusto, diasRestantes, status };
  });

  lotes.sort((a, b) => a.diasRestantes - b.diasRestantes);
  lotesCarregados = lotes;

  renderizarLegendaAtualizacao(estabelecimento.ultimaVistoria);
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

// O gráfico soma o VALOR em risco (quantidade × custo) por faixa de urgência
// — incluindo os já vencidos, que antes ficavam de fora do gráfico e só
// apareciam na tabela — e agrupa em faixas de decisão em vez de 14 dias
// individuais, que dão o mesmo peso visual a "vence hoje" e "vence em 9 dias".
function renderizarGrafico(lotes) {
  const { labels, cores, valores } = agruparPorFaixa(lotes);

  new Chart(document.getElementById("grafico-vencimentos"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Valor em risco (R$)",
          data: valores,
          backgroundColor: cores,
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `R$ ${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => `R$ ${v}` },
        },
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
        <div class="lote-produto">${l.produtoNome}${l.status === "promocao" ? seloHtml("promocao") : ""}</div>
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
