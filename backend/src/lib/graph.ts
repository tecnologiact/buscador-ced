/**
 * graph.ts
 * Cliente autenticado para o Microsoft Graph via Client Credentials Flow.
 *
 * Permissões necessárias no App Registration (Application, não delegadas):
 *   - Calendars.Read  → consultar free/busy das consultoras
 *   - Mail.Send       → enviar e-mails de acionamento
 *
 * Todas requerem Admin Consent do tenant.
 */

import { ClientSecretCredential } from '@azure/identity'
import { Client } from '@microsoft/microsoft-graph-client'
import { TokenCredentialAuthenticationProvider } from
  '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js'

// Inicialização lazy: o cliente só é criado na primeira chamada,
// quando o dotenv já carregou as variáveis de ambiente.
let _graphClient: Client | null = null

export function getGraphClient(): Client {
  if (_graphClient) return _graphClient

  const tenantId     = process.env.SP_TENANT_ID
  const clientId     = process.env.SP_CLIENT_ID
  const clientSecret = process.env.SP_CLIENT_SECRET

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('SP_TENANT_ID, SP_CLIENT_ID e SP_CLIENT_SECRET são obrigatórios no .env')
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret)

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  })

  _graphClient = Client.initWithMiddleware({ authProvider })
  return _graphClient
}
