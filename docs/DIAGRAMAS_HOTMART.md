# 🔄 DIAGRAMA: FLUXO DE INTEGRAÇÃO HOTMART

## 1. FLUXO COMPLETO DE COMPRA

```mermaid
sequenceDiagram
    participant APP as App (Cliente)
    participant EdgeFn as Edge Function<br/>(gerar-link)
    participant Hotmart as Hotmart<br/>(Pagamento)
    participant Webhook as Edge Function<br/>(webhook)
    participant DB as Database<br/>(Supabase)
    participant Email as Email Service<br/>(Notif)

    APP->>+EdgeFn: 1. POST /gerar-link-hotmart<br/>(treinadora_id, quantidade)
    EdgeFn->>+DB: 2. INSERT transacoes_hotmart<br/>(status='pending')
    DB-->>-EdgeFn: transacao_id
    EdgeFn-->>-APP: 3. Link Hotmart + transacao_id
    
    APP->>+Hotmart: 4. Redireciona para checkout
    Hotmart->>Hotmart: 5. Cliente preenche dados<br/>de pagamento
    Hotmart->>Hotmart: 6. Processa pagamento
    
    Hotmart->>+Webhook: 7. POST webhook<br/>(event='approved',<br/>signature=HMAC)
    
    Webhook->>Webhook: 8. Valida assinatura
    Webhook->>+DB: 9. SELECT transacao by<br/>hotmart_purchase_id
    DB-->>-Webhook: transacao_data
    
    Webhook->>+DB: 10. UPDATE transacao<br/>(status='approved')
    Webhook->>DB: 11. UPDATE treinadoras<br/>(creditos += N)
    Webhook->>DB: 12. INSERT historial_creditos
    DB-->>-Webhook: Success
    
    Webhook->>+Email: 13. Enviar confirmação
    Email-->>-Webhook: Email sent
    
    Webhook-->>-Hotmart: 14. Return 200 OK
    
    Hotmart->>-APP: 15. Redireciona volta ao app<br/>(deep link)
    APP->>+DB: 16. Verifica status<br/>da transacao
    DB-->>-APP: status='approved'
    APP->>APP: 17. Mostra sucesso<br/>+ novo saldo

```

## 2. ARQUITETURA DE BANCO DE DADOS

```mermaid
erDiagram
    TREINADORAS ||--o{ TRANSACOES_HOTMART : faz
    TREINADORAS ||--o{ HISTORIAL_CREDITOS : auditoria
    TRANSACOES_HOTMART ||--o{ WEBHOOK_LOGS : registra
    TRANSACOES_HOTMART ||--o{ HISTORIAL_CREDITOS : gera

    TREINADORAS {
        uuid id PK
        text email UK
        text nome
        integer creditos
        integer creditos_suspensos
        timestamp created_at
        timestamp updated_at
    }

    TRANSACOES_HOTMART {
        uuid id PK
        uuid treinadora_id FK
        text hotmart_purchase_id UK
        text hotmart_subscriber_id
        integer quantidade_creditos
        bigint valor_bruto_centavos
        text status
        timestamp created_at
        timestamp webhook_confirmed_at
        timestamp creditos_aplicados_at
        jsonb metadados
    }

    HISTORIAL_CREDITOS {
        uuid id PK
        uuid treinadora_id FK
        uuid transacao_hotmart_id FK
        text tipo
        integer creditos_antes
        integer quantidade_creditada
        integer creditos_depois
        uuid cliente_id FK
        text descricao
        timestamp created_at
    }

    WEBHOOK_LOGS {
        uuid id PK
        text hotmart_purchase_id
        uuid transacao_hotmart_id FK
        jsonb payload_raw
        text status_processamento
        jsonb resultado
        text ip_origem
        timestamp created_at
    }

    CHAVES_HOTMART {
        uuid id PK
        text app_id UK
        text chave_privada ENC
        text webhook_secret_key ENC
        boolean ativo
        text ambiente
        text url_webhook
        text url_redirect_sucesso
        text url_redirect_cancelamento
        timestamp testado_em
    }
```

## 3. MÁQUINA DE ESTADOS (Transações)

