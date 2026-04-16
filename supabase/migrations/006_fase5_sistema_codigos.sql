-- ================================================
-- MIGRATION 006: FASE 5 - SISTEMA DE CÓDIGOS + HOTMART
-- ================================================
-- Data: 11/03/2026
-- Descrição: Adiciona tabelas de compras e produtos, 
--            rastreabilidade de códigos e integração Hotmart
-- ================================================

-- ================================================
-- 1. AJUSTES NA TABELA CODIGOS (Campos de Rastreabilidade)
-- ================================================

-- Adicionar campos de rastreabilidade
ALTER TABLE codigos 
ADD COLUMN IF NOT EXISTS usado_em TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS teste_iniciado_em TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS teste_completado_em TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS compra_id UUID,
ADD COLUMN IF NOT EXISTS hotmart_transaction_id VARCHAR(100);

-- Compatibilidade: alguns ambientes antigos não possuem treinadora_id em codigos.
ALTER TABLE codigos
ADD COLUMN IF NOT EXISTS treinadora_id UUID;

-- Índices para performance na tabela codigos
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'codigos' AND column_name = 'treinadora_id'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'codigos' AND column_name = 'usado'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_codigos_treinadora_usado
      ON codigos(treinadora_id, usado)
      WHERE usado = false;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'codigos' AND column_name = 'compra_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_codigos_compra
      ON codigos(compra_id)
      WHERE compra_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'codigos' AND column_name = 'hotmart_transaction_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_codigos_hotmart
      ON codigos(hotmart_transaction_id)
      WHERE hotmart_transaction_id IS NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'codigos' AND column_name = 'usado_em'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_codigos_usado_em
      ON codigos(usado_em)
      WHERE usado_em IS NOT NULL;
  END IF;
END $$;

-- ================================================
-- 2. NOVA TABELA: COMPRAS
-- ================================================

CREATE TABLE IF NOT EXISTS compras (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  treinadora_id UUID NOT NULL REFERENCES treinadoras(id) ON DELETE CASCADE,
  
  -- Dados Hotmart
  hotmart_transaction_id VARCHAR(100) UNIQUE NOT NULL,
  hotmart_product_id BIGINT NOT NULL,
  hotmart_product_name VARCHAR(255),
  
  -- Detalhes
  quantidade_codigos INTEGER NOT NULL CHECK (quantidade_codigos > 0),
  valor_total DECIMAL(10,2),
  status VARCHAR(20) DEFAULT 'concluida' CHECK (status IN ('concluida', 'cancelada', 'pendente')),
  
  -- Email
  email_enviado BOOLEAN DEFAULT false,
  email_enviado_em TIMESTAMPTZ,
  
  -- Dados do comprador (backup)
  comprador_email VARCHAR(255),
  comprador_nome VARCHAR(255),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Compatibilidade: em alguns ambientes a tabela compras já existe com schema antigo.
ALTER TABLE compras
ADD COLUMN IF NOT EXISTS treinadora_id UUID,
ADD COLUMN IF NOT EXISTS hotmart_transaction_id VARCHAR(100),
ADD COLUMN IF NOT EXISTS hotmart_product_id BIGINT,
ADD COLUMN IF NOT EXISTS hotmart_product_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS quantidade_codigos INTEGER,
ADD COLUMN IF NOT EXISTS valor_total DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS status VARCHAR(20),
ADD COLUMN IF NOT EXISTS evento_tipo VARCHAR(100),
ADD COLUMN IF NOT EXISTS cliente_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS cliente_nome VARCHAR(255),
ADD COLUMN IF NOT EXISTS email_enviado BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS email_enviado_em TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS comprador_email VARCHAR(255),
ADD COLUMN IF NOT EXISTS comprador_nome VARCHAR(255),
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Compatibilidade adicional: alguns schemas antigos exigem evento_tipo NOT NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compras' AND column_name = 'evento_tipo'
  ) THEN
    UPDATE compras
    SET evento_tipo = COALESCE(evento_tipo, 'hotmart_webhook')
    WHERE evento_tipo IS NULL;

    ALTER TABLE compras ALTER COLUMN evento_tipo SET DEFAULT 'hotmart_webhook';
  END IF;
END $$;

-- Compatibilidade adicional: alguns schemas antigos exigem cliente_email NOT NULL.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compras' AND column_name = 'cliente_email'
  ) THEN
    UPDATE compras
    SET cliente_email = COALESCE(cliente_email, comprador_email, 'hotmart@placeholder.local')
    WHERE cliente_email IS NULL;

    ALTER TABLE compras ALTER COLUMN cliente_email SET DEFAULT 'hotmart@placeholder.local';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compras' AND column_name = 'cliente_nome'
  ) THEN
    UPDATE compras
    SET cliente_nome = COALESCE(cliente_nome, comprador_nome, 'Compradora Hotmart')
    WHERE cliente_nome IS NULL;

    ALTER TABLE compras ALTER COLUMN cliente_nome SET DEFAULT 'Compradora Hotmart';
  END IF;
END $$;

