import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

const filtroPeriodo = document.getElementById("filtro-periodo-vendas");
let movimentosVenda = [];
let chartDia = null;
let chartProdutos = null;

protegerPagina(async ({ estabelecimento }) => {
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  try {
    const snap = await getDocs(query(
      collection(db, "movimentosEstoque"),
      where("estabelecimentoId", "==", estabelecimento.id)
    ));
    movimentosVenda = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(m => m.tipo === "venda" && (m.registradoEm || m.criadoEm));
    renderizarGraficos();
  } catch (erro) {
    console.error(erro);
    document.getElementById("sem-vendas-dia").hidden = false;
    document.getElementById("sem-vendas-dia").textContent = "Não foi possível carregar as vendas. Verifique as permissões do Firestore.";
    document.getElementById("sem-vendas-produtos").hidden = false;
    document.getElementById("sem-vendas-produtos").textContent = "Os gráficos não puderam ser carregados.";
  }
});

filtroPeriodo.addEventListener("change", renderizarGraficos);

function dataDoMovimento(m) {
  const valor = m.registradoEm || m.criadoEm;
  if (valor && typeof valor.toDate === "function") return valor.toDate();
  if (valor instanceof Date) return valor;
  if (typeof valor === "string" || typeof valor === "number") {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function chaveDia(data) {
  return [data.getFullYear(), String(data.getMonth() + 1).padStart(2, "0"), String(data.getDate()).padStart(2, "0")].join("-");
}

function renderizarGraficos() {
  const dias = Number(filtroPeriodo.value) || 30;
  const hoje = new Date();
  hoje.setHours(23, 59, 59, 999);
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  inicio.setDate(inicio.getDate() - (dias - 1));

  const vendas = movimentosVenda.map(m => ({ ...m, data: dataDoMovimento(m) }))
    .filter(m => m.data && m.data >= inicio && m.data <= hoje)
    .map(m => ({ ...m, quantidade: Math.max(0, Number(m.quantidade ?? Math.abs(m.delta)) || 0) }))
    .filter(m => m.quantidade > 0);

  const porDia = new Map();
  const porProduto = new Map();
  for (let i = 0; i < dias; i++) {
    const data = new Date(inicio);
    data.setDate(inicio.getDate() + i);
    porDia.set(chaveDia(data), { data, quantidade: 0 });
  }
  vendas.forEach(m => {
    const dia = chaveDia(m.data);
    if (porDia.has(dia)) porDia.get(dia).quantidade += m.quantidade;
    const nome = String(m.produtoNome || "Produto sem nome");
    porProduto.set(nome, (porProduto.get(nome) || 0) + m.quantidade);
  });

  const total = vendas.reduce((s, m) => s + m.quantidade, 0);
  document.getElementById("total-vendido").textContent = String(total);
  document.getElementById("produtos-vendidos").textContent = String(porProduto.size);
  document.getElementById("dias-com-vendas").textContent = String([...porDia.values()].filter(d => d.quantidade > 0).length);

  const diasOrdenados = [...porDia.values()];
  const labelsDia = diasOrdenados.map(d => d.data.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }));
  const valoresDia = diasOrdenados.map(d => d.quantidade);
  const canvasDia = document.getElementById("grafico-vendas-dia");
  const semDia = document.getElementById("sem-vendas-dia");
  if (chartDia) { chartDia.destroy(); chartDia = null; }
  if (total === 0) {
    canvasDia.hidden = true;
    semDia.hidden = false;
  } else {
    canvasDia.hidden = false;
    semDia.hidden = true;
    chartDia = new Chart(canvasDia, {
      type: "bar",
      data: { labels: labelsDia, datasets: [{ label: "Unidades vendidas", data: valoresDia, borderRadius: 4 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} unidade(s)` } } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { ticks: { maxTicksLimit: 8, maxRotation: 0, minRotation: 0 } } }
      }
    });
  }

  const top = [...porProduto.entries()].map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, "pt-BR"))
    .slice(0, 10);
  const canvasProdutos = document.getElementById("grafico-produtos-vendidos");
  const areaProdutos = document.getElementById("area-grafico-produtos");
  const semProdutos = document.getElementById("sem-vendas-produtos");
  if (chartProdutos) { chartProdutos.destroy(); chartProdutos = null; }
  if (!top.length) {
    canvasProdutos.hidden = true;
    areaProdutos.style.height = "auto";
    semProdutos.hidden = false;
  } else {
    canvasProdutos.hidden = false;
    semProdutos.hidden = true;
    areaProdutos.style.height = `${Math.max(260, top.length * 38)}px`;
    chartProdutos = new Chart(canvasProdutos, {
      type: "bar",
      data: { labels: top.map(p => p.nome), datasets: [{ label: "Unidades vendidas", data: top.map(p => p.quantidade), borderRadius: 4 }] },
      options: {
        indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.x} unidade(s)` } } },
        scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { ticks: { autoSkip: false } } }
      }
    });
  }
}
