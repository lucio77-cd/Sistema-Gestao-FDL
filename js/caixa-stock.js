// Lógica pura para a baixa do saldo contado; separada para permitir testes sem Firebase.
export function calcularBaixaEstoque(saldoAtual, documentoExiste) {
  if (!documentoExiste) {
    return { atualizar: false, antes: null, depois: null, divergencia: false };
  }

  const valor = Number(saldoAtual);
  const antes = Number.isFinite(valor) ? Math.max(0, valor) : 0;

  if (antes === 0) {
    return { atualizar: false, antes, depois: antes, divergencia: true };
  }

  return { atualizar: true, antes, depois: antes - 1, divergencia: false };
}
