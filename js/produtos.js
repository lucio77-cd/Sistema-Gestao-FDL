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


const OPCOES_CATEGORIA = ["Refrigerante", "Água", "Suco", "Cerveja", "Energético", "Isotônico", "Chá", "Laticínio", "Destilado", "Vinho", "Outro"];
const OPCOES_EMBALAGEM = ["Lata", "PET", "Vidro", "Long neck", "Garrafa", "Caixa", "Pacote", "Copo", "Sachê", "Barril", "Outra"];
const OPCOES_VOLUME = ["100 ml", "200 ml", "220 ml", "250 ml", "269 ml", "290 ml", "300 ml", "310 ml", "330 ml", "350 ml", "473 ml", "500 ml", "600 ml", "700 ml", "750 ml", "900 ml", "1 L", "1,5 L", "1,75 L", "2 L", "2,5 L", "3 L", "5 L", "10 L", "12 un.", "18 un.", "24 un."];

function opcoesSelect(valorAtual, opcoes, placeholder = "Selecione uma opção") {
  const atual = valorCampo(valorAtual);
  const lista = [...opcoes];
  if (atual && !lista.some(opcao => opcao.toLocaleLowerCase("pt-BR") === atual.toLocaleLowerCase("pt-BR"))) {
    lista.unshift(atual);
  }
  return '<option value=""' + (!atual ? " selected" : "") + '>' + esc(placeholder) + '</option>' +
    lista.map(opcao => '<option value="' + esc(opcao) + '"' +
      (opcao === atual ? " selected" : "") + '>' + esc(opcao) + '</option>').join("");
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
          <div><label>Categoria</label><select class="pe-categoria">${opcoesSelect(p.categoria, OPCOES_CATEGORIA)}</select></div>
          <div><label>Sabor/variante</label><input type="text" class="pe-variante" value="${esc(valorCampo(p.variante))}" placeholder="Ex.: Original, Zero, Laranja" /></div>
          <div><label>Embalagem</label><select class="pe-embalagem">${opcoesSelect(p.embalagem, OPCOES_EMBALAGEM)}</select></div>
          <div><label>Volume/medida</label><select class="pe-volume">${opcoesSelect(p.volume, OPCOES_VOLUME)}</select></div>
          <div><label>Preço de custo (R$)</label><input type="number" step="0.01" min="0" class="pe-custo" value="${esc(valorCampo(p.precoCusto))}" /></div>
          <div><label>Preço de venda (R$)</label><input type="number" step="0.01" min="0" class="pe-venda" value="${esc(valorCampo(p.precoVenda))}" /></div>
          <div><label>Estoque mínimo (opcional)</label><input type="number" min="0" step="1" class="pe-minimo" value="${esc(valorCampo(p.estoqueMinimo))}" placeholder="Ex.: 12" /></div>
          <div><label>Antecedência do alerta (dias, opcional)</label><input type="number" min="0" step="1" class="pe-dias-alerta" value="${esc(valorCampo(p.diasAlerta))}" placeholder="Usar padrão se vazio" /></div>
          <div class="produto-codigo-campo">
            <label>Código de barras (para o Caixa)</label>
            <input type="text" inputmode="numeric" autocomplete="off" class="pe-codigo" value="${esc(valorCampo(p.codigoBarras))}" placeholder="Escaneie ou digite o código" />
            <button type="button" class="btn-secundario btn-escanear-codigo" data-id="${esc(p.id)}">Escanear com câmera</button>
            <small class="produto-ajuda-scanner">No computador, você também pode clicar no campo e usar um leitor USB.</small>
          </div>
        </div>
        <button type="button" class="btn btn-salvar-produto" data-id="${esc(p.id)}">Salvar alterações</button>
      </div>`;
    container.appendChild(artigo);
  });

  container.querySelectorAll(".btn-salvar-produto").forEach(btn => {
    btn.addEventListener("click", () => salvarProduto(btn));
  });
  container.querySelectorAll(".btn-escanear-codigo").forEach(btn => {
    btn.addEventListener("click", () => escanearCodigo(btn));
  });
}

let leitorCodigo = null;
let controlesLeitura = null;
let modalScanner = null;
let scannerAtivo = false;
let frameScanner = null;

async function escanearCodigo(btn) {
  const painel = btn.closest(".produto-form");
  const campoCodigo = painel.querySelector(".pe-codigo");
  if (!modalScanner) {
    modalScanner = document.createElement("div");
    modalScanner.className = "modal-overlay scanner-overlay";
    modalScanner.innerHTML = `
      <section class="modal scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-titulo">
        <h2 id="scanner-titulo">Escanear código de barras</h2>
        <p id="scanner-instrucao">Centralize as barras na imagem. Evite reflexos e mantenha o código inteiro visível.</p>
        <video id="scanner-video" autoplay muted playsinline></video>
        <p id="scanner-status" class="scanner-status" role="status">Preparando câmera…</p>
        <div class="modal-acoes">
          <button type="button" class="btn-secundario" id="scanner-fechar">Cancelar</button>
        </div>
      </section>`;
    document.body.appendChild(modalScanner);
    modalScanner.querySelector("#scanner-fechar").addEventListener("click", fecharScanner);
    modalScanner.addEventListener("click", evento => {
      if (evento.target === modalScanner) fecharScanner();
    });
  }

  const video = modalScanner.querySelector("#scanner-video");
  const status = modalScanner.querySelector("#scanner-status");
  modalScanner.hidden = false;
  status.textContent = "Abrindo câmera traseira…";
  btn.disabled = true;

  try {
    // Usa o detector nativo do navegador quando disponível; evita carregar uma
    // biblioteca pesada e costuma responder mais rápido em celulares compatíveis.
    if ("BarcodeDetector" in window) {
      const formatosSuportados = await BarcodeDetector.getSupportedFormats();
      const formatosDesejados = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "itf"];
      const formatos = formatosDesejados.filter(formato => formatosSuportados.includes(formato));
      if (!formatos.length) throw new Error("O navegador não oferece formatos compatíveis.");

      const detector = new BarcodeDetector({ formats: formatos });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      video.srcObject = stream;
      await video.play();
      scannerAtivo = true;
      status.textContent = "Câmera ativa. Centralize o código de barras.";

      const procurar = async () => {
        if (!scannerAtivo || modalScanner.hidden) return;
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            const resultados = await detector.detect(video);
            if (resultados.length && resultados[0].rawValue) {
              concluirLeitura(resultados[0].rawValue, campoCodigo);
              return;
            }
          } catch (erro) {
            console.warn("Falha temporária ao analisar a imagem:", erro);
          }
        }
        if (scannerAtivo) frameScanner = requestAnimationFrame(procurar);
      };
      frameScanner = requestAnimationFrame(procurar);
    } else {
      // Compatibilidade com navegadores sem BarcodeDetector nativo.
      const { BrowserMultiFormatReader } = await import("https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/+esm");
      leitorCodigo = new BrowserMultiFormatReader();
      controlesLeitura = await leitorCodigo.decodeFromConstraints(
        {
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        },
        video,
        (resultado, erro) => {
          if (resultado) {
            concluirLeitura(resultado.getText(), campoCodigo);
          } else if (erro && erro.name !== "NotFoundException") {
            status.textContent = "Ajuste a distância e mantenha o código inteiro visível.";
          }
        }
      );
      status.textContent = "Câmera ativa. Centralize o código de barras.";
    }
  } catch (erro) {
    console.error("Erro no scanner:", erro);
    status.textContent = erro.name === "NotAllowedError"
      ? "Permita o acesso à câmera nas configurações do navegador."
      : location.protocol !== "https:" && location.hostname !== "localhost"
        ? "A câmera exige que o sistema esteja publicado em HTTPS."
        : "Não foi possível iniciar a leitura. Feche e tente novamente.";
    mostrarToast("Não foi possível iniciar a leitura do código.", "erro");
  } finally {
    btn.disabled = false;
  }
}

function concluirLeitura(codigo, campoCodigo) {
  if (!codigo || !scannerAtivo && !controlesLeitura) return;
  campoCodigo.value = codigo;
  campoCodigo.dispatchEvent(new Event("input", { bubbles: true }));
  fecharScanner();
  campoCodigo.focus();
  mostrarToast("Código lido. Clique em Salvar alterações para gravar.", "ok");
}

function fecharScanner() {
  scannerAtivo = false;
  if (frameScanner !== null) {
    cancelAnimationFrame(frameScanner);
    frameScanner = null;
  }
  if (controlesLeitura) {
    try { controlesLeitura.stop(); } catch (erro) { console.warn(erro); }
    controlesLeitura = null;
  }
  if (leitorCodigo) {
    try { leitorCodigo.reset(); } catch (erro) { console.warn(erro); }
    leitorCodigo = null;
  }
  if (modalScanner) {
    const video = modalScanner.querySelector("#scanner-video");
    if (video.srcObject) {
      video.srcObject.getTracks().forEach(trilha => trilha.stop());
      video.srcObject = null;
    }
    video.pause();
    modalScanner.hidden = true;
  }
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
