/**
 * index.ts
 * Servidor Express — Buscador C&D | Cia de Talentos
 *
 * Para rodar em desenvolvimento:
 *   npm run dev
 *
 * Para rodar em produção:
 *   npm run build && npm start
 */

import 'dotenv/config'
import express from 'express'
import cors from 'cors'

import { demandasRouter }    from './routes/demandas'
import { notificacoesRouter } from './routes/notificacoes'
import { skillsRouter }      from './routes/skills'
import { consultorasRouter } from './routes/consultoras'

const app  = express()
const PORT = parseInt(process.env.PORT ?? '3000', 10)

// ----------------------------------------------------------------
// Middlewares
// ----------------------------------------------------------------
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
}))
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// Log simples de requisições
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

// ----------------------------------------------------------------
// Rotas
// ----------------------------------------------------------------
app.use('/api/demandas',     demandasRouter)
app.use('/api/notificacoes', notificacoesRouter)
app.use('/api/skills',       skillsRouter)
app.use('/api/consultoras',  consultorasRouter)

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// 404
app.use((_req, res) => {
  res.status(404).json({ erro: 'Rota não encontrada' })
})

// Tratamento global de erros
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error('[Erro]', err?.message ?? err)
  res.status(500).json({ erro: 'Erro interno do servidor' })
})

// ----------------------------------------------------------------
// Iniciar servidor
// ----------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n🚀 Buscador C&D rodando em http://localhost:${PORT}`)
  console.log(`   Health check: http://localhost:${PORT}/health`)
  console.log(`   Skills:       http://localhost:${PORT}/api/skills`)
  console.log(`   Demandas:     http://localhost:${PORT}/api/demandas\n`)
})
