# ✅ CHECKLIST DE IMPLEMENTAÇÃO - HOTMART INTEGRATION

**Status Geral**: 🔴 Não iniciado  
**Estimado**: 12-18 horas  
**Data Prevista de Conclusão**: TBD

---

## 📋 FASE 1: BANCO DE DADOS (2 horas)

### 1.1 Criar Tabelas

- [ ] Criar `transacoes_hotmart` com:
  - [ ] Colunas: id, treinadora_id, hotmart_purchase_id, quantidade_creditos, valor_bruto_centavos, status, metadados
  - [ ] Índices: treinadora_id, status, hotmart_purchase_id, created_at
  - [ ] Constraint: hotmart_purchase_id é único
  - [ ] Constraint: quantidade_creditos IN (2, 5, 10, 20)

- [ ] Criar `historial_creditos` com:
  - [ ] Colunas: id, treinadora_id, transacao_hotmart_id, tipo, creditos_antes/depois, quantidade_creditada, cliente_id, descricao, created_at
  - [ ] Índices: treinadora_id, transacao_hotmart_id, created_at
  - [ ] Constraint: tipo IN ('compra', 'recarga', 'uso', 'reversal', 'ajuste_admin', 'correcao')

- [ ] Criar `webhook_logs_hotmart` com:
  - [ ] Colunas: id, hotmart_purchase_id, transacao_hotmart_id, payload_raw (JSONB), status_processamento, resultado, ip_origem, user_agent, created_at
  - [ ] Índices: hotmart_purchase_id, transacao_hotmart_id, status_processamento

- [ ] Criar `chaves_hotmart` com:
  - [ ] Colunas: id, app_id, chave_privada (encriptada), webhook_secret_key (encriptada), ativo, ambiente, urls, testado_em
  - [ ] Constraints: app_id é único, ambiente IN ('sandbox', 'producao')

### 1.2 Triggers de Auditoria

- [ ] Criar função `audit_creditos_treinadora()` que registra automaticamente em `historial_creditos` quando `treinadoras.creditos` muda
- [ ] Criar trigger `trigger_audit_creditos` para executar função acima

### 1.3 RLS Policies

- [ ] Policy: Treinadora pode ler apenas suas `transacoes_hotmart`
- [ ] Policy: Treinadora pode ler apenas seu `historial_creditos`
- [ ] Policy: Ninguém (exceto admin via service role) pode UPDATE em `transacoes_hotmart`
- [ ] Policy: Ninguém pode DELETE em `transacoes_hotmart` (soft delete apenas via status)
- [ ] Policy: `webhook_logs_hotmart` é read-only para treinadoras

### 1.4 Validações

- [ ] Rodar queries de teste em cada tabela
- [ ] Verificar se RLS policies estão bloqueando acesso não autorizado
- [ ] Testar idempotência de inserção (múltiplas transações com mesmo purchase_id devem falhar ou ignorar)

---

## 🔌 FASE 2: EDGE FUNCTIONS (6 horas)

### 2.1 Hotmart Webhook Handler

**Arquivo**: `supabase/functions/hotmart-webhook/index.ts`

#### Setup

- [ ] Criar diretório `supabase/functions/hotmart-webhook/`
- [ ] Criar `index.ts` com 600+ linhas
- [ ] Definir interface `HotmartWebhook`
- [ ] Configurar CORS headers

#### Parsing & Validação

- [ ] Implementar parsing de form-encoded data (Hotmart envia assim, não JSON)
- [ ] Validar campos obrigatórios: `n`, `src`, `event`, `signature`
- [ ] Importar função `validarAssinatura()` localizada em arquivo compartilhado

#### Validação de Assinatura HMAC

- [ ] Usar `crypto.createHmac('sha256', secret)` do Deno
- [ ] Recalcular: `hash = HMAC-SHA256(n + src + event, webhook_secret)`
- [ ] Comparar com `signature` recebida
- [ ] Se divergir, retornar 401 (Hotmart vai retentar automaticamente)

#### Registrar Webhook

