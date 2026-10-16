import { db } from "./firebase-config.js";
import { protegerPagina } from "./auth-guard.js";
import { iniciarNavegacao } from "./nav.js";
import { mostrarToast } from "./toast.js";
import {
  collection, query, where, getDocs, doc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

iniciarNavegacao();

let estabelecimentoAtual = null;
let produtos = [];

const container = document.getElementById("lista-produtos");
const campoBusca = document.getElementById("busca-produto");
const filtroIncompletos = document.getElementById("filtro-incompletos");

protegerPagina(async ({ estabelecimento }) => {
  estabelecimentoAtual = estabelecimento;
  document.getElementById("nome-estabelecimento").textContent = estabelecimento.nome;
  await carregarProdutos();
});

function esc(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}

function valorCampo(valor) {
  return valor === undefined || valor === null ? "" : String(valor);
}

function camposFaltantes(p) {
  const campos = [
    ["marca", "Marca"],
    ["categoria", "Categoria"],
    ["variante", "Sabor/variante"],
    ["embalagem", "Embalagem"],
    ["volume", "Volume/medida"],
    ["codigoBarras", "Código de barras"],
    ["precoCusto", "Preço de custo"],
    ["precoVenda", "Preço de venda"]
  ];
  return campos.filter(([chave]) =>
    p[chave] === undefined || p[chave] === null || String(p[chave]).trim() === ""
  ).map(([, rotulo]) => rotulo);
}

async function carregarProdutos() {
  container.innerHTML = '<p class="mensagem-vazio">Carregando produtos…</p>';
  try {
    const snap = await getDocs(query(
      collection(db, "produtos"),
      where("estabelecimentoId", "==", estabelecimentoAtual.id)
    ));
    produtos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR", { sensitivity: "base" }));
    atualizarResumo();
    renderizarProdutos();
  } catch (erro) {
    console.error(erro);
    container.innerHTML = '<p class="mensagem-vazio">Não foi possível carregar os produtos. Confira sua conexão e as permissões do Firestore.</p>';
    mostrarToast("Erro ao carregar os produtos.", "erro");
  }
}

function atualizarResumo() {
  const incompletos = produtos.filter(p => camposFaltantes(p).length > 0).length;
  document.getElementById("total-produtos").textContent = String(produtos.length);
  document.getElementById("total-incompletos").textContent = String(incompletos);
  document.getElementById("total-completos").textContent = String(produtos.length - incompletos);
}

function renderizarProdutos() {
  const busca = campoBusca.value.trim().toLocaleLowerCase("pt-BR");
  const somenteIncompletos = filtroIncompletos.checked;
  const filtrados = produtos.filter(p => {
    const texto = [p.nome, p.marca, p.categoria, p.variante, p.embalagem, p.volume, p.codigoBarras]
      .filter(Boolean).join(" ").toLocaleLowerCase("pt-BR");
    return texto.includes(busca) && (!somenteIncompletos || camposFaltantes(p).length > 0);
  });

  if (!filtrados.length) {
    container.innerHTML = '<p class="mensagem-vazio">' +
      (produtos.length ? "Nenhum produto corresponde aos filtros selecionados." : 'Nenhum produto cadastrado ainda. Cadastre um produto pela aba Estoque.') +
      '</p>';
    return;
  }

  container.innerHTML = "";
  filtrados.forEach(p => {
    const faltantes = camposFaltantes(p);
    const artigo = document.createElement("details");
    artigo.className = "produto-item";
    artigo.innerHTML = `
      <summary>
        <span class="produto-titulo">
          <strong>${esc(p.nome || "Produto sem nome")}</strong>
          <small>${esc([p.marca, p.volume, p.embalagem].filter(Boolean).join(" · ") || "Informações básicas pendentes")}</small>
        </span>
        <span class="produto-resumo-dados">
          ${faltantes.length
            ? '<span class="produto-status produto-status--pendente">' + faltantes.length + ' pendente(s)</span>'
            : '<span class="produto-status produto-status--completo">Completo</span>'}
        </span>
      </summary>
      <div class="produto-form">
        ${faltantes.length ? '<p class="produto-pendencias"><strong>Faltando:</strong> ' + esc(faltantes.join(", ")) + '</p>' : '<p class="produto-pendencias produto-pendencias--ok">Os campos acompanhados estão preenchidos.</p>'}
        <div class="stock-form-grid">
          <div><label>Nome do produto *</label><input type="text" class="pe-nome" value="${esc(valorCampo(p.nome))}" required /></div>
          <div><label>Marca</label><input type="text" class="pe-marca" value="${esc(valorCampo(p.marca))}" /></div>
          <div><label>Categoria</label><input type="text" class="pe-categoria" value="${esc(valorCampo(p.categoria))}" placeholder="Ex.: Refrigerante, Cerveja, Água" /></div>
          <div><label>Sabor/variante</label><input type="text" class="pe-variante" value="${esc(valorCampo(p.variante))}" placeholder="Ex.: Original, Zero, Laranja" /></div>
          <div><label>Embalagem</label><input type="text" class="pe-embalagem" value="${esc(valorCampo(p.embalagem))}" placeholder="Ex.: Lata, PET, Vidro" /></div>
          <div><label>Volume/medida</label><input type="text" class="pe-volume" value="${esc(valorCampo(p.volume))}" placeholder="Ex.: 350 ml, 2 L, 12 un." /></div>
          <div><label>Preço de custo (R$)</label><input type="number" step="0.01" min="0" class="pe-custo" value="${esc(valorCampo(p.precoCusto))}" /></div>
          <div><label>Preço de venda (R$)</label><input type="number" step="0.01" min="0" class="pe-venda" value="${esc(valorCampo(p.precoVenda))}" /></div>
          <div><label>Estoque mínimo (opcional)</label><input type="number" min="0" step="1" class="pe-minimo" value="${esc(valorCampo(p.estoqueMinimo))}" placeholder="Ex.: 12" /></div>
          <div><label>Antecedência do alerta (dias, opcional)</label><input type="number" min="0" step="1" class="pe-dias-alerta" value="${esc(valorCampo(p.diasAlerta))}" placeholder="Usar padrão se vazio" /></div>
          <div class="produto-codigo-campo"><label>Código de barras (para o Caixa)</label><input type="text" inputmode="numeric" class="pe-codigo" value="${esc(valorCampo(p.codigoBarras))}" placeholder="Escaneie ou digite o código" /></div>
        </div>
        <button type="button" class="btn btn-salvar-produto" data-id="${esc(p.id)}">Salvar alterações</button>
      </div>`;
    container.appendChild(artigo);
  });

  container.querySelectorAll(".btn-salvar-produto").forEach(btn => {
    btn.addEventListener("click", () => salvarProduto(btn));
  });
}

async function salvarProduto(btn) {
  const painel = btn.closest(".produto-form");
  const id = btn.dataset.id;
  const nome = painel.querySelector(".pe-nome").value.trim();
  if (!nome) {
    mostrarToast("O nome do produto é obrigatório.", "erro");
    painel.querySelector(".pe-nome").focus();
    return;
  }

  const ler = seletor => painel.querySelector(seletor).value.trim();
  const numeroOuNulo = valor => valor === "" ? null : Number(valor);
  const dados = {
    nome,
    marca: ler(".pe-marca"),
    categoria: ler(".pe-categoria"),
    variante: ler(".pe-variante"),
    embalagem: ler(".pe-embalagem"),
    volume: ler(".pe-volume"),
    precoCusto: numeroOuNulo(ler(".pe-custo")),
    precoVenda: numeroOuNulo(ler(".pe-venda")),
    codigoBarras: ler(".pe-codigo"),
    diasAlerta: numeroOuNulo(ler(".pe-dias-alerta")),
    estoqueMinimo: numeroOuNulo(ler(".pe-minimo"))
  };

  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Salvando…";
  try {
    await updateDoc(doc(db, "produtos", id), dados);
    // Mantém o nome do produto alinhado no documento de estoque, quando já existir.
    try {
      await updateDoc(doc(db, "estoque", id), { produtoNome: nome });
    } catch (erroEstoque) {
      // Não há documento de estoque para este produto; não impede salvar o cadastro.
    }
    const indice = produtos.findIndex(p => p.id === id);
    if (indice >= 0) produtos[indice] = { ...produtos[indice], ...dados };
    atualizarResumo();
    mostrarToast('Produto "' + nome + '" atualizado.', "ok");
    renderizarProdutos();
  } catch (erro) {
    console.error(erro);
    mostrarToast("Não foi possível salvar. Tente novamente.", "erro");
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

campoBusca.addEventListener("input", renderizarProdutos);
filtroIncompletos.addEventListener("change", renderizarProdutos);
