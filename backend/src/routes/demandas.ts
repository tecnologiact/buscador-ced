/**
 * demandas.ts
 * Rotas principais do buscador C&D.
 *
 * POST /api/demandas              → cria demanda e executa matching
 * POST /api/demandas/:id/match    → reexecuta matching
 * POST /api/demandas/:id/acionar  → aciona consultora manualmente
 * GET  /api/demandas              → lista para painel
 * GET  /api/demandas/:id          → detalhe com sugestões e histórico
 */

import { Router, Request, Response } from 'express'
import { z } from 'zod'
import { supabase } from '../lib/supabase'
import { executarMatching } from '../services/matching'
import { enviarEmailAcionamento } from '../services/email'

export const demandasRouter = Router()

// ----------------------------------------------------------------
// Schema de validação da demanda
// ----------------------------------------------------------------
const DemandaSchema = z.object({
  cliente:         z.string().min(1),
  skill:           z.string().min(1),
  formato:         z.string().min(1),
  data:            z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato: YYYY-MM-DD'),
  horaInicio:      z.string().regex(/^\d{2}:\d{2}$/, 'Formato: HH:MM').optional(),
  horaFim:         z.string().regex(/^\d{2}:\d{2}$/, 'Formato: HH:MM').optional(),
  duracaoMinutos:  z.number().int().positive(),
  modalidade:      z.enum(['online', 'presencial', 'hibrido']),
  observacoes:     z.string().optional(),
  numSessoes:      z.number().int().positive().optional(),
})

// ----------------------------------------------------------------
// POST /api/demandas
// ----------------------------------------------------------------
demandasRouter.post('/', async (req: Request, res: Response) => {
  const parse = DemandaSchema.safeParse(req.body)
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos', detalhes: parse.error.flatten() })
  }

  const body = parse.data
  const dryRun = req.query.dry_run === 'true'

  // ── DRY RUN: só matching, sem gravar no banco ───────────────────
  if (dryRun) {
    const matching = await executarMatching({
      skillNome:      body.skill,
      data:           body.data,
      horaInicio:     body.horaInicio ?? '08:00',
      horaFim:        body.horaFim    ?? '19:00',
      duracaoMinutos: body.duracaoMinutos,
      modalidade:     body.modalidade,
    })
    const novoStatus = matching.status === 'ok'
      ? 'consultoras_encontradas'
      : matching.status === 'sem_consultora_elegivel'
      ? 'sem_consultora_elegivel'
      : 'sem_disponibilidade'
    return res.status(200).json({
      status:      novoStatus,
      mensagem:    matching.mensagem,
      selecionadas: matching.selecionadas,
      elegiveis:   matching.elegíveis,
    })
  }

  // 1. Buscar skill_id
  const { data: skill } = await supabase
    .from('skills')
    .select('id, nome')
    .eq('nome', body.skill)
    .single()

  // 2. Criar demanda
  const { data: demanda, error: demandaErr } = await supabase
    .from('demandas')
    .insert({
      cliente:         body.cliente,
      skill_id:        skill?.id ?? null,
      skill_nome:      body.skill,
      formato:         body.formato,
      data_entrega:    body.data,
      hora_inicio:     body.horaInicio ?? null,
      hora_fim:        body.horaFim    ?? null,
      duracao_minutos: body.duracaoMinutos,
      modalidade:      body.modalidade,
      observacoes:     body.observacoes ?? null,
      status:          'criada',
      criado_por:      (req as any).user?.email ?? 'sistema',
    })
    .select()
    .single()

  if (demandaErr || !demanda) {
    return res.status(500).json({ erro: 'Erro ao criar demanda', detalhe: demandaErr?.message })
  }

  // 3. Executar matching (dia completo se não informar hora)
  const matching = await executarMatching({
    skillNome:      body.skill,
    data:           body.data,
    horaInicio:     body.horaInicio ?? '08:00',
    horaFim:        body.horaFim    ?? '19:00',
    duracaoMinutos: body.duracaoMinutos,
    modalidade:     body.modalidade,
  })

  // 4. Atualizar status da demanda
  const novoStatus = matching.status === 'ok'
    ? 'consultoras_encontradas'
    : matching.status === 'sem_consultora_elegivel'
    ? 'sem_consultora_elegivel'
    : 'sem_disponibilidade'

  await supabase
    .from('demandas')
    .update({ status: novoStatus })
    .eq('id', demanda.id)

  // 5. Persistir sugestões
  if (matching.selecionadas.length > 0) {
    const sugestoes = matching.selecionadas.map((c, i) => ({
      demanda_id:      demanda.id,
      consultora_id:   c.consultora_id,
      nota:            c.nota,
      slots_disponiveis: c.slotsLivres,
      ordem_sugerida:  i + 1,
      status:          'sugerida',
    }))

    await supabase.from('sugestoes_consultoras').insert(sugestoes)
    // Aguarda confirmação manual — não aciona automaticamente
  }

  return res.status(201).json({
    demanda_id: demanda.id,
    status:     novoStatus,
    mensagem:   matching.mensagem,
    selecionadas: matching.selecionadas,
    elegiveis:  matching.elegíveis,
  })
})

