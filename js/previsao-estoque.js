// Funções puras (sem Firebase e sem DOM) usadas pela página Previsão.
// Ficam separadas para poderem ser testadas em Node sem navegador.

export const PERIODOS = [
  { chave: "madrugada", rotulo: "Madrugada", inicio: 0, fim: 5 },
  { chave: "manha", rotulo: "Manhã", inicio: 6, fim: 11 },
  { chave: "tarde", rotulo: "Tarde", inicio: 12, fim: 17 },
  { chave: "noite", rotulo: "Noite", inicio: 18, fim: 23 }
];

// Tipos de movimento que alteram o saldo entre duas contagens.
// "contagem" e "importacao" ficam de fora: são acertos de saldo, não consumo.
export const TIPOS_QUE_MEXEM_NO_SALDO = [
  "venda", "entrada", "perda", "vencido", "ajuste",
  "transferencia_saida", "transferencia_entrada"
];

const MS_DIA = 24 * 60 * 60 * 1000;

export function numero(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

export function paraData(valor) {
  if (!valor) return null;
  if (typeof valor.toDate === "function") return valor.toDate();
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor === "number" || typeof valor === "string") {
    const d = new Date(valor);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

// Dia no fuso do aparelho (AAAA-MM-DD). Não usa toISOString, que é UTC e
// jogaria as vendas depois das 21h para o dia seguinte no Brasil.
export function chaveDia(data) {
  return [
    data.getFullYear(),
    String(data.getMonth() + 1).padStart(2, "0"),
    String(data.getDate()).padStart(2, "0")
  ].join("-");
}

export function inicioDoDia(data) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate());
}

export function dataDaChave(chave) {
  const [a, m, d] = String(chave).split("-").map(Number);
  return new Date(a, m - 1, d);
}

export function normalizarLocal(local) {
  const t = String(local ?? "").trim().toLowerCase();
  if (t === "geladeira") return "geladeira";
  if (t === "seco" || t === "estoque seco") return "seco";
  return t;
}

export function quantidadeDoMovimento(m) {
  if (m.delta !== undefined && m.delta !== null && Number.isFinite(Number(m.delta))) return Math.abs(Number(m.delta));
  return Math.max(0, numero(m.quantidade));
}

// ---------------------------------------------------------------------------
// VENDAS -> PERFIL DE SAÍDA (por dia da semana e por hora)
// ---------------------------------------------------------------------------

// Devolve Map(produtoId -> [{ data, quantidade }]) só com vendas válidas.
export function agruparVendas(movimentos) {
  const mapa = new Map();
  movimentos.forEach(m => {
    if (m.tipo !== "venda" || !m.produtoId) return;
    const data = paraData(m.registradoEm || m.criadoEm);
    const quantidade = quantidadeDoMovimento(m);
    if (!data || quantidade <= 0) return;
    if (!mapa.has(m.produtoId)) mapa.set(m.produtoId, []);
    mapa.get(m.produtoId).push({ data, quantidade });
  });
  return mapa;
}

// Data da primeira venda registrada na loja inteira (quando o Caixa começou a
// alimentar o livro). Antes disso não há dados, então não faz sentido contar
// esses dias como "dia sem venda" na média de nenhum produto.
export function primeiraVendaGeral(vendasPorProduto) {
  let primeira = null;
  vendasPorProduto.forEach(lista => lista.forEach(v => {
    if (!primeira || v.data < primeira) primeira = v.data;
  }));
  return primeira;
}

// Distribuição das vendas por hora considerando TODOS os produtos.
// Serve de apoio para produtos com poucas vendas (amostra pequena).
export function perfilGlobalPorHora(vendasPorProduto, { agora = new Date(), janelaDias = 28 } = {}) {
  const fim = inicioDoDia(agora);
  const inicio = new Date(fim);
  inicio.setDate(inicio.getDate() - janelaDias);
  const horas = new Array(24).fill(0);
  let total = 0;
  vendasPorProduto.forEach(lista => lista.forEach(v => {
    if (v.data >= inicio && v.data < fim) {
      horas[v.data.getHours()] += v.quantidade;
      total += v.quantidade;
    }
  }));
  return total > 0 ? horas.map(h => h / total) : null;
}

