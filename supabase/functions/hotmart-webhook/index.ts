import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hotmart-hottok, x-hotmart-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type GenericPayload = Record<string, unknown>;

type CompraStatus = "concluida" | "cancelada" | "pendente";

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEvent(value: string): string {
  return value.trim().toLowerCase();
}

function parseToObject(rawBody: string, contentType: string | null): GenericPayload {
  if (!rawBody.trim()) return {};

  if (contentType?.includes("application/json")) {
    return JSON.parse(rawBody) as GenericPayload;
  }

  if (
    contentType?.includes("application/x-www-form-urlencoded") ||
    contentType?.includes("multipart/form-data")
  ) {
    const params = new URLSearchParams(rawBody);
    const obj: GenericPayload = {};
    for (const [key, value] of params.entries()) {
      obj[key] = value;
    }
    return obj;
  }

  try {
    return JSON.parse(rawBody) as GenericPayload;
  } catch {
    const params = new URLSearchParams(rawBody);
    const obj: GenericPayload = {};
    for (const [key, value] of params.entries()) {
      obj[key] = value;
    }
    return obj;
  }
}

function getByPath(payload: GenericPayload, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = payload;

  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in (current as GenericPayload))) {
      return undefined;
    }
    current = (current as GenericPayload)[part];
  }

  return current;
}

function getFirstString(payload: GenericPayload, paths: string[]): string | null {
  for (const path of paths) {
    const value = getByPath(payload, path);
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function getFirstNumber(payload: GenericPayload, paths: string[]): number | null {
  for (const path of paths) {
    const value = getByPath(payload, path);

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string") {
      const cleaned = value.replace(/\./g, "").replace(",", ".").trim();
      const parsed = Number(cleaned);
      if (Number.isFinite(parsed)) return parsed;
    }
  }

  return null;
}

function mapEventToCompraStatus(event: string): CompraStatus {
  const normalized = normalizeEvent(event)
    .replace(/\s+/g, "_")
    .replace(/\./g, "_")
    .replace(/-/g, "_");

  const isConcluida = [
    "approved",
    "approve",
    "aprovada",
    "compra_aprovada",
    "purchase_approved",
    "purchase_completed",
    "complete",
    "completed",
    "compra_completa",
    "finished",
    "paid",
  ].some((token) => normalized.includes(token));

  if (isConcluida) {
    return "concluida";
  }

  const isCancelada = [
    "refunded",
    "refund",
    "reembolsada",
    "compra_reembolsada",
    "purchase_refunded",
    "cancelled",
    "canceled",
    "cancelada",
    "compra_cancelada",
    "purchase_canceled",
    "chargeback",
  ].some((token) => normalized.includes(token));

  if (isCancelada) {
    return "cancelada";
  }

  return "pendente";
}

function getConfiguredProductCredits(productId: number): number | null {
  const rawMap = Deno.env.get("HOTMART_PRODUCT_CREDITS_JSON");
  if (!rawMap) return null;

  try {
    const parsed = JSON.parse(rawMap) as Record<string, number>;
    const value = parsed[String(productId)];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  } catch {
    return null;
  }

  return null;
}

async function computeHmacHex(rawBody: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody));
  const bytes = new Uint8Array(signature);
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  const normalizedA = a.trim().toLowerCase();
  const normalizedB = b.trim().toLowerCase();

  if (normalizedA.length !== normalizedB.length) return false;

  let result = 0;
  for (let i = 0; i < normalizedA.length; i++) {
    result |= normalizedA.charCodeAt(i) ^ normalizedB.charCodeAt(i);
  }

  return result === 0;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatCurrencyBrl(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }

  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function generateTemporaryPassword(length = 12): string {
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghijkmnpqrstuvwxyz";
  const numbers = "23456789";
  const symbols = "@#$%&*!";
  const all = uppercase + lowercase + numbers + symbols;

  const pick = (chars: string) => chars[Math.floor(Math.random() * chars.length)];

  const requiredChars = [
    pick(uppercase),
    pick(lowercase),
    pick(numbers),
    pick(symbols),
  ];

  const remaining: string[] = [];
  for (let i = requiredChars.length; i < length; i++) {
    remaining.push(pick(all));
  }

  const combined = [...requiredChars, ...remaining];

  // Shuffle Fisher-Yates para evitar padrão previsível dos primeiros caracteres.
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.join("");
}

