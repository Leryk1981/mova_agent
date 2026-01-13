#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Скрипт для аудита использования токенов в проекте MOVA Agent
 * Собирает статистику из различных источников и создает отчеты
 */

function parseArgs() {
  const args = process.argv.slice(2);
  const parsed = {};
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--root' && args[i + 1]) {
      parsed.root = args[i + 1];
      i++;
    }
  }
  
  parsed.root = parsed.root || path.resolve(__dirname, '..');
  return parsed;
}

function findTokenFiles(rootDir) {
  const patterns = [
    '**/*{report,usage,telemetry,trace,run}*.json',
    '**/*{report,usage,telemetry,trace,run}*.jsonl',
    '.claude/**/*',
    '.opencode/**/*',
    '.cursor/**/*'
  ];
  
  const results = [];
  
  // Рекурсивный поиск файлов
  function searchDir(dir) {
    try {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          searchDir(fullPath);
        } else if (stat.isFile()) {
          // Проверяем, соответствует ли файл интересующим нас паттернам
          const relativePath = path.relative(rootDir, fullPath);
          
          if (relativePath.includes('report') || 
              relativePath.includes('usage') || 
              relativePath.includes('telemetry') || 
              relativePath.includes('trace') || 
              relativePath.includes('run') ||
              relativePath.startsWith('.claude') ||
              relativePath.startsWith('.opencode') ||
              relativePath.startsWith('.cursor')) {
            results.push(fullPath);
          }
        }
      }
    } catch (error) {
      // Игнорируем ошибки доступа к директориям
    }
  }
  
  searchDir(rootDir);
  return results;
}

function extractTokenData(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Проверяем, является ли файл JSON или JSONL
    if (filePath.endsWith('.json')) {
      try {
        const data = JSON.parse(content);
        return analyzeTokenData(data, filePath);
      } catch (e) {
        // Если не JSON, пропускаем
        return null;
      }
    } else if (filePath.endsWith('.jsonl')) {
      const lines = content.split('\n').filter(line => line.trim());
      const allData = [];
      
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          allData.push(obj);
        } catch (e) {
          // Пропускаем некорректные строки
        }
      }
      
      return analyzeTokenData(allData, filePath);
    }
  } catch (error) {
    console.error(`Error reading file ${filePath}:`, error.message);
    return null;
  }
  
  return null;
}

function analyzeTokenData(data, filePath) {
  const result = {
    filePath,
    hasTokenData: false,
    tokenStats: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost: 0
    },
    agentStats: {},
    toolCallStats: {},
    rawData: data
  };
  
  // Рекурсивный поиск токен-данных в объекте
  function findTokenFields(obj, path = '') {
    if (typeof obj !== 'object' || obj === null) return;
    
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (key === 'input_tokens' || key === 'output_tokens' || key === 'total_tokens' || key === 'cost') {
        result.hasTokenData = true;
        if (typeof value === 'number') {
          result.tokenStats[key] = (result.tokenStats[key] || 0) + value;
        }
      }
      
      if (key === 'agent' || key === 'executor_id' || key === 'planner' || key === 'reviewer') {
        if (typeof value === 'string') {
          result.agentStats[value] = (result.agentStats[value] || 0) + 1;
        }
      }
      
      if (key === 'tool_calls' || key === 'tool_call' || key === 'tool') {
        if (Array.isArray(value)) {
          result.toolCallStats.count = (result.toolCallStats.count || 0) + value.length;
        } else if (typeof value === 'object') {
          result.toolCallStats.count = (result.toolCallStats.count || 0) + 1;
        } else {
          result.toolCallStats.count = (result.toolCallStats.count || 0) + 1;
        }
      }
      
      if (typeof value === 'object' && value !== null) {
        findTokenFields(value, currentPath);
      }
    }
  }
  
  if (Array.isArray(data)) {
    for (const item of data) {
      findTokenFields(item);
    }
  } else {
    findTokenFields(data);
  }
  
  // Обновляем total_tokens если есть input и output
  if (result.tokenStats.input_tokens > 0 || result.tokenStats.output_tokens > 0) {
    result.tokenStats.total_tokens = result.tokenStats.input_tokens + result.tokenStats.output_tokens;
    result.hasTokenData = true;
  }
  
  return result;
}

function generateRunId() {
  const now = new Date();
  const timestamp = now.getTime();
  const random = Math.floor(Math.random() * 10000);
  return `run_${timestamp}_${random.toString(36)}`;
}