// ----------------------------------------------------------------
// POST /api/demandas/:id/match
// Reexecuta o matching (útil se a demanda ficou sem disponibilidade)
// ----------------------------------------------------------------
demandasRouter.post('/:id/match', async (req: Request, res: Response) => {
  const { data: demanda, error } = await supabase
    .from('demandas')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (error || !demanda) {
    return res.status(404).json({ erro: 'Demanda não encontrada' })
  }

  const matching = await executarMatching({
    skillNome:      demanda.skill_nome,
    data:           demanda.data_entrega,
    horaInicio:     demanda.hora_inicio,
    horaFim:        demanda.hora_fim,
    duracaoMinutos: demanda.duracao_minutos,
    modalidade:     demanda.modalidade,
  })

  return res.json({
    status:      matching.status,
    mensagem:    matching.mensagem,
    selecionadas: matching.selecionadas,
    elegiveis:   matching.elegíveis,
  })
})

// ----------------------------------------------------------------
// POST /api/demandas/:id/selecionar
// Usuário seleciona quais consultoras quer salvar no painel.
// Muda status da demanda para aguardando_aceite.
// Marca as sugestões escolhidas como 'acionada' (sem enviar e-mail).
// ----------------------------------------------------------------
demandasRouter.post('/:id/selecionar', async (req: Request, res: Response) => {
  const { consultora_ids } = req.body as { consultora_ids: string[] }

  if (!Array.isArray(consultora_ids) || consultora_ids.length === 0) {
    return res.status(400).json({ erro: 'Informe ao menos uma consultora_id' })
  }

  const { error } = await supabase
    .from('demandas')
    .update({ status: 'aguardando_aceite' })
    .eq('id', req.params.id)

  if (error) {
    return res.status(500).json({ erro: 'Erro ao atualizar demanda', detalhe: error.message })
  }

  // Marcar consultoras selecionadas (sem enviar e-mail ainda)
  for (const cid of consultora_ids) {
    await supabase
      .from('sugestoes_consultoras')
      .update({ status: 'acionada' })
      .eq('demanda_id', req.params.id)
      .eq('consultora_id', cid)
  }

  return res.json({ mensagem: 'Demanda salva no Painel com sucesso.' })
})

// ----------------------------------------------------------------
// POST /api/demandas/:id/acionar
// Aciona manualmente uma consultora específica (ou a próxima da lista)
// ----------------------------------------------------------------
demandasRouter.post('/:id/acionar', async (req: Request, res: Response) => {
  const { consultora_id } = req.body

  const { data: demanda } = await supabase
    .from('demandas')
    .select('*')
    .eq('id', req.params.id)
    .single()

  if (!demanda) {
    return res.status(404).json({ erro: 'Demanda não encontrada' })
  }

  // Buscar consultora na lista de sugestões
  const { data: sugestao } = await supabase
    .from('sugestoes_consultoras')
    .select('*, consultoras(nome, email)')
    .eq('demanda_id', req.params.id)
    .eq('consultora_id', consultora_id)
    .single()

  if (!sugestao) {
    return res.status(404).json({ erro: 'Consultora não está na lista de sugestões desta demanda' })
  }

  const consultora = sugestao.consultoras as any
  await acionarConsultora(demanda.id, {
    consultora_id,
    nome:        consultora.nome,
    email:       consultora.email,
    nota:        sugestao.nota,
    nivel:       '',
    disponivel:  true,
    slotsLivres: [],
  }, demanda)

  return res.json({ mensagem: `Consultora ${consultora.nome} acionada com sucesso.` })
})

// ----------------------------------------------------------------
// GET /api/demandas
// Lista para o painel Brunno/Dani
// ----------------------------------------------------------------
demandasRouter.get('/', async (req: Request, res: Response) => {
  const { status, data_inicio, data_fim } = req.query as Record<string, string>

  let query = supabase
    .from('vw_painel_demandas')
    .select('*')
    .order('criado_em', { ascending: false })

  if (status) query = query.eq('status', status)
  if (data_inicio) query = query.gte('data_entrega', data_inicio)
  if (data_fim) query = query.lte('data_entrega', data_fim)

  const { data, error } = await query

  if (error) {
    return res.status(500).json({ erro: 'Erro ao listar demandas', detalhe: error.message })
  }

  return res.json(data)
})