-- Índices para a tabela compras
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compras' AND column_name = 'treinadora_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_compras_treinadora
      ON compras(treinadora_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compras' AND column_name = 'hotmart_transaction_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_compras_hotmart
      ON compras(hotmart_transaction_id);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compras' AND column_name = 'status'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_compras_status
      ON compras(status);
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compras' AND column_name = 'created_at'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_compras_created_at
      ON compras(created_at);
  END IF;
END $$;

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_compras_updated_at ON compras;
CREATE TRIGGER update_compras_updated_at 
  BEFORE UPDATE ON compras
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ================================================
-- 3. NOVA TABELA: PRODUTOS_HOTMART
-- ================================================

CREATE TABLE IF NOT EXISTS produtos_hotmart (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hotmart_product_id BIGINT UNIQUE NOT NULL,
  nome VARCHAR(255) NOT NULL,
  descricao TEXT,
  quantidade_codigos INTEGER NOT NULL CHECK (quantidade_codigos > 0),
  validade_dias INTEGER DEFAULT 30 CHECK (validade_dias > 0),
  preco DECIMAL(10,2),
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para a tabela produtos_hotmart
CREATE INDEX IF NOT EXISTS idx_produtos_hotmart_product_id 
  ON produtos_hotmart(hotmart_product_id);

CREATE INDEX IF NOT EXISTS idx_produtos_hotmart_ativo 
  ON produtos_hotmart(ativo) 
  WHERE ativo = true;

-- Trigger para updated_at
DROP TRIGGER IF EXISTS update_produtos_hotmart_updated_at ON produtos_hotmart;
CREATE TRIGGER update_produtos_hotmart_updated_at 
  BEFORE UPDATE ON produtos_hotmart
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ================================================

-- Habilitar RLS nas novas tabelas
ALTER TABLE compras ENABLE ROW LEVEL SECURITY;
ALTER TABLE produtos_hotmart ENABLE ROW LEVEL SECURITY;

-- Políticas para COMPRAS
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'compras' AND column_name = 'treinadora_id'
  ) THEN
    DROP POLICY IF EXISTS "Treinadoras podem ver suas compras" ON compras;
    CREATE POLICY "Treinadoras podem ver suas compras"
      ON compras FOR SELECT
      USING (
        treinadora_id IN (
          SELECT id FROM treinadoras WHERE auth_user_id = auth.uid()
        )
      );
  END IF;

  DROP POLICY IF EXISTS "Webhook Hotmart pode criar compras" ON compras;
  CREATE POLICY "Webhook Hotmart pode criar compras"
    ON compras FOR INSERT
    WITH CHECK (true);

  DROP POLICY IF EXISTS "Sistema pode atualizar compras" ON compras;
  CREATE POLICY "Sistema pode atualizar compras"
    ON compras FOR UPDATE
    USING (true);
END $$;

-- Políticas para PRODUTOS_HOTMART (apenas leitura pública para treinadoras)
DROP POLICY IF EXISTS "Produtos hotmart sao publicos para leitura" ON produtos_hotmart;
CREATE POLICY "Produtos hotmart sao publicos para leitura"
  ON produtos_hotmart FOR SELECT
  USING (ativo = true);

DROP POLICY IF EXISTS "Apenas admin pode inserir produtos" ON produtos_hotmart;
CREATE POLICY "Apenas admin pode inserir produtos"
  ON produtos_hotmart FOR INSERT
  WITH CHECK (false); -- Será ajustado quando houver sistema de admin

DROP POLICY IF EXISTS "Apenas admin pode atualizar produtos" ON produtos_hotmart;
CREATE POLICY "Apenas admin pode atualizar produtos"
  ON produtos_hotmart FOR UPDATE
  USING (false); -- Será ajustado quando houver sistema de admin

-- ================================================
-- 5. SEED INICIAL DE PRODUTOS (IDs temporários)
-- ================================================

INSERT INTO produtos_hotmart (hotmart_product_id, nome, descricao, quantidade_codigos, validade_dias, preco, ativo)
VALUES 
  (12345, 'DECIFRA - Pacote 10 Avaliações', 'Pacote com 10 códigos de acesso para avaliações DECIFRA', 10, 30, 97.00, true),
  (12346, 'DECIFRA - Pacote 25 Avaliações', 'Pacote com 25 códigos de acesso para avaliações DECIFRA', 25, 30, 197.00, true),
  (12347, 'DECIFRA - Pacote 50 Avaliações', 'Pacote com 50 códigos de acesso para avaliações DECIFRA', 50, 30, 397.00, true)
ON CONFLICT (hotmart_product_id) DO UPDATE SET
  nome = EXCLUDED.nome,
  descricao = EXCLUDED.descricao,
  quantidade_codigos = EXCLUDED.quantidade_codigos,
  validade_dias = EXCLUDED.validade_dias,
  preco = EXCLUDED.preco,
  ativo = EXCLUDED.ativo,
  updated_at = NOW();

-- ================================================
-- 6. ATUALIZAR COMENTÁRIOS
-- ================================================

COMMENT ON TABLE compras IS 'Registro de compras realizadas na Hotmart';
COMMENT ON TABLE produtos_hotmart IS 'Produtos configurados na Hotmart para geração de códigos';
COMMENT ON COLUMN codigos.usado_em IS 'Data/hora quando o código foi utilizado por uma cliente';
COMMENT ON COLUMN codigos.teste_iniciado_em IS 'Data/hora quando a cliente iniciou o teste';
COMMENT ON COLUMN codigos.teste_completado_em IS 'Data/hora quando a cliente completou o teste';
COMMENT ON COLUMN codigos.compra_id IS 'Referência à compra que gerou este código';
COMMENT ON COLUMN codigos.hotmart_transaction_id IS 'ID da transação na Hotmart para rastreabilidade';
