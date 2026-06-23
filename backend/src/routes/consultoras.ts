import { Router } from 'express'
import { supabase } from '../lib/supabase'

export const consultorasRouter = Router()

// GET /api/consultoras
// Lista consultoras ativas
consultorasRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('consultoras')
    .select('id, nome, email, cidade, modalidade, disponibilidade_viagem, formatos')
    .eq('ativo', true)
    .order('nome')

  if (error) {
    return res.status(500).json({ erro: 'Erro ao buscar consultoras', detalhe: error.message })
  }

  return res.json(data)
})
