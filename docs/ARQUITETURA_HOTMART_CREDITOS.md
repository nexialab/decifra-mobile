# 🏛️ ARQUITETURA - INTEGRAÇÃO HOTMART PARA COMPRA DE CRÉDITOS

**Documento de Design Arquitetônico - Decifra**  
**Data**: Abril 2026  
**Stack**: Expo/React Native + Supabase + Deno Edge Functions  
**Objetivo**: Integração segura e escalável de compra de créditos via Hotmart

---

## 📋 SUMÁRIO EXECUTIVO

- **Modelo de negócio**: Venda de créditos para treinadoras acessarem mais clientes
- **Oferta**:
  - 2 créditos - R$ 97,00
  - 5 créditos - R$ 227,00
  - 10 créditos - R$ 397,00
  - 20 créditos - R$ 697,00
- **App ID Hotmart**: 7575025
- **Ciclo de vida**: Venda externa na Hotmart → Webhook para Supabase → Créditos adicionados à treinadora

---

## 1️⃣ DESIGN DE BANCO DE DADOS

### 1.1 Nova Estrutura de Tabelas

Você precisará de **4 tabelas novas** além da estrutura existente:

#### A) `transacoes_hotmart` (Tracking de transações)
```sql
CREATE TABLE transacoes_hotmart (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Identificação
  treinadora_id UUID NOT NULL REFERENCES treinadoras(id) ON DELETE CASCADE,
  hotmart_purchase_id TEXT UNIQUE NOT NULL, -- ID único do Hotmart para cada compra
  hotmart_subscriber_id TEXT, -- ID anônimo do cliente Hotmart (antes de confirmar email)
  
  -- Valores
  quantidade_creditos INTEGER NOT NULL, -- 2, 5, 10, 20
  valor_bruto_centavos BIGINT NOT NULL, -- Valor em centavos (ex: 9700 = R$97,00)
  moeda TEXT NOT NULL DEFAULT 'BRL',
  
  -- Status
  status TEXT NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'approved', 'confirming', 'failed', 'refunded', 'cancelled')),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  webhook_confirmed_at TIMESTAMPTZ,
  creditos_aplicados_at TIMESTAMPTZ,
  última_tentativa_webhook TIMESTAMPTZ,
  proxima_tentativa_webhook TIMESTAMPTZ,
  
  -- Metadata
  metadados JSONB, -- {status_hotmart, custom_vars, ip_cliente, device_info, etc}
  
  CONSTRAINTCHECK (quantidade_creditos IN (2, 5, 10, 20))
);

CREATE INDEX idx_transacoes_treinadora ON transacoes_hotmart(treinadora_id);
CREATE INDEX idx_transacoes_status ON transacoes_hotmart(status);
CREATE INDEX idx_transacoes_hotmart_purchase_id ON transacoes_hotmart(hotmart_purchase_id);
CREATE INDEX idx_transacoes_created_at ON transacoes_hotmart(created_at DESC);
```

#### B) `historial_creditos` (Auditoria de movimentação)
```sql
CREATE TABLE historial_creditos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Identificação
  treinadora_id UUID NOT NULL REFERENCES treinadoras(id) ON DELETE CASCADE,
  transacao_hotmart_id UUID REFERENCES transacoes_hotmart(id) ON DELETE SET NULL,
  
  -- Movimentação
  tipo TEXT NOT NULL 
    CHECK (tipo IN ('compra', 'recarga', 'uso', 'reversal', 'ajuste_admin', 'correcao')),
  
  creditos_antes INTEGER NOT NULL,
  quantidade_creditada INTEGER NOT NULL, -- Pode ser negativo para reversão
  creditos_depois INTEGER NOT NULL,
  
  -- Documento referente
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  descricao TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL -- Para ajustes admin
);

CREATE INDEX idx_historial_treinadora ON historial_creditos(treinadora_id);
CREATE INDEX idx_historial_transacao ON historial_creditos(transacao_hotmart_id);
CREATE INDEX idx_historial_created_at ON historial_creditos(created_at DESC);
```

