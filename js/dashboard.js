import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { calcularStatus, formatarDiasRestantes, montarGraficoPorProduto, seloHtml, formatarValorOuAviso, escapeHtml } from "./status.js";
import {
  collection,
  query,
  where,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

// ---------- Abas Ação / Panorama ----------
// O gráfico só é montado quando a aba "Panorama" é aberta pela primeira vez —
// evita o custo de inicializar o Chart.js se a pessoa só olhar a tabela.

const segAcao = document.getElementById("seg-acao");
const segPanorama = document.getElementById("seg-panorama");
const secaoAcao = document.getElementById("secao-acao");
const secaoPanorama = document.getElementById("secao-panorama");
const filtroPeriodo = document.getElementById("filtro-periodo");

let lotesCarregados = [];
let saidasCarregadas = [];
let graficoAtual = null;
let graficoFaixasAtual = null;

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

// ---------- Filtro (status + local) ----------
// Filtra em memória sobre o que já foi carregado — não faz nova consulta ao
// Firestore a cada troca de filtro.

const filtroStatus = document.getElementById("filtro-status");
const filtroLocal = document.getElementById("filtro-local");

function aplicarFiltros() {
  const status = filtroStatus.value;
  const local = filtroLocal.value;

  const filtrados = lotesCarregados.filter((l) => {
    if (l.status === "normal" || l.status === "sem-validade") return false;
    if (status !== "todos" && l.status !== status) return false;
    if (local !== "todos" && l.local !== local) return false;
    return true;
  });

  renderizarTabela(filtrados);
}

filtroStatus.addEventListener("change", aplicarFiltros);
filtroLocal.addEventListener("change", aplicarFiltros);

// ---------- Carregamento ----------

protegerPagina(async ({ estabelecimento }) => {
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;

  const diasAlertaPadrao = estabelecimento.diasAlertaPadrao ?? 3;

  const [produtosSnap, lotesSnap] = await Promise.all([
    getDocs(query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimento.id))),
    getDocs(query(collection(db, "lotes"), where("estabelecimentoId", "==", estabelecimento.id))),
  ]);

  // O histórico de perdas é complementar: se a coleção não estiver acessível,
  // o dashboard de vencimentos continua funcionando sem inventar valores.
  try {
    const saidasSnap = await getDocs(query(
      collection(db, "saidas"),
      where("estabelecimentoId", "==", estabelecimento.id)
    ));
    saidasCarregadas = saidasSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((s) => s.motivo === "vencido");
  } catch (erro) {
    console.warn("Histórico de perdas indisponível no Panorama:", erro);
    saidasCarregadas = [];
  }

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

  lotes.sort((a, b) => (a.diasRestantes ?? 99999) - (b.diasRestantes ?? 99999));
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

function formatarDinheiro(valor) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(valor) || 0);
}

function dataDoRegistro(saida) {
  const valor = saida.registradoEm || saida.criadoEm;
  if (valor && typeof valor.toDate === "function") return valor.toDate();
  if (valor instanceof Date) return valor;
  if (typeof valor === "string" || typeof valor === "number") {
    const data = new Date(valor);
    return Number.isNaN(data.getTime()) ? null : data;
  }
  return null;
}

