# Arquitetura Técnica — MVP Buscador de Alocação de Consultoras
**Cia de Talentos · Área de Carreira e Desenvolvimento**
*Versão 1.0 — Junho 2026*

---

## 0. Nota sobre o código atual

O campo `[Cole o código aqui]` chegou vazio. Este documento trata o projeto como greenfield. Quando o código for compartilhado, um diagnóstico específico (o que aproveitar, o que refatorar, riscos) será adicionado como adendo.

---

## 1. Diagnóstico do Ponto de Partida

### O que o briefing deixa claro
- O processo atual é 100% manual, por mensagem e consulta de agenda individual.
- Já existe uma base de dados relevante: Excel/SharePoint com heatmap consultora × skill (nota 0–3).
- Há credenciais do Microsoft Graph disponíveis (`SP_TENANT_ID`, `SP_CLIENT_ID`, `SP_CLIENT_SECRET`).
- A liderança tem clareza sobre as regras de negócio (nota mínima 2, prioridade 3 > 2, até 3 opções).

### Riscos do estado atual (sem código)

| Risco | Impacto | Mitigação no MVP |
|---|---|---|
| Excel como única fonte de verdade | Alto — dados desatualizados, sem versionamento | Importar para Supabase via `/sync/consultoras` |
| Processo de aceite por texto livre | Alto — sem auditoria, sem automação | Adaptive Cards ou link tokenizado |
| Ausência de registro histórico | Alto — sem rastreabilidade de tentativas | Tabela `historico_status` + `notificacoes` |
| Exposição de agenda das consultoras | Médio — LGPD | Usar apenas `getSchedule` (free/busy) |

---

## 2. Arquitetura Recomendada

### Decisão: Opção 2 — Produto interno flexível

**Recomendação:** **Node.js/TypeScript + Supabase (Postgres) + Microsoft Graph**, com notificação por Teams (Adaptive Cards) no MVP, com fallback para e-mail via Graph.

#### Por que não Opção 1 (Power Platform)?

| Critério | Opção 1 (Power Platform) | Opção 2 (Node + Supabase) |
|---|---|---|
| Velocidade de MVP | Média — Power Automate tem curva em fluxos complexos | **Alta** — código explícito, testável |
| Flexibilidade de regras | Baixa — lógica condicional em fluxos visuais é frágil | **Alta** — código limpo |
| Versionamento/auditoria | Difícil sem DevOps dedicado | **Simples** — Git + migrations |
| Custo | Licenças Power Platform (Premium) | **Supabase free/pro, sem licença extra** |
| Integração com Graph | Boa, mas sem controle granular | **Total** — chamadas diretas via `@azure/msal-node` |
| Escalabilidade | Limitada e cara | **Alta** — Postgres escala bem |

### Diagrama Lógico do Fluxo

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (Fase 2)                    │
│         Form de demanda  │  Painel Brunno/Dani          │
└───────────────┬──────────────────────────────┬──────────┘
                │ REST API                     │ REST API
