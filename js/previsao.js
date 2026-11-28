import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import {
  collection, query, where, getDocs, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  agruparVendas, primeiraVendaGeral, perfilGlobalPorHora, montarPerfil, projetar,
  contagensPorDia, diasComContagem, indexarMovimentos, compararDias, dataDaChave, numero
} from "./previsao-estoque.js";

iniciarNavegacao();

const JANELA_PREVISAO_DIAS = 28;   // quantos dias de vendas o sistema olha para aprender o ritmo
const DIAS_DE_MOVIMENTOS = 90;     // quanto do livro de movimentos é carregado
const LIMITE_PREVISAO_DIAS = 60;   // acima disso mostra "não acaba nos próximos 60 dias"
const ROTULO_LOCAL = { geladeira: "Geladeira", seco: "Parte seca" };

const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const el = id => document.getElementById(id);

let produtos = [];
let estoqueMap = {};
let movimentos = [];
let movimentosDesde = null;
let vendasPorProduto = new Map();
let movimentosIndexados = new Map();
let inicioDasVendas = null;
let perfilGlobal = null;
let contagensDia = new Map();
let contagensDisponiveis = true;

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function nomeApresentacao(p) {
  return [p.marca, p.nome, p.variante, p.embalagem, p.volume].filter(Boolean).join(" · ") || "Produto sem nome";
}
function locaisDoProduto(p) {
  if (Array.isArray(p.locaisEstoque) && p.locaisEstoque.length) return p.locaisEstoque;
  if (p.localEstoque === "geladeira" || p.localEstoque === "seco") return [p.localEstoque];
  return ["geladeira", "seco"];
}
function saldoDoProduto(p) {
  const saldo = estoqueMap[p.id] || {};
  return locaisDoProduto(p).reduce((soma, local) => soma + numero(saldo[local]), 0);
}
function sinal(n) {
  return n > 0 ? "+" + nf0.format(n) : n < 0 ? "−" + nf0.format(Math.abs(n)) : "0";
}
function rotuloDia(chave) {
  return dataDaChave(chave).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
}

// ---------- Carregamento ----------

protegerPagina(async ({ estabelecimento }) => {
  el("nome-estabelecimento").textContent = estabelecimento.nome;
  try {
    await carregar(estabelecimento.id);
  } catch (erro) {
    console.error(erro);
    el("lista-previsao").innerHTML = '<p class="mensagem-vazio">Não foi possível carregar os dados. Verifique a conexão e as permissões do Firestore.</p>';
    el("lista-comparacao").innerHTML = "";
  }
});

async function carregarMovimentos(estabelecimentoId) {
  const desde = new Date();
  desde.setHours(0, 0, 0, 0);
  desde.setDate(desde.getDate() - DIAS_DE_MOVIMENTOS);
  try {
    // Consulta com data exige um índice composto (criado uma única vez no Firebase).
    const snap = await getDocs(query(
      collection(db, "movimentosEstoque"),
      where("estabelecimentoId", "==", estabelecimentoId),
      where("registradoEm", ">=", Timestamp.fromDate(desde))
    ));
    return { movimentos: snap.docs.map(d => ({ id: d.id, ...d.data() })), desde, precisaIndice: false, linkIndice: null };
  } catch (erro) {
    if (erro && erro.code !== "failed-precondition") throw erro;
    // Sem o índice, lê tudo do estabelecimento e filtra na tela: funciona, só é mais lento.
    const snap = await getDocs(query(collection(db, "movimentosEstoque"), where("estabelecimentoId", "==", estabelecimentoId)));
    const achado = String((erro && erro.message) || "").match(/https:\/\/console\.firebase\.google\.com\/[^\s]+/);
    const link = achado ? achado[0].replace(/[.,;)]+$/, "") : null;
    return { movimentos: snap.docs.map(d => ({ id: d.id, ...d.data() })), desde: null, precisaIndice: true, linkIndice: link };
  }
}

function mostrarAvisoIndice(precisaIndice, link) {
  const aviso = el("aviso-indice");
  aviso.hidden = !precisaIndice;
  if (!precisaIndice) return;
  const alvo = el("link-indice");
  if (link) {
    alvo.hidden = false;
    alvo.href = link;
  } else {
    alvo.hidden = true;
  }
}

