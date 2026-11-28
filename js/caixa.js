import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
import { mostrarToast } from "./toast.js";
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  doc,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

// Mesmo formato usado nas contagens e transferências do Estoque, para o livro
// de movimentos mostrar o mesmo nome do produto em todas as origens.
function nomeApresentacao(produto) {
  return [produto.marca, produto.nome, produto.variante, produto.embalagem, produto.volume]
    .filter(Boolean).join(" · ") || produto.nome;
}

let estabelecimentoAtual = null;
const campoCodigo = document.getElementById("campo-codigo");

protegerPagina(({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;

  if (!estabelecimento.baixaAutomaticaAtiva) {
    document.getElementById("caixa-status-texto").textContent = "Desativado";
    document.querySelector(".caixa-status").classList.add("caixa-status--desativado");
    document.getElementById("caixa-desativado").hidden = false;
    return;
  }

  document.getElementById("caixa-ativo").hidden = false;
  document.getElementById("caixa-status-texto").textContent = "Pronto para leitura";
  campoCodigo.focus();
});

document.getElementById("form-scanner").addEventListener("submit", async (e) => {
  e.preventDefault();
  const codigo = campoCodigo.value.trim();
  campoCodigo.value = "";
  campoCodigo.focus();

  if (!codigo) return;
  await processarLeitura(codigo);
});

async function processarLeitura(codigo, tentativas = 0) {
  try {
    const produtosSnap = await getDocs(
      query(
        collection(db, "produtos"),
        where("estabelecimentoId", "==", estabelecimentoAtual.id),
        where("codigoBarras", "==", codigo)
      )
    );

    if (produtosSnap.empty) {
      registrarLeitura(null, "Código não reconhecido.", "erro");
      return;
    }

    // Um código de barras deve identificar uma única apresentação dentro
    // do estabelecimento. Escolher o primeiro resultado poderia baixar
    // o produto errado quando há cadastros duplicados.
    if (produtosSnap.size > 1) {
      registrarLeitura(null, "Este código de barras está vinculado a mais de um produto. Corrija os cadastros antes de vender.", "erro");
      return;
    }

    const produto = { id: produtosSnap.docs[0].id, ...produtosSnap.docs[0].data() };
    const estoqueRef = doc(db, "estoque", produto.id);
    const estoqueConsulta = await getDoc(estoqueRef);
    let localParaLote = produto.localEstoque;
    if (estoqueConsulta.exists()) {
      const saldoConsulta = estoqueConsulta.data();
      if (["geladeira","seco"].includes(localParaLote) && Number(saldoConsulta[localParaLote]) <= 0) {
        const outro = localParaLote === "geladeira" ? "seco" : "geladeira";
        if (Number(saldoConsulta[outro]) > 0) localParaLote = outro;
      } else if (!["geladeira","seco"].includes(localParaLote)) {
        const positivos = ["geladeira","seco"].filter(campo => Number(saldoConsulta[campo]) > 0);
        if (positivos.length === 1) localParaLote = positivos[0];
      }
    }
    const localLoteTexto = localParaLote === "geladeira" ? "Geladeira"
      : localParaLote === "seco" ? "Estoque seco" : null;
    const lotesSnap = await getDocs(
      query(
        collection(db, "lotes"),
        where("estabelecimentoId", "==", estabelecimentoAtual.id),
        where("produtoId", "==", produto.id)
      )
    );

    // Lotes já importados representam o mesmo saldo controlado em estoque/{produtoId}.
    // Não podem voltar a ser vendidos como se fossem um segundo estoque.
    const candidatos = lotesSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((l) => !l.importadoParaEstoque && !l.encerrado && Number(l.quantidade) > 0
        && (!localLoteTexto || l.local === localLoteTexto))
      // FEFO: quando há validade, vende primeiro o lote que vence antes.
      .sort((a, b) => String(a.dataVencimento || "9999-12-31").localeCompare(String(b.dataVencimento || "9999-12-31")));
    const loteRef = candidatos.length ? doc(db, "lotes", candidatos[0].id) : null;

    const resultado = await runTransaction(db, async (tx) => {
      const estoqueSnap = await tx.get(estoqueRef);
      const loteSnap = loteRef ? await tx.get(loteRef) : null;

      if (estoqueSnap.exists()) {
        const saldo = estoqueSnap.data();
        let campoLocal = produto.localEstoque;
        if (!["geladeira", "seco"].includes(campoLocal)) {
          const positivos = ["geladeira", "seco"].filter((campo) => Number(saldo[campo]) > 0);
          if (positivos.length !== 1) {
            return { status: "local-indefinido" };
          }
          campoLocal = positivos[0];
        }

        let quantidadeAtual = Number(saldo[campoLocal]) || 0;
        if (quantidadeAtual <= 0) {
          // Se o local padrão estiver zerado, só usa o outro quando ele for
          // a única origem com saldo. Nunca escolhe entre dois saldos positivos.
          const outroLocal = campoLocal === "geladeira" ? "seco" : "geladeira";
          const saldoOutro = Number(saldo[outroLocal]) || 0;
          if (saldoOutro <= 0) return { status: "sem-estoque" };
          campoLocal = outroLocal;
          quantidadeAtual = saldoOutro;
        }

        // Se a consulta de lotes encontrou um candidato, ele precisa continuar
        // válido dentro da transação. Caso tenha sido encerrado/movido por outra
        // venda, repetimos a leitura para escolher o próximo lote FEFO.
        let precoPromocional = null;
        let loteParaHistorico = null;
        if (loteRef) {
          if (!loteSnap || !loteSnap.exists()) return { status: "lote-mudou" };
          const lote = loteSnap.data();
          const localLoteEsperado = campoLocal === "geladeira" ? "Geladeira" : "Estoque seco";
          if (lote.importadoParaEstoque || lote.encerrado || lote.local !== localLoteEsperado || Number(lote.quantidade) <= 0) {
            return { status: "lote-mudou" };
          }
          loteParaHistorico = lote;
          const quantidadeLoteNova = Number(lote.quantidade) - 1;
          tx.update(loteRef, {
            quantidade: quantidadeLoteNova,
            ...(quantidadeLoteNova === 0 ? {
              encerrado: true,
              motivoEncerramento: "vendido",
              encerradoEm: serverTimestamp()
            } : {})
          });
          precoPromocional = lote.promocaoAtiva && lote.precoPromocional != null ? lote.precoPromocional : null;
        }

        // Só baixa o saldo geral depois de validar o lote candidato. Assim,
        // uma disputa pelo último item não reduz o estoque sem atualizar lote.
        tx.update(estoqueRef, { [campoLocal]: quantidadeAtual - 1 });
        const refMovimento = doc(collection(db, "movimentosEstoque"));
        tx.set(refMovimento, {
          estabelecimentoId: estabelecimentoAtual.id,
          produtoId: produto.id,
          produtoNome: nomeApresentacao(produto),
          local: campoLocal,
          tipo: "venda",
          quantidade: 1,
          delta: -1,
          origem: "caixa",
          registradoEm: serverTimestamp(),
        });
        const custoVenda = loteParaHistorico?.precoCusto ?? produto.precoCusto ?? 0;
        const refSaida = doc(collection(db, "saidas"));
        tx.set(refSaida, {
          estabelecimentoId: estabelecimentoAtual.id,
          produtoId: produto.id,
          produtoNome: nomeApresentacao(produto),
          motivo: "vendido",
          quantidade: 1,
          precoCusto: custoVenda,
          valor: custoVenda,
          local: loteParaHistorico?.local || (campoLocal === "geladeira" ? "Geladeira" : "Estoque seco"),
          dataVencimentoOriginal: loteParaHistorico?.dataVencimento || null,
          origem: "caixa",
          registradoEm: serverTimestamp(),
        });
        return { status: "baixado-estoque", quantidadeNova: quantidadeAtual - 1, local: campoLocal, precoPromocional };
      }

      // Compatibilidade com produtos legados ainda controlados exclusivamente por lotes.
      if (!loteSnap || !loteSnap.exists()) return { status: "sem-estoque" };
      const lote = loteSnap.data();
      const quantidadeAtual = Number(lote.quantidade) || 0;
      if (quantidadeAtual <= 0 || lote.importadoParaEstoque) return { status: "lote-mudou" };

      const quantidadeNova = quantidadeAtual - 1;
      const local = lote.local === "Geladeira" ? "geladeira"
        : lote.local === "Estoque seco" ? "seco" : "geral";
      const refMovimento = doc(collection(db, "movimentosEstoque"));
      tx.set(refMovimento, {
        estabelecimentoId: estabelecimentoAtual.id,
        produtoId: produto.id,
        produtoNome: nomeApresentacao(produto),
        local,
        tipo: "venda",
        quantidade: 1,
        delta: -1,
        origem: "caixa",
        registradoEm: serverTimestamp(),
      });

      // Exclusão física de lotes é bloqueada pelas regras. Zerar preserva o
      // registro histórico e permite que a venda seja concluída com segurança.
      tx.update(loteRef, {
        quantidade: quantidadeNova,
        ...(quantidadeNova === 0 ? {
          encerrado: true,
          motivoEncerramento: "vendido",
          encerradoEm: serverTimestamp()
        } : {})
      });
      const custoVenda = lote.precoCusto ?? produto.precoCusto ?? 0;
      const refSaida = doc(collection(db, "saidas"));
      tx.set(refSaida, {
        estabelecimentoId: estabelecimentoAtual.id,
        produtoId: produto.id,
        produtoNome: nomeApresentacao(produto),
        motivo: "vendido",
        quantidade: 1,
        precoCusto: custoVenda,
        valor: custoVenda,
        local: lote.local || "",
        dataVencimentoOriginal: lote.dataVencimento || null,
        origem: "caixa",
        registradoEm: serverTimestamp(),
      });
      return {
        status: "baixado-lote",
        quantidadeNova,
        precoPromocional: lote.promocaoAtiva && lote.precoPromocional != null ? lote.precoPromocional : null
      };
    });

    if (resultado.status === "local-indefinido") {
      registrarLeitura(produto.nome, "Defina o local do produto no cadastro: há saldo em mais de um local.", "erro");
      return;
    }
    if (resultado.status === "sem-estoque") {
      registrarLeitura(produto.nome, "Sem saldo disponível para venda.", "erro");
      return;
    }
    if (resultado.status === "lote-mudou") {
      if (tentativas < 3) return processarLeitura(codigo, tentativas + 1);
      registrarLeitura(produto.nome, "O estoque mudou durante a leitura. Tente novamente.", "erro");
      return;
    }

    const precoPromocional = resultado.precoPromocional;
    const precoCadastro = produto.precoVenda;
    const precoUnitario = precoPromocional != null && precoPromocional !== "" && Number.isFinite(Number(precoPromocional))
      ? Number(precoPromocional)
      : (precoCadastro != null && precoCadastro !== "" && Number.isFinite(Number(precoCadastro)) ? Number(precoCadastro) : null);

    const localTexto = resultado.local ? (resultado.local === "geladeira" ? "Geladeira" : "Parte seca") : "lote";
    registrarLeitura(
      produto.nome,
      resultado.quantidadeNova > 0
        ? `Baixa registrada em ${localTexto} — restam ${resultado.quantidadeNova} un.`
        : `Baixa registrada em ${localTexto} — saldo zerado.`,
      "ok",
      { produtoId: produto.id, precoUnitario }
    );
  } catch (erro) {
    console.error(erro);
    registrarLeitura(null, "Erro ao processar. Tente ler de novo.", "erro");
  }
}

let totalLeiturasSessao = 0;
const itensCompra = new Map();

function dinheiro(valor) {
  return Number(valor).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function registrarLeitura(produtoNome, mensagem, tipo, detalhes = null) {
  if (tipo !== "ok") mostrarToast(produtoNome ? `${produtoNome}: ${mensagem}` : mensagem, tipo);
  if (tipo !== "ok" || !detalhes) return;

  const chave = detalhes.produtoId || produtoNome;
  const existente = itensCompra.get(chave);
  if (existente) {
    existente.quantidade += 1;
    if (existente.precoUnitario == null && detalhes.precoUnitario != null) existente.precoUnitario = detalhes.precoUnitario;
  } else {
    itensCompra.set(chave, { produtoId: chave, nome: produtoNome, quantidade: 1, precoUnitario: detalhes.precoUnitario });
  }
  totalLeiturasSessao += 1;
  renderizarCompra();
}

function renderizarCompra() {
  const container = document.getElementById("lista-leituras");
  const itens = [...itensCompra.values()];
  const unidades = itens.reduce((soma, item) => soma + item.quantidade, 0);
  const incompletos = itens.some(item => item.precoUnitario == null);
  const totalConhecido = itens.reduce((soma, item) => soma + (item.precoUnitario == null ? 0 : item.precoUnitario * item.quantidade), 0);
  document.getElementById("caixa-contador-leituras").textContent = `${itens.length} ${itens.length === 1 ? "produto" : "produtos"}`;
  document.getElementById("caixa-total-unidades").textContent = String(unidades);
  document.getElementById("caixa-total-valor").textContent = incompletos ? `${dinheiro(totalConhecido)}*` : dinheiro(totalConhecido);
  document.getElementById("caixa-aviso-precos").hidden = !incompletos;

  if (!itens.length) {
    container.innerHTML = '<div class="caixa-vazio"><div class="caixa-vazio-icone" aria-hidden="true">▢</div><strong>Vamos começar?</strong><p>Os produtos adicionados aparecerão aqui, com os preços cadastrados.</p></div>';
    return;
  }
  container.innerHTML = itens.map(item => {
    const total = item.precoUnitario == null ? "—" : dinheiro(item.precoUnitario * item.quantidade);
    const unitario = item.precoUnitario == null ? "Sem preço" : dinheiro(item.precoUnitario);
    return `<div class="caixa-item-compra"><div class="caixa-item-nome">${escapeHtml(item.nome)}</div><div class="caixa-item-qtd">${item.quantidade}</div><div class="caixa-item-unitario">${unitario}</div><div class="caixa-item-total">${total}</div></div>`;
  }).join("");
}

// Encerra a compra na tela. A baixa de estoque de cada leitura já foi gravada;
// este botão só limpa o resumo para começar a próxima compra.
document.getElementById("btn-nova-compra")?.addEventListener("click", () => {
  if (!itensCompra.size) return;
  if (!window.confirm("Limpar a lista da compra atual? As baixas de estoque já registradas não serão desfeitas.")) return;
  itensCompra.clear();
  totalLeiturasSessao = 0;
  renderizarCompra();
  campoCodigo.focus();
});