┌───────────────▼──────────────────────────────▼──────────┐
│                  BACKEND Node.js / TypeScript            │
│                                                          │
│  POST /demandas  ──►  matchingService                    │
│                           │                              │
│                    1. Busca skills                        │
│                    2. Filtra nota≥2                       │
│                    3. Ordena 3>2                          │
│                    4. Graph getSchedule                   │
│                    5. Seleciona até 3                     │
│                           │                              │
│  POST /demandas/:id/acionar                              │
│                    notificationService                    │
│                    Teams Adaptive Card / e-mail Graph    │
│                           │                              │
│  POST /notificacoes/:id/responder                        │
│                    responseService                        │
│                    Aceite/Recusa/Escalona                 │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                    SUPABASE (Postgres)                   │
│  consultoras | skills | consultora_skills | demandas     │
│  sugestoes_consultoras | notificacoes | historico_status  │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│                  MICROSOFT GRAPH API                     │
│  calendar.getSchedule  │  sendMail  │  Teams Webhook     │
└─────────────────────────────────────────────────────────┘
```

### Stack definitiva

| Camada | Tecnologia | Justificativa |
|---|---|---|
| Backend | Node.js 20 + TypeScript + Fastify | Tipagem, performance, ecosystem |
| ORM | Prisma | Migrations declarativas, type-safe queries |
| Banco | Supabase (Postgres 15) | Gerenciado, Row Level Security, API REST |
| Auth Graph | `@azure/msal-node` | Client Credentials Flow oficial Microsoft |
| Notificação | Teams Adaptive Cards via Webhook + fallback sendMail | Botões estruturados, sem texto livre |
| Sincronização | `xlsx` (npm) para importação inicial do Excel | Importação pontual |
| Logs | Pino (built-in Fastify) + tabela `audit_logs` | Rastreabilidade |
| CI/CD | GitHub Actions | Simples, gratuito |
| Painel MVP | Retool ou Metabase | Rápido de conectar ao Postgres |

---

## 3. Modelo de Dados Completo

### Schema Prisma

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Consultora {
  id                    String   @id @default(uuid())
  nome                  String
  email                 String   @unique
  ativo                 Boolean  @default(true)
  cidade                String?
  estado                String?
  disponibilidadeViagem Boolean  @default(false)
  observacoes           String?
  criadoEm              DateTime @default(now()) @map("criado_em")
  atualizadoEm          DateTime @updatedAt @map("atualizado_em")

  skills       ConsultoraSkill[]
  sugestoes    SugestaoConsultora[]
  notificacoes Notificacao[]
  demandas     Demanda[] @relation("ConsultoraSelecionada")

  @@map("consultoras")
}

model Skill {
  id           String   @id @default(uuid())
  nome         String   @unique
  categoria    String?
  origem       String?
  ativo        Boolean  @default(true)
  criadoEm     DateTime @default(now()) @map("criado_em")
  atualizadoEm DateTime @updatedAt @map("atualizado_em")

  consultoras ConsultoraSkill[]
  demandas    Demanda[]

  @@map("skills")
}

// HEATMAP: consultora × skill
model ConsultoraSkill {
  id           String   @id @default(uuid())
  consultoraId String   @map("consultora_id")
  skillId      String   @map("skill_id")
  nota         Int      // 0, 1, 2 ou 3
  nivelTexto   String?  @map("nivel_texto")
  observacoes  String?
  atualizadoEm DateTime @updatedAt @map("atualizado_em")

  consultora Consultora @relation(fields: [consultoraId], references: [id])
  skill      Skill      @relation(fields: [skillId], references: [id])

  @@unique([consultoraId, skillId])
  @@index([skillId, nota])   // índice crítico para matching
  @@map("consultora_skills")
}

model Demanda {
  id                      String        @id @default(uuid())
  cliente                 String
  skillId                 String        @map("skill_id")
  formato                 String
  data                    DateTime      @db.Date
  horaInicio              String        @map("hora_inicio")
  horaFim                 String        @map("hora_fim")
  duracaoMinutos          Int           @map("duracao_minutos")
  modalidade              String
  observacoes             String?
  status                  StatusDemanda @default(criada)
  criadoPor               String?       @map("criado_por")
  consultoraSelecionadaId String?       @map("consultora_selecionada_id")
  criadoEm                DateTime      @default(now()) @map("criado_em")
  atualizadoEm            DateTime      @updatedAt @map("atualizado_em")

  skill                 Skill               @relation(fields: [skillId], references: [id])
  consultoraSelecionada Consultora?         @relation("ConsultoraSelecionada", fields: [consultoraSelecionadaId], references: [id])
  sugestoes             SugestaoConsultora[]
  notificacoes          Notificacao[]
  historico             HistoricoStatus[]

  @@index([status])
  @@index([data])
  @@map("demandas")
}

model SugestaoConsultora {
  id               String         @id @default(uuid())
  demandaId        String         @map("demanda_id")
  consultoraId     String         @map("consultora_id")
  nota             Int
  slotsDisponiveis Json?          @map("slots_disponiveis")
  ordemSugerida    Int            @map("ordem_sugerida")
  status           StatusSugestao @default(sugerida)
  motivo           String?
  criadoEm         DateTime       @default(now()) @map("criado_em")
  atualizadoEm     DateTime       @updatedAt @map("atualizado_em")

  demanda      Demanda      @relation(fields: [demandaId], references: [id])
  consultora   Consultora   @relation(fields: [consultoraId], references: [id])
  notificacoes Notificacao[]

  @@unique([demandaId, consultoraId])
  @@map("sugestoes_consultoras")
}

model Notificacao {
  id                   String             @id @default(uuid())
  demandaId            String             @map("demanda_id")
  consultoraId         String             @map("consultora_id")
  sugestaoId           String?            @map("sugestao_id")
  canal                CanalNotificacao
  status               StatusNotificacao  @default(enviada)
  enviadoEm            DateTime?          @map("enviado_em")
  respondidoEm         DateTime?          @map("respondido_em")
  resposta             RespostaConsultora?
  observacaoConsultora String?            @map("observacao_consultora")
  tokenResposta        String?            @unique @map("token_resposta")
  tokenExpiresAt       DateTime?          @map("token_expires_at")
  externalMessageId    String?            @map("external_message_id")
  criadoEm             DateTime           @default(now()) @map("criado_em")

  demanda    Demanda             @relation(fields: [demandaId], references: [id])
  consultora Consultora          @relation(fields: [consultoraId], references: [id])
  sugestao   SugestaoConsultora? @relation(fields: [sugestaoId], references: [id])

  @@map("notificacoes")
}

model HistoricoStatus {
  id             String   @id @default(uuid())
  demandaId      String   @map("demanda_id")
  statusAnterior String?  @map("status_anterior")
  statusNovo     String   @map("status_novo")
  descricao      String?
  criadoEm       DateTime @default(now()) @map("criado_em")
  criadoPor      String?  @map("criado_por")

  demanda Demanda @relation(fields: [demandaId], references: [id])

  @@map("historico_status")
}

enum StatusDemanda {
  criada
  consultoras_encontradas
  aguardando_aceite
  aceita
  escalada_para_proxima
  sem_consultora_elegivel
  sem_disponibilidade
  sem_aceite
  cancelada
  concluida
}

enum StatusSugestao {
  sugerida
  acionada
  aceita
  recusada
  expirada
  substituida
}

enum CanalNotificacao   { teams email }
enum StatusNotificacao  { enviada entregue respondida expirada erro }
enum RespostaConsultora { aceito nao_aceito aceito_com_observacao }
```

### Índices críticos

```sql
-- matching por skill + nota (mais consultado)
CREATE INDEX idx_consultora_skills_skill_nota
  ON consultora_skills (skill_id, nota DESC)
  WHERE nota >= 2;

-- painel: demandas por status e data
CREATE INDEX idx_demandas_status_data
  ON demandas (status, data DESC);

-- token de resposta (lookup rápido)
CREATE UNIQUE INDEX idx_notificacoes_token
  ON notificacoes (token_resposta)
  WHERE token_resposta IS NOT NULL;
```

---

## 4. Fluxo Backend Detalhado

### 4.1 Criação de Demanda + Matching (`POST /demandas`)

