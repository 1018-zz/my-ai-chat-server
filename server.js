require('dotenv').config()
const express = require('express')
const cors = require('cors')
const OpenAI = require('openai')
const { createClient } = require('@supabase/supabase-js')

const app = express()
app.use(cors())
app.use(express.json())

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY
)

const openai = new OpenAI({
  baseURL: 'https://api.deepseek.com',
  apiKey: process.env.DEEPSEEK_API_KEY,
})

// ==================== 普通聊天接口 ====================
app.post('/api/chat', async (req, res) => {
  const { messages, model = 'deepseek-chat', conversationId } = req.body

  try {
    let convId = conversationId
    if (!convId) {
      const lastMsg = messages[messages.length - 1]?.content || '新对话'
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({ title: lastMsg.slice(0, 30) })
        .select('id')
        .single()
      convId = newConv.id
    }

    const completion = await openai.chat.completions.create({
      messages,
      model,
      temperature: 0.7,
    })

    const aiContent = completion.choices[0].message.content
    const userMessage = messages[messages.length - 1]

    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'user',
      content: userMessage.content,
      token_count: completion.usage?.prompt_tokens || 0,
    })

    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: aiContent,
      token_count: completion.usage?.completion_tokens || 0,
    })

    await supabase.from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId)

      // 检查 AI 回复中是否有需要记住的内容
    const memoryMatch = aiContent.match(/<!--\s*记住[：:]\s*(.+?)\s*-->/)
    if (memoryMatch) {
      const memoryText = memoryMatch[1].trim()
      await supabase.from('memories').insert({ summary: memoryText })
      console.log('自动沉淀记忆:', memoryText)
    }

    res.json({ content: aiContent, usage: completion.usage, conversationId: convId })
   
      res.json({ content: aiContent, usage: completion.usage, conversationId: convId })
  } catch (error) {
    console.error('Chat Error:', error.message)
    res.status(500).json({ error: error.message })
  }
})

// ==================== 流式聊天接口 ====================
app.post('/api/chat/stream', async (req, res) => {
  const { messages, model = 'deepseek-chat', conversationId } = req.body

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    let convId = conversationId
    if (!convId) {
      const lastMsg = messages[messages.length - 1]?.content || '新对话'
      const { data: newConv } = await supabase
        .from('conversations')
        .insert({ title: lastMsg.slice(0, 30) })
        .select('id')
        .single()
      convId = newConv.id
    }

    const userMessage = messages[messages.length - 1]
    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'user',
      content: userMessage.content,
    })

    const stream = await openai.chat.completions.create({
      messages,
      model,
      temperature: 0.7,
      stream: true,
    })

    let fullContent = ''

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) {
        fullContent += delta
        res.write(`data: ${JSON.stringify({ content: delta })}\n\n`)
      }
    }

    await supabase.from('messages').insert({
      conversation_id: convId,
      role: 'assistant',
      content: fullContent,
    })

       res.write(`data: ${JSON.stringify({ done: true, conversationId: convId })}\n\n`)

    // 检查 AI 回复中是否有需要记住的内容
    const memoryMatch = fullContent.match(/<!--\s*记住[：:]\s*(.+?)\s*-->/)
    if (memoryMatch) {
      const memoryText = memoryMatch[1].trim()
      await supabase.from('memories').insert({ summary: memoryText })
      console.log('自动沉淀记忆:', memoryText)
    }

    res.end()
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`)
    res.end()
  }
})

// ==================== 历史消息接口 ====================
app.get('/api/messages', async (req, res) => {
  const { conversationId } = req.query
  if (!conversationId) return res.status(400).json({ error: 'conversationId is required' })

  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ messages: data })
})

// ==================== 会话列表接口 ====================
app.get('/api/conversations', async (req, res) => {
  const { data, error } = await supabase
    .from('conversations')
    .select('*')
    .order('updated_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json({ conversations: data })
})

// ==================== 创建会话接口 ====================
app.post('/api/conversations', async (req, res) => {
  const { title } = req.body

  const { data, error } = await supabase
    .from('conversations')
    .insert({ title: title || '新对话' })
    .select('id')
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json({ id: data.id })
})

// ==================== 记忆检索接口 ====================
app.post('/api/memories/search', async (req, res) => {
  const { query, limit = 3 } = req.body
  if (!query) return res.status(400).json({ error: 'query is required' })

  try {
    const { data: memories } = await supabase
      .from('memories')
      .select('summary')
      .or(`summary.ilike.%${query}%`)
      .limit(limit)

    const { data: messages } = await supabase
      .from('messages')
      .select('role, content')
      .or(`content.ilike.%${query}%`)
      .order('created_at', { ascending: false })
      .limit(5)

      // 始终返回最近 5 条消息
const { data: recentMessages } = await supabase
  .from('messages')
  .select('role, content, created_at')
  .order('created_at', { ascending: false })
  .limit(5)

   res.json({
  memories: memories || [],
  relatedMessages: messages || [],
  recentMessages: recentMessages || [],
})
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ==================== 删除会话接口 ====================
app.delete('/api/conversations/:id', async (req, res) => {
  const { id } = req.params

  // 先删除该会话下的所有消息
  await supabase.from('messages').delete().eq('conversation_id', id)
  // 再删除会话本身
  const { error } = await supabase.from('conversations').delete().eq('id', id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ success: true })
})

// ==================== GitHub 工具接口 ====================
const GITHUB_API = 'https://api.github.com'

// 读取仓库文件
app.get('/api/github/file', async (req, res) => {
  const { path, repo } = req.query
  if (!path) return res.status(400).json({ error: 'path is required' })
  const targetRepo = repo || process.env.GITHUB_REPO

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${targetRepo}/contents/${path}`,
      { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'my-ai-chat' } }
    )
    const data = await response.json()
    if (data.content) {
      res.json({ path, content: Buffer.from(data.content, 'base64').toString('utf-8') })
    } else {
      res.json(data)
    }
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// 列出仓库目录
app.get('/api/github/tree', async (req, res) => {
  const { path = '', repo } = req.query
  const targetRepo = repo || process.env.GITHUB_REPO

  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${process.env.GITHUB_OWNER}/${targetRepo}/contents/${path}`,
      { headers: { Authorization: `token ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'my-ai-chat' } }
    )
    const data = await response.json()
    if (Array.isArray(data)) {
      res.json({ items: data.map(item => ({ name: item.name, type: item.type, path: item.path })) })
    } else {
      res.json(data)
    }
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ==================== 启动 ====================
const PORT = process.env.PORT || 10000
app.listen(PORT, () => console.log(`Server running on port ${PORT}`))