async function carregar(estabelecimentoId) {
  const [produtosSnap, estoqueSnap] = await Promise.all([
    getDocs(query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimentoId))),
    getDocs(query(collection(db, "estoque"), where("estabelecimentoId", "==", estabelecimentoId)))
  ]);
  produtos = produtosSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(p => p.ativo !== false);
  estoqueMap = {};
  estoqueSnap.forEach(d => {
    const dado = d.data();
    estoqueMap[d.id] = dado;
    if (dado.produtoId && !estoqueMap[dado.produtoId]) estoqueMap[dado.produtoId] = dado;
  });

  const resultado = await carregarMovimentos(estabelecimentoId);
  movimentos = resultado.movimentos;
  movimentosDesde = resultado.desde;
  mostrarAvisoIndice(resultado.precisaIndice, resultado.linkIndice);
  vendasPorProduto = agruparVendas(movimentos);
  inicioDasVendas = primeiraVendaGeral(vendasPorProduto);
  perfilGlobal = perfilGlobalPorHora(vendasPorProduto, { janelaDias: JANELA_PREVISAO_DIAS });
  movimentosIndexados = indexarMovimentos(movimentos);

  // O histórico de contagens é independente da previsão: se falhar, a previsão continua.
  contagensDisponiveis = true;
  try {
    const [sessoesSnap, contagensSnap] = await Promise.all([
      getDocs(query(collection(db, "vistoriasEstoque"), where("estabelecimentoId", "==", estabelecimentoId))),
      getDocs(query(collection(db, "contagensEstoque"), where("estabelecimentoId", "==", estabelecimentoId)))
    ]);
    const finalizadas = new Set(sessoesSnap.docs.filter(d => d.data().status === "finalizada").map(d => d.id));
    contagensDia = contagensPorDia(contagensSnap.docs.map(d => ({ id: d.id, ...d.data() })), finalizadas);
  } catch (erro) {
    console.error("Histórico de contagens indisponível:", erro);
    contagensDisponiveis = false;
    contagensDia = new Map();
  }

  iniciarComparacao();
  renderizarPrevisao();
}

// ---------- Previsão ----------

function calcularPrevisoes() {
  const agora = new Date();
  const horizonteDias = Number(el("prev-horizonte").value) || 7;
  const margem = (Number(el("prev-margem").value) || 0) / 100;
  return produtos.map(p => {
    const saldo = saldoDoProduto(p);
    const perfil = montarPerfil(vendasPorProduto.get(p.id) || [], {
      agora, janelaDias: JANELA_PREVISAO_DIAS, inicioDosDados: inicioDasVendas, perfilGlobal
    });
    const projecao = projetar(perfil, saldo, agora, { horizonteDias, margem, maxDias: LIMITE_PREVISAO_DIAS });
    let situacao;
    if (projecao.semPrevisao) situacao = "sem-previsao";
    else if (saldo <= 0) situacao = "sem-estoque";
    else if (!projecao.alemDoLimite && projecao.diasAteZerar <= 2) situacao = "critico";
    else if (!projecao.alemDoLimite && projecao.diasAteZerar < horizonteDias) situacao = "atencao";
    else situacao = "ok";
    return { produto: p, saldo, perfil, projecao, situacao, horizonteDias };
  });
}

const ORDEM_SITUACAO = { "sem-estoque": 0, critico: 1, atencao: 2, ok: 3, "sem-previsao": 4 };
const SELO = {
  "sem-estoque": ["selo--atencao", "Sem estoque"],
  critico: ["selo--atencao", "Crítico"],
  atencao: ["selo--atencao", "Repor em breve"],
  ok: ["selo--normal", "Em dia"],
  "sem-previsao": ["selo--sem-validade", "Sem vendas"]
};

function textoQuandoAcaba(item) {
  const proj = item.projecao;
  if (proj.semPrevisao) return "Sem vendas registradas pelo Caixa nos últimos " + JANELA_PREVISAO_DIAS + " dias — não dá para prever.";
  if (item.saldo <= 0) return "Já está sem estoque.";
  if (proj.alemDoLimite) return "No ritmo atual, não acaba nos próximos " + LIMITE_PREVISAO_DIAS + " dias.";
  const quando = proj.dataZerar.toLocaleString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const duracao = proj.horasAteZerar < 1 ? "menos de 1 hora"
    : proj.horasAteZerar < 48 ? "~" + nf0.format(proj.horasAteZerar) + " h"
    : "~" + nf1.format(proj.diasAteZerar) + " dias";
  return "Acaba em " + duracao + " (" + quando + ").";
}

function htmlPeriodos(perfil) {
  return '<div class="previsao-periodos" aria-label="Quando o produto sai ao longo do dia">' +
    perfil.porPeriodo.map(p => {
      const pct = Math.round(p.fracao * 100);
      return '<div class="previsao-periodo"><span>' + esc(p.rotulo) + '</span>' +
        '<div class="previsao-barra"><div style="width:' + pct + '%"></div></div><strong>' + pct + '%</strong></div>';
    }).join("") + '</div>';
}

const ROTULO_CONFIANCA = { nenhuma: "sem dados", baixa: "confiança baixa", media: "confiança média", alta: "confiança alta" };