```
1.  Validar payload (Zod)
2.  Persistir demanda com status = "criada"
3.  Registrar histórico: null → criada
4.  SELECT consultora_skills WHERE skill_id = X AND nota >= 2
5.  Se vazio:
      status = "sem_consultora_elegivel" → return
6.  Ordenar: nota DESC
7.  Extrair e-mails das consultoras elegíveis
8.  Chamar Graph /calendar/getSchedule (free/busy)
9.  Para cada consultora: verificar slot livre >= duracaoMinutos
10. Se nenhuma disponível:
      status = "sem_disponibilidade" → return
11. Selecionar até 3 (prioridade: nota DESC → nome ASC)
12. Persistir SugestaoConsultora (ordem 1, 2, 3, status = "sugerida")
13. status demanda = "consultoras_encontradas"
14. Retornar demanda + sugestões
```

### 4.2 Acionamento (`POST /demandas/:id/acionar`)

```
1. Buscar próxima sugestão com status = "sugerida" (menor ordem)
2. Se não houver → status = "sem_aceite" → return erro
3. Criar Notificacao (status = "enviada")
4. Gerar tokenResposta (UUID + HMAC, TTL configurável)
5. Enviar Adaptive Card (Teams) ou e-mail (Graph)
6. sugestao.status = "acionada"
7. demanda.status = "aguardando_aceite"
8. Retornar { notificacaoId, consultora, canal }
```

### 4.3 Registro de Resposta (`POST /notificacoes/:id/responder`)

```
1. Validar token ou autenticação
2. Verificar TTL não expirado

SE aceito | aceito_com_observacao:
   - sugestao.status = "aceita"
   - demanda.status = "aceita"
   - demanda.consultoraSelecionadaId = consultoraId
   - demais sugestões → "substituida"

SE nao_aceito:
   - sugestao.status = "recusada"
   - Verificar próxima sugestão "sugerida"
   - Se existe → acionar próxima (fluxo 4.2), status = "escalada_para_proxima"
   - Se não existe → status = "sem_aceite"

3. Registrar historico_status
4. Retornar { statusDemanda, mensagem }
```

---

## 5. Estratégia Microsoft Graph

### 5.1 Autenticação — Client Credentials Flow

```typescript
// src/lib/graphClient.ts
import { ConfidentialClientApplication } from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";

const msalClient = new ConfidentialClientApplication({
  auth: {
    clientId: process.env.SP_CLIENT_ID!,
    clientSecret: process.env.SP_CLIENT_SECRET!,
    authority: `https://login.microsoftonline.com/${process.env.SP_TENANT_ID}`,
  },
});

export async function getGraphClient(): Promise<Client> {
  const token = await msalClient.acquireTokenByClientCredential({
    scopes: ["https://graph.microsoft.com/.default"],
  });
  if (!token?.accessToken) throw new Error("Falha ao obter token Graph");

  return Client.init({
    authProvider: (done) => done(null, token.accessToken),
  });
}
```

### 5.2 Consulta de Disponibilidade — `calendar/getSchedule`

```typescript
// src/services/availabilityService.ts
import { getGraphClient } from "../lib/graphClient";

interface SlotLivre { start: string; end: string; }
interface DisponibilidadeConsultora {
  email: string;
  slotsLivres: SlotLivre[];
  disponivel: boolean;
}

export async function consultarDisponibilidade(
  emails: string[],
  data: string,          // "2026-06-25"
  horaInicio: string,    // "14:00"
  horaFim: string,       // "18:00"
  duracaoMinutos: number
): Promise<DisponibilidadeConsultora[]> {
  const client = await getGraphClient();
  const ORGANIZADOR = process.env.GRAPH_ORGANIZER_EMAIL!;
  const TZ = process.env.GRAPH_TIMEZONE!; // "E. South America Standard Time"

  const response = await client
    .api(`/users/${ORGANIZADOR}/calendar/getSchedule`)
    .post({
      schedules: emails,
      startTime: { dateTime: `${data}T${horaInicio}:00`, timeZone: TZ },
      endTime:   { dateTime: `${data}T${horaFim}:00`,   timeZone: TZ },
      availabilityViewInterval: 30,
    });

  return response.value.map((item: any) => {
    const slotsLivres = calcularSlotsLivres(
      item.scheduleItems ?? [],
      `${data}T${horaInicio}:00`,
      `${data}T${horaFim}:00`,
      duracaoMinutos
    );
    return { email: item.scheduleId, slotsLivres, disponivel: slotsLivres.length > 0 };
  });
}

function calcularSlotsLivres(
  items: any[], wStart: string, wEnd: string, duracaoMin: number
): SlotLivre[] {
  const slots: SlotLivre[] = [];
  const tStart = new Date(wStart).getTime();
  const tEnd   = new Date(wEnd).getTime();
  const durMs  = duracaoMin * 60_000;

  const ocupados = items
    .filter((i) => ["busy", "tentative"].includes(i.status))
    .map((i) => ({
      s: new Date(i.start.dateTime).getTime(),
      e: new Date(i.end.dateTime).getTime(),
    }))
    .sort((a, b) => a.s - b.s);

  let cursor = tStart;
  for (const o of ocupados) {
    if (o.s > cursor && o.s - cursor >= durMs)
      slots.push({ start: new Date(cursor).toISOString(), end: new Date(o.s).toISOString() });
    cursor = Math.max(cursor, o.e);
  }
  if (tEnd - cursor >= durMs)
    slots.push({ start: new Date(cursor).toISOString(), end: new Date(tEnd).toISOString() });

  return slots;
}
```

### 5.3 Envio — Teams Adaptive Card (Incoming Webhook)

```typescript
// src/services/notificationService.ts
import axios from "axios";

