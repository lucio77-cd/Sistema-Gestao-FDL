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