export function nivelDeConfianca(diasObservados, totalVendido) {
  if (diasObservados < 1 || totalVendido <= 0) return "nenhuma";
  if (diasObservados >= 14 && totalVendido >= 20) return "alta";
  if (diasObservados >= 7 && totalVendido >= 10) return "media";
  return "baixa";
}

// Aprende o ritmo de saída de UM produto usando só dias completos
// (o dia de hoje fica de fora porque ainda está em andamento).
export function montarPerfil(vendas, { agora = new Date(), janelaDias = 28, inicioDosDados = null, perfilGlobal = null } = {}) {
  const hoje0 = inicioDoDia(agora);
  const janelaInicio = new Date(hoje0);
  janelaInicio.setDate(janelaInicio.getDate() - janelaDias);
  let observacaoInicio = janelaInicio;
  if (inicioDosDados) {
    const p0 = inicioDoDia(inicioDosDados);
    if (p0 > observacaoInicio) observacaoInicio = p0;
  }

  const diasPorDow = new Array(7).fill(0);
  const somaPorDow = new Array(7).fill(0);
  const somaPorHora = new Array(24).fill(0);
  let diasObservados = 0;
  for (let d = new Date(observacaoInicio); d < hoje0; d.setDate(d.getDate() + 1)) {
    diasObservados += 1;
    diasPorDow[d.getDay()] += 1;
  }

  let totalVendido = 0;
  (vendas || []).forEach(v => {
    if (v.data >= observacaoInicio && v.data < hoje0) {
      totalVendido += v.quantidade;
      somaPorDow[v.data.getDay()] += v.quantidade;
      somaPorHora[v.data.getHours()] += v.quantidade;
    }
  });

  const mediaDia = diasObservados > 0 ? totalVendido / diasObservados : 0;

  // Dia da semana só entra quando há histórico suficiente; antes disso
  // seria ruído (ex.: uma única sexta-feira de movimento forte).
  const usarDiaDaSemana = diasObservados >= 14 && diasPorDow.every(n => n >= 2);
  const mediaPorDow = diasPorDow.map((n, i) => (usarDiaDaSemana && n > 0 ? somaPorDow[i] / n : mediaDia));

  // Forma do dia: parte do próprio produto e, se a amostra for pequena,
  // mistura com o perfil geral da loja (peso máximo quando há 20+ unidades).
  const uniforme = new Array(24).fill(1 / 24);
  let shareHora;
  if (totalVendido > 0) {
    const proprio = somaPorHora.map(h => h / totalVendido);
    if (perfilGlobal) {
      const peso = Math.min(1, totalVendido / 20);
      shareHora = proprio.map((p, h) => peso * p + (1 - peso) * perfilGlobal[h]);
    } else {
      shareHora = proprio;
    }
  } else {
    shareHora = perfilGlobal ? perfilGlobal.slice() : uniforme;
  }

  const porPeriodo = PERIODOS.map(p => ({
    chave: p.chave,
    rotulo: p.rotulo,
    inicio: p.inicio,
    fim: p.fim,
    fracao: shareHora.slice(p.inicio, p.fim + 1).reduce((s, v) => s + v, 0)
  }));
  const picoHora = totalVendido > 0 ? shareHora.indexOf(Math.max(...shareHora)) : null;

  return {
    diasObservados,
    totalVendido,
    mediaDia,
    mediaPorDow,
    usarDiaDaSemana,
    shareHora,
    porPeriodo,
    picoHora,
    confianca: nivelDeConfianca(diasObservados, totalVendido)
  };
}

