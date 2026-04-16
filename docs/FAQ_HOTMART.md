# ❓ FAQ & TROUBLESHOOTING - HOTMART INTEGRATION

---

## PERGUNTAS FREQUENTES

### 1. Como funciona exatamente o Hotmart?

**R**: Hotmart é um intermediário de pagamento. Você redireciona seu cliente para o checkout seguro do Hotmart, ele processa o pagamento, e notifica você via webhook quando a transação é confirmada. Você não trata diretamente de cartões de crédito (Hotmart faz isso).

**Fluxo simple**:
- Cliente clica "Comprar" no seu app
- Você redireciona para `https://checkout.hotmart.com`
- Cliente paga no Hotmart
- Hotmart envia webhook para seu servidor: "Pagamento aprovado!"
- Você adiciona créditos
- Hotmart redireciona cliente de volta ao app

**Vantagens**:
- Você não trata cartões (PCI-compliant)
- Hotmart gerencia chargebacks, fraude, etc
- Fácil de integrar

**Desvantagens**:
- Você não vê dados do cartão
- Depende da confiabilidade do Hotmart
- Custo: Hotmart fica com ~10-30% da venda (taxa)

---

### 2. Como validar a assinatura HMAC?

**R**: Hotmart envia uma `signature` que você valida usando HMAC-SHA256:

```typescript
// Hotmart envia: {n, src, event, signature}
// Você calcula a mensagem
const message = n + src + event; // Concatenar em ordem

// Usar seu webhook secret para calcular HMAC
import { createHmac } from "crypto";
const hmac = createHmac("sha256", webhookSecret);
hmac.update(message);
const calculatedSignature = hmac.digest("hex");

// Comparar
if (calculatedSignature === signature) {
  console.log("✅ Válido");
} else {
  console.log("❌ Inválido - Rejeitar!");
}
```

**Por que é importante?**  
Se alguém mandar um webhook falso, você vai adicionar créditos sem pagamento. A assinatura prova que veio do Hotmart.

---

### 3. O que é idempotência? Por que importa?

**R**: Idempotência significa: processar a mesma ação múltiplas vezes = mesmo resultado.

Hotmart pode enviar o mesmo webhook 2x (por timeout, network retry, etc). Você deve:
1. Verificar se a transação já foi processada
2. Se sim, retornar 200 OK mas **não reprocessar**
3. Se não, processar normalmente

**Exemplo de problema (sem idempotência)**:
- Webhook 1 chega → status='approved', creditos += 5
- Webhook 1 chega de novo (retry) → status='approved', creditos += 5 novamente
- ❌ Cliente tem 10 créditos em vez de 5!

**Solução** (no código):
```sql
-- Usar unique constraint
ALTER TABLE transacoes_hotmart 
ADD CONSTRAINT uk_hotmart_purchase_id UNIQUE (hotmart_purchase_id);

-- No webhook handler:
const transacao = await db.from('transacoes_hotmart')
  .select()
  .eq('hotmart_purchase_id', payload.n)
  .single();

if (transacao && transacao.status === 'approved') {
  // Já foi processada!
  return Response(200); // Retornar sucesso mas não fazer nada
}
```

---

### 4. E se o webhook falhar?

**R**: Hotmart vai retentar automaticamente por ~24-72 horas.

**Isso significa:**
- Você pode ter um erro em sua edge function
- Hotmart retenta a cada X minutos
- Quando sua função volta online, processa o webhook do zero

**For best practices:**
1. Sempre retornar 200 OK (mesmo se havia erro)
2. Registrar erro em logs para debug depois
3. Implementar alertas (Sentry) para erros

**Exemplo:**
```typescript
try {
  // Processar webhook
  await processarAprovacao(...);
  return Response(200, {success: true});
} catch (error) {
  console.error("Erro ao processar:", error);
  // IMPORTANTE: Ainda retornar 200 para Hotmart
  // Você vai revisar logs depois
  return Response(200, {error: error.message});
  // Ou pode retornar 500 se preferir que Hotmart retente
}
```

---

### 5. Como rastrear qual treinadora fez a compra?

**R**: Use o parâmetro `src` (custom var) do Hotmart.

```typescript
// Ao gerar link:
const linkHotmart = `https://checkout.hotmart.com?...&src=${treinadora_id}`;

// Hotmart retorna isso no webhook:
const webhook = {
  n: "12345",        // Purchase ID
  src: "treinadora_id", // ← Seu ID customizado!
  event: "approved",
  signature: "..."
};

