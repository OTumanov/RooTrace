// Message Queue для RooTrace MCP сервера
// Очередь сообщений с поддержкой неявного одобрения действий для queued сообщений

import { EventEmitter } from 'events';
import * as crypto from 'crypto';

// Типы сообщений
export interface QueuedMessage {
  id: string;
  requestId?: string; // ID запроса MCP (если есть)
  sessionId: string;
  toolName: string;
  arguments: any;
  timestamp: number; // время постановки в очередь
  startedAt?: number; // время начала обработки
  completedAt?: number; // время завершения обработки
  status: 'pending' | 'processing' | 'completed' | 'failed';
  implicitApproval: boolean; // флаг неявного одобрения действий
  metadata?: Record<string, any>;
}

export interface MessageQueueConfig {
  maxQueueSize?: number; // максимальный размер очереди (0 - без ограничений)
  autoProcess?: boolean; // автоматически обрабатывать следующее сообщение после завершения текущего
  defaultImplicitApproval?: boolean; // по умолчанию для queued сообщений
}

/**
 * Класс для управления очередью сообщений MCP сервера
 * Реализует FIFO очередь с возможностью редактирования/удаления сообщений до обработки
 */
export class MessageQueue extends EventEmitter {
  private static instance: MessageQueue;
  private queue: QueuedMessage[] = [];
  private processing: QueuedMessage | null = null;
  private config: Required<MessageQueueConfig>;

  private constructor(config: MessageQueueConfig = {}) {
    super();
    this.config = {
      maxQueueSize: config.maxQueueSize ?? 100,
      autoProcess: config.autoProcess ?? true,
      defaultImplicitApproval: config.defaultImplicitApproval ?? true,
    };
  }

  /**
   * Получает единственный экземпляр MessageQueue (Singleton)
   */
  static getInstance(config?: MessageQueueConfig): MessageQueue {
    if (!MessageQueue.instance) {
      MessageQueue.instance = new MessageQueue(config);
    }
    return MessageQueue.instance;
  }

  /**
   * Добавляет сообщение в очередь
   * @returns ID добавленного сообщения
   */
  enqueue(
    sessionId: string,
    toolName: string,
    args: any,
    metadata?: Record<string, any>
  ): string {
    // Проверяем размер очереди
    if (this.config.maxQueueSize > 0 && this.queue.length >= this.config.maxQueueSize) {
      throw new Error(`Message queue is full (max ${this.config.maxQueueSize})`);
    }

    const id = crypto.randomUUID();
    const message: QueuedMessage = {
      id,
      sessionId,
      toolName,
      arguments: args,
      timestamp: Date.now(),
      status: 'pending',
      implicitApproval: this.config.defaultImplicitApproval,
      metadata,
    };

    this.queue.push(message);
    this.emit('enqueued', message);
    this.logDebug(`Message enqueued: ${toolName} (id: ${id})`);

    // Если ничего не обрабатывается и включен autoProcess, начинаем обработку
    if (this.config.autoProcess && !this.processing) {
      this.processNext();
    }

    return id;
  }

  /**
   * Извлекает следующее сообщение из очереди и начинает его обработку
   * @returns Сообщение в обработке или null, если очередь пуста
   */
  dequeue(): QueuedMessage | null {
    if (this.queue.length === 0) {
      return null;
    }

    const message = this.queue.shift()!;
    message.status = 'processing';
    message.startedAt = Date.now();
    this.processing = message;

    this.emit('dequeued', message);
    this.logDebug(`Message dequeued: ${message.toolName} (id: ${message.id})`);

    return message;
  }

  /**
   * Просматривает первое сообщение в очереди без его удаления
   */
  peek(): QueuedMessage | null {
    return this.queue.length > 0 ? this.queue[0] : null;
  }

  /**
   * Завершает обработку текущего сообщения
   */
  complete(messageId: string, result?: any): void {
    if (!this.processing || this.processing.id !== messageId) {
      // Может быть завершение сообщения, которое не в обработке (редкий случай)
      const message = this.queue.find(m => m.id === messageId);
      if (!message) {
        this.logDebug(`Cannot complete message ${messageId}: not found`);
        return;
      }
      message.status = 'completed';
      message.completedAt = Date.now();
      this.emit('completed', message, result);
      return;
    }

    this.processing.status = 'completed';
    this.processing.completedAt = Date.now();
    this.emit('completed', this.processing, result);
    this.logDebug(`Message completed: ${this.processing.toolName} (id: ${messageId})`);

    this.processing = null;

    // Обрабатываем следующее сообщение, если есть
    if (this.config.autoProcess) {
      this.processNext();
    }
  }

  /**
   * Помечает текущее сообщение как неудачное
   */
  fail(messageId: string, error: Error): void {
    if (!this.processing || this.processing.id !== messageId) {
      const message = this.queue.find(m => m.id === messageId);
      if (!message) return;
      message.status = 'failed';
      message.completedAt = Date.now();
      this.emit('failed', message, error);
      return;
    }

    this.processing.status = 'failed';
    this.processing.completedAt = Date.now();
    this.emit('failed', this.processing, error);
    this.logDebug(`Message failed: ${this.processing.toolName} (id: ${messageId})`);

    this.processing = null;

    if (this.config.autoProcess) {
      this.processNext();
    }
  }

  /**
   * Удаляет сообщение из очереди (если оно ещё не обрабатывается)
   */
  remove(messageId: string): boolean {
    const index = this.queue.findIndex(m => m.id === messageId);
    if (index === -1) return false;

    const [removed] = this.queue.splice(index, 1);
    this.emit('removed', removed);
    this.logDebug(`Message removed: ${removed.toolName} (id: ${messageId})`);
    return true;
  }

  /**
   * Редактирует аргументы сообщения в очереди (если оно ещё не обрабатывается)
   */
  edit(messageId: string, newArgs: any): boolean {
    const message = this.queue.find(m => m.id === messageId);
    if (!message) return false;

    message.arguments = newArgs;
    this.emit('edited', message);
    this.logDebug(`Message edited: ${message.toolName} (id: ${messageId})`);
    return true;
  }

  /**
   * Получает список всех сообщений в очереди
   */
  list(): QueuedMessage[] {
    return [...this.queue];
  }

  /**
   * Получает текущее обрабатываемое сообщение
   */
  getProcessing(): QueuedMessage | null {
    return this.processing;
  }

  /**
   * Возвращает количество сообщений в очереди
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * Проверяет, занят ли сервер обработкой сообщения
   */
  isProcessing(): boolean {
    return this.processing !== null;
  }

  /**
   * Очищает очередь (удаляет все pending сообщения)
   */
  clear(): void {
    const removed = [...this.queue];
    this.queue = [];
    this.processing = null;
    this.emit('cleared', removed);
    this.logDebug(`Queue cleared, removed ${removed.length} messages`);
  }

  /**
   * Получает статистику очереди
   */
  getStats() {
    const pending = this.queue.length;
    const processing = this.processing ? 1 : 0;
    return {
      pending,
      processing,
      total: pending + processing,
      maxQueueSize: this.config.maxQueueSize,
    };
  }

  /**
   * Вспомогательный метод для отладки
   */
  private logDebug(message: string): void {
    // Можно интегрировать с системой логирования RooTrace
    if (process.env.NODE_ENV === 'development') {
      console.debug(`[MessageQueue] ${message}`);
    }
  }

  /**
   * Внутренний метод для обработки следующего сообщения
   */
  private processNext(): void {
    if (this.processing) {
      return; // Уже что-то обрабатывается
    }

    const next = this.dequeue();
    if (next) {
      this.emit('processing', next);
    }
  }
}