import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import {
  calcularStatus,
  formatarDiasRestantes,
  formatarValorEmRisco,
  montarGraficoPorProduto,
  seloHtml,
  STATUS_ICONE,
  escapeHtml,
} from "./status.js";
import {
  collection,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

const segAcao = document.getElementById("seg-acao");
const segPanorama = document.getElementById("seg-panorama");
const secaoAcao = document.getElementById("secao-acao");
const secaoPanorama = document.getElementById("secao-panorama");
const filtroPeriodo = document.getElementById("filtro-periodo");

let lotesCarregados = [];
let graficoAtual = null;

function mostrarAba(nome) {
  const ehAcao = nome === "acao";
  secaoAcao.hidden = !ehAcao;
  secaoPanorama.hidden = ehAcao;
  segAcao.classList.toggle("ativo", ehAcao);
  segAcao.setAttribute("aria-selected", String(ehAcao));
  segPanorama.classList.toggle("ativo", !ehAcao);
  segPanorama.setAttribute("aria-selected", String(!ehAcao));

  if (!ehAcao) renderizarGrafico();
}

segAcao.addEventListener("click", () => mostrarAba("acao"));
segPanorama.addEventListener("click", () => mostrarAba("panorama"));
filtroPeriodo.addEventListener("change", renderizarGrafico);

const filtroStatus = document.getElementById("filtro-status");
const filtroLocal = document.getElementById("filtro-local");

function aplicarFiltros() {
  const status = filtroStatus.value;
  const local = filtroLocal.value;

  const filtrados = lotesCarregados.filter((l) => {
    if (l.status === "normal") return false;
    if (status !== "todos" && l.status !== status) return false;
    if (local !== "todos" && l.local !== local) return false;
    return true;
  });

  renderizarTabela(filtrados);
}

filtroStatus.addEventListener("change", aplicarFiltros);
filtroLocal.addEventListener("change", aplicarFiltros);

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

  if (lotes.length === 0) {
    document.getElementById("lista-lotes").innerHTML =
      '<p class="mensagem-vazio">Nenhum dado encontrado. Cadastre um produto e um lote na Vistoria para começar.</p>';
    document.getElementById("secao-panorama-conteudo").innerHTML =
      '<p class="mensagem-vazio">Nenhum dado encontrado ainda.</p>';
    return;
  }

  aplicarFiltros();
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

function renderizarGrafico() {
  const periodo = Number(filtroPeriodo.value);
  const lotesNoPeriodo = lotesCarregados.filter((l) => l.status !== "normal" && l.diasRestantes <= periodo);

  if (graficoAtual) {
    graficoAtual.destroy();
    graficoAtual = null;
  }

  const canvas = document.getElementById("grafico-vencimentos");
  const semDados = document.getElementById("grafico-sem-dados");

  if (lotesNoPeriodo.length === 0) {
    canvas.hidden = true;
    semDados.hidden = false;
    semDados.textContent = "Nenhum dado neste período.";
    return;
  }

  const { chart, total } = montarGraficoPorProduto(canvas, lotesNoPeriodo);

  if (total === 0) {
    chart.destroy();
    canvas.hidden = true;
    semDados.hidden = false;
    semDados.textContent = "Nenhum dado neste período.";
    graficoAtual = null;
    return;
  }

  canvas.hidden = false;
  semDados.hidden = true;
  graficoAtual = chart;
}

// Se o status for "promocao", o selo já traz o ícone 🟣 embutido — por
// isso não repetimos o ícone solto na frente do nome nesse caso, senão
// aparecia duplicado ("🟣 Nome 🟣 Em promoção").
function renderizarTabela(lotes) {
  const container = document.getElementById("lista-lotes");
  container.innerHTML = "";

  if (lotes.length === 0) {
    const filtroAtivo = filtroStatus.value !== "todos" || filtroLocal.value !== "todos";
    container.innerHTML = filtroAtivo
      ? '<p class="mensagem-vazio">Nenhum lote corresponde a este filtro.</p>'
      : '<p class="mensagem-vazio">Nenhum lote em atenção ou vencido. 🎉</p>';
    return;
  }

  lotes.forEach((l) => {
    const div = document.createElement("div");
    div.className = `lote lote--${l.status}`;
    const prefixoIcone = l.status === "promocao" ? "" : `${STATUS_ICONE[l.status]} `;
    const selo = l.status === "promocao" ? seloHtml("promocao") : "";
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${prefixoIcone}${escapeHtml(l.produtoNome)}${selo}</div>
        <div class="lote-meta">${escapeHtml(l.local || "—")} · ${l.quantidade} un.</div>
      </div>
      <div class="lote-dados">
        <div class="lote-dias lote-dias--${l.status}">${formatarDiasRestantes(l.diasRestantes)}</div>
        <div class="lote-valor">${formatarValorEmRisco(l.quantidade, l.precoCusto)}</div>
      </div>
    `;
    container.appendChild(div);
  });
}