#### C) `webhook_logs_hotmart` (Auditoria de webhooks)
```sql
CREATE TABLE webhook_logs_hotmart (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  
  -- Dados do webhook
  hotmart_purchase_id TEXT,
  transacao_hotmart_id UUID REFERENCES transacoes_hotmart(id) ON DELETE SET NULL,
  
  -- Raw data
  payload_raw JSONB NOT NULL,
  -- {
  --   "event": "approved" | "confirming" | "failed" | "refunded" | "cancelled",
  --   "n": "12345",
  --   "src": "treinadora_id",
  --   "aff": "...",
  --   "hub": "...",
  --   "signature": "..."
  -- }
  
  -- Auditoria
  status_processamento TEXT NOT NULL 
    CHECK (status_processamento IN ('recebido', 'validado', 'processado', 'erro')),
  resultado JSONB, -- {success: bool, message: str, error: str}
  
  ip_origem TEXT,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_logs_purchase_id ON webhook_logs_hotmart(hotmart_purchase_id);
CREATE INDEX idx_webhook_logs_transacao ON webhook_logs_hotmart(transacao_hotmart_id);
CREATE INDEX idx_webhook_logs_status ON webhook_logs_hotmart(status_processamento);
```

#### D) `chaves_hotmart` (Configuração, 1 linha)
```sql
CREATE TABLE chaves_hotmart (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  app_id TEXT UNIQUE NOT NULL, -- 7575025
  chave_privada TEXT NOT NULL ENCRYPTED, -- Salt para validar assinatura de webhook
  webhook_secret_key TEXT NOT NULL ENCRYPTED, -- Chave para HMAC/assinatura
  
  -- Configuração
  ativo BOOLEAN NOT NULL DEFAULT TRUE,
  ambiente TEXT NOT NULL DEFAULT 'producao' 
    CHECK (ambiente IN ('sandbox', 'producao')),
  
  -- URLs
  url_webhook TEXT NOT NULL, -- https://seu-projeto.supabase.co/functions/v1/hotmart-webhook
  url_redirect_sucesso TEXT NOT NULL, -- Redirect após pagamento bem-sucedido
  url_redirect_cancelamento TEXT NOT NULL, -- Redirect após cancelamento
  
  -- Metadata
  configurado_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  testado_em TIMESTAMPTZ,
  
  ultima_atualizacao TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  atualizado_por TEXT
);
```

### 1.2 Alteração à tabela existente `treinadoras`

A coluna `creditos` já existe. Mantenha como está, mas adicione triggers para auditoria:

```sql
-- Opcional: adicionar coluna para rastrear créditos 'em teste' vs 'ativos'
ALTER TABLE treinadoras ADD COLUMN creditos_suspensos INTEGER NOT NULL DEFAULT 0;

-- Trigger para manter historial automaticamente
CREATE OR REPLACE FUNCTION audit_creditos_treinadora()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.creditos <> NEW.creditos THEN
    INSERT INTO historial_creditos (
      treinadora_id, tipo, creditos_antes, quantidade_creditada, creditos_depois
    ) VALUES (
      NEW.id, 'ajuste_sistema', OLD.creditos, (NEW.creditos - OLD.creditos), NEW.creditos
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_audit_creditos 
BEFORE UPDATE ON treinadoras
FOR EACH ROW EXECUTE FUNCTION audit_creditos_treinadora();
```

### 1.3 Diagrama Entidade-Relacionamento (Simplificado)

```
┌─────────────────────┐
│   treinadoras       │
│─────────────────────│
│ id (PK)             │◄──────────────────────┐
│ email               │                       │
│ creditos            │                       │
│ updated_at          │                       │
└─────────────────────┘                       │
         │                                    │
         │                                    │
         ▼                                    │
┌─────────────────────────────────┐   ┌──────────────────────────┐
│   transacoes_hotmart      │   │ historial_creditos   │
│─────────────────────────────────│   │──────────────────────────│
│ id (PK)                   │   │ id (PK)              │
│ treinadora_id (FK)◄──────────────┤ treinadora_id (FK)───────┤
│ hotmart_purchase_id       │   │ transacao_id (FK)        │
│ quantidade_creditos       │   │ tipo                     │
│ status                    │   │ creditos_antes/depois    │
│ webhook_confirmed_at      │   │ created_at               │
│ creditos_aplicados_at     │   └──────────────────────────┘
└─────────────────────────────────┘

┌─────────────────────────────────┐
│   webhook_logs_hotmart    │
│─────────────────────────────────│
│ id (PK)                   │
│ transacao_id (FK)◄───────────────
│ payload_raw (JSONB)       │
│ status_processamento      │
│ created_at                │
└─────────────────────────────────┘
```

---

## 2️⃣ FLUXO DO HOTMART - COMO FUNCIONA

### 2.1 Visão Geral

Hotmart é uma plataforma de pagamento que gerencia compras digitais. O fluxo é:

