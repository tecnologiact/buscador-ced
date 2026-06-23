-- =============================================================
-- BUSCADOR C&D — Schema Supabase / PostgreSQL
-- Cia de Talentos | MVP Carreira & Desenvolvimento
-- =============================================================
-- Como usar:
--   1. Acesse seu projeto no Supabase → SQL Editor
--   2. Cole este arquivo inteiro e execute (Run All)
--   3. Após execução, rode o script import_excel.py
-- =============================================================

-- Extensão para UUID automático
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- -------------------------------------------------------------
-- TABELA: consultoras
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultoras (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE,
    ativo           BOOLEAN NOT NULL DEFAULT TRUE,
    cidade          TEXT,
    -- Formatos que a consultora pode conduzir
    -- Ex: 'Masterclass,Workshop,Mentoria,Role-play,Devolutiva'
    formatos        TEXT,
    -- Modalidade preferencial: 'Online', 'Presencial', 'Híbrido'
    modalidade      TEXT,
    -- Disponibilidade para viagens: 'Não', 'Sim, nacional', 'Sim, internacional'
    disponibilidade_viagem TEXT,
    -- Anos de experiência como texto livre da planilha
    anos_experiencia TEXT,
    -- Públicos que atende: ex. 'Estagiário,Trainee,Primeira liderança'
    publicos        TEXT,
    -- Setores atendidos
    setores         TEXT,
    -- Certificações
    certificacoes   TEXT,
    -- Diferencial / Bio
    diferencial     TEXT,
    -- Observações adicionais
    observacoes     TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE consultoras IS 'Cadastro das consultoras/facilitadoras da área C&D';
COMMENT ON COLUMN consultoras.formatos IS 'Formatos de entrega separados por vírgula';
COMMENT ON COLUMN consultoras.publicos IS 'Públicos-alvo separados por vírgula';


-- -------------------------------------------------------------
-- TABELA: skills
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS skills (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nome        TEXT NOT NULL UNIQUE,
    -- Pilar do portfólio: 'Power Skills', 'Human + Machine', etc.
    categoria   TEXT,
    -- Origem do tema: 'Jovem', '1ª Liderança', 'Ambos'
    origem      TEXT,
    -- Trilha a que pertence
    trilha      TEXT,
    ativo       BOOLEAN NOT NULL DEFAULT TRUE,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE skills IS 'Catálogo de temas/skills do portfólio C&D (61 temas mapeados)';


-- -------------------------------------------------------------
-- TABELA: consultora_skills
-- Heatmap consultoras × temas com notas 0-3
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS consultora_skills (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    consultora_id   UUID NOT NULL REFERENCES consultoras(id) ON DELETE CASCADE,
    skill_id        UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    -- Nota numérica: 0=Não possuo, 1=Aprendiz, 2=Praticante, 3=Mestre
    nota            SMALLINT NOT NULL CHECK (nota BETWEEN 0 AND 3),
    -- Texto original da planilha para rastreabilidade
    nivel_texto     TEXT,
    observacoes     TEXT,
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (consultora_id, skill_id)
);

COMMENT ON TABLE consultora_skills IS 'Heatmap de notas por consultora × skill (0=Não possuo, 1=Aprendiz, 2=Praticante, 3=Mestre)';
COMMENT ON COLUMN consultora_skills.nota IS 'Apenas notas 2 e 3 tornam a consultora elegível para matching';


-- -------------------------------------------------------------
-- TABELA: demandas
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS demandas (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente                 TEXT NOT NULL,
    skill_id                UUID REFERENCES skills(id),
    -- Nome da skill no momento da criação (desnormalizado para histórico)
    skill_nome              TEXT,
    formato                 TEXT NOT NULL,
    data_entrega            DATE NOT NULL,
    hora_inicio             TIME NOT NULL,
    hora_fim                TIME NOT NULL,
    duracao_minutos         INTEGER NOT NULL CHECK (duracao_minutos > 0),
    -- 'online', 'presencial', 'hibrido'
    modalidade              TEXT NOT NULL,
    observacoes             TEXT,
    -- Status da demanda (ver domínio abaixo)
    status                  TEXT NOT NULL DEFAULT 'criada',
    -- Consultora que aceitou (preenchido após aceite)
    consultora_selecionada_id UUID REFERENCES consultoras(id),
    -- Usuário que criou (email)
    criado_por              TEXT,
    criado_em               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT status_valido CHECK (status IN (
        'criada',
        'consultoras_encontradas',
        'aguardando_aceite',
        'aceita',
        'recusada',
        'escalada_para_proxima',
        'sem_consultora_elegivel',
        'sem_disponibilidade',
        'sem_aceite',
        'cancelada',
        'concluida'
    ))
);

COMMENT ON TABLE demandas IS 'Demandas de entrega criadas pelo time C&D para clientes';
COMMENT ON COLUMN demandas.status IS 'criada → consultoras_encontradas → aguardando_aceite → aceita/sem_aceite';


-- -------------------------------------------------------------
-- TABELA: sugestoes_consultoras
-- Consultoras sugeridas pelo matching para cada demanda
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sugestoes_consultoras (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demanda_id      UUID NOT NULL REFERENCES demandas(id) ON DELETE CASCADE,
    consultora_id   UUID NOT NULL REFERENCES consultoras(id),
    -- Nota da skill no momento do matching (snapshot)
    nota            SMALLINT NOT NULL,
    -- Slots livres encontrados pela Graph API (JSON)
    -- Ex: [{"inicio": "14:00", "fim": "18:00"}]
    slots_disponiveis JSONB,
    -- Posição na lista (1=primeira acionada, 2=segunda, etc.)
    ordem_sugerida  SMALLINT NOT NULL,
    -- Status desta sugestão específica
    status          TEXT NOT NULL DEFAULT 'sugerida',
    -- Motivo de não elegibilidade, se aplicável
    motivo          TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    atualizado_em   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (demanda_id, consultora_id),
    CONSTRAINT status_sugestao_valido CHECK (status IN (
        'sugerida',
        'acionada',
        'aceita',
        'recusada',
        'expirada',
        'substituida'
    ))
);

COMMENT ON TABLE sugestoes_consultoras IS 'Consultoras sugeridas pelo matching para uma demanda (até 3)';


-- -------------------------------------------------------------
-- TABELA: notificacoes
-- Registro de cada acionamento enviado à consultora
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notificacoes (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demanda_id          UUID NOT NULL REFERENCES demandas(id) ON DELETE CASCADE,
    consultora_id       UUID NOT NULL REFERENCES consultoras(id),
    -- Canal: 'email' ou 'teams'
    canal               TEXT NOT NULL DEFAULT 'email',
    -- Status do envio/resposta
    status              TEXT NOT NULL DEFAULT 'pendente',
    enviado_em          TIMESTAMPTZ,
    respondido_em       TIMESTAMPTZ,
    -- 'aceita', 'recusada', 'aceita_com_observacao'
    resposta            TEXT,
    -- Observação da consultora (quando aceita_com_observacao)
    observacao_consultora TEXT,
    -- Token único para link de resposta por e-mail (sem autenticação pesada no MVP)
    token_resposta      TEXT UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
    -- ID da mensagem no canal externo (para rastreio)
    external_message_id TEXT,
    -- Quando o token expira (default: 48h após envio)
    token_expira_em     TIMESTAMPTZ,
    criado_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT canal_valido CHECK (canal IN ('email', 'teams')),
    CONSTRAINT resposta_valida CHECK (
        resposta IS NULL OR
        resposta IN ('aceita', 'recusada', 'aceita_com_observacao')
    )
);

COMMENT ON TABLE notificacoes IS 'Acionamentos enviados às consultoras com link/botão de aceite';
COMMENT ON COLUMN notificacoes.token_resposta IS 'Token único no link de resposta — sem precisar de login no MVP';
COMMENT ON COLUMN notificacoes.token_expira_em IS 'Token expira em 48h após envio por padrão';


-- -------------------------------------------------------------
-- TABELA: historico_status
-- Auditoria de todas as mudanças de status de uma demanda
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historico_status (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    demanda_id      UUID NOT NULL REFERENCES demandas(id) ON DELETE CASCADE,
    status_anterior TEXT,
    status_novo     TEXT NOT NULL,
    descricao       TEXT,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    criado_por      TEXT  -- email do usuário ou 'system'
);

COMMENT ON TABLE historico_status IS 'Log de auditoria de mudanças de status das demandas';


-- =============================================================
-- ÍNDICES PARA PERFORMANCE
-- =============================================================

-- Matching: busca por skill + nota
CREATE INDEX IF NOT EXISTS idx_consultora_skills_skill_nota
    ON consultora_skills (skill_id, nota DESC);

-- Matching: busca por consultora
CREATE INDEX IF NOT EXISTS idx_consultora_skills_consultora
    ON consultora_skills (consultora_id);

-- Demandas por status (painel)
CREATE INDEX IF NOT EXISTS idx_demandas_status
    ON demandas (status);

-- Demandas por data (agenda)
CREATE INDEX IF NOT EXISTS idx_demandas_data
    ON demandas (data_entrega);

-- Sugestões por demanda (detalhe)
CREATE INDEX IF NOT EXISTS idx_sugestoes_demanda
    ON sugestoes_consultoras (demanda_id, ordem_sugerida);

-- Notificações por token (endpoint de resposta)
CREATE INDEX IF NOT EXISTS idx_notificacoes_token
    ON notificacoes (token_resposta);

-- Histórico por demanda
CREATE INDEX IF NOT EXISTS idx_historico_demanda
    ON historico_status (demanda_id, criado_em);

-- Skills ativas
CREATE INDEX IF NOT EXISTS idx_skills_ativo
    ON skills (ativo) WHERE ativo = TRUE;

-- Consultoras ativas
CREATE INDEX IF NOT EXISTS idx_consultoras_ativo
    ON consultoras (ativo) WHERE ativo = TRUE;


-- =============================================================
-- VIEWS PARA O PAINEL BRUNNO/DANI
-- =============================================================

-- View: painel principal de demandas
CREATE OR REPLACE VIEW vw_painel_demandas AS
SELECT
    d.id,
    d.cliente,
    d.skill_nome,
    d.formato,
    d.data_entrega,
    d.hora_inicio,
    d.hora_fim,
    d.duracao_minutos,
    d.modalidade,
    d.status,
    d.observacoes,
    d.criado_por,
    d.criado_em,
    -- Consultora selecionada
    cs.nome   AS consultora_selecionada,
    cs.email  AS email_selecionada,
    -- Contagem de tentativas
    (SELECT COUNT(*) FROM notificacoes n WHERE n.demanda_id = d.id) AS total_acionamentos,
    -- Tempo médio de resposta em horas
    (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (n.respondido_em - n.enviado_em)) / 3600), 1)
     FROM notificacoes n
     WHERE n.demanda_id = d.id AND n.respondido_em IS NOT NULL) AS tempo_resposta_medio_horas
