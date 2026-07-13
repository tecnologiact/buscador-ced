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
 *   - Em todos os casos é retornada uma justificativa e, quando aplicável, um substituto
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
  justificativa?: string  // explicação de por que foi selecionada (ou não disponível)
  historico_entregas?: number  // total de demandas aceitas nessa skill
}

export interface SubstitutoSugerido {
  consultora: ConsultoraElegivel
  motivo_exclusao: string    // por que a busca original não encontrou resultado
  motivo_substituto: string  // por que essa consultora é a melhor alternativa
}

export interface ResultadoMatching {
  status:
    | 'ok'
    | 'sem_consultora_elegivel'
    | 'sem_disponibilidade'
    | 'erro_graph'
  mensagem: string
  motivo_detalhado?: string          // explicação técnica do motivo da falha
  elegíveis: ConsultoraElegivel[]
  selecionadas: ConsultoraElegivel[] // até 3 disponíveis
  substituto?: SubstitutoSugerido    // sugerido quando a busca principal falha
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

// Gera justificativa de seleção para uma consultora disponível
function gerarJustificativaDisponivel(
  c: ConsultoraElegivel,
  skillNome: string,
  idioma?: string,
  publicoAlvo?: string,
): string {
  const partes: string[] = []

  partes.push(`Nota ${c.nivel} em "${skillNome}"`)

  if (c.slotsLivres.length > 0) {
    const slots = c.slotsLivres.map(s => `${s.inicio}–${s.fim}`).join(', ')
    partes.push(`agenda livre: ${slots}`)
  }

  if (idioma && idioma !== 'Português') {
    partes.push(`idioma "${idioma}" compatível`)
  }

  if (publicoAlvo) {
    partes.push(`público-alvo considerado`)
  }

  return partes.join(' · ')
}

// Gera justificativa para consultora elegível mas sem disponibilidade
function gerarJustificativaIndisponivel(c: ConsultoraElegivel, skillNome: string): string {
  if (c.motivo) return `Nota ${c.nivel} em "${skillNome}", mas agenda indisponível: ${c.motivo}`
  return `Nota ${c.nivel} em "${skillNome}", mas sem horário livre na data solicitada`
}

// Mapeia texto livre de público-alvo para tags padronizadas de consultoras
function mapearPublicoAlvo(publicoAlvo: string): string[] {
  const s = publicoAlvo.toLowerCase()
  const tags: string[] = []
  if (s.includes('estagiár') || s.includes('estagi')) tags.push('Estagiário')
  if (s.includes('trainee') || s.includes('trainées')) tags.push('Trainee')
  if (s.includes('jovem') || s.includes('jovens') || s.includes('jovem talent') || s.includes('jovens talent')) {
    tags.push('Estagiário', 'Trainee')
  }
  if (s.includes('primeir') && s.includes('lider')) tags.push('Primeira liderança')
  if ((s.includes('média') || s.includes('media') || s.includes('mid')) && s.includes('lider')) {
    tags.push('Média liderança')
  }
  if (s.includes('alta') || s.includes('c-level') || s.includes('clevel') || s.includes('diret') || s.includes('executiv')) {
    tags.push('Alta liderança / C-Level')
  }
  if (s.includes('especialista') || s.includes('técnic') || s.includes('tecnic')) tags.push('Especialistas técnicos')
  // Genérico "liderança" sem especificar nível → todos os níveis de liderança
  if (s.includes('lideranç') && !s.includes('primeir') && !s.includes('média') && !s.includes('alta')) {
    tags.push('Primeira liderança', 'Média liderança', 'Alta liderança / C-Level')
  }
  return [...new Set(tags)]
}

// Verifica se o idioma da consultora é compatível com o idioma exigido
function idiomaCompativel(idiomaConsultora: string, idiomaDemanda: string): boolean {
  if (!idiomaDemanda || idiomaDemanda === 'Português') return true
  const c = idiomaConsultora ?? 'Português'
  if (idiomaDemanda === 'Inglês')          return c === 'Inglês' || c === 'Bilíngue PT/EN'
  if (idiomaDemanda === 'Espanhol')        return c === 'Espanhol' || c === 'Bilíngue PT/ES'
  if (idiomaDemanda === 'Bilíngue PT/EN')  return c === 'Inglês' || c === 'Bilíngue PT/EN'
  if (idiomaDemanda === 'Bilíngue PT/ES')  return c === 'Espanhol' || c === 'Bilíngue PT/ES'
  return true
}

// Busca a melhor substituta disponível relaxando os filtros (idioma → qualquer elegível)
async function buscarSubstituto(
  elegíveisBase: any[],
  elegíveisPorIdioma: any[],
  skillNome: string,
  data: string,
  horaInicio: string,
  horaFim: string,
  duracaoMinutos: number,
  idioma: string | undefined,
  organizador: string,
): Promise<ConsultoraElegivel | null> {
  // Pool de candidatas: quem foi eliminado pelo idioma (se houver) ou toda a base
  const pool = elegíveisPorIdioma.length < elegíveisBase.length
    ? elegíveisBase
    : elegíveisBase

  if (pool.length === 0) return null

  const emails = pool.map((p: any) => p.consultoras.email as string)
  let disponibilidades: DisponibilidadeConsultora[] = []
  try {
    disponibilidades = await consultarDisponibilidade(emails, data, horaInicio, horaFim, duracaoMinutos, organizador)
  } catch {
    return null
  }

  const mapDisp = new Map(disponibilidades.map(d => [d.email, d]))
  const candidatas = pool
    .map((p: any) => {
      const c = p.consultoras
      const disp = mapDisp.get(c.email)
      return {
        consultora_id: c.id as string,
        nome:          c.nome as string,
        email:         c.email as string,
        nota:          p.nota as number,
        nivel:         notaParaNivel(p.nota),
        disponivel:    disp?.disponivel ?? false,
        slotsLivres:   disp?.slotsLivres ?? [],
        motivo:        disp?.erro,
      } as ConsultoraElegivel
    })
    .filter(c => c.disponivel)
    .sort((a, b) => b.nota - a.nota)

  return candidatas[0] ?? null
}

export async function executarMatching(params: {
  skillNome: string
  data: string
  horaInicio: string
  horaFim: string
  duracaoMinutos: number
  modalidade: string
  idioma?: string
  publicoAlvo?: string
}): Promise<ResultadoMatching> {
  const { skillNome, data, horaInicio, horaFim, duracaoMinutos, modalidade, idioma, publicoAlvo } = params

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
      mensagem: `A skill "${skillNome}" não está no catálogo.`,
      motivo_detalhado: `O tema "${skillNome}" não foi encontrado na base de skills ativas. Verifique se o nome está correto ou cadastre a skill antes de criar a demanda.`,
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
        modalidade,
        idioma,
        publicos
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
      motivo_detalhado: 'Falha na consulta ao banco de dados. Tente novamente em instantes.',
      elegíveis: [],
      selecionadas: [],
    }
  }

  // Filtrar apenas consultoras ativas
  const elegíveisBase = (pares ?? []).filter((p: any) => p.consultoras?.ativo === true)

  // Filtrar por modalidade se for presencial/híbrido
  const elegíveisPorModalidade = elegíveisBase.filter((p: any) => {
    if (modalidade === 'online') return true
    if (modalidade === 'presencial' || modalidade === 'hibrido') {
      return p.consultoras?.modalidade !== 'Online'
    }
    return true
  })

  // Filtrar por idioma (hard filter — idioma incompatível exclui a consultora)
  const elegíveisPorIdioma = elegíveisPorModalidade.filter((p: any) => {
    return idiomaCompativel(p.consultoras?.idioma ?? 'Português', idioma ?? '')
  })

  const idiomaEliminouCandidatas =
    idioma && idioma !== 'Português' &&
    elegíveisPorIdioma.length < elegíveisPorModalidade.length

  // Filtrar por público-alvo (soft filter — se nenhuma consultora bate, usa todas)
  let elegíveisFiltrados = elegíveisPorIdioma
  let publicoAplicado = false
  if (publicoAlvo && publicoAlvo.trim().length > 0) {
    const tags = mapearPublicoAlvo(publicoAlvo)
    if (tags.length > 0) {
      const porPublico = elegíveisPorIdioma.filter((p: any) => {
        const publs: string = p.consultoras?.publicos ?? ''
        return tags.some(tag => publs.includes(tag))
      })
      if (porPublico.length > 0) {
        elegíveisFiltrados = porPublico
        publicoAplicado = true
      }
    }
  }

  // ----------------------------------------------------------------
  // Sem elegíveis após todos os filtros
  // ----------------------------------------------------------------
  if (elegíveisFiltrados.length === 0) {
    const organizador = process.env.EMAIL_FROM ?? ''

    if (idioma && idioma !== 'Português' && elegíveisPorModalidade.length > 0) {
      // Há consultoras com a skill, mas nenhuma fala o idioma pedido
      // Tentar sugerir a melhor que fala Português como substituta
      const sub = await buscarSubstituto(
        elegíveisPorModalidade, elegíveisPorIdioma,
        skillNome, data, horaInicio, horaFim, duracaoMinutos, idioma, organizador,
      )

      const nomes = elegíveisPorModalidade
        .slice(0, 3)
        .map((p: any) => p.consultoras.nome)
        .join(', ')

      const resultado: ResultadoMatching = {
        status: 'sem_consultora_elegivel',
        mensagem: `Nenhuma consultora com nota suficiente em "${skillNome}" faz entregas em ${idioma}.`,
        motivo_detalhado: `As consultoras com essa skill (${nomes}) não atendem ao idioma "${idioma}" exigido. Considere solicitar em Português ou consultar o time de C&D para verificar disponibilidade de profissionais externos.`,
        elegíveis: [],
        selecionadas: [],
      }

      if (sub) {
        resultado.substituto = {
          consultora: {
            ...sub,
            justificativa: `Melhor nota em "${skillNome}" com agenda disponível. Entrega em Português — o idioma ${idioma} não está em seu perfil, mas pode ser avaliado caso a caso com o time de C&D.`,
          },
          motivo_exclusao: `Nenhuma das ${elegíveisPorModalidade.length} consultoras elegíveis tem perfil para entregas em ${idioma}.`,
          motivo_substituto: `${sub.nome} possui ${sub.nivel} em "${skillNome}" e está disponível na data — é a melhor alternativa disponível, mesmo sem o idioma solicitado.`,
        }
      }

      return resultado
    }

    // Nenhuma consultora com nota ≥ 2 nessa skill
    const resultado: ResultadoMatching = {
      status: 'sem_consultora_elegivel',
      mensagem: `Nenhuma consultora possui nota suficiente em "${skillNome}".`,
      motivo_detalhado: `Não há consultoras com nota Praticante (2) ou Mestre (3) cadastradas para o tema "${skillNome}". Isso vale para qualquer data. É necessário mapear ou treinar novas consultoras para essa skill.`,
      elegíveis: [],
      selecionadas: [],
    }

    // Tentar sugerir quem tem nota 1 (Aprendiz) como futuro candidato
    const { data: paresAprendiz } = await supabase
      .from('consultora_skills')
      .select('nota, consultoras(id, nome, email, ativo, modalidade, idioma, publicos)')
      .eq('skill_id', skill.id)
      .eq('nota', 1)

    const aprendizes = (paresAprendiz ?? []).filter((p: any) => p.consultoras?.ativo === true)
    if (aprendizes.length > 0) {
      const melhor = aprendizes[0] as any
      resultado.substituto = {
        consultora: {
          consultora_id: melhor.consultoras.id,
          nome:          melhor.consultoras.nome,
          email:         melhor.consultoras.email,
          nota:          1,
          nivel:         'Aprendiz',
          disponivel:    false,
          slotsLivres:   [],
          justificativa: `Possui nota Aprendiz em "${skillNome}". Ainda não está elegível para entrega autônoma (nota < 2), mas pode ser desenvolvida para essa skill.`,
        },
        motivo_exclusao: `Não há consultoras com nota ≥ 2 em "${skillNome}".`,
        motivo_substituto: `${melhor.consultoras.nome} tem familiaridade com o tema (Aprendiz). Com capacitação adicional, pode atingir o nível Praticante. Contate o time de C&D para avaliar.`,
      }
    }

    return resultado
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
    const disponivel = disp?.disponivel ?? false
    const base: ConsultoraElegivel = {
      consultora_id: c.id,
      nome:          c.nome,
      email:         c.email,
      nota:          p.nota,
      nivel:         notaParaNivel(p.nota),
      disponivel,
      slotsLivres:   disp?.slotsLivres ?? [],
      motivo:        disp?.erro,
    }
    return base
  })

  // ----------------------------------------------------------------
  // C14: Buscar histórico de entregas aceitas por consultora nessa skill
  // ----------------------------------------------------------------
  const todosIds = elegíveisCompletos.map(c => c.consultora_id)
  const historicoMap = new Map<string, number>()
  try {
    const { data: historicoRows } = await supabase
      .from('sugestoes_consultoras')
      .select('consultora_id, demanda_id')
      .in('consultora_id', todosIds)
      .eq('resposta', 'aceita')
      // filtra demandas que tenham a mesma skill
      .not('demanda_id', 'is', null)

    // Para filtrar por skill_id, fazemos join in-memory (evita query complexa)
    if (historicoRows && historicoRows.length > 0) {
      const demandaIds = [...new Set(historicoRows.map((r: any) => r.demanda_id))]
      const { data: demandasComSkill } = await supabase
        .from('demandas')
        .select('id')
        .in('id', demandaIds)
        .eq('skill_id', skill.id)
      const demandaIdsComSkill = new Set((demandasComSkill ?? []).map((d: any) => d.id))
      historicoRows.forEach((r: any) => {
        if (demandaIdsComSkill.has(r.demanda_id)) {
          historicoMap.set(r.consultora_id, (historicoMap.get(r.consultora_id) ?? 0) + 1)
        }
      })
    }
  } catch (e) {
    console.warn('[Matching] Não foi possível carregar histórico de entregas:', e)
  }

  // Enriquecer elegíveisCompletos com historico_entregas
  elegíveisCompletos.forEach(c => {
    c.historico_entregas = historicoMap.get(c.consultora_id) ?? 0
  })

  // Selecionar até 3 disponíveis (já ordenadas por nota DESC pelo Supabase)
  const disponiveis = elegíveisCompletos.filter(c => c.disponivel)
  const selecionadas = disponiveis.slice(0, 3).map(c => ({
    ...c,
    justificativa: gerarJustificativaDisponivel(c, skillNome, idioma, publicoAplicado ? publicoAlvo : undefined),
  }))

  // Enriquecer indisponíveis com justificativa
  const elegíveisComJustif = elegíveisCompletos.map(c => ({
    ...c,
    justificativa: c.disponivel
      ? gerarJustificativaDisponivel(c, skillNome, idioma, publicoAplicado ? publicoAlvo : undefined)
      : gerarJustificativaIndisponivel(c, skillNome),
  }))

  if (selecionadas.length === 0) {
    // Nenhuma disponível — sugerir a de maior nota para contato direto
    const melhorElegivel = elegíveisComJustif.sort((a, b) => b.nota - a.nota)[0]

    const nomesIndisp = elegíveisCompletos
      .slice(0, 3)
      .map(c => `${c.nome} (${c.nivel})`)
      .join(', ')

    return {
      status: erroGraph ? 'erro_graph' : 'sem_disponibilidade',
      mensagem: erroGraph
        ? 'Há consultoras elegíveis, mas não foi possível consultar a agenda (erro no Microsoft Graph).'
        : `Há consultoras com a skill "${skillNome}", mas nenhuma está disponível em ${data}.`,
      motivo_detalhado: erroGraph
        ? `Erro ao acessar o Microsoft Graph. As seguintes consultoras estão elegíveis: ${nomesIndisp}. Verifique a configuração do Graph ou tente novamente.`
        : `As consultoras elegíveis (${nomesIndisp}) estão com agenda ocupada na data ${data}. Tente outra data ou contate diretamente a sugerida abaixo.`,
      elegíveis: elegíveisComJustif,
      selecionadas: [],
      substituto: melhorElegivel ? {
        consultora: melhorElegivel,
        motivo_exclusao: `Todas as ${elegíveisCompletos.length} consultoras elegíveis estão com agenda indisponível em ${data}.`,
        motivo_substituto: `${melhorElegivel.nome} é a consultora com maior nota em "${skillNome}" (${melhorElegivel.nivel}). Recomenda-se contato direto para verificar possibilidade de ajuste de agenda.`,
      } : undefined,
    }
  }

  return {
    status: 'ok',
    mensagem: `${selecionadas.length} consultora(s) disponível(is) encontrada(s).`,
    elegíveis: elegíveisComJustif,
    selecionadas,
  }
}