1. **Treinadora compra créditos fora do app** (checkout externo Hotmart)
2. **Hotmart processa o pagamento** (cartão, pix, boleto, etc)
4. **Hotmart envia webhook** confirmando pagamento
5. **Sua Edge Function valida e aplica créditos**
6. **Treinadora entra no app e visualiza saldo atualizado**

### 2.2 Estados de Transação no Hotmart

| Status | Descrição | Ação |
|--------|-----------|------|
| **pending** | Aguardando processamento | Nenhuma (ainda) |
| **approved** | Pagamento aprovado ✅ | Aplicar créditos |
| **confirming** | Em confirmação (raro) | Aguardar novo webhook |
| **failed** | Pagamento falhou | Notificar treinadora |
| **refunded** | Reembolsado | Reverter créditos |
| **cancelled** | Cancelado pelo cliente | Log apenas |

### 2.3 Webhook Hotmart - Estrutura

Quando um cliente compra, o Hotmart envia `POST` para sua Edge Function:

```javascript
// Dados enviados via POST (form-encoded ou JSON)
{
  "n": "12345",                    // Hotmart Purchase ID
  "src": "seu_custom_var",         // Seu ID (treinadora_id no seu caso)
  "event": "approved",             // Estado da transação
  "aff": "123456",                 // ID do afiliado (se houver)
  "hub": "...",                    // Hub ID
  "signature": "abc123def456..."   // HMAC SHA256 para validação
}
```

### 2.4 Fluxo Detalhado de Webhook

```
┌──────────────┐
│   HOTMART    │
└──────────────┘
       │
       │ POST com JSON + signature
       ▼
┌─────────────────────────────────────────┐
│ hotmart-webhook Edge Function           │
│─────────────────────────────────────────│
│ 1. Valida assinatura HMAC              │
│ 2. Busca transação por purchase_id     │
│ 3. LogLog em webhook_logs_hotmart      │
│ 4. Se "approved" → atualizar status    │
│ 5. Aplicar créditos na treinadora      │
│ 6. Criar registro em historial_creditos │
│ 7. Retornar 200 OK                     │
│ 8. Enviar email de confirmação         │
└─────────────────────────────────────────┘
       │
       ▼
  ✅ Success
```

### 2.5 APIs Disponíveis do Hotmart

**Você NÃO precisa chamar APIs do Hotmart **durante a integração normal**. O webhook é suficiente.**

Opcionalmente, você pode usar:
- **Status API**: Verificar status de uma transação (se webhook falhar)
- **User Info API**: Obter dados do comprador
- **Refund API**: Processar reembolsos (manual, via dashboard)

Para esta integração inicial, **use apenas webhooks**.

---

## 3️⃣ INTEGRAÇÃO TÉCNICA

### 3.1 Estrutura de Diretórios

```
supabase/functions/
├── hotmart-webhook/
│   ├── index.ts              # Processa webhooks do Hotmart
│   └── validar-assinatura.ts # Validação HMAC
├── gerar-link-hotmart/
│   └── index.ts              # Gera link de compra para o cliente
└── listar-transacoes/
    └── index.ts              # Lista histórico de compras (admin/treinadora)
```

### 3.2 Edge Function 1: `hotmart-webhook` (Recebe e processa webhook)

**Localização**: `supabase/functions/hotmart-webhook/index.ts`

