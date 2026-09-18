// Regras de status de um lote, compartilhadas por todas as telas.

export function hojeSemHora() {
  const h = new Date();
  h.setHours(0, 0, 0, 0);
  return h;
}

/**
 * Calcula quantos dias faltam para o vencimento e em qual status o lote se encontra.
 * @param {string} dataVencimento - formato "AAAA-MM-DD"
 * @param {number} diasAlerta - antecedência configurada para avisar
 * @param {boolean} promocaoAtiva
 */
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

// Ícone redundante à cor, para quem não decodifica bem cor sozinha
// (a página da gerente, principalmente).
export const STATUS_ICONE = {
  normal: "🟢",
  atencao: "🟡",
  vencido: "🔴",
  promocao: "🟣",
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

/** Selo de status: ícone + texto, nunca só cor (reforço de acessibilidade). */
export function seloHtml(status) {
  return `<span class="selo selo--${status}">${STATUS_ICONE[status]} ${STATUS_LABEL[status]}</span>`;
}

/**
 * Sugestão de ação em linguagem natural — pensada para quem não tem contexto
 * do sistema (a página da gerente): transforma o dado cru em instrução.
 */
export function sugestaoAcao(status, diasRestantes) {
  if (status === "vencido") return "Já venceu — retirar da prateleira/geladeira.";
  if (status === "promocao") return `Em promoção — ${formatarDiasRestantes(diasRestantes).toLowerCase()}.`;
  if (status === "atencao") return `${formatarDiasRestantes(diasRestantes)} — considere colocar em promoção.`;
  return "";
}

/**
 * Agrupa lotes em faixas de urgência para o gráfico, somando o VALOR em risco
 * (quantidade × custo) por faixa — a métrica que importa para decisão, não a
 * contagem de unidades, que esconde diferença de preço entre produtos.
 * Faixas pensadas para decisão, não para precisão de calendário: não faz
 * diferença prática entre "vence em 8" e "vence em 9" dias.
 *
 * @param {number} periodoDias - janela máxima considerada (7, 14 ou 30).
 *   Controla quais faixas existem: períodos curtos escondem faixas distantes
 *   em vez de mostrá-las sempre vazias.
 */
export function agruparPorFaixa(lotes, periodoDias = 14) {
  const faixas = [
    { chave: "vencido", label: "Vencido", cor: "#a83232", min: -Infinity, max: -1 },
    { chave: "hoje_amanha", label: "Hoje/Amanhã", cor: "#c2790a", min: 0, max: 1 },
    { chave: "semana", label: "Esta semana", cor: "#d9a441", min: 2, max: 7 },
  ];
  if (periodoDias > 7) {
    faixas.push({ chave: "proxima", label: "Próxima semana", cor: "#52707d", min: 8, max: 14 });
  }
  if (periodoDias > 14) {
    faixas.push({ chave: "mais", label: "Depois de 2 semanas", cor: "#8a97a3", min: 15, max: periodoDias });
  }

  const valores = faixas.map(() => 0);
  const quantidades = faixas.map(() => 0);
  const detalhes = faixas.map(() => []); // itens que compõem cada barra, para o tooltip

  lotes.forEach((l) => {
    const idx = faixas.findIndex((f) => l.diasRestantes >= f.min && l.diasRestantes <= f.max);
    if (idx === -1) return; // fora da janela escolhida, não entra no gráfico
    const quantidade = Number(l.quantidade) || 0;
    const valor = quantidade * (Number(l.precoCusto) || 0);
    valores[idx] += valor;
    quantidades[idx] += quantidade;
    detalhes[idx].push({ produtoNome: l.produtoNome, quantidade, valor });
  });

  return {
    labels: faixas.map((f) => f.label),
    cores: faixas.map((f) => f.cor),
    valores,
    quantidades,
    detalhes,
  };
}

/**
 * Monta um gráfico de barras (valor em risco por faixa) no canvas informado,
 * com tooltip detalhando produto/quantidade/valor de cada item da barra.
 * Reutilizado pelo dashboard e pela página da gerente para manter a mesma
 * leitura visual nos dois lugares.
 */
export function montarGraficoFaixas(canvas, lotes, periodoDias) {
  const { labels, cores, valores, detalhes } = agruparPorFaixa(lotes, periodoDias);

  return new Chart(canvas, {
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
            label: (ctx) => `Total: ${formatarMoeda(ctx.parsed.y)}`,
            afterLabel: (ctx) => {
              const itens = detalhes[ctx.dataIndex];
              if (!itens || itens.length === 0) return "Nenhum item nesta faixa";
              return itens
                .slice(0, 8)
                .map((it) => `${it.produtoNome}: ${it.quantidade} un. — ${formatarMoeda(it.valor)}`)
                .concat(itens.length > 8 ? [`+ ${itens.length - 8} outro(s)`] : []);
            },
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

/**
 * Resumo de uma frase + status geral, para o cartão de destaque da página da
 * gerente — leitura de 5 segundos, sem precisar interpretar tabela/gráfico.
 */
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
