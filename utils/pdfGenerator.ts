/**
 * Gerador de PDF para Resultados DECIFRA
 * Usa expo-print e expo-sharing para gerar e compartilhar PDFs
 * 
 * Identidade Visual Ártio:
 * - Cores: Terracota (#C4785A) → Vinho (#6B2D3A)
 * - Background: Gradient escuro (#2D1518 → #3D1A1E)
 * - Logo: Ícone DECIFRA no header
 */

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { FATORES } from '@/constants/ipip';
import type { FatorKey } from '@/constants/ipip';

interface FatorScore {
  fator: FatorKey;
  score: number;
  percentil: number;
  classificacao: string;
}

interface FacetaScore {
  faceta: string;
  score: number;
  percentil: number;
  classificacao: string;
}

interface Protocolo {
  id: string;
  titulo: string;
  descricao: string;
  prioridade?: number;
}

interface PDFData {
  cliente: { 
    nome: string; 
    email?: string;
    id?: string;
  };
  resultado: {
    id?: string;
    scores_fatores: FatorScore[];
    scores_facetas?: FacetaScore[];
  };
  protocolos: Protocolo[];
  codigo?: string;
  dataTeste: string;
  tipo: 'cliente' | 'treinadora';
}

// Cores da identidade Ártio
const COLORS = {
  vinhoDeep: '#2D1518',
  vinhoDark: '#3D1A1E',
  vinho: '#6B2D3A',
  terracota: '#C4785A',
  terracotaLight: '#D4896A',
  cream: '#F5F0E8',
  creamLight: '#FAF8F5',
  creamDark: '#E8E0D1',
  textDark: '#2D2420',
};

/**
 * Sanitiza o nome do arquivo removendo caracteres inválidos
 */
function sanitizarNomeArquivo(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
}

/**
 * Gera e compartilha um PDF com os resultados do teste
 */
export async function gerarPDF(dados: PDFData): Promise<void> {
  console.log('[PDF] Iniciando geração do PDF para:', dados.cliente.nome);
  console.log('[PDF] Plataforma:', Platform.OS);
  
  try {
    if (!dados.cliente?.nome) {
      throw new Error('Nome do cliente é obrigatório');
    }
    if (!dados.resultado?.scores_fatores || dados.resultado.scores_fatores.length === 0) {
      throw new Error('Scores dos fatores são obrigatórios');
    }
    
    const html = gerarTemplateHTML(dados);
    console.log('[PDF] HTML gerado, tamanho:', html.length, 'caracteres');
    
    if (Platform.OS === 'web') {
      await gerarPDFWeb(html, dados);
    } else {
      await gerarPDFMobile(html, dados);
    }
    
    console.log('[PDF] PDF gerado com sucesso!');
  } catch (error) {
    console.error('[PDF] Erro ao gerar PDF:', error);
    throw error;
  }
}

/**
 * Gera PDF na WEB
 */
async function gerarPDFWeb(html: string, dados: PDFData): Promise<void> {
  console.log('[PDF] Modo WEB detectado');
  
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('Não foi possível abrir a janela de impressão. Verifique se o pop-up está bloqueado.');
  }
  
  printWindow.document.write(html);
  printWindow.document.close();
  
  setTimeout(() => {
    printWindow.focus();
    printWindow.print();
  }, 500);
  
  console.log('[PDF] Janela de impressão aberta');
}

/**
 * Gera PDF no Mobile
 */
