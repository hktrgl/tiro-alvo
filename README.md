# Tiro ao Alvo Premiado · Dash Skins

Campanha interativa inspirada no visual da Dash Skins. Interface React + TypeScript, Vite, API Node.js e artes SVG originais. Fontes e imagens são servidas localmente.

Para testar no seu computador depois de receber e extrair os arquivos, instale o Node.js 24+, abra um terminal na pasta do projeto e execute:

```bash
npm ci
npm run local
```

O segundo comando prepara a interface, inicia o servidor local e abre o navegador automaticamente. Funciona em Windows, macOS e Linux; mantenha o terminal aberto e use `Ctrl+C` para encerrar. Ele escuta somente no próprio computador. Se o navegador não abrir sozinho, o endereço aparece no terminal. Para editar com atualização automática, use `npm run dev` conforme as instruções abaixo.

**Windows:** depois de instalar o Node.js 24+, extraia o projeto inteiro e dê dois cliques em `INICIAR-WINDOWS.bat`. Ele instala as dependências, prepara o jogo e solicita a abertura do navegador. Deixe a janela aberta enquanto joga. Esse atalho foi preparado para Windows; a execução completa foi validada em Linux, sem teste em uma máquina Windows nesta tarefa.

## Testar no seu computador

Funciona em **Windows, macOS e Linux**, com **Node.js 24 ou superior** e npm. Não requer hospedagem, banco externo, chaves ou serviços de pagamento.

Primeiro, transfira a pasta do projeto deste ambiente na nuvem para seu computador, incluindo `package.json`, `package-lock.json`, `src`, `server`, `public` e as configurações da raiz. Não é necessário copiar `node_modules`, `dist` ou `.data`. O código desta sessão ainda não foi publicado no GitHub; clonar o repositório vazio não entrega esta implementação.

Abra um terminal dentro da pasta `tiro-alvo` no seu computador e execute:

```bash
npm ci
npm run dev
```

Com o terminal aberto, acesse `http://localhost:5173` no navegador **do mesmo computador**. Esse endereço só funciona depois de iniciar o projeto na sua máquina; ele não dá acesso à aplicação que está na nuvem. Use `Ctrl+C` no terminal para encerrar.

O Vite usa a porta **5173** e encaminha `/api` para o servidor Node na porta **3001**. O comando `npm run dev` inicia os dois.

## Executar no ambiente na nuvem

O caminho `/workspace/tiro-alvo` pertence à máquina na nuvem, não ao seu computador pessoal.

```bash
cd /workspace/tiro-alvo
npm ci
npm run dev
```

Os processos precisam ser iniciados novamente após restaurar o ambiente; o estado salvo não depende deles permanecerem vivos. Os endereços locais da nuvem não são links públicos para acessar pelo seu computador.

Use o checkout existente. As tarefas na nuvem já são isoladas; não crie um Git worktree adicional sem solicitação explícita.

## O que funciona

- 3 tiros iniciais de demonstração; disparos por clique, toque ou Enter/espaço na arena.
- Animação da arma, mira estilo CS, som opcional e revelação de recompensa.
- Depósitos **simulados**: cada R$ 100 acumulados gera 3 tiros. Valores parciais acumulam em centavos.
- Resultado sorteado no servidor usando `node:crypto`, independente da posição escolhida.
- Inventário, últimos tiros, regulamento e histórico dos últimos 100 disparos.
- Operações idempotentes: repetir a mesma requisição não duplica tiros ou recompensas.
- Layout adaptado para celular, diálogos com foco contido, navegação por teclado e preferência de movimento reduzido.

| Recompensa | Chance por tiro | Valor na demonstração |
| --- | ---: | --- |
| Gift card | 2% | R$ 10 em créditos simulados |
| Cupom | 3% | 5% de bônus simulado |
| Chaveiro | 10% | Item ilustrativo, sem entrega Steam |
| Destaques | 25% | 3 destaques simulados |
| Consolação | 60% | 1 destaque simulado |

O valor de R$ 10 do gift card e o cupom de 5% são escolhas desta demonstração. Antes da campanha real, alinhar catálogo, valores, limites e integrações com a plataforma.

## Validar

```bash
npm run build
npm test
```

Os testes unitários conferem todas as 10.000 posições dos intervalos de sorteio, crédito de prêmios, centavos, estoque, idempotência e limite do histórico. Os testes HTTP sobem servidores temporários e verificam API, persistência após reinício, validação de entradas, origem e serviço estático de produção. Rode o build antes para também executar o teste dos arquivos de produção. No ambiente gerenciado, autorize a execução com acesso a sockets locais quando o sandbox impedir os testes HTTP.

Também foram verificados no Chromium: 3 disparos, tiro por teclado, arsenal vazio, recarga de R$ 99,99 + R$ 0,01, persistência ao recarregar, inventário, regulamento, menu mobile e ausência de rolagem horizontal em 360, 390, 768 e 1440 px.

## Executar a build de produção

```bash
npm ci
npm run build
npm start
```

Na sua máquina, abra `http://localhost:3001` após iniciar. Esses comandos também funcionam no PowerShell do Windows. Um único processo Node serve a interface e a API. Para hospedagem, use um serviço Node 24 com HTTPS e diretório persistente; configure `HOST=0.0.0.0`, `PORT` conforme o provedor e `DATA_DIR` para o volume persistente. Não é um site apenas estático: não publique somente `dist`, pois o sorteio e a persistência dependem da API. A aplicação não foi implantada em um domínio público nesta tarefa.

| Variável | Padrão | Uso |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Endereço de escuta do Node |
| `PORT` | `3001` | Porta do Node |
| `NODE_ENV` | desenvolvimento | `production` habilita o serviço de `dist` |
| `DATA_DIR` | `.data` no projeto | Diretório de persistência |

## Estado e integração real

O arquivo ignorado `.data/state.json` guarda o progresso da demonstração com gravação atômica. **A demonstração usa um único jogador compartilhado por todos os visitantes da instância.** Não execute várias réplicas apontando para o mesmo arquivo. Preserve o volume para manter o progresso em uma hospedagem.

Depósitos, saldo, skins e benefícios não têm valor real. Os CTAs não processam pagamentos. Para integrar à Dash, faltam autenticação por usuário, banco transacional, confirmação de depósitos via webhook, catálogo real de prêmios e emissão/resgate dos benefícios. Os tiros devem ser creditados por pagamentos confirmados no servidor; o endpoint de simulação não deve ser usado como depósito real.

Os arquivos `public/arena.svg` e `public/pixel-rifle.svg` são ilustrações originais e podem ser substituídos pelo print do mapa e pela arma final fornecidos pela marca, mantendo os mesmos caminhos.

## Organização

- `src/App.tsx`: experiência da campanha e diálogos.
- `src/api.ts`: contrato tipado da API.
- `src/styles.css`: identidade visual e responsividade.
- `server/game.mjs`: transações e probabilidades.
- `server/index.mjs`: HTTP, persistência e arquivos estáticos.
- `server/*.test.mjs`: testes unitários e HTTP.
