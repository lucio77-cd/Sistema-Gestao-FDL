import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { calcularStatus, formatarData, formatarValorOuAviso } from "./status.js";
import { mostrarToast } from "./toast.js";
import { calcularBaixaPorVencimento } from "./vistoria-stock.js";
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  doc,
  writeBatch,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

let estabelecimentoAtual = null;
let produtosCache = {};
// Produtos que já têm contagem na aba Estoque (só esses sofrem o desconto
// quando um lote é marcado como "Vencido").
let produtosComEstoque = new Set();
// { loteId: { input, valorOriginal, produtoId, produtoNome, precoCusto, local, dataVencimento, acaoZero, quantidadeParaAcao } }
let controlesQuantidade = {};

// Lote que veio na URL (?lote=ID, vindo do Dashboard) — tratado uma única vez,
// na primeira carga da lista.
let loteAlvoPendente = new URLSearchParams(window.location.search).get("lote");

function campoEstoqueDoLocal(local) {
  return local === "Geladeira" ? "geladeira" : "seco";
}

async function carregarProdutosComEstoque() {
  const snap = await getDocs(
    query(collection(db, "estoque"), where("estabelecimentoId", "==", estabelecimentoAtual.id))
  );
  produtosComEstoque = new Set(snap.docs.map((d) => d.id));
}

// ---------- Ordenação da lista ----------
// Só REORDENA os cartões que já estão na tela (sem recarregar do banco), para
// não perder quantidades que você mexeu e ainda não salvou.

const CHAVE_ORDEM = "vistoria:ordenacao";
const seletorOrdem = document.getElementById("ordenar-por");

try {
  const salvo = localStorage.getItem(CHAVE_ORDEM);
  if (salvo && [...seletorOrdem.options].some((o) => o.value === salvo)) seletorOrdem.value = salvo;
} catch (e) {
  /* sem localStorage: segue com a ordenação padrão */
}

function compararNomes(a, b) {
  return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
}

function aplicarOrdenacao() {
  const modo = seletorOrdem.value;
  const container = document.getElementById("lista-lotes-vistoria");
  const linhas = [...container.querySelectorAll(".lote[data-lote-id]")];

  linhas.sort((linhaA, linhaB) => {
    const a = controlesQuantidade[linhaA.dataset.loteId];
    const b = controlesQuantidade[linhaB.dataset.loteId];
    const porNome = compararNomes(a.produtoNome, b.produtoNome);
    const porData = (a.dataVencimento || "9999-12-31").localeCompare(b.dataVencimento || "9999-12-31");

    if (modo === "alfabetica") return porNome || porData;
    if (modo === "quantidade-asc") return Number(a.input.value) - Number(b.input.value) || porNome;
    if (modo === "quantidade-desc") return Number(b.input.value) - Number(a.input.value) || porNome;
    return porData || porNome; // "data": sem validade fica no fim
  });

  linhas.forEach((linha) => container.appendChild(linha));
}

seletorOrdem.addEventListener("change", () => {
  try {
    localStorage.setItem(CHAVE_ORDEM, seletorOrdem.value);
  } catch (e) {
    /* ignora */
  }
  aplicarOrdenacao();
});

// ---------- Destaque do lote vindo do Dashboard ----------

function destacarLoteDaUrl() {
  if (!loteAlvoPendente) return;
  const alvo = loteAlvoPendente;
  loteAlvoPendente = null;

  // Limpa o parâmetro da URL para um refresh não repetir o destaque.
  window.history.replaceState({}, "", window.location.pathname);

  const linha = document.querySelector(`.lote[data-lote-id="${CSS.escape(alvo)}"]`);
  if (!linha) {
    mostrarToast("Esse lote não está mais na lista (já foi vendido, vencido ou excluído).", "erro");
    return;
  }

  linha.scrollIntoView({ behavior: "smooth", block: "center" });
  linha.classList.add("lote--destaque");
  setTimeout(() => linha.classList.remove("lote--destaque"), 3200);
}

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  await carregarProdutos();
  try {
    await carregarProdutosComEstoque();
  } catch (erro) {
    // Sem a regra de "estoque" publicada, a vistoria continua funcionando —
    // só não desconta o estoque ao marcar "Vencido".
    console.error("Não foi possível ler o estoque:", erro);
  }
  await carregarLotes();
});

