// Regras de status de um lote, compartilhadas por todas as telas.

export function hojeSemHora() {
  const h = new Date();
  h.setHours(0, 0, 0, 0);
  return h;
}

export function calcularStatus(dataVencimento, diasAlerta, promocaoAtiva) {
  const hoje = hojeSemHora();
  const vencimento = new Date(dataVencimento + "T00:00:00");
  const diffMs = vencimento - hoje;
  const diasRestantes = Math.round(diffMs / 86400000);

  let status = "normal";
  if (diasRestantes < 0) status = "vencido";
  else if (diasRestantes <= diasAlerta) status = "atencao";

  if (promocaoAtiva && status !== "vencido") status = "promocao";

  return { diasRestantes, status };
}

export const STATUS_LABEL = {
  normal: "Normal",
  atencao: "Atenção",
  vencido: "Vencido",
  promocao: "Em promoção",
};

export const STATUS_ICONE = {
  normal: "🟢",
  atencao: "🟡",
  vencido: "🔴",
  promocao: "🟣",
};

const STATUS_COR = {
  normal: "#3e7a5b",
  atencao: "#c2790a",
  vencido: "#a83232",
  promocao: "#5a3d7a",
};

export function formatarData(dataStr) {
  const [ano, mes, dia] = dataStr.split("-");
  return `${dia}/${mes}/${ano}`;
}

export function formatarDiasRestantes(dias) {
  if (dias < 0) return `Venceu há ${Math.abs(dias)} dia${Math.abs(dias) === 1 ? "" : "s"}`;
  if (dias === 0) return "Vence hoje";
  if (dias === 1) return "Vence amanhã";
  return `Vence em ${dias} dias`;
}

export function formatarMoeda(valor) {
  return `R$ ${(Number(valor) || 0).toFixed(2)}`;
}

export function formatarValorOuAviso(quantidade, precoCusto) {
  const custo = Number(precoCusto) || 0;
  if (custo === 0 && Number(quantidade) > 0) return "Custo não cadastrado";
  return formatarMoeda((Number(quantidade) || 0) * custo);
}

export function formatarValorEmRisco(quantidade, precoCusto) {
  const custo = Number(precoCusto) || 0;
  if (custo === 0 && Number(quantidade) > 0) return "Custo não cadastrado";
  return `${formatarMoeda((Number(quantidade) || 0) * custo)} em risco`;
}

export function escapeHtml(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function seloHtml(status) {
  return `<span class="selo selo--${status}">${STATUS_ICONE[status]} ${STATUS_LABEL[status]}</span>`;
}

export function sugestaoAcao(status, diasRestantes) {
  if (status === "vencido") return "Já venceu — retirar da prateleira/geladeira.";
  if (status === "promocao") return `Em promoção — ${formatarDiasRestantes(diasRestantes).toLowerCase()}.`;
  if (status === "atencao") return `${formatarDiasRestantes(diasRestantes)} — considere colocar em promoção.`;
  return "";
}

export function montarGraficoPorProduto(canvas, lotes, limite = 20) {
  const ordenados = [...lotes].sort((a, b) => a.diasRestantes - b.diasRestantes).slice(0, limite);

  const labels = ordenados.map((l) => `${l.produtoNome} (${l.local || "—"})`);
  const valores = ordenados.map((l) => Number(l.quantidade) || 0);
  const cores = ordenados.map((l) => STATUS_COR[l.status] || STATUS_COR.normal);
  const detalhes = ordenados.map((l) => ({
    produtoNome: l.produtoNome,
    diasRestantes: l.diasRestantes,
  }));

  canvas.parentElement.style.height = `${Math.max(200, ordenados.length * 34)}px`;
  canvas.style.height = "100%";

  const chart = new Chart(canvas, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Quantidade",
          data: valores,
          backgroundColor: cores,
          borderRadius: 4,
        },
      ],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.parsed.x} unidade${ctx.parsed.x === 1 ? "" : "s"}`,
            afterLabel: (ctx) => formatarDiasRestantes(detalhes[ctx.dataIndex].diasRestantes),
          },
        },
      },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0 } },
      },
    },
  });

  return { chart, total: ordenados.length };
}

export function calcularResumoGerente(lotes) {
  const vencidos = lotes.filter((l) => l.status === "vencido").length;
  const atencao = lotes.filter((l) => l.status === "atencao" || l.status === "promocao").length;

  if (vencidos > 0) {
    return {
      status: "vencido",
      numero: vencidos,
      texto: vencidos === 1 ? "produto vencido" : "produtos vencidos",
    };
  }
  if (atencao > 0) {
    return {
      status: "atencao",
      numero: atencao,
      texto: atencao === 1 ? "produto vencendo esta semana" : "produtos vencendo esta semana",
    };
  }
  return { status: "ok", numero: null, texto: "Tudo em dia" };
}

export function calcularPercentuaisEstoque(lotes) {
  const porProduto = {};
  let totalGeral = 0;

  lotes.forEach((l) => {
    const qtd = Number(l.quantidade) || 0;
    totalGeral += qtd;
    const chave = l.produtoNome;
    if (!porProduto[chave]) {
      porProduto[chave] = { produtoNome: chave, quantidade: 0, local: {} };
    }
    porProduto[chave].quantidade += qtd;
    porProduto[chave].local[l.local || "—"] = (porProduto[chave].local[l.local || "—"] || 0) + qtd;
  });

  return Object.values(porProduto)
    .map((p) => ({
      ...p,
      percentual: totalGeral > 0 ? (p.quantidade / totalGeral) * 100 : 0,
    }))
    .sort((a, b) => b.quantidade - a.quantidade);
}