async function gerarPDFMobile(html: string, dados: PDFData): Promise<void> {
  console.log('[PDF] Modo Mobile detectado');
  
  const result = await Print.printToFileAsync({
    html,
    base64: false,
  });
  
  if (!result || !result.uri) {
    throw new Error('Falha ao gerar PDF: resultado inválido');
  }
  
  console.log('[PDF] Arquivo temporário criado:', result.uri);
  
  const tempUri = result.uri;
  const nomeSanitizado = sanitizarNomeArquivo(dados.cliente.nome);
  const tipoRelatorio = dados.tipo === 'treinadora' ? 'Completo' : 'Resumido';
  const nomeArquivo = `DECIFRA_${tipoRelatorio}_${nomeSanitizado}.pdf`;
  
  const diretorioCache = FileSystem.cacheDirectory || FileSystem.documentDirectory;
  if (!diretorioCache) {
    throw new Error('Diretório de cache não disponível');
  }
  
  const uriFinal = `${diretorioCache}${nomeArquivo}`;
  
  await FileSystem.copyAsync({
    from: tempUri,
    to: uriFinal,
  });
  
  try {
    await FileSystem.deleteAsync(tempUri, { idempotent: true });
  } catch (e) {}

  const isAvailable = await Sharing.isAvailableAsync();
  
  if (!isAvailable) {
    throw new Error('Compartilhamento não disponível neste dispositivo');
  }

  console.log('[PDF] Compartilhando arquivo:', nomeArquivo);
  await Sharing.shareAsync(uriFinal, {
    UTI: '.pdf',
    mimeType: 'application/pdf',
    dialogTitle: 'Compartilhar Resultado DECIFRA',
  });
}

/**
 * Gera o template HTML para o PDF com identidade visual Ártio
 */