// ---------- Alternância de seção principal (Atualizar / Adicionar / Saídas) ----------

const segAtualizar = document.getElementById("seg-atualizar");
const segAdicionar = document.getElementById("seg-adicionar");
const segSaidas = document.getElementById("seg-saidas");
const secaoAtualizar = document.getElementById("secao-atualizar");
const secaoAdicionar = document.getElementById("secao-adicionar");
const secaoSaidas = document.getElementById("secao-saidas");

function mostrarSecao(nome) {
  secaoAtualizar.hidden = nome !== "atualizar";
  secaoAdicionar.hidden = nome !== "adicionar";
  secaoSaidas.hidden = nome !== "saidas";

  segAtualizar.classList.toggle("ativo", nome === "atualizar");
  segAtualizar.setAttribute("aria-selected", String(nome === "atualizar"));
  segAdicionar.classList.toggle("ativo", nome === "adicionar");
  segAdicionar.setAttribute("aria-selected", String(nome === "adicionar"));
  segSaidas.classList.toggle("ativo", nome === "saidas");
  segSaidas.setAttribute("aria-selected", String(nome === "saidas"));

  if (nome === "saidas") mostrarSubSecaoSaida("vendidos");
}

segAtualizar.addEventListener("click", () => mostrarSecao("atualizar"));
segAdicionar.addEventListener("click", () => mostrarSecao("adicionar"));
segSaidas.addEventListener("click", () => mostrarSecao("saidas"));

function irParaCadastroDeProduto() {
  mostrarSecao("adicionar");
  const campo = document.getElementById("np-nome");
  campo.scrollIntoView({ behavior: "smooth", block: "center" });
  campo.focus();
}

// ---------- Sub-abas dentro de Saídas (Vendidos / Vencidos) ----------
// "excluidos" e "perdas" viraram uma coleção só ("saidas"), com o campo
// "motivo" distinguindo o caso — mais simples de manter do que duas
// coleções quase idênticas.

const segVendidos = document.getElementById("seg-vendidos");
const segVencidos = document.getElementById("seg-vencidos");
const secaoVendidos = document.getElementById("secao-vendidos");
const secaoVencidos = document.getElementById("secao-vencidos");

function mostrarSubSecaoSaida(nome) {
  secaoVendidos.hidden = nome !== "vendidos";
  secaoVencidos.hidden = nome !== "vencidos";
  segVendidos.classList.toggle("ativo", nome === "vendidos");
  segVendidos.setAttribute("aria-selected", String(nome === "vendidos"));
  segVencidos.classList.toggle("ativo", nome === "vencidos");
  segVencidos.setAttribute("aria-selected", String(nome === "vencidos"));

  if (nome === "vendidos") carregarSaidas("vendido");
  else carregarSaidas("vencido");
}

segVendidos.addEventListener("click", () => mostrarSubSecaoSaida("vendidos"));
segVencidos.addEventListener("click", () => mostrarSubSecaoSaida("vencidos"));

// ---------- Carregamento de produtos e lotes ----------

async function carregarProdutos() {
  const snap = await getDocs(
    query(collection(db, "produtos"), where("estabelecimentoId", "==", estabelecimentoAtual.id))
  );
  produtosCache = {};
  const select = document.getElementById("produto");
  select.innerHTML = '<option value="">Selecione…</option>';
  snap.forEach((d) => {
    produtosCache[d.id] = { id: d.id, ...d.data() };
    const opt = document.createElement("option");
    opt.value = d.id;
    opt.textContent = d.data().nome;
    select.appendChild(opt);
  });
}

