import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  addDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

function gerarToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function obterOuCriarEstabelecimento(uid) {
  const ref = collection(db, "estabelecimentos");
  const q = query(ref, where("ownerId", "==", uid), limit(1));
  const snap = await getDocs(q);

  if (!snap.empty) {
    const doc = snap.docs[0];
    return { id: doc.id, ...doc.data() };
  }

  const novo = {
    ownerId: uid,
    nome: "Meu estabelecimento",
    diasAlertaPadrao: 3,
    linkToken: gerarToken(),
    ultimaVistoria: null,
  };
  const criado = await addDoc(ref, novo);
  return { id: criado.id, ...novo };
}

export function protegerPagina(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      const destino = `${window.location.pathname}${window.location.search}`;
      window.location.href = `login.html?returnTo=${encodeURIComponent(destino)}`;
      return;
    }
    try {
      const estabelecimento = await obterOuCriarEstabelecimento(user.uid);
      await callback({ user, estabelecimento });
    } catch (erro) {
      console.error("Falha ao carregar a página:", erro);
      mostrarErroCarregamento(erro);
    }
  });
}

function mostrarErroCarregamento(erro) {
  const main = document.querySelector("main");
  if (!main) return;
  const div = document.createElement("div");
  div.className = "painel";
  div.style.borderColor = "var(--vencido)";
  div.innerHTML = `
    <h2 style="margin-top:0; color:var(--vencido)">Não foi possível carregar</h2>
    <p class="legenda" style="margin-bottom:0.4rem">Detalhe técnico (pra copiar e me mandar):</p>
    <div class="rodape-token">${(erro && erro.message) || String(erro)}</div>
  `;
  main.prepend(div);
}

export async function sair() {
  await signOut(auth);
  window.location.href = "login.html";
}