export async function enviarAdaptiveCardTeams(
  webhookUrl: string,
  consultoraNome: string,
  demanda: any,
  urlAceitar: string,
  urlRecusar: string,
  urlAceitarObs: string
): Promise<void> {
  const card = {
    type: "message",
    attachments: [{
      contentType: "application/vnd.microsoft.card.adaptive",
      content: {
        $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
        type: "AdaptiveCard",
        version: "1.4",
        body: [
          { type: "TextBlock", text: "📋 Nova Solicitação de Entrega", weight: "Bolder", size: "Medium" },
          { type: "FactSet", facts: [
            { title: "Cliente",     value: demanda.cliente },
            { title: "Tema/Skill",  value: demanda.skill },
            { title: "Formato",     value: demanda.formato },
            { title: "Data",        value: demanda.data },
            { title: "Horário",     value: `${demanda.horaInicio} às ${demanda.horaFim}` },
            { title: "Duração",     value: `${demanda.duracaoMinutos} min` },
            { title: "Modalidade",  value: demanda.modalidade },
            { title: "Observações", value: demanda.observacoes ?? "—" },
          ]},
          { type: "TextBlock", text: `Olá, **${consultoraNome}**! Você aceita essa entrega?`, wrap: true },
        ],
        actions: [
          { type: "Action.OpenUrl", title: "✅ Aceito",                url: urlAceitar,   style: "positive" },
          { type: "Action.OpenUrl", title: "❌ Não aceito",            url: urlRecusar,   style: "destructive" },
          { type: "Action.OpenUrl", title: "✅ Aceito com observação", url: urlAceitarObs },
        ],
      },
    }],
  };

  await axios.post(webhookUrl, card, {
    headers: { "Content-Type": "application/json" },
    timeout: 10_000,
  });
}
```

### 5.4 Fallback — E-mail via Graph

```typescript
// src/services/emailService.ts
import { getGraphClient } from "../lib/graphClient";