function renderizarGrafico() {
  const periodo = Number(filtroPeriodo.value) || 14;
  const local = filtroLocal.value;
  const lotesDoLocal = lotesCarregados.filter((l) => local === "todos" || l.local === local);
  const lotesVencidos = lotesDoLocal.filter((l) => l.diasRestantes !== null && l.diasRestantes < 0);
  const lotesFuturos = lotesDoLocal.filter((l) =>
    l.diasRestantes !== null && l.diasRestantes >= 0 && l.diasRestantes <= periodo
  );
  const valorVencido = lotesVencidos.reduce((soma, l) => soma + (Number(l.quantidade) || 0) * (Number(l.precoCusto) || 0), 0);
  const valorRisco = lotesFuturos.reduce((soma, l) => soma + (Number(l.quantidade) || 0) * (Number(l.precoCusto) || 0), 0);
  const unidadesFuturas = lotesFuturos.reduce((soma, l) => soma + (Number(l.quantidade) || 0), 0);

  const agora = new Date();
  agora.setHours(23, 59, 59, 999);
  const inicioHistorico = new Date();
  inicioHistorico.setHours(0, 0, 0, 0);
  inicioHistorico.setDate(inicioHistorico.getDate() - (periodo - 1));
  const perdasNoPeriodo = saidasCarregadas.filter((s) => {
    const data = dataDoRegistro(s);
    return data && data >= inicioHistorico && data <= agora && (local === "todos" || s.local === local);
  });
  const valorPerdas = perdasNoPeriodo.reduce((soma, s) => soma + (Number(s.valor) || (Number(s.quantidade) || 0) * (Number(s.precoCusto) || 0)), 0);

  document.getElementById("resumo-lotes-vencidos").textContent = String(lotesVencidos.length);
  document.getElementById("resumo-valor-vencido").textContent = `${formatarDinheiro(valorVencido)} em estoque vencido`;
  document.getElementById("resumo-lotes-futuros").textContent = String(lotesFuturos.length);
  document.getElementById("resumo-unidades-futuras").textContent = `${unidadesFuturas} unidade(s) nos próximos ${periodo} dias`;
  document.getElementById("resumo-valor-risco").textContent = formatarDinheiro(valorRisco);
  document.getElementById("resumo-perdas-periodo").textContent = formatarDinheiro(valorPerdas);
  document.getElementById("resumo-perdas-legenda").textContent = `Registradas nos últimos ${periodo} dias`;

  // Gráfico agregado por faixa. As faixas não se sobrepõem e respeitam
  // o horizonte selecionado, para cada lote contar uma única vez.
  if (graficoFaixasAtual) {
    graficoFaixasAtual.destroy();
    graficoFaixasAtual = null;
  }
  const canvasFaixas = document.getElementById("grafico-faixas-vencimento");
  const semFaixas = document.getElementById("grafico-faixas-sem-dados");
  const faixasBase = [
    { rotulo: "0–7 dias", inicio: 0, fim: 7, cor: "#a83232" },
    { rotulo: "8–14 dias", inicio: 8, fim: 14, cor: "#c2790a" },
    { rotulo: "15–30 dias", inicio: 15, fim: 30, cor: "#235571" },
  ];
  const faixas = faixasBase.filter((f) => f.inicio < periodo).map((f) => ({
    ...f,
    unidades: lotesDoLocal
      .filter((l) => l.diasRestantes !== null && l.diasRestantes >= f.inicio && l.diasRestantes <= Math.min(f.fim, periodo))
      .reduce((soma, l) => soma + (Number(l.quantidade) || 0), 0),
  }));
  const totalFaixas = faixas.reduce((soma, f) => soma + f.unidades, 0);
  if (totalFaixas === 0) {
    canvasFaixas.hidden = true;
    semFaixas.hidden = false;
  } else {
    canvasFaixas.hidden = false;
    semFaixas.hidden = true;
    graficoFaixasAtual = new Chart(canvasFaixas, {
      type: "bar",
      data: {
        labels: faixas.map((f) => f.rotulo),
        datasets: [{ label: "Unidades", data: faixas.map((f) => f.unidades), backgroundColor: faixas.map((f) => f.cor), borderRadius: 5 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => `${ctx.parsed.y} unidade(s)` } } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  // Gráfico por lote mantém o acesso direto à Vistoria.
  if (graficoAtual) {
    graficoAtual.destroy();
    graficoAtual = null;
  }
  const canvas = document.getElementById("grafico-vencimentos");
  const area = document.getElementById("area-grafico-vencimentos");
  const semDados = document.getElementById("grafico-sem-dados");
  if (lotesFuturos.length === 0) {
    canvas.hidden = true;
    area.style.height = "auto";
    semDados.hidden = false;
    semDados.textContent = "Nenhum lote com vencimento futuro neste período.";
    return;
  }

  const { chart, total } = montarGraficoPorProduto(canvas, lotesFuturos, 20, (lote) => {
    window.location.href = urlDoLoteNaVistoria(lote.id);
  });
  if (total === 0) {
    chart.destroy();
    canvas.hidden = true;
    area.style.height = "auto";
    semDados.hidden = false;
    semDados.textContent = "Nenhum lote com vencimento futuro neste período.";
    return;
  }
  canvas.hidden = false;
  semDados.hidden = true;
  graficoAtual = chart;
}

function urlDoLoteNaVistoria(loteId) {
  return `vistoria.html?lote=${encodeURIComponent(loteId)}`;
}

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
    // Cada linha é um link: abre a Vistoria já na posição deste lote.
    const link = document.createElement("a");
    link.className = `lote lote-link lote--${l.status}`;
    link.href = urlDoLoteNaVistoria(l.id);
    link.setAttribute("aria-label", `Abrir ${l.produtoNome} na Vistoria`);
    link.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${escapeHtml(l.produtoNome)}${l.status === "promocao" ? seloHtml("promocao") : ""}</div>
        <div class="lote-meta">${escapeHtml(l.local || "—")} · ${l.quantidade} un.</div>
      </div>
      <div class="lote-dados">
        <div class="lote-dias lote-dias--${l.status}">${formatarDiasRestantes(l.diasRestantes)}</div>
        <div class="lote-valor">${formatarValorOuAviso(l.quantidade, l.precoCusto)} em risco</div>
        <div class="lote-ir">Abrir na Vistoria</div>
      </div>
    `;
    container.appendChild(link);
  });
}
