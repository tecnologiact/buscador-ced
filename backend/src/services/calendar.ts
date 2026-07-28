/**
 * calendar.ts
 * Consulta disponibilidade de agenda das consultoras via Microsoft Graph.
 *
 * Usa /users/{email}/calendarView por consultora, com permissão de aplicação
 * (Calendars.Read — Application). Não depende de políticas de compartilhamento
 * entre usuários, portanto funciona para qualquer conta válida do tenant,
 * incluindo contas com sufixo "externo" ou qualquer outro padrão de nomenclatura.
 *
 * Permissão necessária: Calendars.Read (Application, com Admin Consent)
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

const TIMEZONE_OFFSET = '-03:00'  // America/Sao_Paulo (horário padrão)

function minutosParaHora(minutos: number): string {
  const h = Math.floor(minutos / 60).toString().padStart(2, '0')
  const m = (minutos % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

function horaParaMinutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return h * 60 + m
}

/**
 * Dado um array de intervalos ocupados (em minutos desde meia-noite),
 * encontra slots livres de pelo menos `duracaoMinutos` dentro da janela
 * [horaInicio, horaFim].
 */
function calcularSlotsLivres(
  ocupados: { inicio: number; fim: number }[],
  horaInicio: string,
  horaFim: string,
  duracaoMinutos: number
): SlotLivre[] {
  const janelainicio = horaParaMinutos(horaInicio)
  const janelaFim    = horaParaMinutos(horaFim)

  // Ordena e mescla intervalos sobrepostos dentro da janela
  const merged: { inicio: number; fim: number }[] = []
  const dentroJanela = ocupados
    .map(o => ({
      inicio: Math.max(o.inicio, janelainicio),
      fim:    Math.min(o.fim,    janelaFim),
    }))
    .filter(o => o.inicio < o.fim)
    .sort((a, b) => a.inicio - b.inicio)

  for (const o of dentroJanela) {
    if (merged.length === 0 || o.inicio > merged[merged.length - 1].fim) {
      merged.push({ ...o })
    } else {
      merged[merged.length - 1].fim = Math.max(merged[merged.length - 1].fim, o.fim)
    }
  }

  // Encontra gaps livres
  const slots: SlotLivre[] = []
  let cursor = janelainicio

  for (const busy of merged) {
    if (busy.inicio > cursor && (busy.inicio - cursor) >= duracaoMinutos) {
      slots.push({ inicio: minutosParaHora(cursor), fim: minutosParaHora(busy.inicio) })
    }
    if (busy.fim > cursor) cursor = busy.fim
  }

  if (cursor < janelaFim && (janelaFim - cursor) >= duracaoMinutos) {
    slots.push({ inicio: minutosParaHora(cursor), fim: minutosParaHora(janelaFim) })
  }

  return slots
}

/**
 * Converte string de datetime do Graph (UTC ou com offset) para minutos
 * desde meia-noite no horário de Brasília (-03:00).
 */
function graphDateTimeParaMinutos(dateTimeStr: string, timeZone?: string): number {
  // Graph retorna no fuso especificado no Prefer header ou UTC
  // Assumimos que já está em America/Sao_Paulo
  const match = dateTimeStr.match(/T(\d{2}):(\d{2})/)
  if (!match) return 0
  return parseInt(match[1]) * 60 + parseInt(match[2])
}

/**
 * Consulta disponibilidade de múltiplas consultoras em uma janela de tempo.
 * Faz uma chamada paralela de calendarView por consultora.
 *
 * @param emails         Lista de emails das consultoras
 * @param data           Data no formato YYYY-MM-DD
 * @param horaInicio     Hora de início da janela (HH:MM)
 * @param horaFim        Hora de fim da janela (HH:MM)
 * @param duracaoMinutos Duração mínima do bloco livre necessário
 * @param _organizadorEmail  Não usado (mantido para compatibilidade de assinatura)
 */
export async function consultarDisponibilidade(
  emails: string[],
  data: string,
  horaInicio: string,
  horaFim: string,
  duracaoMinutos: number,
  _organizadorEmail: string
): Promise<DisponibilidadeConsultora[]> {
  // Inclui offset BRT (-03:00) para o Graph não interpretar como UTC
  const startDateTime = `${data}T${horaInicio}:00-03:00`
  const endDateTime   = `${data}T${horaFim}:00-03:00`

  const graph = getGraphClient()

  const resultados = await Promise.all(
    emails.map(async (email): Promise<DisponibilidadeConsultora> => {
      try {
        // NÃO usar encodeURIComponent — o Graph SDK faz o encode internamente.
        // encodeURIComponent('@' → '%40') + SDK re-encode = '%2540' → erro 404.
        const response = await graph
          .api(`/users/${email}/calendarView`)
          .header('Prefer', 'outlook.timezone="America/Sao_Paulo"')
          .query({
            startDateTime,
            endDateTime,
            $select: 'start,end,showAs,isCancelled,isAllDay',
            $top: 100,
          })
          .get()

        const eventos: any[] = response.value ?? []
        console.log(`[Graph] ${email}: ${eventos.length} evento(s) na janela ${horaInicio}-${horaFim}`)

        // Considera ocupado apenas eventos não cancelados e não marcados como livre
        const ocupados = eventos
          .filter((e: any) =>
            !e.isCancelled &&
            e.showAs !== 'free' &&
            e.showAs !== 'workingElsewhere'
          )
          .map((e: any) => {
            if (e.isAllDay) {
              return { inicio: 0, fim: 24 * 60 }
            }
            return {
              inicio: graphDateTimeParaMinutos(e.start.dateTime),
              fim:    graphDateTimeParaMinutos(e.end.dateTime),
            }
          })

        const slots = calcularSlotsLivres(ocupados, horaInicio, horaFim, duracaoMinutos)
        console.log(`[Graph] ${email}: ${slots.length} slot(s) livre(s) — ocupados: ${JSON.stringify(ocupados)}`)

        return {
          email,
          disponivel:  slots.length > 0,
          slotsLivres: slots,
        }
      } catch (err: any) {
        console.error(`[Graph] Erro ao consultar calendarView de ${email}:`, err?.message ?? err)
        return {
          email,
          disponivel:  false,
          slotsLivres: [],
          erro:         err?.message ?? String(err),
        }
      }
    })
  )

  return resultados
}