- [ ] Sempre registrar webhook recebido em `webhook_logs_hotmart` (antes de tudo)
- [ ] Incluir: payload_raw, status_processamento='recebido', ip_origem, user_agent
- [ ] Usar timestamp para auditoria

#### Switch por Event

Implementar handler para cada evento:

- [ ] **"approved"** → `processarAprovacao()`
  - [ ] Buscar transação por `hotmart_purchase_id`
  - [ ] Buscar treinadora
  - [ ] Calcular novo saldo: `creditos_novos = creditos_antigos + quantidade_creditos`
  - [ ] UPDATE `transacoes_hotmart`: status=approved, creditos_aplicados_at=NOW()
  - [ ] UPDATE `treinadoras`: creditos=creditos_novos
  - [ ] INSERT `historial_creditos`: tipo='compra', quantidade_creditada=+N
  - [ ] Enviar email de confirmação (async)
  - [ ] Retornar {success: true}

- [ ] **"confirming"** → `processarConfirmacao()`
  - [ ] Registrar apenas (não fazer nada ainda)
  - [ ] status_processamento='validado'
  - [ ] Aguardar próximo webhook

- [ ] **"failed"** → `processarFalha()`
  - [ ] UPDATE `transacoes_hotmart`: status=failed
  - [ ] Registrar em metadados por que falhou
  - [ ] Enviar notificação ao cliente
  - [ ] Retornar {success: true, message: "Falha registrada"}

- [ ] **"refunded"** → `processarReembolso()`
  - [ ] Buscar transação + treinadora
  - [ ] Calcular novo saldo: `creditos_novos = MAX(0, creditos_antigos - quantidade_creditos)`
  - [ ] UPDATE `transacoes_hotmart`: status=refunded
  - [ ] UPDATE `treinadoras`: creditos=creditos_novos
  - [ ] INSERT `historial_creditos`: tipo='reversal', quantidade_creditada=-N
  - [ ] Enviar notificação
  - [ ] Retornar {success: true}

- [ ] **"cancelled"** → `processarCancelamento()`
  - [ ] UPDATE `transacoes_hotmart`: status=cancelled
  - [ ] Nenhuma movimentação de créditos (nunca foi aprovada)
  - [ ] Retornar {success: true}

- [ ] **Default** → Erro
  - [ ] Evento desconhecido
  - [ ] status_processamento='erro'
  - [ ] Retornar {success: false, message: "Evento desconhecido"}

#### Atualizar Log Final

- [ ] Após processar, UPDATE `webhook_logs_hotmart` com resultado
- [ ] Incluir: transacao_hotmart_id, status_processamento ('processado' ou 'erro'), resultado {success, message}

#### Resposta Final

- [ ] Sempre retornar **200 OK** ao Hotmart (mesmo se houve erro interno)
  - [ ] Hotmart marca webhook como recebido apenas com 200
  - [ ] Se retornar erro, Hotmart retenta por horas
- [ ] Resposta JSON: `{success: true, message: "Webhook processado"}`

#### Tratamento de Erro

- [ ] Try-catch envolvendo todo o handler
- [ ] Console.error() para debug
- [ ] Nunca re-throw exception sem retornar resposta
- [ ] Rate limiting: máximo X webhooks/segundo (verificar IP)
- [ ] Timeout: não ficar esperando > 30s

#### Teste (Local + Sandbox)

- [ ] Deploy em dev/staging
- [ ] Usar webhook tester (getwebhook.com ou simular com curl)
- [ ] Testar assinatura válida → deve processar
- [ ] Testar assinatura inválida → deve retornar 401
- [ ] Testar evento 'approved' → deve atualizar créditos
- [ ] Testar webhook duplicado → deve ser idempotente
- [ ] Verificar logs em `webhook_logs_hotmart`

---

### 2.2 Gerar Link Hotmart

**Arquivo**: `supabase/functions/gerar-link-hotmart/index.ts`

#### Setup

- [ ] Criar diretório `supabase/functions/gerar-link-hotmart/`
- [ ] Criar `index.ts` com 300+ linhas
- [ ] Definir interface `GerarLinkPayload`
- [ ] Definir `TABELA_PRECOS: Record<number, number>` com mapeamento quantidade → centavos

