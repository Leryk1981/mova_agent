/**
 * Централизованный модуль логирования для MOVA Agent
 * Реализует дисциплину вывода с ограничениями на объем данных
 */

import fs from 'fs';
import path from 'path';

// Уровни логирования
export const LOG_LEVELS = {
  QUIET: 0,
  INFO: 1,
  DEBUG: 2,
} as const;

type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS];

// Жесткие ограничения на объем вывода
const MAX_STDOUT_BYTES = 1024; // 1KB

interface LogOptions {
  artifactName?: string;
  truncate?: boolean;
}

export class Logger {
  private level: LogLevel;
  private artifactDir: string;
  private loggedKeys: Set<string>;

  constructor(level: string = 'info', artifactDir: string = './artifacts') {
    this.level = this.parseLogLevel(level);
    this.artifactDir = artifactDir;
    this.loggedKeys = new Set();
  }

  private parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'quiet':
        return LOG_LEVELS.QUIET;
      case 'info':
        return LOG_LEVELS.INFO;
      case 'debug':
        return LOG_LEVELS.DEBUG;
      default:
        return LOG_LEVELS.INFO;
    }
  }

  /**
   * Проверяет, нужно ли логировать на данном уровне
   */
  shouldLog(level: LogLevel): boolean {
    return level <= this.level;
  }

  /**
   * Записывает данные в файл артефактов
   */
  writeArtifact(content: string, fileNamePrefix: string = 'log'): string {
    // Создаем уникальное имя файла
    const timestamp = Date.now();
    const fileName = `${fileNamePrefix}_${timestamp}.txt`;
    const filePath = path.join(this.artifactDir, fileName);

    // Создаем директорию, если не существует
    if (!fs.existsSync(this.artifactDir)) {
      fs.mkdirSync(this.artifactDir, { recursive: true });
    }

    // Записываем содержимое в файл
    fs.writeFileSync(filePath, content);

    return filePath;
  }

  /**
   * Ограничивает размер строки до заданного количества байт
   */
  private truncateString(str: string, maxBytes: number): string {
    if (!str || typeof str !== 'string') return str;

    // Преобразуем строку в байты и проверяем длину
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);

    if (bytes.length <= maxBytes) {
      return str;
    }

    // Обрезаем строку до максимально допустимого размера
    const truncatedBytes = bytes.slice(0, maxBytes - 3); // -3 для "..."
    const truncatedStr = new TextDecoder().decode(truncatedBytes);

    return truncatedStr + '...';
  }

  /**
   * Логирует сообщение с указанным уровнем
   */
  log(message: string, level: LogLevel = LOG_LEVELS.INFO, options: LogOptions = {}): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const { artifactName, truncate = true } = options;

    // Если нужно сохранить в артефакт
    if (artifactName) {
      const artifactPath = this.writeArtifact(message, artifactName);
      // Выводим только ссылку на артефакт
      const refMessage = `written_to=${artifactPath}`;
      this.writeToConsole(refMessage, level);
      return;
    }

    // Обработка длинных сообщений
    if (truncate && typeof message === 'string' && message.length > 0) {
      let truncatedMsg = message;

      if (level === LOG_LEVELS.DEBUG) {
        truncatedMsg = this.truncateString(message, MAX_STDOUT_BYTES * 2); // В 2 раза больше для дебага
      } else {
        truncatedMsg = this.truncateString(message, MAX_STDOUT_BYTES);
      }

      if (truncatedMsg !== message) {
        // Сообщаем, что сообщение было обрезано и сохранено в артефакт
        const artifactPath = this.writeArtifact(message, 'truncated_output');
        const warningMsg = `WARNING: Output truncated. Full content saved to: ${artifactPath}`;
        this.writeToConsole(warningMsg, LOG_LEVELS.INFO);
        message = truncatedMsg;
      }
    }

    this.writeToConsole(message, level);
  }

  /**
   * Выводит сообщение в консоль в зависимости от уровня
   */
  private writeToConsole(message: string, level: LogLevel): void {
    if (level === LOG_LEVELS.QUIET) {
      return; // Не выводим ничего при quiet уровне
    }

    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] ${message}`;

    if (level === LOG_LEVELS.DEBUG) {
      // eslint-disable-next-line no-console -- logger writes to stdout for debugging
      console.debug(formattedMessage);
    } else {
      // eslint-disable-next-line no-console -- logger writes to stdout for CLI visibility
      console.log(formattedMessage);
    }
  }

  /**
   * Краткий вывод информации (одна строка + ссылка на артефакт)
   */
  logInfoShort(
    message: string,
    fullContent: string | null = null,
    artifactName: string = 'info'
  ): void {
    if (fullContent) {
      const artifactPath = this.writeArtifact(fullContent, artifactName);
      this.log(`${message} | written_to=${artifactPath}`, LOG_LEVELS.INFO);
    } else {
      this.log(message, LOG_LEVELS.INFO);
    }
  }

  /**
   * Выводит краткую информацию один раз (предотвращает дублирование)
   */
  logInfoOnce(message: string, key?: string): void {
    const uniqueKey = key || message;
    if (this.loggedKeys.has(uniqueKey)) {
      return;
    }

    this.loggedKeys.add(uniqueKey);
    this.log(message, LOG_LEVELS.INFO);
  }

  /**
   * Выводит ссылку на артефакт
   */
  logRef(path: string, description: string = ''): void {
    const msg = description ? `${description}: ${path}` : path;
    this.log(msg, LOG_LEVELS.INFO);
  }

  /**
   * Логирует краткую информацию об ошибке с сохранением полного текста в артефакт
   */
  logErrorShort(error: Error | string, artifactName: string = 'error_full'): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorRef = this.writeArtifact(
      error instanceof Error ? `${error.stack || error.message}` : String(error),
      artifactName
    );

    this.log(`ERROR: ${errorMessage} | details_written_to=${errorRef}`, LOG_LEVELS.INFO);
  }

  /**
   * Логирует детали ошибки с сохранением полного стека в артефакт
   */
  logErrorDetails(error: Error | string, context: string = ''): void {
    const artifactPath = this.writeArtifact(
      `Context: ${context}\n\n${error instanceof Error ? error.stack || error.toString() : String(error)}`,
      'error_details'
    );

    const errorMsg = error instanceof Error ? error.message : String(error);
    const shortMsg = context ? `${context}: ${errorMsg}` : errorMsg;

    this.log(`ERROR: ${shortMsg} | full_error_written_to=${artifactPath}`, LOG_LEVELS.INFO);
  }

  /**
   * Логирует только при уровне DEBUG
   */
  debug(message: string, options: LogOptions = {}): void {
    this.log(message, LOG_LEVELS.DEBUG, options);
  }

  /**
   * Логирует только при уровне INFO или выше
   */
  info(message: string, options: LogOptions = {}): void {
    this.log(message, LOG_LEVELS.INFO, options);
  }

  /**
   * Логирует ошибки
   */
  error(error: Error | string, options: LogOptions = {}): void {
    if (error instanceof Error) {
      this.logErrorShort(error, options.artifactName);
    } else {
      this.log(`ERROR: ${error}`, LOG_LEVELS.INFO, options);
    }
  }
}

// Глобальный экземпляр логгера
let globalLogger: Logger | null = null;

/**
 * Инициализирует глобальный логгер
 */
export function initLogger(level: string = 'info', artifactDir: string = './artifacts'): Logger {
  globalLogger = new Logger(level, artifactDir);
  return globalLogger;
}

/**
 * Возвращает глобальный логгер
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger('info', './artifacts');
  }
  return globalLogger;
}