export function consumoEsperadoNaHora(perfil, data) {
  const diaria = perfil.usarDiaDaSemana ? perfil.mediaPorDow[data.getDay()] : perfil.mediaDia;
  return diaria * perfil.shareHora[data.getHours()];
}

// ---------------------------------------------------------------------------
// PROJEÇÃO: quando chega a zero e quanto repor
// ---------------------------------------------------------------------------

// Caminha hora a hora a partir de "agora", descontando o consumo esperado de
// cada hora do dia/dia da semana, até o saldo acabar.
export function projetar(perfil, saldo, agora = new Date(), { horizonteDias = 7, margem = 0.1, maxDias = 60 } = {}) {
  const saldoAtual = Math.max(0, numero(saldo));
  if (!perfil || perfil.mediaDia <= 0) {
    return { semPrevisao: true, saldo: saldoAtual, horizonteDias, margem };
  }

  const limiteDias = Math.max(maxDias, horizonteDias);
  const fimHorizonte = agora.getTime() + horizonteDias * MS_DIA;
  const fimLimite = agora.getTime() + limiteDias * MS_DIA;

  let acumulado = 0;
  let consumoHorizonte = 0;
  let zerouEm = saldoAtual <= 0 ? new Date(agora) : null;
  let inicioSlot = agora.getTime();

  while (inicioSlot < fimLimite) {
    const dataSlot = new Date(inicioSlot);
    const proximaHora = new Date(dataSlot);
    proximaHora.setMinutes(0, 0, 0);
    proximaHora.setHours(proximaHora.getHours() + 1);
    const fimSlot = proximaHora.getTime();
    const duracao = fimSlot - inicioSlot;
    // Consumo da hora cheia, proporcional ao pedaço que ainda falta nela.
    const consumoSlot = consumoEsperadoNaHora(perfil, dataSlot) * (duracao / 3600000);

    if (!zerouEm && consumoSlot > 0 && acumulado + consumoSlot >= saldoAtual) {
      const fracao = (saldoAtual - acumulado) / consumoSlot;
      zerouEm = new Date(inicioSlot + fracao * duracao);
    }
    acumulado += consumoSlot;

    if (inicioSlot < fimHorizonte) {
      const parte = Math.min(1, (fimHorizonte - inicioSlot) / duracao);
      consumoHorizonte += consumoSlot * parte;
    }
    if (zerouEm && inicioSlot >= fimHorizonte) break;
    inicioSlot = fimSlot;
  }

  const horasAteZerar = zerouEm ? (zerouEm.getTime() - agora.getTime()) / 3600000 : null;
  const necessario = Math.max(0, Math.ceil(consumoHorizonte * (1 + margem) - saldoAtual));

  return {
    semPrevisao: false,
    saldo: saldoAtual,
    horasAteZerar,
    diasAteZerar: horasAteZerar === null ? null : horasAteZerar / 24,
    dataZerar: zerouEm,
    alemDoLimite: zerouEm === null,
    limiteDias,
    consumoHorizonte,
    horizonteDias,
    margem,
    necessario
  };
}

// ---------------------------------------------------------------------------
// HISTÓRICO: comparar a contagem de um dia com a de outro
// ---------------------------------------------------------------------------

export function chaveRegistro(produtoId, local) {
  return produtoId + "|" + normalizarLocal(local);
}

// Para cada dia, fica com a ÚLTIMA contagem de cada produto/local.
// Só entram contagens de vistorias finalizadas (as demais ainda não valem).
export function contagensPorDia(contagens, sessoesFinalizadas) {
  const porDia = new Map();
  contagens.forEach(c => {
    if (!c.produtoId || !sessoesFinalizadas.has(c.sessaoId)) return;
    const data = paraData(c.contadoEm) || paraData(c.atualizadoEm);
    if (!data) return;
    const dia = chaveDia(data);
    const chave = chaveRegistro(c.produtoId, c.local);
    if (!porDia.has(dia)) porDia.set(dia, new Map());
    const doDia = porDia.get(dia);
    const existente = doDia.get(chave);
    if (!existente || data > existente.contadoEm) {
      doDia.set(chave, {
        chave,
        produtoId: c.produtoId,
        produtoNome: c.produtoNome || "Produto",
        local: normalizarLocal(c.local),
        quantidade: numero(c.quantidade),
        contadoEm: data,
        sessaoId: c.sessaoId
      });
    }
  });
  return porDia;
}

