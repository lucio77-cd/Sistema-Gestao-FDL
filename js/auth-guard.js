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

/**
 * Garante que existe um estabelecimento para este usuário. Cria um com
 * valores padrão na primeira vez que ele loga.
 */
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

/**
 * Chame no topo de cada página administrativa. Redireciona para login.html
 * se não houver usuário autenticado, e devolve { user, estabelecimento }.
 */
export function protegerPagina(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
    const estabelecimento = await obterOuCriarEstabelecimento(user.uid);
    callback({ user, estabelecimento });
  });
}

export async function sair() {
  await signOut(auth);
  window.location.href = "login.html";
}