function renderizarPrevisao() {
  const itens = calcularPrevisoes();
  const busca = el("prev-busca").value.trim().toLocaleLowerCase("pt-BR");
  const somenteRisco = el("prev-somente-risco").checked;
  const horizonte = Number(el("prev-horizonte").value) || 7;

  el("resumo-sem-estoque").textContent = String(itens.filter(i => i.situacao === "sem-estoque").length);
  el("resumo-em-risco").textContent = String(itens.filter(i => i.situacao === "critico" || i.situacao === "atencao").length);
  el("resumo-sem-previsao").textContent = String(itens.filter(i => i.situacao === "sem-previsao").length);

  const temVendas = vendasPorProduto.size > 0;
  el("aviso-sem-vendas").hidden = temVendas;

  const visiveis = itens
    .filter(i => !busca || nomeApresentacao(i.produto).toLocaleLowerCase("pt-BR").includes(busca))
    .filter(i => !somenteRisco || ["sem-estoque", "critico", "atencao"].includes(i.situacao))
    .sort((a, b) => ORDEM_SITUACAO[a.situacao] - ORDEM_SITUACAO[b.situacao]
      || (a.projecao.horasAteZerar ?? Infinity) - (b.projecao.horasAteZerar ?? Infinity)
      || nomeApresentacao(a.produto).localeCompare(nomeApresentacao(b.produto), "pt-BR", { sensitivity: "base" }));

  const lista = el("lista-previsao");
  if (!visiveis.length) {
    lista.innerHTML = '<p class="mensagem-vazio">Nenhum produto corresponde ao filtro.</p>';
    return;
  }
  lista.innerHTML = visiveis.map(i => {
    const [classeSelo, rotuloSelo] = SELO[i.situacao];
    const locais = locaisDoProduto(i.produto).map(l => ROTULO_LOCAL[l]).join(" + ");
    let corpo = '<div class="stock-item-meta">' + esc(textoQuandoAcaba(i)) + '</div>';
    if (!i.projecao.semPrevisao) {
      const ritmo = i.perfil.usarDiaDaSemana
        ? "ritmo médio " + nf1.format(i.perfil.mediaDia) + " un./dia (ajustado por dia da semana)"
        : "ritmo médio " + nf1.format(i.perfil.mediaDia) + " un./dia";
      const pico = i.perfil.picoHora === null ? "" : " · pico por volta das " + i.perfil.picoHora + "h";
      corpo += '<div class="stock-item-meta"><strong>' +
        (i.projecao.necessario > 0
          ? "Para cobrir " + horizonte + " dias: repor " + nf0.format(i.projecao.necessario) + " un."
          : "Cobre os próximos " + horizonte + " dias sem repor.") +
        '</strong></div>' +
        htmlPeriodos(i.perfil) +
        '<small class="legenda">' + esc(ritmo + pico + " · " + ROTULO_CONFIANCA[i.perfil.confianca] +
          " (" + i.perfil.diasObservados + " dias, " + nf0.format(i.perfil.totalVendido) + " un. vendidas)") + '</small>';
    }
    return '<article class="stock-item"><div class="stock-item-head"><div><strong>' + esc(nomeApresentacao(i.produto)) +
      '</strong><small>Saldo: ' + nf0.format(i.saldo) + ' un. · ' + esc(locais) + '</small></div>' +
      '<span class="selo ' + classeSelo + '">' + rotuloSelo + '</span></div>' + corpo + '</article>';
  }).join("");
}

["prev-horizonte", "prev-margem", "prev-somente-risco"].forEach(id => el(id).addEventListener("change", renderizarPrevisao));
el("prev-busca").addEventListener("input", renderizarPrevisao);

// ---------- Comparar registros de dias diferentes ----------

function iniciarComparacao() {
  const selA = el("cmp-dia-a");
  const selB = el("cmp-dia-b");
  const dias = diasComContagem(contagensDia);
  selA.innerHTML = "";
  selB.innerHTML = "";
  dias.forEach(dia => {
    selA.add(new Option(rotuloDia(dia), dia));
    selB.add(new Option(rotuloDia(dia), dia));
  });
  if (dias.length >= 2) {
    selB.value = dias[0];
    selA.value = dias[1];
  }
  selA.disabled = selB.disabled = dias.length < 2;
  renderizarComparacao();
}