```typescript
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface HotmartWebhook {
  n: string;           // purchase_id
  src: string;         // custom var (treinadora_id)
  event: string;       // approved, confirming, failed, refunded, cancelled
  aff?: string;
  hub?: string;
  signature: string;   // HMAC SHA256 para validação
}

interface TransacaoStatus {
  quantidade_creditos: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const hotmartWebhookSecret = Deno.env.get("HOTMART_WEBHOOK_SECRET")!;

    if (!supabaseUrl || !supabaseServiceRoleKey || !hotmartWebhookSecret) {
      throw new Error("Configuração do servidor incompleta");
    }

    // 1. PARSING - Hotmart envia form-encoded, não JSON
    const formData = await req.formData();
    const payload: HotmartWebhook = {
      n: formData.get("n") as string,
      src: formData.get("src") as string,
      event: formData.get("event") as string,
      aff: (formData.get("aff") as string) || undefined,
      hub: (formData.get("hub") as string) || undefined,
      signature: formData.get("signature") as string,
    };

    // Validar campos obrigatórios
    if (!payload.n || !payload.src || !payload.event || !payload.signature) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatórios faltando" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. VALIDAÇÃO DE ASSINATURA - HMAC SHA256
    const signatureCalculada = validarAssinatura(payload, hotmartWebhookSecret);
    if (signatureCalculada !== payload.signature) {
      console.warn(`[HOTMART] Webhook com assinatura inválida: ${payload.n}`);
      return new Response(
        JSON.stringify({ error: "Assinatura inválida" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 3. REGISTRAR WEBHOOK RECEBIDO
    await adminClient
      .from("webhook_logs_hotmart")
      .insert({
        hotmart_purchase_id: payload.n,
        payload_raw: payload,
        status_processamento: "recebido",
      });

    // 4. BUSCAR TRANSAÇÃO
    const { data: transacao, error: transacaoError } = await adminClient
      .from("transacoes_hotmart")
      .select("*")
      .eq("hotmart_purchase_id", payload.n)
      .single();

    if (transacaoError || !transacao) {
      console.warn(`[HOTMART] Transação não encontrada: ${payload.n}`);
      return new Response(
        JSON.stringify({ error: "Transação não encontrada" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. PROCESSAR CONFORME STATUS
    let statusProcessado = "recebido";
    let resultado = { success: false, message: "" };

    switch (payload.event) {
      case "approved":
        resultado = await processarAprovacao(
          adminClient,
          transacao,
          payload
        );
        statusProcessado = resultado.success ? "processado" : "erro";
        break;

      case "confirming":
        // Aguardar webhook de confirmação
        statusProcessado = "validado";
        resultado = { success: true, message: "Aguardando confirmação" };
        break;

      case "failed":
        statusProcessado = "processado";
        resultado = await processarFalha(adminClient, transacao, payload);
        break;

      case "refunded":
        statusProcessado = "processado";
        resultado = await processarReembolso(adminClient, transacao, payload);
        break;

      case "cancelled":
        statusProcessado = "processado";
        resultado = await processarCancelamento(adminClient, transacao, payload);
        break;

      default:
        statusProcessado = "erro";
        resultado = { success: false, message: `Evento desconhecido: ${payload.event}` };
    }

    // 6. ATUALIZAR LOG
    await adminClient
      .from("webhook_logs_hotmart")
      .update({
        transacao_hotmart_id: transacao.id,
        status_processamento: statusProcessado,
        resultado,
      })
      .eq("hotmart_purchase_id", payload.n);

    // Retornar 200 ao Hotmart (=já processado)
    return new Response(
      JSON.stringify({ success: true, message: "Webhook processado" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[HOTMART] Erro:", error);
    return new Response(
      JSON.stringify({ error: "Erro ao processar" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * VALIDAR ASSINATURA HMAC SHA256
 * Hotmart envia: signature = HMAC-SHA256(n + src + event, secret)
 */
function validarAssinatura(payload: HotmartWebhook, secret: string): string {
  const msg = `${payload.n}${payload.src}${payload.event}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(msg);
  return hmac.digest("hex");
}

/**
 * PROCESSAR PAGAMENTO APROVADO
 */
async function processarAprovacao(
  client: any,
  transacao: any,
  payload: HotmartWebhook
) {
  try {
    // Buscar treinadora
    const { data: treinadora, error: treinadoresqError } = await client
      .from("treinadoras")
      .select("*")
      .eq("id", transacao.treinadora_id)
      .single();

    if (treinadoresqError || !treinadora) {
      throw new Error("Treinadora não encontrada");
    }

    // Calcular novos créditos
    const novosSaldoCreditos = treinadora.creditos + transacao.quantidade_creditos;

    // UPDATE: Transação + Treinadora + Histórico (tudo junto = transação DB)
    const updates = Promise.all([
      // 1. Marcar transação como aprovada
      client
        .from("transacoes_hotmart")
        .update({
          status: "approved",
          webhook_confirmed_at: new Date().toISOString(),
          creditos_aplicados_at: new Date().toISOString(),
        })
        .eq("id", transacao.id),

      // 2. Atualizar saldo de créditos
      client
        .from("treinadoras")
        .update({ creditos: novosSaldoCreditos })
        .eq("id", transacao.treinadora_id),

      // 3. Registrar no histórico
      client
        .from("historial_creditos")
        .insert({
          treinadora_id: transacao.treinadora_id,
          transacao_hotmart_id: transacao.id,
          tipo: "compra",
          creditos_antes: treinadora.creditos,
          quantidade_creditada: transacao.quantidade_creditos,
          creditos_depois: novosSaldoCreditos,
          descricao: `Compra via Hotmart - ${transacao.quantidade_creditos} créditos por R$ ${(transacao.valor_bruto_centavos / 100).toFixed(2)}`,
        }),

      // 4. Enviar email de confirmação (opcional)
      // enviarEmailConfirmacao(treinadora.email, transacao)
    ]);

    await Promise.all(await updates);

    return { success: true, message: "Créditos adicionados com sucesso" };
  } catch (error) {
    console.error("[HOTMART] Erro ao processar aprovação:", error);
    return { success: false, message: error instanceof Error ? error.message : "Erro desconhecido" };
  }
}