async function carregarLotes() {
  const container = document.getElementById("lista-lotes-vistoria");
  const snap = await getDocs(
    query(collection(db, "lotes"), where("estabelecimentoId", "==", estabelecimentoAtual.id))
  );

  controlesQuantidade = {};

  if (snap.empty || snap.docs.every((d) => d.data().importadoParaEstoque)) {
    container.innerHTML = `
      <div class="estado-vazio">
        <p>Nenhum lote cadastrado ainda. Comece cadastrando seu primeiro produto.</p>
        <button type="button" class="btn" id="btn-primeiro-produto">Cadastrar primeiro produto</button>
      </div>
    `;
    document.getElementById("btn-primeiro-produto").addEventListener("click", irParaCadastroDeProduto);
    return;
  }

  const diasAlertaPadrao = estabelecimentoAtual.diasAlertaPadrao ?? 3;
  container.innerHTML = "";

  // Lotes sem data já importados para o Estoque ficam fora desta lista (não
  // são apagados) — assim o mesmo produto não aparece com duas contagens.
  const lotes = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((l) => !l.importadoParaEstoque)
    .sort((a, b) => (a.dataVencimento || "9999-12-31").localeCompare(b.dataVencimento || "9999-12-31"));

  // Migração silenciosa: lotes criados antes desta versão não têm o nome do
  // produto gravado no próprio lote — necessário pra página da gerente ler
  // sem depender da coleção "produtos" (restrita).
  const batchMigracao = writeBatch(db);
  let precisaMigrar = false;

  lotes.forEach((l) => {
    const produto = produtosCache[l.produtoId];
    if (produto && (l.produtoNome === undefined || l.precoCusto === undefined)) {
      l.produtoNome = produto.nome;
      l.precoCusto = produto.precoCusto ?? 0;
      if (l.diasAlerta === undefined) l.diasAlerta = produto.diasAlerta ?? null;
      batchMigracao.update(doc(db, "lotes", l.id), {
        produtoNome: produto.nome,
        precoCusto: produto.precoCusto ?? 0,
        diasAlerta: produto.diasAlerta ?? null,
      });
      precisaMigrar = true;
    }
  });

  if (precisaMigrar) {
    batchMigracao.commit().catch((erro) => console.error("Migração de lotes falhou:", erro));
  }

  lotes.forEach((l) => {
    const produto = produtosCache[l.produtoId] || { nome: l.produtoNome || "(produto removido)" };
    const diasAlerta = (l.diasAlerta ?? produto.diasAlerta) ?? diasAlertaPadrao;
    const { status } = calcularStatus(l.dataVencimento, diasAlerta, l.promocaoAtiva);

    const div = document.createElement("div");
    div.className = `lote lote--${status}`;
    div.dataset.loteId = l.id;
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${produto.nome}</div>
        <div class="lote-meta">${l.local || "—"} · ${l.dataVencimento ? `vence em ${formatarData(l.dataVencimento)}` : "sem validade cadastrada"}</div>
        <div class="lote-acao-zero">
          <button type="button" class="btn-texto btn-acao-zero" data-acao="vendido">Vendido</button>
          <button type="button" class="btn-texto btn-acao-zero" data-acao="vencido">Vencido</button>
          <button type="button" class="btn-texto btn-acao-zero" data-acao="excluir">Excluir</button>
        </div>
      </div>
      <div class="stepper" data-lote-id="${l.id}">
        <button type="button" class="btn-menos" aria-label="Diminuir quantidade de ${produto.nome}">−</button>
        <input type="number" min="0" value="${l.quantidade}" inputmode="numeric" aria-label="Quantidade de ${produto.nome}" />
        <button type="button" class="btn-mais" aria-label="Aumentar quantidade de ${produto.nome}">+</button>
      </div>
    `;
    container.appendChild(div);

    const stepper = div.querySelector(".stepper");
    const input = stepper.querySelector("input");
    const areaAcaoZero = div.querySelector(".lote-acao-zero");

    controlesQuantidade[l.id] = {
      input,
      valorOriginal: Number(l.quantidade),
      produtoId: l.produtoId,
      produtoNome: produto.nome,
      precoCusto: Number(l.precoCusto ?? produto.precoCusto ?? 0),
      local: l.local || "",
      dataVencimento: l.dataVencimento,
      acaoZero: null,
      quantidadeParaAcao: null,
    };

    // Só reflete visualmente o destaque de "alterado" — nunca mexe na ação
    // escolhida. Separado de propósito do clique nos botões abaixo.
    function atualizarClasseAlterado() {
      const valor = Number(input.value);
      const alterou = valor !== controlesQuantidade[l.id].valorOriginal || !!controlesQuantidade[l.id].acaoZero;
      stepper.classList.toggle("alterado", alterou);
    }

    // Mexer no stepper manualmente depois de escolher uma ação cancela a
    // escolha — evita salvar uma ação antiga com uma quantidade que o
    // usuário decidiu digitar por cima.
    function limparAcaoEscolhida() {
      controlesQuantidade[l.id].acaoZero = null;
      controlesQuantidade[l.id].quantidadeParaAcao = null;
      areaAcaoZero.querySelectorAll(".btn-acao-zero").forEach((b) => b.classList.remove("selecionado"));
    }

    stepper.querySelector(".btn-menos").addEventListener("click", () => {
      input.value = Math.max(0, Number(input.value) - 1);
      limparAcaoEscolhida();
      atualizarClasseAlterado();
    });
    stepper.querySelector(".btn-mais").addEventListener("click", () => {
      input.value = Number(input.value) + 1;
      limparAcaoEscolhida();
      atualizarClasseAlterado();
    });
    input.addEventListener("input", () => {
      if (Number(input.value) < 0) input.value = 0;
      limparAcaoEscolhida();
      atualizarClasseAlterado();
    });

    // "Vendido"/"Vencido"/"Excluir" funcionam na quantidade que estiver no campo NESTE
    // momento (não exigem zerar primeiro): guardamos essa quantidade e
    // zeramos o campo, deixando visualmente claro que este lote vai sair do
    // estoque ativo ao salvar.
    areaAcaoZero.querySelectorAll(".btn-acao-zero").forEach((btn) => {
      btn.addEventListener("click", () => {
        const quantidadeNoMomento = Number(input.value);
        controlesQuantidade[l.id].acaoZero = btn.dataset.acao;
        controlesQuantidade[l.id].quantidadeParaAcao = quantidadeNoMomento;
        input.value = 0;

        areaAcaoZero.querySelectorAll(".btn-acao-zero").forEach((b) => b.classList.remove("selecionado"));
        btn.classList.add("selecionado");
        atualizarClasseAlterado();
      });
    });

    atualizarClasseAlterado();
  });

  aplicarOrdenacao();
  destacarLoteDaUrl();
}

// ---------- Lista de saídas (Vendidos / Vencidos) ----------

async function carregarSaidas(motivo) {
  const containerId = motivo === "vendido" ? "lista-vendidos" : "lista-vencidos";
  const container = document.getElementById(containerId);
  container.innerHTML = '<p class="mensagem-vazio">Carregando…</p>';

  let snap;
  try {
    snap = await getDocs(
      query(
        collection(db, "saidas"),
        where("estabelecimentoId", "==", estabelecimentoAtual.id),
        where("motivo", "==", motivo)
      )
    );
  } catch (erro) {
    console.error("Falha ao carregar saídas:", erro);
    container.innerHTML =
      '<p class="mensagem-vazio">Não foi possível carregar. Confirme se as regras do Firestore foram publicadas (coleção "saidas") e tente de novo.</p>';
    return;
  }

  const itens = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => {
      const dataA = a.registradoEm?.toDate ? a.registradoEm.toDate() : new Date(0);
      const dataB = b.registradoEm?.toDate ? b.registradoEm.toDate() : new Date(0);
      return dataB - dataA;
    });

  if (motivo === "vencido") {
    const total = itens.reduce((soma, it) => soma + (Number(it.valor) || 0), 0);
    document.getElementById("total-vencido").textContent = `R$ ${total.toFixed(2)}`;
  }

  container.innerHTML = "";

  if (itens.length === 0) {
    container.innerHTML = `<p class="mensagem-vazio">Nenhum item ${motivo === "vendido" ? "vendido" : "vencido"} registrado ainda.</p>`;
    return;
  }

  itens.forEach((item) => {
    const data = item.registradoEm?.toDate ? item.registradoEm.toDate() : null;
    const dataTexto = data ? data.toLocaleDateString("pt-BR") : "—";

    const div = document.createElement("div");
    div.className = `lote lote--${motivo === "vencido" ? "vencido" : "excluido"}`;
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${item.produtoNome}</div>
        <div class="lote-meta">${item.local || "—"} · ${item.quantidade} un. · ${item.dataVencimentoOriginal ? `vencia em ${formatarData(item.dataVencimentoOriginal)}` : "sem validade cadastrada"}</div>
      </div>
      <div class="lote-dados">
        ${motivo === "vencido" ? `<div class="lote-dias lote-dias--vencido">${formatarValorOuAviso(item.quantidade, item.precoCusto)}</div>` : ""}
        <div class="lote-valor">Registrado em ${dataTexto}</div>
      </div>
    `;
    container.appendChild(div);
  });
}

