/**
 * notificacoes.ts
 * Endpoint que a consultora acessa ao clicar no link do e-mail.
 *
 * GET /api/notificacoes/:id/responder?token=xxx&resposta=aceita
 *
 * Fluxo:
 *   1. Valida o token e a expiração
 *   2. Registra a resposta (aceita / recusada / aceita_com_observacao)
 *   3. Atualiza status da demanda
 *   4. Se recusada, aciona a próxima consultora da lista (se houver)
 *   5. Retorna página HTML simples de confirmação
 */

import { Router, Request, Response } from 'express'
import { supabase } from '../lib/supabase'
import { acionarProximaConsultora } from './demandas'

export const notificacoesRouter = Router()

// GET /api/notificacoes/:id/responder
notificacoesRouter.get('/:id/responder', async (req: Request, res: Response) => {
  const { id } = req.params
  const { token, resposta, observacao } = req.query as Record<string, string>

  // ----------------------------------------------------------------
  // 1. Validar parâmetros
  // ----------------------------------------------------------------
  const respostasValidas = ['aceita', 'recusada', 'aceita_com_observacao']
  if (!token || !resposta || !respostasValidas.includes(resposta)) {
    return res.status(400).send(paginaHTML('❌ Link inválido', 'Parâmetros incorretos ou resposta não reconhecida.'))
  }

  // ----------------------------------------------------------------
  // 2. Buscar notificação pelo token
  // ----------------------------------------------------------------
  const { data: notif, error: notifErr } = await supabase
    .from('notificacoes')
    .select('*, demandas(cliente, skill_nome, formato, data_entrega, hora_inicio)')
    .eq('id', id)
    .eq('token_resposta', token)
    .single()

  if (notifErr || !notif) {
    return res.status(404).send(paginaHTML('❌ Link não encontrado', 'Este link é inválido ou já foi utilizado.'))
  }

  // ----------------------------------------------------------------
  // 3. Verificar expiração do token
  // ----------------------------------------------------------------
  if (notif.token_expira_em && new Date() > new Date(notif.token_expira_em)) {
    return res.status(410).send(paginaHTML('⏰ Link expirado', 'Este link expirou. Entre em contato com o time de C&D.'))
  }

  // ----------------------------------------------------------------
  // 4. Verificar se já foi respondido
  // ----------------------------------------------------------------
  if (notif.resposta) {
    return res.status(409).send(paginaHTML(
      '⚠️ Já respondido',
      `Você já registrou sua resposta: <strong>${traduzirResposta(notif.resposta)}</strong>`
    ))
  }

  // ----------------------------------------------------------------
  // 5. Registrar resposta
  // ----------------------------------------------------------------
  const agora = new Date().toISOString()

  const { error: updateNotifErr } = await supabase
    .from('notificacoes')
    .update({
      resposta,
      observacao_consultora: resposta === 'aceita_com_observacao' ? (observacao ?? null) : null,
      respondido_em: agora,
      status: 'respondida',
    })
    .eq('id', id)

  if (updateNotifErr) {
    console.error('[Notificações] Erro ao registrar resposta:', updateNotifErr)
    return res.status(500).send(paginaHTML('❌ Erro interno', 'Não foi possível registrar sua resposta. Tente novamente.'))
  }

  // ----------------------------------------------------------------
  // 6. Atualizar sugestão e demanda conforme resposta
  // ----------------------------------------------------------------
  await supabase
    .from('sugestoes_consultoras')
    .update({ status: resposta === 'recusada' ? 'recusada' : 'aceita' })
    .eq('demanda_id', notif.demanda_id)
    .eq('consultora_id', notif.consultora_id)

  if (resposta === 'aceita' || resposta === 'aceita_com_observacao') {
    await supabase
      .from('demandas')
      .update({
        status: 'aceita',
        consultora_selecionada_id: notif.consultora_id,
      })
      .eq('id', notif.demanda_id)

    const demanda = notif.demandas as any
    return res.send(paginaHTML(
      '✅ Entrega confirmada!',
      `Obrigada! Sua confirmação foi registrada.<br><br>
       <strong>Cliente:</strong> ${demanda?.cliente}<br>
       <strong>Tema:</strong> ${demanda?.skill_nome}<br>
       <strong>Data:</strong> ${formatarData(demanda?.data_entrega)} às ${demanda?.hora_inicio}`
    ))
  }

  // Resposta = recusada → tentar acionar próxima consultora
  if (resposta === 'recusada') {
    await supabase
      .from('demandas')
      .update({ status: 'escalada_para_proxima' })
      .eq('id', notif.demanda_id)
      .eq('status', 'aguardando_aceite')

    // Acionar próxima em background (não bloqueia resposta ao usuário)
    acionarProximaConsultora(notif.demanda_id).catch(err =>
      console.error('[Notificações] Erro ao acionar próxima:', err)
    )

    return res.send(paginaHTML(
      '✅ Resposta registrada',
      'Entendemos! Sua recusa foi registrada. O time de C&D será notificado.'
    ))
  }

  return res.send(paginaHTML('✅ Resposta registrada', 'Obrigada pela sua resposta!'))
})

// POST /api/notificacoes/:id/responder (para "Aceito com observação" via formulário)
notificacoesRouter.post('/:id/responder', async (req: Request, res: Response) => {
  const { id } = req.params
  const { token, observacao } = req.body

  if (!token || !observacao) {
    return res.status(400).json({ erro: 'token e observacao são obrigatórios' })
  }

  // Reutiliza a lógica do GET passando a observação
  req.query = { token, resposta: 'aceita_com_observacao', observacao }
  return (notificacoesRouter as any).handle(req, res, () => {})
})

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
function traduzirResposta(r: string): string {
  const mapa: Record<string, string> = {
    aceita: 'Aceito',
    recusada: 'Não aceito',
    aceita_com_observacao: 'Aceito com observação',
  }
  return mapa[r] ?? r
}

function formatarData(data?: string): string {
  if (!data) return ''
  const [ano, mes, dia] = data.split('-')
  return `${dia}/${mes}/${ano}`
}

function paginaHTML(titulo: string, mensagem: string): string {
  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${titulo} — Buscador C&D</title>
      <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center;
               align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; }
        .card { background: white; border-radius: 12px; padding: 40px; max-width: 500px;
                text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        h1 { font-size: 24px; margin-bottom: 16px; }
        p { color: #555; line-height: 1.6; }
        .logo { color: #6366f1; font-weight: bold; margin-bottom: 24px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">Cia de Talentos | C&D</div>
        <h1>${titulo}</h1>
        <p>${mensagem}</p>
      </div>
    </body>
    </html>
  `
}
