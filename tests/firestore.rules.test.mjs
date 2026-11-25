import { readFileSync } from "node:fs";
import {
  after, afterEach, before, beforeEach, describe, it
} from "node:test";
import {
  assertFails, assertSucceeds, initializeTestEnvironment
} from "@firebase/rules-unit-testing";
import {
  Timestamp, collection, deleteDoc, doc, getDoc, getDocs,
  query, setDoc, updateDoc, where
} from "firebase/firestore";

const PROJECT_ID = "demo-fdl-rules";
let testEnv;

const estabelecimentoA = {
  id: "estabelecimento-a",
  ownerId: "usuario-a",
  nome: "Estabelecimento A"
};
const estabelecimentoB = {
  id: "estabelecimento-b",
  ownerId: "usuario-b",
  nome: "Estabelecimento B"
};

function usuarioA() {
  return testEnv.authenticatedContext("usuario-a").firestore();
}

function usuarioB() {
  return testEnv.authenticatedContext("usuario-b").firestore();
}

async function prepararDadosBase() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "estabelecimentos", estabelecimentoA.id), estabelecimentoA);
    await setDoc(doc(db, "estabelecimentos", estabelecimentoB.id), estabelecimentoB);
    await setDoc(doc(db, "produtos", "produto-a"), {
      estabelecimentoId: estabelecimentoA.id,
      nome: "Produto A",
      ativo: true
    });
    await setDoc(doc(db, "produtos", "produto-b"), {
      estabelecimentoId: estabelecimentoB.id,
      nome: "Produto B",
      ativo: true
    });
  });
}

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: readFileSync("firestore.rules", "utf8") }
  });
});

beforeEach(async () => {
  await prepararDadosBase();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

after(async () => {
  await testEnv.cleanup();
});

describe("isolamento por estabelecimento", () => {
  it("permite ao proprietário ler seus próprios dados", async () => {
    const db = usuarioA();
    await assertSucceeds(getDoc(doc(db, "produtos", "produto-a")));
    await assertSucceeds(getDoc(doc(db, "estabelecimentos", estabelecimentoA.id)));
  });

  it("impede leitura de dados de outro estabelecimento", async () => {
    const db = usuarioA();
    await assertFails(getDoc(doc(db, "produtos", "produto-b")));
    await assertFails(getDoc(doc(db, "estabelecimentos", estabelecimentoB.id)));
  });

  it("exige filtro de estabelecimento nas consultas de coleção", async () => {
    const db = usuarioA();
    await assertSucceeds(getDocs(query(
      collection(db, "produtos"),
      where("estabelecimentoId", "==", estabelecimentoA.id)
    )));
    await assertFails(getDocs(collection(db, "produtos")));
  });

  it("impede criar produto em nome de outro estabelecimento", async () => {
    const db = usuarioA();
    await assertFails(setDoc(doc(db, "produtos", "produto-invasor"), {
      estabelecimentoId: estabelecimentoB.id,
      nome: "Produto indevido",
      ativo: true
    }));
  });

  it("impede transferir um documento para outro estabelecimento", async () => {
    const db = usuarioA();
    await assertFails(updateDoc(doc(db, "produtos", "produto-a"), {
      estabelecimentoId: estabelecimentoB.id
    }));
  });
});

describe("livro imutável de movimentos do estoque", () => {
  function movimento(estabelecimentoId, produtoId) {
    return {
      estabelecimentoId,
      produtoId,
      produtoNome: "Produto",
      local: "geladeira",
      tipo: "entrada",
      quantidade: 4,
      delta: 4,
      origem: "teste-automatizado",
      registradoEm: Timestamp.now()
    };
  }

  it("permite registrar movimento válido de produto do próprio estabelecimento", async () => {
    const db = usuarioA();
    await assertSucceeds(setDoc(
      doc(db, "movimentosEstoque", "movimento-a"),
      movimento(estabelecimentoA.id, "produto-a")
    ));
  });

  it("impede vincular movimento a produto de outro estabelecimento", async () => {
    const db = usuarioA();
    await assertFails(setDoc(
      doc(db, "movimentosEstoque", "movimento-cruzado"),
      movimento(estabelecimentoA.id, "produto-b")
    ));
  });

  it("não permite alterar nem apagar movimentos já registrados", async () => {
    const db = usuarioA();
    const ref = doc(db, "movimentosEstoque", "movimento-imutavel");
    await assertSucceeds(setDoc(ref, movimento(estabelecimentoA.id, "produto-a")));
    await assertFails(updateDoc(ref, { delta: -4 }));
    await assertFails(deleteDoc(ref));
  });

  it("impede usuário de outro estabelecimento de ler o movimento", async () => {
    const dbA = usuarioA();
    const dbB = usuarioB();
    await assertSucceeds(setDoc(
      doc(dbA, "movimentosEstoque", "movimento-privado"),
      movimento(estabelecimentoA.id, "produto-a")
    ));
    await assertFails(getDoc(doc(dbB, "movimentosEstoque", "movimento-privado")));
  });
});