```mermaid
stateDiagram-v2
    [*] --> pending: gerar-link-hotmart
    
    pending --> approved: webhook event='approved'
    pending --> failed: webhook event='failed'
    pending --> confirming: webhook event='confirming'
    pending --> cancelled: webhook event='cancelled'
    
    confirming --> approved: webhook event='approved'
    confirming --> failed: webhook event='failed'
    
    approved --> refunded: webhook event='refunded'
    failed --> [*]
    cancelled --> [*]
    refunded --> [*]
    
    note right of pending
        Aguardando confirmação
        de pagamento no Hotmart
    end note
    
    note right of confirming
        Status intermediário
        (raro)
    end note
    
    note right of approved
        ✅ Créditos ADICIONADOS
        à treinadora
    end note
    
    note right of failed
        ❌ Pagamento falhou
        Enviar notificação
    end note
    
    note right of refunded
        ⚠️ Créditos REVERTIDOS
        de volta
    end note
```

## 4. ESTRUTURA DE DIRETÓRIOS - EDGE FUNCTIONS

```
supabase/functions/
│
├── hotmart-webhook/
│   ├── index.ts (600 linhas)
│   │   ├── CORS headers
│   │   ├── Parse form-encoded data (Hotmart)
│   │   ├── Validar assinatura HMAC
│   │   ├── Switch por event (approved/failed/refunded/cancelled)
│   │   ├── processarAprovacao() - UPDATE creditos
│   │   ├── processarFalha()
│   │   ├── processarReembolso()
│   │   └── RLS: Read from transacoes, Insert webhook_logs
│   │
│   └── validar-assinatura.ts (COMPARTILHADO)
│       └── função validarAssinatura(payload, secret): string
│
├── gerar-link-hotmart/
│   └── index.ts (300 linhas)
│       ├── Validar treinadora_id + quantidadeCreditos
│       ├── Mapear quantidade → preço (tabela)
│       ├── INSERT em transacoes_hotmart (status=pending)
│       ├── Gerar URL Hotmart checkout
│       └── Retornar {linkHotmart, transacao_id, valor}
│
├── listar-transacoes/
│   └── index.ts (150 linhas)
│       ├── GET /listar-transacoes?treinadora_id=xxx
│       ├── SELECT transacoes_hotmart
│       ├── RLS: Treinadora vê apenas suas
│       └── Retornar array de transações
│
└── [Functions existentes]
    ├── cadastrar-cliente/
    ├── enviar-codigo-email/
    └── ...
```

## 5. VALIDAÇÃO DE ASSINATURA - FLUXO CRITÉRIO

```mermaid
flowchart TD
    A["Webhook recebido<br/>(POST request)"] --> B["Parse payload:<br/>n, src, event, signature"]
    B --> C["Construir mensagem:<br/>msg = n + src + event"]
    C --> D["Calcular HMAC-SHA256:<br/>hash = HMAC-SHA256(msg, SECRET_KEY)"]
    D --> E{"hash ==<br/>signature ?"} 
    E -->|Sim| F["✅ Assinatura válida<br/>Processar webhook"]
    E -->|Não| G["❌ Assinatura inválida<br/>Return 401 Unauthorized"]
    F --> H["Registrar em webhook_logs<br/>status='validado'"]
    G --> I["Registrar em webhook_logs<br/>status='erro'"]
    H --> J["Executar lógica<br/>conforme event"]
    I --> K["Retornar 401<br/>(Hotmart vai retentar)"]
    J --> L["Return 200 OK"]
    L --> M["Hotmart marca webhook<br/>como processado"]
```

## 6. CICLO DE RECONCILIAÇÃO

```mermaid
flowchart LR
    A["Webhook<br/>recebido"] --> B["Log na<br/>webhook_logs"]
    B --> C["Atualizar<br/>transacao"]
    C --> D["UPDATE<br/>treinadoras.creditos"]
    D --> E["INSERT<br/>historial_creditos"]
    E --> F["Enviar<br/>email"]
    F --> G["✅ Completo"]
    
    style A fill:#e1f5ff
    style G fill:#c8e6c9
    style B fill:#fff3e0
    style D fill:#f3e5f5
    style E fill:#ede7f6
```

## 7. PROTEÇÃO CONTRA DUPLICAÇÃO (Idempotência)

