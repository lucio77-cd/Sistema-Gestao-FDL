import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { OPCOES_CATEGORIA, OPCOES_EMBALAGEM, CHAVE_SEM_VALOR, chaveOpcao, rotuloPadronizado } from "./opcoes-produto.js";

iniciarNavegacao();

const filtroPeriodo = document.getElementById("filtro-periodo-vendas");
let movimentosVenda = [];
let chartDia = null;
let chartProdutos = null;
let sessoesHistorico = [];
let contagensHistorico = [];
let produtosHistorico = [];
let chartHistorico = null;
let produtosEstoqueGrafico = [];
let saldosEstoqueGrafico = {};
let localEstoqueGrafico = "geladeira";
let chartEstoqueGerente = null;
const filtrosEstoqueGrafico = { categoria: new Set(), embalagem: new Set() };

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

    // O histórico das vistorias é complementar ao relatório de vendas.
    // Se as coleções históricas não estiverem acessíveis, os gráficos de vendas continuam funcionando.
    try {
      const [sessoesSnap, contagensSnap, produtosSnap] = await Promise.all([
        getDocs(query(collection(db, "vistoriasEstoque"), where("estabelecimentoId", "==", estabelecimento.id))),
        getDocs(query(collection(db, "contagensEstoque"), where("estabelecimentoId", "==", estabelecimento.id))),
        getDocs(query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimento.id)))
      ]);
      sessoesHistorico = sessoesSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.status === "finalizada");
      contagensHistorico = contagensSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      produtosHistorico = produtosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      iniciarHistoricoVistorias();
    } catch (erroHistorico) {
      console.error("Não foi possível carregar o histórico das vistorias:", erroHistorico);
      document.getElementById("resumo-historico-vistorias").textContent =
        "Histórico indisponível. Verifique as permissões de leitura de vistoriasEstoque, contagensEstoque e produtos no Firestore.";
      document.getElementById("area-grafico-historico-vistorias").hidden = true;
    }

    await carregarEstoqueParaGrafico(estabelecimento.id);
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


// ---------- Histórico das vistorias físicas ----------