#### Parsing & Validação

- [ ] Validar autenticação: token em header Authorization
- [ ] Parsear JSON body: `{treinadoraId, quantidadeCreditos}`
- [ ] Validar `treinadoraId` é UUID válido
- [ ] Validar `quantidadeCreditos` ∈ {2, 5, 10, 20}
- [ ] Validar treinadora existe (SELECT by id)

#### Criar Transação Pendente

- [ ] INSERT em `transacoes_hotmart`:
  - [ ] treinadora_id = request.treinadoraId
  - [ ] hotmart_purchase_id = temporary ID (será sobrescrito pelo webhook com ID real)
    - [ ] Formato sugerido: `TEMP-${Date.now()}-${random()}`
  - [ ] quantidade_creditos = quantidadeCreditos
  - [ ] valor_bruto_centavos = TABELA_PRECOS[quantidadeCreditos]
  - [ ] status = 'pending'
  - [ ] metadados = {link_gerado_em, ip_origem, user_agent, device_info}
- [ ] Retornar ID da transação criada

#### Gerar URL Hotmart

- [ ] Construir URL base: `https://checkout.hotmart.com/` (ou seu domínio customizado)
- [ ] Adicionar parâmetros query:
  - [ ] `src`: treinadoraId (seu custom var para rastrear)
  - [ ] `utm_source`: 'decifra_app'
  - [ ] `utm_medium`: 'in_app'
  - [ ] `utm_campaign`: `creditos_${quantidadeCreditos}`
  - [ ] `utm_content`: transacao_id (para linking)
- [ ] **IMPORTANTE**: Você precisa configurar SKUs no Hotmart e adicionar o SKU ID na URL
  - [ ] SKU_2_CREDITOS = "xxxx" (configurado no Hotmart dashboard)
  - [ ] SKU_5_CREDITOS = "xxxx"
  - [ ] SKU_10_CREDITOS = "xxxx"
  - [ ] SKU_20_CREDITOS = "xxxx"
  - [ ] Adicionar na URL: `?sku=${SKU_ID}`

#### Resposta

- [ ] Retornar JSON:
```json
{
  "success": true,
  "linkHotmart": "https://...",
  "transacaoId": "uuid",
  "quantidade_creditos": 5,
  "valor_reais": "227.00"
}
```

#### Tratamento de Erro

- [ ] Treinadora não encontrada → 404
- [ ] Quantidade inválida → 400
- [ ] Erro ao criar transação → 500
- [ ] Sempre retornar JSON estruturado

#### Teste

- [ ] Criar transação com valid treinadoraId + quantidade
- [ ] Verificar se transacao_hotmart foi inserida com status='pending'
- [ ] Verificar se URL gerada é válida (não erros no formato)
- [ ] Testar com quantidade inválida → deve rejeitar

---

### 2.3 Listar Transações (Admin/Treinadora)

**Arquivo**: `supabase/functions/listar-transacoes/index.ts`

#### Setup

- [ ] Criar `supabase/functions/listar-transacoes/index.ts` (150 linhas)
- [ ] GET endpoint com query params

#### Validação

- [ ] Validar autenticação (token JWT)
- [ ] Query param: `treinadora_id` (UUID)
- [ ] Query param: `limit` opcional (default 50, max 200)
- [ ] Query param: `offset` opcional (default 0, para paginação)
- [ ] Query param: `status` opcional (filter por status específico)

#### Buscar Transações

- [ ] SELECT * FROM transacoes_hotmart
  - [ ] WHERE treinadora_id = request.treinadora_id
  - [ ] WHERE status = query.status (se fornecido)
  - [ ] ORDER BY created_at DESC
  - [ ] LIMIT limit OFFSET offset
- [ ] Aplicar RLS (auth.uid() == treinadora_id)
- [ ] Retornar apenas campos públicos (sem webhook_secret, etc)

#### Respostaosta