// ----------------------------------------------------------------
// GET /api/demandas/:id
// Detalhe com sugestões e histórico
// ----------------------------------------------------------------
demandasRouter.get('/:id', async (req: Request, res: Response) => {
  const [{ data: demanda }, { data: sugestoes }, { data: historico }] = await Promise.all([
    supabase.from('demandas').select('*').eq('id', req.params.id).single(),
    supabase.from('vw_sugestoes_detalhadas').select('*').eq('demanda_id', req.params.id),
    supabase.from('historico_status').select('*').eq('demanda_id', req.params.id).order('criado_em'),
  ])

  if (!demanda) {
    return res.status(404).json({ erro: 'Demanda não encontrada' })
  }

  return res.json({ demanda, sugestoes, historico })
})

// ----------------------------------------------------------------
// Função auxiliar: acionar consultora (cria notificação + envia e-mail)
// ----------------------------------------------------------------
async function acionarConsultora(
  demandaId: string,
  consultora: { consultora_id: string; nome: string; email: string; nota: number; nivel: string; disponivel: boolean; slotsLivres: any[] },
  demandaDados: any
): Promise<void> {
  const TTL_HORAS = parseInt(process.env.RESPONSE_TOKEN_TTL_HOURS ?? '48', 10)
  const expira = new Date(Date.now() + TTL_HORAS * 60 * 60 * 1000).toISOString()

  // Criar notificação com token único
  const { data: notif, error: notifErr } = await supabase
    .from('notificacoes')
    .insert({
      demanda_id:      demandaId,
      consultora_id:   consultora.consultora_id,
      canal:           'email',
      status:          'enviada',
      enviado_em:      new Date().toISOString(),
      token_expira_em: expira,
    })
    .select()
    .single()

  if (notifErr || !notif) {
    console.error('[Acionamento] Erro ao criar notificação:', notifErr)
    return
  }

  // Atualizar sugestão para "acionada"
  await supabase
    .from('sugestoes_consultoras')
    .update({ status: 'acionada' })
    .eq('demanda_id', demandaId)
    .eq('consultora_id', consultora.consultora_id)

  // Enviar e-mail via Graph
  const emailRemetente = process.env.EMAIL_FROM
  if (!emailRemetente) {
    console.warn('[Acionamento] EMAIL_FROM não configurado — e-mail não enviado')
    return
  }

  try {
    await enviarEmailAcionamento({
      para:            consultora.email,
      nomeConsultora:  consultora.nome,
      cliente:         demandaDados.cliente,
      skill:           demandaDados.skill_nome ?? demandaDados.skill,
      formato:         demandaDados.formato,
      data:            demandaDados.data_entrega ?? demandaDados.data,
      horaInicio:      demandaDados.hora_inicio ?? demandaDados.horaInicio,
      horaFim:         demandaDados.hora_fim ?? demandaDados.horaFim,
      duracaoMinutos:  demandaDados.duracao_minutos ?? demandaDados.duracaoMinutos,
      modalidade:      demandaDados.modalidade,
      observacoes:     demandaDados.observacoes,
      tokenAceite:     notif.token_resposta,
      tokenRecusa:     notif.token_resposta,
      tokenObservacao: notif.token_resposta,
      notificacaoId:   notif.id,
    }, emailRemetente)

    console.log(`[Acionamento] E-mail enviado para ${consultora.email}`)
  } catch (err: any) {
    console.error('[Acionamento] Erro ao enviar e-mail:', err?.message)
    await supabase
      .from('notificacoes')
      .update({ status: 'erro_envio' })
      .eq('id', notif.id)
  }
}

// ----------------------------------------------------------------
// Função exportada: aciona próxima consultora após recusa
// ----------------------------------------------------------------
export async function acionarProximaConsultora(demandaId: string): Promise<void> {
  // Buscar próxima sugestão ainda não acionada/recusada
  const { data: proxima } = await supabase
    .from('sugestoes_consultoras')
    .select('*, consultoras(nome, email)')
    .eq('demanda_id', demandaId)
    .eq('status', 'sugerida')
    .order('ordem_sugerida')
    .limit(1)
    .single()

  if (!proxima) {
    // Todas recusaram
    await supabase
      .from('demandas')
      .update({ status: 'sem_aceite' })
      .eq('id', demandaId)
    console.log(`[Acionamento] Todas consultoras recusaram. Demanda ${demandaId} → sem_aceite`)
    return
  }

  const { data: demanda } = await supabase
    .from('demandas')
    .select('*')
    .eq('id', demandaId)
    .single()

  if (!demanda) return

  const consultora = proxima.consultoras as any
  await acionarConsultora(demandaId, {
    consultora_id: proxima.consultora_id,
    nome:          consultora.nome,
    email:         consultora.email,
    nota:          proxima.nota,
    nivel:         '',
    disponivel:    true,
    slotsLivres:   [],
  }, demanda)

  await supabase
    .from('demandas')
    .update({ status: 'aguardando_aceite' })
    .eq('id', demandaId)
}
