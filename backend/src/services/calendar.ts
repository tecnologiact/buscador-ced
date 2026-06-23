/**
 * calendar.ts
 * Consulta disponibilidade de agenda das consultoras via Microsoft Graph.
 *
 * Usa calendar/getSchedule para retornar apenas free/busy,
 * sem expor detalhes dos compromissos (privacidade / LGPD).
 *
 * Permissão necessária: Calendars.Read (Application)
 */

import { getGraphClient } from '../lib/graph'

export interface SlotLivre {
  inicio: string
  fim: string
}

export interface DisponibilidadeConsultora {
  email: string
  disponivel: boolean
  slotsLivres: SlotLivre[]
  erro?: string
}

const TIMEZONE = 'America/Sao_Paulo'

/**
 * Verifica se existe um slot livre contínuo de `duracaoMinutos`
 * dentro da janela [horaInicio, horaFim] da consultora.
 *
 * O availabilityView retorna um char por intervalo de `intervalMinutos`:
 *   '0' = livre, '1' = tentativo, '2' = ocupado, '3' = fora, '4' = trabalhando remoto
 */
function extrairSlotsLivres(
  availabilityView: string,
  horaInicio: string,
  duracaoMinutos: number,
  intervalMinutos: number
): SlotLivre[] {
  const slots: SlotLivre[] = []
  const [h, m] = horaInicio.split(':').map(Number)
  let inicioMinutos = h * 60 + m

  let slotInicioMinutos: number | null = null

  for (let i = 0; i < availabilityView.length; i++) {
    const livre = availabilityView[i] === '0'
    const minutosAtuais = inicioMinutos + i * intervalMinutos

    if (livre) {
      if (slotInicioMinutos === null) slotInicioMinutos = minutosAtuais
    } else {
      if (slotInicioMinutos !== null) {
        const duracao = minutosAtuais - slotInicioMinutos
        if (duracao >= duracaoMinutos) {
          slots.push({
            inicio: minutosParaHora(slotInicioMinutos),
            fim:    minutosParaHora(minutosAtuais),
          })
        }
        slotInicioMinutos = null
      }
    }
  }

  // Verificar último bloco livre
  if (slotInicioMinutos !== null) {
    const fimMinutos = inicioMinutos + availabilityView.length * intervalMinutos
    const duracao = fimMinutos - slotInicioMinutos
    if (duracao >= duracaoMinutos) {
      slots.push({
        inicio: minutosParaHora(slotInicioMinutos),
        fim:    minutosParaHora(fimMinutos),
      })
    }
  }

  return slots
}

function minutosParaHora(minutos: number): string {
  const h = Math.floor(minutos / 60).toString().padStart(2, '0')
  const m = (minutos % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

/**
 * Consulta disponibilidade de múltiplas consultoras em uma janela de tempo.
 *
 * @param emails         Lista de emails das consultoras
 * @param data           Data no formato YYYY-MM-DD
 * @param horaInicio     Hora de início no formato HH:MM
 * @param horaFim        Hora de fim no formato HH:MM
 * @param duracaoMinutos Duração mínima do bloco livre necessário
 * @param organizadorEmail Email de um usuário do tenant para autenticar a consulta
 */
export async function consultarDisponibilidade(
  emails: string[],
  data: string,
  horaInicio: string,
  horaFim: string,
  duracaoMinutos: number,
  organizadorEmail: string
): Promise<DisponibilidadeConsultora[]> {
  const INTERVALO = 30 // minutos por slot no availabilityView

  const startDateTime = `${data}T${horaInicio}:00`
  const endDateTime   = `${data}T${horaFim}:00`

  let scheduleData: any

  try {
    scheduleData = await getGraphClient()
      .api(`/users/${organizadorEmail}/calendar/getSchedule`)
      .post({
        schedules:                emails,
        startTime:                { dateTime: startDateTime, timeZone: TIMEZONE },
        endTime:                  { dateTime: endDateTime,   timeZone: TIMEZONE },
        availabilityViewInterval: INTERVALO,
      })
  } catch (err: any) {
    console.error('[Graph] Erro ao consultar getSchedule:', err?.message)
    // Retorna todas como indisponíveis com o erro
    return emails.map(email => ({
      email,
      disponivel: false,
      slotsLivres: [],
      erro: `Erro na consulta Graph: ${err?.message}`,
    }))
  }

  const resultado: DisponibilidadeConsultora[] = []

  for (const item of scheduleData.value ?? []) {
    const email: string = item.scheduleId

    if (item.error) {
      resultado.push({
        email,
        disponivel: false,
        slotsLivres: [],
        erro: item.error.message,
      })
      continue
    }

    const view: string = item.availabilityView ?? ''
    const slots = extrairSlotsLivres(view, horaInicio, duracaoMinutos, INTERVALO)

    resultado.push({
      email,
      disponivel: slots.length > 0,
      slotsLivres: slots,
    })
  }

  return resultado
}
