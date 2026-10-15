// Calcula uma baixa por vencimento sem permitir que a contagem geral fique negativa.
export function calcularBaixaPorVencimento(saldoAtual, quantidadeSolicitada, documentoExiste) {
  if (!documentoExiste) return { atualizar: false, antes: null, depois: null, delta: 0, divergencia: false };
  const saldo = Number(saldoAtual);
  const antes = Number.isFinite(saldo) ? Math.max(0, saldo) : 0;
  const solicitada = Number(quantidadeSolicitada);
  const quantidade = Number.isFinite(solicitada) ? Math.max(0, Math.floor(solicitada)) : 0;
  const depois = Math.max(0, antes - quantidade);
  return { atualizar: !Number.isFinite(saldo) || saldo !== depois, antes, depois, delta: depois - antes, divergencia: quantidade > antes };
}