// ---------- Salvar vistoria (escrita atômica + histórico) ----------

document.getElementById("btn-salvar-vistoria").addEventListener("click", async () => {
  const botao = document.getElementById("btn-salvar-vistoria");

  // Um lote entra no salvamento se: (a) uma ação foi escolhida (Vendido,
  // Vencido ou Excluir), não importa em que quantidade estava quando clicou;
  // ou (b) a quantidade foi mesmo alterada pelo stepper, sem ação nenhuma.
  const alterados = Object.entries(controlesQuantidade).filter(([, c]) => {
    if (c.acaoZero) return true;
    return Number(c.input.value) !== c.valorOriginal;
  });

  if (alterados.length === 0) {
    mostrarToast("Nenhuma quantidade foi alterada.", "ok");
    return;
  }

  // Só bloqueia quando alguém zera pelo stepper (− manual) sem clicar em
  // nenhum dos botões — aí sim falta dizer o que houve. Quem usou um
  // dos botões já resolveu isso, em qualquer quantidade.
  const prontos = [];
  const pendentes = [];
  alterados.forEach(([loteId, c]) => {
    const quantidadeNova = Number(c.input.value);
    if (quantidadeNova === 0 && !c.acaoZero) {
      pendentes.push(c.produtoNome);
    } else {
      prontos.push([loteId, c, quantidadeNova]);
    }
  });

  if (prontos.length === 0) {
    mostrarToast(`Escolha "Vendido", "Vencido" ou "Excluir" para: ${pendentes.join(", ")}.`, "erro");
    return;
  }

  // "Excluir" apaga o lote sem deixar histórico (serve para cadastro errado,
  // duplicado etc.) — por isso pede confirmação antes de salvar.
  const aExcluir = prontos.filter(([, c]) => c.acaoZero === "excluir").map(([, c]) => c.produtoNome);
  if (aExcluir.length > 0) {
    const confirmou = window.confirm(
      `Excluir sem deixar histórico: ${aExcluir.join(", ")}.\n\nIsso não aparece em Vendidos nem em Vencidos e não pode ser desfeito. Continuar?`
    );
    if (!confirmou) return;
  }

  botao.disabled = true;
  const textoOriginal = botao.textContent;
  botao.textContent = "Salvando…";

  try {
    const itensHistorico = [];
    const loteRefs = prontos.map(([loteId]) => doc(db, "lotes", loteId));
    const produtosVencidos = [...new Set(prontos
      .filter(([, c]) => c.acaoZero === "vencido" && (c.quantidadeParaAcao ?? c.valorOriginal) > 0)
      .map(([, c]) => c.produtoId))];
    const estoqueRefs = produtosVencidos.map((produtoId) => doc(db, "estoque", produtoId));
    const divergencias = [];

    await runTransaction(db, async (tx) => {
      // Todas as leituras ocorrem antes de qualquer escrita. A transação
      // protege a baixa do estoque contra vendas/ajustes concorrentes.
      const loteSnaps = await Promise.all(loteRefs.map((ref) => tx.get(ref)));
      const estoqueSnaps = await Promise.all(estoqueRefs.map((ref) => tx.get(ref)));
      const lotesAtuais = new Map(loteSnaps.map((snap) => [snap.id, snap]));
      const estoqueAtual = new Map(estoqueSnaps.map((snap) => [snap.id, snap]));

      for (let i = 0; i < prontos.length; i += 1) {
        const [loteId, c] = prontos[i];
        const snap = lotesAtuais.get(loteId);
        if (!snap?.exists()) throw new Error("Um dos lotes foi removido. Atualize a página e tente novamente.");
        const lote = snap.data();
        if (lote.estabelecimentoId !== estabelecimentoAtual.id ||
            Number(lote.quantidade) !== Number(c.valorOriginal)) {
          throw new Error("Um dos lotes mudou desde que a página foi carregada. Atualize a página e tente novamente.");
        }
      }

      prontos.forEach(([loteId, c, quantidadeNova]) => {
        const loteRef = doc(db, "lotes", loteId);
        const quantidadeDaAcao = c.quantidadeParaAcao ?? c.valorOriginal;

        if (c.acaoZero === "excluir") {
          tx.delete(loteRef);
        } else if (c.acaoZero === "vendido" || c.acaoZero === "vencido") {
          tx.delete(loteRef);
          const refSaida = doc(collection(db, "saidas"));
          tx.set(refSaida, {
            estabelecimentoId: estabelecimentoAtual.id,
            produtoId: c.produtoId,
            produtoNome: c.produtoNome,
            motivo: c.acaoZero,
            quantidade: quantidadeDaAcao,
            precoCusto: c.precoCusto,
            valor: quantidadeDaAcao * c.precoCusto,
            local: c.local,
            dataVencimentoOriginal: c.dataVencimento,
            origem: "vistoria",
            registradoEm: serverTimestamp(),
          });

          if (c.acaoZero === "vencido" && quantidadeDaAcao > 0) {
            const campo = campoEstoqueDoLocal(c.local);
            const saldoSnap = estoqueAtual.get(c.produtoId);
            const existeSaldo = !!saldoSnap?.exists();
            const saldo = existeSaldo ? saldoSnap.data()[campo] : null;
            const baixa = calcularBaixaPorVencimento(saldo, quantidadeDaAcao, existeSaldo);

            if (baixa.atualizar) {
              tx.update(doc(db, "estoque", c.produtoId), {
                [campo]: baixa.depois,
                atualizadoEm: serverTimestamp(),
              });
            }
            if (baixa.divergencia) divergencias.push(c.produtoNome);

            tx.set(doc(collection(db, "movimentosEstoque")), {
              estabelecimentoId: estabelecimentoAtual.id,
              produtoId: c.produtoId,
              produtoNome: c.produtoNome,
              local: campo,
              tipo: "vencido",
              delta: baixa.delta,
              quantidadeSolicitada: quantidadeDaAcao,
              antes: baixa.antes,
              depois: baixa.depois,
              saldoAtualizado: baixa.atualizar,
              divergenciaSaldo: baixa.divergencia,
              origem: "vistoria",
              registradoEm: serverTimestamp(),
            });
          }
        } else {
          tx.update(loteRef, { quantidade: quantidadeNova });
        }

        itensHistorico.push({
          loteId,
          produtoId: c.produtoId,
          quantidadeAnterior: c.valorOriginal,
          quantidadeNova,
          acao: c.acaoZero || "ajuste",
        });
      });

      tx.set(doc(collection(db, "vistorias")), {
        estabelecimentoId: estabelecimentoAtual.id,
        data: serverTimestamp(),
        itens: itensHistorico,
      });

      tx.update(doc(db, "estabelecimentos", estabelecimentoAtual.id), {
        ultimaVistoria: serverTimestamp(),
      });
    });

    if (divergencias.length > 0) {
      mostrarToast(`Vistoria salva, mas o saldo geral era insuficiente para: ${[...new Set(divergencias)].join(", ")}. Saldo preservado em zero; confira o estoque físico.`, "erro");
    } else if (pendentes.length > 0) {
      mostrarToast(`Vistoria salva. Falta decidir: ${pendentes.join(", ")}.`, "erro");
    } else {
      mostrarToast("Vistoria salva com sucesso.", "ok");
    }

    await carregarLotes();
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não salvou — verifique a conexão e tente de novo.", "erro");
  } finally {
    botao.disabled = false;
    botao.textContent = textoOriginal;
  }
});