FROM demandas d
LEFT JOIN consultoras cs ON cs.id = d.consultora_selecionada_id
ORDER BY d.criado_em DESC;

COMMENT ON VIEW vw_painel_demandas IS 'Visão principal do painel para Brunno e Dani';


-- View: detalhe de sugestões por demanda
CREATE OR REPLACE VIEW vw_sugestoes_detalhadas AS
SELECT
    sc.demanda_id,
    sc.ordem_sugerida,
    c.nome          AS consultora,
    c.email,
    sc.nota,
    CASE sc.nota
        WHEN 3 THEN 'Mestre'
        WHEN 2 THEN 'Praticante'
        WHEN 1 THEN 'Aprendiz'
        WHEN 0 THEN 'Não possuo'
    END             AS nivel,
    sc.status       AS status_sugestao,
    sc.slots_disponiveis,
    n.status        AS status_notificacao,
    n.resposta,
    n.observacao_consultora,
    n.enviado_em,
    n.respondido_em,
    CASE
        WHEN n.respondido_em IS NOT NULL AND n.enviado_em IS NOT NULL
        THEN ROUND(EXTRACT(EPOCH FROM (n.respondido_em - n.enviado_em)) / 3600, 1)
    END             AS tempo_resposta_horas
FROM sugestoes_consultoras sc
JOIN consultoras c ON c.id = sc.consultora_id
LEFT JOIN notificacoes n ON n.demanda_id = sc.demanda_id AND n.consultora_id = sc.consultora_id
ORDER BY sc.demanda_id, sc.ordem_sugerida;