function renderizarComparacao() {
  const lista = el("lista-comparacao");
  const resumo = el("cmp-resumo");
  if (!contagensDisponiveis) {
    resumo.textContent = "";
    lista.innerHTML = '<p class="mensagem-vazio">Não foi possível ler o histórico de contagens. Confira as permissões de vistoriasEstoque e contagensEstoque.</p>';
    return;
  }
  const dias = diasComContagem(contagensDia);
  if (dias.length < 2) {
    resumo.textContent = "";
    lista.innerHTML = '<p class="mensagem-vazio">' + (dias.length === 0
      ? "Ainda não há vistorias finalizadas. Finalize uma vistoria em Estoque para começar o histórico."
      : "Só existe contagem em um dia. Finalize outra vistoria em outro dia para poder comparar.") + '</p>';
    return;
  }
  let diaA = el("cmp-dia-a").value;
  let diaB = el("cmp-dia-b").value;
  if (diaA === diaB) {
    resumo.textContent = "";
    lista.innerHTML = '<p class="mensagem-vazio">Escolha dois dias diferentes.</p>';
    return;
  }
  if (diaA > diaB) [diaA, diaB] = [diaB, diaA];

  const busca = el("cmp-busca").value.trim().toLocaleLowerCase("pt-BR");
  const somenteDiferenca = el("cmp-somente-diferenca").checked;
  const todas = compararDias(contagensDia, diaA, diaB, movimentosIndexados, { movimentosDesde });
  const ambos = todas.filter(l => l.diferenca !== null);
  const totalA = ambos.reduce((s, l) => s + l.qtdA, 0);
  const totalB = ambos.reduce((s, l) => s + l.qtdB, 0);
  resumo.textContent = rotuloDia(diaA) + " → " + rotuloDia(diaB) + " · " + ambos.length + " produto(s) contados nos dois dias · total " +
    nf0.format(totalA) + " → " + nf0.format(totalB) + " (" + sinal(totalB - totalA) + ") · " +
    ambos.filter(l => l.diferenca !== 0).length + " com diferença";

  const visiveis = todas
    .filter(l => !busca || l.produtoNome.toLocaleLowerCase("pt-BR").includes(busca))
    .filter(l => !somenteDiferenca || (l.diferenca !== null && l.diferenca !== 0));
  if (!visiveis.length) {
    lista.innerHTML = '<p class="mensagem-vazio">Nenhum registro corresponde ao filtro.</p>';
    return;
  }
  lista.innerHTML = visiveis.map(l => cartaoComparacao(l, diaA, diaB)).join("");
}

function cartaoComparacao(l, diaA, diaB) {
  const curtoA = dataDaChave(diaA).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const curtoB = dataDaChave(diaB).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  let selo;
  if (l.diferenca === null) selo = '<span class="selo selo--sem-validade">Só em um dia</span>';
  else if (l.diferenca === 0) selo = '<span class="selo selo--normal">Igual</span>';
  else selo = '<span class="selo selo--atencao">' + sinal(l.diferenca) + '</span>';

  const valorA = l.qtdA === null ? "não contado" : nf0.format(l.qtdA);
  const valorB = l.qtdB === null ? "não contado" : nf0.format(l.qtdB);
  let detalhe = "";
  if (l.detalhe && l.detalhe.indisponivel) {
    detalhe = '<div class="stock-item-meta">Os movimentos desse período são mais antigos do que o carregado (' + DIAS_DE_MOVIMENTOS + ' dias).</div>';
  } else if (l.detalhe) {
    const d = l.detalhe;
    const partes = ["Vendas no Caixa: " + nf0.format(d.vendas), "Entradas: " + nf0.format(d.entradas), "Perdas: " + nf0.format(d.perdas)];
    if (d.transferencias !== 0) partes.push("Transferências: " + sinal(d.transferencias));
    if (d.ajustes !== 0) partes.push("Ajustes: " + sinal(d.ajustes));
    const sobra = d.semExplicacao;
    const conclusao = sobra === 0
      ? "Tudo bate com o que foi registrado."
      : sobra < 0
        ? "Faltam " + nf0.format(Math.abs(sobra)) + " un. sem registro (venda fora do Caixa, quebra ou erro de contagem)."
        : "Sobram " + nf0.format(sobra) + " un. sem registro (entrada não lançada ou erro de contagem).";
    detalhe = '<div class="stock-item-meta">' + esc(partes.join(" · ")) + '</div><small class="legenda">' + esc(conclusao) + '</small>';
  }
  return '<article class="stock-item"><div class="stock-item-head"><div><strong>' + esc(l.produtoNome) + '</strong><small>' +
    esc(ROTULO_LOCAL[l.local] || l.local) + '</small></div>' + selo + '</div>' +
    '<div class="stock-item-meta">' + curtoA + ': <strong>' + valorA + '</strong> → ' + curtoB + ': <strong>' + valorB + '</strong></div>' + detalhe + '</article>';
}

["cmp-dia-a", "cmp-dia-b", "cmp-somente-diferenca"].forEach(id => el(id).addEventListener("change", renderizarComparacao));
el("cmp-busca").addEventListener("input", renderizarComparacao);
