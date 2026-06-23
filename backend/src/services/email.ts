/**
 * email.ts
 * Envia e-mail de acionamento para consultoras via Microsoft Graph.
 *
 * O e-mail contém um link seguro com token único para registrar
 * aceite ou recusa sem necessidade de login.
 *
 * Permissão necessária: Mail.Send (Application)
 */

import { getGraphClient } from '../lib/graph'

export interface DadosNotificacao {
  para: string
  nomeConsultora: string
  cliente: string
  skill: string
  formato: string
  data: string
  horaInicio: string
  horaFim: string
  duracaoMinutos: number
  modalidade: string
  observacoes?: string
  tokenAceite: string
  tokenRecusa: string
  tokenObservacao: string
  notificacaoId: string
}

function formatarData(data: string): string {
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano}`
}

export async function enviarEmailAcionamento(
  dados: DadosNotificacao,
  emailRemetente: string
): Promise<void> {
  const baseUrl = process.env.APP_BASE_URL ?? 'http://localhost:3000'

  const linkAceite      = `${baseUrl}/api/notificacoes/${dados.notificacaoId}/responder?token=${dados.tokenAceite}&resposta=aceita`
  const linkRecusa      = `${baseUrl}/api/notificacoes/${dados.notificacaoId}/responder?token=${dados.tokenRecusa}&resposta=recusada`
  const linkObservacao  = `${baseUrl}/api/notificacoes/${dados.notificacaoId}/responder?token=${dados.tokenObservacao}&resposta=aceita_com_observacao`

  const htmlBody = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #333;">Nova solicitação de entrega</h2>
      <p>Olá, <strong>${dados.nomeConsultora}</strong>!</p>
      <p>Você foi selecionada para uma entrega. Veja os detalhes abaixo:</p>

      <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
        <tr style="background: #f5f5f5;">
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold; width: 40%;">Cliente</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${dados.cliente}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Tema / Skill</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${dados.skill}</td>
        </tr>
        <tr style="background: #f5f5f5;">
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Formato</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${dados.formato}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Data</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${formatarData(dados.data)}</td>
        </tr>
        <tr style="background: #f5f5f5;">
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Horário</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${dados.horaInicio} às ${dados.horaFim} (${dados.duracaoMinutos} min)</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Modalidade</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${dados.modalidade}</td>
        </tr>
        ${dados.observacoes ? `
        <tr style="background: #f5f5f5;">
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Observações</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${dados.observacoes}</td>
        </tr>` : ''}
      </table>

      <p><strong>Você aceita essa entrega?</strong></p>

      <div style="margin: 30px 0;">
        <a href="${linkAceite}"
           style="background: #22c55e; color: white; padding: 12px 24px; text-decoration: none;
                  border-radius: 6px; margin-right: 10px; display: inline-block;">
          ✅ Aceito
        </a>
        <a href="${linkRecusa}"
           style="background: #ef4444; color: white; padding: 12px 24px; text-decoration: none;
                  border-radius: 6px; margin-right: 10px; display: inline-block;">
          ❌ Não aceito
        </a>
        <a href="${linkObservacao}"
           style="background: #f59e0b; color: white; padding: 12px 24px; text-decoration: none;
                  border-radius: 6px; display: inline-block;">
          💬 Aceito com observação
        </a>
      </div>

      <p style="color: #666; font-size: 12px;">
        Este link é pessoal e expira em 48 horas.<br>
        Em caso de dúvidas, entre em contato com o time de C&D.
      </p>
    </div>
  `

  await getGraphClient()
    .api(`/users/${emailRemetente}/sendMail`)
    .post({
      message: {
        subject: `[C&D] Nova solicitação de entrega — ${dados.skill} | ${formatarData(dados.data)}`,
        body: {
          contentType: 'HTML',
          content: htmlBody,
        },
        toRecipients: [
          { emailAddress: { address: dados.para } },
        ],
      },
      saveToSentItems: false,
    })
}