/**
 * PROCESSAR PAGAMENTO FALHADO
 */
async function processarFalha(
  client: any,
  transacao: any,
  payload: HotmartWebhook
) {
  try {
    await client
      .from("transacoes_hotmart")
      .update({
        status: "failed",
        metadados: {
          ...transacao.metadados,
          falha_em: new Date().toISOString(),
        },
      })
      .eq("id", transacao.id);

    return { success: true, message: "Falha registrada" };
  } catch (error) {
    return { success: false, message: "Erro ao registrar falha" };
  }
}

/**
 * PROCESSAR REEMBOLSO
 */
async function processarReembolso(
  client: any,
  transacao: any,
  payload: HotmartWebhook
) {
  try {
    // Buscar treinadora
    const { data: treinadora } = await client
      .from("treinadoras")
      .select("*")
      .eq("id", transacao.treinadora_id)
      .single();

    if (!treinadora) throw new Error("Treinadora não encontrada");

    // Reverter créditos
    const creditosAntigos = treinadora.creditos;
    const creditosNovos = Math.max(0, creditosAntigos - transacao.quantidade_creditos);

    await Promise.all([
      // Atualizar transação
      client
        .from("transacoes_hotmart")
        .update({ status: "refunded" })
        .eq("id", transacao.id),

      // Reverter créditos
      client
        .from("treinadoras")
        .update({ creditos: creditosNovos })
        .eq("id", transacao.treinadora_id),

      // Registrar revés
      client
        .from("historial_creditos")
        .insert({
          treinadora_id: transacao.treinadora_id,
          transacao_hotmart_id: transacao.id,
          tipo: "reversal",
          creditos_antes: creditosAntigos,
          quantidade_creditada: -transacao.quantidade_creditos,
          creditos_depois: creditosNovos,
          descricao: "Reembolso Hotmart",
        }),
    ]);

    return { success: true, message: "Reembolso processado" };
  } catch (error) {
    return { success: false, message: "Erro ao processar reembolso" };
  }
}

/**
 * PROCESSAR CANCELAMENTO
 */
async function processarCancelamento(
  client: any,
  transacao: any,
  payload: HotmartWebhook
) {
  await client
    .from("transacoes_hotmart")
    .update({ status: "cancelled" })
    .eq("id", transacao.id);

  return { success: true, message: "Cancelamento registrado" };
}
```

### 3.3 Edge Function 2: `gerar-link-hotmart` (Cria link de compra)

**Localização**: `supabase/functions/gerar-link-hotmart/index.ts`

```typescript
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface GerarLinkPayload {
  treinadoraId: string;
  quantidadeCreditos: number; // 2, 5, 10, 20
}