```json
{
  "success": true,
  "transacoes": [
    {
      "id": "uuid",
      "hotmart_purchase_id": "12345",
      "quantidade_creditos": 5,
      "valor_reais": 227.00,
      "status": "approved",
      "created_at": "2026-04-16T10:30:00Z",
      "creditos_aplicados_at": "2026-04-16T10:35:00Z"
    }
  ],
  "total": 15,
  "limit": 50,
  "offset": 0
}
```

#### Teste

- [ ] Listar transações da treinadora A → deve retornar apenas dela
- [ ] Listar transações da treinadora B → deve retornar apenas dela & 403 se não autorizada
- [ ] Filtrar por status='approved' → deve retornar apenas aprovadas
- [ ] Paginação funciona (offset + limit)

---

### 2.4 Archive do Supabase (deno.json)

- [ ] Verificar se arquivo `supabase/deno.json` está configurado corretamente
- [ ] Adicionar imports necessários:
  - [ ] `jsr:@supabase/supabase-js@2` para cliente
  - [ ] `node:crypto` para HMAC (Deno fornece)

---

## 🛜 FASE 3: CONFIGURAÇÃO HOTMART (1,5 horas)

### 3.1 Configurar Produtos (SKUs)

- [ ] Acessar dashboard Hotmart: https://app.hotmart.com/
- [ ] Menu **Produtos** → **Meus Produtos**
- [ ] Criar/editar 4 produtos ou usar variações:

| Produto | Preço | SKU ID | Notas |
|---------|-------|--------|-------|
| 2 Créditos Decifra | R$ 97,00 | [ ] Copie aqui | Salve para usar em gerar-link |
| 5 Créditos Decifra | R$ 227,00 | [ ] | ... |
| 10 Créditos Decifra | R$ 397,00 | [ ] | ... |
| 20 Créditos Decifra | R$ 697,00 | [ ] | ... |

- [ ] Para cada produto:
  - [ ] Definir descrição clara ("Receba 5 créditos para avaliar seus clientes")
  - [ ] Definir categoria (ex: "Serviços")
  - [ ] Ativar produto
  - [ ] Copiar SKU/ID (será usado em code)

### 3.2 Configurar Webhook

- [ ] Menu **Integrações** → **Webhooks** (ou **Notificações**)
- [ ] Adicionar novo webhook:
  - [ ] **Nome**: "Decifra Purchase Webhook"
  - [ ] **URL**: `https://seu-projeto.supabase.co/functions/v1/hotmart-webhook`
    - [ ] Substituir `seu-projeto` pelo seu projeto real
  - [ ] **Método**: POST
  - [ ] **Formato**: Form-encoded (não JSON)
  - [ ] **Eventos**: Selecione:
    - [ ] Purchase Approved ✅
    - [ ] Purchase Confirming
    - [ ] Purchase Failed ✅
    - [ ] Purchase Refunded ✅
    - [ ] Purchase Cancelled ✅

### 3.3 Gerar & Copiar Webhook Secret

- [ ] Menu **Segurança** → **Chaves da API** (ou **Integrações** → **API Keys**)
- [ ] Criar nova chave: "Webhook Validation Secret"
- [ ] Copiar chave secreta
- [ ] Guardar em local seguro (será adicionada a Supabase env vars)

### 3.4 Configurar URLs de Redirecionamento

- [ ] No Hotmart dashboard, encontre seção de **Configuração de Checkout**
- [ ] **URL de Sucesso**: `decifra://creditos/sucesso?transacao_id={custom_var}`
  - [ ] Hotmart substitui `{custom_var}` pelo valor que você enviou em `src`
- [ ] **URL de Falha/Cancelamento**: `decifra://creditos/cancelado`

### 3.5 Environment Variables no Supabase

- [ ] Ir para Supabase Dashboard → seu projeto → **Settings** → **Edge Functions**
- [ ] Adicionar as seguintes variáveis:

```
HOTMART_APP_ID = 7575025
HOTMART_WEBHOOK_SECRET = [sua_chave_secreta]
SKU_2_CREDITOS = [id do SKU no Hotmart]
SKU_5_CREDITOS = [id do SKU no Hotmart]
SKU_10_CREDITOS = [id do SKU no Hotmart]
SKU_20_CREDITOS = [id do SKU no Hotmart]
```

