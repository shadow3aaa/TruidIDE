#!/usr/bin/env node

/**
 * 简单的 Plaintext LSP 服务器
 * 提供基础的文本分析功能：单词计数、长单词诊断、简单补全
 */

const readline = require('readline');

class PlaintextLSPServer {
  constructor() {
    this.documents = new Map();
    this.requestId = 0;
    this.initializeParams = null;
  }

  log(message) {
    // 输出到 stderr，不会干扰 LSP 协议通信
    console.error(`[PlaintextLSP] ${message}`);
  }

  /**
   * 解析 LSP 消息头部
   */
  parseHeaders(headerText) {
    const headers = {};
    const lines = headerText.split('\r\n');
    for (const line of lines) {
      if (line.trim() === '') continue;
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 1).trim();
        headers[key] = value;
      }
    }
    return headers;
  }

  /**
   * 发送 LSP 响应
   */
  send(message) {
    const json = JSON.stringify(message);
    const content = Buffer.from(json, 'utf8');
    const header = `Content-Length: ${content.length}\r\n\r\n`;
    process.stdout.write(header);
    process.stdout.write(content);
  }

  /**
   * 发送通知
   */
  sendNotification(method, params) {
    this.send({
      jsonrpc: '2.0',
      method,
      params
    });
  }

  /**
   * 处理收到的消息
   */
  handleMessage(message) {
    try {
      const msg = JSON.parse(message);
      
      if (msg.method) {
        // 请求或通知
        if (msg.id !== undefined) {
          this.handleRequest(msg.id, msg.method, msg.params || {});
        } else {
          this.handleNotification(msg.method, msg.params || {});
        }
      }
    } catch (error) {
      this.log(`解析消息失败: ${error.message}`);
    }
  }

  /**
   * 处理请求
   */
  handleRequest(id, method, params) {
    this.log(`收到请求: ${method}`);

    switch (method) {
      case 'initialize':
        this.initializeParams = params;
        this.send({
          jsonrpc: '2.0',
          id,
          result: {
            capabilities: {
              textDocumentSync: {
                openClose: true,
                change: 1, // Full sync
              },
              completionProvider: {
                triggerCharacters: ['.', ' ']
              },
              hoverProvider: true,
              diagnosticProvider: {
                interFileDependencies: false,
                workspaceDiagnostics: false
              }
            },
            serverInfo: {
              name: 'plaintext-lsp',
              version: '0.1.0'
            }
          }
        });
        break;

      case 'shutdown':
        this.send({
          jsonrpc: '2.0',
          id,
          result: null
        });
        break;

      case 'textDocument/completion':
        this.handleCompletion(id, params);
        break;

      case 'textDocument/hover':
        this.handleHover(id, params);
        break;

      default:
        this.send({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32601,
            message: `方法未实现: ${method}`
          }
        });
    }
  }

  /**
   * 处理通知
   */
  handleNotification(method, params) {
    this.log(`收到通知: ${method}`);

    switch (method) {
      case 'initialized':
        this.log('客户端初始化完成');
        break;

      case 'textDocument/didOpen':
        this.handleDidOpen(params);
        break;

      case 'textDocument/didChange':
        this.handleDidChange(params);
        break;

      case 'textDocument/didClose':
        this.handleDidClose(params);
        break;

      case 'exit':
        this.log('收到退出通知');
        process.exit(0);
        break;
    }
  }

  /**
   * 文档打开
   */
  handleDidOpen(params) {
    const { textDocument } = params;
    this.documents.set(textDocument.uri, {
      uri: textDocument.uri,
      languageId: textDocument.languageId,
      version: textDocument.version,
      text: textDocument.text
    });
    this.log(`文档已打开: ${textDocument.uri}`);
    this.analyzeDiagnostics(textDocument.uri);
  }

  /**
   * 文档更改
   */
  handleDidChange(params) {
    const { textDocument, contentChanges } = params;
    const doc = this.documents.get(textDocument.uri);
    if (doc) {
      // Full sync
      if (contentChanges.length > 0) {
        doc.text = contentChanges[0].text;
        doc.version = textDocument.version;
        this.analyzeDiagnostics(textDocument.uri);
      }
    }
  }

  /**
   * 文档关闭
   */
  handleDidClose(params) {
    const { textDocument } = params;
    this.documents.delete(textDocument.uri);
    this.log(`文档已关闭: ${textDocument.uri}`);
  }

  /**
   * 分析诊断（查找长单词）
   */
  analyzeDiagnostics(uri) {
    const doc = this.documents.get(uri);
    if (!doc) return;

    const diagnostics = [];
    const lines = doc.text.split('\n');
    const maxLength = 50;

    lines.forEach((line, lineIndex) => {
      const words = line.match(/\b\w+\b/g) || [];
      words.forEach(word => {
        if (word.length > maxLength) {
          const startCol = line.indexOf(word);
          diagnostics.push({
            range: {
              start: { line: lineIndex, character: startCol },
              end: { line: lineIndex, character: startCol + word.length }
            },
            severity: 2, // Warning
            message: `单词过长 (${word.length} 个字符，建议不超过 ${maxLength})`,
            source: 'plaintext-lsp'
          });
        }
      });
    });

    this.sendNotification('textDocument/publishDiagnostics', {
      uri,
      diagnostics
    });
  }

  /**
   * 处理补全请求
   */
  handleCompletion(id, params) {
    const { textDocument, position } = params;
    const doc = this.documents.get(textDocument.uri);
    
    if (!doc) {
      this.send({
        jsonrpc: '2.0',
        id,
        result: { items: [] }
      });
      return;
    }

    const completionItems = [];
    const labels = new Set(); // 防止重复

    // 提供一些简单的补全建议
    const fixedItems = [
      { label: 'TODO', detail: '待办事项标记', insertText: 'TODO: ' },
      { label: 'FIXME', detail: '修复标记', insertText: 'FIXME: ' },
      { label: 'NOTE', detail: '笔记标记', insertText: 'NOTE: ' },
      { label: 'IMPORTANT', detail: '重要标记', insertText: 'IMPORTANT: ' }
    ];

    fixedItems.forEach(item => {
      labels.add(item.label);
      completionItems.push({
        label: item.label,
        kind: 1, // Text
        detail: item.detail,
        insertText: item.insertText
      });
    });

    // 从当前文档中提取常用词（排除已有的，忽略大小写）
    const text = doc.text;
    const wordMatches = text.match(/\b\w{4,}\b/g) || [];
    const uniqueWords = new Set(wordMatches);
    
    for (const word of uniqueWords) {
      const upperWord = word.toUpperCase();
      if (labels.has(word) || labels.has(upperWord)) continue; // 跳过重复（忽略大小写）
      if (completionItems.length >= 30) break; // 限制总数
      
      labels.add(word);
      completionItems.push({
        label: word,
        kind: 1,
        detail: '文档中的单词',
        insertText: word
      });
    }

    this.send({
      jsonrpc: '2.0',
      id,
      result: {
        isIncomplete: false,
        items: completionItems
      }
    });
  }

  /**
   * 处理悬停请求
   */
  handleHover(id, params) {
    const { textDocument, position } = params;
    const doc = this.documents.get(textDocument.uri);
    
    if (!doc) {
      this.send({
        jsonrpc: '2.0',
        id,
        result: null
      });
      return;
    }

    const lines = doc.text.split('\n');
    const line = lines[position.line] || '';
    
    // 获取当前位置的单词
    const before = line.substring(0, position.character);
    const after = line.substring(position.character);
    const wordBefore = (before.match(/\w+$/) || [''])[0];
    const wordAfter = (after.match(/^\w+/) || [''])[0];
    const word = wordBefore + wordAfter;

    if (word) {
      // 统计该单词在文档中出现的次数
      const count = (doc.text.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
      
      this.send({
        jsonrpc: '2.0',
        id,
        result: {
          contents: {
            kind: 'markdown',
            value: `**${word}**\n\n- 长度: ${word.length} 个字符\n- 在文档中出现: ${count} 次`
          }
        }
      });
    } else {
      this.send({
        jsonrpc: '2.0',
        id,
        result: null
      });
    }
  }

  /**
   * 启动服务器
   */
  start() {
    this.log('Plaintext LSP 服务器启动');
    this.log(`Node 版本: ${process.version}`);
    this.log(`工作目录: ${process.cwd()}`);

    let buffer = Buffer.alloc(0);
    let contentLength = null;

    process.stdin.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      while (true) {
        if (contentLength === null) {
          // 查找头部结束标记
          const headerEnd = buffer.indexOf('\r\n\r\n');
          if (headerEnd === -1) break;

          // 解析头部
          const headerText = buffer.slice(0, headerEnd).toString('utf8');
          const headers = this.parseHeaders(headerText);
          contentLength = parseInt(headers['Content-Length'] || '0', 10);

          // 移除头部
          buffer = buffer.slice(headerEnd + 4);
        }

        if (buffer.length >= contentLength) {
          // 读取消息体
          const messageBuffer = buffer.slice(0, contentLength);
          const message = messageBuffer.toString('utf8');
          buffer = buffer.slice(contentLength);
          contentLength = null;

          // 处理消息
          this.handleMessage(message);
        } else {
          break;
        }
      }
    });

    process.stdin.on('end', () => {
      this.log('标准输入已关闭');
      process.exit(0);
    });

    process.stdin.on('error', (error) => {
      this.log(`标准输入错误: ${error.message}`);
      process.exit(1);
    });
  }
}

// 启动服务器
const server = new PlaintextLSPServer();
server.start();
