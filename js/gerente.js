import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import {
  calcularStatus,
  formatarDiasRestantes,
  calcularResumoGerente,
  sugestaoAcao,
  STATUS_ICONE,
  montarGraficoPorProduto,
  calcularPercentuaisEstoque,
} from "./status.js";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { mostrarToast } from "./toast.js";

// A gerente precisa entrar com e-mail e senha; os dados são limitados ao estabelecimento autenticado.\n\nlet itensEstoque = []; // linhas planas { produtoNome, quantidade, local } vindas da coleção "estoque"\nlet estoqueCarregado = false;\nlet todosLotes = []; // TODOS os lotes ativos (para calcular os que precisam de atenção)\nlet lotesUrgentes = []; // só os que precisam de atenção, para a aba Vencimentos\nlet graficoAtual = null;\nconst filtroPeriodo = document.getElementById("filtro-periodo");\nconst filtroEstoqueLocal = document.getElementById("filtro-estoque-local");\n\n// ---------- Abas Vencimentos / Estoque ----------

const segVencimentos = document.getElementById("seg-vencimentos");
const segEstoque = document.getElementById("seg-estoque");
const secaoVencimentos = document.getElementById("secao-vencimentos");
const secaoEstoque = document.getElementById("secao-estoque");

function mostrarAba(nome) {
  const ehVencimentos = nome === "vencimentos";
  secaoVencimentos.hidden = !ehVencimentos;
  secaoEstoque.hidden = ehVencimentos;
  segVencimentos.classList.toggle("ativo", ehVencimentos);
  segVencimentos.setAttribute("aria-selected", String(ehVencimentos));
  segEstoque.classList.toggle("ativo", !ehVencimentos);
  segEstoque.setAttribute("aria-selected", String(!ehVencimentos));

  if (!ehVencimentos && estoqueCarregado) renderizarEstoque();
}

segVencimentos.addEventListener("click", () => mostrarAba("vencimentos"));
segEstoque.addEventListener("click", () => mostrarAba("estoque"));
filtroEstoqueLocal.addEventListener("change", renderizarEstoque);

protegerPagina(async ({ estabelecimento }) => {
  try {
    document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
    renderizarAtualizacao(estabelecimento.ultimaVistoria);

    const diasAlertaPadrao = estabelecimento.diasAlertaPadrao ?? 3;

    const [lotesSnap, estoqueSnap] = await Promise.all([
      getDocs(query(collection(db, "lotes"), where("estabelecimentoId", "==", estabelecimento.id))),
      getDocs(query(collection(db, "estoque"), where("estabelecimentoId", "==", estabelecimento.id))),
    ]);

    // Aba Estoque: lê a contagem da coleção "estoque" (independente dos lotes).
    // Número negativo (venda sem estoque contado) aparece como 0 para ela.
    itensEstoque = [];
    estoqueSnap.forEach((d) => {
      const e = d.data();
      const nome = e.produtoNome || "Produto";
      itensEstoque.push({ produtoNome: nome, quantidade: Math.max(0, Number(e.geladeira) || 0), local: "Geladeira" });
      itensEstoque.push({ produtoNome: nome, quantidade: Math.max(0, Number(e.seco) || 0), local: "Estoque seco" });
    });
    estoqueCarregado = true;
    if (!secaoEstoque.hidden) renderizarEstoque();

    if (lotesSnap.empty) {
      document.getElementById("lista-lotes").innerHTML =
        '<p class="mensagem-vazio">Nenhum dado encontrado ainda.</p>';
      document.getElementById("resumo").hidden = true;
      return;
    }

    todosLotes = lotesSnap.docs.map((d) => {
      const dados = d.data();
      const diasAlerta = dados.diasAlerta ?? diasAlertaPadrao;
      const { diasRestantes, status } = calcularStatus(dados.dataVencimento, diasAlerta, dados.promocaoAtiva);
      return { id: d.id, ...dados, produtoNome: dados.produtoNome || "Produto", diasRestantes, status };
    });

    lotesUrgentes = todosLotes
      .filter((l) => l.status !== "normal" && l.status !== "sem-validade")
      .sort((a, b) => a.diasRestantes - b.diasRestantes);

    renderizarResumo(lotesUrgentes);
    renderizarLista(lotesUrgentes);

    if (lotesUrgentes.length > 0) {
      document.getElementById("bloco-grafico").hidden = false;
      renderizarGrafico();
      filtroPeriodo.addEventListener("change", renderizarGrafico);
    }
  } catch (erro) {
    console.error(erro);
    mostrarErro("Não foi possível carregar os dados agora. Verifique as regras do Firestore e tente novamente.");
  }
});

// Uma barra por lote, nome do produto ao lado, comprimento = quantidade.
function renderizarGrafico() {
  const periodo = Number(filtroPeriodo.value);
  const lotesNoPeriodo = lotesUrgentes.filter((l) => l.diasRestantes <= periodo);

  if (graficoAtual) {
    graficoAtual.destroy();
    graficoAtual = null;
  }

  const canvas = document.getElementById("grafico-vencimentos");
  const semDados = document.getElementById("grafico-sem-dados");

  if (lotesNoPeriodo.length === 0) {
    canvas.hidden = true;
    semDados.hidden = false;
    semDados.textContent = "Nenhum dado neste período.";
    return;
  }

  canvas.hidden = false;
  semDados.hidden = true;
  const { chart } = montarGraficoPorProduto(canvas, lotesNoPeriodo);
  graficoAtual = chart;
}