// ---------- Cadastro de produto ----------

document.getElementById("btn-salvar-produto").addEventListener("click", async () => {
  const nomeInput = document.getElementById("np-nome");
  const nome = nomeInput.value.trim();
  if (!nome) {
    nomeInput.focus();
    return;
  }

  const dados = {
    estabelecimentoId: estabelecimentoAtual.id,
    nome,
    categoria: document.getElementById("np-categoria").value.trim(),
    precoCusto: Number(document.getElementById("np-custo").value) || 0,
    precoVenda: Number(document.getElementById("np-venda").value) || 0,
  };
  const diasAlerta = document.getElementById("np-dias-alerta").value;
  if (diasAlerta !== "") dados.diasAlerta = Number(diasAlerta);

  try {
    await addDoc(collection(db, "produtos"), dados);
    document.getElementById("np-nome").value = "";
    document.getElementById("np-categoria").value = "";
    document.getElementById("np-custo").value = "";
    document.getElementById("np-venda").value = "";
    document.getElementById("np-dias-alerta").value = "";
    await carregarProdutos();
    mostrarToast(`Produto "${nome}" cadastrado.`, "ok");
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível salvar o produto.", "erro");
  }
});

// ---------- Cadastro de lote ----------
// O nome do produto e o preço de custo são gravados também no próprio lote
// (denormalizado). Isso é o que permite a página da gerente (sem login) ler
// os lotes sem precisar consultar a coleção "produtos" — que fica restrita
// por conter preço de custo/venda.

document.getElementById("form-novo-lote").addEventListener("submit", async (e) => {
  e.preventDefault();
  const erro = document.getElementById("erro-lote");
  erro.hidden = true;

  const produtoId = document.getElementById("produto").value;
  const produto = produtosCache[produtoId];
  if (!produtoId || !produto) {
    erro.textContent = "Selecione um produto.";
    erro.hidden = false;
    return;
  }

  try {
    await addDoc(collection(db, "lotes"), {
      estabelecimentoId: estabelecimentoAtual.id,
      produtoId,
      produtoNome: produto.nome,
      precoCusto: produto.precoCusto ?? 0,
      diasAlerta: produto.diasAlerta ?? null,
      quantidade: Number(document.getElementById("quantidade").value),
      local: document.getElementById("local").value,
      dataVencimento: document.getElementById("vencimento").value || null,
      promocaoAtiva: false,
      precoPromocional: null,
    });

    e.target.reset();
    mostrarToast("Lote adicionado.", "ok");
    await carregarLotes();
    mostrarSecao("atualizar");
  } catch (err) {
    console.error(err);
    erro.textContent = "Não foi possível salvar o lote. Tente novamente.";
    erro.hidden = false;
  }
});