export async function enviarEmailConsultora(
  para: string, nome: string, demanda: any,
  urlAceitar: string, urlRecusar: string, urlObs: string
): Promise<void> {
  const client = await getGraphClient();
  const FROM = process.env.EMAIL_FROM!;

  const html = `
    <h2>Nova Solicitação de Entrega — Cia de Talentos</h2>
    <p>Olá, <strong>${nome}</strong>!</p>
    <table border="1" cellpadding="8" style="border-collapse:collapse">
      <tr><td><b>Cliente</b></td><td>${demanda.cliente}</td></tr>
      <tr><td><b>Skill</b></td><td>${demanda.skill}</td></tr>
      <tr><td><b>Data</b></td><td>${demanda.data} | ${demanda.horaInicio}–${demanda.horaFim}</td></tr>
      <tr><td><b>Formato</b></td><td>${demanda.formato} | ${demanda.modalidade}</td></tr>
      <tr><td><b>Observações</b></td><td>${demanda.observacoes ?? '—'}</td></tr>
    </table>
    <p>
      <a href="${urlAceitar}" style="background:#107C10;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px;margin-right:6px">✅ Aceito</a>
      <a href="${urlRecusar}" style="background:#D13438;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px;margin-right:6px">❌ Não aceito</a>
      <a href="${urlObs}"     style="background:#0078D4;color:#fff;padding:10px 18px;text-decoration:none;border-radius:4px">✅ Aceito com observação</a>
    </p>
    <p><small>Link válido por 48h. Não compartilhe.</small></p>
  `;

  await client.api(`/users/${FROM}/sendMail`).post({
    message: {
      subject: `[CT] Nova demanda: ${demanda.skill} — ${demanda.cliente}`,
      body: { contentType: "HTML", content: html },
      toRecipients: [{ emailAddress: { address: para } }],
    },
    saveToSentItems: true,
  });
}
```

### 5.5 Permissões Microsoft Graph necessárias

| Permissão | Tipo | Finalidade |
|---|---|---|
| `Calendars.Read` | Application | `getSchedule` (free/busy) |
| `Mail.Send` | Application | Envio de e-mail via Graph |
| `User.Read.All` | Application | Resolver perfis de consultoras |
| `ChannelMessage.Send` | Application | Mensagens Teams (se não usar webhook) |

> Todas as permissões Application exigem **admin consent** do tenant.

---

## 6. Tabela de Endpoints

| Método | Rota | Responsabilidade |
|---|---|---|
| `POST` | `/demandas` | Criar demanda + matching automático |
| `POST` | `/demandas/:id/match` | Reexecutar matching |
| `POST` | `/demandas/:id/acionar` | Acionar próxima consultora disponível |
| `POST` | `/notificacoes/:id/responder` | Registrar aceite/recusa (autenticado) |
| `GET`  | `/r/:token` | Resposta via link público tokenizado |
| `GET`  | `/demandas` | Listar demandas com filtros (painel) |
| `GET`  | `/demandas/:id` | Detalhar demanda + sugestões + histórico |
| `PATCH`| `/demandas/:id` | Atualizar status (cancelar, concluir) |
| `POST` | `/sync/consultoras` | Importar/sincronizar do Excel |
| `GET`  | `/skills` | Listar skills ativas (dropdown) |
| `GET`  | `/consultoras` | Listar consultoras ativas |

---

## 7. Exemplos de Payloads

### Criar Demanda — Request
```json
{
  "cliente": "Cliente XPTO",
  "skillId": "uuid-skill-comunicacao-feedback",
  "formato": "Workshop",
  "data": "2026-06-25",
  "horaInicio": "14:00",
  "horaFim": "18:00",
  "duracaoMinutos": 120,
  "modalidade": "online",
  "observacoes": "Cliente pediu foco em jovens talentos"
}
```

### Matching com Sucesso — Response
```json
{
  "demanda": {
    "id": "uuid-demanda",
    "status": "consultoras_encontradas"
  },
  "sugestoes": [
    {
      "ordem": 1,
      "consultora": { "nome": "Ana Souza", "email": "ana@ct.com.br" },
      "nota": 3, "nivelTexto": "Mestre",
      "slotsLivres": [{ "start": "2026-06-25T14:00:00", "end": "2026-06-25T16:30:00" }],
      "status": "sugerida"
    },
    {
      "ordem": 2,
      "consultora": { "nome": "Bia Lima", "email": "bia@ct.com.br" },
      "nota": 3, "nivelTexto": "Mestre",
      "slotsLivres": [{ "start": "2026-06-25T14:00:00", "end": "2026-06-25T18:00:00" }],
      "status": "sugerida"
    },
    {
      "ordem": 3,
      "consultora": { "nome": "Carla Dias", "email": "carla@ct.com.br" },
      "nota": 2, "nivelTexto": "Praticante",
      "slotsLivres": [{ "start": "2026-06-25T15:00:00", "end": "2026-06-25T18:00:00" }],
      "status": "sugerida"
    }
  ]
}
```

### Sem Consultora Elegível
```json
{
  "demanda": { "id": "uuid", "status": "sem_consultora_elegivel" },
  "sugestoes": [],
  "mensagem": "Não há consultoras com nota ≥ 2 para a skill 'Comunicação e Feedback'."
}
```

### Sem Disponibilidade
```json
{
  "demanda": { "id": "uuid", "status": "sem_disponibilidade" },
  "sugestoes": [],
  "mensagem": "Há 4 consultoras elegíveis, mas nenhuma tem agenda livre no período.",
  "consultorasElegiveis": ["Ana Souza", "Bia Lima", "Carla Dias", "Diana Rocha"]
}
```

### Resposta de Aceite
```json
{
  "resposta": "aceito_com_observacao",
  "observacao": "Prefiro iniciar às 14:30 por conta de reunião anterior."
}
```

### Painel — GET /demandas
```json
{
  "data": [{
    "id": "uuid",
    "cliente": "Cliente XPTO",
    "skill": "Comunicação e Feedback",
    "formato": "Workshop",
    "data": "2026-06-25",
    "horaInicio": "14:00",
    "horaFim": "18:00",
    "modalidade": "online",
    "status": "aceita",
    "consultoraSelecionada": { "nome": "Ana Souza", "email": "ana@ct.com.br" },
    "totalSugestoes": 3,
    "totalAcionadas": 1,
    "totalRecusadas": 0,
    "criadoEm": "2026-06-22T10:30:00Z",
    "aceitoEm": "2026-06-22T11:05:00Z",
    "tempoRespostaMinutos": 35
  }],
  "pagination": { "page": 1, "perPage": 20, "total": 47 }
}
```

---

## 8. Plano de Implementação

### Etapa 1 — Fundação (Dias 1–3)
- [ ] Criar repositório GitHub (monorepo `/backend`, `/docs`)
- [ ] Configurar Supabase: projeto, banco, Row Level Security básico
- [ ] Rodar migrations Prisma
- [ ] Configurar `.env` com todas as variáveis
- [ ] Criar App Registration no Azure, adicionar permissões, obter admin consent
- [ ] Validar autenticação Graph: obter token, fazer chamada de teste

### Etapa 2 — Base de Dados + Sync (Dias 4–6)
- [ ] Implementar `POST /sync/consultoras`: ler Excel via `xlsx`, upsert no Postgres
- [ ] Validar importação completa do heatmap
- [ ] Implementar `GET /skills` e `GET /consultoras`
- [ ] Comparar dados importados vs. Excel original

### Etapa 3 — Matching Core (Dias 7–10)
- [ ] Implementar `matchingService` completo
- [ ] Integrar `availabilityService` (Graph getSchedule)
- [ ] Implementar `POST /demandas` e `POST /demandas/:id/match`
- [ ] Testar todos os cenários: elegível, sem elegível, sem disponibilidade
- [ ] Validar ordenação nota 3 > 2

### Etapa 4 — Notificação e Aceite (Dias 11–15)
- [ ] Implementar `notificationService` (Teams Adaptive Card + fallback e-mail)
- [ ] Implementar geração e validação de token HMAC + TTL
- [ ] Implementar `POST /demandas/:id/acionar`
- [ ] Implementar `GET /r/:token` e `POST /notificacoes/:id/responder`
- [ ] Testar fluxo completo: acionar → aceitar → escalona → recusar → sem aceite

### Etapa 5 — Painel e Finalização (Dias 16–20)
- [ ] Implementar `GET /demandas` com filtros e paginação
- [ ] Implementar `GET /demandas/:id` com histórico
- [ ] Criar view SQL `vw_painel_demandas` para Retool/Metabase
- [ ] Conectar painel ao banco e validar com Brunno/Dani
- [ ] Testes end-to-end dos 14 cenários
- [ ] Documentar `.env.example` e README de onboarding

**View SQL para painel:**
```sql
CREATE VIEW vw_painel_demandas AS
SELECT
  d.id, d.cliente, s.nome AS skill, d.formato,
  d.data, d.hora_inicio, d.hora_fim, d.modalidade, d.status,
  c.nome AS consultora_selecionada,
  COUNT(sc.id) AS total_sugestoes,
  COUNT(CASE WHEN sc.status = 'acionada' THEN 1 END) AS total_acionadas,
  COUNT(CASE WHEN sc.status = 'recusada' THEN 1 END) AS total_recusadas,
  d.criado_em,
  MIN(CASE WHEN n.resposta IN ('aceito','aceito_com_observacao')
      THEN n.respondido_em END) AS aceito_em,
  ROUND(EXTRACT(EPOCH FROM (
    MIN(CASE WHEN n.resposta IN ('aceito','aceito_com_observacao')
        THEN n.respondido_em END) - d.criado_em
  )) / 60) AS tempo_resposta_minutos
