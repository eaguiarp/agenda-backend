// ============================================================
// vagoes_rotas.js — Módulo do Servidor (CD Arará)
// Adaptado para o padrão de registro dinâmico do server.js
// ============================================================

module.exports = function(app, db, verificarAcesso) {

  // Middleware de segurança simplificado para as rotas do pátio
  // (Usa as credenciais enviadas nos headers pelo script_api.js)
  async function checarAutenticacao(req, res, next) {
    const usuario = req.headers['usuario'];
    const senha = req.headers['senha'];
    
    if (!usuario || !senha) {
      return res.status(401).json({ erro: 'Credenciais não fornecidas.' });
    }
    
    try {
      // Como o nível mínimo para operar o pátio é 'view' (ou 'op'), passamos 'view'
      const autorizado = await verificarAcesso(usuario, senha, 'view');
      if (!autorizado) {
        return res.status(403).json({ erro: 'Acesso negado para este nível de usuário.' });
      }
      next();
    } catch (err) {
      res.status(500).json({ erro: 'Erro interno na verificação de acesso.' });
    }
  }

  // 1. ROTA: BUSCAR VAGÕES ATIVOS (Retorna os não liberados para o painel de 30 bolinhas)
  app.get('/api/vagoes/ativos', checarAutenticacao, async (req, res) => {
    try {
      const query = `
        SELECT v.*, c.chegada_dt 
        FROM vagoes v
        JOIN vagoes_composicoes c ON v.composicao_id = c.id
        WHERE v.status !== 'liberado'
        ORDER BY c.chegada_dt ASC, v.id ASC
      `;
      const resultado = await db.query(query);
      res.json(resultado.rows);
    } catch (err) {
      console.error('Erro ao buscar vagões ativos:', err);
      res.status(500).json({ erro: 'Erro no banco de dados ao buscar ativos.' });
    }
  });

  // 2. ROTA: ATUALIZAÇÃO EM LOTE (Crucial para a Seleção Múltipla)
  app.post('/api/vagoes/atualizar-lote', checarAutenticacao, async (req, res) => {
    const { vagoes, status } = req.body; // vagoes = ['FLT1', 'FLT2', ...]
    const operador = req.headers['usuario'] || 'Sistema (Lote)';

    if (!Array.isArray(vagoes) || vagoes.length === 0 || !status) {
      return res.status(400).json({ erro: 'Dados inválidos para lote.' });
    }

    try {
      let camposQuery = 'status = $1, atualizado_em = NOW()';
      let params = [status];

      if (status === 'posicionado') {
        camposQuery += ', pos_dt = COALESCE(pos_dt, NOW())';
      } else if (status === 'liberado') {
        camposQuery += ', fim_dt = COALESCE(fim_dt, NOW())';
      }

      // Query usando ANY($2) para atualizar todos os IDs do array de uma vez
      const query = `
        UPDATE vagoes 
        SET ${camposQuery}
        WHERE vagao_id = ANY($${params.length + 1})
      `;
      params.push(vagoes);

      await db.query(query, params);

      // Salva o histórico na tabela de auditoria (vagoes_log)
      for (const vagaoId of vagoes) {
        await db.query(
          'INSERT INTO vagoes_log (vagao_id, status_novo, usuario) VALUES ($1, $2, $3)',
          [vagaoId, status, operador]
        );
      }

      res.json({ sucesso: true, atualizados: vagoes.length });
    } catch (err) {
      console.error('Erro na query de lote:', err);
      res.status(500).json({ erro: 'Erro interno no banco ao processar lote.' });
    }
  });

  // 3. ROTA: REGISTRAR NOVA COMPOSIÇÃO (Tratamento clássico)
  app.post('/api/vagoes/nova-composicao', checarAutenticacao, async (req, res) => {
    const { chegadaDt, vagoes } = req.body; // vagoes = ['FLT1', ...]
    if (!chegadaDt || !Array.isArray(vagoes) || vagoes.length === 0) {
      return res.status(400).json({ erro: 'Dados da composição incompletos.' });
    }

    try {
      // Inicia uma Transação no Postgres para garantir consistência
      await db.query('BEGIN');

      const compRes = await db.query(
        'INSERT INTO vagoes_composicoes (chegada_dt) VALUES ($1) RETURNING id',
        [chegadaDt]
      );
      const composicaoId = compRes.rows[0].id;

      for (const vagaoId of vagoes) {
        await db.query(
          'INSERT INTO vagoes (composicao_id, vagao_id, status) VALUES ($1, $2, \'nao_posicionado\')',
          [composicaoId, vagaoId]
        );
        await db.query(
          'INSERT INTO vagoes_log (vagao_id, status_novo, usuario, motivo) VALUES ($1, \'nao_posicionado\', $2, \'Chegada de Composição\')',
          [vagaoId, req.headers['usuario']]
        );
      }

      await db.query('COMMIT');
      res.json({ sucesso: true, composicaoId });
    } catch (err) {
      await db.query('ROLLBACK');
      console.error('Erro ao criar composição:', err);
      res.status(500).json({ erro: 'Erro ao registrar composição no banco.' });
    }
  });

  // 4. ROTA: ATUALIZAR UM VAGÃO INDIVIDUAL
  app.post('/api/vagoes/atualizar', checarAutenticacao, async (req, res) => {
    const { id, status, posDt, fimDt } = req.body;
    if (!id || !status) return res.status(400).json({ erro: 'Dados incompletos.' });

    try {
      const query = `
        UPDATE vagoes 
        SET status = $1, pos_dt = $2, fim_dt = $3, atualizado_em = NOW() 
        WHERE id = $4 RETURNING vagao_id
      `;
      const resUpdate = await db.query(query, [status, posDt || null, fimDt || null, id]);

      if (resUpdate.rows.length > 0) {
        await db.query(
          'INSERT INTO vagoes_log (vagao_id, status_novo, usuario) VALUES ($1, $2, $3)',
          [resUpdate.rows[0].vagao_id, status, req.headers['usuario']]
        );
      }

      res.json({ sucesso: true });
    } catch (err) {
      console.error('Erro ao atualizar vagão individual:', err);
      res.status(500).json({ erro: 'Erro no banco ao atualizar vagão.' });
    }
  });

  // 5. ROTA: BUSCAR CONFIGURAÇÕES (Limite de estadia)
  app.get('/api/vagoes/config', checarAutenticacao, async (req, res) => {
    try {
      const resultado = await db.query('SELECT chave, valor FROM vagoes_config');
      const cfg = {};
      resultado.rows.forEach(r => cfg[r.chave] = r.valor);
      res.json(cfg);
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao buscar configurações.' });
    }
  });

  // 6. ROTA: SALVAR CONFIGURAÇÃO
  app.post('/api/vagoes/config', checarAutenticacao, async (req, res) => {
    const { limite_estadia } = req.body;
    try {
      await db.query(
        'INSERT INTO vagoes_config (chave, valor) VALUES (\'limite_estadia\', $1) ON CONFLICT (chave) DO UPDATE SET valor = $1',
        [String(limite_estadia)]
      );
      res.json({ sucesso: true });
    } catch (err) {
      res.status(500).json({ erro: 'Erro ao salvar configuração.' });
    }
  });
};