function createTokenAuditReport(analysisResults, rootDir) {
  const runId = generateRunId();
  const outputDir = path.join(rootDir, 'artifacts', 'token_audit', runId);
  
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Сводная статистика
  const summary = {
    run_id: runId,
    timestamp: new Date().toISOString(),
    total_files_analyzed: analysisResults.length,
    files_with_token_data: analysisResults.filter(r => r && r.hasTokenData).length,
    token_stats: {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
      cost: 0
    },
    agent_stats: {},
    tool_call_stats: {},
    sources: []
  };
  
  for (const result of analysisResults) {
    if (!result) continue;
    
    // Суммируем токены
    summary.token_stats.input_tokens += result.tokenStats.input_tokens;
    summary.token_stats.output_tokens += result.tokenStats.output_tokens;
    summary.token_stats.total_tokens += result.tokenStats.total_tokens;
    summary.token_stats.cost += result.tokenStats.cost;
    
    // Суммируем статистику по агентам
    for (const [agent, count] of Object.entries(result.agentStats)) {
      summary.agent_stats[agent] = (summary.agent_stats[agent] || 0) + count;
    }
    
    // Суммируем статистику по вызовам инструментов
    for (const [key, value] of Object.entries(result.toolCallStats)) {
      summary.tool_call_stats[key] = (summary.tool_call_stats[key] || 0) + value;
    }
    
    // Добавляем источник
    summary.sources.push({
      file_path: result.filePath,
      has_token_data: result.hasTokenData,
      token_stats: result.tokenStats,
      agent_stats: result.agentStats,
      tool_call_stats: result.toolCallStats
    });
  }
  
  // Сохраняем JSON отчет
  const jsonReportPath = path.join(outputDir, 'token_audit.json');
  fs.writeFileSync(jsonReportPath, JSON.stringify(summary, null, 2));
  
  // Создаем Markdown отчет
  const markdownReportPath = path.join(outputDir, 'token_audit.md');
  const markdownContent = generateMarkdownReport(summary);
  fs.writeFileSync(markdownReportPath, markdownContent);
  
  console.log(`Token audit report generated in: ${outputDir}`);
  console.log(`JSON report: ${jsonReportPath}`);
  console.log(`Markdown report: ${markdownReportPath}`);
  
  return { runId, outputDir, summary };
}

function generateMarkdownReport(summary) {
  let md = `# Token Audit Report\n\n`;
  md += `**Run ID:** ${summary.run_id}\n`;
  md += `**Timestamp:** ${summary.timestamp}\n\n`;
  
  md += `## Summary\n\n`;
  md += `- Total files analyzed: ${summary.total_files_analyzed}\n`;
  md += `- Files with token data: ${summary.files_with_token_data}\n\n`;
  
  md += `## Token Usage\n\n`;
  md += `| Metric | Count |\n`;
  md += `|--------|-------|\n`;
  md += `| Input Tokens | ${summary.token_stats.input_tokens.toLocaleString()} |\n`;
  md += `| Output Tokens | ${summary.token_stats.output_tokens.toLocaleString()} |\n`;
  md += `| Total Tokens | ${summary.token_stats.total_tokens.toLocaleString()} |\n`;
  md += `| Estimated Cost (USD) | $${summary.token_stats.cost.toFixed(4)} |\n\n`;
  
  if (Object.keys(summary.agent_stats).length > 0) {
    md += `## Agent Usage\n\n`;
    md += `| Agent | Count |\n`;
    md += `|-------|-------|\n`;
    for (const [agent, count] of Object.entries(summary.agent_stats)) {
      md += `| ${agent} | ${count} |\n`;
    }
    md += `\n`;
  }
  
  if (Object.keys(summary.tool_call_stats).length > 0) {
    md += `## Tool Call Statistics\n\n`;
    md += `| Metric | Count |\n`;
    md += `|--------|-------|\n`;
    for (const [key, value] of Object.entries(summary.tool_call_stats)) {
      md += `| ${key} | ${value} |\n`;
    }
    md += `\n`;
  }
  
  // Топ-3 причин перерасхода (пока гипотетические)
  md += `## Top 3 Cost Drivers\n\n`;
  md += `1. Repetitive cycles ("think/explain/recheck")\n`;
  md += `2. Large context windows\n`;
  md += `3. Verbose output mode\n\n`;
  
  md += `## Sources Analyzed\n\n`;
  for (const source of summary.sources) {
    md += `- ${source.file_path} (${source.has_token_data ? 'has token data' : 'no token data'})\n`;
  }
  
  return md;
}

function main() {
  const args = parseArgs();
  console.log(`Scanning directory: ${args.root}`);
  
  const tokenFiles = findTokenFiles(args.root);
  console.log(`Found ${tokenFiles.length} potential token files`);
  
  const analysisResults = [];
  for (const file of tokenFiles) {
    const result = extractTokenData(file);
    if (result) {
      analysisResults.push(result);
    }
  }
  
  console.log(`Analyzed ${analysisResults.length} files with token data`);
  
  if (analysisResults.length > 0) {
    createTokenAuditReport(analysisResults, args.root);
  } else {
    console.log('No token data found in the analyzed files.');
    
    // Создаем пустой отчет для документирования ситуации
    const runId = generateRunId();
    const outputDir = path.join(args.root, 'artifacts', 'token_audit', runId);
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const emptyReport = {
      run_id: runId,
      timestamp: new Date().toISOString(),
      total_files_analyzed: tokenFiles.length,
      files_with_token_data: 0,
      token_stats: {
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cost: 0
      },
      agent_stats: {},
      tool_call_stats: {},
      sources: [],
      message: 'No token usage data found in the current project. Token tracking needs to be implemented.'
    };
    
    const jsonReportPath = path.join(outputDir, 'token_audit.json');
    fs.writeFileSync(jsonReportPath, JSON.stringify(emptyReport, null, 2));
    
    const markdownReportPath = path.join(outputDir, 'token_audit.md');
    const markdownContent = generateMarkdownReport(emptyReport);
    fs.writeFileSync(markdownReportPath, markdownContent);
    
    console.log(`Empty token audit report generated in: ${outputDir}`);
  }
}

if (process.argv[1] === __filename) {
  main();
}

export { 
  findTokenFiles, 
  extractTokenData, 
  analyzeTokenData, 
  createTokenAuditReport,
  generateMarkdownReport
};