COMMENT ON VIEW vw_sugestoes_detalhadas IS 'Detalhe de todas as sugestões e respostas por demanda';


-- =============================================================
-- FUNÇÃO: registrar mudança de status (trigger)
-- =============================================================
CREATE OR REPLACE FUNCTION fn_registrar_historico_status()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO historico_status (demanda_id, status_anterior, status_novo, criado_por)
        VALUES (NEW.id, OLD.status, NEW.status, NEW.criado_por);
    END IF;
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_demanda_status
    BEFORE UPDATE ON demandas
    FOR EACH ROW
    EXECUTE FUNCTION fn_registrar_historico_status();

COMMENT ON FUNCTION fn_registrar_historico_status IS 'Grava automaticamente no histórico toda mudança de status de demanda';


-- =============================================================
-- FUNÇÃO: atualizar atualizado_em automaticamente
-- =============================================================
CREATE OR REPLACE FUNCTION fn_atualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.atualizado_em = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_consultoras_ts
    BEFORE UPDATE ON consultoras
    FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp();

CREATE OR REPLACE TRIGGER trg_skills_ts
    BEFORE UPDATE ON skills
    FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp();

CREATE OR REPLACE TRIGGER trg_sugestoes_ts
    BEFORE UPDATE ON sugestoes_consultoras
    FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp();

CREATE OR REPLACE TRIGGER trg_consultora_skills_ts
    BEFORE UPDATE ON consultora_skills
    FOR EACH ROW EXECUTE FUNCTION fn_atualizar_timestamp();
