const http = require('node:http');

const port = Number(process.argv[2]) || 43123;

function streamTool(response, { text, name, arguments: args }) {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive'
  });
  const common = { id: 'chatcmpl-desktop', object: 'chat.completion.chunk', created: 1, model: 'fake-noval' };
  const send = (payload) => response.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ ...common, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] });
  send({
    ...common,
    choices: [{
      index: 0,
      delta: {
        tool_calls: [{
          index: 0,
          id: 'call-desktop',
          type: 'function',
          function: { name, arguments: JSON.stringify(args) }
        }]
      },
      finish_reason: null
    }]
  });
  send({ ...common, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
  response.end('data: [DONE]\n\n');
}

const server = http.createServer((request, response) => {
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => { body += chunk; });
  request.on('end', () => {
    let payload = {};
    try { payload = JSON.parse(body); } catch { payload = {}; }
    const prompt = (payload.messages || []).map((item) => {
      if (typeof item.content === 'string') return item.content;
      if (Array.isArray(item.content)) return item.content.map((part) => part.text || '').join('\n');
      return '';
    }).join('\n');
    if (prompt.includes('停止能力检查') || prompt.includes('停止这个任务')) {
      const timer = setTimeout(() => streamTool(response, {
        text: '正在连续输出停止检查。',
        name: 'submit_answer',
        arguments: { answer: '停止检查完成', sources: [] }
      }), 4000);
      request.on('close', () => clearTimeout(timer));
      return;
    }
    if (prompt.includes('规划近期章节')) {
      streamTool(response, {
        text: '我会依据当前方向规划三章，并把结果放入候选区。',
        name: 'submit_candidate',
        arguments: {
          title: '近期三章计划',
          summary: '已规划近期三章。',
          changes: [{
            path: 'outline/chapters/next.md',
            action: 'create',
            content: '# 近期章节计划\n\n## 第一章：未来来信\n- 冲突：记者无法证明信件来源\n\n## 第二章：错位证词\n- 冲突：证人的记忆与日期矛盾\n\n## 第三章：潮汐时刻\n- 冲突：记者必须在真相与朋友之间选择'
          }],
          impact: ['建立近期推进节奏']
        }
      });
      return;
    }
    streamTool(response, {
      text: '正在用中文检查连接与受控动作。',
      name: 'submit_answer',
      arguments: { answer: '模型连接正常', sources: [] }
    });
  });
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`fake-model-ready:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