export function diasComContagem(porDia) {
  return [...porDia.keys()].sort().reverse();
}

// Map(chave produto/local -> [{ data, tipo, delta }]) só com o que mexe no saldo.
export function indexarMovimentos(movimentos) {
  const mapa = new Map();
  movimentos.forEach(m => {
    if (!m.produtoId || !TIPOS_QUE_MEXEM_NO_SALDO.includes(m.tipo)) return;
    const data = paraData(m.registradoEm || m.criadoEm);
    if (!data) return;
    let delta = Number(m.delta);
    if (!Number.isFinite(delta)) {
      const q = numero(m.quantidade);
      delta = m.tipo === "entrada" || m.tipo === "transferencia_entrada" ? q : -q;
    }
    const chave = chaveRegistro(m.produtoId, m.local);
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push({ data, tipo: m.tipo, delta });
  });
  return mapa;
}

// Explica a diferença entre duas contagens com o que o livro registrou
// no intervalo. "semExplicacao" é o que sobrou: negativo = sumiu unidade
// sem registro (venda fora do Caixa, quebra, erro de contagem...).
export function explicarIntervalo(registroA, registroB, movimentosDaChave) {
  const inicio = registroA.contadoEm.getTime();
  const fim = registroB.contadoEm.getTime();
  const soma = { vendas: 0, entradas: 0, perdas: 0, transferencias: 0, ajustes: 0 };
  (movimentosDaChave || []).forEach(m => {
    const t = m.data.getTime();
    if (t <= inicio || t > fim) return;
    if (m.tipo === "venda") soma.vendas += -m.delta;
    else if (m.tipo === "entrada") soma.entradas += m.delta;
    else if (m.tipo === "perda" || m.tipo === "vencido") soma.perdas += -m.delta;
    else if (m.tipo === "ajuste") soma.ajustes += m.delta;
    else soma.transferencias += m.delta;
  });
  const esperado = registroA.quantidade + soma.entradas - soma.vendas - soma.perdas + soma.ajustes + soma.transferencias;
  return { ...soma, esperado, semExplicacao: registroB.quantidade - esperado };
}

export function compararDias(porDia, diaA, diaB, movimentosIndexados, { movimentosDesde = null } = {}) {
  const mapaA = porDia.get(diaA) || new Map();
  const mapaB = porDia.get(diaB) || new Map();
  const chaves = new Set([...mapaA.keys(), ...mapaB.keys()]);
  const linhas = [];
  chaves.forEach(chave => {
    const a = mapaA.get(chave) || null;
    const b = mapaB.get(chave) || null;
    const base = a || b;
    const linha = {
      chave,
      produtoId: base.produtoId,
      produtoNome: base.produtoNome,
      local: base.local,
      qtdA: a ? a.quantidade : null,
      qtdB: b ? b.quantidade : null,
      diferenca: a && b ? b.quantidade - a.quantidade : null,
      detalhe: null
    };
    if (a && b && b.contadoEm > a.contadoEm) {
      linha.detalhe = movimentosDesde && a.contadoEm < movimentosDesde
        ? { indisponivel: true }
        : explicarIntervalo(a, b, movimentosIndexados.get(chave));
    }
    linhas.push(linha);
  });
  return linhas.sort((x, y) => x.produtoNome.localeCompare(y.produtoNome, "pt-BR", { sensitivity: "base" })
    || x.local.localeCompare(y.local));
}