// Você busca a transação por src + purchase_id:
const transacao = await db
  .from('transacoes_hotmart')
  .select()
  .eq('hotmart_purchase_id', webhook.n)
  .eq('treinadora_id', webhook.src); // ← Validar credenciais
```

---

### 6. O cliente pode fraudar a transação?

**R**: Teoricamente:
- ❌ Cliente não pode alterar a assinatura (precisa do secret)
- ❌ Cliente não pode falsificar email (Hotmart valida)
- ✅ Cliente pode cancelar transação no Hotmart (você reverte créditos)
- ✅ Cliente pode fazer chargeback (Hotmart notifica você)

**Proteções implementadas:**
1. Validação HMAC (assinatura)
2. RLS Policies (cliente não pode UPDATE creditos direto)
3. Histórico auditado (você vê todas as mudanças)
4. Imutabilidade (transações são read-only)

---

### 7. Como diferenciar Sandbox vs Produção?

**R**: Use variáveis de ambiente diferentes:

```typescript
const ambiente = Deno.env.get("HOTMART_AMBIENTE") || "producao";

if (ambiente === "sandbox") {
  const webhookSecret = Deno.env.get("HOTMART_WEBHOOK_SECRET_SANDBOX");
  const checkoutUrl = "https://sandbox-checkout.hotmart.com";
} else {
  const webhookSecret = Deno.env.get("HOTMART_WEBHOOK_SECRET_PRODUCAO");
  const checkoutUrl = "https://checkout.hotmart.com";
}
```

**Ou use dois Hotmart Apps**:
- App ID Sandbox: 7575026 (exemplo)
- App ID Produção: 7575025

---

### 8. Posso usar Hotmart + outra plataforma de pagamento?

**R**: Sim! Exemplo: Hotmart + Stripe.

```typescript
// Na tela de compra, ofereça opções:
// [Comprar via Hotmart] [Comprar via Stripe] [Comprar via PagSeguro]

// Cada um tem seu próprio webhook:
// POST /hotmart-webhook
// POST /stripe-webhook
// POST /pagseguro-webhook

// Mesma tabela de transacoes pode armazenar todos:
transacoes_hotmart {
  ...
  provider: "hotmart" | "stripe" | "pagseguro",
  provider_transaction_id: "...",
  ...
}
```

**Recomendação**: Comece com Hotmart, depois adicione outras se necessário.

---

### 9. Como testar webhooks sem pagar?

**R**: Opções:

1. **Usar Hotmart Sandbox** (oferecido pelo Hotmart)
   - Dashboard separado, cartões de teste
   - Free, mas precisase de conta Hotmart

2. **Usar webhook tester local**
   ```bash
   # Simular webhook com curl
   curl -X POST http://localhost:3000/hotmart-webhook \
     -H "Content-Type: application/x-www-form-urlencoded" \
     -d "n=12345&src=user_id&event=approved&signature=calculated_hmac"
   ```

3. **Usar ngrok** (expor localhost para internet)
   ```bash
   ngrok http 5000
   # Agora você tem URL: https://xxxx.ngrok.io
   # Configure isso no Hotmart webhook URL
   # Você consegue testar local mas Hotmart vê como remote
   ```

4. **Usar Hotmart dashboard** (simular webhook)
   - Alguns dashboards permitem "testar webhook" para transação específica

---

### 10. E se perder o webhook_secret?

**R**: Você vai precisar resetar.

**Passos**:
1. Ir para Hotmart > Segurança > API Keys
2. Gerar nova chave
3. Copiar novo secret
4. Atualizar em Supabase Environment Variables
5. Validar que nova chave funciona
6. Deletar chave antiga (se segurança foi comprometida)

**Para evitar perda**:
- Guardar em password manager (1Password, LastPass, etc)
- Não commitar em GitHub
- Usar Supabase Secrets (que você já está fazendo ✓)

---

### 11. Como debugar "Webhook não chegando"?

**Checklist**:

1. **URL corretas?**
   ```bash
   # Testar que URL responde
   curl -X POST https://seu-projeto.supabase.co/functions/v1/hotmart-webhook \
     -d "n=test&src=test&event=test&signature=test"
   # Deve retornar 400 (payload inválido) ou 401 (sig inválida), não 404
   ```

2. **Webhook URL configurada no Hotmart?**
   - Hotmart Dashboard > Integrações > Webhooks
   - URL deve estar exata

3. **Firewall/CORS bloqueando?**
   - Hotmart faz POST (não GET, deve funcionar)
   - Seu CORS permite requests de Hotmart (você não controla, Hotmart IP é fixo)

4. **Logs do Hotmart**
   - Hotmart oferece painel de "webhooks enviados"
   - Você vê se foi tentado, se foi bloqueado, último status, etc

5. **Logs seus**
   - Verificar `webhook_logs_hotmart` table
   - Se vazio = webhook nunca chegou
   - Se tem registros = chegou, mas pode haver erro no processamento

6. **Edge function é pública?**
   - Por padrão, Edge Functions NO Supabase são públicas
   - Não precisas de autenticação
   - Se você está bloqueando por RLS, Hotmart pode ser rejeitado

---

### 12. Quanto de taxa o Hotmart cobra?

**R**: Depende do contrato, mas tipicamente:
- 15-25% de taxa sobre cada venda (varia por produto)
- Exemplo: Você recebe R$ 227.00, Hotmart fica com R$ 50.00, você recebe R$ 177.00

**Isso está refletido nos preços que você cola que você cobrou?**
- Você: "Vendo 5 créditos por R$ 227" (seu preço final)
- Hotmart: "Você recebe R$ 177" (depois da taxa)

**Dica**: Ajustar preços para cobrir taxa do Hotmart.

---

### 13. Posso oferecer desconto sem usar Hotmart?

**R**: Sim! Você pode ter dois fluxos:

```
┌─────────────────────┐
│ Tela de Compra      │
└─────────────────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
[Hotmart]  [Manual]
           (cupom, gift
            card, etc)