// ---------- Aba Estoque: o que tem hoje, por produto, com % do total ----------
// O percentual é sempre sobre o estoque TODO (geladeira + seco), mesmo com o
// filtro de local ligado — "15% de Sprite" é sobre tudo que existe.

function renderizarEstoque() {
  if (!estoqueCarregado) return;
  const local = filtroEstoqueLocal.value;
  const container = document.getElementById("tabela-estoque");

  if (itensEstoque.length === 0) {
    container.innerHTML = '<p class="mensagem-vazio">O estoque ainda não foi contado.</p>';
    return;
  }

  const percentuais = calcularPercentuaisEstoque(itensEstoque);
  const totalGeral = percentuais.reduce((soma, p) => soma + p.quantidade, 0);

  const linhas = percentuais
    .map((p) => {
      if (local === "todos") return p;
      const quantidade = p.local[local] || 0;
      return { ...p, quantidade, percentual: totalGeral > 0 ? (quantidade / totalGeral) * 100 : 0 };
    })
    .sort((a, b) => b.quantidade - a.quantidade);

  container.innerHTML = linhas
    .map(
      (p) => `
        <div class="linha-estoque">
          <div class="linha-estoque-nome">${p.produtoNome}</div>
          <div class="linha-estoque-qtd">${p.quantidade} un.</div>
          <div class="linha-estoque-pct">${p.percentual.toFixed(1)}%</div>
        </div>
      `
    )
    .join("");
}

// Cartão-resumo: uma frase e um número, pensados para leitura de 5 segundos
// sem precisar interpretar tabela — a decisão certa para quem não tem
// contexto do sistema e pode nem chegar a abrir esta página com frequência.
function renderizarResumo(lotes) {
  const resumo = calcularResumoGerente(lotes);
  const el = document.getElementById("resumo");
  el.hidden = false;
  el.className = `resumo resumo--${resumo.status}`;
  document.getElementById("resumo-numero").textContent =
    resumo.numero !== null ? resumo.numero : "✓";
  document.getElementById("resumo-texto").textContent = resumo.texto;
}

function renderizarAtualizacao(ultimaVistoria) {
  const el = document.getElementById("legenda-atualizacao");
  if (!ultimaVistoria) {
    el.textContent = "Nenhuma vistoria registrada ainda.";
    return;
  }
  const data = ultimaVistoria.toDate ? ultimaVistoria.toDate() : new Date(ultimaVistoria);
  el.textContent = `Atualizado pela última vez em ${data.toLocaleDateString("pt-BR")} às ${data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

function renderizarLista(lotes) {
  const container = document.getElementById("lista-lotes");
  container.innerHTML = "";

  if (lotes.length === 0) {
    container.innerHTML = '<p class="mensagem-vazio">Nada em atenção ou vencido no momento.</p>';
    return;
  }

  lotes.forEach((l) => {
    const div = document.createElement("div");
    div.className = `lote lote--${l.status}`;
    div.innerHTML = `
      <div class="lote-info">
        <div class="lote-produto">${STATUS_ICONE[l.status]} ${l.produtoNome}</div>
        <div class="lote-meta">${l.local || "—"} · ${l.quantidade} un.</div>
        <div class="lote-instrucao lote-dias--${l.status}">${sugestaoAcao(l.status, l.diasRestantes)}</div>
        <div class="lote-preco-venda">
          <label>Valor de venda (R$)</label>
          <input type="number" step="0.01" min="0" class="input-preco-venda" value="${l.precoPromocional ?? ""}" placeholder="Ex: 3.50" />
          <button type="button" class="btn btn-secundario btn-salvar-preco" data-id="${l.id}">Salvar</button>
        </div>
      </div>
      <div class="lote-dados">
        <div class="lote-dias lote-dias--${l.status}">${formatarDiasRestantes(l.diasRestantes)}</div>
      </div>
    `;
    container.appendChild(div);
  });

  container.querySelectorAll(".btn-salvar-preco").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const linha = btn.closest(".lote-preco-venda");
      const input = linha.querySelector(".input-preco-venda");
      const valor = Number(input.value);

      if (!input.value || valor < 0) {
        mostrarToast("Informe um valor válido.", "erro");
        return;
      }

      btn.disabled = true;
      const textoOriginal = btn.textContent;
      btn.textContent = "Salvando…";

      try {
        await updateDoc(doc(db, "lotes", btn.dataset.id), {
          precoPromocional: valor,
          promocaoAtiva: true,
        });
        mostrarToast("Valor de venda salvo.", "ok");
      } catch (erro) {
        console.error(erro);
        mostrarToast("Não foi possível salvar. Tente novamente.", "erro");
      } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
      }
    });
  });
}

function mostrarErro(mensagem) {
  const el = document.getElementById("erro-token");
  el.textContent = mensagem || "Link inválido ou expirado.";
  el.hidden = false;
  document.getElementById("lista-lotes").innerHTML = "";
  document.getElementById("legenda-atualizacao").textContent = "";
}