function buildCreditosDisponiveisEmailHtml(params: {
  nome?: string | null;
  email?: string | null;
  senhaTemporaria?: string | null;
  loginUrl?: string | null;
  creditosAdicionados: number;
  creditosTotais: number;
  produto?: string | null;
  valorTotal?: number | null;
}): string {
  const saudacao = params.nome?.trim()
    ? `Olá, <strong>${escapeHtml(params.nome.trim())}</strong>!`
    : "Olá!";

  const produtoInfo = params.produto?.trim()
    ? `<p style=\"margin:0 0 8px;color:#334155;font-size:14px;\"><strong>Produto:</strong> ${escapeHtml(params.produto.trim())}</p>`
    : "";

  const valorInfo = params.valorTotal !== null && params.valorTotal !== undefined
    ? `<p style=\"margin:0;color:#334155;font-size:14px;\"><strong>Valor:</strong> ${formatCurrencyBrl(params.valorTotal)}</p>`
    : "";

  const hasCredenciais = !!params.email && !!params.senhaTemporaria;
  const loginUrl = params.loginUrl?.trim() || "https://decifra.app";

  const credenciaisInfo = hasCredenciais
    ? `
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;background:#eef2ff;border-radius:10px;border:1px solid #c7d2fe;">
        <tr>
          <td style="padding:16px 18px;">
            <p style="margin:0 0 10px;color:#1e293b;font-size:14px;"><strong>Conta criada automaticamente para você</strong></p>
            <p style="margin:0 0 6px;color:#334155;font-size:14px;"><strong>Login:</strong> ${escapeHtml(params.email || "")}</p>
            <p style="margin:0 0 10px;color:#334155;font-size:14px;"><strong>Senha temporária:</strong> ${escapeHtml(params.senhaTemporaria || "")}</p>
            <p style="margin:0 0 6px;color:#334155;font-size:13px;line-height:1.5;">Acesse <a href="${escapeHtml(loginUrl)}" target="_blank" style="color:#1d4ed8;text-decoration:none;">${escapeHtml(loginUrl)}</a> e faça login com os dados acima.</p>
            <p style="margin:0;color:#334155;font-size:13px;line-height:1.5;">Por segurança, altere sua senha no primeiro acesso.</p>
          </td>
        </tr>
      </table>
    `
    : "";

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Créditos disponíveis</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center" style="padding:24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;">
          <tr>
            <td style="background:#0f172a;color:#ffffff;padding:20px 24px;">
              <h1 style="margin:0;font-size:20px;line-height:1.3;">Decifra</h1>
              <p style="margin:6px 0 0;font-size:13px;color:#cbd5e1;">Créditos liberados com sucesso</p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;">
              <p style="margin:0 0 16px;color:#0f172a;font-size:16px;line-height:1.6;">${saudacao}</p>
              <p style="margin:0 0 16px;color:#334155;font-size:15px;line-height:1.6;">
                Confirmamos seu pagamento e seus créditos já estão disponíveis na sua conta Decifra.
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:16px 0;background:#f1f5f9;border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;">
                    <p style="margin:0 0 8px;color:#0f172a;font-size:14px;"><strong>Créditos adicionados:</strong> ${params.creditosAdicionados}</p>
                    <p style="margin:0 0 8px;color:#0f172a;font-size:14px;"><strong>Saldo total:</strong> ${params.creditosTotais}</p>
                    ${produtoInfo}
                    ${valorInfo}
                  </td>
                </tr>
              </table>

              ${credenciaisInfo}

              <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
                Se você não reconhece esta compra, responda este email para nosso suporte.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendCreditosDisponiveisEmail(params: {
  toEmail: string;
  toName?: string | null;
  senhaTemporaria?: string | null;
  loginUrl?: string | null;
  creditosAdicionados: number;
  creditosTotais: number;
  produto?: string | null;
  valorTotal?: number | null;
}): Promise<{ sent: boolean; error?: string }> {
  const brevoApiKey = Deno.env.get("BREVO_API_KEY");
  if (!brevoApiKey) {
    return { sent: false, error: "BREVO_API_KEY não configurada." };
  }

  let fromEmail = Deno.env.get("BREVO_FROM_EMAIL") || "acessos@artioescola.com.br";
  const fromName = Deno.env.get("BREVO_FROM_NAME") || "Decifra";

  if (fromEmail.endsWith("@decifra.app")) {
    fromEmail = "acessos@artioescola.com.br";
  }

  const htmlContent = buildCreditosDisponiveisEmailHtml({
    nome: params.toName,
    email: params.toEmail,
    senhaTemporaria: params.senhaTemporaria,
    loginUrl: params.loginUrl,
    creditosAdicionados: params.creditosAdicionados,
    creditosTotais: params.creditosTotais,
    produto: params.produto,
    valorTotal: params.valorTotal,
  });

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "api-key": brevoApiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: params.toEmail, name: params.toName || "" }],
      subject: "Seus créditos já estão disponíveis na Decifra",
      htmlContent,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    return { sent: false, error: `Falha no Brevo: ${errorBody}` };
  }

  return { sent: true };
}

