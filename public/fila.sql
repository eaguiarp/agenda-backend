-- Rodar uma vez no PostgreSQL (Railway)

CREATE TABLE IF NOT EXISTS fila_motoristas (
  id SERIAL PRIMARY KEY,
  data_fila DATE NOT NULL,
  placa VARCHAR(8) NOT NULL,
  nome VARCHAR(40) NOT NULL,
  registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip VARCHAR(64),
  user_agent TEXT,
  lat NUMERIC,
  lng NUMERIC,
  status VARCHAR(16) NOT NULL DEFAULT 'aguardando',
  status_alterado_em TIMESTAMPTZ,
  status_alterado_por VARCHAR(60),
  motivo TEXT,
  UNIQUE (data_fila, placa)
);

CREATE INDEX IF NOT EXISTS idx_fila_data_ordem
  ON fila_motoristas (data_fila, registrado_em, id);

-- Tokens do QR dinâmico (uso único) e sessões curtas de cadastro
CREATE TABLE IF NOT EXISTS fila_tokens (
  token VARCHAR(40) PRIMARY KEY,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  expira_em TIMESTAMPTZ NOT NULL,
  usado_em TIMESTAMPTZ,
  sessao VARCHAR(40),
  sessao_expira TIMESTAMPTZ,
  sessao_usada_em TIMESTAMPTZ,
  ip VARCHAR(64)
);

CREATE INDEX IF NOT EXISTS idx_fila_tokens_sessao ON fila_tokens (sessao);

-- Trilha de auditoria: nunca é alterada, só recebe novas linhas
CREATE TABLE IF NOT EXISTS fila_log (
  id SERIAL PRIMARY KEY,
  fila_id INTEGER NOT NULL REFERENCES fila_motoristas(id),
  status_anterior VARCHAR(16),
  status_novo VARCHAR(16) NOT NULL,
  motivo TEXT,
  operador VARCHAR(60),
  em TIMESTAMPTZ NOT NULL DEFAULT now()
);
