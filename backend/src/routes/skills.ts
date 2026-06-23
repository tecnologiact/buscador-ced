import { Router } from 'express'
import { supabase } from '../lib/supabase'

export const skillsRouter = Router()

// GET /api/skills
// Lista todas as skills ativas para uso em dropdowns no frontend
skillsRouter.get('/', async (_req, res) => {
  const { data, error } = await supabase
    .from('skills')
    .select('id, nome, categoria, origem, trilha')
    .eq('ativo', true)
    .order('nome')

  if (error) {
    return res.status(500).json({ erro: 'Erro ao buscar skills', detalhe: error.message })
  }

  return res.json(data)
})