function iniciarHistoricoVistorias() {
  const filtroTipo = document.getElementById("filtro-historico-tipo");
  const filtroEmbalagem = document.getElementById("filtro-historico-embalagem");
  const filtroProduto = document.getElementById("filtro-historico-produto");

  const tipos = [...new Set(produtosHistorico.map(p => String(p.categoria || "").trim()).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b, "pt-BR"));
  const embalagens = [...new Set(produtosHistorico.map(p => String(p.embalagem || "").trim()).filter(Boolean))]
    .sort((a,b) => a.localeCompare(b, "pt-BR"));

  tipos.forEach(tipo => filtroTipo.add(new Option(tipo, tipo)));
  embalagens.forEach(embalagem => filtroEmbalagem.add(new Option(embalagem, embalagem)));

  function atualizarProdutos() {
    const tipo = filtroTipo.value;
    const embalagem = filtroEmbalagem.value;
    const anterior = filtroProduto.value;
    const filtrados = produtosHistorico.filter(p =>
      (!tipo || p.categoria === tipo) && (!embalagem || p.embalagem === embalagem)
    ).sort((a,b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR"));

    filtroProduto.replaceChildren(new Option("Selecione um produto", ""));
    filtrados.forEach(p => {
      const descricao = [p.nome, p.marca, p.variante, p.embalagem, p.volume].filter(Boolean).join(" · ");
      filtroProduto.add(new Option(descricao || "Produto sem nome", p.id));
    });

    if (filtrados.some(p => p.id === anterior)) filtroProduto.value = anterior;
    else if (filtrados.length === 1) filtroProduto.value = filtrados[0].id;
    renderizarHistoricoVistorias();
  }

  filtroTipo.addEventListener("change", atualizarProdutos);
  filtroEmbalagem.addEventListener("change", atualizarProdutos);
  filtroProduto.addEventListener("change", renderizarHistoricoVistorias);
  atualizarProdutos();
}

function renderizarHistoricoVistorias() {
  const produtoId = document.getElementById("filtro-historico-produto").value;
  const canvas = document.getElementById("grafico-historico-vistorias");
  const area = document.getElementById("area-grafico-historico-vistorias");
  const vazio = document.getElementById("sem-historico-vistorias");
  const resumo = document.getElementById("resumo-historico-vistorias");

  if (chartHistorico) {
    chartHistorico.destroy();
    chartHistorico = null;
  }

  if (!produtoId) {
    area.hidden = true;
    vazio.hidden = false;
    vazio.textContent = "Selecione um produto para visualizar suas quantidades por vistoria.";
    resumo.textContent = "Selecione os filtros e um produto para visualizar o histórico.";
    return;
  }

  const sessoesPorId = new Map(sessoesHistorico.map(s => [s.id, s]));
  const historico = contagensHistorico
    .filter(c => c.produtoId === produtoId && sessoesPorId.has(c.sessaoId))
    .map(c => {
      const sessao = sessoesPorId.get(c.sessaoId);
      const data = dataDoMovimento({ registradoEm: sessao.finalizadaEm || sessao.createdAt || sessao.criadaEm });
      return { ...c, sessao, data, quantidade: Number(c.quantidade) || 0 };
    })
    .filter(c => c.data)
    .sort((a,b) => a.data - b.data);

  const produto = produtosHistorico.find(p => p.id === produtoId);
  const nome = produto
    ? [produto.nome, produto.marca, produto.variante, produto.embalagem, produto.volume].filter(Boolean).join(" · ")
    : (historico[0]?.produtoNome || "Produto");
  resumo.textContent = nome + " · " + historico.length + " vistoria(s) finalizada(s) no histórico.";

  if (!historico.length) {
    area.hidden = true;
    vazio.hidden = false;
    vazio.textContent = "Nenhuma vistoria finalizada possui contagem registrada para este produto.";
    return;
  }

  area.hidden = false;
  vazio.hidden = true;
  area.style.height = `${Math.max(260, historico.length * 42)}px`;
  chartHistorico = new Chart(canvas, {
    type: "bar",
    data: {
      labels: historico.map(c => c.data.toLocaleDateString("pt-BR") + " · " + (c.local === "seco" ? "Parte seca" : "Geladeira")),
      datasets: [{
        label: "Quantidade contada",
        data: historico.map(c => c.quantidade),
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `${ctx.parsed.x} unidade(s)` } }
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 } },
        y: { ticks: { autoSkip: false } }
      }
    }
  });
}


// ---------- Gráfico de estoque para compartilhar com o gerente ----------

async function carregarEstoqueParaGrafico(estabelecimentoId) {
  const resumo = document.getElementById("resumo-grafico-estoque");
  try {
    const [produtosSnap, estoqueSnap] = await Promise.all([
      getDocs(query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimentoId))),
      getDocs(query(collection(db, "estoque"), where("estabelecimentoId", "==", estabelecimentoId)))
    ]);
    produtosEstoqueGrafico = produtosSnap.docs.map(d => ({ id:d.id, ...d.data() }));
    saldosEstoqueGrafico = {};
    estoqueSnap.docs.forEach(d => {
      const dado = d.data();
      saldosEstoqueGrafico[dado.produtoId || d.id] = dado;
    });
    iniciarFiltrosGraficoEstoque();
    renderizarGraficoEstoqueGerente();
  } catch (erro) {
    console.error("Não foi possível carregar o estoque para o gráfico:", erro);
    resumo.textContent = "Não foi possível carregar o estoque. Verifique as permissões de leitura das coleções produtos e estoque no Firestore.";
    document.getElementById("area-grafico-estoque-gerente").hidden = true;
    document.getElementById("btn-baixar-grafico-estoque").disabled = true;
  }
}

function chaveFiltroEstoqueGrafico(produto, grupo) {
  const valor = grupo === "categoria" ? produto.categoria : produto.embalagem;
  return chaveOpcao(valor) || CHAVE_SEM_VALOR;
}