async function validateWebhookSecurity(req: Request, payload: GenericPayload, rawBody: string): Promise<boolean> {
  const webhookToken = Deno.env.get("HOTMART_WEBHOOK_TOKEN");
  const hmacSecret = Deno.env.get("HOTMART_WEBHOOK_HMAC_SECRET");
  const urlSecret = Deno.env.get("HOTMART_WEBHOOK_URL_SECRET");

  if (!webhookToken && !hmacSecret && !urlSecret) {
    // Evita deploy inseguro por engano.
    return false;
  }

  if (urlSecret) {
    const requestUrl = new URL(req.url);
    const urlSecretCandidate = requestUrl.searchParams.get("s") || requestUrl.searchParams.get("secret");

    if (!urlSecretCandidate || !timingSafeEqual(urlSecretCandidate, urlSecret)) {
      return false;
    }

    return true;
  }

  if (webhookToken) {
    const tokenCandidates = [
      req.headers.get("x-hotmart-hottok"),
      req.headers.get("x-webhook-token"),
      getFirstString(payload, ["hottok", "token", "webhook_token"]),
    ];

    const validToken = tokenCandidates.some((candidate) => (
      typeof candidate === "string" && candidate.length > 0 && timingSafeEqual(candidate, webhookToken)
    ));

    if (!validToken) {
      return false;
    }
  }

  if (hmacSecret) {
    const signatureHeader = req.headers.get("x-hotmart-signature") || req.headers.get("x-signature");
    if (!signatureHeader) return false;

    const expectedHmac = await computeHmacHex(rawBody, hmacSecret);
    if (!timingSafeEqual(signatureHeader, expectedHmac)) {
      return false;
    }
  }

  return true;
}

async function incrementTreinadoraCreditos(
  adminClient: ReturnType<typeof createClient>,
  treinadoraId: string,
  creditosAdicionar: number,
): Promise<number> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: currentRow, error: selectError } = await adminClient
      .from("treinadoras")
      .select("creditos")
      .eq("id", treinadoraId)
      .single();

    if (selectError || !currentRow) {
      throw new Error("Não foi possível obter os créditos atuais da treinadora.");
    }

    const currentCreditos = Number(currentRow.creditos) || 0;
    const nextCreditos = currentCreditos + creditosAdicionar;

    const { data: updatedRow, error: updateError } = await adminClient
      .from("treinadoras")
      .update({ creditos: nextCreditos })
      .eq("id", treinadoraId)
      .eq("creditos", currentCreditos)
      .select("creditos")
      .maybeSingle();

    if (!updateError && updatedRow) {
      return Number(updatedRow.creditos) || nextCreditos;
    }

    if (attempt === 3) {
      throw new Error("Falha de concorrência ao atualizar créditos da treinadora.");
    }
  }

  throw new Error("Erro inesperado ao atualizar créditos.");
}