function gerarTemplateHTML(dados: PDFData): string {
  const { cliente, resultado, protocolos, codigo, dataTeste, tipo } = dados;
  const isTreinadora = tipo === 'treinadora';
  
  const ordemFatores: FatorKey[] = ['N', 'E', 'O', 'A', 'C'];
  const scoresOrdenados = ordemFatores.map(fator => 
    resultado.scores_fatores.find(s => s.fator === fator)
  ).filter((s): s is FatorScore => s !== undefined);

  // Logo SVG inline (símbolo estilizado DECIFRA)
  const logoSVG = `
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin: 0 auto 12px; display: block;">
      <defs>
        <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:${COLORS.terracota};stop-opacity:1" />
          <stop offset="100%" style="stop-color:${COLORS.vinho};stop-opacity:1" />
        </linearGradient>
      </defs>
      <circle cx="24" cy="24" r="22" fill="url(#logoGradient)" stroke="${COLORS.cream}" stroke-width="2"/>
      <text x="24" y="30" text-anchor="middle" fill="${COLORS.cream}" font-size="20" font-weight="bold" font-family="serif">D</text>
    </svg>
  `;

  // Facetas HTML
  let facetasHTML = '';
  if (isTreinadora && resultado.scores_facetas && resultado.scores_facetas.length > 0) {
    const facetasPorColuna = Math.ceil(resultado.scores_facetas.length / 2);
    const coluna1 = resultado.scores_facetas.slice(0, facetasPorColuna);
    const coluna2 = resultado.scores_facetas.slice(facetasPorColuna);
    
    facetasHTML = `
      <div style="margin-top: 32px; page-break-inside: avoid;">
        <div style="font-size: 20px; font-weight: 700; color: ${COLORS.cream}; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid ${COLORS.terracota}; display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 24px;">🔬</span>
          30 Facetas Detalhadas
        </div>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="width: 50%; vertical-align: top; padding-right: 8px;">
              ${coluna1.map(f => `
                <div style="background: ${COLORS.vinhoDark}; padding: 12px; border-radius: 10px; margin-bottom: 8px; border: 1px solid ${COLORS.terracota}40;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 700; color: ${COLORS.cream}; font-size: 13px;">${f.faceta}</span>
                    <span style="text-align: right;">
                      <span style="font-weight: 700; color: ${COLORS.terracota}; font-size: 14px;">${f.percentil}%</span>
                      <span style="font-size: 11px; color: ${COLORS.creamDark}; display: block; margin-top: 2px;">${f.classificacao}</span>
                    </span>
                  </div>
                </div>
              `).join('')}
            </td>
            <td style="width: 50%; vertical-align: top; padding-left: 8px;">
              ${coluna2.map(f => `
                <div style="background: ${COLORS.vinhoDark}; padding: 12px; border-radius: 10px; margin-bottom: 8px; border: 1px solid ${COLORS.terracota}40;">
                  <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 700; color: ${COLORS.cream}; font-size: 13px;">${f.faceta}</span>
                    <span style="text-align: right;">
                      <span style="font-weight: 700; color: ${COLORS.terracota}; font-size: 14px;">${f.percentil}%</span>
                      <span style="font-size: 11px; color: ${COLORS.creamDark}; display: block; margin-top: 2px;">${f.classificacao}</span>
                    </span>
                  </div>
                </div>
              `).join('')}
            </td>
          </tr>
        </table>
      </div>
    `;
  }

  // Protocolos HTML
  const protocolosHTML = protocolos.length > 0 
    ? protocolos.map((p, i) => `
      <div style="background: ${COLORS.vinhoDark}; border-radius: 12px; padding: 18px; margin-bottom: 14px; border: 1px solid ${COLORS.terracota}40; page-break-inside: avoid;">
        <div style="display: flex; align-items: flex-start; gap: 14px;">
          <div style="display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; background: ${i < 3 ? COLORS.terracota : COLORS.vinho}; color: ${COLORS.cream}; border-radius: 50%; font-weight: 700; font-size: 14px; flex-shrink: 0; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${i + 1}</div>
          <div style="flex: 1;">
            <div style="font-weight: 700; color: ${COLORS.cream}; font-size: 15px; margin-bottom: 6px; line-height: 1.3;">${p.titulo}</div>
            <div style="font-size: 13px; color: ${COLORS.creamDark}; line-height: 1.6;">${p.descricao}</div>
          </div>
        </div>
      </div>
    `).join('')
    : `
      <div style="background: ${COLORS.vinhoDark}; border-radius: 12px; padding: 24px; border: 1px solid ${COLORS.terracota}40; text-align: center;">
        <div style="color: ${COLORS.creamDark}; font-size: 14px; font-style: italic;">
          Nenhum protocolo recomendado para este perfil.
        </div>
      </div>
    `;

  // Fatores HTML
  const fatoresHTML = scoresOrdenados.map(f => `
    <div style="background: ${COLORS.vinhoDark}; border-radius: 14px; padding: 20px; margin-bottom: 14px; border-left: 4px solid ${COLORS.terracota}; box-shadow: 0 4px 12px rgba(0,0,0,0.2); page-break-inside: avoid;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
        <span style="font-weight: 700; font-size: 17px; color: ${COLORS.cream};">${FATORES[f.fator]}</span>
        <span style="background: linear-gradient(135deg, ${COLORS.terracota} 0%, ${COLORS.vinho} 100%); color: ${COLORS.cream}; padding: 6px 14px; border-radius: 20px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; box-shadow: 0 2px 8px rgba(0,0,0,0.3);">${f.classificacao}</span>
      </div>
      <div style="margin-top: 10px;">
        <div style="height: 12px; background: ${COLORS.vinhoDeep}; border-radius: 6px; overflow: hidden; box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);">
          <div style="height: 100%; background: linear-gradient(90deg, ${COLORS.terracota} 0%, ${COLORS.terracotaLight} 50%, ${COLORS.terracota} 100%); border-radius: 6px; width: ${f.percentil}%; box-shadow: 0 0 10px ${COLORS.terracota}60;"></div>
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
          <span style="font-size: 12px; color: ${COLORS.creamDark};">Percentil</span>
          <span style="font-size: 16px; color: ${COLORS.terracota}; font-weight: 700;">${f.percentil}%</span>
        </div>
        ${isTreinadora ? `<div style="font-size: 11px; color: ${COLORS.creamDark}; margin-top: 4px; text-align: right; font-style: italic;">Score bruto: ${f.score.toFixed(2)}</div>` : ''}
      </div>
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Resultado DECIFRA - ${cliente.nome}</title>
  <style>
    @media print {
      body {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
    @page {
      margin: 20px;
    }
  </style>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background: linear-gradient(180deg, ${COLORS.vinhoDeep} 0%, ${COLORS.vinhoDark} 100%); color: ${COLORS.cream}; line-height: 1.6; padding: 32px 24px; margin: 0; min-height: 100vh;">
  
  <!-- Header com Logo -->
  <div style="text-align: center; padding-bottom: 24px; margin-bottom: 28px;">
    ${logoSVG}
    <div style="font-size: 32px; font-weight: 800; color: ${COLORS.cream}; margin-bottom: 6px; letter-spacing: 3px; text-transform: uppercase;">DECIFRA</div>
    <div style="font-size: 14px; color: ${COLORS.terracota}; font-weight: 600; letter-spacing: 1px;">Avaliação de Personalidade Big Five</div>
    <div style="display: inline-block; background: linear-gradient(135deg, ${COLORS.terracota} 0%, ${COLORS.vinho} 100%); color: ${COLORS.cream}; padding: 8px 20px; border-radius: 24px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 1px; margin-top: 16px; box-shadow: 0 4px 12px rgba(0,0,0,0.3);">
      ${isTreinadora ? 'Relatório Completo' : 'Relatório do Cliente'}
    </div>
  </div>
  
  <!-- Info Section -->
  <div style="background: ${COLORS.vinhoDark}; border-radius: 16px; padding: 24px; margin-bottom: 32px; border: 1px solid ${COLORS.terracota}40; box-shadow: 0 8px 24px rgba(0,0,0,0.2);">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid ${COLORS.terracota}30;">
      <span style="font-weight: 700; color: ${COLORS.terracota}; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Cliente</span>
      <span style="font-weight: 600; color: ${COLORS.cream}; font-size: 16px;">${cliente.nome}</span>
    </div>
    ${cliente.email ? `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid ${COLORS.terracota}30;">
      <span style="font-weight: 700; color: ${COLORS.terracota}; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Email</span>
      <span style="font-weight: 500; color: ${COLORS.creamDark}; font-size: 14px;">${cliente.email}</span>
    </div>
    ` : ''}
    ${codigo ? `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid ${COLORS.terracota}30;">
      <span style="font-weight: 700; color: ${COLORS.terracota}; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Código do Teste</span>
      <span style="font-weight: 600; color: ${COLORS.cream}; font-size: 14px; font-family: 'Courier New', monospace; letter-spacing: 2px;">${codigo}</span>
    </div>
    ` : ''}
    <div style="display: flex; justify-content: space-between; align-items: center;">
      <span style="font-weight: 700; color: ${COLORS.terracota}; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">Data do Teste</span>
      <span style="font-weight: 500; color: ${COLORS.creamDark}; font-size: 14px;">${dataTeste}</span>
    </div>
  </div>
  
  <!-- Fatores -->
  <div style="margin-bottom: 32px;">
    <div style="font-size: 20px; font-weight: 700; color: ${COLORS.cream}; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid ${COLORS.terracota}; display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 24px;">🧬</span>
      5 Fatores Principais
    </div>
    ${fatoresHTML}
  </div>
  
  <!-- Facetas (apenas treinadora) -->
  ${facetasHTML}
  
  <!-- Protocolos -->
  <div style="margin-bottom: 32px; margin-top: 32px;">
    <div style="font-size: 20px; font-weight: 700; color: ${COLORS.cream}; margin-bottom: 20px; padding-bottom: 12px; border-bottom: 2px solid ${COLORS.terracota}; display: flex; align-items: center; gap: 10px;">
      <span style="font-size: 24px;">📋</span>
      Protocolos Recomendados
    </div>
    ${protocolosHTML}
  </div>
  
  <!-- Footer -->
  <div style="margin-top: 48px; padding-top: 24px; border-top: 2px solid ${COLORS.terracota}40; text-align: center;">
    <div style="font-size: 16px; font-weight: 700; color: ${COLORS.cream}; margin-bottom: 6px; letter-spacing: 2px;">🌸 ÁRTIO · DECIFRA</div>
    <div style="font-size: 12px; color: ${COLORS.creamDark}; margin-bottom: 4px; font-style: italic;">Relatório gerado em ${new Date().toLocaleString('pt-BR')}</div>
    <div style="font-size: 11px; color: ${COLORS.creamDark}99;">© 2025 Todos os direitos reservados</div>
    
    ${!isTreinadora ? `
    <div style="margin-top: 16px; padding: 16px; background: ${COLORS.vinho}; border-radius: 12px; border: 1px solid ${COLORS.terracota}40;">
      <div style="font-size: 12px; color: ${COLORS.creamDark}; font-style: italic; line-height: 1.5;">
        ✨ Este é um relatório resumido. Sua treinadora tem acesso a uma análise 
        completa com todas as 30 facetas e protocolos detalhados.
      </div>
    </div>
    ` : ''}
  </div>
  
</body>
</html>`;
}

export type { PDFData, FatorScore, FacetaScore, Protocolo };