function opcoesFiltroEstoqueGrafico(grupo) {
  const campo = grupo === "categoria" ? "categoria" : "embalagem";
  const opcoes = grupo === "categoria" ? OPCOES_CATEGORIA : OPCOES_EMBALAGEM;
  const mapa = new Map();
  produtosEstoqueGrafico.filter(p => p.ativo !== false).forEach(p => {
    const chave = chaveFiltroEstoqueGrafico(p, grupo);
    if (!mapa.has(chave)) {
      mapa.set(chave, chave === CHAVE_SEM_VALOR
        ? (grupo === "categoria" ? "Sem categoria" : "Sem embalagem")
        : rotuloPadronizado(p[campo], opcoes));
    }
  });
  return [...mapa.entries()].map(([chave, rotulo]) => ({chave,rotulo})).sort((a,b) => {
    if (a.chave === CHAVE_SEM_VALOR) return 1;
    if (b.chave === CHAVE_SEM_VALOR) return -1;
    return a.rotulo.localeCompare(b.rotulo, "pt-BR", {sensitivity:"base"});
  });
}

function iniciarFiltrosGraficoEstoque() {
  ["categoria","embalagem"].forEach(grupo => {
    const container = document.getElementById(grupo === "categoria" ? "filtros-grafico-tipo" : "filtros-grafico-embalagem");
    const itens = opcoesFiltroEstoqueGrafico(grupo);
    container.innerHTML = itens.length ? itens.map(item =>
      '<button type="button" class="chip-filtro" data-grupo="' + grupo + '" data-chave="' + item.chave.replace(/&/g,"&amp;").replace(/"/g,"&quot;") + '" aria-pressed="false">' + item.rotulo.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;") + '</button>'
    ).join("") : '<span class="legenda">Nenhuma opção cadastrada.</span>';
  });

  document.getElementById("painel-grafico-estoque-gerente").addEventListener("click", event => {
    const localBtn = event.target.closest(".btn-local-grafico");
    if (localBtn) {
      localEstoqueGrafico = localBtn.dataset.local;
      document.querySelectorAll(".btn-local-grafico").forEach(btn => {
        const ativo = btn.dataset.local === localEstoqueGrafico;
        btn.classList.toggle("ativo", ativo);
        btn.setAttribute("aria-pressed", String(ativo));
      });
      renderizarGraficoEstoqueGerente();
      return;
    }

    const chip = event.target.closest(".chip-filtro[data-grupo]");
    if (!chip) return;
    const grupo = chip.dataset.grupo;
    const chave = chip.dataset.chave;
    const conjunto = filtrosEstoqueGrafico[grupo];
    if (conjunto.has(chave)) conjunto.delete(chave);
    else conjunto.add(chave);
    const ativo = conjunto.has(chave);
    chip.classList.toggle("chip-filtro--ativo", ativo);
    chip.setAttribute("aria-pressed", String(ativo));
    renderizarGraficoEstoqueGerente();
  });

  document.getElementById("btn-baixar-grafico-estoque").addEventListener("click", baixarGraficoEstoquePNG);
}

function nomeCurtoGraficoEstoque(produto, todosProdutos) {
  const marca = String(produto.marca || "").trim();
  const nome = String(produto.nome || "").trim();
  const volume = String(produto.volume || "").trim();
  const variante = String(produto.variante || "").trim();
  let principal = nome || marca || "Produto";
  if (marca && nome.toLocaleLowerCase("pt-BR").includes(marca.toLocaleLowerCase("pt-BR"))) principal = marca;
  else if (marca && nome) principal = marca + " " + nome;
  let curto = [principal, volume].filter(Boolean).join(" ");
  const iguais = todosProdutos.filter(p => {
    const outraMarca = String(p.marca || "").trim();
    const outroNome = String(p.nome || "").trim();
    let outroPrincipal = outroNome || outraMarca || "Produto";
    if (outraMarca && outroNome.toLocaleLowerCase("pt-BR").includes(outraMarca.toLocaleLowerCase("pt-BR"))) outroPrincipal = outraMarca;
    else if (outraMarca && outroNome) outroPrincipal = outraMarca + " " + outroNome;
    return [outroPrincipal, String(p.volume || "").trim()].filter(Boolean).join(" ").toLocaleLowerCase("pt-BR") === curto.toLocaleLowerCase("pt-BR");
  });
  if (iguais.length > 1 && variante) curto = [principal, variante, volume].filter(Boolean).join(" ");
  if (iguais.length > 1 && !variante) curto = [principal, nome !== principal ? nome : "", volume].filter(Boolean).join(" ");
  return curto;
}

function renderizarGraficoEstoqueGerente() {
  const canvas = document.getElementById("grafico-estoque-gerente");
  const area = document.getElementById("area-grafico-estoque-gerente");
  const vazio = document.getElementById("sem-grafico-estoque-gerente");
  const resumo = document.getElementById("resumo-grafico-estoque");
  const botao = document.getElementById("btn-baixar-grafico-estoque");

  if (chartEstoqueGerente) {
    chartEstoqueGerente.destroy();
    chartEstoqueGerente = null;
  }

  const produtosAtivos = produtosEstoqueGrafico.filter(p =>
    p.ativo !== false && p.localEstoque === localEstoqueGrafico &&
    ["categoria","embalagem"].every(grupo => {
      const marcados = filtrosEstoqueGrafico[grupo];
      return marcados.size === 0 || marcados.has(chaveFiltroEstoqueGrafico(p, grupo));
    })
  );

  const itens = produtosAtivos.map(p => ({
    produto:p,
    quantidade:Number((saldosEstoqueGrafico[p.id] || {})[localEstoqueGrafico]) || 0
  })).filter(i => i.quantidade > 0)
    .sort((a,b) => nomeCurtoGraficoEstoque(a.produto, produtosEstoqueGrafico).localeCompare(nomeCurtoGraficoEstoque(b.produto, produtosEstoqueGrafico), "pt-BR", {sensitivity:"base"}));

  const rotuloLocal = localEstoqueGrafico === "seco" ? "Parte seca" : "Geladeira";
  const filtrosAtivos = ["categoria","embalagem"].flatMap(grupo =>
    opcoesFiltroEstoqueGrafico(grupo).filter(item => filtrosEstoqueGrafico[grupo].has(item.chave)).map(item => item.rotulo)
  );
  resumo.textContent = rotuloLocal + " · " + itens.length + " produto(s) com saldo" +
    (filtrosAtivos.length ? " · Filtros: " + filtrosAtivos.join(", ") : " · Todos os tipos e embalagens") +
    " · Atualizado em " + new Date().toLocaleString("pt-BR");

  if (!itens.length) {
    area.hidden = true;
    vazio.hidden = false;
    botao.disabled = true;
    return;
  }

  area.hidden = false;
  vazio.hidden = true;
  botao.disabled = false;
  area.style.height = Math.max(300, itens.length * 38 + 90) + "px";

  const rotuloData = new Date().toLocaleString("pt-BR");
  chartEstoqueGerente = new Chart(canvas, {
    type:"bar",
    data:{
      labels:itens.map(i => nomeCurtoGraficoEstoque(i.produto, produtosEstoqueGrafico)),
      datasets:[{
        label:"Quantidade em estoque",
        data:itens.map(i => i.quantidade),
        borderRadius:4,
        backgroundColor:"#3478b8"
      }]
    },
    options:{
      indexAxis:"y",
      responsive:true,
      maintainAspectRatio:false,
      animation:false,
      layout:{padding:{right:28}},
      plugins:{
        legend:{display:false},
        title:{display:true,text:["ESTOQUE — " + rotuloLocal.toLocaleUpperCase("pt-BR"), rotuloData],font:{size:15}},
        tooltip:{callbacks:{label:ctx => ctx.parsed.x + " un."}}
      },
      scales:{
        x:{beginAtZero:true,ticks:{precision:0},title:{display:true,text:"Quantidade (unidades)"}},
        y:{ticks:{autoSkip:false}}
      }
    },
    plugins:[{
      id:"rotulos-quantidade-estoque",
      afterDatasetsDraw(chart) {
        const {ctx} = chart;
        ctx.save();
        ctx.font="bold 12px Arial";
        ctx.fillStyle="#222";
        ctx.textAlign="left";
        ctx.textBaseline="middle";
        chart.getDatasetMeta(0).data.forEach((bar,index) => {
          const valor=itens[index].quantidade;
          ctx.fillText(String(valor),bar.x+6,bar.y);
        });
        ctx.restore();
      }
    }]
  });
}

function baixarGraficoEstoquePNG() {
  if (!chartEstoqueGerente) return;
  const local = localEstoqueGrafico === "seco" ? "parte-seca" : "geladeira";
  const data = new Date().toISOString().slice(0,10);
  const link = document.createElement("a");
  link.href = chartEstoqueGerente.toBase64Image("image/png", 1);
  link.download = "estoque-" + local + "-" + data + ".png";
  link.click();
}
