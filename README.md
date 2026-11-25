# Sistema de Gestão FDL

Sistema web de apoio à gestão operacional de estoque e produção, com foco no uso prático da padaria e no controle físico realizado por vistorias.

> **Documentação técnica atual:** consulte [docs/DIAGNOSTICO-TECNICO.md](docs/DIAGNOSTICO-TECNICO.md) para a arquitetura observada, inventário, riscos e plano de profissionalização. Este README substitui a descrição histórica anterior, que já não correspondia às telas e módulos existentes no repositório.

## Visão geral

O projeto é uma aplicação web estática construída com HTML, CSS e JavaScript nativo (ES modules). Firebase Authentication controla o acesso e Cloud Firestore armazena os dados operacionais. A hospedagem é integrada ao repositório GitHub por meio da Vercel; o estado dessa integração deve ser conferido no painel da equipe.

## Áreas funcionais

| Área | Página |
|---|---|
| Início e indicadores | `index.html` |
| Estoque | `estoque.html` |
| Vistoria | `vistoria.html` |
| Produtos | `produtos.html` |
| Movimentações | `movimentacoes.html` |
| Perdas | `perdas.html` |
| Caixa e leitura de código de barras | `caixa.html` |
| Promoções | `promocoes.html` |
| Validade de industrializados | `validade-doces.html` |
| Cozinha | `cozinha.html` |
| Gráficos | `graficos.html` |
| Configurações e aparência | `configuracoes.html` |
| Visão da gerente | `gerente.html` |
| Autenticação | `login.html` |

## Estrutura do repositório

- `*.html`: páginas da aplicação.
- `css/`: estilos compartilhados, tema escuro e estilos específicos.
- `js/`: módulos de interface, autenticação, navegação e operações.
- `firestore.rules`: regras versionadas de segurança do Firestore.
- `.github/workflows/`: verificações automatizadas do GitHub Actions.
- `scripts/`: verificações locais executadas pelo pipeline.
- `docs/`: documentação de arquitetura, riscos e evolução.

## Modelo operacional

O controle físico por vistoria é uma parte central do funcionamento do sistema. A evolução deve preservar a reconciliação entre quantidades por local, lotes e saldo consolidado. O Caixa possui um fluxo experimental de leitura de código de barras com baixa de estoque; isso não deve ser confundido com fechamento financeiro, recebimento ou conciliação de pagamentos.

Industrializados com validade própria possuem uma área de controle específica. Relatórios e indicadores precisam distinguir esse controle dos saldos gerais para evitar dupla contagem.

## Desenvolvimento e qualidade

Não há etapa de build de frontend no baseline atual. Os módulos JavaScript são carregados diretamente pelo navegador.

O workflow **Qualidade do projeto** roda em push e pull request direcionados à `main`. Ele verifica:

1. sintaxe dos módulos JavaScript em modo ES;
2. existência de arquivos locais referenciados por scripts e folhas de estilo nas páginas HTML.

Para executar a mesma verificação localmente, com Node.js 22 ou compatível:

```bash
node scripts/check-project.mjs
```

Essas verificações são uma primeira barreira de qualidade, não substituem testes funcionais, testes das regras Firestore ou testes com o Firebase Emulator Suite.

## Segurança e dados

- O acesso às páginas autenticadas é protegido por Firebase Authentication.
- O estabelecimento é localizado pelo vínculo `ownerId` do usuário autenticado.
- As regras Firestore devem permanecer alinhadas às consultas e operações feitas pelo frontend.
- A configuração cliente do Firebase é pública por natureza; a proteção dos dados depende das regras, autenticação e restrições adequadas do projeto.
- Não executar migrações, exclusões ou ajustes de saldo sem plano de reconciliação e validação.
- Não publicar regras Firestore sem testes e confirmação do projeto de destino.

## Evolução

A sequência técnica recomendada está em [docs/DIAGNOSTICO-TECNICO.md](docs/DIAGNOSTICO-TECNICO.md). A prioridade é comprovar integridade dos saldos e lotes, segurança por estabelecimento, confiabilidade do Caixa e capacidade de validar mudanças antes da publicação.