FROM demandas d
LEFT JOIN skills s ON d.skill_id = s.id
LEFT JOIN consultoras c ON d.consultora_selecionada_id = c.id
LEFT JOIN sugestoes_consultoras sc ON sc.demanda_id = d.id
LEFT JOIN notificacoes n ON n.demanda_id = d.id
GROUP BY d.id, s.nome, c.nome;
```

---

## 9. Recomendação sobre IA e LangChain

### Veredicto para o MVP: **Não use LangChain**

O matching é determinístico, a busca é por campos estruturados, e não há texto livre no caminho crítico. LangChain adicionaria:
- Dependência pesada sem ganho real
- Latência + custo de LLM em cada chamada de matching
- Comportamento não determinístico em fluxo de negócio crítico
- Complexidade de debugging desproporcional para o MVP

### Quando adicionar IA (Fase 2+)

| Caso de uso | Valor | Quando introduzir |
|---|---|---|
| Interpretar demanda em linguagem natural | Alto | Pós-MVP estável (3+ meses) |
| Mapear sinônimos de skills | Médio | Pós-MVP, se base de skills crescer muito |
| RAG sobre portfólio de soluções | Alto | Fase 3 (busca por conteúdo) |
| Explicar recomendação em português | Médio | Fase 2 (UX de resultado) |

**Recomendação pós-MVP:** Adicionar endpoint `/demandas/interpretar` (opcional) que usa LLM para parsear texto livre e retornar o payload estruturado de `POST /demandas`. O motor de matching continua 100% determinístico.

---

## 10. Checklist para TI — Microsoft Graph

### App Registration no Azure Entra ID
- [ ] Criar App Registration: `ct-alocacao-mvp`
  - Tipo: "Contas somente neste diretório organizacional"
- [ ] Anotar **Tenant ID** e **Client ID**
- [ ] Criar **Client Secret** (validade 12 meses) ou certificado X.509
- [ ] Adicionar permissões **Application** (não Delegated):
  - `Calendars.Read`
  - `Mail.Send`
  - `User.Read.All`
  - `ChannelMessage.Send` (se usar bot Teams, não webhook)
- [ ] **Conceder admin consent** para todas (requer Global Admin)
- [ ] Criar caixa funcional: `noreply-alocacao@ciadetalentos.com.br` (para `EMAIL_FROM`)
- [ ] Criar usuário/caixa organizador: `organizador-alocacao@ciadetalentos.com.br` (para `GRAPH_ORGANIZER_EMAIL`)

### Restrição de acesso ao calendário (ApplicationAccessPolicy)
```powershell
# Limita Calendars.Read apenas ao grupo de consultoras
New-ApplicationAccessPolicy `
  -AppId <SP_CLIENT_ID> `
  -PolicyScopeGroupId "ct-consultoras-alocacao@ciadetalentos.com.br" `
  -AccessRight RestrictAccess `
  -Description "MVP Alocacao — acesso restrito ao grupo de consultoras"
```

### Teams
- [ ] Para MVP com Incoming Webhooks: criar webhook em canal `#alocacoes-ct`
- [ ] Salvar URL do webhook em `TEAMS_WEBHOOK_URL`
- [ ] (Opcional) Bot Teams: registrar no Azure Bot Services para respostas interativas mais ricas

---

## 11. Checklist de Segurança

### Secrets e configuração
- [ ] Todas as credenciais em variáveis de ambiente, nunca hardcoded
- [ ] `.env` no `.gitignore` — apenas `.env.example` no repositório
- [ ] `RESPONSE_TOKEN_SECRET` com mínimo 32 bytes aleatórios
- [ ] `RESPONSE_TOKEN_TTL_HOURS` configurável (padrão: 48h)
- [ ] Client Secret com data de expiração monitorada (renovar antes do vencimento)

### Controle de acesso
- [ ] API protegida por JWT — apenas usuários da CT criam demandas
- [ ] Somente Brunno/Dani acessam listagem de todas as demandas
- [ ] Consultora acessa apenas sua notificação via token único e temporal
- [ ] Row Level Security no Supabase como segunda linha de defesa

### Privacidade e LGPD
- [ ] `getSchedule` retorna apenas free/busy — nunca título ou detalhes de compromissos
- [ ] Logs não persistem conteúdo de agenda individual
- [ ] `observacaoConsultora` não exposta no painel público (apenas Brunno/Dani)
- [ ] Política de retenção de dados definida (ex: purgar histórico > 2 anos)

### Logs e auditoria
- [ ] Logar toda chamada ao Graph: endpoint, status HTTP, latência
- [ ] Logar criação, matching e mudanças de status
- [ ] Nunca logar tokens, client secrets ou dados de agenda
- [ ] Alertas em erros Graph (429, 401, 403)
- [ ] Retry com backoff exponencial para 429 (rate limit)

---

## 12. Variáveis de Ambiente

```bash
# .env.example

# ── Microsoft Graph ────────────────────────────
SP_TENANT_ID=
SP_CLIENT_ID=
SP_CLIENT_SECRET=
GRAPH_ORGANIZER_EMAIL=          # ex: organizador-alocacao@ciadetalentos.com.br
GRAPH_TIMEZONE=E. South America Standard Time
GRAPH_REQUEST_TIMEOUT_MS=10000

# ── Notificação ────────────────────────────────
NOTIFICATION_CHANNEL=teams      # "teams" ou "email"
TEAMS_WEBHOOK_URL=
EMAIL_FROM=                     # ex: noreply-alocacao@ciadetalentos.com.br

# ── Banco de Dados ─────────────────────────────
DATABASE_URL=                   # postgresql://user:pass@host:5432/db?sslmode=require

# ── Aplicação ──────────────────────────────────
APP_BASE_URL=                   # https://alocacoes.ciadetalentos.com.br
NODE_ENV=production

# ── Segurança ──────────────────────────────────
RESPONSE_TOKEN_SECRET=          # >= 32 chars aleatórios (HMAC signing)
RESPONSE_TOKEN_TTL_HOURS=48
```

---

## 13. Plano de Testes

