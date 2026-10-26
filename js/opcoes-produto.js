// Listas e regras compartilhadas de categoria, embalagem e volume.
// Usadas no cadastro (telas Estoque e Produtos) e no filtro da lista do WhatsApp.
// Para acrescentar uma opção nova, basta editar as listas abaixo.

export const OPCOES_CATEGORIA = [
  "Refrigerante", "Água", "Suco", "Cerveja", "Energético",
  "Isotônico", "Chá", "Laticínio", "Destilado", "Vinho", "Outro"
];

export const OPCOES_EMBALAGEM = [
  "Lata", "PET", "Vidro", "Long neck", "Garrafa",
  "Caixa", "Pacote", "Copo", "Sachê", "Barril", "Outra"
];

export const OPCOES_VOLUME = [
  "100 ml", "200 ml", "220 ml", "250 ml", "269 ml", "290 ml", "300 ml",
  "310 ml", "330 ml", "350 ml", "473 ml", "500 ml", "600 ml", "700 ml",
  "750 ml", "900 ml", "1 L", "1,5 L", "1,75 L", "2 L", "2,5 L", "3 L",
  "5 L", "10 L", "12 un.", "18 un.", "24 un."
];

// Chave usada para produtos que não têm categoria/embalagem preenchida.
export const CHAVE_SEM_VALOR = "__sem_valor__";

// Chave de comparação: ignora maiúsculas, minúsculas, acentos e espaços nas pontas.
// Assim "suco", "Suco" e "SUCO" são tratados como o mesmo tipo.
export function chaveOpcao(valor) {
  return String(valor ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

// Devolve o nome "oficial" da lista quando o valor corresponde a uma opção
// (ex.: "suco" vira "Suco"); caso contrário mantém o texto original.
export function rotuloPadronizado(valor, opcoes) {
  const texto = String(valor ?? "").trim();
  if (!texto) return "";
  const chave = chaveOpcao(texto);
  return opcoes.find((opcao) => chaveOpcao(opcao) === chave) || texto;
}