async function ensureTreinadoraByEmail(
  adminClient: ReturnType<typeof createClient>,
  email: string,
  nome?: string | null,
): Promise<{
  treinadoraId: string;
  contaCriadaAgora: boolean;
  senhaTemporaria?: string;
}> {
  const normalizedEmail = normalizeEmail(email);

  const { data: existingTreinadora, error: existingTreinadoraError } = await adminClient
    .from("treinadoras")
    .select("id")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (existingTreinadoraError) {
    throw new Error("Não foi possível consultar treinadora pelo email da compra.");
  }

  if (existingTreinadora?.id) {
    return {
      treinadoraId: existingTreinadora.id,
      contaCriadaAgora: false,
    };
  }

  const senhaTemporaria = generateTemporaryPassword(12);
  const nomeTreinadora = nome?.trim() || "Treinadora Decifra";

  let authUserId: string | null = null;
  let createdAuthNow = false;

  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email: normalizedEmail,
    password: senhaTemporaria,
    email_confirm: true,
    user_metadata: {
      nome: nomeTreinadora,
    },
  });

  if (authError) {
    const authMessage = String(authError.message || "").toLowerCase();
    const isAlreadyRegistered = authMessage.includes("already") && authMessage.includes("registered");

    if (!isAlreadyRegistered) {
      throw new Error(`Erro ao criar usuário de acesso: ${authError.message}`);
    }

    const { data: usersData, error: listUsersError } = await adminClient.auth.admin.listUsers();
    if (listUsersError) {
      throw new Error("Erro ao buscar usuário existente para email da compra.");
    }

    const existingUser = usersData.users.find((u: { id: string; email?: string | null }) => (
      normalizeEmail(u.email || "") === normalizedEmail
    ));
    if (!existingUser?.id) {
      throw new Error("Usuário existente não encontrado após conflito de email.");
    }

    authUserId = existingUser.id;
  } else {
    authUserId = authData.user?.id || null;
    createdAuthNow = !!authUserId;
  }

  if (!authUserId) {
    throw new Error("Não foi possível resolver auth_user_id para a nova treinadora.");
  }

  const { data: insertedTreinadora, error: insertTreinadoraError } = await adminClient
    .from("treinadoras")
    .insert({
      email: normalizedEmail,
      nome: nomeTreinadora,
      auth_user_id: authUserId,
    })
    .select("id")
    .maybeSingle();

  if (insertTreinadoraError) {
    const insertMessage = String(insertTreinadoraError.message || "").toLowerCase();
    const duplicateInsert = insertMessage.includes("duplicate") || insertMessage.includes("unique");

    if (!duplicateInsert) {
      if (createdAuthNow) {
        await adminClient.auth.admin.deleteUser(authUserId);
      }
      throw new Error(`Erro ao criar registro da treinadora: ${insertTreinadoraError.message}`);
    }

    const { data: existingAfterDuplicate, error: duplicateQueryError } = await adminClient
      .from("treinadoras")
      .select("id")
      .ilike("email", normalizedEmail)
      .maybeSingle();

    if (duplicateQueryError || !existingAfterDuplicate?.id) {
      throw new Error("Erro ao recuperar treinadora após conflito de criação.");
    }

    return {
      treinadoraId: existingAfterDuplicate.id,
      contaCriadaAgora: false,
    };
  }

  if (!insertedTreinadora?.id) {
    throw new Error("Registro da treinadora não retornou ID após criação.");
  }

  return {
    treinadoraId: insertedTreinadora.id,
    contaCriadaAgora: createdAuthNow,
    senhaTemporaria: createdAuthNow ? senhaTemporaria : undefined,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders, status: 204 });
  }

  if (req.method !== "POST") {
    return jsonResponse(405, { error: "Método não permitido." });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return jsonResponse(500, { error: "Configuração do servidor incompleta." });
    }

    const rawBody = await req.text();
    const contentType = req.headers.get("content-type");
    const payload = parseToObject(rawBody, contentType);

    const isSecure = await validateWebhookSecurity(req, payload, rawBody);
    if (!isSecure) {
      return jsonResponse(401, { error: "Webhook não autorizado." });
    }

    const eventRaw = getFirstString(payload, [
      "event",
      "status",
      "transaction_status",
      "data.purchase.status",
    ]);

    if (!eventRaw) {
      return jsonResponse(400, { error: "Evento do webhook não informado." });
    }

    const hotmartTransactionId = getFirstString(payload, [
      "transaction",
      "transaction_id",
      "purchase_id",
      "n",
      "hotmart_transaction_id",
      "data.purchase.transaction",
      "data.purchase.id",
    ]);

    if (!hotmartTransactionId) {
      return jsonResponse(400, { error: "ID da transação Hotmart não informado." });
    }

    const hotmartProductId = getFirstNumber(payload, [
      "prod",
      "product_id",
      "hotmart_product_id",
      "data.product.id",
      "data.purchase.product.id",
    ]);

    if (!hotmartProductId) {
      return jsonResponse(400, { error: "ID do produto Hotmart não informado." });
    }

    const compradorEmailRaw = getFirstString(payload, [
      "email",
      "buyer_email",
      "subscriber_email",
      "data.buyer.email",
      "data.purchase.buyer.email",
      "checkout.email",
    ]);

    if (!compradorEmailRaw) {
      return jsonResponse(400, {
        error: "Email da compradora não informado. O vínculo por email é obrigatório neste fluxo.",
      });
    }

    const compradorEmail = normalizeEmail(compradorEmailRaw);
    const compradorNome = getFirstString(payload, [
      "name",
      "buyer_name",
      "subscriber_name",
      "data.buyer.name",
      "data.purchase.buyer.name",
    ]);

    const valorTotal = getFirstNumber(payload, [
      "price",
      "value",
      "purchase_price",
      "data.purchase.price.value",
      "data.purchase.price",
    ]);

    const event = normalizeEvent(eventRaw);
    const statusCompra = mapEventToCompraStatus(event);

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    let { data: compraExistente, error: compraExistenteError } = await adminClient
      .from("compras")
      .select("id, treinadora_id, status, quantidade_codigos")
      .eq("hotmart_transaction_id", hotmartTransactionId)
      .maybeSingle();

    if (compraExistenteError) {
      return jsonResponse(500, { error: "Erro ao consultar compra existente." });
    }

    let treinadoraId = compraExistente?.treinadora_id as string | undefined;
    let contaCriadaAgora = false;
    let senhaTemporaria: string | undefined;

    if (!treinadoraId) {
      const ensureTreinadora = await ensureTreinadoraByEmail(adminClient, compradorEmail, compradorNome);
      treinadoraId = ensureTreinadora.treinadoraId;
      contaCriadaAgora = ensureTreinadora.contaCriadaAgora;
      senhaTemporaria = ensureTreinadora.senhaTemporaria;
    }

    let quantidadeCreditos = compraExistente?.quantidade_codigos as number | undefined;
    let hotmartProductName = getFirstString(payload, [
      "product_name",
      "name_subscription_plan",
      "data.product.name",
      "data.purchase.product.name",
    ]);

    if (!quantidadeCreditos) {
      const { data: produtoHotmart } = await adminClient
        .from("produtos_hotmart")
        .select("quantidade_codigos, nome")
        .eq("hotmart_product_id", hotmartProductId)
        .eq("ativo", true)
        .maybeSingle();

      if (produtoHotmart) {
        quantidadeCreditos = Number(produtoHotmart.quantidade_codigos);
        hotmartProductName = hotmartProductName || produtoHotmart.nome;
      } else {
        const configuredCredits = getConfiguredProductCredits(hotmartProductId);
        if (configuredCredits) {
          quantidadeCreditos = configuredCredits;
        }
      }
    }

    if (!quantidadeCreditos || quantidadeCreditos <= 0) {
      return jsonResponse(400, {
        error: "Produto Hotmart sem mapeamento de créditos. Configure produtos_hotmart ou HOTMART_PRODUCT_CREDITS_JSON.",
        hotmartProductId,
      });
    }

    if (!compraExistente) {
      const statusInicial = statusCompra === "concluida" ? "pendente" : statusCompra;

      const { data: insertedCompra, error: insertCompraError } = await adminClient
        .from("compras")
        .insert({
          treinadora_id: treinadoraId,
          hotmart_transaction_id: hotmartTransactionId,
          hotmart_product_id: hotmartProductId,
          hotmart_product_name: hotmartProductName,
          quantidade_codigos: quantidadeCreditos,
          valor_total: valorTotal,
          status: statusInicial,
          comprador_email: compradorEmail,
          comprador_nome: compradorNome,
        })
        .select("id, treinadora_id, status, quantidade_codigos")
        .single();

      if (insertCompraError) {
        const maybeDuplicate = String(insertCompraError.message || "").toLowerCase().includes("duplicate");
        if (!maybeDuplicate) {
          return jsonResponse(500, {
            error: "Erro ao registrar compra Hotmart.",
            details: insertCompraError.message,
          });
        }

        const { data: existingAfterConflict, error: conflictQueryError } = await adminClient
          .from("compras")
          .select("id, treinadora_id, status, quantidade_codigos")
          .eq("hotmart_transaction_id", hotmartTransactionId)
          .maybeSingle();

        if (conflictQueryError || !existingAfterConflict) {
          return jsonResponse(500, { error: "Erro de concorrência ao consultar compra após conflito." });
        }

        compraExistente = existingAfterConflict;
      } else {
        compraExistente = insertedCompra;
      }
    }

    if (!compraExistente) {
      return jsonResponse(500, { error: "Compra não encontrada após processamento." });
    }

    if (!treinadoraId) {
      return jsonResponse(500, { error: "Treinadora não resolvida para a compra." });
    }

    if (statusCompra !== "concluida") {
      if (compraExistente.status !== "concluida") {
        await adminClient
          .from("compras")
          .update({
            status: statusCompra,
            hotmart_product_name: hotmartProductName,
            valor_total: valorTotal,
            comprador_email: compradorEmail,
            comprador_nome: compradorNome,
          })
          .eq("id", compraExistente.id);
      }

      return jsonResponse(200, {
        ok: true,
        message: "Evento recebido sem crédito (status não concluído).",
        event,
        statusCompra,
        hotmartTransactionId,
      });
    }

    if (compraExistente.status === "concluida") {
      return jsonResponse(200, {
        ok: true,
        message: "Evento já processado anteriormente (idempotência).",
        hotmartTransactionId,
      });
    }

    const { data: gateCompra, error: gateError } = await adminClient
      .from("compras")
      .update({
        status: "concluida",
        hotmart_product_name: hotmartProductName,
        valor_total: valorTotal,
        comprador_email: compradorEmail,
        comprador_nome: compradorNome,
      })
      .eq("id", compraExistente.id)
      .neq("status", "concluida")
      .select("id")
      .maybeSingle();

    if (gateError) {
      return jsonResponse(500, {
        error: "Erro ao confirmar compra para aplicação de créditos.",
        details: gateError.message,
      });
    }

    if (!gateCompra) {
      return jsonResponse(200, {
        ok: true,
        message: "Transação já confirmada em outra execução (idempotência).",
        hotmartTransactionId,
      });
    }

    try {
      const creditosAtuais = await incrementTreinadoraCreditos(
        adminClient,
        treinadoraId,
        quantidadeCreditos,
      );

      const emailResult = await sendCreditosDisponiveisEmail({
        toEmail: compradorEmail,
        toName: compradorNome,
        senhaTemporaria: contaCriadaAgora ? senhaTemporaria : undefined,
        loginUrl: Deno.env.get("DECIFRA_LOGIN_URL") || Deno.env.get("APP_LOGIN_URL") || "https://decifra.app",
        creditosAdicionados: quantidadeCreditos,
        creditosTotais: creditosAtuais,
        produto: hotmartProductName,
        valorTotal,
      });

      if (emailResult.sent) {
        await adminClient
          .from("compras")
          .update({
            email_enviado: true,
            email_enviado_em: new Date().toISOString(),
          })
          .eq("id", compraExistente.id);
      }

      return jsonResponse(200, {
        ok: true,
        message: "Créditos adicionados com sucesso.",
        hotmartTransactionId,
        treinadoraId,
        creditosAdicionados: quantidadeCreditos,
        creditosTotais: creditosAtuais,
        contaCriadaAgora,
        emailEnviado: emailResult.sent,
        emailErro: emailResult.sent ? null : (emailResult.error || "Falha ao enviar email."),
      });
    } catch (creditError) {
      await adminClient
        .from("compras")
        .update({ status: "pendente" })
        .eq("id", compraExistente.id)
        .eq("status", "concluida");

      const message = creditError instanceof Error ? creditError.message : "Erro ao atualizar créditos.";
      return jsonResponse(500, {
        error: message,
        hotmartTransactionId,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro interno do servidor.";
    return jsonResponse(500, { error: message });
  }
});
