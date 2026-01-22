import { MessageQueue } from '../src/message-queue';

describe('MessageQueue', () => {
  let queue: MessageQueue;

  beforeEach(() => {
    // Получаем инстанс и настраиваем для тестов
    queue = MessageQueue.getInstance();
    // Отключаем autoProcess, чтобы сообщения оставались в очереди
    (queue as any).config.autoProcess = false;
    // Очищаем очередь перед каждым тестом
    (queue as any).queue = [];
    (queue as any).processing = null;
  });

  describe('Singleton', () => {
    it('should return same instance', () => {
      const instance1 = MessageQueue.getInstance();
      const instance2 = MessageQueue.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('enqueue', () => {
    it('should add message with unique id', () => {
      const id = queue.enqueue('session1', 'read_runtime_logs', { sessionId: 'test' });
      expect(typeof id).toBe('string');
      expect(id).toMatch(/^[0-9a-f-]{36}$/); // UUID формат
      const msg = queue.peek();
      expect(msg).toBeTruthy();
      expect(msg?.sessionId).toBe('session1');
      expect(msg?.toolName).toBe('read_runtime_logs');
      expect(msg?.arguments).toEqual({ sessionId: 'test' });
    });

    it('should increment size', () => {
      expect(queue.size()).toBe(0);
      queue.enqueue('session1', 'tool1', {});
      expect(queue.size()).toBe(1);
      queue.enqueue('session2', 'tool2', {});
      expect(queue.size()).toBe(2);
    });
  });

  describe('dequeue', () => {
    it('should remove and return first message', () => {
      const id1 = queue.enqueue('session1', 'tool1', {});
      const id2 = queue.enqueue('session2', 'tool2', {});
      const msg = queue.dequeue();
      expect(msg?.id).toBe(id1);
      expect(queue.size()).toBe(1);
      expect(queue.peek()?.id).toBe(id2);
    });

    it('should return null when queue empty', () => {
      expect(queue.dequeue()).toBeNull();
    });

    it('should set processing flag', () => {
      queue.enqueue('session1', 'tool1', {});
      const msg = queue.dequeue();
      expect(queue.isProcessing()).toBe(true);
      expect(queue.getProcessing()?.id).toBe(msg?.id);
    });
  });

  describe('peek', () => {
    it('should return first message without removing', () => {
      queue.enqueue('session1', 'tool1', {});
      const msg = queue.peek();
      expect(msg).toBeTruthy();
      expect(queue.size()).toBe(1);
      expect(queue.peek()).toBe(msg); // тот же объект
    });

    it('should return null when queue empty', () => {
      expect(queue.peek()).toBeNull();
    });
  });

  describe('remove', () => {
    it('should remove message by id', () => {
      const id1 = queue.enqueue('session1', 'tool1', {});
      const id2 = queue.enqueue('session2', 'tool2', {});
      const removed = queue.remove(id1);
      expect(removed).toBe(true);
      expect(queue.size()).toBe(1);
      expect(queue.peek()?.id).toBe(id2);
    });

    it('should return false for non-existent id', () => {
      expect(queue.remove('non-existent')).toBe(false);
    });
  });

  describe('edit', () => {
    it('should update message arguments', () => {
      const id = queue.enqueue('session1', 'read_runtime_logs', { old: true });
      const success = queue.edit(id, { new: true });
      expect(success).toBe(true);
      const msg = queue.peek();
      expect(msg?.arguments).toEqual({ new: true });
    });

    it('should return false for non-existent id', () => {
      expect(queue.edit('non-existent', {})).toBe(false);
    });
  });

  describe('size', () => {
    it('should return correct count', () => {
      expect(queue.size()).toBe(0);
      queue.enqueue('session1', 'tool1', {});
      expect(queue.size()).toBe(1);
      queue.enqueue('session2', 'tool2', {});
      expect(queue.size()).toBe(2);
      queue.dequeue();
      expect(queue.size()).toBe(1);
      queue.clear();
      expect(queue.size()).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all messages', () => {
      queue.enqueue('session1', 'tool1', {});
      queue.enqueue('session2', 'tool2', {});
      queue.clear();
      expect(queue.size()).toBe(0);
      expect(queue.peek()).toBeNull();
      expect(queue.isProcessing()).toBe(false);
    });
  });

  describe('complete', () => {
    it('should mark processing message as completed', () => {
      const id = queue.enqueue('session1', 'tool1', {});
      const msg = queue.dequeue();
      expect(msg?.status).toBe('processing');
      queue.complete(id, { result: 'ok' });
      expect(queue.isProcessing()).toBe(false);
      // сообщение больше не в очереди
      expect(queue.size()).toBe(0);
    });
  });

  describe('fail', () => {
    it('should mark processing message as failed', () => {
      const id = queue.enqueue('session1', 'tool1', {});
      queue.dequeue();
      queue.fail(id, new Error('test error'));
      expect(queue.isProcessing()).toBe(false);
    });
  });
});