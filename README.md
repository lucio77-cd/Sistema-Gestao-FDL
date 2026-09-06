# Sistema de Gestão de Bebidas & Produção (Padaria)

Sistema novo, separado do Sistema Cris. Composto por dois módulos independentes que compartilham o mesmo "motor" de vencimento/alerta, mas com dados e telas próprias.

---

## 1. Visão Geral

- **Módulo Bebidas**: genérico, pensado para ser usado em múltiplos estabelecimentos (não só a padaria). Controla estoque de bebidas por lote, com foco em evitar vencimento.
- **Módulo Padaria**: separado, cuida de fabricação, vencimento, receitas e custo de produção dos produtos de padaria (pães, doces etc).
- Os dois módulos moram no mesmo sistema/projeto, mas têm coleções e páginas independentes entre si.

---

## 2. Contexto e Restrições Reais (por que o sistema é do jeito que é)

- A padaria usa um sistema que **só emite nota fiscal e recebe pagamento** — não há baixa de estoque na venda (sem registro de saída).
- Não há adesão da equipe/gerência a ferramentas novas (ambiente resistente a mudança). O sistema não pode depender de terceiros alimentando dados.
- Uso real: o **operador principal é o próprio dono do projeto**, que faz vistorias físicas periódicas na geladeira/estoque.
- A gerente pode ou não vir a usar uma tela de visualização — o sistema não deve depender disso para funcionar.

**Regra de arquitetura decorrente**: o sistema deve funcionar por **snapshot (vistoria manual)**, e não por livro-razão transacional (entrada/saída). Deve, porém, ser desenhado de forma que uma futura integração com um sistema que registre saída (PDV de verdade) possa alimentar o mesmo núcleo de dados como uma fonte de eventos alternativa/plugin — sem reescrever a lógica central de vencimento e alerta.

---

## 3. Módulo Bebidas

### 3.1 Conceito de dados
- Controle por **lote**, não só por produto (lotes diferentes do mesmo produto podem ter vencimentos diferentes).
- **Vistoria** = snapshot manual: registra o que foi observado fisicamente em determinado momento (produto, lote, quantidade, local).
- Comparação entre vistorias sucessivas indica o que sumiu (assumido como vendido ou perdido, sem diferenciar automaticamente — limitação conhecida do modo manual).

### 3.2 Regras de negócio
- Cada lote tem: produto, quantidade, data de vencimento, local (geladeira/estoque seco), preço de custo, preço de venda.
- Cada lote é classificado em: **normal / atenção / vencido / promoção**, com base na configuração de antecedência de alerta.
- A antecedência de alerta ("avisar X dias antes do vencimento") é configurável — pensar se é global ou por categoria/produto, já que produtos têm giro diferente.
- Lotes que entram na janela de alerta podem ser marcados como **promoção**, com preço promocional associado.

### 3.3 Telas
1. **Dashboard**: gráfico (linha do tempo dos próximos N dias) + tabela (lotes em atenção/vencidos, ordenados por dias restantes, com valor em risco).
2. **Vistoria**: tela de registro rápido para lançar quantidades observadas por produto/lote.
3. **Promoções**: lotes marcados com preço promocional.
4. **Configurações**: dias de antecedência do alerta.
5. **Visão da gerente**: somente leitura, acesso via link direto com token na URL (sem login tradicional) — ver seção 5.

---

## 4. Módulo Padaria (fabricação, vencimento e custo)

### 4.1 Conceito de dados
- **Produção**: registro de lotes fabricados (produto, data de fabricação, data de vencimento, quantidade).
- **Perda**: baixa registrada no dia do vencimento do que sobrou (não vendido).
- **Receita**: produto final associado a uma lista de ingredientes e suas quantidades.
- **Ingrediente**: nome e custo unitário.

### 4.2 Regras de negócio
- O custo de produção de um lote é calculado somando o custo dos ingredientes da receita, proporcional à quantidade produzida.
- O cruzamento de produção x perda ao longo do tempo permite sugerir quantidade ideal de produção por produto/dia da semana, para reduzir desperdício.
- O relatório de desperdício deve expressar a perda tanto em quantidade quanto em valor (R$), usando o custo de produção calculado.

### 4.3 Telas
1. **Receitas**: cadastro de receita + ingredientes.
2. **Produção**: registro de lotes fabricados.
3. **Perdas/Vencimento**: baixa no dia do vencimento.
4. **Custo & Desperdício**: relatório cruzando produção, perda e custo.

---

## 5. Autenticação e Permissões

- **MVP**: um único usuário admin (o dono do projeto) com acesso total via login padrão (Firebase Auth).
- **Acesso da gerente (opcional)**: link direto e isolado, tipo `/vencimentos/{token}`, sem navegação para o resto do sistema, somente leitura. Token aleatório salvo no documento do estabelecimento (`estabelecimentos/{id}.linkToken`), validado via regra do Firestore — não exige Auth tradicional.
- **Não implementar agora**: sistema de múltiplos papéis (`usuarios/{uid}` com `role` e `estabelecimentoId`) e distinção admin/visualizador/super-admin. Isso fica desenhado para ativação futura, caso o sistema passe a ser usado por outros estabelecimentos com equipes reais.

---

## 6. Modelo de Dados (Firestore — rascunho de coleções)

**Módulo Bebidas**
- `estabelecimentos` — dados do estabelecimento, incluindo `linkToken`
- `produtos` — bebidas cadastradas (nome, categoria, custo, preço, `estabelecimentoId`)
- `lotes` — `produtoId`, quantidade, data de vencimento, local, status
- `vistorias` — histórico de snapshots (data, itens observados)
- `configuracoes` — dias de antecedência de alerta (global ou por categoria)
- `promocoes` — lotes marcados, preço promocional, data de início

**Módulo Padaria**
- `receitas` — produto final + ingredientes/quantidades
- `ingredientes` — nome, custo unitário
- `producoes` — lotes fabricados (data de fabricação, vencimento, quantidade)
- `perdas` — baixas no vencimento, ligadas à produção correspondente

---

## 7. Fora de Escopo (por enquanto)

- Login/role completo para múltiplos usuários e estabelecimentos.
- Integração automática com sistema de saída/PDV (arquitetura deve permitir, mas não será implementada agora).
- Previsão automática de produção (começa como relatório manual de comparação histórica, não como algoritmo automático).