| # | Cenário | Resultado Esperado |
|---|---|---|
| 1 | Sync do Excel (10 consultoras, 5 skills) | Heatmap importado corretamente no banco |
| 2 | Filtro nota ≥ 2 em skill com notas 0,1,2,3 | Retorna apenas nota 2 e 3 |
| 3 | Skill com todas as notas ≤ 1 | `status: sem_consultora_elegivel` |
| 4 | 3 elegíveis, 1 com agenda livre | Graph retorna 1 com slot válido |
| 5 | 3 elegíveis, todas com agenda cheia | `status: sem_disponibilidade` |
| 6 | 5 elegíveis e livres | Retorna exatamente 3 (nota DESC) |
| 7 | Envio de notificação Teams | Adaptive Card entregue no canal correto |
| 8 | Resposta "aceito" via link | `demanda.status = aceita`, demais → `substituida` |
| 9 | Resposta "nao_aceito" | Próxima consultora acionada automaticamente |
| 10 | Todas as 3 recusam | `demanda.status = sem_aceite` |
| 11 | GET /demandas com filtros | Lista paginada com status e métricas |
| 12 | Token expirado | HTTP 410 Gone + mensagem clara |
| 13 | Rate limit Graph (429 simulado) | Retry com backoff, log de erro, sem crash |
| 14 | Aceite com observação | Texto salvo em `observacao_consultora` |

---

## Resumo das Decisões Técnicas

| Decisão | Escolha | Razão Principal |
|---|---|---|
| Arquitetura | Node.js + Supabase + Graph | Controle total, sem licença Power Platform |
| ORM | Prisma | Migrations versionadas, type-safe |
| Notificação MVP | Teams Adaptive Cards (webhook) | Botões estruturados, zero texto livre |
| Fallback | E-mail via Graph (sendMail) | Simples e confiável |
| Free/busy | `calendar/getSchedule` | Sem expor detalhes de agenda (LGPD) |
| IA/LangChain | **Não no MVP** | Matching determinístico, sem ganho |
| Painel | Retool ou Metabase | Rápido, conecta direto ao Postgres |
| Token de resposta | HMAC + TTL | Seguro sem autenticação da consultora |


---

## ADENDO — Diagnóstico dos Arquivos Reais

*Adicionado após análise dos arquivos enviados*

---

### Dados Encontrados nos Arquivos

#### `C&D - Cadastro de Consultoras 2026-27.xlsx`

**Abas:**
- `Base` — Respostas do formulário de cadastro (46 linhas × 73 colunas)
- `Heatmap (Temas vs. Consultoras)` — O heatmap principal: 61 temas × 9 consultoras
- `Heatmap (Tema 1ª Liderança)` — Aba com dados incompletos (linhas vazias)
- `Temas Duplicados` — Registro de temas com nomes diferentes entre trilhas

**Consultoras mapeadas no heatmap (9 colunas):**

| Nome no Heatmap | E-mail na Base | Status |
|---|---|---|
| Cinthya | cinthya.calvo.externo@ciadetalentos.com | ✅ Mapeado |
| Daniela Gomes | daniela.gomes@ciadetalentos.com | ✅ Mapeado |
| Eliana | eliana.mourao@ciadetalentos.com | ✅ Mapeado |
| Polyana | polyana.freitas.externo@ciadetalentos.com | ✅ Mapeado |
| Ingrid | ingrid.ferreira.externo@ciadetalentos.com | ✅ Mapeado |
| Daniella Camara | daniellacamara@gmail.com (aba anônima) | ⚠️ E-mail externo — confirmar |
| Esteban | desconhecido | ❌ **E-mail ausente — ação necessária** |
| Glenda | desconhecido | ❌ **E-mail ausente — ação necessária** |
| Luis Maurício | desconhecido | ❌ **E-mail ausente — ação necessária** |

> **Ação imediata:** Coletar e-mails corporativos de Esteban, Glenda e Luis Maurício. Sem e-mail, não é possível consultar o Outlook via Graph nem enviar notificação.

---

#### Skills/Temas no Heatmap

**Total de temas mapeados: 61**
- Origem "Ambos" (Jovem + 1ª Liderança): 7 temas
- Origem "Jovem": 13 temas
- Origem "1ª Liderança": 41 temas

**Skills com ZERO consultoras elegíveis (nota ≥ 2) — 16 temas que retornarão `sem_consultora_elegivel` sempre:**
```
Customer Success, Customer Service, Alfabetização Tecnológica,
IA Big Data e Novas Tecnologias, Dashboards (template),
Gestão de Riscos (simples), CRM (pipeline em planilha),
Automação No-code (desenho), IA Responsável (checklist),
LGPD e Privacidade Aplicada, Cibersegurança Básica (higiene),
Data Storytelling (aplicação), CS Ops (health score-lite),
Jornada do Cliente / Blueprint (recorte),
Priorização (RICE/WSJF simplificado), Data Driven Decision Making
```
> **Recomendação:** Marcar esses temas como `ativo: false` no banco até que consultoras sejam cadastradas. Esconder do dropdown do formulário.

**Skills com apenas 1 consultora elegível (risco de gargalo):**
- Recognita: apenas Daniela Gomes (nota 2)
- Product Discovery: apenas Cinthya (nota 2)
- Negociação (BATNA-lite): apenas Cinthya (nota 2)
- Social Selling: apenas Cinthya (nota 2)
- OKRs e Métricas: apenas Daniela Gomes (nota 3)
- Kanban (quadro mínimo): apenas Daniela Gomes (nota 3)

**Skills com maior cobertura (≥ 6 consultoras elegíveis):**
- Comunicação e Feedback: 8 consultoras (Cinthya, Daniela, Eliana, Polyana, Daniella C., Esteban, Ingrid, Glenda)
- Protagonismo e Autorresponsabilidade: 8 consultoras
- Autoconhecimento e Identidade Profissional: 9 consultoras (todas)
- Colaboração e Diversidade: 8 consultoras
- Facilitação: 7 consultoras
- Inteligência Emocional / Inteligência Emocional e Autogestão: 7–8 consultoras