```

Exemplo: "Cupom para 10 créditos grátis":
```typescript
// Na tela de compra
if (usuario.temCupomValido()) {
  // Aplicar créditos direto (sem Hotmart)
  await adicionarCreditos(usuario.id, 10);
} else {
  // Redirecionar para Hotmart
  abrirLinkHotmart();
}
```

---

### 14. Como oferecer "upgrade" de créditos após primeira compra?

**R**: Você pode:

1. **Primeira compra**: Cliente compra 5 créditos
2. **Depois**: Oferecer "Adicionar 10 mais por desconto"

```typescript
if (usuario.ja_comprou && usuario.creditos >= 5) {
  mostrarBotao("Upgrade: +10 créditos por R$ 150");
}
```

Isso é só uma lógica adicional na UI. A integração Hotmart é a mesma.

---

### 15. Preciso de pix/boleto/outro pagamento?

**R**: Hotmart suporta:
- ✅ Cartão de Crédito (mastercard, visa, elo, etc)
- ✅ PayPal
- ✅ Boleto Bancário (brasil)
- ✅ Transferência Bancária
- ✅ Débito em Conta

Você não configura nada (Hotmart oferece tudo automaticamente).

Se você quer mais opções no futuro:
- Stripe (cartão, wallet)
- PagSeguro (boleto, pix, etc)
- Mercado Pago (pix, boleto, etc)

---

## 🔧 TROUBLESHOOTING DETALHADO

### Cenário 1: Créditos não foram adicionados mas webhook chegou

**Debug Steps:**

1. Verificar se webhook foi registrado:
   ```sql
   SELECT * FROM webhook_logs_hotmart 
   WHERE hotmart_purchase_id = 'xxx' 
   ORDER BY created_at DESC;
   ```
   
   Se vazio → webhook nunca chegou

2. Se webhook está lá, verificar status:
   ```sql
   SELECT status_processamento, resultado FROM webhook_logs_hotmart 
   WHERE hotmart_purchase_id = 'xxx';
   ```
   
   Se `status_processamento = 'erro'` → verificar `resultado` (mensagem de erro)

3. Verificar transação:
   ```sql
   SELECT * FROM transacoes_hotmart 
   WHERE hotmart_purchase_id = 'xxx';
   ```
   
   Se status != 'approved' → algo deu errado
   Se status = 'approved' mas créditos não adicionaram → RLS está bloqueando UPDATE

4. Verificar log de função:
   - Supabase Dashboard → Logs → Functions → hotmart-webhook
   - Procure pela transação

5. Causas comuns:
   - ❌ Função edge não foi deployed (está old version)
   - ❌ RLS policy está bloqueando (usando anon key em vez de service key)
   - ❌ Secret webhook está errado (assinatura inválida)
   - ❌ Nome de tabela está errado em query

---

### Cenário 2: Mensagem "Assinatura Inválida"

**Causas:**

1. Secret webhook errado
   ```typescript
   // Verificar
   const secret = Deno.env.get("HOTMART_WEBHOOK_SECRET");
   console.log("Secret length:", secret.length);
   console.log("Secret (primeiro 10 chars):", secret.substring(0, 10));
   // Copie novo secret do Hotmart e atualize
   ```

2. Cálculo de mensagem está errado
   ```typescript
   // CORRETO
   const msg = payload.n + payload.src + payload.event;
   
   // ERRADO
   const msg = JSON.stringify(payload); // ← Não fazer isso
   ```

3. Encoding está wrong
   ```typescript
   // Use sempre UTF-8
   hmac.update(msg, 'utf8');
   ```

---

### Cenário 3: "Transação não encontrada" no webhook

**Causa**: A transação `hotmart_purchase_id` não existe em seu banco.

**Motivo possível**:
- Cliente iniciou compra, mas nunca gerou link com `gerar-link-hotmart`
- Database reset entre gerar link e completar compra
- Seu `hotmart_purchase_id` temporário foi descartado

**Solução:**
- Verificar se `gerar-link-hotmart` foi chamada com sucesso
- Verificar se transação foi criada com `status='pending'`
- Se não, Hotmart vai retornar erro pois você rejeitou (isso está correto)

---

### Cenário 4: Cliente vê "Compra pendente" infinitamente

**Causa**: Webhook não foi processado (status ainda = 'pending')

**Soluções:**

1. Forçar reprocessamento:
   - Ir para Hotmart dashboard
   - Encontrar transação
   - Clicar "Reenviar webhook"
   - Aguardar

2. Verificar logs:
   ```sql
   SELECT * FROM webhook_logs_hotmart 
   WHERE hotmart_purchase_id = 'xxx'
   ORDER BY created_at DESC;
   ```
   
   Se não há nada → webhook nunca foi enviado
   Se há erro → debug conforme cenário acima

3. Monitorar em tempo real:
   ```sql
   SELECT * FROM transacoes_hotmart 
   WHERE created_at > NOW() - INTERVAL '10 minutes'
   ORDER BY created_at DESC;
   ```

---

### Cenário 5: Reembolso não reverteu créditos

**Checklist:**

1. Transação original aprovada?
   ```sql
   SELECT status, creditos_aplicados_at FROM transacoes_hotmart 
   WHERE hotmart_purchase_id = 'xxx';
   ```

2. Webhook "refunded" foi recebido?
   ```sql
   SELECT * FROM webhook_logs_hotmart 
   WHERE hotmart_purchase_id = 'xxx' 
   AND payload_raw::text LIKE '%refunded%';
   ```

3. Função de reversal foi executada?
   ```sql
   SELECT * FROM historial_creditos 
   WHERE transacao_hotmart_id = 'xxx' 
   AND tipo = 'reversal';
   ```

4. Verificar saldo atual da treinadora:
   ```sql
   SELECT id, email, creditos FROM treinadoras 
   WHERE id = 'xxx';
   ```

---

### Cenário 6: Edge Function timeout (> 30s)

**Causa**: Função está lenta ou travada

**Soluções:**

1. Verificar query de database (muito lenta?)
   ```sql
   -- Adicionar índices:
   CREATE INDEX idx_transacoes_purchase_id ON transacoes_hotmart(hotmart_purchase_id);
   CREATE INDEX idx_treinadoras_id ON treinadoras(id);
   ```

2. Remover email síncrono (fazer async)
   ```typescript
   // ❌ Lento
   await enviarEmail(treinadora.email, transacao);
   
   // ✅ Rápido (fire-and-forget)
   enviarEmail(treinadora.email, transacao).catch(err => console.error(err));
   //                                 ↑ Não aguardar
   ```

3. Simplificar queries
   ```typescript
   // ❌ Lento (N+1 problem)
   for (let t of transacoes) {
     let treinadora = await db.from('treinadoras').select().eq('id', t.id);
   }
   
   // ✅ Rápido (1 query)
   let treinadoras = await db.from('treinadoras').select();
   ```

---

## 📞 SUPORTE

Se ainda tiver dúvida:

1. **Documentação Hotmart**: https://docs.hotmart.com/
2. **Support Hotmart**: help@hotmart.com
3. **Community**: Forum Hotmart (existe?)
4. **Seu time**: 😊

---

**Data de atualização**: Abril 2026  
**Versão**: 1.0
