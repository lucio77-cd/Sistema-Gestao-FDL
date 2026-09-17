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
 */
export function agruparPorFaixa(lotes) {
  const faixas = [
    { chave: "vencido", label: "Vencido", cor: "#a83232", min: -Infinity, max: -1 },
    { chave: "hoje_amanha", label: "Hoje/Amanhã", cor: "#c2790a", min: 0, max: 1 },
    { chave: "semana", label: "Esta semana", cor: "#d9a441", min: 2, max: 7 },
    { chave: "proxima", label: "Próxima semana", cor: "#52707d", min: 8, max: 14 },
  ];

  const valores = faixas.map(() => 0);
  const quantidades = faixas.map(() => 0);

  lotes.forEach((l) => {
    const idx = faixas.findIndex((f) => l.diasRestantes >= f.min && l.diasRestantes <= f.max);
    if (idx === -1) return; // fora da janela de 14 dias, não entra no gráfico
    valores[idx] += (Number(l.quantidade) || 0) * (Number(l.precoCusto) || 0);
    quantidades[idx] += Number(l.quantidade) || 0;
  });

  return {
    labels: faixas.map((f) => f.label),
    cores: faixas.map((f) => f.cor),
    valores,
    quantidades,
  };
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