---

#### `Portfólio Revisado 2026.xlsx`

Contém 4 abas ricas com conteúdo estratégico:

- **Temáticas** — 4 pilares do portfólio com embasamento bibliográfico e diferenciais competitivos
- **Formatos** — 8 formatos de entrega com duração, turma ideal, objetos de aprendizagem e metodologias:
  - Masterclass interativa (até 2h)
  - Skill Lab / Mini Bootcamp (2h–4h)
  - Learning Sprint (4h–6h)
  - Simulation Lab (4h–8h)
  - Hackathon (6h–8h)
  - Mentoring Lab (sessões de 1h30–2h)
  - Assessment Experience (devolutiva + assessment prévio)
  - Career Milestone (2h–4h)
- **Temas vs. Formatos** — matriz de compatibilidade: qual tema pode ser entregue em qual formato
- **Objetos de Aprendizagem** — por tema, com ferramentas (Strateegia, Canvas, Podcast, Quiz, Vídeo, etc.)

> **Oportunidade de produto:** A matriz Temas vs. Formatos pode ser importada como tabela `skill_formatos_compativeis` no banco, e o formulário de criação de demanda pode usar isso para filtrar os formatos disponíveis dado o tema selecionado.

---

### Ajustes no Modelo de Dados com base nos Arquivos Reais

#### 1. Adicionar campos na tabela `consultoras`

```prisma
model Consultora {
  // campos novos com base no cadastro real
  linkedin          String?
  graduacao         String?
  posGraduacao      String?
  certificacoes     String[]   // ex: ["FACET5", "PMI", "Coaching"]
  anosExperiencia   String?    // ex: "6 a 10 anos"
  tamanhoGrupo      String?    // ex: "20 a 40 pessoas"
  estiloFacilitacao String?
  setoresAtendidos  String[]
  publicosAtendidos String[]   // ex: ["Estagiário", "Trainee", "Primeira liderança"]
  diasMes           String?    // ex: "Mais de 15 dias"
  diferenciais      String?
  projetos          String?    // até 3 projetos relevantes
  // ...campos existentes
}
```

#### 2. Nova tabela: `skill_formatos_compativeis`

```prisma
model SkillFormatoCompativel {
  id        String   @id @default(uuid())
  skillId   String   @map("skill_id")
  formato   String   // ex: "Masterclass interativa", "Skill Lab", etc.
  skill     Skill    @relation(fields: [skillId], references: [id])

  @@unique([skillId, formato])
  @@map("skill_formatos_compativeis")
}
```

#### 3. Campo `trilha` e `origem` em `skills` já previsto — confirmar uso no filtro

O formulário pode ter um filtro por trilha (Power Skills vs. Hard Skills) e por origem (Jovem, 1ª Liderança, Ambos), reduzindo o dropdown de 61 para algo manejável.

---

### Script de Sincronização Real (`/sync/consultoras`)

Com base nos arquivos, o script precisa:

```typescript
// src/scripts/syncFromExcel.ts

const NOME_PARA_EMAIL: Record<string, string | null> = {
  "Cinthya":         "cinthya.calvo.externo@ciadetalentos.com",
  "Daniela Gomes":   "daniela.gomes@ciadetalentos.com",
  "Eliana":          "eliana.mourao@ciadetalentos.com",
  "Polyana":         "polyana.freitas.externo@ciadetalentos.com",
  "Daniella Camara": "daniellacamara@gmail.com",  // confirmar se é corporativo
  "Esteban":         null,   // e-mail pendente
  "Glenda":          null,   // e-mail pendente
  "Luis Maurício":   null,   // e-mail pendente
  "Ingrid":          "ingrid.ferreira.externo@ciadetalentos.com",
};

// Fluxo:
// 1. Ler aba "Base" → upsert em consultoras
// 2. Ler aba "Heatmap" → upsert em skills + consultora_skills
// 3. Ler Portfólio → upsert em skill_formatos_compativeis
// 4. Skills sem email mapeado → log de aviso, não inserir consultora_skills sem email
// 5. Skills sem nenhum elegível → marcar como ativo: false (ou só logar)
```

---

### Checklist de Ações Imediatas (antes de começar o código)

- [ ] **URGENTE — rotacionar o Client Secret** no portal Azure (credencial foi exposta no chat)
- [ ] Coletar e-mails de: **Esteban, Glenda, Luis Maurício** (sem e-mail não há Graph)
- [ ] Confirmar se `daniellacamara@gmail.com` é o e-mail corporativo ou pessoal
- [ ] Confirmar se as consultoras externas (`*.externo@ciadetalentos.com`) têm caixa de calendário ativa no tenant — consultoras externas podem não ter licença M365 ativa
- [ ] Verificar com TI se consultoras do domínio `@gmail.com` ou externos podem ser consultadas via Graph (normalmente não — apenas contas do mesmo tenant)
- [ ] Definir e-mail do organizador para `getSchedule` (GRAPH_ORGANIZER_EMAIL)
- [ ] Criar App Registration e obter admin consent para `Calendars.Read`, `Mail.Send`, `User.Read.All`
- [ ] Criar o canal Teams `#alocacoes-ct` e o Incoming Webhook

> **Ponto de atenção crítico:** Consultoras com e-mail `*.externo@ciadetalentos.com` e `@gmail.com` podem ter licenças M365 limitadas ou inexistentes. O `calendar/getSchedule` via Graph só funciona para usuários que têm Exchange Online ativo no mesmo tenant. Isso precisa ser confirmado com TI antes de implementar o fluxo de disponibilidade.