- [ ] Verificar que todas as variáveis foram salvas

### 3.6 Testar em Sandbox (Recomendado)

- [ ] Hotmart oferece ambiente sandbox
- [ ] Ativar sandbox mode no dashboard
- [ ] Usar app ID de sandbox (diferente)
- [ ] Fazer pagamento de teste
- [ ] Validar que webhook é recebido
- [ ] Depois, migrar para produção

---

## 🎨 FASE 4: UI/UX (4 horas)

### 4.1 Componente: Ofertas de Créditos

**Arquivo**: `app/cliente/creditos/CompraCreditos.tsx` (ou local apropriado)

- [ ] Exibir 4 cards de oferta (2, 5, 10, 20 créditos)
- [ ] Cada card mostra:
  - [ ] Número de créditos (grande/destaque)
  - [ ] Preço em R$
  - [ ] Desconto/economia (se aplicável - ex: "20 = menos por unidade")
  - [ ] Botão "Comprar Agora"
- [ ] Estilo: light mode (conforme preferência do usuário)
- [ ] Responsivo para mobile

#### Estrutura Esperada

```tsx
<View style={styles.container}>
  {ofertas.map(oferta => (
    <OfertaCard
      creditos={oferta.cantidad}
      preco={oferta.preco}
      onPress={() => irParaCheckout(oferta)}
    />
  ))}
</View>
```

- [ ] Cada card é clicável
- [ ] Ao clicar, chama edge function `gerar-link-hotmart`

### 4.2 Componente: Loading durante Compra

**Arquivo**: `components/ProcessandoCompra.tsx`

- [ ] Spinner animado
- [ ] Texto: "Preparando sua compra..."
- [ ] Mostrado enquanto aguarda resposta de `gerar-link-hotmart`
- [ ] Se demorar > 10s, mostrar "Tente novamente"

### 4.3 Rota: Confirmar Compra

**Arquivo**: `app/creditos/sucesso.tsx` (novo arquivo de rota)

- [ ] Recebe parâmetro URL: `transacao_id` (via deep link)
- [ ] Ao montar:
  - [ ] Busca status da transação em `transacoes_hotmart`
  - [ ] Se status = 'approved': mostra ✅ sucesso
  - [ ] Se status = 'pending': mostra spinner ("Confirmando...")
  - [ ] Se status = 'failed': mostra ❌ erro
- [ ] Exibe:
  - [ ] ✅ Ícone de sucesso (grande)
  - [ ] "Compra Confirmada!"
  - [ ] Detalhes: quantidade de créditos, valor, data/hora
  - [ ] **Novo saldo de créditos** (busca de treinadoras.creditos)
  - [ ] Botão "Voltar ao Dashboard"

```tsx
export default function SucessoCompra({ transacao_id }) {
  const [transacao, setTransacao] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Buscar status da transação
    // GET /listar-transacoes?transacao_id=xxx
    // Atualizar estado
  }, []);

  if (loading) return <Spinner />;
  if (transacao.status === 'approved') {
    return <TelaSuccess transacao={transacao} />;
  } else if (transacao.status === 'pending') {
    return <TelaAguardando />;
  } else {
    return <TelaFalha />;
  }
}
```

### 4.4 Rota: Cancelamento

**Arquivo**: `app/creditos/cancelado.tsx` (novo arquivo de rota)

- [ ] Recebe deep link: `decifra://creditos/cancelado`
- [ ] Exibe:
  - [ ] ❌ Ícone de cancelamento
  - [ ] "Compra Cancelada"
  - [ ] "Nenhum crédito foi debitado"
  - [ ] Botão "Tentar Novamente"
  - [ ] Botão "Voltar ao Dashboard"

### 4.5 Deep Linking Setup

**Arquivo**: `app/_layout.tsx` (se não existir, ou criar novo)

- [ ] Configurar Expo Linking com scheme `decifra://`
- [ ] Rotas:
  - [ ] `creditos/sucesso/:transacao_id`
  - [ ] `creditos/cancelado`