```mermaid
flowchart TD
    A["Webhook 1 recebido<br/>(purchase_id=123)"] --> B["SELECT * FROM transacoes_hotmart<br/>WHERE hotmart_purchase_id='123'"]
    B --> C{"Transação<br/>existe ?"} 
    C -->|Não| D["INSERT nova<br/>transacao"]
    C -->|Sim| E["❓ Verificar status"]
    D --> F["status = 'pending'<br/>creditos_aplicados_at = NULL"]
    E --> G{"Status é<br/>'approved' ?"} 
    G -->|Sim| H["⚠️ Já processada<br/>Return 200<br/>(não reprocessar)"]
    G -->|Não| I["Continuar com<br/>novo processamento"]
    F --> J["Continuar com<br/>processamento"]
    I --> K["Return 200"]
    H --> K
    J --> K
    K --> L["Webhook 2 chega<br/>(mesma purchase_id)<br/>30 segundos depois"]
    L --> B
    
    style H fill:#ffcdd2
    style J fill:#c8e6c9
```

## 8. FLUXO REVERSAL - REEMBOLSO

```mermaid
flowchart TD
    A["Webhook event='refunded'<br/>(hotmart_purchase_id=123)"] --> B["SELECT transacao<br/>WHERE hotmart_purchase_id='123'"]
    B --> C["SELECT treinadora<br/>WHERE id=transacao.treinadora_id"]
    C --> D["creditos_novos = MAX(0,<br/>creditos_atuais - quantidade)"]
    D --> E["UPDATE transacao<br/>status='refunded'"]
    E --> F["UPDATE treinadoras<br/>creditos=creditos_novos"]
    F --> G["INSERT historial_creditos<br/>tipo='reversal'<br/>quantidade_creditada=-N"]
    G --> H["Enviar email<br/>de notificação"]
    H --> I["✅ Reembolso processado<br/>Return 200"]
    
    style I fill:#a5d6a7
    style H fill:#fff9c4
```

## 9. PLANO DE TESTES

```mermaid
flowchart TD
    A["🧪 Testes de Integração Hotmart"] --> B["TESTES SANDBOX"]
    
    B --> B1["1️⃣ Compra bem-sucedida<br/>→ Webhook 'approved'<br/>→ Créditos adicionados"]
    B --> B2["2️⃣ Transação duplicada<br/>→ 2º webhook mesmo ID<br/>→ Não duplica créditos"]
    B --> B3["3️⃣ Pagamento falha<br/>→ Webhook 'failed'<br/>→ Status=failed, notif"]
    B --> B4["4️⃣ Reembolso<br/>→ Webhook 'refunded'<br/>→ Créditos revertidos"]
    B --> B5["5️⃣ Assinatura inválida<br/>→ Return 401<br/>→ Hotmart retenta"]
    
    A --> C["TESTES PRODUÇÃO"]
    C --> C1["6️⃣ Compra real<br/>→ End-to-end<br/>→ Validar tudo"]
    C --> C2["7️⃣ Audit logs<br/>→ historial_creditos OK<br/>→ webhook_logs OK"]

    style B1 fill:#c8e6c9
    style B2 fill:#ffccbc
    style B3 fill:#ffcdd2
    style B4 fill:#b3e5fc
    style B5 fill:#fff9c4
    style C1 fill:#a5d6a7
    style C2 fill:#81c784
```

## 10. Roadmap Gantt (Timeline)

```mermaid
gantt
    title Roadmap Integração Hotmart - Decifra
    dateFormat YYYY-MM-DD
    
    section Database
    Migrations SQL             :db1, 2026-04-16, 2h
    RLS Policies              :db2, after db1, 1h
    
    section Edge Functions
    hotmart-webhook           :fn1, after db2, 4h
    gerar-link-hotmart        :fn2, after fn1, 2h
    listar-transacoes         :fn3, after fn2, 1h
    Testing Funcs             :fn4, after fn3, 2h
    
    section Hotmart Setup
    Create Produtos (SKUs)    :cfg1, after fn4, 1h
    Config Webhook            :cfg2, after cfg1, 30m
    Teste Sandbox             :cfg3, after cfg2, 1h
    Deploy Produção           :cfg4, after cfg3, 30m
    
    section UI/UX
    CompraCreditos Comp       :ui1, after cfg4, 2h
    ProcessandoCompra Comp    :ui2, after ui1, 1h
    Deep Linking Routes       :ui3, after ui2, 1h
    ConfirmacaoCompra Comp    :ui4, after ui3, 1h
    
    section Testing & Deploy
    Teste E2E                 :test1, after ui4, 2h
    Load Testing              :test2, after test1, 1h
    Deploy Final              :deploy1, after test2, 1h
```

---

**Legenda**:
- 🔐 Encriptado em repouso
- 📝 Auditado/Logged
- ✅ Idempotente
- 🔄 Reversível
- ⚡ Async