// Mapeamento: quantidade_creditos -> valor_centavos
const TABELA_PRECOS: Record<number, number> = {
  2: 9700,    // R$ 97,00
  5: 22700,   // R$ 227,00
  10: 39700,  // R$ 397,00
  20: 69700,  // R$ 697,00
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1. PARSEAR PAYLOAD
    let body: any;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Payload inválido" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { treinadoraId, quantidadeCreditos } = body as GerarLinkPayload;

    // 2. VALIDAR
    if (!treinadoraId || !quantidadeCreditos) {
      return new Response(
        JSON.stringify({ error: "treinadoraId e quantidadeCreditos obrigatórios" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!TABELA_PRECOS[quantidadeCreditos]) {
      return new Response(
        JSON.stringify({ error: "Quantidade de créditos inválida" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. CRIAR TRANSAÇÃO PENDENTE
    const { data: transacao, error: transacaoError } = await adminClient
      .from("transacoes_hotmart")
      .insert({
        treinadora_id: treinadoraId,
        hotmart_purchase_id: `TEMP-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        // Será sobrescrito pelo webhook com o ID real do Hotmart
        quantidade_creditos: quantidadeCreditos,
        valor_bruto_centavos: TABELA_PRECOS[quantidadeCreditos],
        status: "pending",
        metadados: {
          link_gerado_em: new Date().toISOString(),
          user_agent: req.headers.get("user-agent"),
          ip_origem: req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip"),
        },
      })
      .select()
      .single();

    if (transacaoError || !transacao) {
      throw new Error("Erro ao criar transação");
    }

    // 4. GERAR LINK HOTMART
    // Documentação: https://hotmart.com/pt-BR/
    // Checkout seguro: https://checkout.hotmart.com/?...

    const precoReais = TABELA_PRECOS[quantidadeCreditos] / 100;
    const linkHotmart = gerarLinkCheckout({
      appId: "7575025", // Seu App ID
      treinadoraId,
      quantidadeCreditos,
      valor: precoReais,
      transacaoId: transacao.id,
      checkoutParam: `transacao_id=${transacao.id}`,
    });

    return new Response(
      JSON.stringify({
        success: true,
        linkHotmart,
        transacaoId: transacao.id,
        quantidade_creditos: quantidadeCreditos,
        valor_reais: precoReais.toFixed(2),
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[HOTMART] Erro ao gerar link:", error);
    return new Response(
      JSON.stringify({ error: "Erro ao gerar link" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

/**
 * GERAR LINK CHECKOUT HOTMART
 * 
 * Parâmetros principais:
 * - co: checkout_id (sku)
 * - src: custom var (seu treinadora_id)
 * - aff: affiliate id (se houver, deixar vazio)
 * - utm_*: tracking UTM
 */
function gerarLinkCheckout(params: {
  appId: string;
  treinadoraId: string;
  quantidadeCreditos: number;
  valor: number;
  transacaoId: string;
  checkoutParam: string;
}): string {
  // NOTA: Este é um exemplo simplificado.
  // Você precisa configurar SKUs no dashboard do Hotmart
  // e usar os checkout IDs corretos aqui.

  const baseUrl = "https://pay.hotmart.com/checkout/detail";
  
  const queryParams = new URLSearchParams({
    // Identificar qual SKU (2, 5, 10, 20 créditos)
    // Você configura isso no dashboard: cada um tem um ID único
    // Exemplo: sku_2creditos = "ABC123", etc
    // Para agora, vamos usar um checkout genérico:
    
    // Parâmetro customizado (seu treinadora_id)
    src: params.treinadoraId,
    
    // Seu app buscando para rastrear
    utm_source: "decifra_app",
    utm_medium: "in_app",
    utm_campaign: `creditos_${params.quantidadeCreditos}`,
    utm_content: params.transacaoId,
  });

  // Nota: SKU específico seria adicionado aqui após configurar no Hotmart
  // Por enquanto, você precisa gerar URLs diferentes para cada oferta
  
  return `${baseUrl}?${queryParams.toString()}`;
}
```

### 3.4 Edge Function 3: `listar-transacoes` (Histórico para treinadora)

```typescript
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  try {
    const url = new URL(req.url);
    const treinadoraId = url.searchParams.get("treinadora_id");

    if (!treinadoraId) {
      return new Response(
        JSON.stringify({ error: "treinadora_id obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const client = createClient(supabaseUrl, supabaseAnonKey);

    // Buscar transações da treinadora
    const { data: transacoes, error } = await client
      .from("transacoes_hotmart")
      .select("*")
      .eq("treinadora_id", treinadoraId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      throw error;
    }

    return new Response(
      JSON.stringify({
        success: true,
        transacoes: transacoes || [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Erro:", error);
    return new Response(
      JSON.stringify({ error: "Erro ao listar transações" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

### 3.5 Segurança da Edge Function - Validação de Assinatura

A validação de assinatura é **crítica**. Hotmart envia:

```
signature = HMAC-SHA256(n + src + event, webhook_secret_key)
```

Você valida recalculando a assinatura:

```typescript
function validarAssinatura(payload: HotmartWebhook, secret: string): string {
  const mensagem = `${payload.n}${payload.src}${payload.event}`;
  const hmac = createHmac("sha256", secret);
  hmac.update(mensagem);
  return hmac.digest("hex");
}

// Validação
if (signatureCalculada !== payload.signature) {
  return Response 401; // Rejeitar
}
```

---

## 4️⃣ CONFIGURAÇÃO HOTMART

### 4.1 Pré-requisitos

1. **Conta Hotmart** criada e verificada
2. **Ser produtor/vendedor** (aplicar se não tiver)
3. **Cadastro de Produto**: Criar produtos de "créditos" (2, 5, 10, 20)
4. **App ID**: Seu App ID = **7575025** (já fornecido)

### 4.2 Passos no Dashboard Hotmart

#### Passo 1: Configurar Produto (SKU)

1. Vá para **Produtos** → **Meus Produtos**
2. Crie 4 produtos (ou use um com variações):
   - Produto: "2 Créditos Decifra" - R$ 97,00
   - Produto: "5 Créditos Decifra" - R$ 227,00
   - Produto: "10 Créditos Decifra" - R$ 397,00
   - Produto: "20 Créditos Decifra" - R$ 697,00
3. Para cada produto, copie o **SKU ID** (exemplo: `1234567890`)

#### Passo 2: Configurar Webhook

1. Vá para **Integrações** → **Webhooks** (ou **Notificações**)
2. **Webhook URL**: `https://seu-projeto.supabase.co/functions/v1/hotmart-webhook`
3. **Método**: POST
4. **Eventos a receber**:
   - ✅ Purchase Approved
   - ✅ Purchase Confirming (opcional)
   - ✅ Purchase Failed
   - ✅ Purchase Refunded
   - ✅ Purchase Cancelled
5. **Webhook Secret**: Cópia da sua chave secreta (você configura)

#### Passo 3: Gerar Webhook Secret

1. Vá para **Segurança** → **Chaves da API**
2. Crie uma chave para "Webhook Validation"
3. Copie a chave secreta

#### Passo 4: Configurar URLs de Redirecionamento

No dashboard Hotmart, você pode configurar:
- **URL de Sucesso**: `decifra://creditos/sucesso?transacao_id={custom_var}`
- **URL de Cancelamento**: `decifra://creditos/cancelado`

Estes vão redirecionar o cliente de volta ao app após o pagamento.

### 4.3 Testar Webhook em Sandbox (Recomendado)

1. Hotmart oferece dashboard de **Sandbox** (teste)
2. Use app ID diferente para sandbox
3. Processe transações de teste
4. Valide que webhooks chegam
5. Depois mude para produção

### 4.4 Variáveis de Ambiente Supabase

Crie/atualize no Supabase (Settings → Functions):

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=xxxx
SUPABASE_SERVICE_ROLE_KEY=xxxx
HOTMART_APP_ID=7575025
HOTMART_WEBHOOK_SECRET=sua_chave_secreta_aqui
HOTMART_CHECKOUT_URL=https://checkout.hotmart.com
```

---

## 5️⃣ FLUXO UI/UX

### 5.1 Fluxo de Compra (Alta Nível)

```
┌─────────────────────────────────────────────────────────┐
│  [Tela Principal - Dashboard Treinadora]               │
└─────────────────────────────────────────────────────────┘
             │
             │ "Comprar Mais Créditos"
             ▼
┌─────────────────────────────────────────────────────────┐
│  [Ofertas de Créditos]                                  │
│  ┌──────┬──────┬──────┬──────┐                          │
│  │ 2    │ 5    │ 10   │ 20   │                          │
│  │ R$97 │R$227 │R$397 │R$697 │                          │
│  └──────┴──────┴──────┴──────┘                          │
│  [Clique em uma oferta]                                 │
└─────────────────────────────────────────────────────────┘
             │
             │ Edge Function gera link + cria transação
             ▼
┌─────────────────────────────────────────────────────────┐
│  [Redireciona para Hotmart]                             │
│  → Cliente preenche dados de pagamento                  │
│  → Cliente completa compra                              │
└─────────────────────────────────────────────────────────┘
             │
             │ Webhook confirmação
             ▼
┌─────────────────────────────────────────────────────────┐
│  [Hotmart redireciona volta ao app]                     │
│  → Mostra "✅ Compra confirmada!"                       │
│  → Exibe novo saldo de créditos                         │
│  → Opção voltar ao dashboard                            │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Componentes UI Necessários

#### A) `CompraCreditos.tsx` - Tela de Ofertas

```tsx
// Mostra os 4 pacotes
// Cada card tem: 
// - Quantidade de créditos
// - Valor
// - Botão "Comprar Agora"
```

#### B) `ProcessandoCompra.tsx` - Loading

```tsx
// Mostrado enquanto Edge Function processa
// Spinner + "Preparando sua compra..."
```

#### C) `ConfirmacaoCompra.tsx` - Sucesso

```tsx
// Após webhook processar
// ✅ Compra confirmada!
// Novo saldo: X créditos
// Data: 
// [Voltar ao Dashboard]
```

### 5.3 Fluxo de Deep Linking

Quando Hotmart redireciona de volta ao app:

```typescript
// Usar Expo Linking
import * as Linking from "expo-linking";

const prefix = Linking.createURL("/");

export const linking = {
  prefixes: [prefix, "decifra://"],
  config: {
    screens: {
      creditos: {
        screens: {
          sucesso: "creditos/sucesso/:transacao_id",
          cancelado: "creditos/cancelado",
        },
      },
    },
  },
};

// Na rota de sucesso:
// 1. Lê transacao_id da URL
// 2. Busca status em transacoes_hotmart
// 3. Se status = "approved" → mostrar sucesso
// 4. Se status = "pending" → spinner + aguardar webhook
```

---

## 6️⃣ SEGURANÇA

### 6.1 Validação de Webhook - Checklist

- ✅ **Validar assinatura HMAC-SHA256** antes de processar
- ✅ **Rejeitar webhooks duplicados** (idmpotência)
  - Usar `hotmart_purchase_id` como chave única
  - Se já procesado, retornar 200 (não processar novamente)
- ✅ **Rate limiting**: Máximo X webhooks/minuto
- ✅ **Timeout**: Não ficar esperando > 30s
- ✅ **Log de auditoria**: Sempre registrar tentativa de webhook
- ✅ **Validação de dados**: Checar `transacao.quantidade_creditos` bate com esperado

### 6.2 Proteção de Créditos

- ✅ **RLS Policies**: Treinadora só vê suas próprias transações
- ✅ **Não confiar em cliente**: Créditos sempre atualizados serverside
- ✅ **Reversal seguro**: Se reembolso, garantir que créditos são subtraídos
  - Não deixar saldo negativo (usar `GREATEST(0, creditos - reversal)`)

### 6.3 RLS Policies Exemplo

```sql
-- Treinadora pode ver apenas suas transações
CREATE POLICY "Treinadora vê suas transações"
  ON transacoes_hotmart
  FOR SELECT
  USING (treinadora_id = auth.uid()::uuid);

-- Treinadoras não podem UPDATE (apenas via webhook)
CREATE POLICY "Transações são read-only para treinadoras"
  ON transacoes_hotmart
  FOR UPDATE
  USING (false); -- Nunca

-- Histórico de créditos
CREATE POLICY "Treinadora vê seu histórico"
  ON historial_creditos
  FOR SELECT
  USING (treinadora_id = auth.uid()::uuid);
```

### 6.4 Variáveis Sensíveis

- ❌ **Nunca** comitar `HOTMART_WEBHOOK_SECRET`
- ✅ **Usar** como Supabase environment variable
- ✅ **Rotacionar** chaves a cada 6-12 meses
- ✅ **Monitorar** tentativas de webhook falhadas

---

## 7️⃣ ROADMAP DE IMPLEMENTAÇÃO

### Fase 1: Banco de Dados (1-2 horas)
- [ ] Rodar migrations SQL (criar 4 tabelas novas)
- [ ] Testar RLS policies

### Fase 2: Edge Functions (4-6 horas)
- [ ] Criar `hotmart-webhook` (processa eventos)
- [ ] Criar `gerar-link-hotmart` (cria transações)
- [ ] Criar `listar-transacoes` (histórico)
- [ ] Testar com webhooks simulados

### Fase 3: Configuração Hotmart (1-2 horas)
- [ ] Criar produtos no dashboard Hotmart
- [ ] Configurar webhook URL
- [ ] Gerar webhook secret
- [ ] Testar em sandbox

### Fase 4: UI/UX (3-4 horas)
- [ ] Criar componente `CompraCreditos`
- [ ] Criar componente `ProcessandoCompra`
- [ ] Criar rota `/creditos/sucesso`
- [ ] Integrar deep linking

### Fase 5: Testes & Deploy (2-3 horas)
- [ ] Teste ponta-a-ponta (checkout → webhook → créditos)
- [ ] Teste de reembolso
- [ ] Teste de duplicação (mesma transação 2x)
- [ ] Deploy em produção

**Tempo Total Estimado**: ~12-18 horas de desenvolvimento

---

## 8️⃣ REFERÊNCIAS & RECURSOS

- **Hotmart Docs**: https://docs.hotmart.com/
- **Webhook Format**: [Padrão form-encoded Hotmart]
- **Validação HMAC**: Node.js `crypto` module (já disponível em Deno)
- **Idempotência**: Use `unique` constraint em `hotmart_purchase_id`
- **Teste Webhook local**: Use ngrok + webhook tester

---

## 9️⃣ ANEXO: Estrutura Completa de Schema SQL

Veja seção **1. Design de Banco de Dados** para scripts completos.

---

**Próximos Passos**: Aguardando aprovação para iniciar implementação fase 1 (banco de dados).