```tsx
const linking = {
  prefixes: ['decifra://', 'https://seudominio.com/'],
  config: {
    screens: {
      creditos: {
        screens: {
          sucesso: 'creditos/sucesso/:transacao_id',
          cancelado: 'creditos/cancelado',
        },
      },
    },
  },
};
```

### 4.6 Integração com Usuário Autenticado

- [ ] Buscar `current user` (treinadora) do Supabase Auth
- [ ] Ao clicar "Comprar", enviar seu `id` em `gerar-link-hotmart`
- [ ] Armazenar `transacao_id` localmente (AsyncStorage) para depois verificar status
- [ ] Ao voltar do Hotmart, verificar status automaticamente

---

## 🧪 FASE 5: TESTES & DEPLOY (3 horas)

### 5.1 Testes Locais

- [ ] **Validação de assinatura**
  - [ ] Testar com assinatura válida → deve processar
  - [ ] Testar com assinatura inválida → deve retornar 401
  - [ ] Testar com payload incompleto → deve retornar 400

- [ ] **Idempotência**
  - [ ] Enviar webhook com mesmo purchase_id 2x
  - [ ] Verificar que créditos só são adicionados 1x (não duplicados)
  - [ ] Log deve ter ambos webhooks registrados

- [ ] **Estados de Transação**
  - [ ] Simular webhook 'approved' → status muda para 'approved', créditos adicionados
  - [ ] Simular webhook 'failed' → status muda para 'failed', nenhum crédito
  - [ ] Simular webhook 'refunded' → status muda para 'refunded', créditos revertidos

- [ ] **Cálculos**
  - [ ] Validar que quantidades corretas são adicionadas (2, 5, 10, 20)
  - [ ] Validar que preços estão corretos
  - [ ] Validar que histórico é criado corretamente

- [ ] **Recuperação de Erros**
  - [ ] Se edge function cai, webhook é armazenado em log
  - [ ] Hotmart vai retentar automaticamente
  - [ ] Quando função volta, processa webhook do zero

### 5.2 Testes em Sandbox Hotmart

- [ ] [ ] Ativar modo sandbox no dashboard Hotmart
- [ ] [ ] Fazer compra de teste (com cartão de teste)
- [ ] [ ] Validar que webhook é recebido corretamente
- [ ] [ ] Validar que transação é criada em `transacoes_hotmart`
- [ ] [ ] Validar que créditos foram adicionados ao usuário
- [ ] [ ] Validar que histórico foi registrado
- [ ] [ ] Email de confirmação foi enviado (opcional)

### 5.3 Testes E2E (Completo)

- [ ] [ ] Treinadora acessa app
- [ ] [ ] Clica "Comprar Créditos"
- [ ] [ ] Seleciona oferta (ex: 5 créditos)
- [ ] [ ] Vê modal de loading
- [ ] [ ] Redireciona para Hotmart
- [ ] [ ] Preenche dados de pagamento (teste)
- [ ] [ ] Completa pagamento
- [ ] [ ] Hotmart redireciona voltando ao app (deep link)
- [ ] [ ] Vê tela de sucesso com novo saldo
- [ ] [ ] Volta ao dashboard
- [ ] [ ] Novo saldo aparece no dashboard

### 5.4 Teste de Reembolso

- [ ] [ ] Iniciar compra (status = 'approved')
- [ ] [ ] Abrir transação em Hotmart admin
- [ ] [ ] Reembolsar transação
- [ ] [ ] Aguardar webhook 'refunded'
- [ ] [ ] Validar que créditos foram revertidos
- [ ] [ ] Validar que status = 'refunded'
- [ ] [ ] Email de notificação foi enviado

### 5.5 Teste de Segurança

- [ ] [ ] Tentar enviar webhook com assinatura falsa → deve rejeitar
- [ ] [ ] Tentar UPDATE direto na tabela `transacoes_hotmart` como treinadora → deve bloquear (RLS)
- [ ] [ ] Tentar ver transações de outra treinadora → deve bloquear (RLS)
- [ ] [ ] Webhook secret não está exposto no código (env var apenas)

### 5.6 Performance

