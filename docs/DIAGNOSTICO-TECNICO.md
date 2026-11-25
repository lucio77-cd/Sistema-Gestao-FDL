# Diagnóstico técnico e plano de evolução — FDL

**Baseline consultada:** branch `main`, commit `bfa2d5210407d70de80e6bbb545764a41c7fa6cc` (25/11/2026).  
**Escopo:** inspeção do repositório. Não representa validação de produção, teste com dados reais ou auditoria completa do projeto Firebase/Vercel.

## 1. Arquitetura observada

- Frontend estático composto por páginas HTML, folhas CSS e módulos JavaScript nativos.
- Os módulos JavaScript ficam em `js/` e importam o SDK Firebase 10.12.2 por CDN.
- Firebase Authentication identifica o usuário.
- `js/auth-guard.js` localiza o estabelecimento pelo campo `ownerId`; interrompe o carregamento se não encontrar exatamente um vínculo.
- Cloud Firestore armazena os dados operacionais e aplica as regras versionadas em `firestore.rules`.
- O repositório não contém `package.json`, lockfile ou suíte de testes automatizados no baseline consultado.
- A aplicação estática declara o domínio de produção no campo homepage do repositório; o acesso administrativo à equipe Vercel ainda precisa ser autorizado para conferir projeto, ambientes e deploys.

## 2. Inventário funcional observado

Páginas HTML encontradas na raiz:

- Início (`index.html`), login e visão da gerente.
- Estoque, vistoria, produtos, movimentações e perdas.
- Caixa, promoções e validade de produtos industrializados.
- Cozinha, gráficos e configurações.

Módulos JavaScript encontrados em `js/` incluem autenticação, navegação, dashboard, estoque, saldos, vistorias, movimentações, perdas, produtos, promoções, validade de industrializados, cozinha, Caixa, gráficos, configurações, tema, modal, toast e status.

## 3. Correção aplicada nesta evolução

Em `js/configuracoes.js`, o listener de ativação do Caixa tentava reabilitar uma variável `botao` que não existia naquele escopo. O controle agora é obtido pelo próprio evento (`currentTarget`), desabilitado durante a gravação e reabilitado no `finally`. Em caso de falha, o estado visual do controle é revertido.

## 4. Verificações automatizadas adicionadas

O workflow `.github/workflows/quality.yml` executa em pushes e pull requests direcionados à `main`. O script `scripts/check-project.mjs`:

1. verifica a sintaxe de todos os arquivos `.js` em `js/` usando o parser do Node.js em modo ESM;
2. verifica referências locais de scripts e folhas de estilo declaradas nas páginas HTML da raiz.

**Limites:** essas verificações não substituem testes de navegador, testes unitários de regras de negócio, Firebase Emulator Suite, validação de regras Firestore ou testes integrados com dados de homologação. O workflow precisa concluir ao menos uma execução para que seu resultado seja considerado comprovado.

## 5. Riscos e decisões pendentes

### Prioridade crítica — integridade operacional

- Documentar a fonte de verdade para saldo por local, saldo consolidado e quantidades por lote.
- Testar concorrência e idempotência das baixas do Caixa, especialmente leitura repetida de código de barras e falhas de rede.
- Definir explicitamente a diferença entre leitura/baixa de estoque e fechamento financeiro de uma venda. Não assumir que o Caixa atual realiza recebimento ou conciliação de pagamentos.
- Garantir que vistorias, ajustes, perdas e vendas produzam histórico coerente sem duplicar movimentações.
- Validar que lotes de industrializados em `docesValidade` não sejam somados duas vezes aos saldos gerais.

### Prioridade alta — segurança

- Testar as regras Firestore com usuários autenticados, UID sem estabelecimento, UID com vínculo duplicado e tentativas de acesso cruzado entre estabelecimentos.
- Revisar cada coleção e cada operação permitida, incluindo campos imutáveis e validação de tipos/limites.
- Verificar se as consultas do cliente são compatíveis com as regras; regras Firestore não funcionam como filtros.
- A chave de configuração do Firebase presente no frontend é identificador de cliente, não deve ser tratada como segredo. A proteção depende de Authentication, regras, restrições e configuração do projeto.
- Não alterar nem publicar regras Firestore sem executar testes e confirmar o projeto Firebase de destino.

### Prioridade alta — entrega e operação

- Confirmar vínculo GitHub–Vercel, projeto correto, domínios, variáveis de ambiente e histórico de deploys.
- Criar ambiente de homologação separado da produção.
- Proteger a branch principal e exigir verificações de qualidade depois de validar o workflow.
- Criar rotina de backup/exportação e procedimento documentado de restauração.
- Implantar observabilidade de erros do frontend e falhas operacionais, sem registrar dados pessoais ou credenciais nos logs.

### Prioridade média — manutenção

- Atualizar o README, que ainda descreve módulos e fluxos que não correspondem integralmente às páginas e módulos atualmente encontrados.
- Formalizar contratos de dados e nomes de coleções/campos.
- Separar funções de domínio reutilizáveis de manipulação de DOM e acesso ao Firestore, gradualmente e com testes.
- Padronizar estados de carregamento, erro, vazio, confirmação e acessibilidade nas páginas.
- Adicionar testes automatizados para cálculos de estoque, vencimento, filtros, totais e transições de vistoria.

## 6. Sequência recomendada de evolução

1. Concluir inventário de coleções, campos, consultas e operações Firestore.
2. Criar testes de regras com Firebase Emulator Suite e casos de isolamento por estabelecimento.
3. Criar testes unitários para as regras de domínio sem alterar dados reais.
4. Auditar e estabilizar os fluxos de vistoria, lote, saldo, perdas e Caixa.
5. Confirmar homologação e pipeline de publicação na Vercel.
6. Modularizar progressivamente e atualizar documentação e interface.
7. Habilitar proteção da `main` após o pipeline estar comprovadamente verde.

## 7. Política de segurança desta evolução

- Não executar migração ou exclusão de dados.
- Não alterar regras publicadas do Firebase sem validação específica.
- Não criar documentos de saldo automaticamente nem recalcular estoque real sem reconciliação.
- Não afirmar que um deploy foi publicado sem confirmação da Vercel.
- Manter commits pequenos e reversíveis, com validação após cada etapa.
