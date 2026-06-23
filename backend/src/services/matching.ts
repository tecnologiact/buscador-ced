/**
 * matching.ts
 * Motor de matching determinístico: skill + nota + disponibilidade Outlook.
 *
 * Regras de negócio:
 *   - Apenas consultoras com nota 2 (Praticante) ou 3 (Mestre) são elegíveis
 *   - Nota 3 é priorizada sobre nota 2
 *   - Retorna até 3 consultoras disponíveis
 *   - Se nenhuma consultora tiver nota 2 ou 3 → sem_consultora_elegivel
 *   - Se houver elegíveis mas nenhuma disponível → sem_disponibilidade
 */

import { supabase } from '../lib/supabase'
import { consultarDisponibilidade, DisponibilidadeConsultora } from './calendar'

export interface ConsultoraElegivel {
  consultora_id: string
  nome: string
  email: string
  nota: number
  nivel: string
  disponivel: boolean
  slotsLivres: { inicio: string; fim: string }[]
  motivo?: string
}

export interface ResultadoMatching {
  status:
    | 'ok'
    | 'sem_consultora_elegivel'
    | 'sem_disponibilidade'
    | 'erro_graph'
  mensagem: string
  elegíveis: ConsultoraElegivel[]
  selecionadas: ConsultoraElegivel[]  // até 3 disponíveis
}

function notaParaNivel(nota: number): string {
  const mapa: Record<number, string> = {
    3: 'Mestre',
    2: 'Praticante',
    1: 'Aprendiz',
    0: 'Não possuo',
  }
  return mapa[nota] ?? String(nota)
}

export async function executarMatching(params: {
  skillNome: string
  data: string
  horaInicio: string
  horaFim: string
  duracaoMinutos: number
  modalidade: string
}): Promise<ResultadoMatching> {
  const { skillNome, data, horaInicio, horaFim, duracaoMinutos, modalidade } = params

  // ----------------------------------------------------------------
  // 1. Buscar skill pelo nome
  // ----------------------------------------------------------------
  const { data: skill, error: skillErr } = await supabase
    .from('skills')
    .select('id, nome')
    .eq('nome', skillNome)
    .eq('ativo', true)
    .single()

  if (skillErr || !skill) {
    return {
      status: 'sem_consultora_elegivel',
      mensagem: `Skill "${skillNome}" não encontrada no catálogo.`,
      elegíveis: [],
      selecionadas: [],
    }
  }

  // ----------------------------------------------------------------
  // 2. Buscar consultoras elegíveis (nota >= 2, ativas)
  // ----------------------------------------------------------------
  const { data: pares, error: paresErr } = await supabase
    .from('consultora_skills')
    .select(`
      nota,
      consultoras (
        id,
        nome,
        email,
        ativo,
        modalidade
      )
    `)
    .eq('skill_id', skill.id)
    .gte('nota', 2)
    .order('nota', { ascending: false })

  if (paresErr) {
    console.error('[Matching] Erro ao buscar consultora_skills:', paresErr)
    return {
      status: 'sem_consultora_elegivel',
      mensagem: 'Erro ao consultar base de consultoras.',
      elegíveis: [],
      selecionadas: [],
    }
  }

  // Filtrar apenas consultoras ativas
  const elegíveisBase = (pares ?? []).filter((p: any) => p.consultoras?.ativo === true)

  // Filtrar por modalidade se for presencial
  const elegíveisFiltrados = elegíveisBase.filter((p: any) => {
    if (modalidade === 'online') return true
    if (modalidade === 'presencial' || modalidade === 'hibrido') {
      // Consultoras que só fazem online não podem para presencial
      return p.consultoras?.modalidade !== 'Online'
    }
    return true
  })

  if (elegíveisFiltrados.length === 0) {
    return {
      status: 'sem_consultora_elegivel',
      mensagem: `Não há consultoras elegíveis para a skill "${skillNome}".`,
      elegíveis: [],
      selecionadas: [],
    }
  }

  // ----------------------------------------------------------------
  // 3. Consultar disponibilidade no Outlook via Microsoft Graph
  // ----------------------------------------------------------------
  const organizador = process.env.EMAIL_FROM
  if (!organizador) {
    throw new Error('EMAIL_FROM não definido no .env — necessário para consultar o Graph')
  }

  const emails = elegíveisFiltrados.map((p: any) => p.consultoras.email as string)

  let disponibilidades: DisponibilidadeConsultora[] = []
  let erroGraph = false

  try {
    disponibilidades = await consultarDisponibilidade(
      emails,
      data,
      horaInicio,
      horaFim,
      duracaoMinutos,
      organizador
    )
  } catch (err: any) {
    console.error('[Matching] Erro no Graph:', err?.message)
    erroGraph = true
    // Continua sem disponibilidade — não bloqueia o fluxo completamente
    disponibilidades = emails.map(email => ({
      email,
      disponivel: false,
      slotsLivres: [],
      erro: err?.message,
    }))
  }

  // ----------------------------------------------------------------
  // 4. Montar resultado combinando nota + disponibilidade
  // ----------------------------------------------------------------
  const mapDisponibilidade = new Map(
    disponibilidades.map(d => [d.email, d])
  )

  const elegíveisCompletos: ConsultoraElegivel[] = elegíveisFiltrados.map((p: any) => {
    const c = p.consultoras
    const disp = mapDisponibilidade.get(c.email)
    return {
      consultora_id: c.id,
      nome:          c.nome,
      email:         c.email,
      nota:          p.nota,
      nivel:         notaParaNivel(p.nota),
      disponivel:    disp?.disponivel ?? false,
      slotsLivres:   disp?.slotsLivres ?? [],
      motivo:        disp?.erro,
    }
  })

  // Selecionar até 3 disponíveis (já ordenadas por nota DESC pelo Supabase)
  const selecionadas = elegíveisCompletos
    .filter(c => c.disponivel)
    .slice(0, 3)

  if (selecionadas.length === 0) {
    return {
      status: erroGraph ? 'erro_graph' : 'sem_disponibilidade',
      mensagem: erroGraph
        ? 'Há consultoras elegíveis, mas não foi possível consultar a agenda (erro no Microsoft Graph).'
        : 'Há consultoras elegíveis, mas nenhuma está disponível no período informado.',
      elegíveis: elegíveisCompletos,
      selecionadas: [],
    }
  }

  return {
    status: 'ok',
    mensagem: `${selecionadas.length} consultora(s) disponível(is) encontrada(s).`,
    elegíveis: elegíveisCompletos,
    selecionadas,
  }
}