- [ ] [ ] Webhook processa < 2 segundos
- [ ] [ ] Edge function `gerar-link-hotmart` responde < 1 segundo
- [ ] [ ] Rota de sucesso carrega < 3 segundos

### 5.7 Logs & Monitoring

- [ ] [ ] Verificar que todos os webhooks são logados em `webhook_logs_hotmart`
- [ ] [ ] Verificar que histórico de créditos é auditado em `historial_creditos`
- [ ] [ ] Configurar alertas (Sentry/LogRocket/etc) para erros

---

## 🚀 FASE 6: DEPLOY PRODUÇÃO (1 hora)

### 6.1 Migração de Banco de Dados

- [ ] [ ] Backup do banco produção (Supabase oferece auto-backup)
- [ ] [ ] Rodar migrations SQL em produção
- [ ] [ ] Testar RLS policies em produção
- [ ] [ ] Verificar que tabelas foram criadas

### 6.2 Deploy de Edge Functions

- [ ] [ ] Deploy `hotmart-webhook` → `https://[seu-projeto].supabase.co/functions/v1/hotmart-webhook`
- [ ] [ ] Deploy `gerar-link-hotmart` → `https://[seu-projeto].supabase.co/functions/v1/gerar-link-hotmart`
- [ ] [ ] Deploy `listar-transacoes` → `https://[seu-projeto].supabase.co/functions/v1/listar-transacoes`
- [ ] [ ] Verificar logs (tail -f)

### 6.3 Migração para Produção Hotmart

- [ ] [ ] Trocar ambiente de Sandbox para Produção
- [ ] [ ] Atualize webhook URL no Hotmart (se diferente)
- [ ] [ ] Validar SKU IDs produção
- [ ] [ ] Testar primeiro com compra real de pequeno valor

### 6.4 Atualizar App no Expo

- [ ] [ ] Mergear branch de creditos para main
- [ ] [ ] Fazer EAS build para produção
- [ ] [ ] Publicar versão no Expo

### 6.5 Monitoramento

- [ ] [ ] Configurar alertas para falhas em `hotmart-webhook`
- [ ] [ ] Monitorar taxa de sucesso vs falha
- [ ] [ ] Revisar `webhook_logs_hotmart` regularmente (bugs?)
- [ ] [ ] Revisar `historial_creditos` para reconciliação

---

## 📊 METRICAS DE SUCESSO

- [ ] **Taxa de conversão**: X% de usuários que clicam "Comprar" completam pagamento
- [ ] **Taxa de falha de webhook**: < 0.1% (deve ser idempotente)
- [ ] **Tempo E2E**: < 2 minutos (desde clique até créditos adicionados)
- [ ] **Disponibilidade**: > 99.9% (uptime Hotmart + sua função)

---

## 🐛 TROUBLESHOOTING COMUM

| Problema | Causa | Solução |
|----------|-------|---------|
| Webhook não chega | URL incorreta | Verificar em Hotmart > Integrações > Webhook URL |
| Assinatura inválida | Secret errada | Copiar secret correto do Hotmart > Segurança |
| Créditos não adicionam | RLS bloqueando | Usar service role key em edge function |
| Link Hotmart não funciona | SKU ID inválido | Verificar SKU em Hotmart > Produtos |
| Transação duplica | Webhook retentado 2x | Usar unique constraint em purchase_id ✓ |
| Status fica "pending" | Webhook não recebido | Verificar webhook_logs_hotmart + logs do Hotmart |

---

## 📝 NOTAS

- **Hotmart suporta webhooks de retry**: Se você retornar não-200, Hotmart retenta por horas
- **Use Sandbox primeiro**: Teste tudo em sandbox antes de produção
- **Idempotência é crítica**: Mesmo webhook pode chegar 2x
- **Créditos são irreversíveis**: Uma vez adicionados, só remove via reembolso ou ajuste admin
- **Auditoria é obrigatória**: Sempre registre em `historial_creditos`

---

**Status**: 🔴 Não iniciado

**Próximas Ações**:
1. Revisar documento completo
2. Começar Fase 1 (Banco de Dados)
3. Marque itens conforme completa

---
